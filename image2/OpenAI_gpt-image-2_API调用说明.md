# OpenAI `gpt-image-2` 图片接口调用说明

本文档整理 Python `POST` 调用方式，覆盖：

1. 生成图片
2. 编辑图片
3. 创建异步任务
4. 查询异步任务
5. 常见错误码与处理方式

更新时间：2026-06-18

> 说明：OpenAI 官方图片接口中，直接指定 `gpt-image-2` 的方式是 Images API。  
> 如果你需要“创建任务 / 查询任务”这种轮询式流程，官方更接近的做法是使用 Responses API 的 `background=true` 后台模式，而不是单独的 `/v1/tasks` 图片任务端点。

---

## 1. 基础配置

### 1.1 安装依赖

```bash
pip install requests
```

### 1.2 环境变量

```bash
export OPENAI_API_KEY="你的 API Key"
```

Windows PowerShell：

```powershell
$env:OPENAI_API_KEY="你的 API Key"
```

### 1.3 公共工具代码

```python
import os
import time
import base64
import requests
from typing import Any, Dict, Optional

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
BASE_URL = "https://api.openai.com/v1"


class OpenAIHTTPError(Exception):
    def __init__(self, status_code: int, message: str, error_body: Optional[Dict[str, Any]] = None):
        self.status_code = status_code
        self.message = message
        self.error_body = error_body or {}
        super().__init__(f"OpenAI HTTP {status_code}: {message}")


def _extract_error_message(resp: requests.Response) -> str:
    try:
        body = resp.json()
        err = body.get("error", {})
        if isinstance(err, dict):
            return err.get("message") or str(body)
        return str(body)
    except Exception:
        return resp.text


def request_json(
    method: str,
    path: str,
    *,
    json: Optional[Dict[str, Any]] = None,
    timeout: int = 300,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """
    用于 JSON 请求，例如：
    - POST /v1/images/generations
    - POST /v1/responses
    - GET  /v1/responses/{response_id}
    """
    url = f"{BASE_URL}{path}"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    retry_statuses = {408, 409, 429, 500, 502, 503, 504}

    for attempt in range(max_retries + 1):
        resp = requests.request(method, url, headers=headers, json=json, timeout=timeout)

        if resp.ok:
            return resp.json()

        message = _extract_error_message(resp)

        if resp.status_code not in retry_statuses or attempt >= max_retries:
            try:
                error_body = resp.json()
            except Exception:
                error_body = {"raw": resp.text}
            raise OpenAIHTTPError(resp.status_code, message, error_body)

        retry_after = resp.headers.get("Retry-After")
        if retry_after and retry_after.isdigit():
            sleep_seconds = int(retry_after)
        else:
            sleep_seconds = min(2 ** attempt, 16)

        time.sleep(sleep_seconds)

    raise RuntimeError("unreachable")


def save_base64_image(image_base64: str, output_path: str) -> None:
    image_bytes = base64.b64decode(image_base64)
    with open(output_path, "wb") as f:
        f.write(image_bytes)
```

---

## 2. 生成图片：`POST /v1/images/generations`

### 2.1 接口

```text
POST https://api.openai.com/v1/images/generations
Content-Type: application/json
Authorization: Bearer $OPENAI_API_KEY
```

### 2.2 最小请求

```python
payload = {
    "model": "gpt-image-2",
    "prompt": "A cinematic fantasy castle at sunset, highly detailed",
}

data = request_json("POST", "/images/generations", json=payload)
image_base64 = data["data"][0]["b64_json"]
save_base64_image(image_base64, "output.png")
```

### 2.3 常用参数请求

```python
payload = {
    "model": "gpt-image-2",
    "prompt": "A 2D anime-style Chinese fantasy inn interior, warm lantern light, detailed wooden structure",
    "size": "1024x1536",
    "quality": "high",
    "output_format": "png",
    # "n": 1,  # 需要多张时可以设置；默认通常返回 1 张
}

data = request_json("POST", "/images/generations", json=payload)

for i, item in enumerate(data["data"]):
    save_base64_image(item["b64_json"], f"generated_{i}.png")
```

