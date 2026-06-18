---
doc_type: issue-fix
issue: 2026-05-29-tauri-reference-image-drop
path: fast-track
fix_date: 2026-05-29
tags: [tauri, reference-image, drag-drop, workspace]
---

# Tauri 客户端拖入图片未识别为参考图修复记录

## 1. 问题描述

提示词输入区粘贴图片可以正确追加为参考图，但在真实 Tauri 客户端中从文件管理器拖入图片没有被识别。浏览器/DOM 环境下的 `drop` 测试可通过，问题只出现在桌面 WebView 文件拖放路径。

## 2. 根因

Tauri 在 Windows 上默认启用原生文件拖放处理，文件拖入 WebView 时不一定进入 HTML5 `DataTransfer.files`。原实现只监听 `Composer` 输入区的 DOM `onDrop`，因此真实客户端拿不到本地文件路径，也就不会触发参考图导入。

## 3. 修复方案

在 `Composer` 中保留原 DOM 粘贴/拖放逻辑，同时在 Tauri runtime 注册 `getCurrentWindow().onDragDropEvent`。当 drop 落点在提示词输入区内时，过滤本地图片路径，用 `readLocalImageFile(path)` 读取为 `ReferenceImageFilePayload`，再通过新增的 `useAppStore.importReferencePayloads` 写入当前会话参考图。

## 4. 改动文件清单

- `src/components/workspace/Composer.tsx`：新增 Tauri 原生 drag/drop 监听、路径过滤、落点判断和 path-to-payload 导入。
- `src/store/app-store.ts`：新增 `importReferencePayloads(payloads)` action，复用既有 `pixaiApi.reference.importPayloads`。
- `src/components/workspace/Composer.test.tsx`：新增 Tauri drop path 单测，并保留粘贴、DOM 拖入、非图片拖入回归测试。
- `.codestable/features/2026-05-29-reference-image-input/reference-image-input-acceptance.md`：回写 Tauri 路径拖放验收证据。
- `.codestable/architecture/ui-shadcn-workbench.md`：回写 Composer 在 Tauri runtime 中的原生拖放路径。

## 5. 验证结果

- [x] `pnpm exec tsc --noEmit` 通过。
- [x] `pnpm test -- Composer.test.tsx` 通过，8 个组件测试全绿。
- [x] `pnpm check` 通过，18 个测试文件、89 个测试用例全绿。
- [x] `pnpm build` 通过，Vite 生产构建完成；仅保留现有 chunk size warning。
- [x] 真实测试客户端进程仍在运行：正式版 `D:\Program Files\PixAI\pixai-tauri.exe` 与 dev 版 `target\debug\pixai-tauri.exe` 共存。
- [x] 用户在真实 `PixAI Dev` 窗口验证通过：拖入图片和粘贴图片都能正确识别为参考图。

## 6. 遗留事项

- 无。
