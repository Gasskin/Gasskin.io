# 图片生成页面说明

`image2` 是一个静态图片生成页面，用于调用 OpenAI Images API 或兼容接口。页面支持文生图和图生图，用户在浏览器内选择请求地址、填写 token、提示词和生成参数后发起请求。

## 请求配置

- 请求网址来自 `api-whitelist.txt`，页面只允许选择白名单中的地址。
- 当前白名单包含：
  - `https://api.openai.com`
  - `https://flux.infpro.me`
  - `https://ai.input.im`
- GitHub Pages 直连这些接口可能被浏览器 CORS 预检拦截，线上使用时需要配置 Worker 代理。
- 代理配置方式：
  - 在 `config.js` 里设置 `window.IMAGE2_PROXY_BASE = "https://你的代理地址"`。
  - 访问页面时追加 `?proxyBase=https%3A%2F%2F你的代理地址`。
- 页面实际请求路径会根据模式自动拼接：
  - 文生图：`{请求网址}/v1/images/generations`
  - 图生图：`{请求网址}/v1/images/edits`
- 配置 Worker 代理后，页面会把选中的白名单地址作为 `target` 参数传给 Worker，由 Worker 校验后转发。
- Token 会作为 `Authorization: Bearer <token>` 发送。
- Token 只保存在当前页面运行时内存中，不会写入本地文件。

## 文生图与图生图

页面通过是否上传参考图片来区分接口：

- 没有参考图片时，使用 `POST /v1/images/generations`，请求体为 JSON。
- 有 1 张或多张参考图片时，使用 `POST /v1/images/edits`，请求体为 `multipart/form-data`。

图生图时，所有参考图片都会以重复字段 `image[]` 上传。多图含义需要在提示词中说明，例如“第 1 张图作为角色参考，第 2 张图作为场景参考”。

## 参考图片上传

- 支持点击上传本地图片。
- 支持把本地图片直接拖拽到上传区域。
- 上传后会显示缩略图。
- 缩略图保持原始比例显示。
- 点击缩略图可以打开预览。
- 每张参考图都可以单独删除。

## 生成参数

当前页面固定了一些参数，避免用户选择接口不支持或当前业务不需要的选项：

- 模型默认：`gpt-image-2`
- 质量固定：`high`
- 输出格式固定：`png`
- 背景固定：`auto`
- 输出压缩禁用，因为 PNG 不适用该参数

可选择参数：

- 尺寸档位：`1K`、`2K`、`4K`
- 图片比例：`1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16`、`21:9`、`9:21`
- 图片数量：`1` 到 `10`

页面会根据尺寸档位和图片比例自动计算最终 `size`，并保证宽高为 `16px` 的倍数、最大边不超过 `3840px`、总像素不超过 `3840x2160`。

默认图片比例是 `16:9`。

## 生成结果

生成结果会显示在图片列表中。每张结果图支持：

- 预览：在网页内打开大图预览。
- 下载：按时间格式保存文件，文件名为 `YYYYMMDDHHMMSS.png`；多张图片会追加 `_1`、`_2`。
- 删除：从当前页面列表中移除该图片。
- 复制提示词：图片右上角复制图标会复制本次生成使用的提示词。

## 注意事项

- 浏览器直连目标 API 可能会遇到 CORS 限制；GitHub Pages 是静态托管，无法在 Pages 侧为目标 API 响应补 CORS 头。
- 可以把 `openai-proxy-worker.js` 部署为 Cloudflare Worker，然后把 Worker 地址填入 `config.js`。
- Worker 内部也维护了同样的白名单，避免它变成可请求任意地址的开放代理。
- 生产环境建议使用自己的服务端代理，并按你的站点域名限制允许来源。
- 不要把长期有效的 API Key 暴露给公开网页用户。
- 图生图接口必须使用 `multipart/form-data`，不能手动设置 `Content-Type`，否则 boundary 可能错误。
- 如果请求网址已经包含 `/v1`，页面会避免重复拼接 `/v1`。

## GitHub Pages CORS 处理

GitHub Pages 只能托管静态文件，不能处理 `OPTIONS` 预检，也不能修改目标 API 的响应头。因此线上页面需要经过一个支持 CORS 的代理。

最小流程：

1. 在 Cloudflare Workers 创建一个 Worker。
2. 把 `openai-proxy-worker.js` 的内容粘贴进去并部署。
3. 得到类似 `https://your-image-proxy.your-name.workers.dev` 的地址。
4. 修改 `config.js`：

```js
window.IMAGE2_PROXY_BASE = "https://your-image-proxy.your-name.workers.dev";
```

部署后页面会请求 Worker，并附带选中的目标地址：

- 文生图：`https://your-image-proxy.your-name.workers.dev/v1/images/generations?target=https%3A%2F%2Fapi.openai.com`
- 图生图：`https://your-image-proxy.your-name.workers.dev/v1/images/edits?target=https%3A%2F%2Fapi.openai.com`
