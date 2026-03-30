import { execFile } from "node:child_process";
import { createMockExecutor } from "./mock-executor.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Executor = (
  cmd: string,
  args: string[]
) => Promise<ExecResult>;

function createRealExecutor(): Executor {
  return (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
        if (error) {
          resolve({
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

export function createExecutor(): Executor {
  if (process.env.UNSEAL_MOCK === "1") {
    return createMockExecutor();
  }
  return createRealExecutor();
}
