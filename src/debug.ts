#!/usr/bin/env bun
/**
 * Debug entry — dev-only.
 *
 * Runs the full CLI flow (scan → select → sudo → unseal → report) against
 * a scripted, in-memory scenario so we can eyeball the TUI without needing
 * a real quarantined app.
 *
 *   bun run debug              # default scenario: "mixed"
 *   bun run debug all-quarantined
 *   bun run debug all-unsealed
 *   bun run debug with-unknown
 *   bun run debug empty
 *
 * This file is NOT imported from src/index.ts, so `bun build` (whose entry
 * is src/index.ts) tree-shakes it out of the published bundle entirely.
 * The `dist/` npm package contains zero debug code.
 */
import chalk from "chalk";
import type { Executor } from "./exec.js";
import { run } from "./index.js";
import type { AppInfo } from "./types.js";

interface Scenario {
  description: string;
  apps: AppInfo[];
  /**
   * Names that should FAIL when the user tries to unseal them. Lets us
   * exercise the partial-failure summary path.
   */
  unsealFailures?: readonly string[];
}

const SCENARIOS: Record<string, Scenario> = {
  mixed: {
    description: "typical machine: many unsealed, a few quarantined, one unreadable",
    apps: [
      app("Safari", "unsealed"),
      app("Xcode", "unsealed"),
      app("Google Chrome", "unsealed"),
      app("Raycast", "unsealed"),
      app("Zed", "unsealed"),
      app("Lyre", "quarantined"),
      app("Screaming Frog", "quarantined"),
      app("MysteryApp", "unknown", "Operation not permitted"),
    ],
  },
  "all-quarantined": {
    description: "every app carries the quarantine bit",
    apps: [
      app("Discord", "quarantined"),
      app("Slack", "quarantined"),
      app("Notion", "quarantined"),
      app("Figma", "quarantined"),
    ],
  },
  "all-unsealed": {
    description: "nothing to do — exercises the early-exit path",
    apps: [app("Safari", "unsealed"), app("Xcode", "unsealed"), app("Terminal", "unsealed")],
  },
  "with-unknown": {
    description: "one quarantined, some readable, some unreadable",
    apps: [
      app("Lyre", "quarantined"),
      app("Safari", "unsealed"),
      app("A_Unreadable", "unknown", "permission denied"),
      app("B_Unreadable", "unknown"),
    ],
  },
  "with-failure": {
    description: "unseal succeeds for one app, fails for another",
    apps: [app("Lyre", "quarantined"), app("Locked", "quarantined"), app("Safari", "unsealed")],
    unsealFailures: ["Locked.app"],
  },
  empty: {
    description: "no .app bundles found",
    apps: [],
  },
};

function app(
  name: string,
  status: "quarantined" | "unsealed" | "unknown",
  error?: string,
): AppInfo {
  return { name: `${name}.app`, path: `/Applications/${name}.app`, status, error };
}

function pickScenario(argv: string[]): { key: string; scenario: Scenario } {
  const key = argv[0] ?? "mixed";
  if (key === "--list" || key === "-l") {
    console.log(chalk.bold("\n  Available scenarios:\n"));
    for (const [k, v] of Object.entries(SCENARIOS)) {
      console.log(`  ${chalk.cyan(k.padEnd(18))} ${chalk.dim(v.description)}`);
    }
    console.log();
    process.exit(0);
  }
  const scenario = SCENARIOS[key];
  if (!scenario) {
    console.error(chalk.red(`\n  unknown scenario: ${key}`));
    console.error(chalk.dim(`  available: ${Object.keys(SCENARIOS).join(", ")}\n`));
    process.exit(2);
  }
  return { key, scenario };
}

/**
 * Fake executor: only sudo-related commands need to answer here — the
 * scanner and unseal steps go through the injected `scanApps` /
 * result-inspection paths for their data, but `unsealApps` and
 * `checkSudo` still call the executor.
 */
function createDebugExecutor(unsealFailures: ReadonlySet<string>): Executor {
  return async (cmd, args) => {
    // sudo -n true → pretend passwordless sudo is not available so the
    // user sees the real `sudo -v` password prompt flow.
    if (cmd === "sudo" && args[0] === "-n") {
      return { stdout: "", stderr: "", exitCode: 1 };
    }
    // sudo -v → pretend the password was accepted.
    if (cmd === "sudo" && args[0] === "-v") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    // sudo xattr -rd com.apple.quarantine <path> → succeed unless the
    // scenario asked this app to fail.
    if (cmd === "sudo" && args[0] === "xattr" && args[1] === "-rd") {
      const path = args[args.length - 1] ?? "";
      const name = path.split("/").pop() ?? "";
      if (unsealFailures.has(name)) {
        return {
          stdout: "",
          stderr: "xattr: [Errno 1] Operation not permitted",
          exitCode: 1,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    // Anything else in debug mode is a bug — surface it loudly.
    return {
      stdout: "",
      stderr: `debug executor: unexpected command "${cmd} ${args.join(" ")}"`,
      exitCode: 127,
    };
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { key, scenario } = pickScenario(argv);

  console.log(chalk.magenta.bold(`\n  🧪 DEBUG MODE — scenario: ${key}`));
  console.log(chalk.dim(`  ${scenario.description}\n`));

  const failures = new Set(scenario.unsealFailures ?? []);
  const exec = createDebugExecutor(failures);

  // Feed the scripted app list into run() via the scanApps hook. We still
  // pulse onProgress so the "Scanning…" line renders and can be inspected.
  const scanApps = async (
    _exec: Executor,
    onProgress: (name: string) => void,
  ): Promise<AppInfo[]> => {
    for (const a of scenario.apps) {
      onProgress(a.name);
      // Small nudge so the scanning line is visible on fast machines.
      await new Promise((r) => setTimeout(r, 30));
    }
    return [...scenario.apps].sort((a, b) => a.name.localeCompare(b.name));
  };

  const code = await run({
    args: [],
    isTTY: true,
    exec,
    scanApps,
  });
  process.exitCode = code;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
