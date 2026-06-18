---
doc_type: decision
category: tech-stack
date: 2026-05-24
slug: shadcn-tailwind-ui-stack
status: active
area: frontend-ui
tags: [react, shadcn, tailwind, ui]
---

## 背景

PixAI 的前端已经从手写全局 `src/styles.css` 迁移到 React + Tailwind v4 + shadcn/ui。用户明确要求不做新旧样式体系共存，而是全量重写 UI，并把 shadcn 作为项目内可维护的组件源码层。

## 决定

PixAI 前端 UI 栈采用 Tailwind v4 + shadcn/ui。shadcn primitives 统一放在 `src/components/ui/`，页面和业务组件通过 `@/components/ui/*`、`@/lib/utils` 的 `cn(...)` 与 Tailwind utility class 组合界面。

主题使用 `src/index.css` 中的 CSS variables 和 `.dark` class 控制；现有 Zustand `darkMode` 仍是应用主题状态来源，不引入 `next-themes`。

## 理由

- shadcn/ui 以源码形式进入项目，适合桌面工作台这种需要高密度定制的界面，不会把交互细节锁进黑盒组件库。
- Tailwind v4 与 `@tailwindcss/vite` 已接入 Vite/Tauri 构建链，能直接服务 React 桌面端页面。
- shadcn 的 Radix primitives 能覆盖 Dialog、Tabs、Select、ScrollArea、Switch、Checkbox 等设置和工作台高频控件。
- CSS variables 与 Tailwind token 让 light/dark 主题、border、ring、popover、sidebar 等语义色有统一入口。

## 考虑过的替代方案

- 继续维护旧 `src/styles.css`：已被放弃，因为它会让旧全局 class 与 shadcn/Tailwind 长期共存，增加界面一致性和回归成本。
- 引入封装型商业组件库：未采用，因为 PixAI 需要在本仓内直接控制组件源码、密度、状态和桌面工作台布局。
- 使用 `next-themes`：未采用，因为项目不是 Next.js，现有 Zustand `darkMode` + `.dark` class 已能满足主题切换。

## 后果

- 新 UI 优先复用或扩展 `src/components/ui/*` 中的 shadcn primitives。
- 不应重新引入旧 `src/styles.css` 作为全局样式体系；项目样式入口是 `src/index.css`。
- 页面级样式允许使用 Tailwind utility class，但复杂 class 合并应走 `cn(...)`。
- 主题相关颜色应使用语义 token，不在页面组件里新增成片硬编码颜色。

## 相关文档

- `.codestable/roadmap/shadcn-ui-rewrite/shadcn-ui-rewrite-roadmap.md`
- `.codestable/architecture/ui-shadcn-workbench.md`
