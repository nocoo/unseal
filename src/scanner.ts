import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Executor } from "./exec.js";
import type { AppInfo } from "./types.js";

const QUARANTINE_ATTR = "com.apple.quarantine";
const DEFAULT_DIR = "/Applications";

/**
 * Scan a directory for .app bundles and check their quarantine status.
 *
 * @param exec - Command executor (injectable for testing)
 * @param dir - Directory to scan (default: /Applications)
 * @param entries - Optional pre-resolved directory entries (for testing).
 *                  If not provided, reads from the filesystem.
 */
export async function listApps(
  exec: Executor,
  dir: string = DEFAULT_DIR,
  entries?: string[]
): Promise<AppInfo[]> {
  const dirEntries = entries ?? (await readdir(dir));

  const appNames = dirEntries.filter((name) => name.endsWith(".app"));

  const apps = await Promise.all(
    appNames.map(async (name): Promise<AppInfo> => {
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
        const spctl = await exec("spctl", [
          "--assess",
          "--type",
          "execute",
          appPath,
        ]);
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
    })
  );

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}
