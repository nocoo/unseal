# 01 — Architecture

## Context

macOS Gatekeeper uses a **quarantine extended attribute** (`com.apple.quarantine`) to flag apps downloaded from the internet. `unseal` is a CLI tool that scans `/Applications`, displays quarantine status for all apps, and lets the user batch-remove the quarantine attribute ("unseal") from selected ones.

NPM package name: `unseal` (matches folder name).

---

## Project Structure

```
unseal/
├── src/
│   ├── index.ts          # CLI entry point (bin)
│   ├── debug.ts          # Dev-only scenario harness (tree-shaken from dist/)
│   ├── exec.ts           # Command executor abstraction (execFile wrapper)
│   ├── scanner.ts        # Scan /Applications, detect quarantine status
│   ├── unseal.ts         # Remove quarantine attribute (xattr -rd)
│   ├── prompt.ts         # TUI multi-select prompt + confirmation
│   ├── sudo.ts           # sudo privilege check
│   └── types.ts          # Shared types
├── tests/
│   ├── scanner.test.ts
│   ├── unseal.test.ts
│   ├── prompt.test.ts
│   ├── sudo.test.ts
│   ├── index.test.ts
│   ├── exec.test.ts
│   └── exec.branches.test.ts
├── docs/
│   ├── README.md          # Docs index
│   ├── 01-architecture.md # This file
│   └── 02-testing.md      # Testing strategy
├── package.json
├── tsconfig.json
├── tsconfig.test.json
└── README.md
```

---

## Core Modules

### 1. `src/types.ts` — Shared Types

```ts
type QuarantineStatus = "quarantined" | "unsealed" | "unknown"

export interface AppInfo {
  name: string            // e.g. "Firefox.app"
  path: string            // e.g. "/Applications/Firefox.app"
  status: QuarantineStatus
  error?: string          // populated when status is "unknown"
}

export interface UnsealResult {
  app: AppInfo
  success: boolean
  error?: string
}
```

**Status semantics:**

| Status         | Meaning                                                        | TUI behavior                |
|---------------|----------------------------------------------------------------|-----------------------------|
| `quarantined` | Has quarantine xattr AND Gatekeeper rejects (`spctl` exit ≠ 0) | Yellow, selectable          |
| `unsealed`    | No quarantine xattr, OR Gatekeeper allows (`spctl` exit 0)     | Green ✓, info only          |
| `unknown`     | xattr/spctl command failed (permission/timeout)                | Red ?, info only + warning  |

### 2. `src/scanner.ts` — App Discovery & Quarantine Detection

**Exports:**

- `listApps(exec: Executor, dir?: string): Promise<AppInfo[]>`
  - Default dir: `/Applications`
  - Lists all `*.app` bundles (top-level only, no recursion)
  - For each app, runs `xattr -l <path>` and checks for `com.apple.quarantine`
  - Returns `AppInfo[]` sorted alphabetically by name

**Detection logic:**

```
xattr -l /Applications/SomeApp.app
  → output does NOT contain "com.apple.quarantine" → status: "unsealed"
  → output contains "com.apple.quarantine"         → run Gatekeeper check ↓

spctl --assess --type execute /Applications/SomeApp.app
  → exit 0  (signature valid, Gatekeeper allows)   → status: "unsealed"
  → exit ≠ 0 (Gatekeeper rejects)                  → status: "quarantined"

Either command fails (non-zero exit / timeout / exception) → status: "unknown", error: <stderr>
```

The `spctl` call is only made when the quarantine xattr is present, so non-quarantined apps incur zero extra overhead.

### 3. `src/unseal.ts` — Remove Quarantine Attribute

**Exports:**

- `unsealApps(apps: AppInfo[], exec: Executor): Promise<UnsealResult[]>`
  - For each app: `sudo xattr -rd com.apple.quarantine <path>`
  - Captures stdout/stderr, returns per-app success/failure
  - Does NOT abort on individual failure; collects all results

### 4. `src/sudo.ts` — Privilege Check

**Exports:**

- `checkSudo(exec: Executor): Promise<boolean>`
  - Runs `sudo -n true` to test if passwordless sudo is available
  - If fails, runs `sudo -v` to prompt password entry
  - Returns `true` if sudo is available, `false` otherwise

### 5. `src/prompt.ts` — TUI Multi-Select + Confirmation

**Library choice: `@inquirer/prompts`**

| Criteria       | @inquirer/prompts | enquirer  | prompts   |
|---------------|-------------------|-----------|-----------|
| ESM support   | Native            | CJS only  | CJS only  |
| Maintenance   | Active            | Stale     | Stale     |
| Checkbox      | Built-in          | Built-in  | Built-in  |
| Bundle size   | Small (modular)   | Medium    | Small     |
| TypeScript    | Native            | @types    | @types    |

**Color: `chalk`**

**Exports:**

- `selectApps(quarantined: AppInfo[], unsealed: AppInfo[], unknown: AppInfo[]): Promise<AppInfo[]>`
  - Display three sections:
    1. **Upper section** (info only): Already unsealed apps — shown in green ✓, not selectable
    2. **Middle section** (warning): Unknown status apps — shown in red ?, not selectable, with error detail
    3. **Lower section** (checkbox): Quarantined apps — shown in yellow, **all checked by default** (opt-out via space; Enter confirms and immediately triggers the sudo prompt)
  - Returns user-selected `AppInfo[]` (empty array = user unchecked everything = cancel)

