---
doc_type: issue-fix
issue: 2026-06-05-workspace-image-to-image-base64-data-url-error
path: standard
fix_date: 2026-06-06
related: [workspace-image-to-image-base64-data-url-error-report.md, workspace-image-to-image-base64-data-url-error-analysis.md]
tags: [workspace, image-to-image, generation, tauri]
---

# Workspace Image-To-Image Base64 Data URL Error 修复记录

## 1. 实际采用方案

按 analysis 的方案 A 修复：

- `src/lib/platform.ts` 新增远程图片下载与 browser fallback。
- `src-tauri/src/lib.rs` 新增 `read_remote_image_url` command，支持 HTTP/HTTPS、PNG/JPG/WEBP、20MB 限制。
- `src/services/image-service.ts` 在落盘前把普通 `image.url` 转成 base64 data URL。
- 成功计数后移到 history 成功写入之后。

## 2. 改动文件

- `src/lib/platform.ts`
- `src-tauri/src/lib.rs`
- `src/services/image-service.ts`
- `src/lib/platform.test.ts`
- `src/services/image-service.test.ts`

## 3. 验证结果

- `pnpm vitest run src/lib/platform.test.ts src/services/image-service.test.ts src/adapters/openai-compatible.test.ts`
- `pnpm check`
- `cargo check`

新增覆盖：

- browser runtime 下远程图片 URL 会被下载成 base64 data URL。
- provider 返回远程 `image.url` 时，`ImageService.generate()` 会先下载再保存成功历史。

## 4. 遗留事项

还需要在真实 Tauri 开发客户端中用现场参考图重跑一次经典工作台图生图，确认历史里不再出现该错误。
