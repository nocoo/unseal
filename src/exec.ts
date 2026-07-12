import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Executor = (cmd: string, args: string[]) => Promise<ExecResult>;

export function createExecutor(): Executor {
  return (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            /* v8 ignore next 3 -- execFile callback always provides string buffers
               in utf-8 encoding; the ?? fallbacks defend against an undocumented
               null/undefined and against missing error.code on signal exits. */
            stdout: stdout ?? "",
            stderr: stderr ?? error.message,
            exitCode: error.code !== undefined ? Number(error.code) : 1,
          });
          return;
        }
        /* v8 ignore next -- same as above: stdout/stderr are always strings on success. */
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      });
    });
}
