---
doc_type: issue-fix
issue: 2026-06-02-delete-confirmation
path: fast-track
fix_date: 2026-06-02
tags: [frontend, destructive-action, confirmation]
---

# 删除操作缺少二次确认修复记录

## 1. 问题描述

删除会话、删除图片等危险操作在多个 UI 入口中会直接执行，没有二次确认。用户误点后会立即删除记录，缺少恢复前的拦截机会。

## 2. 根因

多个组件直接调用 store 删除动作：

- `src/components/layout/MainLayout.tsx` 直接调用 `deleteConversation`。
- `src/components/gallery/GalleryPage.tsx` 直接调用 `deleteHistory`。
- `src/components/workspace/ImageTile.tsx` 直接调用 `deleteHistory`。
- `src/components/workspace/CanvasArea.tsx` 直接调用 `deleteHistoryItems`。
- `src/components/prompts/PromptLibraryPage.tsx` 直接调用 `deleteTemplate`。
- `src/components/workspace/Composer.tsx` 直接调用 `removeReferenceImage`。

服务配置删除已有 `window.confirm`，但其他 UI 删除入口没有同等保护。

## 3. 修复方案

新增 `confirmDestructiveAction` 小工具，统一包装 `window.confirm`。在所有 UI 删除入口调用删除动作前先确认；取消时不触发 store/API 删除。批量删除和清空失败记录只确认一次，并在确认文案里包含数量。

## 4. 改动文件清单

- `src/lib/confirm.ts`
- `src/components/layout/MainLayout.tsx`
- `src/components/gallery/GalleryPage.tsx`
- `src/components/workspace/ImageTile.tsx`
- `src/components/workspace/CanvasArea.tsx`
- `src/components/prompts/PromptLibraryPage.tsx`
- `src/components/workspace/Composer.tsx`
- `src/components/layout/MainLayout.test.tsx`
- `src/components/gallery/GalleryPage.test.tsx`
- `src/components/workspace/ImageTile.test.tsx`
- `src/components/workspace/CanvasArea.test.tsx`
- `src/components/prompts/PromptLibraryPage.test.tsx`
- `src/components/workspace/Composer.test.tsx`
- `src/components/settings/global/ServicesSettingsTab.test.tsx`

## 5. 验证结果

- `pnpm check` 通过。
- 23 个测试文件全部通过。
- 103 个测试用例全部通过。
- 测试覆盖会话删除、图库单图删除、图库批量删除、工作区清空失败记录、成功图片删除、失败图片删除、提示词模板删除、参考图移除、Provider 服务配置删除。

## 6. 遗留事项

当前采用系统级 `window.confirm` 做最小修复。若后续需要更统一的视觉体验，可另开 feature 将确认交互升级为应用内 AlertDialog。
