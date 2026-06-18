---
doc_type: issue-fix
issue: 2026-05-23-generation-completion-preview
path: fast-track
fix_date: 2026-05-23
tags: [notification, image-preview, frontend]
---

# 生成完成通知和图片预览修复记录

## 1. 问题描述

- 系统通知只在生成成功时发送，生成失败时只有应用内 toast。
- 图片预览弹层在大图场景下容易显示不全，关闭按钮点击区域偏小。

## 2. 根因

- `src/store/app-store.ts` 只在 `!result.canceled && !result.errorMessage` 时调用系统通知函数，失败结果和异常路径没有进入系统通知。
- `src/styles.css` 中图片预览面板尺寸偏保守，预览图片主要依赖 `max-width: 100%` / `max-height: 100%`，在部分大图比例下会优先按宽度撑开，导致需要滚动或看不到完整图。
- `ImagePreviewModal` 复用通用 34px 图标按钮，预览弹层里的关闭操作不够醒目。

## 3. 修复方案

- 将成功专用通知函数改为生成结束通知函数：只要生成结束且不是取消，就在失焦、开关开启、权限允许时发送一条系统通知；成功和失败分别使用完成/失败标题。
- 设置面板文案从“生图成功通知”改为“生图完成通知”，说明成功或失败都会提示。
- 放大图片预览弹层可用面积，关闭按钮改为 42px，图片用视口高度约束完整收进预览区域。

## 4. 改动文件清单

- `src/store/app-store.ts`
- `src/store/app-store.test.ts`
- `src/components/settings/SettingsPanel.tsx`
- `src/components/workspace/ImagePreviewModal.tsx`
- `src/styles.css`

## 5. 验证结果

- `pnpm vitest run src/store/app-store.test.ts src/components/workspace/ImageTile.test.tsx` 通过。
- `pnpm check` 通过，63 个测试全部通过。
- 浏览器验收通过：使用临时本地 mock provider 生成大图，图片预览中大图完整显示，关闭按钮尺寸为 42px。

## 6. 遗留事项

无。
