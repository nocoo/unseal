<h1 align="center">unseal</h1>

<p align="center"><strong>扫描 macOS 隔离区应用，一键批量解除封印</strong><br>检测隔离 · 交互选择 · 批量解封</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue" alt="platform">
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6" alt="language">
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6" alt="runtime">
  <img src="https://img.shields.io/badge/tests-47%20passed-brightgreen" alt="tests">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
</p>

---

## 这是什么

macOS Gatekeeper 通过 `com.apple.quarantine` 扩展属性标记从互联网下载的应用。`unseal` 扫描 `/Applications` 目录，检测每个 app 的隔离状态，并提供交互式界面批量移除隔离属性。

对于已签名但仍保留隔离属性的应用，`unseal` 会额外调用 `spctl` 进行 Gatekeeper 评估，区分"真正被隔离"和"虽有属性但已被系统信任"两种情况，避免误报。

## 功能

- **三态检测** — 区分隔离（quarantined）、已解封（unsealed）和不可读（unknown）三种状态
- **Gatekeeper 二次验证** — 对有隔离属性的应用额外调用 `spctl --assess`，已签名应用不会被误报
- **扫描确认** — 扫描前提示确认，扫描中实时显示当前正在检测的应用名
- **交互式多选** — checkbox UI 选择需要解封的应用
- **双重确认** — 执行系统修改前显示警告对话框
- **延迟提权** — 仅在用户完全确认后才请求 sudo 权限

## 安装

```bash
npm install -g unseal
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `unseal` | 交互式扫描 + 解封流程 |
| `unseal --help` | 显示帮助信息 |
| `unseal --version` | 显示版本号 |

## 项目结构

```
src/
├── index.ts          # CLI 入口，流程编排
├── exec.ts           # 命令执行器抽象
├── mock-executor.ts  # 模拟响应（UNSEAL_MOCK=1）
├── scanner.ts        # 应用发现 + 隔离检测
├── prompt.ts         # TUI 多选 + 确认交互
├── unseal.ts         # 移除隔离属性
├── sudo.ts           # 权限检查
└── types.ts          # 共享类型定义
tests/
├── scanner.test.ts   # 扫描器单元测试
├── prompt.test.ts    # 交互提示测试
├── unseal.test.ts    # 解封逻辑测试
├── sudo.test.ts      # sudo 检测测试
└── index.test.ts     # CLI 集成测试
```

## 技术栈

| 层 | 技术 |
|----|------|
| 语言 | [TypeScript](https://www.typescriptlang.org/)（strict 模式） |
| 运行时 | [Bun](https://bun.sh/)（开发、测试、构建） |
| TUI | [@inquirer/prompts](https://npm.im/@inquirer/prompts)（checkbox + confirm） |
| 终端着色 | [chalk](https://npm.im/chalk) |
| 目标平台 | Node.js >= 18（ESM bundle，`bun build --target=node`） |

## 开发

**环境要求**：Bun >= 1.0

```bash
bun install          # 安装依赖
bun run dev          # 开发模式运行
bun run build        # 构建 npm 发布包
```

| 命令 | 说明 |
|------|------|
| `bun run test` | 运行全部测试 |
| `bun run test:coverage` | 运行测试并生成覆盖率报告 |
| `bun run typecheck` | TypeScript 严格类型检查 |

## 测试

| 层 | 内容 | 触发时机 |
|----|------|----------|
| L1 | 单元测试（47 cases，100%） | pre-commit |
| G1 | `tsc --noEmit`（strict） | pre-commit |
| L2 | 集成 + 冒烟测试 | pre-push |
| G2 | gitleaks + osv-scanner | pre-push |

```bash
bun run test          # 运行全部 47 个测试
bun run typecheck     # 类型检查
```

## 文档

| # | 文档 | 说明 |
|---|------|------|
| 01 | [Architecture](docs/01-architecture.md) | 系统设计 |
| 02 | [Testing Strategy](docs/02-testing.md) | 测试策略与提交规范 |

## License

[MIT](LICENSE) © 2026