import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { createRequire } from "node:module";
import type { AppInfo, UnsealResult } from "../src/types.js";
import type { Executor } from "../src/exec.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// --- Mock all dependencies before importing the real run() ---
const mockListApps = mock<(...args: any[]) => Promise<AppInfo[]>>();
const mockCheckSudo = mock<(...args: any[]) => Promise<boolean>>();
const mockUnsealApps = mock<(...args: any[]) => Promise<UnsealResult[]>>();
const mockSelectApps = mock<(...args: any[]) => Promise<AppInfo[]>>();
const mockConfirmUnseal = mock<(...args: any[]) => Promise<boolean>>();
const mockCreateExecutor = mock<() => Executor>();
const mockConfirmScan = mock<(...args: any[]) => Promise<boolean>>();

mock.module("../src/scanner.js", () => ({ listApps: mockListApps }));
mock.module("../src/sudo.js", () => ({ checkSudo: mockCheckSudo }));
mock.module("../src/unseal.js", () => ({ unsealApps: mockUnsealApps }));
mock.module("../src/prompt.js", () => ({
  selectApps: mockSelectApps,
  confirmUnseal: mockConfirmUnseal,
}));
mock.module("../src/exec.js", () => ({
  createExecutor: mockCreateExecutor,
}));
mock.module("@inquirer/prompts", () => ({
  confirm: mockConfirmScan,
}));

// Import the REAL run() after mocking its dependencies
const { run } = await import("../src/index.js");

function makeApp(
  name: string,
  status: "quarantined" | "unsealed" | "unknown",
  error?: string
): AppInfo {
  return {
    name: `${name}.app`,
    path: `/Applications/${name}.app`,
    status,
    error,
  };
}

