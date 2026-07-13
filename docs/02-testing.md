# 02 — Testing Strategy

## Overview

Target: **98% code coverage** (per project requirement).

Quality tier target: **Tier A** (L1 + L2 + G1).

Per the quality framework, **N/A dimensions count as achieved** for tier calculation:

- **L3 (BDD E2E)**: N/A — CLI tool, no GUI
- **D1 (Test Isolation)**: N/A — no database or remote storage

Effective Tier A checklist: L1 ✅ + L2 ✅ + G1 ✅ + D1 N/A(=✅) → **Tier A**

---

## L1 — Unit Tests (pre-commit)

### Coverage: ≥ 98%

| Test file                   | Module under test | Key scenarios                                                   |
|-----------------------------|-------------------|-----------------------------------------------------------------|
| `scanner.test.ts`           | `scanner.ts`      | Apps with quarantine attr, apps without, mixed list, empty dir, `.app` filter, sort order, xattr failure → unknown |
| `unseal.test.ts`            | `unseal.ts`       | Successful removal, permission denied, partial failure, empty input |
| `sudo.test.ts`              | `sudo.ts`         | Passwordless sudo available, sudo -v fallback, both fail         |
| `prompt.test.ts`            | `prompt.ts`       | Multi-select rendering, empty selection, confirmation accept/decline, display sections (unsealed/unknown/quarantined) |
| `index.test.ts`             | `index.ts`        | Full CLI flow with mocked modules, exit codes, edge cases (no quarantined, empty selection, sudo fail) |
| `exec.test.ts`              | `exec.ts`         | Real subprocess round-trip: success, non-zero exit, ENOENT-style spawn failure (stderr populated, finite exitCode) |
| `exec.branches.test.ts`     | `exec.ts`         | Mocked `execFile` callback: null buffers, missing `error.code`, string errno names (ENOENT), numeric-string codes |

### Mocking Strategy

All modules use `child_process.execFile` to run system commands (`xattr`, `spctl`, `sudo`). Tests mock the exec layer:

```ts
// Mock pattern: inject command executor
import { vi } from "vitest"

// scanner.ts accepts optional executor for testing
const mockExec = vi.fn(() => Promise.resolve({
  stdout: "com.apple.quarantine: ...",
  stderr: ""
}))
```

**Key principle**: No real `xattr` or `sudo` calls in tests. All system interactions are mocked.

### Test Cases Detail

#### scanner.test.ts

| Case                          | Input (mock)                      | Expected                         |
|-------------------------------|-----------------------------------|----------------------------------|
| All quarantined               | 3 apps, all have quarantine attr  | All `status: "quarantined"`      |
| None quarantined              | 3 apps, none have quarantine attr | All `status: "unsealed"`         |
| Mixed                         | 2 quarantined + 1 unsealed        | Correct split                    |
| Empty directory               | No `.app` entries                 | Empty array                      |
| Non-`.app` entries filtered   | Mix of `.app` and other files     | Only `.app` returned             |
| Alphabetical sort             | Unsorted input                    | Sorted by name                   |
| xattr command failure         | Command rejects                   | `status: "unknown"` + error msg  |
| Custom directory              | Custom path                       | Scans custom path                |

#### unseal.test.ts

| Case                          | Input (mock)                      | Expected                         |
|-------------------------------|-----------------------------------|----------------------------------|
| Single app success            | xattr -rd succeeds                | `{ success: true }`              |
| Single app failure            | xattr -rd fails (permission)      | `{ success: false, error: ... }` |
| Multiple apps, all succeed    | 3 apps, all succeed               | 3 success results                |
| Multiple apps, partial fail   | 2 succeed, 1 fails                | Mixed results                    |
| Empty input                   | Empty array                       | Empty array                      |

#### sudo.test.ts

| Case                          | Input (mock)                      | Expected                         |
|-------------------------------|-----------------------------------|----------------------------------|
| Passwordless sudo available   | `sudo -n true` exits 0            | `true`                           |
| Passwordless unavailable, -v works | `sudo -n true` fails, `-v` exits 0 | `true`                  |
| Both fail                     | Both commands fail                 | `false`                          |

#### prompt.test.ts

| Case                          | Input (mock)                      | Expected                         |
|-------------------------------|-----------------------------------|----------------------------------|
| User confirms with all defaults | Mock checkbox returns all 2 apps | Returns 2 apps                   |
| User unchecks everything      | Mock checkbox returns empty       | Returns empty (upstream treats as cancel) |
| Checkbox rendered with sane defaults | selectApps called with 2 quarantined apps | Choices carry `checked: true`; theme icons customised |
| Unknown-status apps shown as warning row | selectApps called with unknown-status app | Warning section printed above checkbox |

#### index.test.ts

