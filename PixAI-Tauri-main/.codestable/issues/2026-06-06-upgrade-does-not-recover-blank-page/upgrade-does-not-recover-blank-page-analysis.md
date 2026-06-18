---
doc_type: issue-analysis
issue: 2026-06-06-upgrade-does-not-recover-blank-page
status: confirmed
root_cause_type: state-pollution
related: [upgrade-does-not-recover-blank-page-report.md]
tags: [workspace, tauri, reference-image, upgrade, blank-page, persistence]
---

# Upgrade Does Not Recover Blank Page 根因分析

## 1. 问题定位

| 关键位置 | 说明 |
|---|---|
| `src-tauri/src/lib.rs:806-823` | `store_data_url_file()` 把参考图写到本地文件后，返回给前端的 `data_url` 实际上不是 data URL，而是本地磁盘路径。 |
| `src-tauri/src/lib.rs:1740-1742` | `path_to_file_url()` 只是 `path.to_string_lossy()`，没有生成安全可显示 URL，等于把原始 Windows 路径直接塞回了 `data_url`。 |
| `src/services/app-api.ts:106-120` | 文件选择上传参考图时，前端直接把 `storeDataUrlFile()` 返回的 `stored.dataUrl` / `stored.path` 写入参考图 payload。 |
| `src/services/app-database.ts:225-247` | `importReferenceImages()` 把上述 payload 原样持久化进 `conversation.referenceImages`，污染进入 `pixai-data.json`。 |
| `src/services/app-database.ts:329-336` | 启动加载时，`normalizeData()` 对非 data URL 的参考图只尝试从 `asset.localhost` 回填 `storagePath`，不会把“原始本地路径形态的 `dataUrl`”修复成干净状态。 |
| `src/lib/platform.ts:540-561` | 当前版本新增的 `imageSourceForDisplaySync()` 只能在运行时把本地路径临时转换成安全显示地址，本质是 UI 层兜底，不会回写修复本地状态。 |
| `src/components/workspace/Composer.tsx:243` | 缩略图 `src` 仍保留 `... || reference.dataUrl` 的最终回退；只要前面的安全地址没拿到，旧的坏数据就会再次直接进入 `<img src>`。 |
| `src/components/workspace/Composer.tsx:313` | 预览弹窗同样保留 `... || previewReference.dataUrl` 的最终回退，和缩略图是同一条风险路径。 |

## 2. 失败路径还原

**正常路径**：用户选择参考图 -> Tauri 把图片写入应用数据目录 -> 前端保存“可恢复的引用信息” -> 应用重启后读取本地状态 -> `Composer` 用安全地址显示参考图 -> 工作台正常打开。

**失败路径**：用户在错误版本选择参考图 -> `store_data_url_file()` 返回的 `data_url` 实际是原始 Windows 路径 -> `AppDatabase.importReferenceImages()` 把这份路径形态的数据持久化进 `pixai-data.json` -> 应用白屏后再次启动时，`normalizeData()` 没有把这份坏状态修复掉 -> 新版本虽然在 `Composer` 首帧增加了安全显示兜底，但本地持久化数据仍然是坏的，只要任何显示路径再次落到 `reference.dataUrl` 回退，就会重新触发白屏。

**分叉点**：`src/services/app-database.ts:329-336` — 启动归一化阶段没有把已落盘的“路径形态 `dataUrl`”迁移掉，导致坏状态跨重启、跨升级一直保留。

## 3. 根因

**根因类型**：`state-pollution`

**根因描述**：错误版本把“原始本地文件路径”写进了 `ReferenceImage.dataUrl` 这个会被 UI 直接消费的字段里，污染随后被持久化到 `pixai-data.json`。修复版只是在 `Composer` 渲染时临时把本地路径转换成安全显示地址，避免新导入时首帧立刻白屏，但没有在应用启动时把已经写坏的本地状态修复掉，所以已经中招的用户升级后仍会反复读到同一份坏数据。只要缩略图或预览路径再次回退到原始 `reference.dataUrl`，白屏就会继续复现。

