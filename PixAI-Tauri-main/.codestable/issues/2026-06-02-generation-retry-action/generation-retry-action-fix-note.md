---
doc_type: issue-fix
issue: 2026-06-02-generation-retry-action
path: fast-track
fix_date: 2026-06-02
tags: [image-generation, retry, frontend]
---

# 图片失败重试与手动重试修复记录

## 1. 问题描述

图片请求失败后没有自动重试；当配置的自动重试全部失败后，工作台失败图片卡片也没有直接重试入口，用户只能手动重新发起生成或回填参数。

## 2. 根因

- 默认失败重试次数为 `0`，新会话默认不会重试。
- `ImageTile` 的失败态只提供查看调用日志和删除，没有手动重试按钮。
- 最终失败图片的重试次数标记被 `shouldShowFailedImageRetryChip` 硬关闭，即使失败记录带有 `retryAttempt` 也不会展示。

## 3. 修复方案

- 将默认失败重试次数改为 `1`；高级配置里的“失败重试次数”继续作为用户可调配置，设为 `0` 时可关闭自动重试。
- 保持 `ImageService` 按配置重试，不做隐藏强制重试。
- 在失败图片卡片增加“重试”按钮，点击后通过 `retryHistory` 按原失败记录的提示词、模型、比例、尺寸、质量重新生成 1 张图片。
- 最终失败记录如果经历过重试，显示“重试第 N 次”标记。

## 4. 改动文件清单

- `src/shared/image-options.ts`
- `src/services/image-service.ts`
- `src/services/service-routing.test.ts`
- `src/store/app-store.ts`
- `src/store/app-store.test.ts`
- `src/components/workspace/ImageTile.tsx`
- `src/components/workspace/ImageTile.test.tsx`
- `src/generation-retry-display.ts`
- `src/generation-retry-display.test.ts`

## 5. 验证结果

- `pnpm vitest run src/services/service-routing.test.ts src/generation-retry-display.test.ts src/components/workspace/ImageTile.test.tsx src/store/app-store.test.ts` 通过。
- `pnpm check` 通过。
- 24 个测试文件全部通过。
- 107 个测试用例全部通过。

## 6. 遗留事项

既有旧会话如果已经保存了 `maxRetries: 0`，会继续按用户配置不自动重试；需要在高级配置里把“失败重试次数”调到 1 或更高。新会话默认是 1。
