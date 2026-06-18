---
doc_type: issue-fix
issue: 2026-05-29-prompt-ime-draft-input
path: fast-track
fix_date: 2026-05-29
tags: [workspace, prompt-input, ime, react, tauri]
---

# 提示词输入框中文输入法中间产物修复记录

## 1. 问题描述

提示词输入框在中间插入文本时偶发文本错乱；使用中文输入法时，有时会把 `zhong'sai` 这类拼音候选阶段的中间产物留进最终提示词。用户截图显示在把 `claude` 替换为 `gpt5.5`、并在句子中段输入中文时更容易出现。

## 2. 根因

`Composer` 的主提示词 textarea 直接以 `conversation.draftPrompt` 作为受控值，并在每次 `onChange` 时调用异步 `updateActiveConversation`。中间插入和输入法 composition 期间，旧的异步保存结果可能晚于新输入回写到 store，导致受控值被旧状态顶回；composition 阶段的拼音中间态也可能被当成普通输入保存。

## 3. 修复方案

- 在 `Composer` 内增加本地 `draftPrompt` buffer，用户编辑时先更新本地状态，避免 textarea 被异步 store 回写打断。
- composition 开始时暂停持久化，composition 结束后只保存最终文本，避免保存拼音候选中间态。
- 普通输入短延迟后保存，生成 / 丰富提示词前强制 flush 当前本地草稿。
- 在 `useAppStore.updateActiveConversation` 中加入 per-conversation 更新序号，只允许最后一次异步保存结果回写 store，避免旧保存请求晚返回覆盖新输入。

## 4. 改动文件清单

- `src/components/workspace/Composer.tsx`：提示词输入改为本地草稿 + composition-safe 保存；生成 / 丰富 prompt 前 flush 草稿。
- `src/store/app-store.ts`：`updateActiveConversation` 增加最后一次更新 wins 的版本保护。
- `src/components/workspace/Composer.test.tsx`：新增中间插入稳定性、IME composition 不保存中间产物的组件测试。
- `src/store/app-store.test.ts`：新增旧异步保存晚返回时不覆盖最新会话状态的 store 测试。
- `.codestable/architecture/ui-shadcn-workbench.md`：回写 `Composer` 当前提示词编辑结构。

## 5. 验证结果

- [x] `pnpm exec tsc --noEmit` 通过。
- [x] `pnpm test -- Composer.test.tsx app-store.test.ts` 通过，2 个测试文件、25 个用例全绿。
- [x] `pnpm check` 通过，18 个测试文件、92 个测试用例全绿。
- [x] 用户在真实 `PixAI Dev` 客户端验证通过：中间插入和中文输入法输入均正常，不再残留拼音中间产物。

## 6. 遗留事项

- 无。