Pressing Enter on the checkbox is itself the confirmation — there is no separate `confirmUnseal()` step. Ctrl+C / Esc throw `ExitPromptError`, which `run()` catches to print a "Cancelled" message and exit 0.

### 6. `src/index.ts` — CLI Entry Point

**CLI flags:**

| Flag          | Behavior                                         |
|--------------|--------------------------------------------------|
| `--help`     | Print usage text, exit 0                         |
| `--version`  | Print version from `package.json`, exit 0        |
| (no flags)   | Run interactive scan + unseal flow               |

**Non-interactive detection:**

When stdin is not a TTY (piped / closed), skip interactive prompts and exit 0 with a message:
`"Interactive terminal required. Run unseal in a terminal."`

**Testability seam:**

All system command execution goes through an injectable `Executor` function. Production wraps `child_process.execFile` (see [§ 2 exec.ts](#2-srcexects--command-executor-abstraction) below). Tests and the dev-only debug harness (`src/debug.ts`, run via `bun run debug [scenario]`) supply their own `Executor` — and, where scenario coverage matters more than executor behaviour, their own `scanApps` — through `run(options)`:

```ts
// src/exec.ts — command executor abstraction
export interface ExecResult { stdout: string; stderr: string; exitCode: number }
export type Executor = (cmd: string, args: string[]) => Promise<ExecResult>

export function createExecutor(): Executor {
  // Wraps child_process.execFile; see src/exec.ts for the ENOENT / null-buffer
  // normalisation rules that guarantee exitCode is a finite integer.
}
```

```ts
// src/index.ts — run() accepts overrides for both seams
export interface RunOptions {
  exec?: Executor;
  scanApps?: (exec: Executor, onProgress: (name: string) => void) => Promise<AppInfo[]>;
  // …args, isTTY
}
```

`scanner.ts`, `unseal.ts`, and `sudo.ts` all receive their `Executor` via dependency injection from `run()`.

**Main flow:**

```
0. Parse CLI flags (--help, --version)
   → handle and exit if present

1. Check stdin is TTY
   → if not → print message + exit 0

2. scanner.listApps(exec)
   → split into: quarantined[] + unsealed[] + unknown[]

3. If unknown is not empty
   → print warning: N app(s) could not be read (in red)

4. If quarantined is empty
   → print "All apps are already unsealed ✓" in green
   → exit 0

5. prompt.selectApps(quarantined, unsealed, unknown)
   → user multi-selects from quarantined apps (defaults to all checked)
   → Enter = confirm and proceed; empty selection or Ctrl+C = exit 0

6. sudo.checkSudo(exec)
   → if fails → print error + exit 1

7. unseal.unsealApps(selected, exec)
   → print results: green ✓ for success, red ✗ for failure
```

---

## Dependencies

### Runtime

| Package           | Purpose                      |
|-------------------|------------------------------|
| `@inquirer/prompts` | TUI checkbox + confirm     |
| `chalk`           | Terminal colors              |

### Dev

| Package                | Purpose                                  |
|------------------------|------------------------------------------|
| `@biomejs/biome`       | Linting, formatting, import organization |
| `typescript`           | Type checking                            |
| `@types/node`          | Node type definitions                    |
| `vitest`               | Test runner                              |
| `@vitest/coverage-v8`  | Coverage provider (V8)                   |
| `husky`                | Git hooks (pre-commit / pre-push gates)  |

### Runtime & Test

- **Bun** — runtime, test runner, bundler

---

## Build & Publish

- **Dev runtime**: Bun
- **Build**: `bun build src/index.ts --target=node --outdir=dist`
- **Output**: Node-compatible ESM bundle in `dist/`
- **Publish**: `npm publish` — requires Node `^20.19 || ^22.13 || >=24` (driven by `@inquirer/prompts@8` engines floor)

**package.json key fields:**

```json
{
  "name": "unseal",
  "version": "0.1.0",
  "type": "module",
  "bin": { "unseal": "./dist/index.js" },
  "files": ["dist"],
  "engines": { "node": "^20.19.0 || ^22.13.0 || >=24.0.0" }
}
```

---

## TUI Display Design

```
  Already unsealed:
    ✓ Chrome.app
    ✓ Firefox.app
    ✓ iTerm.app

  ⚠ Could not read status:
    ? CorruptedApp.app — permission denied
    ? WeirdApp.app — xattr timed out

  Quarantined (space to toggle, enter to unseal):
  ◉ SomeApp.app
  ◉ AnotherApp.app
  ◉ SketchyApp.app

  ↑/↓ navigate  ⎵ toggle  ↵ confirm & unseal
```

- Green `✓` for already-unsealed apps (info section, not interactive)
- Red `?` for unknown-status apps (warning section, not interactive, shows error)
- Yellow names for quarantined apps (checkbox section)
- Default: all **checked** — the safe path is "review, opt out of anything unfamiliar, hit Enter"

---

## Permission & Safety

1. **Explicit opt-in via checkbox**: quarantined apps start checked but the user must press Enter to commit. Space toggles individual items; unchecking everything or hitting Ctrl+C cancels without touching sudo.
   > ⚠ Only unseal apps from trusted sources.
   (warning printed above the checkbox, in red)
2. **Post-confirm sudo check**: `sudo -n true` → if fails, `sudo -v` to prompt password
   - sudo ticket is only opened after the user has fully committed to the operation
3. **Unknown status apps**: displayed as red `?` with error detail, never silently hidden
