# PixAI Tauri 架构总入口

> 状态：已更新
> 创建日期：2026-05-23

## 1. 项目简介

PixAI rebuilt as a Tauri 2 desktop app.

## 2. 核心概念 / 术语表

- **UI 基座**：Tailwind v4 + shadcn/ui primitives + `src/index.css` 主题 token 组成的前端视觉和交互组件基础。
- **工作区参数栏**：工作台右侧的高频参数编辑层，仅承载当前会话的生图参数与引擎选择。
- **全局设置窗**：应用级低频配置层，承载通知、更新、服务配置、Codex 扩展等全局状态。
- **Provider 管理流**：在全局设置窗内维护图片 / 提示词 Provider 的默认选择、列表维护与编辑弹窗。
- **应用更新流**：桌面端运行时版本读取、启动静默检查、设置页手动检查、Tauri updater 安装与 GitHub fallback 的统一编排。

## 3. 子系统 / 模块索引

- **前端工作台布局**
  - `src/components/layout/MainLayout.tsx`
  - `src/App.tsx`
  - 负责工作台、左侧导航、右侧工作区参数栏、全局设置窗挂载。
- **shadcn 工作台 UI 架构**
  - `.codestable/architecture/ui-shadcn-workbench.md`
  - `src/index.css`
  - `src/components/ui/`
  - `src/lib/utils.ts`
  - 负责记录 Tailwind/shadcn 基座、主题 token、App shell、工作台、设置和库页面的当前结构。
- **设置系统**
  - `src/components/settings/workspace/`
  - `src/components/settings/global/`
  - `src/components/settings/providers/`
  - 负责把“当前会话参数”和“应用级设置”拆成两层编排。
- **应用更新系统**
  - `src/services/app-update.ts`
  - `src/store/app-store.ts`
  - `src/components/settings/AppUpdateSection.tsx`
  - `src-tauri/tauri.conf.json`
  - 负责运行时版本展示、OS / arch / installerType 平台识别、更新检查、更新下载安装与 GitHub fallback。
- **本地 updater 验证工具**
  - `scripts/local-updater.mjs`
  - `scripts/updater-artifacts.mjs`
  - `src-tauri/tauri.local-updater.conf.json`
  - `README.md`
  - 负责在不上传 GitHub Release 的前提下，生成本地签名更新包、跨平台 `latest.json` 和本地 feed。
- **正式 updater 发布工具**
  - `scripts/release-updater.mjs`
  - `scripts/updater-artifacts.mjs`
  - `src-tauri/tauri.conf.json`
  - `README.md`
  - 负责用长期公私钥生成正式签名更新包、合并 GitHub Release `latest.json` 平台条目并上传现有 release 资产。

## 4. 关键架构决定

- 前端 UI 栈采用 Tailwind v4 + shadcn/ui，shadcn primitives 进入 `src/components/ui/` 作为项目源码层；详见 `.codestable/compound/2026-05-24-decision-shadcn-tailwind-ui-stack.md`。
- 设置系统采用双层结构：右侧 `WorkspaceConfigPanel` 负责高频会话参数，`GlobalSettingsModal` 负责低频应用级配置。
- Provider 维护不再和工作区参数混排，而是作为 `Services` 分区内的独立管理流存在。
- 更新、通知权限、技能安装统一按状态卡表达，减少和普通表单字段的视觉冲突。
- 正式更新源与本地验证更新源分离：正式分发继续走 GitHub Release，本地验证通过独立脚本和本地 HTTP feed 完成。
- updater 平台目标采用跨平台模型：Windows 按安装器保留 `windows-x86_64-msi/nsis`，macOS 按架构使用 `darwin-aarch64/x86_64`。
- macOS 手动安装资产是 `.dmg`，Tauri updater 资产是 `.app.tar.gz` 加同名 `.sig`；发布脚本会同时 staging 手动安装包和 updater 包。
- Windows 和 macOS 可以在不同机器上分开发同一 tag；正式发布脚本会在同版本下合并已有 `latest.json` 的 `platforms`，避免覆盖另一平台条目。
- 正式 updater 私钥只保存在本机 gitignored 的 `artifacts/release-updater/keys/`；仓库只提交公钥。

## 5. 已知约束 / 硬边界

- 高频生图参数必须在工作区一层内可达，不能被多级导航或二级弹窗包裹。
- UI 样式入口是 `src/index.css` 与 `src/components/ui/*`；不应恢复旧 `src/styles.css` 作为并行样式体系。
- 打开全局设置窗不能打断当前会话上下文，也不能清空正在编辑的 prompt。
- 本地通知、更新、服务配置和扩展属于全局层，不应重新回流到工作区参数栏。
- GitHub fallback 仅在 Tauri updater 源异常时触发；“正常无更新”不应被重定向到 GitHub。
- 本地 updater feed 仅用于验证，不应覆盖正式发布配置。
