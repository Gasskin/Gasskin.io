# PixAI Tauri

PixAI Tauri 是一个基于 Tauri 2 重建的桌面图片生成工作台。它保留 PixAI 的多会话生图、参考图、图库和 Codex 自动化工作流，但当前仓库是独立的 Tauri 实现，不再沿用旧 Electron 项目的运行时、数据目录或打包方式。

当前版本号由 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 共同维护。

## 当前能力

- React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui 前端工作台。
- Tauri 2 桌面壳，支持系统托盘、系统通知、文件保存对话框、应用更新和本地文件打开。
- OpenAI-compatible Provider 管理，支持图片生成 Provider 和提示词助手 Provider 分开选择。
- 图片生成接口支持 `/v1/images/generations`、`/v1/images/edits` 和 `/v1/responses`。
- 多会话工作区：每个会话保存 prompt 草稿、模型、比例、尺寸、质量、数量、高级参数和参考图。
- 参考图工作流：上传参考图、从历史图加入参考、预览参考图、文生图 / 图生图自动切换。
- 本地历史与图库：搜索、排序、收藏、删除、下载、批量操作、参数回填和重新编辑。
- 提示词库与提示词助手：模板管理、灵感生成和提示词丰富。
- 全局设置：常规、通知、服务、扩展和应用更新集中管理。
- Codex Bridge：桌面应用运行时提供本机 HTTP bridge，方便 Codex 或本机脚本自动调用 PixAI。

## 参考项目

本仓库整理自 PixAI / PixAI-Codex 的产品思路和交互经验，但不是旧仓库的原地迁移。

