---
doc_type: feature-ff-note
feature: expand-prompt-editor
date: 2026-05-23
requirement:
tags: [workspace, prompt, composer, modal]
---

## 做了什么

给工作区提示词输入框增加放大编辑能力，长提示词可以在大弹层里查看和编辑，避免在小输入框里反复滚动看不全。

## 改了哪些

- `src/components/workspace/Composer.tsx` — 增加放大按钮和提示词放大编辑弹层，弹层内编辑实时同步当前会话提示词。
- `src/styles.css` — 调整提示词底部工具栏列布局，新增放大按钮和弹层样式。
- `src/components/workspace/Composer.test.tsx` — 增加放大编辑入口的组件回归测试。

## 怎么验证的

`pnpm check` 通过，TypeScript 检查和 65 个测试全部通过。使用 Vite 本地页面和 Edge DevTools 验证放大按钮可打开弹层，弹层尺寸、关闭按钮和生成按钮正常渲染。
