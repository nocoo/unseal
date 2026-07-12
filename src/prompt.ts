import { checkbox } from "@inquirer/prompts";
import chalk from "chalk";
import type { AppInfo } from "./types.js";

/**
 * Display app status and let user select quarantined apps to unseal.
 *
 * Sections (all aligned to column 2):
 * 1. Already unsealed (green ✓, info only)
 * 2. Unknown status (red ?, warning)
 * 3. Quarantined (yellow, selectable checkbox — defaults to all checked)
 *
 * Pressing Enter on the checkbox is the confirmation; the sudo/password
 * prompt appears immediately after. Ctrl+C or an empty selection cancels.
 */
export async function selectApps(
  quarantined: AppInfo[],
  unsealed: AppInfo[],
  unknown: AppInfo[],
): Promise<AppInfo[]> {
  if (unsealed.length > 0) {
    console.log(chalk.dim("\n  Already unsealed:"));
    for (const app of unsealed) {
      console.log(chalk.green(`  ✓ ${app.name}`));
    }
  }

  if (unknown.length > 0) {
    console.log(chalk.dim("\n  ⚠ Could not read status:"));
    for (const app of unknown) {
      console.log(chalk.red(`  ? ${app.name}`) + chalk.dim(` — ${app.error ?? "unknown error"}`));
    }
  }

  console.log();
  console.log(chalk.red.bold("  ⚠ Only unseal apps from trusted sources."));
  console.log();

  return checkbox<AppInfo>({
    message: "Quarantined apps (space to toggle, enter to unseal):",
    choices: quarantined.map((app) => ({
      name: chalk.yellow(app.name),
      value: app,
      checked: true,
    })),
    theme: {
      icon: {
        // Leading space widens cursor↔circle gap (inquirer renders
        // `${cursor}${checkbox} ${name}` with a hard-coded 1-wide cursor).
        checked: chalk.green(" ◉"),
        unchecked: " ◯",
        cursor: "❯",
      },
    },
  });
}
