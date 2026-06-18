---
doc_type: issue-fix
issue: 2026-05-23-workspace-pagination-scroll
path: fast-track
fix_date: 2026-05-23
tags: [workspace, pagination, scroll, frontend]
---

# 工作区分页滚动修复记录

## 1. 问题描述

工作区图片数量较多时，图片网格会把主内容撑高。由于应用外层禁用了整页滚动，底部页数和上一页/下一页按钮可能被挤到可视区域外，用户无法翻页。

## 2. 根因

`main-surface` 自身作为主网格子项有固定可用高度，但内部页面不是可伸缩布局子项。`workspace` 因此按内容高度扩张，导致 `canvas-area` 虽然声明了 `overflow: auto`，却没有实际受限高度可用于产生滚动条。

## 3. 修复方案

- 将 `main-surface` 改为纵向 flex 容器。
- 让 `main-surface` 的直接子内容占满可用高度，并允许 `min-height: 0`，使工作区的 `canvas-area` 能在固定高度里滚动。
- 该高度模型同时适用于图库和提示词库页面，避免相同外层容器问题在其它页面复现。

## 4. 改动文件清单

- `src/styles.css`

## 5. 验证结果

- `pnpm check` 通过，13 个测试文件、63 个测试全部通过。
- 浏览器验收通过：注入 60 张测试图片后，工作区当前页 30 张图片可在 `canvas-area` 内滚动；滚到底部后页数 `1 / 2`、上一页/下一页按钮和每页数量选择器可见并可操作。
- 验收截图：`workspace-scroll-verification.png`。

## 6. 遗留事项

无。
