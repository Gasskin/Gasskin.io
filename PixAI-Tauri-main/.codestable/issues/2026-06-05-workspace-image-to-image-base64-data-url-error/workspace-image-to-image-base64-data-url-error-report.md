---
doc_type: issue-report
issue: 2026-06-05-workspace-image-to-image-base64-data-url-error
status: active
tags: [workspace, image-to-image, generation, tauri]
---

# Workspace Image-To-Image Base64 Data URL Error 报告

## 1. 现象

经典工作台携带参考图执行图生图时，生成请求失败，失败详情中出现：

`图片数据必须是 base64 data URL。`

现场输入中包含参考图 ID，说明问题发生在图生图链路；错误来自 Tauri 写盘侧对 data URL 的校验。

## 2. 复现路径

1. 在经典工作台当前会话添加参考图。
2. 使用支持图生图的 OpenAI-compatible provider 发起生成。
3. 当 provider 返回的生成结果是远程 `image.url`，而不是 `b64_json` 时，落盘阶段失败。

## 3. 期望行为

provider 返回远程图片 URL 时，应用应先把 URL 下载并归一化为 base64 data URL，再进入现有图片持久化链路，最终成功写入历史记录。

## 4. 影响范围

影响所有复用 `ImageService.generate()` 且 provider 可能返回 `image.url` 的生成路径；不局限于某一个会话。
