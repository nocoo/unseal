# Changelog

## 0.2.0 — 2026-07-02

### Added

- **Debug scenario harness** — `bun run debug [scenario]` drives the full TUI against scripted in-memory app lists (mixed / all-quarantined / all-unsealed / with-unknown / with-failure / empty). Not shipped: `src/debug.ts` is a separate entry that `bun build` tree-shakes out of `dist/`.
- **Concurrent scanner** — `xattr` + `spctl` chains now run through a bounded worker pool (default 3). Wall-clock scan drops to roughly 1/3 on typical machines. Concurrency is configurable via `ScanOptions.concurrency`; the pool preserves per-app failure isolation and dispatch-order `onProgress` semantics.

### Changed

- **Default all quarantined apps to checked** — the multi-select opens with every quarantined app already selected; Enter proceeds with the full set unless the user unticks. Widened cursor↔circle spacing via a custom theme icon so the selection state is unambiguous.
- **Collapsed the CLI onto two alignment columns** — every non-inquirer line now sits at column 2 (matching inquirer body indent); only inquirer's question line uses column 0. All ✓/?/• bullets, section headers, warnings, and debug/help messages share the same vertical rule.
- **Removed the pre-scan `Y/n` confirmation** — launching `unseal` is itself the opt-in; Ctrl+C at any later step still bails cleanly.
- **Removed the second "Are you sure?" confirm before sudo** — the checkbox selection is the confirmation; Enter goes straight to the password prompt. If the user changes their mind at the password step, an empty password or Ctrl+C cancels.

### Removed

- **`UNSEAL_MOCK=1` flag and `src/mock-executor.ts`** — the new debug entry replaces this with cleaner isolation and richer scenario coverage.

### Fixed

- **CLI produces no output when installed via npm** (backported from 0.1.1) — kept documented here for completeness.

### Chore / Dependencies

- **TypeScript 5.9.3 → 6.0.3** — major bump, no code changes required.
- **Dev deps** — vitest & @vitest/coverage-v8 4.1.8 → 4.1.9; eslint 10.4.1 → 10.6.0; typescript-eslint 8.61.0 → 8.62.1; @types/node 22.19.21 → 26.1.0.
- `bun audit` and `osv-scanner` remain clean (zero advisories).

### Quality

- **59 tests** across 6 files (was 47), including a dedicated concurrency suite that asserts peak-in-flight caps, dispatch order, failure isolation under load, and per-app result mapping under interleaving.
- 100% line coverage; 96.55% branch coverage.

## 0.1.1 — 2026-03-31

### Fixed

- **CLI produces no output when installed via npm** — `isMainModule` detection failed because symlink path didn't match `import.meta.url`; now resolves symlinks with `realpathSync` before comparing

## 0.1.0 — 2026-03-31

Initial release.

### Features

- **Three-state quarantine detection** — Classify apps as `quarantined`, `unsealed`, or `unknown` via `xattr` inspection
- **Gatekeeper (spctl) check** — Filter out signed quarantined apps that macOS already trusts
- **Sudo privilege handling** — Detect existing root, prompt for elevation, fall back to per-app `sudo xattr`
- **TUI multi-select prompt** — Interactive three-section display (quarantined / unsealed / unknown) with batch selection
- **Scan confirmation prompt** — Ask before scanning with animated progress indicator
- **CLI flags** — `--help`, `--version`, `--path <dir>` for non-interactive use
- **Graceful Ctrl+C** — Clean cancellation without stack traces

### Quality

- 47 unit tests across 5 test files
- ESLint with typescript-eslint strict + stylistic (0 errors, 0 warnings)
- TypeScript strict mode with `tsc --noEmit` gate
- Husky pre-commit: tests + typecheck + lint
- Husky pre-push: gitleaks + osv-scanner (G2 security)
- GitHub Actions CI via `nocoo/ci` reusable workflow
