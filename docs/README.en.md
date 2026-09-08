<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" alt="Unseal logo" />
</p>
<h1 align="center">unseal</h1>
<p align="center">Check macOS app quarantine status and interactively select apps for batch attribute removal.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/unseal">npm</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Unseal is a macOS CLI for apps whose source you trust but which still carry the `com.apple.quarantine` attribute. It scans `/Applications`, uses `xattr` and `spctl` results to identify candidates, and lets you select apps to process together.

Scanning covers only `.app` entries directly inside `/Applications`. After the quarantine attribute is removed, an app may still fail to open because of its signature, damaged files, or other system policies. The detection result does not establish that an app is safe.

## Features

| Task | Current behavior |
| --- | --- |
| Check status | Read extended attributes first; if quarantine is present, run `spctl --assess --type execute`. |
| Separate candidates from unknown results | Apps with the attribute and a nonzero system assessment are candidates. Attribute-read failures appear as unknown and cannot be selected. |
| Select apps | Show scan progress and an alphabetically sorted list; all candidates are selected by default. |
| Check privileges after selection | Check sudo access once selection is complete, allowing sudo to request authentication when needed. |
| Process a batch | Recursively remove the quarantine attribute from each selected app and its contents, continue after individual failures, and print results. |

The UI's `unsealed` status means either the attribute is absent or the system assessment succeeded. In the latter case, the attribute may still exist.

## Usage

Use macOS, an interactive terminal, and Node.js 24 LTS. The package also accepts the other Node.js versions listed in `package.json`. Attribute changes require sudo access.

```bash
npm install -g unseal
unseal
```

1. Wait for the scan, then review the app list and any unreadable entries.
2. Move with the arrow keys and toggle with space. All candidates start selected; keep only the apps you intend to process.
3. Enter confirms the operation and proceeds to privilege checks and attribute removal, without a second confirmation. Use Ctrl+C or clear every selection to exit.
4. Read the success or failure result for each app.

The actual modification is `sudo xattr -rd com.apple.quarantine <app>`. A batch with individual failures can currently return exit code 0, so use the per-app results to judge the outcome. A noninteractive invocation only prints a notice and exits.

```bash
unseal --help
unseal --version
```

## Development

Development uses Bun and the Node.js environment described above:

```bash
git clone https://github.com/nocoo/unseal.git
cd unseal
bun install --frozen-lockfile
bun run build
node dist/index.js --help
```

`bun run dev` starts the real scan and processing flow. For UI work, use scenarios with static app lists and simulated system commands:

```bash
bun run debug --list
bun run debug mixed
bun run debug with-failure
```

The core code is in `src/`: `scanner.ts` detects status, `prompt.ts` handles selection, `sudo.ts` checks privileges, `unseal.ts` removes the attribute, and `exec.ts` wraps subprocess execution.

## Tests

```bash
bun run test
bunx vitest run tests/exec.test.ts
```

The first command runs all unit and composed-flow tests, with scanning, selection, and modification mocked. The second runs the real subprocess round-trip tests on their own. Tests do not modify attributes on installed apps. Use `bun run debug` to check simulated interaction flows manually in a terminal.

## Stack

| Technology | Role |
| --- | --- |
| TypeScript / Node.js | CLI logic and published-package runtime |
| Bun | Dependencies, development runtime, and ESM bundling |
| Inquirer / chalk | Terminal selection and colors |
| xattr / spctl / sudo | macOS attributes, system assessment, and privileged operations |
| Vitest | Module, flow, and subprocess tests |

## Documentation

- [Documentation index](README.md)
- [Architecture and detection flow](01-architecture.md)
- [Logo usage](03-logo-usage.md)
- [Changelog](../CHANGELOG.md)

## License

[MIT](../LICENSE)
