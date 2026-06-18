---
doc_type: issue-fix
issue: 2026-05-24-image-download-save-dialog
path: fast-track
fix_date: 2026-05-24
tags: [download, dialog, tauri, frontend]
---

# 图片下载保存对话框修复记录

## 1. 问题描述

点击图片下载后，界面只提示“图片下载已开始”，没有弹出保存位置选择框，用户无法决定保存到哪里。

## 2. 根因

图片下载入口还走浏览器式的自动下载思路，Tauri 桌面端没有先调用原生保存对话框，而是直接触发下载/提示，导致行为和预期不一致。

## 3. 修复方案

- 将 Tauri 端下载流程改为先调用原生 `save()` 对话框。
- 用户选定路径后，再把图片字节写入该路径。
- 用户取消保存时静默退出，不打扰主流程。
- 单图和图库批量下载都统一走同一套保存逻辑，并把提示改成“图片已保存”。

## 4. 改动文件清单

- `src/lib/platform.ts`
- `src/components/workspace/ImageTile.tsx`
- `src/components/gallery/GalleryPage.tsx`
- `src/lib/platform.test.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/capabilities/default.json`
- `package.json`
- `pnpm-lock.yaml`

## 5. 验证结果

- `pnpm check` 通过，69 个测试全部通过。
- `cargo build --manifest-path src-tauri/Cargo.toml` 通过。
- 已重启 `src-tauri/target/debug/pixai-tauri.exe`，让当前 dev 窗口加载最新构建。

## 6. 遗留事项

无。
