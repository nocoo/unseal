<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" alt="Unseal logo" />
</p>
<h1 align="center">unseal</h1>
<p align="center">检查 macOS 应用的隔离状态，交互选择后批量移除隔离属性。</p>
<p align="center">
  <a href="https://www.npmjs.com/package/unseal">npm</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Unseal 是一个 macOS 命令行工具，用来处理已确认来源可信、但仍带有 `com.apple.quarantine` 属性的应用。它扫描 `/Applications`，结合 `xattr` 和 `spctl` 的结果列出候选应用，供你选择后统一操作。

扫描只覆盖 `/Applications` 第一层的 `.app` 条目。移除隔离属性后，应用仍可能因签名、文件损坏或其他系统策略无法打开；检测结果也不构成对应用安全性的判断。

## 功能

| 操作 | 当前行为 |
| --- | --- |
| 检查状态 | 先读取扩展属性；存在隔离属性时，再运行 `spctl --assess --type execute`。 |
| 区分候选与未知 | 有隔离属性且系统评估返回非零时列为候选；属性读取失败显示为 unknown，不提供勾选。 |
| 交互多选 | 显示扫描进度与按名称排序的列表，候选应用默认全部选中。 |
| 延后检查权限 | 完成选择后才检查 sudo 权限，需要时由 sudo 进行身份验证。 |
| 批量处理 | 逐个递归移除所选应用及其内容的隔离属性；某项失败后继续处理后续项目，并打印结果。 |

界面中的 `unsealed` 表示没有隔离属性，或系统评估返回成功；后一种情况下属性可能仍然存在。

## 使用

需要 macOS、交互式终端和 Node.js 24 LTS。包也接受 `package.json` 中列出的其他 Node.js 版本。执行修改时需要 sudo 权限。

```bash
npm install -g unseal
unseal
```

1. 等待扫描完成，检查应用列表与无法读取的项目。
2. 用方向键移动、空格切换勾选。候选项默认全选，请保留你确实要处理的应用。
3. 按回车即确认执行，随后进入权限检查和属性移除，没有第二次确认。Ctrl+C 或取消所有勾选可退出。
4. 阅读每个应用的成功或失败结果。

实际修改命令为 `sudo xattr -rd com.apple.quarantine <app>`。当前批量操作出现个别失败时仍可能返回退出码 0，应以逐应用结果为准。非交互环境只显示提示后退出。

```bash
unseal --help
unseal --version
```

## 开发

开发需要 Bun 和上述 Node.js 环境：

```bash
git clone https://github.com/nocoo/unseal.git
cd unseal
bun install --frozen-lockfile
bun run build
node dist/index.js --help
```

`bun run dev` 运行真实扫描与处理流程。调整交互界面时，可使用提供静态应用列表和模拟系统命令的场景：

```bash
bun run debug --list
bun run debug mixed
bun run debug with-failure
```

核心代码位于 `src/`：`scanner.ts` 检测状态，`prompt.ts` 提供选择界面，`sudo.ts` 检查权限，`unseal.ts` 执行属性移除，`exec.ts` 封装子进程。

## 测试

```bash
bun run test
bunx vitest run tests/exec.test.ts
```

第一条运行全部单元和流程组合测试，扫描、选择与修改使用模拟对象；第二条单独运行真实子进程往返测试。测试不会给本机应用修改属性。`bun run debug` 可在终端中人工检查模拟场景的交互流程。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| TypeScript / Node.js | CLI 逻辑与发布包运行环境 |
| Bun | 依赖管理、开发运行和 ESM 打包 |
| Inquirer / chalk | 终端多选与着色 |
| xattr / spctl / sudo | macOS 属性读取、系统评估与权限操作 |
| Vitest | 模块、流程与子进程测试 |

## 文档

- [文档索引](docs/README.md)
- [架构与检测流程](docs/01-architecture.md)
- [Logo 使用说明](docs/03-logo-usage.md)
- [版本记录](CHANGELOG.md)

## 许可证

[MIT](LICENSE)