describe("CLI entry point (real run())", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockListApps.mockReset();
    mockCheckSudo.mockReset();
    mockUnsealApps.mockReset();
    mockSelectApps.mockReset();
    mockConfirmUnseal.mockReset();
    mockConfirmScan.mockReset();
    mockConfirmScan.mockResolvedValue(true); // default: user accepts scan
    mockCreateExecutor.mockReturnValue(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    }));
    logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
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
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("unseal");
    expect(output).toContain("Usage");
  });

  it("prints version and exits 0 on --version", async () => {
    const code = await run({ args: ["--version"], isTTY: true });
    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain(pkg.version);
  });

  it("exits gracefully when not a TTY", async () => {
    const code = await run({ isTTY: false });
    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("Interactive terminal required");
  });

  // --- Scan confirmation ---

  it("exits 0 with 'Cancelled' when user declines scan confirm", async () => {
    mockConfirmScan.mockResolvedValueOnce(false);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockListApps).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("Cancelled.");
  });

  it("exits 0 on Ctrl+C during scan confirm (ExitPromptError)", async () => {
    const exitErr = new Error("User force closed the prompt");
    exitErr.name = "ExitPromptError";
    mockConfirmScan.mockRejectedValueOnce(exitErr);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockListApps).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("Cancelled.");
  });

  it("proceeds to scan when user accepts confirm", async () => {
    mockConfirmScan.mockResolvedValueOnce(true);
    mockListApps.mockResolvedValueOnce([makeApp("A", "unsealed")]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockListApps).toHaveBeenCalled();
  });

  // --- Scan results ---

  it("prints 'already unsealed' when all apps are unsealed", async () => {
    mockListApps.mockResolvedValueOnce([
      makeApp("A", "unsealed"),
      makeApp("B", "unsealed"),
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockSelectApps).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("already unsealed");
  });

  it("exits 1 when ALL apps are unknown (not falsely 'all unsealed')", async () => {
    mockListApps.mockResolvedValueOnce([
      makeApp("A", "unknown", "permission denied"),
      makeApp("B", "unknown", "timeout"),
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(1);
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
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
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
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

  it("exits when user declines confirmation", async () => {
    const app = makeApp("A", "quarantined");
    mockListApps.mockResolvedValueOnce([app]);
    mockSelectApps.mockResolvedValueOnce([app]);
    mockConfirmUnseal.mockResolvedValueOnce(false);

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
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("Cancelled.");
  });

  it("exits gracefully on Ctrl+C (ExitPromptError) during confirm", async () => {
    const app = makeApp("A", "quarantined");
    const exitErr = new Error("User force closed the prompt");
    exitErr.name = "ExitPromptError";
    mockListApps.mockResolvedValueOnce([app]);
    mockSelectApps.mockResolvedValueOnce([app]);
    mockConfirmUnseal.mockRejectedValueOnce(exitErr);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockCheckSudo).not.toHaveBeenCalled();
    expect(mockUnsealApps).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("Cancelled.");
  });

  it("re-throws non-ExitPromptError from prompts", async () => {
    mockListApps.mockResolvedValueOnce([makeApp("A", "quarantined")]);
    mockSelectApps.mockRejectedValueOnce(new TypeError("something broke"));

    expect(run({ isTTY: true })).rejects.toThrow("something broke");
  });

  // --- Sudo ---

  it("prints error and exits 1 when sudo check fails", async () => {
    const app = makeApp("A", "quarantined");
    mockListApps.mockResolvedValueOnce([app]);
    mockSelectApps.mockResolvedValueOnce([app]);
    mockConfirmUnseal.mockResolvedValueOnce(true);
    mockCheckSudo.mockResolvedValueOnce(false);

    const code = await run({ isTTY: true });

    expect(code).toBe(1);
    expect(mockUnsealApps).not.toHaveBeenCalled();
    const output = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("sudo");
  });

  // --- Happy path ---

  it("calls unsealApps with selected apps on happy path", async () => {
    const app1 = makeApp("A", "quarantined");
    const app2 = makeApp("B", "quarantined");
    mockListApps.mockResolvedValueOnce([
      app1,
      app2,
      makeApp("C", "unsealed"),
    ]);
    mockSelectApps.mockResolvedValueOnce([app1, app2]);
    mockConfirmUnseal.mockResolvedValueOnce(true);
    mockCheckSudo.mockResolvedValueOnce(true);
    mockUnsealApps.mockResolvedValueOnce([
      { app: app1, success: true },
      { app: app2, success: true },
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    expect(mockUnsealApps).toHaveBeenCalledTimes(1);
    expect(mockUnsealApps.mock.calls[0][0]).toEqual([app1, app2]);
  });

  it("prints warning when unknown status apps exist alongside quarantined", async () => {
    const qApp = makeApp("A", "quarantined");
    const uApp = makeApp("B", "unknown", "permission denied");
    mockListApps.mockResolvedValueOnce([qApp, uApp]);
    mockSelectApps.mockResolvedValueOnce([qApp]);
    mockConfirmUnseal.mockResolvedValueOnce(true);
    mockCheckSudo.mockResolvedValueOnce(true);
    mockUnsealApps.mockResolvedValueOnce([
      { app: qApp, success: true },
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("could not be read");
  });

  it("prints failure details and summary when some unseals fail", async () => {
    const app1 = makeApp("A", "quarantined");
    const app2 = makeApp("B", "quarantined");
    mockListApps.mockResolvedValueOnce([app1, app2]);
    mockSelectApps.mockResolvedValueOnce([app1, app2]);
    mockConfirmUnseal.mockResolvedValueOnce(true);
    mockCheckSudo.mockResolvedValueOnce(true);
    mockUnsealApps.mockResolvedValueOnce([
      { app: app1, success: true },
      { app: app2, success: false, error: "Operation not permitted" },
    ]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("A.app");
    expect(output).toContain("B.app");
    expect(output).toContain("1 succeeded");
    expect(output).toContain("1 failed");
  });

  it("handles empty apps list from scanner", async () => {
    mockListApps.mockResolvedValueOnce([]);

    const code = await run({ isTTY: true });

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(output).toContain("already unsealed");
  });
});
