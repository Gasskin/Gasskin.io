---
doc_type: issue-fix
issue: 2026-05-24-app-update-github-release-fallback
path: fast-track
fix_date: 2026-05-24
tags: [update, github-release, tauri, settings]
---

# 应用更新 GitHub Release 回退修复记录

## 1. 问题描述

设置页点击“检查更新”失败。项目存在真实发布源，发布包走 GitHub Release，但当前 release 只有安装包，没有 Tauri updater 需要的 `latest.json`。

## 2. 根因

- Tauri updater endpoint 指向 `latest.json`，文件不存在时会 404。
- 前端回退逻辑调用 `api.github.com/repos/FingerCaster/PixAI-Tauri/releases/latest`，在本机遇到过 GitHub API rate limit，导致真实 GitHub Release 页面可访问时仍检查失败。
- 版本比较把 `0.0.2` 先按 `[.+-]` 分割后只取第一段，导致 `0.0.2` 和 `0.0.1` 都被当成 `0`，旧版本可能误判为无更新。

## 3. 修复方案

- 保留“原生 Tauri updater 优先”的路径。
- 当 `latest.json` 缺失、签名配置缺失或 updater 404 时，回退到 GitHub Release 页面本身，而不是 GitHub API。
- 通过 `/releases/latest` 页面解析最新 tag，通过 `/releases/expanded_assets/{tag}` 解析安装包链接，优先选择 `*_x64-setup.exe`。
- 修正版本比较逻辑，按 `+` / `-` 去掉构建和预发布后，再逐段比较 `major.minor.patch`。

## 4. 改动文件清单

- `src/services/app-update.ts`
- `src/services/app-update.test.ts`

## 5. 验证结果

- `pnpm exec vitest run src/services/app-update.test.ts` 通过。
- `pnpm check` 通过，74 个测试全部通过。
- `cargo check` 通过。
- 本机真实网络验证：`https://github.com/FingerCaster/PixAI-Tauri/releases/latest` 解析到 `0.0.2`，`expanded_assets/0.0.2` 解析到 `PixAI_0.0.2_x64-setup.exe`。
- 已重启本地 debug 桌面壳 `src-tauri/target/debug/pixai-tauri.exe` 供手动验证。

## 6. 遗留事项

- 当前 GitHub 最新版本和本地应用版本同为 `0.0.2`，手动检查应显示“当前已是最新版本”。等后续发布 `0.0.3` 后，可再验证“打开下载”路径实际打开安装包下载链接。
