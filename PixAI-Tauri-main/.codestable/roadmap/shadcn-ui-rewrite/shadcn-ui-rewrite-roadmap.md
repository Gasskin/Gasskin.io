---
doc_type: roadmap
slug: shadcn-ui-rewrite
status: completed
created: 2026-05-24
last_reviewed: 2026-05-24
tags: [ui, shadcn, tailwind, redesign]
related_requirements: []
related_architecture: [ARCHITECTURE]
---

# Shadcn UI Rewrite

## 1. 背景

PixAI 当前前端是 React + Tauri + Zustand，界面层主要由手写 JSX 和 `src/styles.css` 承载。用户已明确要求废弃旧样式体系，使用 shadcn/ui 全量重写界面，并用 UI/UX Pro Max 规则约束桌面工作台体验，用 Gemini CLI 作为页面设计和评审辅助。

本 roadmap 的目标是把现有业务能力保留下来，替换 UI 基座、页面结构、基础交互组件和视觉系统，最终删除旧的全局手写样式。

## 2. 范围与明确不做

### 本 roadmap 覆盖

- 建立 Tailwind + shadcn/ui 基座和项目内 UI primitives。
- 重写 App shell、导航、会话列表、工作区布局、右侧参数面板。
- 重写 Prompt Composer、图片结果画布、生成/失败/预览状态。
- 重写全局设置、Provider 配置、应用更新、通知和扩展配置。
- 重写图库、提示词库和常见空状态/加载态/错误态。
- 删除旧 `src/styles.css`，通过测试和浏览器目视验证。

### 明确不做

- 不改变图片生成、Provider、历史记录、更新器、Codex bridge 等业务语义。
- 不新增新的图片生成能力或数据模型。
- 不保留旧样式体系作为长期兼容层。
- 不把 shadcn 组件当 npm 黑盒使用；组件源码进入项目并允许定制。

## 3. 模块拆分（概设）

```
shadcn-ui-rewrite
├── ui-foundation：Tailwind/shadcn 基座、设计 token、通用 cn/helper
├── app-shell：应用骨架、顶部导航、侧边会话列表、主题与全局状态入口
├── workspace-flow：Composer、参数入口、Canvas、ImageTile、预览与生成状态
├── settings-system：全局设置、Provider 表单、Toggle/Select/Dialog 等设置交互
├── library-pages：图库和提示词库
└── verification-cleanup：旧样式删除、测试、浏览器验收和回归清理
```

### ui-foundation · UI 基座

- **职责**：安装并配置 Tailwind、shadcn/ui、主题 token、基础 UI 组件和 class 合并工具。
- **承载的子 feature**：ui-foundation。
- **触碰的现有代码 / 模块**：`package.json`、Tailwind/Vite/TS 配置、`src/index.css`、`src/lib/utils.ts`、`src/components/ui/*`。

### app-shell · 应用骨架

- **职责**：重写应用外框、导航、会话列表、设置入口和全局 toast 容器；保持现有 store 绑定不变。
- **承载的子 feature**：app-shell.
- **触碰的现有代码 / 模块**：`src/App.tsx`、`src/components/layout/MainLayout.tsx`。

### workspace-flow · 核心工作流

- **职责**：重写生成工作台的提示词输入、参考图、生成按钮、结果网格、图片 tile、生成中/失败/预览弹窗。
- **承载的子 feature**：workspace-flow.
- **触碰的现有代码 / 模块**：`src/components/workspace/*`。

### settings-system · 设置系统

- **职责**：用 shadcn Dialog/Tabs/Form 控件重写全局设置、Provider 配置和工作区参数面板。
- **承载的子 feature**：settings-system.
- **触碰的现有代码 / 模块**：`src/components/settings/*`。

### library-pages · 图库和提示词库

- **职责**：用统一页面骨架重写图库和提示词库，保留查询、批量操作、复用、复制、删除等行为。
- **承载的子 feature**：library-pages.
- **触碰的现有代码 / 模块**：`src/components/gallery/*`、`src/components/prompts/*`。

### verification-cleanup · 验证与清理

- **职责**：删除旧 CSS 与残留 class，跑全量测试，使用浏览器检查主要页面无空白、无遮挡、关键交互可用。
- **承载的子 feature**：verification-cleanup.
- **触碰的现有代码 / 模块**：全前端 UI 文件、测试、构建配置。

## 4. 模块间接口契约 / 共享协议（架构层详设）

### 4.1 UI 组件导入协议

**方向**：页面模块 → UI 基座

**形式**：函数/组件导入

**契约**：

