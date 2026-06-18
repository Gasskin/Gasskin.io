---
doc_type: feature-ff-note
feature: workspace-image-endpoint
date: 2026-05-29
requirement:
tags: [workspace, provider-settings, image-endpoint]
---

## 做了什么

在主页右侧工作区的“引擎”卡片里加入“生图端点”选择，用户不用再进入全局设置弹窗才能在 `Images API` 和 `Responses 图像工具` 之间切换。

## 改了哪些

- `src/components/settings/workspace/WorkspaceConfigPanel.tsx` — 增加 `imageGenerationEndpoint` 本地状态、Provider 切换联动和保存时写回图片 Provider。
- `src/components/common/GallerySelect.tsx` — 增加 `disabled` 参数，支持主页无图片 Provider 时禁用端点下拉框。
- `src/components/settings/workspace/WorkspaceConfigPanel.test.tsx` — 覆盖主页保存生图端点会调用 `upsertProfile` 写回当前图片 Provider。
- `.codestable/architecture/ui-shadcn-workbench.md` — 回写工作区引擎卡片当前职责。

## 怎么验证的

`pnpm test -- WorkspaceConfigPanel.test.tsx` 通过；`pnpm check` 通过，19 个测试文件、93 个用例全绿。
