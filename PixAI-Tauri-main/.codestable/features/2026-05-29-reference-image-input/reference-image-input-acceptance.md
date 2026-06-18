# Reference Image Input 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-05-29
> 关联方案 doc：`.codestable/features/2026-05-29-reference-image-input/reference-image-input-design.md`

## 1. 接口契约核对

**接口示例逐项核对**：

- [x] `ClipboardEvent` 包含图片 `File` → `Composer` 的 `onPromptPaste` 提取图片并调用 `importReferenceFiles([file])`。代码实际行为一致，测试覆盖：`imports pasted images from the prompt textarea as reference images`。
- [x] `ClipboardEvent` 只包含 `text/plain` → 不调用 `importReferenceFiles`，不阻止默认粘贴。代码实际行为一致，测试覆盖：`keeps text paste in the prompt textarea`。
- [x] Tauri `DragDropEvent` 包含本地图片路径 → `Composer` 通过 `onDragDropEvent` 接住 `paths`，读取为 `ReferenceImageFilePayload` 后调用 `importReferencePayloads(payloads)`。代码实际行为一致，测试覆盖：`imports Tauri-dropped image paths inside the prompt box as reference images`。

**名词层"现状 → 变化"逐项核对**：

- [x] `ReferenceImage` / `Conversation` 不变：`src/shared/types.ts` 未改动。
- [x] `Composer` 新增 clipboard / DOM drag data / Tauri drag-drop path 的图片提取入口：`imageFilesFromTransfer`、`onPromptPaste`、`onPromptDrop`、`onDragDropEvent` 已落地。
- [x] DOM `File` 导入继续复用 `useAppStore.importReferenceFiles`；Tauri 本地路径导入新增 `useAppStore.importReferencePayloads`，底层复用既有 `pixaiApi.reference.importPayloads` / 数据库参考图契约。

**流程图核对**：

- [x] 事件中无图片 → 保留默认行为：文字粘贴和非图片 drop 测试均验证不触发导入。
- [x] 事件中有图片 → 阻止默认事件并调用导入 action：粘贴图片、DOM 拖入图片、Tauri 路径拖入图片测试均验证。
- [x] 数据库校验、缩略条展示仍由现有链路承担，本次未绕开。

## 2. 行为与决策核对

**需求摘要逐项验证**：

- [x] 提示词输入区粘贴图片会追加参考图：组件测试验证导入 action 被调用。
- [x] 提示词输入区拖入多张图片会按顺序追加：DOM 组件测试验证传入文件名顺序为 `one.png`、`two.webp`；Tauri 路径拖放测试验证只读取图片路径并忽略 `notes.txt`。
- [x] 普通文字粘贴不被图片逻辑拦截：组件测试验证 `dispatchEvent` 未被取消，导入 action 未被调用。

**明确不做逐项核对**：

- [x] 不从远程 URL、HTML `<img>` 或富文本下载图片：grep 未发现新增 `fetch` / 远程下载逻辑；现有 `<img>` 命中均为参考图预览渲染。
- [x] 不新增参考图数据模型、数量上限或大小限制：`src/shared/types.ts` 未改；数据库限制继续由现有代码承担。
- [x] 不改变上传按钮、历史图转参考图、生成请求语义：本次 diff 只改 `Composer` 输入事件与测试。
- [x] 不在 prompt 文本里插入图片占位符：grep 未发现新增占位符逻辑。

**关键决策落地**：

- [x] 复用已有导入契约：DOM `File` 入口最终调用 `importReferenceFiles(files)`；Tauri `paths` 入口先调用 `readLocalImageFile(path)`，再调用 `importReferencePayloads(payloads)`。
- [x] 只在发现图片文件时拦截：`onPromptPaste` / `onPromptDrop` 均先检查 `imageFiles.length`。
- [x] 拖入输入区和拖入参考图按钮保持同一路径：两者都走 `onFiles`，且按钮 drop 增加 `stopPropagation` 避免双触发。

**编排层"现状 → 变化"逐项核对**：

- [x] 在 `Composer` 主输入区前插入新事件分支；浏览器/DOM 拖放导入拓扑不变，Tauri 桌面端增加路径读取到 payload 的桥接步骤。
- [x] 图片文件过滤只在组件内部完成，不引入新并发任务或后端流程。

**流程级约束核对**：

- [x] 错误语义沿用现有 store toast：未新增错误处理分支。
- [x] 幂等性保持一次事件一次导入请求：无 hash 去重或缓存分支。
- [x] 多文件顺序保持：测试核对拖入文件顺序。
- [x] 可观测点保持参考图状态更新：导入 action 被调用后仍由现有 conversation state 驱动缩略条。

