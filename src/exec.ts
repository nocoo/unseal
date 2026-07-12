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
            // execFile's callback can pass null buffers on signal exits or
            // early errors; error.code is missing when the process is killed
            // by signal rather than exiting with a status.
            stdout: stdout ?? "",
            stderr: stderr ?? error.message,
            exitCode: error.code !== undefined ? Number(error.code) : 1,
          });
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      });
    });
}
