import { checkbox, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import type { AppInfo } from "./types.js";

/**
 * Display app status and let user select quarantined apps to unseal.
 *
 * Three sections:
 * 1. Already unsealed (green ✓, info only)
 * 2. Unknown status (red ?, warning)
 * 3. Quarantined (yellow, selectable checkbox)
 */
export async function selectApps(
  quarantined: AppInfo[],
  unsealed: AppInfo[],
  unknown: AppInfo[]
): Promise<AppInfo[]> {
  // Display unsealed apps (info section)
  if (unsealed.length > 0) {
    console.log(chalk.dim("\n  Already unsealed:"));
    for (const app of unsealed) {
      console.log(chalk.green(`    ✓ ${app.name}`));
    }
  }

  // Display unknown apps (warning section)
  if (unknown.length > 0) {
    console.log(chalk.dim("\n  ⚠ Could not read status:"));
    for (const app of unknown) {
      console.log(
        chalk.red(`    ? ${app.name}`) +
          chalk.dim(` — ${app.error ?? "unknown error"}`)
      );
    }
  }

  console.log();

  // Checkbox for quarantined apps
  const selected = await checkbox<AppInfo>({
    message: "Quarantined apps (select to unseal):",
    choices: quarantined.map((app) => ({
      name: chalk.yellow(app.name),
      value: app,
      checked: false,
    })),
  });

  return selected;
}

/**
 * Show warning and ask for final confirmation before unsealing.
 */
export async function confirmUnseal(
  selected: AppInfo[]
): Promise<boolean> {
  console.log();
  console.log(
    chalk.red.bold(
      "  ⚠️  Warning: Do not unseal apps you don't recognize."
    )
  );
  console.log(
    chalk.red("  Only unseal apps from trusted sources.")
  );
  console.log();

  for (const app of selected) {
    console.log(chalk.yellow(`    • ${app.name}`));
  }

  console.log();

  return confirm({
    message: `Are you sure you want to unseal ${selected.length} app(s)?`,
    default: false,
  });
}
