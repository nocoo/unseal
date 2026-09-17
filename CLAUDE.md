# unseal

macOS CLI: scan `/Applications` for `com.apple.quarantine` and batch-remove it after confirmation.
Profile: cli-library
Direction: [docs/01-architecture.md](docs/01-architecture.md). Frameworks must not rewrite this file.

## Sources of Truth

This file is the **contract**. Hooks, CI, and config are **enforcement**. If they disagree, that is a failure — raise enforcement to match this file; never lower the contract to a weaker hook.

| Fact | Where |
|---|---|
| Agent handbook | this file |
| Human docs | README.md, `docs/NN-*.md` |
| Version | `package.json` `"version"` as `1.2.3`, display `v1.2.3` |
| Enforcement | `.husky/*`, `vitest.config.ts` (98%), CI |
| Machine rules | global `AGENTS.md`, `rules/git-commit.md` |
| Accidents | [Retrospective.md](Retrospective.md) |
| Env files | none |

## Project Invariants

- Scan only first-level `/Applications/*.app`. Removing quarantine is not a security verdict; Gatekeeper/signature can still block.
- Enter needs an interactive TTY. Piped stdin must refuse the destructive path.
- Sudo is checked only after the user confirms the selection. There is no second confirm.
- Tests must mock `xattr`/`spctl`/`sudo` and must never mutate real applications.
- macOS-only behavior. Linux CI still runs unit tests with mocked exec.

## Stack / Layout

| Component | Choice |
|---|---|
| Language | TypeScript |
| Package manager | Bun |
| Runtime | Node CLI (`bun build` → `dist/`) |
| Lint | Biome `--error-on-warnings` |
| Tests | Vitest `tests/**/*.test.ts`, coverage **98%** four metrics (stricter than 95%) |
| Data | none |

```
src/{index,scanner,unseal,sudo,prompt,exec}.ts
tests/  docs/
```

## Commands

```bash
bun install
bun run typecheck           # tsc project + tsconfig.test.json
bun run lint                # biome check --error-on-warnings
bun run build               # bun build src/index.ts --target=node --outdir=dist
bun run test:coverage       # vitest --coverage (thresholds 98)
bun run test                # vitest run (same suite; not subprocess L2)
bun run debug               # interactive scenario harness (manual)
```

## Verification

Status: `enforced` | `planned` | `manual` | `N/A`.
6DQ = L1/L2/L3 + G1/G2 + D1. Preserve the 98% bar; do not lower it to 95%. CLI process E2E is not N/A just because there is no browser.

| Change | Proof | Status | Evidence |
|---|---|---|---|
| Logic | L1 Vitest statements/branches/functions/lines each ≥ **98%** | enforced | `vitest.config.ts`; pre-commit `test:coverage`; CI `bun run test:coverage` |
| API / schema | L2 packed CLI subprocess (`--help`/`--version`/TTY) | planned | [docs/02-testing.md](docs/02-testing.md) subprocess smoke **not implemented**; pre-push `bun run test` repeats L1 |
| UI path | L3 process-level E2E of `dist/index.js` | planned | no browser; shipped-binary E2E still required |
| Types / lint | G1 0 error, 0 warning | enforced | pre-commit typecheck+lint; CI |
| Deps / secrets | G2 osv-scanner + gitleaks; missing binary fails | enforced | pre-push `gitleaks protect --staged` + `osv-scanner --lockfile=bun.lock`; CI quality.yml default security |
| Test isolation | D1 never touch real `/Applications` | enforced | unit tests inject Executor mocks; no durable DB (`N/A` for SQLite). Do not run `unseal` unmocked in CI |
| Bundler output | `bun run build` | planned | not in hooks |
| Docs | docs/01–02 if CLI changed | manual | human review |
| Release | npm `unseal` | planned | CHANGELOG; no publish workflow in-repo |

| Hook | Verifies | Budget | Runs |
|---|---|---|---|
| pre-commit | working-tree `test:coverage`, typecheck, lint (not index snapshot) | target <30s (unmeasured) | L1 + G1 |
| pre-push | working-tree `bun run test`; `gitleaks protect --staged`; osv on `bun.lock` (not stdin refs) | target <3min (unmeasured) | G2; L2 label is inaccurate today |

Target: index-snapshot G1+L1; stdin-ref L2+G2. Check-only; `--no-verify` forbidden.

## Resources / Isolation

No Worker ports. Destructive `unseal` is operator-only on a real Mac.

## Operations / Release

- Entry: `npm publish` of `unseal` (manual)
- Auth: npm maintainers; sudo on the operator Mac
- Before ship: 98% coverage + lint
- Runbook: [docs/01-architecture.md](docs/01-architecture.md)

## Retrospective

| Kind | Where |
|---|---|
| Accident narrative | [Retrospective.md](Retrospective.md) |
| Project-specific rule that will recur | one line here (cap ~10) |
| Cross-project lesson | nmem / global `AGENTS.md` / `rules/` |
| Deterministically checkable rule | hook or test, not prose |

- Never run the interactive unseal against `/Applications` from tests or CI.
- Keep coverage thresholds at 98%; 95% would be a regression.