### 2.4 常用参数说明

| 参数 | 类型 | 示例 | 说明 |
|---|---:|---|---|
| `model` | string | `gpt-image-2` | 图片模型 |
| `prompt` | string | `"A fantasy castle"` | 图片生成提示词 |
| `size` | string | `1024x1024` / `1024x1536` / `1536x1024` / `2048x2048` / `3840x2160` | 图片尺寸。`gpt-image-2` 支持更多自定义分辨率，但需要满足尺寸约束 |
| `quality` | string | `low` / `medium` / `high` / `auto` | 图片质量。草稿建议 `low`，最终资源建议 `medium` 或 `high` |
| `output_format` | string | `png` / `jpeg` / `webp` | 输出格式 |
| `output_compression` | int | `50` | 仅对 `jpeg` / `webp` 有意义，范围通常为 0-100 |
| `background` | string | `opaque` / `auto` | `gpt-image-2` 当前不支持透明背景 |

### 2.5 `size` 约束

`gpt-image-2` 的尺寸一般需要满足：

- 最大边不超过 `3840px`
- 宽高均为 `16px` 的倍数
- 长边与短边比例不超过 `3:1`
- 总像素数在约 `655,360` 到 `8,294,400` 之间

常用安全值：

```text
1024x1024
1024x1536
1536x1024
2048x2048
2048x1152
3840x2160
2160x3840
```

---

## 3. 编辑图片：`POST /v1/images/edits`

图片编辑必须使用 `multipart/form-data`，不能使用普通 JSON。

### 3.1 接口

```text
POST https://api.openai.com/v1/images/edits
Content-Type: multipart/form-data
Authorization: Bearer $OPENAI_API_KEY
```

注意：使用 `requests` 传 `files=` 时，不要手动设置 `Content-Type`，否则 boundary 可能错误。

### 3.2 单图编辑

```python
def edit_image(
    image_path: str,
    prompt: str,
    output_path: str = "edited.png",
) -> Dict[str, Any]:
    url = f"{BASE_URL}/images/edits"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }

    data = {
        "model": "gpt-image-2",
        "prompt": prompt,
        "size": "1024x1536",
        "quality": "high",
        "output_format": "png",
    }

    with open(image_path, "rb") as img:
        files = [
            ("image[]", (image_path, img, "image/png")),
        ]

        resp = requests.post(
            url,
            headers=headers,
            data=data,
            files=files,
            timeout=300,
        )

    if not resp.ok:
        raise OpenAIHTTPError(resp.status_code, _extract_error_message(resp), resp.json())

    result = resp.json()
    save_base64_image(result["data"][0]["b64_json"], output_path)
    return result


edit_image(
    image_path="input.png",
    prompt="Keep the same composition, but change the scene to sunset lighting.",
    output_path="edited.png",
)
```

### 3.3 多参考图编辑

`gpt-image-2` 支持传入多张参考图。接口字段可以重复传 `image[]`。

```python
def edit_with_multiple_images(
    image_paths: list[str],
    prompt: str,
    output_path: str = "edited_multi.png",
) -> Dict[str, Any]:
    url = f"{BASE_URL}/images/edits"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }

    data = {
        "model": "gpt-image-2",
        "prompt": prompt,
        "size": "1536x1024",
        "quality": "high",
        "output_format": "png",
    }

    opened_files = []
    try:
        files = []
        for path in image_paths:
            f = open(path, "rb")
            opened_files.append(f)
            files.append(("image[]", (path, f, "image/png")))

        resp = requests.post(
            url,
            headers=headers,
            data=data,
            files=files,
            timeout=300,
        )
    finally:
        for f in opened_files:
            f.close()

    if not resp.ok:
        raise OpenAIHTTPError(resp.status_code, _extract_error_message(resp), resp.json())

    result = resp.json()
    save_base64_image(result["data"][0]["b64_json"], output_path)
    return result


edit_with_multiple_images(
    image_paths=["character.png", "scene.png"],
    prompt="Place the character from the first image into the scene from the second image, matching lighting and perspective.",
)
```