- 原始参考项目：[fengxinzi-mulan/PixAI](https://github.com/fengxinzi-mulan/PixAI)
- Electron + Codex Bridge 参考版本：`PixAI-Codex`
- 当前项目：`PixAI-Tauri`，使用 Tauri 2 重建桌面壳、数据边界、更新系统和前端 UI。

开发工作区里可能存在 `.omx/reference/PixAI-Codex/` 这样的本地参考快照。它只用于对照旧实现，不是当前项目的运行依赖，也不会随 Tauri 应用发布。

## 环境要求

- Node.js 22 或兼容版本
- pnpm 10.26.2
- Rust stable toolchain
- Tauri 2 所需系统依赖
- Windows 桌面运行时需要 WebView2
- 一个 OpenAI-compatible 图片生成服务和 API Key

安装依赖：

```bash
pnpm install
```

启动前端开发服务：

```bash
pnpm dev
```

启动 Tauri 桌面开发环境：

```bash
pnpm dev:client
```

`pnpm dev:client` 使用 `src-tauri/tauri.dev.conf.json`，产品名是 `PixAI Dev`，应用标识是 `com.fingercaster.pixai.tauri.dev`。它可以和已经安装并打开的正式 PixAI 客户端同时运行，适合真实客户端测试。`pnpm tauri dev` 仍使用正式标识，已安装客户端运行时可能触发单实例冲突。

## 常用命令

```bash
pnpm dev                 # 启动 Vite 前端开发服务
pnpm dev:client          # 启动可与已安装 PixAI 共存的 Tauri 测试客户端
pnpm tauri dev           # 使用正式标识启动 Tauri，已安装客户端运行时可能冲突
pnpm test                # 运行 Vitest 测试
pnpm check               # TypeScript 检查 + 测试
pnpm build               # TypeScript 检查 + 前端生产构建
pnpm dist                # 构建当前平台 Tauri 安装包
pnpm codex -- health     # 检查 Codex Bridge 是否可用
```

Tauri 安装包输出在：

```text
src-tauri/target/release/bundle/
```

前端构建输出在：

```text
dist/
```

## Provider 配置

应用默认不提交任何可用 Provider 或 API Key。首次启动后，在「全局设置 -> 服务」里添加 Provider：

- 类型：`openai-compatible`
- Base URL：例如 `https://api.openai.com` 或你的兼容服务地址
- API Key：写入本机安全存储；不可用时会降级到应用数据目录并在界面提示
- 图片模型：默认建议 `gpt-image-2`
- 提示词模型：默认建议 `gpt-5.4-mini`
- 图片接口：可选择 Images API 或 Responses API

请求路径按 Provider 的 Base URL 拼接：

```text
POST {baseUrl}/v1/images/generations
POST {baseUrl}/v1/images/edits
POST {baseUrl}/v1/responses
```

测试和本地 mock provider 中常用的地址是：

```text
http://127.0.0.1:37123
```

这个地址只是开发测试约定，不是生产默认配置。

## Codex Bridge

桌面应用运行时会启动本机 bridge：

```text
http://127.0.0.1:43117
```

可通过环境变量调整：

```text
PIXAI_CODEX_PORT=<port>
PIXAI_CODEX_BRIDGE=0
```

bridge 只绑定 `127.0.0.1`，用于同一台机器上的 Codex 或脚本自动化。

常用命令：

```bash
pnpm codex -- health
pnpm codex -- settings
pnpm codex -- conversations
pnpm codex -- history --limit 5
pnpm codex -- generate --prompt "一座清晨玻璃温室，自然光，干净摄影风格" --ratio 1:1 --n 1
pnpm codex -- inspire
pnpm codex -- enrich --prompt "清爽产品摄影"
```

生成、重编辑、导出等复杂请求也可以用 JSON：

```bash
pnpm codex -- generate --json '{"prompt":"a glass greenhouse","ratio":"1:1","n":1}'
pnpm codex -- reedit --id <historyId> --json '{"prompt":"make it dusk"}'
pnpm codex -- export --ids id1,id2 --directory <output-directory>
```

## 应用更新

PixAI 使用 Tauri updater plugin。生产配置位于 `src-tauri/tauri.conf.json`：

```json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://github.com/FingerCaster/PixAI-Tauri/releases/latest/download/latest.json"],
      "pubkey": "<tauri-updater-public-key>"
    }
  }
}
```

应用内更新检查失败时，界面会保留正常使用能力，并在需要时退回到 GitHub Release 下载页。正常“没有新版本”的结果不会跳转 GitHub。

### 正式发布更新

正式更新使用 GitHub Release + `latest.json`。私钥必须长期稳定保存，仓库只提交 public key。

完整可重复执行 checklist 见 [docs/release-github-actions.md](docs/release-github-actions.md)。

后续正式发布默认走 GitHub Actions。需要先在 GitHub 仓库 Secrets 中配置：

```text
TAURI_SIGNING_PRIVATE_KEY=<生产 updater 私钥内容>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<私钥密码，可为空>
```

发布新版本：

```bash
# 1. 同步更新 package.json、src-tauri/Cargo.toml、src-tauri/Cargo.lock 和 src-tauri/tauri.conf.json 的版本号
# 2. 提交版本号变更
git tag <version>
git push origin main <version>
```

`Release` workflow 会在 tag push 后分别在 Windows x64、macOS arm64 和 macOS x64 runner 上构建签名安装包。全部构建成功后，它会创建 draft GitHub Release，合并 `latest.json`，上传完整资产后再公开 Release。也可以在 GitHub Actions 页面手动运行 workflow，并填写 `version` / `tag`。

workflow 发布内容包括：

```text
latest.json
PixAI_<version>_x64_en-US.msi
PixAI_<version>_x64-setup.exe
PixAI_<version>_macos-aarch64.app.tar.gz
PixAI_<version>_macos-aarch64.dmg
PixAI_<version>_macos-x64.app.tar.gz
PixAI_<version>_macos-x64.dmg
```

首次生成正式 updater key：

```bash
pnpm updater:release:keygen
```

默认写入：

```text
artifacts/release-updater/keys/updater.key
artifacts/release-updater/keys/updater.key.pub
```

`artifacts/` 已被 gitignore。请备份 `updater.key`，如果更换私钥，旧安装版本将不再信任后续更新。

如果私钥保存在 1Password，可拉取到默认路径：

```bash
pnpm updater:release:pull-key
```

默认读取：

```text
PIXAI_1PASSWORD_VAULT=PixAI Release
PIXAI_1PASSWORD_UPDATER_KEY_TITLE=PixAI updater.key
PIXAI_1PASSWORD_UPDATER_PUBKEY_TITLE=PixAI updater.key.pub
```

构建签名安装包：

```bash
pnpm updater:release:build -- --version <version>
```

在 macOS 原生环境中执行同一命令会生成 macOS bundle。Tauri updater 官方要求 macOS 更新资产使用 `target/release/bundle/macos/*.app.tar.gz` 与同名 `.sig`，手动下载资产使用 `.dmg`。

生成发布用 `latest.json` 和 staging 目录：

```bash
pnpm updater:release:manifest -- --version <version> --tag <tag>
```

上传到已有 GitHub Release：

```bash
pnpm updater:release:publish -- --version <version> --tag <tag>
```

staging 输出：

```text
artifacts/release-updater/staging/<version>/
```

上传内容包括：

```text
latest.json
PixAI_<version>_x64_en-US.msi
PixAI_<version>_x64-setup.exe
PixAI_<version>_macos-aarch64.app.tar.gz
PixAI_<version>_macos-aarch64.dmg
PixAI_<version>_macos-x64.app.tar.gz
PixAI_<version>_macos-x64.dmg
```

Windows 和 macOS 可以在不同机器上分开构建、分开执行 `manifest` / `publish`。正式脚本会读取同一 tag 已有的 `latest.json`，版本相同时合并 `platforms` 条目，避免后发布的平台覆盖先发布的平台。跨架构 macOS 产物可在 manifest/publish 时指定：

```bash
pnpm updater:release:manifest -- --version <version> --tag <tag> --macos-arch aarch64
pnpm updater:release:publish -- --version <version> --tag <tag> --macos-arch x86_64
```

### 本地 updater 验证

本地验证不需要上传 GitHub Release，使用独立本地 feed。

生成本地测试 key：

```bash
pnpm updater:local:keygen
```

构建一个旧版本并安装：

```bash
pnpm updater:local:build -- --version <old-version> --port 14333
```

构建新版本：

```bash
pnpm updater:local:build -- --version <new-version> --port 14333
```

发布本地 feed：

```bash
pnpm updater:local:publish -- --version <new-version> --port 14333
```

如果本地发布的是 macOS 交叉目标产物，补充架构参数：

```bash
pnpm updater:local:publish -- --version <new-version> --port 14333 --macos-arch aarch64
```

启动本地 feed：

```bash
pnpm updater:local:serve -- --port 14333
```

然后打开已安装的旧版本，在「全局设置 -> 常规 -> 关于应用 / 更新」里点击「检查更新」。它应从本地 feed 发现新版本，不访问 GitHub。

本地验证输出：

```text
artifacts/local-updater/keys/
artifacts/local-updater/feed/
```

## 数据与迁移

当前 Tauri 版本使用新的应用数据目录，保存 Provider 设置、偏好、会话、生成记录、历史图片、参考图和提示词模板。

旧 Electron 版本的数据迁移不属于当前版本范围。如果需要迁移历史数据，应单独设计导入流程，不要假设旧项目目录和当前 Tauri 数据结构兼容。

## 项目结构

```text
src/
├─ adapters/      # Provider adapter 与 OpenAI-compatible 请求构造
├─ assets/        # 前端静态资源
├─ components/    # React 页面、业务组件和 shadcn/ui primitives
├─ lib/           # 平台桥接、工具函数、主题同步等通用逻辑
├─ services/      # 数据服务、Provider 设置、更新、Codex Bridge 等应用服务
├─ shared/        # 前后端共享类型和图片参数常量
├─ store/         # Zustand 应用状态
└─ test/          # 测试环境设置

src-tauri/
├─ capabilities/  # Tauri 权限配置
├─ icons/         # 桌面应用图标
├─ src/           # Rust 侧命令、窗口、托盘、HTTP bridge、文件和更新逻辑
├─ tauri.conf.json
└─ tauri.local-updater.conf.json

scripts/
├─ pixai-codex.mjs
├─ local-updater.mjs
├─ release-updater.mjs
└─ updater-artifacts.mjs
```

## 质量检查

提交前建议运行：

```bash
pnpm check
pnpm build
```

如果只改 README 或文档，也要留意不要重新加入本机绝对路径、固定旧版本号或旧 Electron 打包命令。

## 维护提示

- 不要把 `artifacts/`、`src-tauri/target/`、`node_modules/` 或本地参考快照提交进仓库。
- README 中的版本示例优先使用 `<version>`、`<old-version>`、`<new-version>`，避免发布后过时。
- 新增 Provider 类型时，同步更新 Provider 配置、能力说明和 Codex Bridge 请求示例。
- 新增发布脚本或更新策略时，同步更新「应用更新」章节。