**挂载点反向核对**：

- [x] 挂载点 1：`Composer` 主提示词输入区新增 `onPaste`、`onDragOver`、`onDrop`，并在 Tauri runtime 注册 `onDragDropEvent`。
- [x] 挂载点 2：参考图导入入口复用 `importReferenceFiles`，并为 Tauri path payload 增加 `importReferencePayloads` store action。
- [x] 反向 grep：新增引用集中在 `Composer.tsx` 和 `Composer.test.tsx`，无清单外用户可见挂载点。
- [x] 拔除沙盘推演：移除输入区事件与 `imageFilesFromTransfer` helper 后，粘贴/拖入图片能力消失，上传按钮入口仍保留。

## 3. 验收场景核对

- [x] **S1**：主提示词输入区粘贴 PNG/JPEG/WEBP 图片文件 → 调用参考图导入 action。
  - 证据来源：组件测试 `imports pasted images from the prompt textarea as reference images`。
  - 结果：通过。
- [x] **S2**：主提示词输入区拖入一个或多个图片文件 → 按文件顺序追加。
  - 证据来源：组件测试 `imports dropped images from the prompt box as reference images`。
  - 结果：通过。
- [x] **S2b**：真实 Tauri 客户端中主提示词输入区拖入本地图片路径 → 图片路径被读取并追加为参考图。
  - 证据来源：组件测试 `imports Tauri-dropped image paths inside the prompt box as reference images`；真实客户端进程通过 `pnpm dev:client` 运行；用户在 `PixAI Dev` 窗口人工验证拖入图片通过。
  - 结果：通过。
- [x] **S3**：主提示词输入区粘贴普通文字 → 默认文字粘贴不被拦截。
  - 证据来源：组件测试 `keeps text paste in the prompt textarea`。
  - 结果：通过。
- [x] **S4**：粘贴或拖入非图片文件 → 图片导入逻辑不触发。
  - 证据来源：组件测试 `ignores non-image drops in the prompt box`。
  - 结果：通过。
- [x] **S5**：图片数量、格式或大小超出现有限制 → 沿用现有错误语义。
  - 证据来源：代码审查确认新入口复用 `importReferenceFiles`，未新增错误分支。
  - 结果：通过。

**前端验证**：

- [x] `pnpm check`：TypeScript + 全量 Vitest 通过，18 个测试文件、89 个用例通过。
- [x] `pnpm build`：生产构建通过。
- [x] Vite preview smoke：`http://127.0.0.1:4173` 返回包含 React root 的 `index.html`。
- [x] Chromium 截图：通过临时 `npx playwright@1.49.1` 截图验证工作台加载正常，截图见 `.codestable/features/2026-05-29-reference-image-input/reference-image-input-preview.png`。

## 4. 术语一致性

- **输入区**：代码继续使用 `prompt-box` / `prompt-textarea`，未新增冲突概念。
- **参考图**：沿用 `referenceImages` / `ReferenceImage` / `importReferenceFiles` 命名。
- **粘贴图片 / 拖入图片**：代码用 `onPromptPaste` / `onPromptDrop` 表达事件入口，和方案一致。
- 防冲突：grep 未发现新增远程图片下载、图片占位符或平行参考图模型。

## 5. 架构归并

- [x] `.codestable/architecture/ui-shadcn-workbench.md`：已把 `Composer` 职责更新为主提示词输入区可把粘贴或拖入的本地图片转交给现有参考图导入流程。
- [x] `.codestable/architecture/ui-shadcn-workbench.md`：已把隐藏文件上传 input 的约束扩展为“粘贴 / 拖入图片只是新增入口，不能替代文件选择控件”。
- [x] frontmatter 已更新 `last_reviewed: 2026-05-29`，并把 `implements` 关联到 `reference-image-input`。

## 6. requirement 回写

- [x] `requirement: reference-image-input` 指向 draft req，已升级为 `status: current`。
- [x] `implemented_by` 已关联 `ui-shadcn-workbench`。
- [x] `requirements/VISION.md` 已把 `reference-image-input` 从 draft 移到 current。
- [x] req 文末已追加 2026-05-29 变更日志。

## 7. roadmap 回写

- [x] 非 roadmap 起头，design frontmatter 没有 `roadmap` / `roadmap_item`，跳过。

## 8. attention.md 候选盘点

- [x] 本 feature 未暴露需要补入 attention.md 的内容。命令、环境和路径均沿用项目现有约定。

## 9. 遗留

- 后续优化点：无。
- 已知限制：无。
- 实现阶段顺手发现：无。