### 3.4 使用 mask 局部编辑

`mask` 用于提示模型主要修改图片中的某个区域。它是引导，不保证完全严格贴合遮罩边缘。

```python
def edit_with_mask(
    image_path: str,
    mask_path: str,
    prompt: str,
    output_path: str = "edited_mask.png",
) -> Dict[str, Any]:
    url = f"{BASE_URL}/images/edits"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }

    data = {
        "model": "gpt-image-2",
        "prompt": prompt,
        "size": "1024x1024",
        "quality": "high",
        "output_format": "png",
    }

    with open(image_path, "rb") as img, open(mask_path, "rb") as mask:
        files = [
            ("image[]", (image_path, img, "image/png")),
            ("mask", (mask_path, mask, "image/png")),
        ]

        resp = requests.post(
            url,
            headers=headers,
            data=data,
            files=files,
            timeout=300,
        )

    if not resp.ok:
        raise OpenAIHTTPError(resp.status_code, _extract_error_message(resp), resp.json())

    result = resp.json()
    save_base64_image(result["data"][0]["b64_json"], output_path)
    return result


edit_with_mask(
    image_path="room.png",
    mask_path="mask.png",
    prompt="Replace the masked area with a small indoor pool containing a pink flamingo.",
)
```

---

## 4. 创建异步任务：`POST /v1/responses`

### 4.1 重要说明

OpenAI 官方图片生成有两种主路径：

| 场景 | 推荐接口 |
|---|---|
| 只需要一次性生成/编辑，并且要直接指定 `gpt-image-2` | Images API：`/v1/images/generations` 或 `/v1/images/edits` |
| 需要后台执行、轮询状态、多轮对话式图片生成 | Responses API：`/v1/responses` + `background=true` + `tools=[{"type": "image_generation"}]` |

在 Responses API 中，你一般指定主模型，例如 `gpt-5.5`，再启用 `image_generation` tool。此时不是直接把 `model` 写成 `gpt-image-2`，而是由图片生成工具处理底层图片模型选择。

### 4.2 接口

```text
POST https://api.openai.com/v1/responses
Content-Type: application/json
Authorization: Bearer $OPENAI_API_KEY
```

### 4.3 创建后台图片生成任务

```python
def create_image_task(prompt: str) -> Dict[str, Any]:
    payload = {
        "model": "gpt-5.5",
        "input": prompt,
        "background": True,
        "store": True,
        "tools": [
            {
                "type": "image_generation",
                "quality": "high",
                "size": "1024x1536",
                "output_format": "png",
            }
        ],
    }

    return request_json("POST", "/responses", json=payload)


task = create_image_task("Generate a dark fantasy cathedral interior at sunset, ancient stone, epic atmosphere.")
print(task["id"])
print(task["status"])
```

返回示例结构通常类似：

```json
{
  "id": "resp_xxx",
  "object": "response",
  "status": "queued",
  "background": true
}
```

你需要保存 `id`，后续用它查询任务。

---

## 5. 查询异步任务：`GET /v1/responses/{response_id}`

### 5.1 接口

```text
GET https://api.openai.com/v1/responses/{response_id}
Authorization: Bearer $OPENAI_API_KEY
```

### 5.2 查询一次

```python
def get_image_task(response_id: str) -> Dict[str, Any]:
    return request_json("GET", f"/responses/{response_id}")


task = get_image_task("resp_xxx")
print(task["status"])
```

### 5.3 轮询直到完成

