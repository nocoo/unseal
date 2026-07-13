import type { ExecException, execFile as execFileType } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn<typeof execFileType>(),
}));

vi.mock("node:child_process", () => ({ execFile: mockExecFile }));

const { createExecutor } = await import("../src/exec.js");

function makeExecError(message: string, extras: Partial<ExecException> = {}): ExecException {
  return Object.assign(new Error(message), { cmd: "mocked-command", ...extras });
}

describe("exec branches (mocked child_process.execFile)", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("falls back to '' when execFile passes null stdout/stderr on error", async () => {
    // Node types don't advertise it, but the callback can be invoked with
    // null buffers when the process is killed by a signal or errors early.
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb?.(
        makeExecError("boom", { code: 3 }),
        null as unknown as string,
        null as unknown as string,
      );
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
      // no `code` property — mimics signal-killed processes
      cb?.(makeExecError("killed by signal"), "some out", "some err");
      return {} as ReturnType<typeof execFileType>;
    });

    const exec = createExecutor();
    const result = await exec("whatever", []);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("some out");
    expect(result.stderr).toBe("some err");
  });

  it("normalises string errno codes (e.g. ENOENT on spawn failure) to exitCode 1", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb?.(
        // Node passes a string errno name (not a number) when the child
        // process fails to spawn — Number("ENOENT") is NaN, so exec must
        // collapse it to a real integer.
        makeExecError("spawn ENOENT", { code: "ENOENT" as unknown as number }),
        "",
        "",
      );
      return {} as ReturnType<typeof execFileType>;
    });

    const exec = createExecutor();
    const result = await exec("missing-binary", []);

    expect(result.exitCode).toBe(1);
    expect(Number.isFinite(result.exitCode)).toBe(true);
    // Empty stderr must fall back to error.message so callers see something.
    expect(result.stderr).toBe("spawn ENOENT");
  });

  it("parses numeric string exit codes (e.g. shell wrappers emit '3')", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb?.(makeExecError("failed", { code: "3" as unknown as number }), "", "err text");
      return {} as ReturnType<typeof execFileType>;
    });

    const exec = createExecutor();
    const result = await exec("whatever", []);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("err text");
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
