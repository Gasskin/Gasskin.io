---
doc_type: feature-ff-note
feature: notification-activate-workspace
date: 2026-05-23
requirement:
tags: [notification, workspace, tauri]
---

## 做了什么
点击系统通知后，桌面端会激活 PixAI 主窗口并切回生图工作台，让完成提示不只停留在系统通知中心。

## 改了哪些
- src-tauri/src/lib.rs — 新增窗口激活命令和 Windows toast 点击回调，触发前端通知激活事件。
- src/lib/platform.ts — 系统通知改为通过后端命令发送，并保留浏览器环境的点击激活兜底。
- src/App.tsx — 监听通知激活事件，自动切换到 workspace 视图。
- src-tauri/Cargo.toml — 引入 Windows toast 回调所需的 tauri-winrt-notification。

## 怎么验证的
已运行 pnpm check 验证 TypeScript 和测试；已运行 pnpm tauri build --debug 验证 Tauri 调试包构建通过。
