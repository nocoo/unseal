import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Executor } from "../src/exec.js";
import type { listApps } from "../src/scanner.js";
import type { AppInfo, UnsealResult } from "../src/types.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// --- Mock all dependencies before importing the real run() ---
const { mockListApps, mockCheckSudo, mockUnsealApps, mockSelectApps, mockCreateExecutor } =
  vi.hoisted(() => ({
    mockListApps: vi.fn<typeof listApps>(),
    mockCheckSudo: vi.fn<(exec: Executor) => Promise<boolean>>(),
    mockUnsealApps: vi.fn<(apps: AppInfo[], exec: Executor) => Promise<UnsealResult[]>>(),
    mockSelectApps: vi.fn<(q: AppInfo[], u: AppInfo[], k: AppInfo[]) => Promise<AppInfo[]>>(),
    mockCreateExecutor: vi.fn<() => Executor>(),
  }));

vi.mock("../src/scanner.js", () => ({ listApps: mockListApps }));
vi.mock("../src/sudo.js", () => ({ checkSudo: mockCheckSudo }));
vi.mock("../src/unseal.js", () => ({ unsealApps: mockUnsealApps }));
vi.mock("../src/prompt.js", () => ({
  selectApps: mockSelectApps,
}));
vi.mock("../src/exec.js", () => ({
  createExecutor: mockCreateExecutor,
}));

// Import the REAL run() after mocking its dependencies
const { run } = await import("../src/index.js");

function makeApp(
  name: string,
  status: "quarantined" | "unsealed" | "unknown",
  error?: string,
): AppInfo {
  return {
    name: `${name}.app`,
    path: `/Applications/${name}.app`,
    status,
    error,
  };
}

function joinCalls(spy: MockInstance<(...args: unknown[]) => unknown>): string {
  return spy.mock.calls.map((c) => String(c[0])).join("\n");
}

