import type { execFile as execFileType } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn<typeof execFileType>(),
}));

vi.mock("node:child_process", () => ({ execFile: mockExecFile }));

const { createExecutor } = await import("../src/exec.js");

describe("exec branches (mocked child_process.execFile)", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("falls back to '' when execFile passes null stdout/stderr on error", async () => {
    // Node types don't advertise it, but the callback can be invoked with
    // null buffers when the process is killed by a signal or errors early.
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error("boom") as NodeJS.ErrnoException;
      err.code = "3";
      cb?.(err, null as unknown as string, null as unknown as string);
      return {} as ReturnType<typeof execFileType>;
    });

    const exec = createExecutor();
    const result = await exec("whatever", []);

    expect(result.stdout).toBe("");
    // stderr null path falls back to error.message
    expect(result.stderr).toBe("boom");
    expect(result.exitCode).toBe(3);
  });

  it("defaults exitCode to 1 when the error carries no code (e.g. signal exit)", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error("killed by signal") as NodeJS.ErrnoException;
      // no `code` property
      cb?.(err, "some out", "some err");
      return {} as ReturnType<typeof execFileType>;
    });

    const exec = createExecutor();
    const result = await exec("whatever", []);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("some out");
    expect(result.stderr).toBe("some err");
  });

  it("falls back to '' on success when execFile passes null buffers", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb?.(null, null as unknown as string, null as unknown as string);
      return {} as ReturnType<typeof execFileType>;
    });

    const exec = createExecutor();
    const result = await exec("whatever", []);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
