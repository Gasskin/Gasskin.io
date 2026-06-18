---
doc_type: issue-analysis
issue: 2026-06-05-workspace-image-to-image-base64-data-url-error
status: confirmed
tags: [workspace, image-to-image, generation, tauri]
---

# Workspace Image-To-Image Base64 Data URL Error 分析

## 1. 定位

- `src/adapters/openai-compatible.ts` 会把 provider payload 中的 `url` / `image_url` 识别为合法图片结果。
- `src/services/image-service.ts` 原先在 `imageDataToDataUrl()` 中直接返回 `image.url`。
- `src-tauri/src/lib.rs` 的 `store_data_url_file` 会调用 `decode_data_url()`，只接受包含 `;base64,` 的 base64 data URL。

因此，当 provider 返回普通 HTTP/HTTPS 图片 URL 时，`ImageService` 把它当作 data URL 传入 Tauri 写盘，最终触发 `图片数据必须是 base64 data URL。`

## 2. 根因

输出侧没有对 provider 返回的远程 `image.url` 做格式归一化；输入侧参考图会在请求前恢复成 data URL，但输出侧只覆盖了 `b64_json` happy path。

## 3. 方案

采用方案 A：

- 在 platform 层新增 `readRemoteImageUrl()` / Tauri `read_remote_image_url`，统一把 HTTP/HTTPS 图片下载成 `{ name, mimeType, dataUrl, fileSizeBytes }`。
- 在 `ImageService` 输出侧遇到普通 `image.url` 时，先调用 platform 下载，再把 base64 data URL 交给现有 `storeDataUrlFile()`。
- 把 `succeededCount += 1` 移到落盘和成功 history 写入之后，避免落盘失败时 run 被提前计成功。

## 4. 边界

本修复只处理 provider 返回的生成结果 URL，不增加 prompt 自动解析远程图，也不改变参考图数据模型。
