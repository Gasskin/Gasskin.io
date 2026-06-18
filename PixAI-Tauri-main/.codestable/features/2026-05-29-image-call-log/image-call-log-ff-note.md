---
doc_type: feature-ff-note
feature: image-call-log
date: 2026-05-29
requirement:
tags: [workspace, image-generation, history, diagnostics]
---

## 做了什么
图片生成结果卡片新增“查看调用日志”入口。新生成的历史项会保存本次真实调用的供应商、端点、传输方式、请求 headers 与请求 body，便于排查图生图到底走了哪个端点。

## 改了哪些
- `src/shared/types.ts` — 新增 `ImageGenerationCallLog`，并挂到 `ImageHistoryItem.callLog`。
- `src/adapters/openai-compatible.ts` / `src/services/image-service.ts` — 在 adapter 构造真实请求时回传脱敏日志，生成服务随成功/失败历史项落库。
- `src/components/workspace/ImageTile.tsx` / `ImageCallLogModal.tsx` — 卡片底部新增日志按钮和弹窗，支持复制完整日志。
- `src/adapters/openai-compatible.test.ts` / `src/services/service-routing.test.ts` / `src/components/workspace/ImageTile.test.tsx` — 覆盖端点、请求体、脱敏、落库和弹窗展示。

## 怎么验证的
`pnpm check` 通过，19 个测试文件、94 个用例全绿。真实 `PixAI Dev` 客户端通过 Codex Bridge 接本地 mock 图像接口完成一次生成，返回历史项 `status=succeeded`，`callLogEndpoint=http://127.0.0.1:52908/v1/images/generations`，并确认 Provider 设置已恢复到原 AIO 配置。