describe("CLI entry point (real run())", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockListApps.mockReset();
    mockCheckSudo.mockReset();
    mockUnsealApps.mockReset();
    mockSelectApps.mockReset();
    mockCreateExecutor.mockReturnValue(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    }));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // --- Flag handling ---

  it("prints help text and exits 0 on --help", async () => {
    const code = await run({ args: ["--help"], isTTY: true });
    expect(code).toBe(0);
    const output = joinCalls(logSpy);
    expect(output).toContain("unseal");
    expect(output).toContain("Usage");
  });

  it("prints version and exits 0 on --version", async () => {
    const code = await run({ args: ["--version"], isTTY: true });
    expect(code).toBe(0);
    const output = joinCalls(logSpy);
    expect(output).toContain(pkg.version);
  });

  it("exits gracefully when not a TTY", async () => {
    const code = await run({ isTTY: false });
    expect(code).toBe(0);
    const output = joinCalls(logSpy);
    expect(output).toContain("Interactive terminal required");
  });

  it("uses process.stdin.isTTY when isTTY option is omitted", async () => {
    // Force the default-branch (`options.isTTY ?? process.stdin.isTTY`) to evaluate.
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    try {
      const code = await run({ args: [] });
      expect(code).toBe(0);
      const output = joinCalls(logSpy);
      expect(output).toContain("Interactive terminal required");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: original,
        configurable: true,
      });
    }
  });

  // --- Scan results ---

  it("prints 'already unsealed' when all apps are unsealed", async () => {
    mockListApps.mockResolvedValueOnce([makeApp("A", "unsealed"), makeApp("B", "unsealed")]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockSelectApps).not.toHaveBeenCalled();
    const output = joinCalls(logSpy);
    expect(output).toContain("already unsealed");
  });

  it("exits 1 when ALL apps are unknown (not falsely 'all unsealed')", async () => {
    mockListApps.mockResolvedValueOnce([
      makeApp("A", "unknown", "permission denied"),
      makeApp("B", "unknown", "timeout"),
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(1);
    const output = joinCalls(logSpy);
    expect(output).not.toContain("already unsealed");
    expect(output).toContain("could not");
  });

  it("warns when some apps are unknown but rest are unsealed", async () => {
    mockListApps.mockResolvedValueOnce([
      makeApp("A", "unsealed"),
      makeApp("B", "unknown", "permission denied"),
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    const output = joinCalls(logSpy);
    expect(output).toContain("could not be checked");
  });

  // --- Selection flow ---

  it("exits when user selects nothing", async () => {
    mockListApps.mockResolvedValueOnce([makeApp("A", "quarantined")]);
    mockSelectApps.mockResolvedValueOnce([]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockCheckSudo).not.toHaveBeenCalled();
    expect(mockUnsealApps).not.toHaveBeenCalled();
  });

  it("exits gracefully on Ctrl+C (ExitPromptError) during select", async () => {
    const exitErr = new Error("User force closed the prompt");
    exitErr.name = "ExitPromptError";
    mockListApps.mockResolvedValueOnce([makeApp("A", "quarantined")]);
    mockSelectApps.mockRejectedValueOnce(exitErr);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockUnsealApps).not.toHaveBeenCalled();
    const output = joinCalls(logSpy);
    expect(output).toContain("Cancelled.");
  });

  it("re-throws non-ExitPromptError from prompts", async () => {
    mockListApps.mockResolvedValueOnce([makeApp("A", "quarantined")]);
    mockSelectApps.mockRejectedValueOnce(new TypeError("something broke"));

    expect(run({ isTTY: true })).rejects.toThrow("something broke");
  });

  it("invokes the onProgress callback passed to listApps (writes scanning line)", async () => {
    // Force the mock to actually call the onProgress arg so the
    // `process.stdout.write` arrow inside run() executes.
    mockListApps.mockImplementationOnce(async (_exec, _dir, _entries, onProgress) => {
      onProgress?.("Foo.app");
      return [makeApp("Foo", "unsealed")];
    });

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    // The onProgress callback writes the "Scanning…" line to stdout.
    const writes = joinCalls(stdoutSpy);
    expect(writes).toContain("Scanning");
    expect(writes).toContain("Foo.app");
  });

  // --- Sudo ---

  it("prints error and exits 1 when sudo check fails", async () => {
    const app = makeApp("A", "quarantined");
    mockListApps.mockResolvedValueOnce([app]);
    mockSelectApps.mockResolvedValueOnce([app]);
    mockCheckSudo.mockResolvedValueOnce(false);

    const code = await run({ isTTY: true });

    expect(code).toBe(1);
    expect(mockUnsealApps).not.toHaveBeenCalled();
    const output = joinCalls(errorSpy);
    expect(output).toContain("sudo");
  });

  // --- Happy path ---

  it("calls unsealApps with selected apps on happy path", async () => {
    const app1 = makeApp("A", "quarantined");
    const app2 = makeApp("B", "quarantined");
    mockListApps.mockResolvedValueOnce([app1, app2, makeApp("C", "unsealed")]);
    mockSelectApps.mockResolvedValueOnce([app1, app2]);
    mockCheckSudo.mockResolvedValueOnce(true);
    mockUnsealApps.mockResolvedValueOnce([
      { app: app1, success: true },
      { app: app2, success: true },
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockUnsealApps).toHaveBeenCalledTimes(1);
    expect(mockUnsealApps.mock.calls[0]?.[0]).toEqual([app1, app2]);
  });

  it("prints warning when unknown status apps exist alongside quarantined", async () => {
    const qApp = makeApp("A", "quarantined");
    const uApp = makeApp("B", "unknown", "permission denied");
    mockListApps.mockResolvedValueOnce([qApp, uApp]);
    mockSelectApps.mockResolvedValueOnce([qApp]);
    mockCheckSudo.mockResolvedValueOnce(true);
    mockUnsealApps.mockResolvedValueOnce([{ app: qApp, success: true }]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    const output = joinCalls(logSpy);
    expect(output).toContain("could not be read");
  });

  it("prints failure details and summary when some unseals fail", async () => {
    const app1 = makeApp("A", "quarantined");
    const app2 = makeApp("B", "quarantined");
    mockListApps.mockResolvedValueOnce([app1, app2]);
    mockSelectApps.mockResolvedValueOnce([app1, app2]);
    mockCheckSudo.mockResolvedValueOnce(true);
    mockUnsealApps.mockResolvedValueOnce([
      { app: app1, success: true },
      { app: app2, success: false, error: "Operation not permitted" },
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    const output = joinCalls(logSpy);
    expect(output).toContain("A.app");
    expect(output).toContain("B.app");
    expect(output).toContain("1 succeeded");
    expect(output).toContain("1 failed");
  });

  it("handles empty apps list from scanner", async () => {
    mockListApps.mockResolvedValueOnce([]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    const output = joinCalls(logSpy);
    expect(output).toContain("already unsealed");
  });
});