```python
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "incomplete"}
RUNNING_STATUSES = {"queued", "in_progress"}


def extract_image_base64_from_response(response: Dict[str, Any]) -> list[str]:
    images = []

    for output in response.get("output", []):
        if output.get("type") == "image_generation_call":
            result = output.get("result")
            if result:
                images.append(result)

    return images


def wait_for_image_task(
    response_id: str,
    *,
    poll_interval: float = 2.0,
    timeout_seconds: float = 600.0,
) -> Dict[str, Any]:
    start = time.time()

    while True:
        task = get_image_task(response_id)
        status = task.get("status")

        print(f"status={status}")

        if status in TERMINAL_STATUSES:
            return task

        if time.time() - start > timeout_seconds:
            raise TimeoutError(f"Polling timed out: {response_id}")

        time.sleep(poll_interval)


task = create_image_task("Generate a cinematic 2D fantasy inn interior, warm lantern light.")
response_id = task["id"]

final_task = wait_for_image_task(response_id)

if final_task["status"] == "completed":
    image_list = extract_image_base64_from_response(final_task)

    if not image_list:
        raise RuntimeError("任务完成，但没有找到 image_generation_call.result")

    for i, image_base64 in enumerate(image_list):
        save_base64_image(image_base64, f"task_output_{i}.png")

else:
    print("任务未成功完成：")
    print(final_task.get("status"))
    print(final_task.get("error"))
    print(final_task.get("incomplete_details"))
```

### 5.4 任务状态

常见状态：

| 状态 | 说明 |
|---|---|
| `queued` | 已排队 |
| `in_progress` | 执行中 |
| `completed` | 已完成 |
| `failed` | 执行失败 |
| `cancelled` | 已取消 |
| `incomplete` | 未完整完成，通常需要查看 `incomplete_details` |

### 5.5 取消任务

```text
POST https://api.openai.com/v1/responses/{response_id}/cancel
```

```python
def cancel_image_task(response_id: str) -> Dict[str, Any]:
    return request_json("POST", f"/responses/{response_id}/cancel")


cancelled = cancel_image_task("resp_xxx")
print(cancelled["status"])
```

---

## 6. 图片生成流式输出，可选

如果你不需要后台轮询，但想边生成边拿到中间预览，可以用 streaming。

### 6.1 Images API 流式生成

```python
from openai import OpenAI
import base64

client = OpenAI()

stream = client.images.generate(
    model="gpt-image-2",
    prompt="Draw a gorgeous fantasy river under moonlight.",
    stream=True,
    partial_images=2,
)

for event in stream:
    if event.type == "image_generation.partial_image":
        idx = event.partial_image_index
        image_bytes = base64.b64decode(event.b64_json)
        with open(f"partial_{idx}.png", "wb") as f:
            f.write(image_bytes)
```

### 6.2 注意

`partial_images` 通常可以设置为 `0-3`。中间图会产生额外成本，适合做进度预览或交互式体验。

---

## 7. 常见错误码

### 7.1 HTTP 错误码总表

| HTTP 状态码 | SDK 异常类型 | 常见原因 | 处理建议 |
|---:|---|---|---|
| `400` | `BadRequestError` | 参数错误、缺少必填字段、字段类型错误、图片格式/尺寸不符合要求、JSON/multipart 用错 | 打印 `error.message`，检查接口文档和请求体 |
| `401` | `AuthenticationError` | API Key 错误、过期、撤销、复制时多了空格 | 检查 `Authorization: Bearer ...`，重新生成 Key |
| `403` | `PermissionDeniedError` | 无权访问模型/项目/组织，IP allowlist 不匹配，区域不支持，组织验证未完成 | 检查项目权限、组织、IP allowlist、模型权限、账户区域 |
| `404` | `NotFoundError` | 查询的 `response_id` 不存在或已不可用 | 确认 ID 正确；后台响应可轮询时间有限，避免太久后再查 |
| `409` | `ConflictError` | 资源被其他请求更新，或状态冲突 | 重试，避免并发修改同一资源 |
| `422` | `UnprocessableEntityError` | 请求格式正确，但服务无法处理该内容 | 修改输入内容、图片或参数后重试 |
| `429` | `RateLimitError` | 请求过快、并发过高、达到 RPM/TPM 限制 | 降低频率，使用指数退避，读取 `Retry-After` |
| `429` | `RateLimitError` | 余额不足、达到预算或月度限额 | 检查 Billing、Usage、Limits |
| `500` | `InternalServerError` | 服务端内部错误 | 指数退避重试；持续失败时记录 `x-request-id` 并联系支持 |
| `502` | `APIError` / `InternalServerError` | 网关或上游错误 | 可重试 |
| `503` | `InternalServerError` / `APIError` | 服务繁忙、模型过载、临时限流 `Slow Down` | 降低请求速率，延迟后重试 |
| `504` | `APITimeoutError` / `APIError` | 网关超时或长任务超时 | 对长任务使用 `background=true`，或增大客户端超时 |

