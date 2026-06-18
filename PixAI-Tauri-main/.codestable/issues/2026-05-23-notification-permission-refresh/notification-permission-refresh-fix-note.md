---
doc_type: issue-fix
issue: 2026-05-23-notification-permission-refresh
path: fast-track
fix_date: 2026-05-23
tags: [notification, permission, tauri, settings]
---

# 系统通知权限反复提示修复记录

## 1. 问题描述

用户已经给过系统通知权限后，再次进入应用仍看到通知权限不可用/需要开启权限，设置页可能显示“系统已拒绝”。

## 2. 根因

前端权限读取复用了 `@tauri-apps/plugin-notification` 的浏览器侧权限逻辑；该逻辑在 Windows Tauri WebView 中会优先读取 `window.Notification.permission`。应用实际发送通知已经改为 Rust 侧 Windows toast 通道，WebView 的 `Notification.permission` 不等价于桌面通知能力，可能把初始或旧状态误判成 `denied` 并写入偏好。

## 3. 修复方案

- Tauri 桌面运行时直接按当前应用原生通知通道返回 `granted`，不再用 WebView 的 `Notification.permission` 判断系统通知可用性。
- 浏览器预览环境保留 Web Notification API 的权限读取和请求逻辑。
- 应用启动加载偏好时刷新一次通知权限，自动覆盖之前持久化的错误 `denied` 状态。
- 增加回归测试，覆盖 Tauri 桌面环境中 WebView `Notification.permission` 为 `denied` 时仍返回 `granted` 的场景。

## 4. 改动文件清单

- `src/lib/platform.ts`
- `src/lib/platform.test.ts`
- `src/store/app-store.ts`

## 5. 验证结果

- `pnpm vitest run src/lib/platform.test.ts src/services/app-preferences.test.ts` 通过，4 个测试全部通过。
- `pnpm check` 通过，TypeScript 检查和 64 个测试全部通过。

## 6. 遗留事项

无。
