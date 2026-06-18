---
doc_type: architecture
slug: ui-shadcn-workbench
scope: PixAI React 前端 UI 基座、工作台、设置系统、图库和提示词库的当前结构
summary: 前端界面已统一到 Tailwind v4 + shadcn/ui primitives，业务状态仍由 Zustand store 提供。
status: current
last_reviewed: 2026-05-29
tags: [ui, react, shadcn, tailwind, desktop-workbench]
depends_on: []
implements: [reference-image-input]
---

## 0. 术语

- **UI 基座**：`src/index.css`、`src/lib/utils.ts`、`src/components/ui/*` 与 `components.json` 组成的 Tailwind/shadcn 入口。
- **工作台主界面**：`App` + `MainLayout` + `Workspace`，负责桌面应用框架、会话列表、生成区和右侧参数栏。
- **低频全局设置**：`GlobalSettingsModal` 下的常规、通知、服务、扩展配置，不直接嵌在生图主流程里。

## 1. 定位与受众

这份文档记录 PixAI 当前 React UI 的现状结构，供后续 feature-design、issue-analyze 和 UI 重构时定位边界。它只描述已经落地的 Tailwind/shadcn 工作台，不规划未来 UI。

读完后应能判断：新页面从哪里接入、组件库入口在哪里、主题如何生效、设置系统和工作台高频参数如何分层。

## 2. 结构与交互

### 2.1 UI 基座

`src/main.tsx` 只挂载 `App` 并导入 `src/index.css`，所以全局样式入口集中在一个文件内。`src/main.tsx:1` `src/main.tsx:4`

`src/index.css` 导入 Tailwind、shadcn Tailwind 支持、动画和 Geist 字体，并在 `@theme inline` 中把 CSS variables 映射为 Tailwind 语义 token。`src/index.css:1` `src/index.css:8`

light/dark 主题变量分别定义在 `:root` 和 `.dark`，基础层设置了固定桌面最小尺寸、页面溢出和全局 cursor 规则。`src/index.css:51` `src/index.css:86` `src/index.css:120`

shadcn 配置固定为 TSX、CSS variables、lucide 图标和 `@/components/ui` alias。`components.json:3` `components.json:6` `components.json:13` `components.json:15`

`cn(...)` 是 class 合并入口，组合 `clsx` 与 `tailwind-merge`。`src/lib/utils.ts:1`

### 2.2 应用 Shell 与页面路由

`App` 负责加载应用状态、监听 Tauri 事件、维护全局设置弹窗状态，并根据 `view` 渲染工作台、图库或提示词库。`src/App.tsx:15` `src/App.tsx:26` `src/App.tsx:100`

主题由 `useAppStore().darkMode` 决定，顶层容器在深色模式时添加 `.dark`，让 `src/index.css` 的变量生效。`src/App.tsx:16` `src/App.tsx:102`

`MainLayout` 承载固定桌面 shell：顶部导航、Provider 端点摘要、左侧会话列表、右侧参数栏列宽切换和页脚设置入口。`src/components/layout/MainLayout.tsx:40` `src/components/layout/MainLayout.tsx:55` `src/components/layout/MainLayout.tsx:78`

导航状态、会话操作、主题切换和参数栏显隐都来自 Zustand store，UI 重写没有改变业务 action 的归属。`src/components/layout/MainLayout.tsx:20`

### 2.3 工作台生成流

`Workspace` 是生成页容器，只负责选出当前会话、当前会话 runs 和生成状态，再组合 `Composer` 与 `CanvasArea`。`src/components/workspace/Workspace.tsx:5` `src/components/workspace/Workspace.tsx:21`

`Composer` 承载提示词、参考图、灵感/丰富 prompt、生成按钮、提示词放大编辑和参考图预览；提示词编辑先进入组件本地 draft buffer，中文输入法 composition 结束或短延迟后再写回 `useAppStore`，避免异步持久化回写打断中间插入；主提示词输入区可把粘贴、DOM 拖入的图片 `File` 交给 `importReferenceFiles`，也可在 Tauri runtime 中把原生拖放路径读取成 payload 后交给 `importReferencePayloads`。`src/components/workspace/Composer.tsx:16` `src/components/workspace/Composer.tsx:33` `src/components/workspace/Composer.tsx:164` `src/store/app-store.ts:451`

`CanvasArea` 负责把 runs 映射为分页网格条目，生成中占位、失败清理和结果 summary 都在这里汇总。`src/components/workspace/CanvasArea.tsx:21` `src/components/workspace/CanvasArea.tsx:71` `src/components/workspace/CanvasArea.tsx:119`

`ImageTile` 负责单张结果的成功/失败展示、预览、复制、下载、收藏、删除和作为参考图编辑。`src/components/workspace/ImageTile.tsx:13` `src/components/workspace/ImageTile.tsx:65` `src/components/workspace/ImageTile.tsx:110`

`WorkspaceConfigPanel` 右侧工作区设置承载高频生成参数和引擎默认项；引擎卡片可直接切换图片 Provider、提示词 Provider、图片模型、提示词模型和生图端点，保存时回写对应 Provider profile 与当前会话模型。`src/components/settings/workspace/WorkspaceConfigPanel.tsx:44` `src/components/settings/workspace/WorkspaceConfigPanel.tsx:90` `src/components/settings/workspace/WorkspaceConfigPanel.tsx:172`

### 2.4 设置系统

工作区右侧 `WorkspaceConfigPanel` 只承载高频会话参数和当前默认 Provider / 模型 / 生图端点选择，并通过“管理服务”跳到全局 Services 设置。`src/components/settings/workspace/WorkspaceConfigPanel.tsx:41` `src/components/settings/workspace/WorkspaceConfigPanel.tsx:84` `src/components/settings/workspace/WorkspaceConfigPanel.tsx:178`

