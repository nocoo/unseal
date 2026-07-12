#!/usr/bin/env node
import { createRequire } from "node:module";
import chalk from "chalk";
import type { Executor } from "./exec.js";
import { createExecutor } from "./exec.js";
import { selectApps } from "./prompt.js";
import { listApps } from "./scanner.js";
import { checkSudo } from "./sudo.js";
import type { AppInfo } from "./types.js";
import { unsealApps } from "./unseal.js";

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
  /**
   * Optional executor override. When set, the built-in `createExecutor()`
   * is skipped entirely — used by the debug entry to inject a scripted
   * fake without touching the production path.
   */
  exec?: Executor;
  /**
   * Optional scanner override. When set, replaces the real `listApps()`
   * scan of `/Applications` with a canned list. Used by the debug entry
   * to feed known scenarios into the UI.
   */
  scanApps?: (exec: Executor, onProgress: (name: string) => void) => Promise<AppInfo[]>;
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
    console.log("\n  Interactive terminal required. Run unseal in a terminal.\n");
    return 0;
  }

  const exec = options.exec ?? createExecutor();

  // 1. Scan apps with progress indicator
  const scan =
    options.scanApps ?? ((e, onProgress) => listApps(e, undefined, undefined, onProgress));
  const apps = await scan(exec, (name) => {
    process.stdout.write(`\r\x1b[K  Scanning…  ${name}`);
  });
  process.stdout.write("\r\x1b[K"); // clear scanning line

  const quarantined = apps.filter((a) => a.status === "quarantined");
  const unsealed = apps.filter((a) => a.status === "unsealed");
  const unknown = apps.filter((a) => a.status === "unknown");

  // 2. Warn about unknown status apps
  if (unknown.length > 0) {
    console.log(chalk.yellow(`\n  ⚠ ${unknown.length} app(s) could not be read`));
  }

  // 3. Early exit if nothing to unseal
  if (quarantined.length === 0) {
    if (unknown.length > 0 && unsealed.length === 0) {
      // All apps failed to scan — this is NOT "all unsealed"
      console.log(chalk.red("\n  ✗ Could not determine quarantine status for any app."));
      console.log(chalk.dim("  Check file permissions or run with elevated access.\n"));
      return 1;
    }
    if (unknown.length > 0) {
      // Some succeeded (all unsealed), some failed
      console.log(
        chalk.yellow(
          `\n  ✓ All readable apps are already unsealed (${unknown.length} could not be checked)\n`,
        ),
      );
    } else {
      console.log(chalk.green("\n  ✓ All apps are already unsealed\n"));
    }
    return 0;
  }

  // 4. Multi-select prompt (selection itself is the confirmation)
  let selected: AppInfo[];
  try {
    selected = await selectApps(quarantined, unsealed, unknown);
    if (selected.length === 0) {
      console.log(chalk.dim("\n  Nothing selected.\n"));
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

  // 5. Sudo check (only after user fully commits)
  const hasSudo = await checkSudo(exec);
  if (!hasSudo) {
    console.error(chalk.red("\n  ✗ Failed to obtain sudo privileges. Cannot unseal apps.\n"));
    return 1;
  }

  // 6. Unseal
  const results = await unsealApps(selected, exec);

  // 7. Print results
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
      chalk.yellow(`  ${results.length - failures.length} succeeded, ${failures.length} failed\n`),
    );
  }

  return 0;
}

import { realpathSync } from "node:fs";
// Only execute when run directly (not imported for testing)
import { fileURLToPath } from "node:url";

/* v8 ignore start -- bin entry: only runs when executed as a script */
const thisFile = fileURLToPath(import.meta.url);
const mainFile = process.argv[1] ? realpathSync(process.argv[1]) : "";
const isMainModule = thisFile === mainFile;

if (isMainModule) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
/* v8 ignore stop */