```ts
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
```

**约束**：

- 页面组件优先使用 `@/components/ui/*` 中的 shadcn primitives。
- 页面组件允许使用 Tailwind utility class，但不能重新引入旧 `styles.css` 的全局 class 体系。
- `cn(...classes)` 是 class 合并入口，禁止在复杂组件里手写易冲突的 class 拼接。

### 4.2 Zustand 业务状态协议

**方向**：UI 页面 → `useAppStore`

**形式**：函数调用 / React hook

**契约**：

```ts
const state = useAppStore()
const generate = useAppStore((state) => state.generate)
const updateActiveConversation = useAppStore((state) => state.updateActiveConversation)
```

**约束**：

- UI 重写不得改动 store action 名称、入参语义和返回行为。
- 组件 props 保持现有业务数据结构：`Conversation`、`GenerationRun`、`HistoryItem`、`ProviderProfile` 等类型不因视觉重写而改变。
- 如确需抽出纯展示子组件，外层容器仍负责从 store 取数并传入现有类型。

### 4.3 主题协议

**方向**：App shell → Tailwind/shadcn theme

**形式**：DOM class + CSS variables

**契约**：

```ts
<div className={darkMode ? 'dark min-h-dvh ...' : 'min-h-dvh ...'}>
```

**约束**：

- shadcn 使用 CSS variables 作为颜色入口。
- 现有 `darkMode` store 值继续是主题来源；不引入 `next-themes`。
- 深色模式通过顶层 `dark` class 生效。

### 4.4 视觉验收协议

**方向**：verification-cleanup → 所有 UI 模块

**形式**：测试命令 + 浏览器检查

**契约**：

```bash
pnpm check
pnpm build
```

主要页面必须能在 Vite dev server 下打开：工作台、图库、提示词库、全局设置。

**约束**：

- 测试和类型检查必须通过。
- 浏览器检查至少覆盖桌面宽度和较窄宽度，确认无空白、无明显文本重叠、关键弹窗可打开。

## 5. 子 feature 清单

1. **ui-foundation** — 安装 Tailwind/shadcn，建立 UI primitives、主题 token 和 `cn` 工具。
   - 所属模块：ui-foundation
   - 依赖：无
   - 状态：done
   - 对应 feature：未启动
   - 备注：最小闭环，完成后应用可继续启动并渲染旧页面。

2. **app-shell** — 用 shadcn/Tailwind 重写 App shell、顶部导航、侧栏会话列表、主题与设置入口。
   - 所属模块：app-shell
   - 依赖：ui-foundation
   - 状态：done
   - 对应 feature：未启动

3. **workspace-flow** — 重写 Composer、Canvas、ImageTile、生成状态和图片预览。
   - 所属模块：workspace-flow
   - 依赖：app-shell
   - 状态：done
   - 对应 feature：未启动

4. **settings-system** — 重写工作区参数面板、全局设置 Modal、Provider 配置和设置开关。
   - 所属模块：settings-system
   - 依赖：ui-foundation
   - 状态：done
   - 对应 feature：未启动

5. **library-pages** — 重写图库和提示词库页面。
   - 所属模块：library-pages
   - 依赖：app-shell, workspace-flow
   - 状态：done
   - 对应 feature：未启动

6. **verification-cleanup** — 删除旧 CSS，清理残留 class，跑测试和浏览器验收。
   - 所属模块：verification-cleanup
   - 依赖：workspace-flow, settings-system, library-pages
   - 状态：done
   - 对应 feature：未启动

**最小闭环**：第 1 条 `ui-foundation` 做完后，应用仍能启动并加载旧页面，同时新 UI 组件基座可被后续页面使用。

## 6. 排期思路

先做 `ui-foundation`，因为所有页面重写都依赖 Tailwind/shadcn 的 token 与 primitives。随后做 `app-shell`，让页面容器、主题、导航和侧栏先稳定下来。核心生成流与设置系统可以在基座稳定后推进，最后处理图库/提示词库和清理验证。

## 7. 观察项

- 当前 `ARCHITECTURE.md` 只描述总体结构，UI 现状文档不足；重写完成后建议用 `cs-arch update` 补充 UI 架构现状。
- 本次重写会引入 Tailwind 与 shadcn 作为长期技术约束，完成后建议用 `cs-decide` 记录选型。

## 8. 变更日志

- 2026-05-24：创建全量 shadcn UI 重写 roadmap。
- 2026-05-24：完成全量 UI 重写，删除旧样式体系，`pnpm check` / `pnpm build` / 浏览器 smoke 验证通过。
