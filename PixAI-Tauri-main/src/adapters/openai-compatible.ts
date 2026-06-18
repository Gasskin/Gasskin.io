import {
  buildImageEditEndpoint,
  buildImageEndpoint,
  buildResponsesEndpoint,
  getDefaultImageSize,
  supportsImageInputFidelity,
  trimBaseUrl
} from '../shared/image-options'
import {
  fetchJsonThroughPlatform,
  fetchMultipartTextStreamThroughPlatform,
  fetchMultipartThroughPlatform,
  fetchTextStreamThroughPlatform
} from '../lib/platform'
import type { ImageApiData, ImageGenerationCallLog } from '../shared/types'
import type { ImageGenerationRequest, ProviderAdapter, ProviderRuntimeProfile } from './types'

type ImageApiResponse = {
  data?: ImageApiData[]
  error?: ProviderPayloadError
  error_code?: string
  message?: string
}

type ProviderPayloadError = {
  message?: string
  type?: string
  code?: string
  param?: string
}

type ResponsesApiPayload = {
  output_text?: string
  output?: Array<ResponsesOutputItem>
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: ProviderPayloadError | string
  error_code?: string
  message?: string
}

type ResponsesOutputItem = {
  type?: string
  status?: string
  content?: Array<{ text?: string } | string> | string
  result?: string
  image?: ImageApiData | string
  images?: Array<ImageApiData | string>
}

type ResponsesImageStreamResult = {
  images: ImageApiData[]
  eventCount: number
}

const RESPONSES_IMAGE_TEST_TIMEOUT_MS = 20000
const RESPONSES_IMAGE_GENERATION_TIMEOUT_BUFFER_MS = 5000

export const openAiCompatibleAdapter: ProviderAdapter = {
  type: 'openai-compatible',
  label: 'OpenAI 兼容接口',
  capabilities: ['text-to-image', 'image-to-image', 'prompt-assist', 'connection-test', 'streaming', 'input-fidelity'],
  async testConnection(profile, signal) {
    const startedAt = Date.now()
    const endpoint = buildResponsesEndpoint(profile.baseUrl)
    if (!profile.apiKey) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        endpoint,
        message: 'API Key 尚未配置。'
      }
    }

    try {
      if (profile.enabledUsages.includes('image') && profile.imageGenerationEndpoint === 'responses-api') {
        const result = await requestResponsesImageGeneration(profile, {
          input: {
            conversationId: 'connection-test',
            prompt: '生成一张极简纯色测试图。',
            model: profile.defaultImageModel,
            ratio: '1:1',
            size: '1024x1024',
            quality: 'low',
            n: 1,
            stream: true,
            partialImages: 0
          },
          referenceImages: [],
          signal
        }, RESPONSES_IMAGE_TEST_TIMEOUT_MS)
        return {
          ok: result.images.length > 0,
          checkedAt: new Date().toISOString(),
          endpoint,
          latencyMs: Date.now() - startedAt,
          message: result.images.length > 0
            ? 'Responses 图像工具检测成功。'
            : `Responses 图像工具已连接，但没有返回图片事件（事件数 ${result.eventCount}）。`
        }
      }
      const response = await fetchJsonThroughPlatform(endpoint, {
        method: 'POST',
        headers: buildHeaders(profile.apiKey),
        signal,
        body: JSON.stringify({
          model: profile.defaultPromptModel,
          input: '请只回复 OK。',
          max_output_tokens: 8
        })
      })
      const text = await response.text()
      const payload = parseResponsesPayload(text)
      return {
        ok: response.ok,
        checkedAt: new Date().toISOString(),
        endpoint,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        message: response.ok ? '连接测试成功。' : getProviderErrorMessage(payload, `连接失败，HTTP 状态码 ${response.status}。`)
      }
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        endpoint,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : '连接测试失败。'
      }
    }
  },
  async generateImage(profile, request) {
    if (!profile.apiKey) throw new Error('API Key 尚未配置。')
    const hasReferences = request.referenceImages.length > 0
    if (profile.imageGenerationEndpoint === 'responses-api') {
      return (await requestResponsesImageGeneration(
        profile,
        request,
        Math.max(1000, (request.input.generationTimeoutSeconds || 300) * 1000 + RESPONSES_IMAGE_GENERATION_TIMEOUT_BUFFER_MS)
      )).images
    }
    const endpoint = hasReferences ? buildImageEditEndpoint(profile.baseUrl) : buildImageEndpoint(profile.baseUrl)
    const response = hasReferences
      ? await requestImageEdit(endpoint, profile, request)
      : await requestImageGeneration(endpoint, profile, request)
    const text = await response.text()
    const payload = parseImagePayload(text)
    if (!response.ok) {
      throw new ProviderHttpError(getProviderErrorMessage(payload, `图片请求失败，HTTP 状态码 ${response.status}。`), {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        responseBody: text,
        responseError: payload.error
      })
    }
    if (payload.error) {
      throw new ProviderHttpError(getProviderErrorMessage(payload, '图片流式请求失败。'), {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        responseBody: text,
        responseError: payload.error,
        responseSummary: summarizeImageResponse(text, payload)
      })
    }
    const images = extractImagesFromImagePayload(payload)
    if (images.length === 0) {
      throw new ProviderHttpError('图片接口没有返回可识别的图片。', {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        responseSummary: summarizeImageResponse(text, payload)
      })
    }
    return images
  },
  inspirePrompt(profile, input = {}, signal) {
    return requestPrompt(
      profile,
      [
        '请生成一条可直接用于图像生成的中文提示词。',
        '提示词需要包含主体、场景、构图、光线、风格、细节与氛围。',
        input.hasReferenceImages ? '当前会话包含参考图，请提示保留参考图主体和风格方向。' : '',
        '只输出提示词正文，不要解释，不要加标题。'
      ]
        .filter(Boolean)
        .join('\n'),
      signal
    )
  },
  enrichPrompt(profile, input, signal) {
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error('请先输入提示词。')
    return requestPrompt(
      profile,
      [
        '请丰富并优化下面的图像生成提示词。',
        '保持用户原意和核心主体不变，跟随原提示词语言输出。',
        '补充视觉细节、镜头/构图、材质、光影、风格描述。',
        input.hasReferenceImages ? '当前会话包含参考图，请保留参考图主体和风格方向。' : '',
        '只输出优化后的提示词正文，不要解释，不要加标题。',
        '',
        prompt
      ]
        .filter((line) => line !== '')
        .join('\n'),
      signal
    )
  }
}

