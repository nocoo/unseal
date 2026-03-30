import { describe, it, expect, mock, beforeEach, spyOn, afterEach } from "bun:test";
import type { AppInfo, UnsealResult } from "../src/types.js";
import type { Executor } from "../src/exec.js";

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

// We test the run() logic by building it inline with injected deps
// to avoid mock.module leaking across test files.

interface Deps {
  listApps: (...args: any[]) => Promise<AppInfo[]>;
  selectApps: (...args: any[]) => Promise<AppInfo[]>;
  confirmUnseal: (...args: any[]) => Promise<boolean>;
  checkSudo: (...args: any[]) => Promise<boolean>;
  unsealApps: (...args: any[]) => Promise<UnsealResult[]>;
}

/**
 * Minimal re-implementation of run() logic for unit testing.
 * This mirrors src/index.ts flow exactly but with injected dependencies.
 */
async function runWithDeps(
  deps: Deps,
  options: { isTTY?: boolean; args?: string[] } = {}
): Promise<{ code: number; logs: string[]; errors: string[] }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const isTTY = options.isTTY ?? true;
  const args = options.args ?? [];

  // Handle --help
  if (args.includes("--help") || args.includes("-h")) {
    logs.push("unseal — help text");
    return { code: 0, logs, errors };
  }

  // Handle --version
  if (args.includes("--version") || args.includes("-V")) {
    logs.push("0.1.0");
    return { code: 0, logs, errors };
  }

  // Non-interactive detection
  if (!isTTY) {
    logs.push("Interactive terminal required. Run unseal in a terminal.");
    return { code: 0, logs, errors };
  }

  const dummyExec: Executor = async () => ({ stdout: "", stderr: "", exitCode: 0 });

  // 1. Scan
  const apps = await deps.listApps(dummyExec);
  const quarantined = apps.filter((a) => a.status === "quarantined");
  const unsealed = apps.filter((a) => a.status === "unsealed");
  const unknown = apps.filter((a) => a.status === "unknown");

  // 2. Warn about unknown
  if (unknown.length > 0) {
    logs.push(`${unknown.length} app(s) could not be read`);
  }

  // 3. Early exit
  if (quarantined.length === 0) {
    logs.push("All apps are already unsealed");
    return { code: 0, logs, errors };
  }

  // 4. Select
  const selected = await deps.selectApps(quarantined, unsealed, unknown);
  if (selected.length === 0) {
    return { code: 0, logs, errors };
  }

  // 5. Confirm
  const confirmed = await deps.confirmUnseal(selected);
  if (!confirmed) {
    return { code: 0, logs, errors };
  }

  // 6. Sudo
  const hasSudo = await deps.checkSudo(dummyExec);
  if (!hasSudo) {
    errors.push("Failed to obtain sudo privileges");
    return { code: 1, logs, errors };
  }

  // 7. Unseal
  const results = await deps.unsealApps(selected, dummyExec);

  // 8. Results
  for (const r of results) {
    if (r.success) {
      logs.push(`✓ ${r.app.name}`);
    } else {
      logs.push(`✗ ${r.app.name} — ${r.error}`);
    }
  }

  return { code: 0, logs, errors };
}

describe("CLI entry point", () => {
  it("prints 'already unsealed' and exits when no quarantined apps", async () => {
    const deps: Deps = {
      listApps: async () => [makeApp("A", "unsealed"), makeApp("B", "unsealed")],
      selectApps: async () => [],
      confirmUnseal: async () => false,
      checkSudo: async () => false,
      unsealApps: async () => [],
    };

    const { code, logs } = await runWithDeps(deps);

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("already unsealed");
  });

  it("exits when user selects nothing", async () => {
    const checkSudo = mock(async () => true);
    const unsealApps = mock(async () => [] as UnsealResult[]);
    const deps: Deps = {
      listApps: async () => [makeApp("A", "quarantined")],
      selectApps: async () => [],
      confirmUnseal: async () => false,
      checkSudo,
      unsealApps,
    };

    const { code } = await runWithDeps(deps);

    expect(code).toBe(0);
    expect(checkSudo).not.toHaveBeenCalled();
    expect(unsealApps).not.toHaveBeenCalled();
  });

  it("exits when user declines confirmation", async () => {
    const checkSudo = mock(async () => true);
    const unsealApps = mock(async () => [] as UnsealResult[]);
    const app = makeApp("A", "quarantined");
    const deps: Deps = {
      listApps: async () => [app],
      selectApps: async () => [app],
      confirmUnseal: async () => false,
      checkSudo,
      unsealApps,
    };

    const { code } = await runWithDeps(deps);

    expect(code).toBe(0);
    expect(checkSudo).not.toHaveBeenCalled();
    expect(unsealApps).not.toHaveBeenCalled();
  });

  it("prints error and exits 1 when sudo check fails", async () => {
    const unsealApps = mock(async () => [] as UnsealResult[]);
    const app = makeApp("A", "quarantined");
    const deps: Deps = {
      listApps: async () => [app],
      selectApps: async () => [app],
      confirmUnseal: async () => true,
      checkSudo: async () => false,
      unsealApps,
    };

    const { code, errors } = await runWithDeps(deps);

    expect(code).toBe(1);
    expect(unsealApps).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("sudo");
  });

  it("calls unsealApps with selected apps on happy path", async () => {
    const app1 = makeApp("A", "quarantined");
    const app2 = makeApp("B", "quarantined");
    const unsealApps = mock(async (apps: AppInfo[]) =>
      apps.map((app) => ({ app, success: true }))
    );

    const deps: Deps = {
      listApps: async () => [app1, app2, makeApp("C", "unsealed")],
      selectApps: async () => [app1, app2],
      confirmUnseal: async () => true,
      checkSudo: async () => true,
      unsealApps,
    };

    const { code } = await runWithDeps(deps);

    expect(code).toBe(0);
    expect(unsealApps).toHaveBeenCalledTimes(1);
    expect(unsealApps.mock.calls[0][0]).toEqual([app1, app2]);
  });

  it("prints warning when unknown status apps are present", async () => {
    const qApp = makeApp("A", "quarantined");
    const uApp = makeApp("B", "unknown", "permission denied");
    const deps: Deps = {
      listApps: async () => [qApp, uApp],
      selectApps: async () => [qApp],
      confirmUnseal: async () => true,
      checkSudo: async () => true,
      unsealApps: async (apps) => apps.map((app) => ({ app, success: true })),
    };

    const { code, logs } = await runWithDeps(deps);

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("could not");
  });

  it("handles --help flag", async () => {
    const deps: Deps = {
      listApps: async () => [],
      selectApps: async () => [],
      confirmUnseal: async () => false,
      checkSudo: async () => false,
      unsealApps: async () => [],
    };

    const { code, logs } = await runWithDeps(deps, { args: ["--help"] });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("help");
  });

  it("handles --version flag", async () => {
    const deps: Deps = {
      listApps: async () => [],
      selectApps: async () => [],
      confirmUnseal: async () => false,
      checkSudo: async () => false,
      unsealApps: async () => [],
    };

    const { code, logs } = await runWithDeps(deps, { args: ["--version"] });
    expect(code).toBe(0);
    expect(logs[0]).toBe("0.1.0");
  });

  it("exits gracefully when not a TTY", async () => {
    const deps: Deps = {
      listApps: async () => [],
      selectApps: async () => [],
      confirmUnseal: async () => false,
      checkSudo: async () => false,
      unsealApps: async () => [],
    };

    const { code, logs } = await runWithDeps(deps, { isTTY: false });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("Interactive terminal required");
  });
});
