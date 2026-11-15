# unseal

macOS CLI: scan `/Applications` for `com.apple.quarantine` and batch-remove it after confirmation.
Profile: cli-library
Direction: [docs/01-architecture.md](docs/01-architecture.md). Frameworks must not rewrite this file.

## Sources of Truth

Maintain this root `AGENTS.md` as the only project handbook; do not create legacy aliases, imports or copies.

This file is the **contract**. Hooks, CI, and config are **enforcement**. If they disagree, that is a failure — raise enforcement to match this file; never lower the contract to a weaker hook.

| Fact           | Where                                                   |
| -------------- | ------------------------------------------------------- |
| Agent handbook | this file                                               |
| Human docs     | README.md, `docs/NN-*.md`                               |
| Version        | `package.json` `"version"` as `1.2.3`, display `v1.2.3` |
| Enforcement    | `.husky/*`, `vitest.config.ts` (98%), CI                |
| Machine rules  | global `AGENTS.md`, `rules/git-commit.md`               |
| Accidents      | [Retrospective.md](Retrospective.md)                    |
| Env files      | none                                                    |

## Project Invariants

- Scan only first-level `/Applications/*.app`. Removing quarantine is not a security verdict; Gatekeeper/signature can still block.
- Enter needs an interactive TTY. Piped stdin must refuse the destructive path.
- Sudo is checked only after the user confirms the selection. There is no second confirm.
- Tests must mock `xattr`/`spctl`/`sudo` and must never mutate real applications.
- macOS-only behavior. Linux CI still runs unit tests with mocked exec.

## Stack / Layout

| Component       | Choice                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| Language        | TypeScript                                                                     |
| Package manager | Bun                                                                            |
| Runtime         | Node CLI (`bun build` → `dist/`)                                               |
| Lint            | Biome `--error-on-warnings`                                                    |
| Tests           | Vitest `tests/**/*.test.ts`, coverage **98%** four metrics (stricter than 95%) |
| Data            | none                                                                           |

```
src/{index,scanner,unseal,sudo,prompt,exec}.ts
tests/  docs/
```

## Commands

Run from the repository root with Bun (CI pins 1.3.11) and Node 24 LTS, or another version supported by `package.json`. No live credentials are needed for tests.

```bash
bun install --frozen-lockfile
bun run typecheck           # tsc project + tsconfig.test.json
bun run lint                # biome check --error-on-warnings
bun run build               # bun build src/index.ts --target=node --outdir=dist
bun run test:coverage       # vitest --coverage (thresholds 98)
bun run test                # vitest run (same suite; not subprocess L2)
bun run debug               # interactive scenario harness (manual)
```

## Verification

Quality follows `system1-quality` (v1.3.0) with 12 canonical slots (`impl`, `todo`, `na`) and `nocoo/base-ci` v2026.15 (`777bbe4f9bacab8a91d8c01974480a6ee23d28e0`) in native mode (`quality-slots.yml`). Preserve the 98% coverage bar; do not lower it to 95%.

| Slot             | Proof                                                                               | Status            | Evidence                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| S1: Types        | Strict TypeScript (`bun run typecheck`)                                             | enforced (`impl`) | Pre-commit index snapshot & CI `s1-types`                                                                         |
| S2: Lint         | Biome check-only (`bun run lint`), zero errors/warnings                             | enforced (`impl`) | Pre-commit index snapshot & CI `s2-lint`                                                                          |
| S3: Workflow     | `actionlint` + 40-char SHA pinning                                                  | enforced (`impl`) | CI `s3-workflow`                                                                                                  |
| G1: Secrets      | Gitleaks scan                                                                       | enforced (`impl`) | Pre-push `gitleaks protect --staged` & CI `g1-secrets`                                                            |
| G2: Dependencies | `osv-scanner` (`osv-scanner.toml`, `bun.lock`)                                      | enforced (`impl`) | Pre-push & CI `g2-dependencies`                                                                                   |
| B1: Build        | `bun run build`                                                                     | enforced (`impl`) | CI `b1-build`                                                                                                     |
| L1: Unit         | Vitest statements/branches/functions/lines each ≥ **98%**, no skipped/focused tests | enforced (`impl`) | `vitest.config.ts`; pre-commit `test:coverage` & CI `l1-unit`                                                     |
| L2: Runtime      | Cloudflare Worker / workerd runtime                                                 | N/A (`na`)        | Not a Cloudflare Worker project                                                                                   |
| L3: Integration  | Packed CLI subprocess (`--help`/`--version`/TTY)                                    | planned (`todo`)  | [docs/02-testing.md](docs/02-testing.md) subprocess smoke **not implemented**; pre-push `bun run test` repeats L1 |
| L4: E2E          | Browser UI E2E                                                                      | N/A (`na`)        | macOS CLI without browser UI                                                                                      |
| P1: Package      | `ci:package` / `publint` / `attw`                                                   | planned (`todo`)  | `unseal` npm package gate not yet wired                                                                           |
| Z1: Gate         | Aggregate all `impl` slots & SHA consistency                                        | enforced (`impl`) | CI `z1-gate` (`quality / Z1: Gate`)                                                                               |

| Hook       | Verifies                                                                                           | Budget                    | Runs                 |
| ---------- | -------------------------------------------------------------------------------------------------- | ------------------------- | -------------------- |
| pre-commit | index-snapshot `git checkout-index` then typecheck, lint, `test:coverage` (symlink `node_modules`) | target <30s (unmeasured)  | S1, S2, L1 subchecks |
| pre-push   | working-tree `bun run test`; `gitleaks protect --staged`; osv on `bun.lock` (not stdin refs)       | target <3min (unmeasured) | L1, G1, G2           |

Pre-commit enforces index-snapshot L1; target stdin-ref G2 on pre-push. Check-only; `--no-verify` forbidden. CI runs `.github/workflows/ci.yml` -> `./.github/workflows/quality-slots.yml`, gated on `quality / Z1: Gate`.

## Resources / Isolation

No Worker ports. Destructive `unseal` is operator-only on a real Mac.

## Operations / Release

- Entry: `npm publish` of `unseal` (manual)
- Auth: npm maintainers; sudo on the operator Mac
- Before ship: 98% coverage + lint
- Runbook: [docs/01-architecture.md](docs/01-architecture.md)

## Retrospective

| Kind                                  | Where                                |
| ------------------------------------- | ------------------------------------ |
| Accident narrative                    | [Retrospective.md](Retrospective.md) |
| Project-specific rule that will recur | one line here (cap ~10)              |
| Cross-project lesson                  | nmem / global `AGENTS.md` / `rules/` |
| Deterministically checkable rule      | hook or test, not prose              |
- Never run the interactive unseal against `/Applications` from tests or CI.
- Keep coverage thresholds at 98%; 95% would be a regression.
