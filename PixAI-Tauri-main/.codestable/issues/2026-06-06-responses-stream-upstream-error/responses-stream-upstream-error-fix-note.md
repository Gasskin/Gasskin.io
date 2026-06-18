---
doc_type: issue-fix
issue: 2026-06-06-responses-stream-upstream-error
path: fast-track
fix_date: 2026-06-06
tags: [responses-api, image-generation, provider-error]
---

# Responses Stream Upstream Error 修复记录

## 1. 问题描述

经典工作台使用 `responses-api` 端点生成图片时，调用日志显示 HTTP 200，但 SSE payload 中出现 `type: "error"`，最终出现 `type: "response.failed"`，provider error 为 `upstream_error` / `Upstream request failed`。

旧逻辑没有识别 HTTP 200 内部的 Responses SSE 失败，最终报成通用的“Responses 图像工具没有返回可识别的图片”。

## 2. 修复方案

- 在 Responses 图像工具路径中新增 SSE provider error 提取。
- 支持 `type: "error"`、`type: "response.failed"` 下的 `response.error`，以及仅含 `code/message` 的错误对象。
- 当没有最终图片且存在 provider error 时，抛出 `ProviderHttpError`，主错误直接显示 provider 的 `message/code`。
- `responseSummary` 增加 `providerError`，保留排障证据。

## 3. 改动文件

- `src/adapters/openai-compatible.ts`
- `src/adapters/openai-compatible.test.ts`

## 4. 验证结果

- `pnpm vitest run src/lib/platform.test.ts src/services/image-service.test.ts src/adapters/openai-compatible.test.ts`
- `pnpm check`
- `cargo check`

新增覆盖：

- HTTP 200 + `type:error` + `response.failed` 时，主错误为 `Upstream request failed（upstream_error）`，details 保留 `providerError`。

## 5. 遗留事项

该日志中的 AIO 上游确实返回了 `upstream_error`。本修复只保证本地诊断和错误归类准确；若要继续追上游兼容性，需要对照 AIO 对 `gpt-image-2` + Responses image_generation tool 的支持情况。
