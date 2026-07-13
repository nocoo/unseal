import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Executor = (cmd: string, args: string[]) => Promise<ExecResult>;

/**
 * Decode execFile's `error.code`, which is polymorphic:
 * - `number` when the child process exits non-zero (normal case)
 * - `string` errno name when the process fails to spawn (`ENOENT`, `EACCES`, …)
 * - `undefined` on signal termination or otherwise-anomalous errors
 *
 * We collapse spawn failures and unknowns to 1 so callers always see a real
 * integer — `Number("ENOENT")` returned `NaN`, which broke every branch that
 * compared `exitCode !== 0`.
 */
function decodeExitCode(code: unknown): number {
  if (typeof code === "number") return code;
  if (typeof code === "string") {
    const parsed = Number(code);
    return Number.isFinite(parsed) ? parsed : 1;
  }
  return 1;
}

export function createExecutor(): Executor {
  return (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
        if (error) {
          // execFile's callback can pass null buffers on signal exits or
          // early errors; stderr may also be the empty string on spawn
          // failures (e.g. ENOENT), so fall back to error.message when it
          // carries no diagnostic.
          const stderrText = stderr && stderr.length > 0 ? stderr : error.message;
          resolve({
            stdout: stdout ?? "",
            stderr: stderrText,
            exitCode: decodeExitCode(error.code),
          });
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      });
    });
}
