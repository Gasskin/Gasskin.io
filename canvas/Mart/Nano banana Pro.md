> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Nano banana Pro 图像生成

>  - 异步处理模式，返回任务ID用于后续查询
- 高质量图像生成，专业级图像创建
- 生成的图像链接，有效期为24小时，请尽快保存 

<Info>
  **模型名兼容提示**：本接口同时兼容别名 `nano-banana-pro-ext`（等价于 `gemini-3-pro-image-preview`）、`nano-banana-pro`（等价于 `gemini-3-pro-image-preview-official`），别名与主名可互换使用、效果一致。
</Info>

<RequestExample>
  ```bash cURL theme={null}
  # model 可填 "gemini-3-pro-image-preview"，也兼容别名 "nano-banana-pro-ext"
  curl --request POST \
    --url https://api.apimart.ai/v1/images/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "gemini-3-pro-image-preview",
      "prompt": "月光下的竹林小径",
      "size": "1:1",
      "n": 1,
      "resolution": "1K"
    }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://api.apimart.ai/v1/images/generations"

  payload = {
      "model": "gemini-3-pro-image-preview",
      "prompt": "月光下的竹林小径",
      "size": "1:1",
      "n": 1,
      "resolution": "1K"
  }

  headers = {
      "Authorization": "Bearer <token>",
      "Content-Type": "application/json"
  }

  response = requests.post(url, json=payload, headers=headers)

  print(response.json())
  ```

  ```javascript JavaScript theme={null}
  const url = "https://api.apimart.ai/v1/images/generations";

  const payload = {
    model: "gemini-3-pro-image-preview",
    prompt: "月光下的竹林小径",
    size: "1:1",
    n: 1,
    resolution: "2K"
  };

  const headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  };

  fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error:', error));
  ```

  ```go Go theme={null}
  package main

  import (
      "bytes"
      "encoding/json"
      "fmt"
      "io/ioutil"
      "net/http"
  )

  func main() {
      url := "https://api.apimart.ai/v1/images/generations"

      payload := map[string]interface{}{
          "model":      "gemini-3-pro-image-preview",
          "prompt":     "月光下的竹林小径",
          "size":       "1:1",
          "n":          1,
          "resolution": "1K",
      }

      jsonData, _ := json.Marshal(payload)

      req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
      req.Header.Set("Authorization", "Bearer <token>")
      req.Header.Set("Content-Type", "application/json")

      client := &http.Client{}
      resp, err := client.Do(req)
      if err != nil {
          panic(err)
      }
      defer resp.Body.Close()

      body, _ := ioutil.ReadAll(resp.Body)
      fmt.Println(string(body))
  }
  ```

  ```java Java theme={null}
  import java.net.http.HttpClient;
  import java.net.http.HttpRequest;
  import java.net.http.HttpResponse;
  import java.net.URI;

  public class Main {
      public static void main(String[] args) throws Exception {
          String url = "https://api.apimart.ai/v1/images/generations";

          String payload = """
          {
            "model": "gemini-3-pro-image-preview",
            "prompt": "月光下的竹林小径",
            "size": "1:1",
            "n": 1,
            "resolution": "1K"
          }
          """;

          HttpClient client = HttpClient.newHttpClient();
          HttpRequest request = HttpRequest.newBuilder()
              .uri(URI.create(url))
              .header("Authorization", "Bearer <token>")
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(payload))
              .build();

          HttpResponse<String> response = client.send(request,
              HttpResponse.BodyHandlers.ofString());

          System.out.println(response.body());
      }
  }
  ```

  ```php PHP theme={null}
  <?php

  $url = "https://api.apimart.ai/v1/images/generations";

  $payload = [
      "model" => "gemini-3-pro-image-preview",
      "prompt" => "月光下的竹林小径",
      "size" => "1:1",
      "n" => 1,
      "resolution" => "2K"
  ];

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
      "Authorization: Bearer <token>",
      "Content-Type: application/json"
  ]);

  $response = curl_exec($ch);
  curl_close($ch);

  echo $response;
  ?>
  ```

  ```ruby Ruby theme={null}
  require 'net/http'
  require 'json'
  require 'uri'

  url = URI("https://api.apimart.ai/v1/images/generations")

  payload = {
    model: "gemini-3-pro-image-preview",
    prompt: "月光下的竹林小径",
    size: "1:1",
    n: 1,
    resolution: "2K"
  }

  http = Net::HTTP.new(url.host, url.port)
  http.use_ssl = true

  request = Net::HTTP::Post.new(url)
  request["Authorization"] = "Bearer <token>"
  request["Content-Type"] = "application/json"
  request.body = payload.to_json

  response = http.request(request)
  puts response.body
  ```

  ```swift Swift theme={null}
  import Foundation

  let url = URL(string: "https://api.apimart.ai/v1/images/generations")!

  let payload: [String: Any] = [
      "model": "gemini-3-pro-image-preview",
      "prompt": "月光下的竹林小径",
      "size": "1:1",
      "n": 1,
      "resolution": "1K"
  ]

  var request = URLRequest(url: url)
  request.httpMethod = "POST"
  request.setValue("Bearer <token>", forHTTPHeaderField: "Authorization")
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

  let task = URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
          print("Error: \(error)")
          return
      }
      
      if let data = data, let responseString = String(data: data, encoding: .utf8) {
          print(responseString)
      }
  }

  task.resume()
  ```

  ```csharp C# theme={null}
  using System;
  using System.Net.Http;
  using System.Text;
  using System.Threading.Tasks;

  class Program
  {
      static async Task Main(string[] args)
      {
          var url = "https://api.apimart.ai/v1/images/generations";

          var payload = @"{
              ""model"": ""gemini-3-pro-image-preview"",
              ""prompt"": ""月光下的竹林小径"",
              ""size"": ""1:1"",
              ""n"": 1,
              ""resolution"": ""2K""
          }";

          using var client = new HttpClient();
          client.DefaultRequestHeaders.Add("Authorization", "Bearer <token>");

          var content = new StringContent(payload, Encoding.UTF8, "application/json");
          var response = await client.PostAsync(url, content);
          var result = await response.Content.ReadAsStringAsync();

          Console.WriteLine(result);
      }
  }
  ```

  ```c C theme={null}
  #include <stdio.h>
  #include <curl/curl.h>

  int main(void) {
      CURL *curl;
      CURLcode res;

      curl_global_init(CURL_GLOBAL_DEFAULT);
      curl = curl_easy_init();

      if(curl) {
          const char *url = "https://api.apimart.ai/v1/images/generations";
          const char *payload = "{"
              "\"model\":\"gemini-3-pro-image-preview\","
              "\"prompt\":\"月光下的竹林小径\","
              "\"size\":\"1:1\","
              "\"n\":1,"
              "\"resolution\":\"2K\""
          "}";

          struct curl_slist *headers = NULL;
          headers = curl_slist_append(headers, "Authorization: Bearer <token>");
          headers = curl_slist_append(headers, "Content-Type: application/json");

          curl_easy_setopt(curl, CURLOPT_URL, url);
          curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload);
          curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

          res = curl_easy_perform(curl);

          if(res != CURLE_OK) {
              fprintf(stderr, "curl_easy_perform() failed: %s\n",
                      curl_easy_strerror(res));
          }

          curl_slist_free_all(headers);
          curl_easy_cleanup(curl);
      }

      curl_global_cleanup();
      return 0;
  }
  ```

  ```objectivec Objective-C theme={null}
  #import <Foundation/Foundation.h>

  int main(int argc, const char * argv[]) {
      @autoreleasepool {
          NSURL *url = [NSURL URLWithString:@"https://api.apimart.ai/v1/images/generations"];
          
          NSDictionary *payload = @{
              @"model": @"gemini-3-pro-image-preview",
              @"prompt": @"月光下的竹林小径",
              @"size": @"1:1",
              @"n": @1,
              @"resolution": @"2K"
          };
          
          NSError *error;
          NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload
                                                            options:0
                                                              error:&error];
          
          NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
          [request setHTTPMethod:@"POST"];
          [request setValue:@"Bearer <token>" forHTTPHeaderField:@"Authorization"];
          [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
          [request setHTTPBody:jsonData];
          
          NSURLSessionDataTask *task = [[NSURLSession sharedSession] 
              dataTaskWithRequest:request
              completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                  if (error) {
                      NSLog(@"Error: %@", error);
                      return;
                  }
                  NSString *result = [[NSString alloc] initWithData:data 
                                                          encoding:NSUTF8StringEncoding];
                  NSLog(@"%@", result);
              }];
          
          [task resume];
          [[NSRunLoop mainRunLoop] run];
      }
      return 0;
  }
  ```

  ```ocaml OCaml theme={null}
  (* Requires cohttp and yojson libraries *)
  open Lwt
  open Cohttp
  open Cohttp_lwt_unix

  let url = "https://api.apimart.ai/v1/images/generations"

  let payload = {|{
    "model": "gemini-3-pro-image-preview",
    "prompt": "月光下的竹林小径",
    "size": "1:1",
    "n": 1,
    "resolution": "1K"
  }|}

  let () =
    let headers = Header.init ()
      |> fun h -> Header.add h "Authorization" "Bearer <token>"
      |> fun h -> Header.add h "Content-Type" "application/json"
    in
    let body = Cohttp_lwt.Body.of_string payload in
    
    let response = Client.post ~headers ~body (Uri.of_string url) >>= fun (resp, body) ->
      body |> Cohttp_lwt.Body.to_string >|= fun body_str ->
      print_endline body_str
    in
    Lwt_main.run response
  ```

  ```dart Dart theme={null}
  import 'dart:convert';
  import 'package:http/http.dart' as http;

  void main() async {
    final url = Uri.parse('https://api.apimart.ai/v1/images/generations');
    
    final payload = {
      'model': 'gemini-3-pro-image-preview',
      'prompt': '月光下的竹林小径',
      'size': '1:1',
      'n': 1,
      'resolution': '1K'
    };
    
    final response = await http.post(
      url,
      headers: {
        'Authorization': 'Bearer <token>',
        'Content-Type': 'application/json'
    },
      body: jsonEncode(payload),
    );
    
    print(response.body);
  }
  ```

  ```r R theme={null}
  library(httr)
  library(jsonlite)

  url <- "https://api.apimart.ai/v1/images/generations"

  payload <- list(
    model = "gemini-3-pro-image-preview",
    prompt = "月光下的竹林小径",
    size = "1:1",
    n = 1,
    resolution = "1K"
  )

  response <- POST(
    url,
    add_headers(
      Authorization = "Bearer <token>",
      `Content-Type` = "application/json"
    ),
    body = toJSON(payload, auto_unbox = TRUE),
    encode = "raw"
  )

  cat(content(response, "text"))
  ```
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "code": 200,
    "data": [
      {
        "status": "submitted",
        "task_id": "task_01K8SGYNNNVBQTXNR4MM964S7K"
      }
    ]
  }
  ```

  ```json 400 theme={null}
  {
    "error": {
      "code": 400,
      "message": "请求参数无效",
      "type": "invalid_request_error"
    }
  }
  ```

  ```json 401 theme={null}
  {
    "error": {
      "code": 401,
      "message": "身份验证失败，请检查您的API密钥",
      "type": "authentication_error"
    }
  }
  ```

  ```json 402 theme={null}
  {
    "error": {
      "code": 402,
      "message": "账户余额不足，请充值后再试",
      "type": "payment_required"
    }
  }
  ```

  ```json 403 theme={null}
  {
    "error": {
      "code": 403,
      "message": "访问被禁止，您没有权限访问此资源",
      "type": "permission_error"
    }
  }
  ```

  ```json 429 theme={null}
  {
    "error": {
      "code": 429,
      "message": "请求过于频繁，请稍后再试",
      "type": "rate_limit_error"
    }
  }
  ```

  ```json 500 theme={null}
  {
    "error": {
      "code": 500,
      "message": "服务器内部错误，请稍后重试",
      "type": "server_error"
    }
  }
  ```

  ```json 502 theme={null}
  {
    "error": {
      "code": 502,
      "message": "网关错误，服务器暂时不可用",
      "type": "bad_gateway"
    }
  }
  ```
</ResponseExample>

## Authorizations

<ParamField header="Authorization" type="string" required>
  所有接口均需要使用Bearer Token进行认证

  获取 API Key：

  访问 [API Key 管理页面](https://apimart.ai/keys) 获取您的 API Key

  使用时在请求头中添加：

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## Body

<ParamField body="model" type="string" default="gemini-3-pro-image-preview" required>
  图像生成模型名称

  支持的模型：

  * `gemini-3-pro-image-preview` - 标准版本（兼容别名 `nano-banana-pro-ext`）
  * `gemini-3-pro-image-preview-official` - 官方版本（兼容别名 `nano-banana-pro`）

  示例：`"gemini-3-pro-image-preview"` 或 `"gemini-3-pro-image-preview-official"`

  <Note>
    为兼容旧版调用，别名 `nano-banana-pro-ext`（对应 `gemini-3-pro-image-preview`）、`nano-banana-pro`（对应 `gemini-3-pro-image-preview-official`）仍可正常使用。
  </Note>
</ParamField>

<ParamField body="prompt" type="string" required>
  图像生成的文本描述
</ParamField>

<ParamField body="size" type="string">
  图像生成的尺寸

  支持的格式：

  * 比例：`auto`、`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9`

  <Warning>
    文生图 `size` 为 `auto` 时默认 `1:1` 或 `16:9`；图生图按上游返回比例为准。（建议指定比例）
  </Warning>
</ParamField>

<ParamField body="n" type="integer">
  生成图像的数量

  取值范围：1

  默认值：1

  **⚠️ 注意：** 必须输入纯数字（如 `1`），不要加引号，否则会报错
</ParamField>

<ParamField body="resolution" type="string">
  输出图像分辨率

  支持的值：

  * `1K` - 1K 分辨率（默认）
  * `2K` - 2K 分辨率
  * `4K` - 4K 分辨率

  **⚠️ 注意：** 使用 base64 格式生成 4K 图像时，处理时间会较长
</ParamField>

<ParamField body="official_fallback" type="boolean" default="false">
  是否使用官方渠道兜底

  * `false`：不使用（默认）
  * `true`：使用官方渠道

  <Warning>
    当使用官方渠道（`gemini-3-pro-image-preview-official`）时，不能使用此参数。
  </Warning>
</ParamField>

<ParamField body="image_urls" type="array">
  参考图像的 URL 列表，用于图生图或图像编辑

  **💡 快速填写（Try it 区域）：**

  1. 点击 "+ Add an item" 添加一个图像URL
  2. 输入图像的完整 URL 地址或base64数据

  <Expandable title="详细字段说明">
    数组中的每个元素为字符串，支持两种格式：

    **1. 完整的图像URL地址**

    * 公开可访问的图像URL（http\:// 或 https\://）
    * 示例：`"https://example.com/image.jpg"`

    **2. Base64 编码格式**

    * **必须使用完整的 Data URI 格式**
    * 格式：`data:image/{格式};base64,{base64数据}`
    * 支持的图片格式：jpeg、png、webp 等
    * 示例：`"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABg..."`
    * ⚠️ 注意：必须包含 `data:image/jpeg;base64,` 前缀部分

    **限制：**

    * 单张图片不超过 10MB
    * 支持格式：.jpeg、.jpg、.png、.webp
  </Expandable>

  **限制：** 最多 14 张图片
</ParamField>

## Response

<ResponseField name="code" type="integer">
  响应状态码
</ResponseField>

<ResponseField name="data" type="array">
  返回数据数组

  <Expandable title="属性">
    <ResponseField name="status" type="string">
      任务状态

      * `submitted` - 已提交
    </ResponseField>

    <ResponseField name="task_id" type="string">
      任务唯一标识符
    </ResponseField>
  </Expandable>
</ResponseField>

