---
doc_type: issue-fix
issue: 2026-06-06-upgrade-does-not-recover-blank-page
path: standard
fix_date: 2026-06-06
related: [upgrade-does-not-recover-blank-page-analysis.md]
tags: [workspace, tauri, reference-image, upgrade, blank-page, persistence]
---

# Upgrade Does Not Recover Blank Page 修复记录

## 1. 实际采用方案

采用分析中的方案 A：启动时自动迁移旧版参考图坏状态，并移除 `Composer` 对原始 `reference.dataUrl` 的最终渲染回退。

修复后，旧版写入 `pixai-data.json` 的本地路径形态 `dataUrl` 会在应用加载时迁移为 `storagePath`，同时清空 `dataUrl`。新导入的已落盘参考图也会在数据库写入前完成同样归一化，避免继续把原始路径写进可渲染字段。

## 2. 改动文件清单

- `src/services/app-database.ts`：新增参考图来源归一化，导入和启动加载都会把本地路径 / 旧 asset URL 从 `dataUrl` 迁移到 `storagePath`。
- `src/services/app-database.test.ts`：新增旧版持久化状态迁移和新导入参考图归一化回归测试。
- `src/components/workspace/Composer.tsx`：缩略图和预览弹窗不再回退到原始 `reference.dataUrl`。
- `src/components/workspace/Composer.test.tsx`：新增测试，覆盖拿不到安全显示地址时不能把原始本地路径写进 DOM。
- `.codestable/issues/2026-06-06-upgrade-does-not-recover-blank-page/upgrade-does-not-recover-blank-page-report.md`：问题报告确认。
- `.codestable/issues/2026-06-06-upgrade-does-not-recover-blank-page/upgrade-does-not-recover-blank-page-analysis.md`：根因分析确认。

## 3. 验证结果

- [x] `pnpm vitest run src/services/app-database.test.ts src/components/workspace/Composer.test.tsx` 通过，15 个用例全绿。
- [x] `pnpm check` 通过，包含 `tsc --noEmit` 和全量 Vitest，28 个测试文件、120 个用例全绿。
- [x] `pnpm build` 通过，Vite 生产构建成功。
- [x] 复现步骤对应的坏状态已用单测模拟：旧版写入本地路径形态 `dataUrl` 后，新版本加载会自动迁移并回写。
- [x] 影响面回归覆盖：参考图缩略条、参考图预览的原始路径回退已移除。

## 4. 遗留事项

- `pnpm build` 仍会输出 Vite chunk 大小建议，该提示与本次白屏恢复修复无关。
- 需要发布包含本修复的新版本后，用安装过 `0.0.13` 的真实 Windows 客户端数据做一次覆盖升级复验，确认不清理注册表和数据目录也能恢复打开。