### 7.2 无 HTTP 状态码的错误

| 异常 | 常见原因 | 处理建议 |
|---|---|---|
| `APIConnectionError` | 网络连接失败、代理、DNS、防火墙、SSL 证书问题 | 检查网络、代理、证书、容器出网权限 |
| `APITimeoutError` | 请求耗时过长，客户端超时 | 增大 timeout；图片高质量大尺寸任务建议用后台模式 |
| `JSONDecodeError` | 响应不是 JSON，可能是代理/网关返回 HTML | 打印 `resp.text` 和状态码，检查代理层 |

---

## 8. 图片接口常见错误场景

### 8.1 `gpt-image-2` 不支持透明背景

错误请求示例：

```python
payload = {
    "model": "gpt-image-2",
    "prompt": "A logo with transparent background",
    "background": "transparent",
}
```

处理：

```python
payload["background"] = "opaque"  # 或 "auto"
```

### 8.2 `/images/edits` 用错 `Content-Type`

错误做法：

```python
headers = {
    "Authorization": f"Bearer {OPENAI_API_KEY}",
    "Content-Type": "application/json",
}
requests.post(url, headers=headers, json=payload)
```

正确做法：

```python
headers = {
    "Authorization": f"Bearer {OPENAI_API_KEY}",
}
requests.post(url, headers=headers, data=data, files=files)
```

### 8.3 尺寸不符合要求

错误示例：

```python
"size": "1000x1500"
```

可能问题：

- 宽高不是 `16px` 的倍数
- 总像素过低或过高
- 长宽比超过 `3:1`
- 最大边超过 `3840px`

建议使用：

```python
"size": "1024x1536"
```

### 8.4 任务查询返回 `not found`

可能原因：

- `response_id` 写错
- 使用了错误的 Project/API Key 查询另一个 Project 创建的任务
- 后台任务结果可轮询窗口已过
- 任务本身没有 `store=true`

处理：

- 创建任务后立即持久化 `response_id`
- 查询时使用同一个 Project 的 API Key
- 长任务尽快轮询和落盘结果
- 显式传入 `"store": true`

### 8.5 请求被内容安全策略拦截

可能表现：

- `400`
- `422`
- `response.status` 为 `failed` 或 `incomplete`
- `error.message` 中包含安全策略、policy、moderation 等相关说明

处理：

- 改写 prompt
- 避免生成违法、危险、露骨、未成年人性内容、极端图像暴力等内容
- 在业务侧提前做 moderation 或敏感词审查

---

## 9. 错误处理代码模板

### 9.1 `requests` 版本

```python
def safe_generate_image(prompt: str, output_path: str) -> bool:
    try:
        payload = {
            "model": "gpt-image-2",
            "prompt": prompt,
            "size": "1024x1024",
            "quality": "medium",
            "output_format": "png",
        }

        data = request_json("POST", "/images/generations", json=payload)
        save_base64_image(data["data"][0]["b64_json"], output_path)
        return True

    except OpenAIHTTPError as e:
        print("OpenAI 请求失败")
        print("status_code:", e.status_code)
        print("message:", e.message)
        print("body:", e.error_body)

        if e.status_code == 401:
            print("检查 API Key。")
        elif e.status_code == 403:
            print("检查模型权限、组织权限、IP allowlist 或区域限制。")
        elif e.status_code == 429:
            print("降频、退避重试，或检查 Billing/Usage。")
        elif e.status_code >= 500:
            print("服务端错误，可稍后重试。")

        return False
```

