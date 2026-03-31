# Changelog

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