| Case                          | Input (mock)                      | Expected                         |
|-------------------------------|-----------------------------------|----------------------------------|
| No quarantined apps           | Scanner returns all unsealed      | Prints "already unsealed", exits |
| User selects nothing          | Prompt returns empty              | Exits without sudo/unseal        |
| User declines confirmation    | Confirm returns false             | Exits without unseal             |
| Sudo check fails              | checkSudo returns false           | Prints error, exits              |
| Happy path                    | Select 2 → confirm → sudo ok     | Calls unsealApps with 2 apps     |
| Unknown status apps present   | Scanner returns some unknown      | Prints warning, still shows prompt |

---

## G1 — Static Analysis (pre-commit)

- **Biome**: `biome check --error-on-warnings` (recommended lint rules, formatting, import organization)
- **TypeScript**: `tsc --noEmit` (strict: true)
- **0 error, 0 warning** policy

---

## L2 — Integration Tests (pre-push)

Two layers: cross-module pipeline tests + subprocess-level smoke tests.

### Cross-module pipeline

| Case                          | Description                                                |
|-------------------------------|------------------------------------------------------------|
| Full flow: scan → filter      | `listApps()` returns correct three-way split (quarantined/unsealed/unknown) |
| Full flow: unseal pipeline    | Selected apps → confirm → sudo check → unseal → results   |

These tests mock the command executor but verify cross-module wiring.

### Subprocess smoke tests

> **Status: not yet implemented.** The cases below are limited to what a real subprocess can observe without in-process seams — the `Executor` / `scanApps` overrides on `run()` are function values and cannot be forwarded to `dist/index.js`, so scenarios that need a scripted executor stay on the unit-test side (mocked `run()` in `tests/index.test.ts`) or on the interactive side (`bun run debug [scenario]`).

Spawn the built CLI binary as a child process to verify the CLI flags and non-interactive handling defined in [01-architecture.md § CLI Entry Point](01-architecture.md#6-srcindexts--cli-entry-point):

| Case                              | Method                                           | Asserts                                           |
|-----------------------------------|--------------------------------------------------|---------------------------------------------------|
| Non-interactive (piped stdin)     | `Bun.spawn(["node", "dist/index.js"], { stdin: "pipe" })` and immediately close stdin | stdout contains "Interactive terminal required", exit code 0 |
| `--help` flag                     | `Bun.spawn(["node", "dist/index.js", "--help"])` | stdout contains usage text, exit code 0           |
| `--version` flag                  | `Bun.spawn(["node", "dist/index.js", "--version"])` | stdout matches package.json version            |

Cases that need a scripted `Executor` (e.g. "no quarantined apps → exit 0", failure summaries, sudo denial) are covered by `tests/index.test.ts` — which imports `run()` and injects the seams directly — plus manual runs of `bun run debug`. There is no plan to smuggle a debug executor into the shipped bundle to enable subprocess coverage of those paths.

**Design rationale**: The subprocess suite exists to prove the bin wrapper, TTY detection, and flag parsing still work end-to-end after `bun build`. It does not replace unit-level coverage of `run()`'s conditional branches.

---

## G2 — Security (pre-push)

- **gitleaks**: Secrets detection (always required)
- **osv-scanner**: Dependency vulnerability scan on `bun.lock`

---

## Hook Mapping (husky)

| Automation   | Runs                                      |
|-------------|-------------------------------------------|
| pre-commit  | L1 + G1 (coverage, Biome, TypeScript)     |
| pre-push    | L2 + G2                                   |
| GitHub Actions | L1 + G1 + G2 (reusable quality workflow) |

---

## Atomic Commits Plan

| #  | Commit                              | Files                                           |
|----|-------------------------------------|--------------------------------------------------|
| 1  | Initialize project scaffold         | `package.json`, `tsconfig.json`, `.gitignore`    |
| 2  | Add shared types + executor abstraction | `src/types.ts`, `src/exec.ts`                    |
| 3  | Implement scanner + tests           | `src/scanner.ts`, `tests/scanner.test.ts`        |
| 4  | Implement sudo check + tests        | `src/sudo.ts`, `tests/sudo.test.ts`              |
| 5  | Implement unseal + tests            | `src/unseal.ts`, `tests/unseal.test.ts`          |
| 6  | Implement TUI prompt + tests        | `src/prompt.ts`, `tests/prompt.test.ts`          |
| 7  | Implement CLI entry point + tests   | `src/index.ts`, `tests/index.test.ts`            |
| 8  | Add build script + verify npm compat | `package.json` scripts                          |
| 9  | Setup husky hooks (L1+G1, L2+G2)   | `.husky/`, `package.json`                        |
| 10 | Update README + docs index          | `README.md`, `docs/README.md`                    |
