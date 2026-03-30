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
│   ├── exec.ts            # Command executor abstraction (prod + mock seam)
│   ├── mock-executor.ts   # Canned responses for UNSEAL_MOCK=1 mode
│   ├── scanner.ts         # Scan /Applications, detect quarantine status
│   ├── unseal.ts          # Remove quarantine attribute (xattr -rd)
│   ├── prompt.ts          # TUI multi-select prompt + confirmation
│   ├── sudo.ts            # sudo privilege check
│   └── types.ts           # Shared types
├── tests/
│   ├── scanner.test.ts
│   ├── unseal.test.ts
│   ├── prompt.test.ts
│   ├── sudo.test.ts
│   └── index.test.ts
├── docs/
│   ├── README.md          # Docs index
│   ├── 01-architecture.md # This file
│   └── 02-testing.md      # Testing strategy
├── package.json
├── tsconfig.json
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

| Status         | Meaning                                    | TUI behavior                |
|---------------|--------------------------------------------|-----------------------------|
| `quarantined` | Has `com.apple.quarantine` attribute       | Yellow, selectable          |
| `unsealed`    | No quarantine attribute                    | Green ✓, info only          |
| `unknown`     | xattr command failed (permission/timeout)  | Red ?, info only + warning  |

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
  → output contains "com.apple.quarantine" → status: "quarantined"
  → output does NOT contain it             → status: "unsealed"
  → command fails (non-zero exit / timeout) → status: "unknown", error: <stderr>
```

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
    3. **Lower section** (checkbox): Quarantined apps — shown in yellow, all unchecked by default
  - Returns user-selected `AppInfo[]`

- `confirmUnseal(selected: AppInfo[]): Promise<boolean>`
  - Shows warning text in red: "Do not unseal apps you don't recognize. Only unseal apps from trusted sources."
  - Lists selected apps in yellow
  - Asks for explicit Y/N confirmation
  - Returns `true` if confirmed

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

All system command execution goes through an injectable `exec` function. In production, this calls `Bun.spawn` / `child_process.exec`. When `UNSEAL_MOCK=1` is set, the CLI loads a mock executor from `src/mock-executor.ts` that returns canned responses. This seam is a first-class part of the architecture, not a test-only hack:

```ts
// src/exec.ts — command executor abstraction
export type ExecResult = { stdout: string; stderr: string; exitCode: number }
export type Executor = (cmd: string, args: string[]) => Promise<ExecResult>

export function createExecutor(): Executor {
  if (process.env.UNSEAL_MOCK === "1") {
    return createMockExecutor()
  }
  return createRealExecutor()
}
```

This is used by `scanner.ts`, `unseal.ts`, and `sudo.ts` via dependency injection.

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
   → user multi-selects from quarantined apps
   → if selection empty → exit 0

6. prompt.confirmUnseal(selected)
   → show warning + selected app list
   → if declined → exit 0

7. sudo.checkSudo(exec)
   → if fails → print error + exit 1

8. unseal.unsealApps(selected, exec)
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

| Package           | Purpose                      |
|-------------------|------------------------------|
| `typescript`      | Type checking                |
| `@types/node`     | Node type definitions        |

### Runtime & Test

- **Bun** — runtime, test runner, bundler

---

## Build & Publish

- **Dev runtime**: Bun
- **Build**: `bun build src/index.ts --target=node --outdir=dist`
- **Output**: Node-compatible ESM bundle in `dist/`
- **Publish**: `npm publish` — works on Node 18+

**package.json key fields:**

```json
{
  "name": "unseal",
  "version": "0.1.0",
  "type": "module",
  "bin": { "unseal": "./dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" }
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

  Quarantined (select to unseal):
  ○ SomeApp.app
  ○ AnotherApp.app
  ○ SketchyApp.app

  ↑/↓ navigate  ⎵ toggle  ↵ confirm
```

- Green `✓` for already-unsealed apps (info section, not interactive)
- Red `?` for unknown-status apps (warning section, not interactive, shows error)
- Yellow names for quarantined apps (checkbox section)
- Default: all unchecked

---

## Permission & Safety

1. **Double confirmation** (before any privilege escalation):
   - First: user selects apps via checkbox (explicit opt-in)
   - Second: confirm dialog with warning:
     > ⚠️ Warning: Do not unseal apps you don't recognize. Only unseal apps from trusted sources.
     > Are you sure you want to unseal the following N app(s)?
   - Selected apps shown in yellow before final confirmation
2. **Post-confirm sudo check**: `sudo -n true` → if fails, `sudo -v` to prompt password
   - sudo ticket is only opened after the user has fully committed to the operation
3. **Unknown status apps**: displayed as red `?` with error detail, never silently hidden
