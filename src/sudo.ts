import type { Executor } from "./exec.js";

/**
 * Check if sudo privileges are available.
 * First tries passwordless sudo, then falls back to interactive sudo -v.
 */
export async function checkSudo(exec: Executor): Promise<boolean> {
  // Try passwordless sudo first
  const nonInteractive = await exec("sudo", ["-n", "true"]);
  if (nonInteractive.exitCode === 0) {
    return true;
  }

  // Fall back to interactive sudo validation
  const interactive = await exec("sudo", ["-v"]);
  return interactive.exitCode === 0;
}
