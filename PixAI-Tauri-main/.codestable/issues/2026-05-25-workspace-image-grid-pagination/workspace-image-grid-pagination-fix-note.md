---
doc_type: issue-fix
issue: 2026-05-25-workspace-image-grid-pagination
path: fast-track
fix_date: 2026-05-25
tags: [workspace, image-grid, pagination, frontend]
---

# 工作区图片网格和分页展示修复记录

## 1. 问题描述

工作区有多张图片时，图片卡片会被同一行其它卡片异常撑高，出现多行 item 错位；只有单张图片时卡片高度偏大。底部分页中的页码和每页数量展示过长，在窄空间下容易换行。

## 2. 根因

工作区图片网格使用了 `auto-rows-fr`。在可滚动网格中，该设置会让隐式行按可用空间和内容共同分配高度，导致卡片被拉伸，单张和多张布局都不稳定。分页文字使用带空格的 `1 / 2`、`30 / 页` 形式，且未对页码和每页选择器做固定收缩控制。

## 3. 修复方案

- 将工作区网格改为 `auto-rows-max`，并增加 `content-start`、`items-start`，让卡片按自身内容高度从顶部排列。
- 将成功、失败和生成中卡片的最小高度从 `320px` 收敛到 `300px`，改善单张图片时的视觉比例。
- 将分页页码展示压缩为 `1/2`，每页数量展示为 `30张`，并给页码和每页数量选择器增加不换行、固定宽度和收缩控制。

## 4. 改动文件清单

- `src/components/workspace/CanvasArea.tsx`
- `src/components/workspace/ImageTile.tsx`
- `src/components/workspace/GeneratingTile.tsx`

## 5. 验证结果

- `pnpm check` 通过：17 个测试文件、82 个测试全部通过。
- 使用本地 Vite 服务 `http://localhost:1422` 验证工作区可正常渲染。
- 通过临时视觉夹具加载项目真实 CSS 验证：31 张图片卡片前 12 张高度一致为 429px，网格在 `canvas-area` 内滚动；分页页码 `1/2` 宽 21px，页码不溢出。
- 用户反馈 `30/页` 在真实 Tauri 窗口里被压住后，补充调整为 `30张`，并将选择器加宽到 `w-20`、固定 `h-9`，移除 Select value 的单行裁切。

## 6. 遗留事项

浏览器插件截图接口在本地页面上超时，本次以前端 DOM 量测和自动化测试作为验证证据。
