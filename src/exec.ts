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
  return async (cmd, args) => {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  };
}

export function createExecutor(): Executor {
  if (process.env.UNSEAL_MOCK === "1") {
    return createMockExecutor();
  }
  return createRealExecutor();
}