**是否有多个根因**：是。

- **主根因**：`store_data_url_file()` / 参考图持久化链路把原始本地路径写进了可直接渲染的 `dataUrl` 字段。
- **次根因**：`normalizeData()` 缺少升级自愈迁移，`Composer` 仍保留对原始 `reference.dataUrl` 的最终回退，导致坏状态不会自动出清。

## 4. 影响面

- **影响范围**：不只影响“当次上传立刻白屏”，还影响所有已经被 0.0.13 写坏本地状态的已安装用户；问题会跨重启、跨覆盖安装持续存在。
- **潜在受害模块**：`Composer` 参考图缩略条、参考图预览弹窗，以及后续任何直接消费 `conversation.referenceImages[*].dataUrl` 的显示路径。
- **数据完整性风险**：有。`pixai-data.json` 中的参考图记录被持久化成非规范形态；单纯升级应用二进制不会修复这份本地状态。
- **严重程度复核**：维持 `P1`。错误版本已下线，所以不是所有新装用户都会首次命中；但已受影响用户会被持续锁死在白屏状态，且不能靠普通升级自恢复。

## 5. 修复方案

### 方案 A：启动时做一次参考图状态迁移并移除原始路径回退

- **做什么**：
  - 在 `src/services/app-database.ts` 的 `normalizeData()` 中识别“`dataUrl` 是本地路径或旧 asset path”的参考图记录；
  - 迁移为规范形态，例如保留 `storagePath`，把 `dataUrl` 清空或改成可恢复形态，并在必要时补齐 `storagePath`；
  - 同时移除 `src/components/workspace/Composer.tsx:243` / `313` 对 `reference.dataUrl` 的最终回退，避免任何未修复状态再次直接喂给 `<img src>`。
- **优点**：能自动修复已中招用户；升级后首次启动即可自愈；根因打得最正，后续同类问题不容易再反复。
- **缺点 / 风险**：会改动持久化迁移逻辑，需要谨慎处理“文件已不存在”的边界；测试要覆盖旧状态迁移和缺失文件场景。
- **影响面**：`src/services/app-database.ts`、`src/components/workspace/Composer.tsx`、相关测试。

### 方案 B：检测到旧坏状态后直接清理受污染参考图

- **做什么**：
  - 启动时扫描 `conversation.referenceImages`；
  - 只要发现 `dataUrl` 是旧版写入的本地路径，就从会话里移除这些参考图，必要时给用户一条恢复提示。
- **优点**：实现简单，最容易保证“应用至少能打开”；不会继续让坏路径进入渲染。
- **缺点 / 风险**：会直接丢失用户的参考图关联，用户体验最差；如果图片文件其实还在，这是不必要的数据损失。
- **影响面**：`src/services/app-database.ts`、可能的提示文案与测试。

### 方案 C：保留现有运行时兜底，再补一条显式恢复入口

- **做什么**：
  - 保留 `Composer` 的安全地址逻辑；
  - 新增一个启动前或设置里的“修复本地损坏数据 / 重置工作台状态”入口，手动清理或迁移受污染状态。
- **优点**：改动边界清晰，对自动迁移更保守；适合担心批量改用户本地数据的场景。
- **缺点 / 风险**：不能满足“升级后自动恢复”；已经白屏的用户往往看不到入口，仍需要额外引导甚至外部脚本辅助。
- **影响面**：恢复入口 UI、状态清理逻辑、文档与用户支持流程。

### 推荐方案

**推荐方案 A**，理由：这条问题的核心不是“新上传时怎么不白”，而是“旧版本留下的坏状态怎么自动恢复”。方案 A 同时解决“坏数据继续留在盘里”和“渲染层仍可能回退到坏数据”这两个点，能让已受影响用户通过升级自然恢复，副作用也比直接清空参考图更小。
