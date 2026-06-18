---
doc_type: feature-ff-note
feature: close-to-tray
date: 2026-05-23
requirement:
tags: [tray, window, preferences]
---

## 做了什么
关闭 PixAI 主窗口时默认隐藏到系统托盘，并通过系统通知提示用户可从托盘恢复或退出。设置面板新增开关，可恢复为关闭窗口即退出应用。

## 改了哪些
- src-tauri/src/lib.rs — 创建系统托盘图标、恢复/退出菜单和隐藏窗口/退出命令。
- src-tauri/Cargo.toml — 开启 Tauri tray-icon feature。
- src/lib/platform.ts — 封装关闭请求拦截、隐藏主窗口和托盘提示通知。
- src/App.tsx — 根据 closeToTray 偏好拦截窗口关闭请求。
- src/shared/types.ts、src/services/app-preferences.ts — 新增 closeToTray 偏好并默认开启。
- src/components/settings/SettingsPanel.tsx — 在本地通知区域加入关闭到系统托盘开关。

## 怎么验证的
已运行 pnpm check 验证 TypeScript 和测试；已运行 pnpm tauri build --debug 验证 Tauri 调试包构建通过。
