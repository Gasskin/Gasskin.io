# 应用更新 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-05-24
> 关联方案 doc：`E:\MyWork\PixAI-Tauri\.codestable\features\2026-05-24-app-update\app-update-design.md`

## 1. 接口契约核对

**接口示例逐项核对**

- [x] `src/shared/types.ts` 的 `AppUpdateState`：已覆盖 `idle / checking / upToDate / available / downloading / downloaded / installing / error` 语义所需字段；代码实际字段包含 `currentVersion`、`availableUpdate`、`lastCheckedAt`、`errorMessage`、`downloadedBytes`、`contentLength`。
- [x] `src/services/app-api.ts` 的 `pixaiApi.appUpdate`：已提供 `versionInfo`、`check`、`downloadAndInstall`、`relaunch` 四个入口，并全部委托到 `AppUpdateService`。
- [x] `src/components/settings/AppUpdateSection.tsx`：设置区块已消费 store 中的 `appUpdate` 状态，并提供检查与安装入口。

**名词层“现状 → 变化”逐项核对**

- [x] 应用版本：`MainLayout` 已改为显示运行时版本，不再显示写死的 `v0.1.0`。
- [x] 更新检查：前端已通过 `AppUpdateService` 封装 Tauri updater 检查与 GitHub fallback。
- [x] 可用更新：运行时状态由 store 维护，没有写入 `AppPreferences`。
- [x] 发布源：生产配置仍在 `src-tauri/tauri.conf.json`，本地验证新增独立 `src-tauri/tauri.local-updater.conf.json` + `scripts/local-updater.mjs`，没有把本地源硬编码进 React 组件。

**流程图核对**

- [x] 启动 `load()` -> 读取版本 -> 桌面端静默检查更新 -> 设置页展示状态，这条流程在 `src/store/app-store.ts` 中有实际落点。

## 2. 行为与决策核对

**需求摘要逐项验证**

- [x] 启动自动检查：`load()` 完成后仅在桌面端触发一次静默检查。
- [x] 手动检查入口：`GeneralSettingsTab` 中挂接了 `AppUpdateSection`，可以手动点击“检查更新”。
- [x] 可用更新展示：`AppUpdateSection` 按 `available` / `error` / `upToDate` / `downloading` 渲染状态。
- [x] 下载并重启：Tauri updater 模式下走 `downloadAndInstall()` + `relaunch()`；GitHub fallback 模式下打开下载页。

**明确不做逐项核对**

- [x] 没有强制更新分支。
- [x] 启动时不会自动下载、安装或重启。
- [x] 没有新增渠道选择、灰度策略或测试版开关 UI。
- [x] 图片生成、提示词助手、历史图库流程未被修改。

**关键决策落地**

- [x] 决策 D1：更新执行层采用 Tauri updater；代码体现为 `src/services/app-update.ts` + `src-tauri` updater 插件。
- [x] 决策 D2：更新状态归 store；代码体现为 `src/store/app-store.ts` 的 `appUpdate` slice。
- [x] 决策 D3：设置页独立区块；代码体现为 `src/components/settings/AppUpdateSection.tsx`。
- [x] 决策 D4：发布源配置放在 Tauri 配置与脚本；代码体现为 `src-tauri/tauri.conf.json`、`src-tauri/tauri.local-updater.conf.json`、`scripts/local-updater.mjs`。

**编排层“现状 → 变化”逐项核对**

- [x] 启动静默检查失败只落状态，不阻塞主工作台。
- [x] 手动检查复用同一条 `checkForAppUpdate()` 流程。
- [x] 下载 / 安装期间禁用重复触发。
- [x] 浏览器环境下仍返回受控版本信息，不展示误导性桌面安装能力。

**流程级约束核对**

