import type { Executor } from "./exec.js";
import type { AppInfo, UnsealResult } from "./types.js";

const QUARANTINE_ATTR = "com.apple.quarantine";

/**
 * Remove the quarantine extended attribute from the given apps.
 * Does NOT abort on individual failure — collects all results.
 */
export async function unsealApps(
  apps: AppInfo[],
  exec: Executor
): Promise<UnsealResult[]> {
  const results: UnsealResult[] = [];

  for (const app of apps) {
    const result = await exec("sudo", [
      "xattr",
      "-rd",
      QUARANTINE_ATTR,
      app.path,
    ]);

    if (result.exitCode === 0) {
      results.push({ app, success: true });
    } else {
      results.push({
        app,
        success: false,
        error: result.stderr.trim() || `xattr exited with code ${result.exitCode}`,
      });
    }
  }

  return results;
}