async function requestImageGeneration(endpoint: string, profile: ProviderRuntimeProfile, request: ImageGenerationRequest): Promise<Response> {
  const { input } = request
  const body = {
    model: input.model || profile.defaultImageModel,
    prompt: input.prompt.trim(),
    size: input.size || getDefaultImageSize(input.ratio),
    quality: input.quality,
    n: Math.min(10, Math.max(1, input.n || 1)),
    ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
    ...(input.outputCompression != null ? { output_compression: input.outputCompression } : {}),
    ...(input.background ? { background: input.background } : {}),
    ...(input.moderation ? { moderation: input.moderation } : {}),
    ...(input.stream ? { stream: input.stream } : {}),
    ...(input.stream && input.partialImages ? { partial_images: input.partialImages } : {})
  }
  recordImageGenerationCallLog(profile, request, endpoint, input.stream ? 'streaming-json' : 'json', buildHeaders(profile.apiKey || ''), body)
  return fetchJsonThroughPlatform(endpoint, {
    method: 'POST',
    headers: buildHeaders(profile.apiKey || ''),
    signal: request.signal,
    body: JSON.stringify(body)
  })
}

async function requestImageEdit(endpoint: string, profile: ProviderRuntimeProfile, request: ImageGenerationRequest): Promise<Response> {
  const { input } = request
  const logBody = buildImageEditLogBody(profile, request)
  const form = new FormData()
  form.set('model', input.model || profile.defaultImageModel)
  form.set('prompt', input.prompt.trim())
  form.set('size', input.size || getDefaultImageSize(input.ratio))
  form.set('quality', input.quality)
  form.set('n', String(Math.min(10, Math.max(1, input.n || 1))))
  if (input.outputFormat) form.set('output_format', input.outputFormat)
  if (input.outputCompression != null) form.set('output_compression', String(input.outputCompression))
  if (input.background) form.set('background', input.background)
  if (input.moderation) form.set('moderation', input.moderation)
  if (input.stream) form.set('stream', 'true')
  if (input.stream && input.partialImages) form.set('partial_images', String(input.partialImages))
  if (input.inputFidelity && supportsImageInputFidelity(input.model || profile.defaultImageModel)) {
    form.set('input_fidelity', input.inputFidelity)
  }
  for (const reference of request.referenceImages) {
    form.append('image[]', dataUrlToBlob(reference.dataUrl, reference.mimeType), reference.name)
  }
  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${profile.apiKey || ''}`
    },
    signal: request.signal,
    body: form
  }
  recordImageGenerationCallLog(
    profile,
    request,
    endpoint,
    input.stream ? 'streaming-multipart' : 'multipart',
    { Authorization: `Bearer ${profile.apiKey || ''}`, 'Content-Type': 'multipart/form-data' },
    logBody
  )
  if (input.stream) {
    const response = await fetchMultipartTextStreamThroughPlatform(endpoint, requestInit, {
      timeoutMs: Math.max(1000, (input.generationTimeoutSeconds || 300) * 1000),
      firstByteTimeoutMs: Math.min(Math.max(1000, (input.generationTimeoutSeconds || 300) * 1000), RESPONSES_IMAGE_TEST_TIMEOUT_MS)
    })
    return new Response(response.text, {
      status: response.status,
      statusText: response.statusText
    })
  }
  return fetchMultipartThroughPlatform(endpoint, requestInit)
}

async function requestResponsesImageGeneration(profile: ProviderRuntimeProfile, request: ImageGenerationRequest, timeoutMs: number): Promise<ResponsesImageStreamResult> {
  const failOnEmptyImages = request.input.conversationId !== 'connection-test'
  const endpoint = buildResponsesEndpoint(profile.baseUrl)
  const input = request.input
  const hasReferences = request.referenceImages.length > 0
  const imageModel = input.model || profile.defaultImageModel
  const inputFidelity = hasReferences && supportsImageInputFidelity(imageModel)
    ? input.inputFidelity || 'high'
    : undefined
  const body = {
    model: profile.defaultPromptModel,
    input: buildResponsesImageInput(input.prompt, request.referenceImages),
    stream: true,
    tool_choice: { type: 'image_generation' },
    tools: [
      {
        type: 'image_generation',
        action: hasReferences ? 'edit' : 'generate',
        model: imageModel,
        size: input.size || getDefaultImageSize(input.ratio),
        quality: input.quality,
        ...(inputFidelity ? { input_fidelity: inputFidelity } : {}),
        ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
        ...(input.outputCompression != null ? { output_compression: input.outputCompression } : {}),
        ...(input.background ? { background: input.background } : {}),
        ...(input.moderation ? { moderation: input.moderation } : {}),
        ...(input.partialImages ? { partial_images: input.partialImages } : {})
      }
    ]
  }
  recordImageGenerationCallLog(profile, request, endpoint, 'streaming-json', buildHeaders(profile.apiKey || ''), body)
  const response = await fetchTextStreamThroughPlatform(endpoint, {
    method: 'POST',
    headers: buildHeaders(profile.apiKey || ''),
    signal: request.signal,
    body: JSON.stringify(body)
  }, { timeoutMs, firstByteTimeoutMs: Math.min(timeoutMs, RESPONSES_IMAGE_TEST_TIMEOUT_MS) })
  const text = response.text
  const payload = parseResponsesPayload(text)
  const streamError = extractResponsesProviderError(text, payload)
  if (response.status < 200 || response.status >= 300) {
    throw new ProviderHttpError(getProviderErrorMessage(payload, `Responses 图像工具请求失败，HTTP 状态码 ${response.status}。`), {
      endpoint,
      status: response.status,
      statusText: response.statusText,
      responseBody: text,
      responseError: payload.error || streamError
    })
  }
  const result = extractResponsesImageStreamResult(text)
  if (result.images.length > 0) return result
  if (streamError && failOnEmptyImages) {
    throw new ProviderHttpError(getProviderErrorMessage({ error: streamError }, 'Responses 图像工具流式请求失败。'), {
      endpoint,
      status: response.status,
      statusText: response.statusText,
      responseError: streamError,
      responseSummary: summarizeResponsesImageResponse(text, payload, result.eventCount, streamError)
    })
  }
  const fallbackImages = extractResponsesImages(payload)
  if (fallbackImages.length === 0 && failOnEmptyImages) {
    throw new ProviderHttpError('Responses 图像工具没有返回可识别的图片。', {
      endpoint,
      status: response.status,
      statusText: response.statusText,
      responseSummary: summarizeResponsesImageResponse(text, payload, result.eventCount, streamError)
    })
  }
  return {
    images: fallbackImages,
    eventCount: result.eventCount
  }
}

function buildResponsesImageInput(prompt: string, referenceImages: ImageGenerationRequest['referenceImages']): string | Array<Record<string, unknown>> {
  const text = prompt.trim()
  if (referenceImages.length === 0) return text
  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text },
        ...referenceImages.map((reference) => ({
          type: 'input_image',
          image_url: reference.dataUrl
        }))
      ]
    }
  ]
}

async function requestPrompt(profile: ProviderRuntimeProfile, instruction: string, signal?: AbortSignal): Promise<string> {
  if (!profile.apiKey) throw new Error('API Key 尚未配置。')
  const endpoint = buildResponsesEndpoint(profile.baseUrl)
  const response = await fetchJsonThroughPlatform(endpoint, {
    method: 'POST',
    headers: buildHeaders(profile.apiKey),
    signal,
    body: JSON.stringify({
      model: profile.defaultPromptModel,
      input: [
        {
          role: 'system',
          content: '你是专业图像生成提示词助手，输出简洁、具体、可直接用于生成图片的提示词。'
        },
        {
          role: 'user',
          content: instruction
        }
      ],
      max_output_tokens: 700
    })
  })
  const text = await response.text()
  const payload = parseResponsesPayload(text)
  if (!response.ok) {
    throw new ProviderHttpError(getProviderErrorMessage(payload, `提示词生成失败，HTTP 状态码 ${response.status}。`), {
      endpoint,
      status: response.status,
      statusText: response.statusText,
      responseBody: text,
      responseError: payload.error
    })
  }
  const prompt = sanitizePromptText(extractResponseText(payload))
  if (!prompt) throw new Error('提示词助手没有返回内容。')
  return prompt
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
}

function parseImagePayload(text: string): ImageApiResponse {
  if (!text.trim()) return {}
  const ssePayloads = parseSsePayloads(text)
  if (ssePayloads.length) {
    const streamError = extractProviderError(ssePayloads)
    return {
      data: dedupeImages(ssePayloads.flatMap((payload) => extractImageApiData(payload))),
      ...(streamError ? { error: streamError } : {})
    }
  }
  try {
    return JSON.parse(text) as ImageApiResponse
  } catch {
    return {}
  }
}

function extractImagesFromImagePayload(payload: ImageApiResponse): ImageApiData[] {
  return dedupeImages(extractImageApiData(payload))
}

function parseResponsesPayload(text: string): ResponsesApiPayload {
  if (!text.trim()) return {}
  const ssePayloads = parseSsePayloads(text)
  if (ssePayloads.length) return ssePayloads.at(-1) as ResponsesApiPayload
  try {
    return JSON.parse(text) as ResponsesApiPayload
  } catch {
    return {}
  }
}

function extractResponsesImageStreamResult(text: string): ResponsesImageStreamResult {
  const payloads = parseSsePayloads(text)
  const images: ImageApiData[] = []
  for (const payload of payloads) {
    images.push(...extractImageApiData(payload))
  }
  return {
    images: dedupeImages(images),
    eventCount: payloads.length
  }
}

function extractResponsesProviderError(text: string, payload: ResponsesApiPayload): ProviderPayloadError | undefined {
  const payloads = parseSsePayloads(text)
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const error = extractProviderError(payloads[index])
    if (error) return error
  }
  return extractProviderError(payload)
}

function parseSsePayloads(text: string): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data || data === '[DONE]') continue
    try {
      const payload = JSON.parse(data) as unknown
      if (isRecord(payload)) payloads.push(payload)
    } catch {
      // Ignore non-JSON stream keepalives.
    }
  }
  return payloads
}

function extractResponsesImages(payload: ResponsesApiPayload): ImageApiData[] {
  const images: ImageApiData[] = []
  for (const output of payload.output || []) {
    images.push(...extractImageApiData(output))
  }
  images.push(...extractImageApiData(payload))
  return dedupeImages(images)
}

function summarizeResponsesImageResponse(text: string, payload: ResponsesApiPayload, eventCount: number, providerError?: ProviderPayloadError): Record<string, unknown> {
  const payloads = parseSsePayloads(text)
  return {
    eventCount,
    payloadCount: payloads.length,
    payloadSamples: payloads.slice(-6).map(summarizeUnknown),
    finalPayload: summarizeUnknown(payload),
    ...(providerError ? { providerError } : {})
  }
}

function summarizeImageResponse(text: string, payload: ImageApiResponse): Record<string, unknown> {
  const payloads = parseSsePayloads(text)
  return {
    payloadCount: payloads.length,
    payloadSamples: payloads.slice(-6).map(summarizeUnknown),
    finalPayload: summarizeUnknown(payload),
    bodyPreview: text.slice(0, 1200)
  }
}

function summarizeUnknown(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return isLikelyBase64Image(value) ? `[base64:${value.length}]` : value.slice(0, 240)
  }
  if (!isRecord(value)) {
    if (Array.isArray(value)) return value.slice(0, 6).map((item) => summarizeUnknown(item, depth + 1))
    return value
  }
  if (depth >= 4) return `[object:${Object.keys(value).join(',')}]`
  return Object.fromEntries(
    Object.entries(value).slice(0, 20).map(([key, nested]) => [key, summarizeUnknown(nested, depth + 1)])
  )
}

function extractImageApiData(value: unknown): ImageApiData[] {
  if (typeof value === 'string') return isLikelyBase64Image(value) ? [{ b64_json: value }] : []
  if (Array.isArray(value)) return value.flatMap((item) => extractImageApiData(item))
  if (!isRecord(value)) return []
  const images: ImageApiData[] = []
  for (const key of ['b64_json', 'image_base64', 'partial_image_b64', 'partial_image', 'result'] as const) {
    const candidate = value[key]
    if (typeof candidate === 'string' && isLikelyBase64Image(candidate)) images.push({ b64_json: candidate })
  }
  for (const key of ['url', 'image_url'] as const) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate) images.push({ url: candidate })
  }
  for (const key of ['image', 'data', 'item', 'response'] as const) {
    images.push(...extractImageApiData(value[key]))
  }
  for (const key of ['images', 'output', 'content'] as const) {
    const candidate = value[key]
    if (Array.isArray(candidate)) {
      for (const item of candidate) images.push(...extractImageApiData(item))
    } else {
      images.push(...extractImageApiData(candidate))
    }
  }
  return images
}

function dedupeImages(images: ImageApiData[]): ImageApiData[] {
  const seen = new Set<string>()
  const result: ImageApiData[] = []
  for (const image of images) {
    const key = image.b64_json ? `b64:${image.b64_json}` : image.url ? `url:${image.url}` : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(image)
  }
  return result
}

function isLikelyBase64Image(value: string): boolean {
  const compact = value.trim()
  return compact.length > 80 && /^[A-Za-z0-9+/=_-]+$/.test(compact)
}

function extractResponseText(payload: ResponsesApiPayload): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  for (const output of payload.output || []) {
    if (typeof output.content === 'string') return output.content
    for (const content of output.content || []) {
      if (typeof content === 'string') return content
      if (typeof content.text === 'string') return content.text
    }
  }
  return payload.choices?.find((choice) => typeof choice.message?.content === 'string')?.message?.content || ''
}

function getProviderErrorMessage(payload: ImageApiResponse | ResponsesApiPayload, fallback: string): string {
  const error = isRecord(payload.error) ? payload.error : undefined
  const message = (typeof payload.error === 'string' ? payload.error : error?.message) || payload.message || fallback
  const code = payload.error_code || (typeof error?.code === 'string' ? error.code : undefined) || (typeof error?.type === 'string' ? error.type : undefined)
  return code && !message.includes(code)
    ? `${message}（${code}）`
    : message
}

function extractProviderError(value: unknown): ProviderPayloadError | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const error = extractProviderError(item)
      if (error) return error
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  const nested = extractProviderError(value.error)
  const responseNested = extractProviderError(value.response)
  const ownType = typeof value.type === 'string' ? value.type : undefined
  const ownMessage = typeof value.message === 'string' ? value.message : undefined
  const ownCode = typeof value.code === 'string'
    ? value.code
    : typeof value.error_code === 'string'
      ? value.error_code
      : undefined
  const type = ownType === 'error' && nested?.type ? nested.type : ownType || nested?.type || responseNested?.type
  const message = ownMessage || nested?.message || responseNested?.message
  const code = ownCode || nested?.code || responseNested?.code
  const param = typeof value.param === 'string' ? value.param : nested?.param || responseNested?.param
  const explicitError =
    type === 'error' ||
    type === 'response.failed' ||
    type?.endsWith('_error') ||
    Boolean(value.error) ||
    Boolean(nested) ||
    Boolean(responseNested) ||
    Boolean(ownMessage && ownCode)
  if (!explicitError) return undefined
  return {
    ...(message ? { message } : {}),
    ...(type ? { type } : {}),
    ...(code ? { code } : {}),
    ...(param ? { param } : {})
  }
}

function sanitizePromptText(value: string): string {
  const trimmed = value.trim()
  const fenceMatch = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/)
  return (fenceMatch?.[1] || trimmed).trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function dataUrlToBlob(dataUrl: string, fallbackMimeType: string): Blob {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) return new Blob([], { type: fallbackMimeType })
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: match[1] || fallbackMimeType })
}

function buildImageEditLogBody(profile: ProviderRuntimeProfile, request: ImageGenerationRequest): Record<string, unknown> {
  const { input } = request
  return {
    model: input.model || profile.defaultImageModel,
    prompt: input.prompt.trim(),
    size: input.size || getDefaultImageSize(input.ratio),
    quality: input.quality,
    n: String(Math.min(10, Math.max(1, input.n || 1))),
    ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
    ...(input.outputCompression != null ? { output_compression: String(input.outputCompression) } : {}),
    ...(input.background ? { background: input.background } : {}),
    ...(input.moderation ? { moderation: input.moderation } : {}),
    ...(input.stream ? { stream: 'true' } : {}),
    ...(input.stream && input.partialImages ? { partial_images: String(input.partialImages) } : {}),
    ...(input.inputFidelity && supportsImageInputFidelity(input.model || profile.defaultImageModel) ? { input_fidelity: input.inputFidelity } : {}),
    'image[]': request.referenceImages.map((reference) => ({
      filename: reference.name,
      mimeType: reference.mimeType,
      dataUrl: summarizeDataUrl(reference.dataUrl)
    }))
  }
}

function recordImageGenerationCallLog(
  profile: ProviderRuntimeProfile,
  request: ImageGenerationRequest,
  endpoint: string,
  transport: ImageGenerationCallLog['transport'],
  headers: Record<string, string>,
  body: unknown
): void {
  if (!request.onCallLog) return
  try {
    request.onCallLog({
      provider: {
        id: profile.id,
        name: profile.name,
        type: profile.type,
        baseUrl: profile.baseUrl,
        imageGenerationEndpoint: profile.imageGenerationEndpoint
      },
      endpoint,
      method: 'POST',
      transport,
      request: {
        headers: sanitizeHeaders(headers),
        body: sanitizeRequestBody(body)
      },
      createdAt: new Date().toISOString()
    })
  } catch {
    // Call logs are diagnostic metadata; they should never break generation.
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      key.toLowerCase() === 'authorization' && value ? 'Bearer ***' : value
    ])
  )
}

function sanitizeRequestBody(value: unknown): unknown {
  if (typeof value === 'string') {
    if (isDataUrl(value)) return summarizeDataUrl(value)
    if (isLikelyBase64Image(value)) return `[base64:${value.length}]`
    return value.length > 2000 ? `${value.slice(0, 2000)}...[${value.length} chars]` : value
  }
  if (Array.isArray(value)) return value.map(sanitizeRequestBody)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizeRequestBody(nested)])
  )
}

function isDataUrl(value: string): boolean {
  return /^data:[^;]+;base64,/i.test(value)
}

function summarizeDataUrl(value: string): string {
  const match = /^data:([^;]+);base64,(.*)$/i.exec(value)
  if (!match) return value.length > 2000 ? `${value.slice(0, 2000)}...[${value.length} chars]` : value
  return `[data-url:${match[1]};base64:${match[2].length}]`
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}

export function defaultOpenAiBaseUrl(): string {
  return trimBaseUrl('https://api.openai.com')
}
