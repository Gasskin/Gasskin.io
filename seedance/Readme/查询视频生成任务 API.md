GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}  运行
查询视频生成任务的状态。
说明
仅支持查询最近 7 天的历史数据。时间计算统一采用UTC时间戳，返回的7天历史数据范围以用户实际发起查询请求的时刻为基准（精确到秒），时间戳区间为 [T-7天, T)。

快速入口
鉴权说明

体验中心       
模型列表       
模型计费       
API Key

调用教程       
接口文档       
常见问题       
开通模型

请求参数 
跳转 响应参数

id string 必选
您需要查询的视频生成任务的 ID 。
说明
上面参数为Query String Parameters，在URL String中传入。

响应参数
跳转 请求参数

id string
视频生成任务 ID 。

model string
任务使用的模型名称和版本，模型名称-版本。

status string
任务状态，以及相关的信息：
queued：排队中。
running：任务运行中。
cancelled：取消任务，取消状态24h自动删除（只支持排队中状态的任务被取消）。
succeeded： 任务成功。
failed：任务失败。
expired：任务超时。

error object / null
错误提示信息，任务成功返回null，任务失败时返回错误数据，错误信息具体参见 错误处理。
属性

error.code string
错误码。

error.message string
错误提示信息。

created_at integer
任务创建时间的 Unix 时间戳（秒）。

updated_at integer
任务当前状态更新时间的 Unix 时间戳（秒）。

content object
视频生成任务的输出内容。
属性

content.video_url string
生成视频的 URL，格式为 mp4。为保障信息安全，生成的视频会在24小时后被清理，请及时转存。
推荐配置火山引擎 TOS 提供的数据订阅功能，将您的模型推理产物自动转存到自己的 TOS 桶中，便于长期备份或二次加工。详细介绍请参见 TOS 数据订阅。
content.last_frame_url string
视频的尾帧图像 URL。有效期为 24小时，请及时转存。
说明：创建视频生成任务 时设置 "return_last_frame": true 时，会返回该参数。

seed integer
本次请求使用的种子整数值。

resolution  string 
生成视频的分辨率。

ratio string
生成视频的宽高比。

duration integer 
生成视频的时长，单位：秒。
说明：duration 和 frames 参数只会返回一个。创建视频生成任务 时未指定 frames，会返回 duration。

frames integer  
生成视频的帧数。
说明：duration 和 frames 参数只会返回一个。创建视频生成任务 时指定了 frames，会返回 frames。

framespersecond  integer 
生成视频的帧率。

generate_audio boolean
生成的视频是否包含与画面同步的声音。仅 seedance 2.0 & 2.0 fast、seedance 1.5 pro 会返回该参数。
true：模型输出的视频包含同步音频。
false：模型输出的视频为无声视频。

toolsnew object[] 
本次请求模型实际使用的工具。未使用工具时不返回。
属性

safety_identifiernew string
终端用户的唯一标识符。若 创建视频生成任务 时设置了该参数，接口会原样返回此信息。

draft boolean
生成的视频是否为 Draft 视频。仅 seedance 1.5 pro 会返回该参数。
true：表示当前输出为 Draft 视频。
false：表示当前输出为正常视频。

draft_task_id string
Draft 视频任务 ID。基于 Draft 视频生成正式视频时，会返回该参数。

service_tier  string
实际处理任务使用的服务等级。

execution_expires_after integer
任务超时阈值，单位：秒。

usage object
本次请求的 token 用量。
属性

usage.completion_tokens integer
模型输出视频花费的 token 数量，可作为计费对账依据。
说明
seedance 2.0 系列模型存在最低 token 用量限制，如果实际 token 用量 ＜ 最低 token 用量，本字段会返回最低 token 用量，平台按最低 token 用量计费。

usage.total_tokens integer
本次请求消耗的总 token 数量。视频生成模型不统计输入 token，输入 token 为 0，故 total_tokens=completion_tokens。

usage.tool_usagenew object
使用工具的用量信息。
属性
