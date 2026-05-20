火山方舟API分为模型调用的API（数据面 API），及管理推理接入点等管控相关的管控面 API。他们支持的鉴权方式有所不同，下面介绍方舟API的鉴权方式。
概念解释
数据面 API：是直接面向业务数据传输、实时交互、用户请求处理的接口，聚焦于 “实际业务数据的流转与处理”，是系统对外提供核心服务能力的载体。请求大模型服务的 Chat API、Responses API 均为数据面 API。
管控面 API：用于系统资源管理、配置控制和状态监控的接口。它专注于管理和调度数据面及系统资源，是保障系统稳定运行的“控制中枢”。例如，在方舟中用于管理 API Key、基础模型等接口，均属于管控面 API。
Base URL：是构建完整 API 请求 URL 的 “基础模板”，包含协议（如 http/https）、host（主机域名或 IP）、端口（可选）和基础路径（可选），是所有具体接口路径的 “公共前缀”。你可以根据Base URL 加接口/版本等参数拼接出完整接口 URL ，典型结构：[协议]://[host]/[基础路径（可选）]
Base URL
注意
下面给到的数据面 API 与 Coding Plan 支持的 Base URL 不同。Coding Plan 用户请使用正确的 Base URL，避免因地址错误产生额外费用，具体参见 Base URL。
各接口类型对应的 Base URL。
数据面 API：https://ark.cn-beijing.volces.com/api/v3
管控面 API：https://ark.cn-beijing.volcengineapi.com/
数据面 API 鉴权
支持两种鉴权方式，API Key 鉴权（简单方便），与 Access Key 鉴权（传统云上资源权限管控，可以分资源组云产品等维度管理，面向企业精细化管理）。
API Key 签名鉴权
前提条件
说明
方舟平台的新用户？获取 API Key 及 开通模型等准备工作，请参见 快速入门。
签名构造
在 HTTP 请求 header 中按如下方式添加 Authorization header:

Shell
复制
Authorization: Bearer $ARK_API_KEY

示例如下

Shell
复制
curl https://ark.cn-beijing.volces.com/api/v3/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seed-2-0-lite-260215",
    "messages": [
        {
            "role": "system",
            "content": "You are a helpful assistant."
        },
        {
            "role": "user",
            "content": "Hello!"
        }
    ]
  }'

可按需替换 Model ID。查询 Model ID见 模型列表。
Access Key 签名鉴权
前提条件
你已获取到Access Key。如需创建/查看Access Key，请参见API访问密钥管理。
由于主账号的Access Key拥有较大权限，建议你创建IAM用户并授予方舟等权限，然后使用IAM用户的 Access Key 来进行操作，具体请参见使用 IAM 管理权限。
使用示例
见 使用Access Key鉴权。
通过Access Key 鉴权，model 字段 需配置为 Endpoint ID。
管控面 API 鉴权
管控面的API，如管理API Key、管理推理接入点等接口。
Access Key 签名鉴权
获取Access Key。如需创建/查看Access Key，请参见API访问密钥管理。
方法：使用示例/说明（简单，推荐）
参见SDK 接入指南。
方法：自行实现签名（实现成本高，不推荐）
使用 Access Key 构造签名。具体方法请参见签名方法。
签名用到的方舟相关字段信息：
Service：ark
Region：cn-beijing
使用cURL发起请求，请求示例如下：

Shell
复制
curl -X POST \
  'https://ark.cn-beijing.volcengineapi.com/?Action=ListEndpoints&Version=2024-01-01' \
  -H 'Authorization: HMAC-SHA256 Credential=AKL**/20240710/cn-beijing/ark/request, SignedHeaders=host;x-content-sha256;x-date, Signature=a7a****' \
  -H 'Content-Type: application/json' \
  -H 'Host: ark.cn-beijing.volcengineapi.com' \
  -H 'X-Content-Sha256: 44***' \
  -H 'X-Date: 20240710T042925Z' \
  -d '{}'