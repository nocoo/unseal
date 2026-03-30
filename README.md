# unseal

Scan macOS `/Applications` for quarantined apps and batch-remove the quarantine attribute.

## This is what

macOS Gatekeeper uses the `com.apple.quarantine` extended attribute to flag apps downloaded from the internet. `unseal` scans your `/Applications` folder, shows quarantine status for every app, and lets you batch-remove the attribute from selected ones.

## Features

**Three-state detection** — distinguishes quarantined, unsealed, and unreadable apps
**Interactive multi-select** — checkbox UI to pick which apps to unseal
**Double confirmation** — warning dialog before any system modification
**Post-confirm sudo** — privilege escalation only after you fully commit

## Install

```bash
npm install -g unseal
```

## Usage

```bash
unseal              # Interactive scan + unseal flow
unseal --help       # Show usage
unseal --version    # Show version
```

## How it works

```
1. Scan /Applications for .app bundles
2. Check com.apple.quarantine via xattr
3. Display: ✓ unsealed (green) | ? unknown (red) | ○ quarantined (yellow)
4. User selects quarantined apps → confirm → sudo → remove attribute
```

## Project structure

```
src/
├── index.ts          # CLI entry point
├── exec.ts           # Command executor abstraction
├── mock-executor.ts  # Canned responses (UNSEAL_MOCK=1)
├── scanner.ts        # App discovery + quarantine detection
├── unseal.ts         # Remove quarantine attribute
├── prompt.ts         # TUI multi-select + confirmation
├── sudo.ts           # Privilege check
└── types.ts          # Shared types
```

## Tech stack

| Layer     | Technology                                                      |
|----------|-----------------------------------------------------------------|
| Language | [TypeScript](https://www.typescriptlang.org/) (strict)          |
| Runtime  | [Bun](https://bun.sh/) (dev, test, build)                      |
| TUI      | [@inquirer/prompts](https://npm.im/@inquirer/prompts) (checkbox + confirm) |
| Color    | [chalk](https://npm.im/chalk)                                  |
| Target   | Node.js ≥ 18 (ESM bundle via `bun build --target=node`)        |

## Development

```bash
bun install          # Install dependencies
bun run dev          # Run in development
bun run build        # Build for npm
```

| Command              | Description                   |
|---------------------|-------------------------------|
| `bun test`          | Run all tests                 |
| `bun test --coverage` | Run tests with coverage     |
| `bun run typecheck` | TypeScript strict check       |

## Testing

| Layer | Content                        | Trigger      |
|-------|--------------------------------|-------------|
| L1    | Unit tests (33 cases, 100%)    | pre-commit  |
| G1    | tsc --noEmit (strict)          | pre-commit  |
| L2    | Integration + smoke tests      | pre-push    |
| G2    | gitleaks + osv-scanner         | pre-push    |

## Documentation

| #  | Document                                        | Description        |
|----|-------------------------------------------------|--------------------|
| 01 | [Architecture](docs/01-architecture.md)         | System design      |
| 02 | [Testing Strategy](docs/02-testing.md)          | Testing & commits  |

## License

[MIT](LICENSE) © 2026