---
doc_type: issue-fix
issue: 2026-06-06-reference-image-upload-blank-page
path: fast-track
fix_date: 2026-06-06
tags: [workspace, reference-image, tauri, composer]
---

# Reference Image Upload Blank Page 修复记录

## 1. 问题描述

真实 Tauri 客户端在经典工作台里选择参考图后，窗口会直接变成空白页。问题发生在参考图刚加入会话、`Composer` 首次渲染缩略图的瞬间。

## 2. 根因

`src/components/workspace/Composer.tsx` 在参考图缩略图首帧渲染时，`referenceSources` 还没被 `useEffect` 填充安全的展示地址，`<img>` 会先回退到 `reference.dataUrl`。对于桌面端已落盘的参考图，这个字段是本地 Windows 路径字符串，不是可直接喂给 WebView 的安全资源 URL，因此会把真实客户端渲染打坏。

## 3. 修复方案

在 `Composer` 中新增同步 `reference` source map，首帧渲染和预览弹窗都优先使用 `imageSourceForDisplaySync()` 产出的安全地址，再由原有异步路径补全后续缓存。这样即使参考图刚加入会话，也不会把原始本地路径直接塞进 `<img src>`.

## 4. 改动文件清单

- `src/components/workspace/Composer.tsx`：新增同步 reference source map，并把缩略图/预览的首帧 fallback 改为安全展示地址。
- `src/components/workspace/Composer.test.tsx`：新增回归测试，覆盖“会话从无参考图切到本地存储参考图时，首帧不能输出原始 Windows 路径”。

## 5. 验证结果

- [x] `pnpm vitest run src/components/workspace/Composer.test.tsx` 通过。
- [x] `pnpm check` 通过，包含 `tsc --noEmit` 与全量 Vitest。
- [x] 已启动 `pnpm dev:client` 的真实桌面调试进程，便于继续现场复验。

## 6. 遗留事项

- 还需要在真实 `PixAI Dev` 窗口里手点一次“选择参考图”做最终人工复验，确认白屏不再出现。
