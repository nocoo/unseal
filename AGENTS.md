# unseal

macOS Node CLI (`dist/index.js`, built with Bun from TypeScript) that scans `/Applications` for `com.apple.quarantine` and batch-removes it after interactive confirmation.
Docs: [README.md](README.md) · [Architecture](docs/01-architecture.md) · [Testing](docs/02-testing.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with Bun (CI pins `1.3.11`) and Node 24 LTS (`package.json` allows `^22.13.0 || >=24.0.0`). No `.env` files or live credentials are required.

```sh
bun install --frozen-lockfile
bun run typecheck       # S1: tsc tsconfig.json + tsconfig.test.json
bun run lint            # S2: biome check --error-on-warnings (0 errors, 0 warnings)
bun run build           # B1: bun build src/index.ts --target=node --outdir=dist
bun run test:coverage   # L1: vitest --coverage (>= 98% across 4 metrics)
bun run test            # vitest run (same L1 suite; not subprocess L3)
bun run debug           # manual interactive scenario harness (mocked exec/scan)
```

## Invariants

- Scan only first-level `/Applications/*.app`; removing `com.apple.quarantine` is not a security verdict and Gatekeeper or code signatures can still block launch.
- Destructive execution requires an interactive TTY; piped or non-TTY stdin must exit safely without prompting or modifying apps.
- Pressing Enter in the checkbox prompt is the sole confirmation; `sudo` (`sudo -n true` -> `sudo -v`) is checked only after confirmation, with no second prompt.
- Tests and CI must mock `xattr`/`spctl`/`sudo` via injected `Executor` and never run interactive `unseal` against real `/Applications`; macOS-only logic still runs mocked unit tests on Linux CI.
- No local servers or Worker ports exist; destructive `unseal` is operator-only on a real Mac.
- Authoritative version is `package.json` `"version"` (`1.2.3`, displayed as `v1.2.3`).
- Keep Vitest coverage thresholds at **98%** across statements, branches, functions, and lines (`vitest.config.ts`); never lower to 95%.
- Manual `npm publish` requires explicit authorization, npm maintainer auth, 98% coverage, clean lint, and a PTY; see [Architecture](docs/01-architecture.md) and [Retrospective.md](Retrospective.md).

## Quality & Local Gates

Follows `system1-quality`; CI slot definitions and pinned `base-ci` (`v2026.24`) revision live in `.github/workflows/quality-slots.yml` (called by `.github/workflows/pipeline.yml`; `quality / Z1: Gate` required on `main`), with no automated CD workflow (manual local `npm publish` only). Status vocabulary: `enforced`, `planned`, `manual`, `N/A`. This file is the contract—raise hooks/CI to match rather than weakening rules.

- **Coverage boundary**: `L1 Unit` enforces `>= 98%` (statements/branches/functions/lines) on `src/**/*.ts` excluding `src/types.ts` and `src/debug.ts`, with no skipped or focused tests.
- **Exceptions / gaps**: `L2 Runtime` is `N/A` (not a Worker/platform-bound runtime); `L4 E2E` is `N/A` (macOS CLI without browser UI).
- **Planned slots**: `L3 Integration` is `planned` (CLI subprocess smoke `--help`/`--version`/TTY per [docs/02-testing.md](docs/02-testing.md)); `P1 Package` is `planned` (`ci:package`/`publint`/`attw` unwired).
- **Local hooks**: installed via `bun run prepare` (`.husky/`, check-only, `--no-verify` forbidden).
- **pre-commit**: `S1`/`S2`/`L1` on a `git checkout-index` snapshot (symlinked `node_modules`, staged lockfile parity, optional `UNSEAL_L1_TIMEOUT_SEC`); target `<30s` (unmeasured).
- **pre-push**: `L1` (`bun run test`), `G1` (`gitleaks protect --staged`), `G2` (`osv-scanner --lockfile=bun.lock` + `osv-scanner.toml`) on worktree (planned: stdin refs); target `<3min` (unmeasured).

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests/hooks.
