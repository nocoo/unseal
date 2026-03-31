#!/usr/bin/env node
import chalk from "chalk";
import { createRequire } from "node:module";
import { createExecutor } from "./exec.js";
import { listApps } from "./scanner.js";
import { selectApps, confirmUnseal } from "./prompt.js";
import { checkSudo } from "./sudo.js";
import { unsealApps } from "./unseal.js";
import type { AppInfo } from "./types.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

const HELP_TEXT = `
  ${chalk.bold("unseal")} — Scan /Applications for quarantined apps and batch-remove quarantine

  ${chalk.dim("Usage:")}
    unseal              Interactive scan + unseal flow
    unseal --help       Show this help message
    unseal --version    Show version

  ${chalk.dim("How it works:")}
    1. Scans /Applications for .app bundles
    2. Checks quarantine status via xattr
    3. Lets you select quarantined apps to unseal
    4. Removes com.apple.quarantine attribute with sudo
`.trimEnd();

export interface RunOptions {
  args?: string[];
  isTTY?: boolean;
}

/**
 * Main CLI logic. Returns exit code.
 * Exported for testing — the bin entry calls this and sets process.exitCode.
 */
export async function run(options: RunOptions = {}): Promise<number> {
  const args = options.args ?? process.argv.slice(2);
  const isTTY = options.isTTY ?? process.stdin.isTTY;

  // Handle --help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return 0;
  }

  // Handle --version
  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    return 0;
  }

  // Non-interactive detection
  if (!isTTY) {
    console.log("Interactive terminal required. Run unseal in a terminal.");
    return 0;
  }

  const exec = createExecutor();

  // 1. Scan apps
  const apps = await listApps(exec);

  const quarantined = apps.filter((a) => a.status === "quarantined");
  const unsealed = apps.filter((a) => a.status === "unsealed");
  const unknown = apps.filter((a) => a.status === "unknown");

  // 2. Warn about unknown status apps
  if (unknown.length > 0) {
    console.log(
      chalk.yellow(
        `\n  ⚠ ${unknown.length} app(s) could not be read`
      )
    );
  }

  // 3. Early exit if nothing to unseal
  if (quarantined.length === 0) {
    if (unknown.length > 0 && unsealed.length === 0) {
      // All apps failed to scan — this is NOT "all unsealed"
      console.log(
        chalk.red("\n  ✗ Could not determine quarantine status for any app.")
      );
      console.log(
        chalk.dim("    Check file permissions or run with elevated access.\n")
      );
      return 1;
    }
    if (unknown.length > 0) {
      // Some succeeded (all unsealed), some failed
      console.log(
        chalk.yellow(
          `\n  ✓ All readable apps are already unsealed (${unknown.length} could not be checked)\n`
        )
      );
    } else {
      console.log(chalk.green("\n  ✓ All apps are already unsealed\n"));
    }
    return 0;
  }

  // 4. Multi-select prompt + 5. Confirm
  let selected: AppInfo[];
  let confirmed: boolean;
  try {
    selected = await selectApps(quarantined, unsealed, unknown);
    if (selected.length === 0) {
      return 0;
    }

    confirmed = await confirmUnseal(selected);
    if (!confirmed) {
      return 0;
    }
  } catch (err: unknown) {
    // @inquirer/prompts throws ExitPromptError on Ctrl+C / Esc
    if (err && typeof err === "object" && "name" in err && err.name === "ExitPromptError") {
      console.log(chalk.dim("\n  Cancelled.\n"));
      return 0;
    }
    throw err;
  }

  // 6. Sudo check (only after user fully commits)
  const hasSudo = await checkSudo(exec);
  if (!hasSudo) {
    console.error(
      chalk.red("\n  ✗ Failed to obtain sudo privileges. Cannot unseal apps.\n")
    );
    return 1;
  }

  // 7. Unseal
  const results = await unsealApps(selected, exec);

  // 8. Print results
  console.log();
  for (const r of results) {
    if (r.success) {
      console.log(chalk.green(`  ✓ ${r.app.name}`));
    } else {
      console.log(chalk.red(`  ✗ ${r.app.name}`) + chalk.dim(` — ${r.error}`));
    }
  }
  console.log();

  const failures = results.filter((r) => !r.success);
  if (failures.length > 0) {
    console.log(
      chalk.yellow(
        `  ${results.length - failures.length} succeeded, ${failures.length} failed\n`
      )
    );
  }

  return 0;
}

// Only execute when run directly (not imported for testing)
import { fileURLToPath } from "node:url";
const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
