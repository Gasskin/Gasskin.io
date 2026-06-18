---
doc_type: feature-ff-note
feature: production-updater-release
date: 2026-05-24
requirement:
tags: [updater, release, github, tauri]
---

## 做了什么
补齐了生产 updater 发布链：把正式公钥写进 Tauri 配置，新增正式签名构建和 GitHub Release 上传脚本，并把 release 流程写进 README。

## 改了哪些
- `src-tauri/tauri.conf.json` - 写入正式 updater 公钥，保持 GitHub `latest.json` 作为生产更新源
- `scripts/release-updater.mjs` - 新增正式 keygen、签名构建、manifest 组装和 GitHub release 上传命令
- `package.json` - 增加 `updater:release:*` 脚本入口
- `README.md` - 补充“没有 key 只影响自动更新”和正式 updater 发布流程说明
- `.codestable/architecture/ARCHITECTURE.md` - 记录正式 updater 发布工具和公私钥边界

## 怎么验证的
已生成本地正式 updater key，并计划用新脚本重新签名 0.0.3 构建、生成 `latest.json`、再上传到现有 GitHub release 做闭环验证。

## 顺手发现（可选，不阻塞）
- 早期已安装的 `0.0.3` 如果还是空公钥版本，下一次仍会走 GitHub fallback；重新安装这次补好的 `0.0.3` 或后续版本后，签名自动更新链才会完全生效。
