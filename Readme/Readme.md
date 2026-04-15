# Gasskin.io · Seedance 2.0 静态视频生成页

面向**火山方舟**「视频生成任务」API 的纯静态单页应用：在浏览器中填写 **ARK API Key**、上传/填写素材、创建任务并轮询结果；可选在 **GitHub Pages** 上托管。

---

## 仓库结构（关键路径）

| 路径 | 说明 |
|------|------|
| `static/` | 源码：`index.html`、`app.js`、`style.css` |
| `docs/` | **发布目录**：由 `build.py` 生成，供 GitHub Pages 根目录 `/docs` 使用 |
| `build.py` | 将 `static/` 同步到 `docs/` 并写入 `.nojekyll` |
| `dev_server.py` | 本地开发：托管 `docs/` + 同源反向代理 `/api/v3` → 方舟，规避浏览器 CORS |
| `requirements.txt` | Python 依赖说明（见下文） |
| `Readme/*.md` | 方舟官方能力摘录与接口说明（创建任务、查询任务、任务列表等） |

---

## 构建与运行

```bash
# 生成 GitHub Pages 目录
python build.py

# 本地完整联调（推荐）
python dev_server.py
# 浏览器打开 http://127.0.0.1:8765/
```

`build.py` **仅依赖 Python 标准库**。`dev_server.py` 在首页注入 `window.__SEEDANCE_API_BASE__`，使前端请求走同源 `/api/v3`，由服务端转发至 `https://ark.cn-beijing.volces.com/api/v3`。

**直连 GitHub Pages** 时，浏览器请求 `ark.cn-beijing.volces.com` 可能触发 **CORS**；需 `dev_server`、自建网关或可跨域环境。

---

## 功能概览（与 `static/app.js` 行为一致）

### 模型与创建任务

- **默认模型**：`doubao-seedance-2-0-fast-260128`（可选 `doubao-seedance-2-0-260128`）。
- **创建**：`POST /api/v3/contents/generations/tasks`，`Authorization: Bearer <ARK_API_KEY>`。
- **轮询**：`GET /api/v3/contents/generations/tasks/{id}`，间隔 **500ms**（常量 `POLL_MS`）。
- **`return_last_frame`**：**默认勾选**，请求体中始终带布尔字段 `return_last_frame`（与勾选一致）。

### 素材与方舟约束

- **图片 / 参考音频**：本地文件 → Base64 Data URL 写入 `content`（符合官方文档对 image / audio 的约定）。
- **参考视频**：**仅支持**方舟云端可访问的 **公网 `http(s)` URL** 或 **`asset://`**；**不支持**本地文件 / Base64（接口会校验）。页面为每行一条 URL，最多 3 条。
- **参考图模式**：多模态参考 / 首帧 / 首尾帧（与 `Readme/创建视频生成任务API.md` 中 Seedance 2.0 一致）。
- **音频**：不可单独使用，须至少一张图或一条参考视频 URL。

### 生成结果与状态

- 成功后在页面内展示输出 **`<video>`**。
- **「状态与错误」**：多行追加日志，带时间戳；主流程内可显示**总计用时**；日志区 **固定高度 480px**，内部滚动。
- **「停止轮询」**：通过 `AbortSignal` 可中断 **创建任务的 POST（大 JSON 上传）** 或后续轮询。

### 历史任务列表（近 7 天）

- **列表**：`GET /api/v3/contents/generations/tasks?page_num=&page_size=10`，**每页 10 条**，支持上一页 / 下一页；可选 **按当前所选模型** 传 `filter.model`（文档中为推理接入点 ID，若无数据可取消勾选）。
- **表格**：状态、模型、创建时间、`total_tokens` / `completion_tokens`、**视频内嵌预览**；若有 **`content.last_frame_url`**（依赖创建时 `return_last_frame: true` 且任务成功），展示 **尾帧图**。

### 已移除的能力

- **不在页面提供**「取消 / 删除任务」：相关 `DELETE` 与排队取消逻辑已去掉（方舟仍支持的能力见 `Readme/取消或删除视频生成任务.md`，需自行用其他客户端调用）。

---

## API 基址

- 生产：`https://ark.cn-beijing.volces.com/api/v3`
- 本地 `dev_server.py`：`location.origin + "/api/v3"`（由注入脚本设置 `window.__SEEDANCE_API_BASE__`）

---

## 依赖（`requirements.txt`）

- `volcengine-python-sdk[ark]>=5.0.0`：与 `Readme/安装以升级SDK.md` 一致，便于本地用 **Python** 调方舟；**运行静态页或 `build.py` 不强制安装**。

---

## 安全与密钥

- **ARK API Key** 仅在用户浏览器会话中输入与使用，**不写入**本仓库静态文件。
- 公开托管的 HTML/JS **不包含**你的密钥；他人打开同一 GitHub.io **不会自动获得**你的 Key，但若存在 **XSS / 仓库被篡改 / 本机恶意软件** 等，仍有泄露风险。生产环境更稳妥的方式是 **服务端代理 + 短期凭证**（超出当前纯静态范围）。

---

## 详细文档索引（`Readme/`）

| 文件 | 内容 |
|------|------|
| `创建视频生成任务API.md` | Seedance 2.0 创建任务、`content`、参数等 |
| `查询视频生成任务 API.md` | 单任务查询、`usage`、尾帧等 |
| `查询视频生成任务列表.md` | 分页列表、`filter`、近 7 天等 |
| `取消或删除视频生成任务.md` | `DELETE` 与状态对照（页面未接） |
| `安装以升级SDK.md` | Python SDK 安装 |
| `视频生成教程.md` | 官方教程链接区 |

---

## GitHub Pages

仓库 **Settings → Pages**：发布源选分支，目录选 **`/docs`**。推送前执行 `python build.py`，保证 `docs/` 与 `static/` 一致。