### 9.2 OpenAI SDK 版本

```python
import openai
from openai import OpenAI

client = OpenAI()

try:
    response = client.images.generate(
        model="gpt-image-2",
        prompt="A fantasy castle at sunset",
        size="1024x1024",
        quality="medium",
    )

except openai.BadRequestError as e:
    print("请求参数错误:", e)

except openai.AuthenticationError as e:
    print("认证失败:", e)

except openai.PermissionDeniedError as e:
    print("无权限:", e)

except openai.NotFoundError as e:
    print("资源不存在:", e)

except openai.RateLimitError as e:
    print("限流或额度不足:", e)

except openai.APITimeoutError as e:
    print("请求超时:", e)

except openai.APIConnectionError as e:
    print("网络连接失败:", e)

except openai.InternalServerError as e:
    print("OpenAI 服务端错误:", e)

except openai.APIError as e:
    print("其他 OpenAI API 错误:", e)
```

---

## 10. 推荐封装结构

如果你要在服务端封装给前端调用，建议这样拆：

```text
your_server/
  openai_image_client.py
  image_task_service.py
  routes/
    image_routes.py
```

建议对外暴露你自己的接口：

```text
POST /api/images/generate
POST /api/images/edit
POST /api/images/tasks
GET  /api/images/tasks/{task_id}
POST /api/images/tasks/{task_id}/cancel
```

内部映射：

| 你的业务接口 | OpenAI 官方接口 |
|---|---|
| `POST /api/images/generate` | `POST /v1/images/generations` |
| `POST /api/images/edit` | `POST /v1/images/edits` |
| `POST /api/images/tasks` | `POST /v1/responses`，设置 `background=true` |
| `GET /api/images/tasks/{id}` | `GET /v1/responses/{response_id}` |
| `POST /api/images/tasks/{id}/cancel` | `POST /v1/responses/{response_id}/cancel` |

---

## 11. 生产环境建议

1. API Key 只放服务端，不能下发到客户端。
2. 图片生成通常耗时较长，前端请求建议不要直接等待；长任务走后台模式或你自己的任务表。
3. 保存 `response_id`、用户 ID、prompt、状态、创建时间、完成时间、错误信息。
4. 生成结果尽快落盘到你自己的对象存储，不要长期依赖 OpenAI 响应查询。
5. 对 `429`、`500`、`502`、`503`、`504` 做指数退避。
6. 对用户 prompt 做基础安全过滤，避免无效请求浪费成本。
7. 高质量大图成本更高；草稿用 `quality=low`，最终图再用 `high`。
8. `jpeg` / `webp` 通常比 `png` 更适合低延迟和小体积场景。
9. 日志里不要记录完整 API Key。
10. 记录 `x-request-id`，方便排查异常。

---

## 12. 最小完整示例

```python
import os
import base64
import requests

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]

resp = requests.post(
    "https://api.openai.com/v1/images/generations",
    headers={
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "model": "gpt-image-2",
        "prompt": "A dark fantasy cathedral interior at sunset, ancient stone, epic atmosphere",
        "size": "1024x1536",
        "quality": "high",
        "output_format": "png",
    },
    timeout=300,
)

if not resp.ok:
    print(resp.status_code)
    print(resp.text)
    resp.raise_for_status()

data = resp.json()
image_base64 = data["data"][0]["b64_json"]

with open("output.png", "wb") as f:
    f.write(base64.b64decode(image_base64))
```

---

## 13. 官方参考

- OpenAI Image generation guide
- OpenAI Images API Reference
- OpenAI Background mode guide
- OpenAI Responses API Reference
- OpenAI Error codes guide