`GlobalSettingsModal` 使用 shadcn Dialog + Tabs + ScrollArea，按 General、Notifications、Services、Extensions 四个 tab 组织低频应用级配置。`src/components/settings/global/GlobalSettingsModal.tsx:20` `src/components/settings/global/GlobalSettingsModal.tsx:42` `src/components/settings/global/GlobalSettingsModal.tsx:64`

`ServicesSettingsTab` 负责 Provider 默认选择、模型默认值、Provider 列表和 Provider 编辑弹窗入口；它复用 `GallerySelect`、`Input`、`Button`、`Card` 等 primitives。`src/components/settings/global/ServicesSettingsTab.tsx:14` `src/components/settings/global/ServicesSettingsTab.tsx:118` `src/components/settings/global/ServicesSettingsTab.tsx:225`

`ProviderProfileDialog` 是 Provider 创建/编辑表单，使用 Dialog、Input、Label、Button 与 Select 封装。`src/components/settings/providers/ProviderProfileDialog.tsx:20` `src/components/settings/providers/ProviderProfileDialog.tsx:35`

### 2.5 库页面

`GalleryPage` 负责跨会话历史查询、收藏筛选和批量下载/收藏/删除；卡片内容复用 `ImageTile`，多选使用 shadcn/Radix Checkbox primitive。`src/components/gallery/GalleryPage.tsx:12` `src/components/gallery/GalleryPage.tsx:63`

`PromptLibraryPage` 负责提示词模板查询、新建/编辑、复制、套用和删除，页面级布局使用 Card/Input/Textarea/Button primitives。`src/components/prompts/PromptLibraryPage.tsx:11` `src/components/prompts/PromptLibraryPage.tsx:25` `src/components/prompts/PromptLibraryPage.tsx:82`

## 3. 数据与状态

UI 不直接持久化业务数据。`useAppStore` 仍拥有视图、主题、设置、偏好、会话、runs、history、templates、生成状态、Codex skill 状态和 app update 状态。`src/store/app-store.ts:34` `src/store/app-store.ts:36`

全局初始化通过 `load()` 拉取 settings、preferences、conversations、runs、history 和 templates；UI 页面只消费这些状态并调用 store actions。`src/store/app-store.ts:164`

主题状态是 `darkMode`，切换 action 是 `toggleTheme()`；`App` 把它翻译为 `.dark` class。`src/store/app-store.ts:39` `src/store/app-store.ts:64` `src/store/app-store.ts:194` `src/App.tsx:102`

## 4. 关键决策

- UI 技术栈采用 Tailwind v4 + shadcn/ui，详见 `.codestable/compound/2026-05-24-decision-shadcn-tailwind-ui-stack.md`。这条决策约束后续页面优先扩展 `src/components/ui/*`，不恢复旧 `styles.css`。
- 设置系统继续分为工作区高频参数与全局低频设置。这个边界在总入口已有记录，并由 `WorkspaceConfigPanel` 与 `GlobalSettingsModal` 两个组件实现。`src/components/settings/workspace/WorkspaceConfigPanel.tsx:99` `src/components/settings/global/GlobalSettingsModal.tsx:42`

## 5. 代码锚点

- `src/main.tsx` — React 挂载与全局 CSS 入口。
- `src/index.css` — Tailwind/shadcn 导入、主题 token、dark variables、桌面尺寸基线。
- `components.json` — shadcn 项目配置和 alias。
- `src/components/ui/*` — shadcn primitives 源码。
- `src/lib/utils.ts:cn` — Tailwind class 合并工具。
- `src/App.tsx:App` — 应用生命周期、主题 class、全局设置弹窗、页面切换。
- `src/components/layout/MainLayout.tsx:MainLayout` — 桌面 shell、导航、会话列表、参数栏列布局。
- `src/components/workspace/Workspace.tsx:Workspace` — 工作台组合入口。
- `src/components/settings/workspace/WorkspaceConfigPanel.tsx:WorkspaceConfigPanel` — 高频生图参数栏。
- `src/components/settings/global/GlobalSettingsModal.tsx:GlobalSettingsModal` — 低频全局设置容器。

## 6. 已知约束 / 边界情况

- UI 重写不得改变 `useAppStore` actions 的业务语义；视觉组件从 store 读取或调用 action，但不重新定义持久化边界。`src/store/app-store.ts:60`
- 高频生图参数必须在工作区一层可达；Provider 完整维护在全局 Services tab 内。`src/components/settings/workspace/WorkspaceConfigPanel.tsx:121` `src/components/settings/global/ServicesSettingsTab.tsx:118`
- 应用是桌面工作台，当前 CSS 基线设置了 `1080px × 720px` 最小尺寸，不按移动端响应式重排。`src/index.css:126`
- 隐藏文件上传 input 仍保留在 `Composer` 中，因为浏览器文件选择能力需要真实 file input 作为入口；粘贴 / 拖入图片只是新增入口，不能替代文件选择控件。Windows Tauri 默认文件拖放会先进入原生 `onDragDropEvent`，不能只依赖 HTML5 `DataTransfer.files`。`src/components/workspace/Composer.tsx:71` `src/components/workspace/Composer.tsx:167`

## 7. 相关文档

- `.codestable/compound/2026-05-24-decision-shadcn-tailwind-ui-stack.md`
- `.codestable/roadmap/shadcn-ui-rewrite/shadcn-ui-rewrite-roadmap.md`
- `.codestable/roadmap/shadcn-ui-rewrite/shadcn-ui-rewrite-items.yaml`
