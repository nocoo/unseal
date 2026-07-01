import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Executor } from "./exec.js";
import type { AppInfo } from "./types.js";

const QUARANTINE_ATTR = "com.apple.quarantine";
const DEFAULT_DIR = "/Applications";
const DEFAULT_CONCURRENCY = 3;

interface ScanOptions {
  /** Max in-flight `xattr` + `spctl` chains. Default 3. */
  concurrency?: number;
  /** Pre-resolved directory entries — bypass the fs read (for testing). */
  entries?: string[];
  /**
   * Called with the app name each time a worker begins that app. Under
   * concurrency > 1 this fires in dispatch order (i.e. the input array's
   * order), not completion order.
   */
  onProgress?: (appName: string) => void;
}

/**
 * Scan a directory for .app bundles and check their quarantine status.
 *
 * Per app: `xattr -l` first; only if quarantine xattr is present does
 * it fall back to the slower `spctl --assess` to distinguish "truly
 * quarantined" from "quarantined but Gatekeeper-trusted (signed)".
 *
 * Runs the per-app chain through a bounded worker pool. Default 3 —
 * a compromise between wall-clock speedup (~3× on typical machines)
 * and load on Gatekeeper (spctl is not cheap, and blasting it
 * concurrently can hit XPC rate limits).
 */
export async function listApps(
  exec: Executor,
  dir: string = DEFAULT_DIR,
  entries?: string[],
  onProgress?: (appName: string) => void,
  options: ScanOptions = {},
): Promise<AppInfo[]> {
  // Back-compat overloads: earlier callers pass entries/onProgress
  // positionally. New callers should pass options only.
  const opts: ScanOptions = {
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    entries: options.entries ?? entries,
    onProgress: options.onProgress ?? onProgress,
  };

  const dirEntries = opts.entries ?? (await readdir(dir));
  const appNames = dirEntries.filter((name) => name.endsWith(".app"));
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  // Fixed-size result array indexed by input position so we can preserve
  // dispatch order semantics for callers who inspect it before the sort.
  const results = new Array<AppInfo>(appNames.length);

  // Shared cursor for workers to draw from.
  let next = 0;
  const takeNext = (): number => {
    if (next >= appNames.length) return -1;
    const i = next;
    next += 1;
    return i;
  };

  async function worker(): Promise<void> {
    for (;;) {
      const i = takeNext();
      if (i === -1) return;
      const name = appNames[i];
      /* v8 ignore next -- unreachable: takeNext() only returns valid indexes into appNames;
         this guard exists only to satisfy no-non-null-assertion under strict mode. */
      if (name === undefined) return;
      opts.onProgress?.(name);
      results[i] = await scanOne(exec, dir, name);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, appNames.length) }, () =>
    worker(),
  );
  await Promise.all(workers);

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanOne(
  exec: Executor,
  dir: string,
  name: string,
): Promise<AppInfo> {
  const appPath = join(dir, name);
  try {
    const result = await exec("xattr", ["-l", appPath]);

    if (result.exitCode !== 0) {
      return {
        name,
        path: appPath,
        status: "unknown",
        error: result.stderr.trim() || `xattr exited with code ${result.exitCode}`,
      };
    }

    const hasQuarantineAttr = result.stdout.includes(QUARANTINE_ATTR);
    if (!hasQuarantineAttr) {
      return { name, path: appPath, status: "unsealed" };
    }

    // Quarantine xattr present — ask Gatekeeper if it actually blocks this app.
    // spctl exit 0 = signature valid, Gatekeeper allows it → treat as unsealed.
    // spctl exit ≠ 0 = Gatekeeper rejects → truly quarantined.
    const spctl = await exec("spctl", ["--assess", "--type", "execute", appPath]);
    return {
      name,
      path: appPath,
      status: spctl.exitCode === 0 ? "unsealed" : "quarantined",
    };
  } catch (err) {
    return {
      name,
      path: appPath,
      status: "unknown",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