- [x] 错误语义：失败只更新 `appUpdate.errorMessage` 并在用户主动操作时 toast。
- [x] 幂等性：`startupUpdateCheckStarted` 保证生命周期内只静默触发一次。
- [x] 并发约束：`checking/downloading/installing` 时直接 return，不重复触发。
- [x] 可观测点：`lastCheckedAt`、`downloadedBytes`、`contentLength`、`errorMessage` 均落入状态。
- [x] 扩展点：本地验证通过脚本链路独立实现，没有侵入正式发布 UI。

**挂载点反向核对**

- [x] Tauri 插件注册：`src-tauri/src/lib.rs`
- [x] 发布配置：`src-tauri/tauri.conf.json`、`src-tauri/tauri.local-updater.conf.json`、`README.md`
- [x] Capability 权限：`src-tauri/capabilities/default.json`
- [x] Store 启动流程：`src/store/app-store.ts`
- [x] 设置页区块：`src/components/settings/AppUpdateSection.tsx`、`src/components/settings/global/GeneralSettingsTab.tsx`
- [x] 侧边栏版本展示：`src/components/layout/MainLayout.tsx`
- [x] 本地验证脚本挂载：`package.json`、`scripts/local-updater.mjs`

## 3. 验收场景核对

- [x] **S1 启动应用且无新版本**
  - 证据来源：`src/store/app-store.test.ts` + `src/services/app-update.test.ts`
  - 结果：通过

- [x] **S2 启动应用且存在新版本**
  - 证据来源：`src/components/settings/AppUpdateSection.tsx` 状态渲染 + `src/store/app-store.test.ts`
  - 结果：通过

- [x] **S3 用户点击检查更新且检查成功**
  - 证据来源：`src/store/app-store.test.ts`
  - 结果：通过

- [x] **S4 用户点击检查更新且发布源失败**
  - 证据来源：`src/store/app-store.test.ts` + `src/services/app-update.test.ts`
  - 结果：通过

- [x] **S5 用户点击下载并重启**
  - 证据来源：`src/store/app-store.ts` 行为检查 + `src/services/app-update.ts`
  - 结果：通过

- [x] **S6 浏览器 dev 环境或 updater 未配置**
  - 证据来源：`AppUpdateService.getVersionInfo()` 浏览器兜底 + `AppUpdateSection` idle 文案
  - 结果：通过

- [x] **S7 侧边栏版本展示**
  - 证据来源：`src/components/layout/MainLayout.tsx`
  - 结果：通过

- [x] **S8 本地验证不依赖 GitHub Release**
  - 证据来源：实际运行 `pnpm updater:local:build -- --version 0.0.3 --port 14333` 与 `pnpm updater:local:publish -- --version 0.0.3 --port 14333`
  - 结果：通过

**前端改动浏览器 / 应用验证**

- [x] 更新区块 UI 已在现有本地测试过程中验证过，当前回合重点补齐的是本地 updater feed 验证链路。

## 4. 术语一致性

- 应用版本 / 更新检查 / 可用更新 / 发布源：代码命名与 design 一致。
- GitHub fallback：仅保留在 `AppUpdateService` 服务层，没有渗透到组件命名。
- 防冲突：没有新增测试渠道、beta channel 等方案外术语。

## 5. 架构归并

- [x] `E:\MyWork\PixAI-Tauri\.codestable\architecture\ARCHITECTURE.md`
  - 已归并更新能力、本地 updater 验证脚本、正式 GitHub 发布与本地 feed 分离这三项稳定结构。

## 6. requirement 回写

- [x] `requirement: app-update` 已存在 draft，本次已升级为 current，并补入本地 updater 验证链路。

## 7. roadmap 回写

- [x] 非 roadmap 起头，本节跳过。

## 8. attention.md 候选盘点

- [x] 本 feature 未暴露必须补入 `attention.md` 的新项目级硬约束。

## 9. 遗留

- 后续优化点：如需一键串起“build old -> build new -> publish -> serve”的完整演练，可再补一个聚合命令。
- 已知限制：本地 feed 当前按 Windows NSIS 安装包组织，用于当前仓库的 Windows updater 验证。
- 实现阶段顺手发现：无。
