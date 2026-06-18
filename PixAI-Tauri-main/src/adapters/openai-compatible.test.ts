import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openAiCompatibleAdapter } from './openai-compatible'
import type { ProviderRuntimeProfile } from './types'
import type { ImageGenerationCallLog } from '../shared/types'

type TauriStreamPayload = {
  streamId: string
  kind: 'chunk' | 'done' | 'error'
  status?: number
  statusText?: string
  chunkBase64?: string
  error?: string
}

const profile: ProviderRuntimeProfile = {
  id: 'profile-1',
  name: 'Local mock',
  type: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:37123',
  defaultImageModel: 'gpt-image-1',
  defaultPromptModel: 'gpt-5.4-mini',
  imageGenerationEndpoint: 'images-api',
  enabledUsages: ['image', 'prompt'],
  capabilities: ['text-to-image', 'image-to-image', 'prompt-assist', 'connection-test'],
  apiKeyStored: true,
  insecureStorage: true,
  apiKey: 'sk-123456789',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

describe('openAiCompatibleAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output_text: 'ok prompt',
            data: [{ b64_json: 'a'.repeat(120) }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
  })

  it('routes prompt assistant requests to responses endpoint', async () => {
    await expect(openAiCompatibleAdapter.inspirePrompt(profile)).resolves.toBe('ok prompt')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37123/v1/responses', expect.objectContaining({ method: 'POST' }))
  })

  it('routes text-to-image requests to image generations endpoint', async () => {
    let callLog: ImageGenerationCallLog | null = null
    await openAiCompatibleAdapter.generateImage(profile, {
      input: {
        conversationId: 'c1',
        prompt: 'test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1
      },
      referenceImages: [],
      onCallLog: (log) => {
        callLog = log
      }
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37123/v1/images/generations', expect.objectContaining({ method: 'POST' }))
    expect(callLog).toMatchObject({
      provider: {
        id: 'profile-1',
        name: 'Local mock',
        type: 'openai-compatible',
        imageGenerationEndpoint: 'images-api'
      },
      endpoint: 'http://127.0.0.1:37123/v1/images/generations',
      method: 'POST',
      transport: 'json',
      request: {
        headers: {
          Authorization: 'Bearer ***',
          'Content-Type': 'application/json'
        },
        body: {
          model: 'gpt-image-1',
          prompt: 'test',
          size: '1024x1024'
        }
      }
    })
  })

  it('extracts images endpoint stream results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: image_generation.completed',
        `data: ${JSON.stringify({ type: 'image_generation.completed', b64_json: 's'.repeat(120) })}`,
        '',
        'event: done',
        'data: [DONE]',
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    const images = await openAiCompatibleAdapter.generateImage(profile, {
      input: {
        conversationId: 'c1',
        prompt: 'test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        stream: true
      },
      referenceImages: []
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37123/v1/images/generations', expect.objectContaining({ method: 'POST' }))
    expect(images[0].b64_json).toBe('s'.repeat(120))
  })

  it('surfaces images endpoint stream errors from HTTP 200 responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: error',
        `data: ${JSON.stringify({
          type: 'error',
          error: {
            type: 'upstream_error',
            message: 'stream disconnected before image generation completed'
          }
        })}`,
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    await expect(openAiCompatibleAdapter.generateImage(profile, {
      input: {
        conversationId: 'c1',
        prompt: 'test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        stream: true
      },
      referenceImages: []
    })).rejects.toMatchObject({
      message: 'stream disconnected before image generation completed（upstream_error）'
    })
  })

  it('routes image-to-image requests to image edits endpoint', async () => {
    await openAiCompatibleAdapter.generateImage(profile, {
      input: {
        conversationId: 'c1',
        prompt: 'test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        referenceImageIds: ['r1']
      },
      referenceImages: [{ name: 'ref.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${'a'.repeat(120)}` }]
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37123/v1/images/edits', expect.objectContaining({ method: 'POST' }))
  })

  it('routes Tauri image edits through platform HTTP proxy', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      status: 200,
      status_text: 'OK',
      body: JSON.stringify({ data: [{ b64_json: 'p'.repeat(120) }] })
    })
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke }, configurable: true })

    const images = await openAiCompatibleAdapter.generateImage(profile, {
      input: {
        conversationId: 'c1',
        prompt: 'edit test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        referenceImageIds: ['r1']
      },
      referenceImages: [{ name: 'ref.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${'a'.repeat(120)}` }]
    })
    const proxyRequest = vi.mocked(invoke).mock.calls[0]?.[1] as { request?: { url?: string; method?: string; headers?: Record<string, string>; body?: string; bodyBase64?: string } }
    const multipartBody = atob(proxyRequest.request?.bodyBase64 || '')

    expect(images[0].b64_json).toBe('p'.repeat(120))
    expect(fetch).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('http_proxy', expect.anything(), undefined)
    expect(proxyRequest.request).toMatchObject({
      url: 'http://127.0.0.1:37123/v1/images/edits',
      method: 'POST'
    })
    expect(proxyRequest.request?.headers?.authorization).toBe('Bearer sk-123456789')
    expect(proxyRequest.request?.headers?.['content-type']).toContain('multipart/form-data; boundary=')
    expect(proxyRequest.request?.body).toBeUndefined()
    expect(multipartBody).toContain('name="prompt"')
    expect(multipartBody).toContain('edit test')
    expect(multipartBody).toContain('name="image[]"')
    expect(multipartBody).toContain('filename="ref.png"')
  })

  it('routes Tauri streaming image edits through platform stream proxy', async () => {
    const callbacks = new Map<number, (event: { payload: TauriStreamPayload }) => void>()
    let nextCallbackId = 1
    const invoke = vi.fn(async (command: string, args?: { request?: { streamId?: string } }) => {
      if (command === 'plugin:event|listen') return 1
      if (command === 'plugin:event|unlisten') return undefined
      if (command !== 'http_proxy_stream') throw new Error(`unexpected command ${command}`)
      const streamId = args?.request?.streamId || ''
      await Promise.resolve()
      const streamHandler = callbacks.values().next().value
      streamHandler?.({
        payload: {
          streamId,
          kind: 'chunk',
          status: 200,
          statusText: 'OK',
          chunkBase64: btoa(JSON.stringify({ data: [{ b64_json: 'q'.repeat(120) }] }))
        }
      })
      streamHandler?.({
        payload: {
          streamId,
          kind: 'done',
          status: 200,
          statusText: 'OK'
        }
      })
    })
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke,
        transformCallback: (handler: (event: { payload: TauriStreamPayload }) => void) => {
          const id = nextCallbackId
          nextCallbackId += 1
          callbacks.set(id, handler)
          return id
        },
        unregisterCallback: (id: number) => {
          callbacks.delete(id)
        }
      },
      configurable: true
    })
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
      value: {
        unregisterListener: vi.fn()
      },
      configurable: true
    })

    const images = await openAiCompatibleAdapter.generateImage(profile, {
      input: {
        conversationId: 'c1',
        prompt: 'stream edit test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        stream: true,
        partialImages: 0,
        generationTimeoutSeconds: 600,
        referenceImageIds: ['r1']
      },
      referenceImages: [{ name: 'ref.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${'a'.repeat(120)}` }]
    })
    const proxyRequest = vi.mocked(invoke).mock.calls.find(([command]) => command === 'http_proxy_stream')?.[1] as { request?: { url?: string; method?: string; headers?: Record<string, string>; body?: string; bodyBase64?: string; timeoutMs?: number; firstByteTimeoutMs?: number } }
    const multipartBody = atob(proxyRequest.request?.bodyBase64 || '')

    expect(images[0].b64_json).toBe('q'.repeat(120))
    expect(fetch).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('plugin:event|listen', expect.objectContaining({ event: 'pixai://http-proxy-stream' }), undefined)
    expect(invoke).toHaveBeenCalledWith('http_proxy_stream', expect.anything(), undefined)
    expect(proxyRequest.request).toMatchObject({
      url: 'http://127.0.0.1:37123/v1/images/edits',
      method: 'POST',
      timeoutMs: 600000,
      firstByteTimeoutMs: 20000
    })
    expect(proxyRequest.request?.headers?.authorization).toBe('Bearer sk-123456789')
    expect(proxyRequest.request?.headers?.['content-type']).toContain('multipart/form-data; boundary=')
    expect(proxyRequest.request?.body).toBeUndefined()
    expect(multipartBody).toContain('name="stream"')
    expect(multipartBody).toContain('true')
    expect(multipartBody).toContain('name="prompt"')
    expect(multipartBody).toContain('stream edit test')
    expect(multipartBody).toContain('name="image[]"')
    expect(multipartBody).toContain('filename="ref.png"')
  })

  it('routes responses image-generation profiles through streaming responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: response.image_generation_call.partial_image',
        `data: ${JSON.stringify({ type: 'response.image_generation_call.partial_image', partial_image_b64: 'a'.repeat(120) })}`,
        '',
        'event: response.completed',
        'data: {"type":"response.completed"}',
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    const images = await openAiCompatibleAdapter.generateImage({ ...profile, imageGenerationEndpoint: 'responses-api' }, {
      input: {
        conversationId: 'c1',
        prompt: 'test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        stream: true,
        partialImages: 1
      },
      referenceImages: []
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body || '{}'))
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37123/v1/responses', expect.objectContaining({ method: 'POST' }))
    expect(body.stream).toBe(true)
    expect(body.tool_choice).toEqual({ type: 'image_generation' })
    expect(body.tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'generate',
      model: 'gpt-image-1',
      size: '1024x1024',
      quality: 'high',
      partial_images: 1
    })
    expect(images[0].b64_json).toBe('a'.repeat(120))
  })

  it('routes responses image-to-image requests through streaming responses with input images', async () => {
    const referenceDataUrl = `data:image/png;base64,${'c'.repeat(120)}`
    const callLogs: ImageGenerationCallLog[] = []
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: response.image_generation_call.completed',
        `data: ${JSON.stringify({ type: 'response.image_generation_call.completed', result: 'd'.repeat(120) })}`,
        '',
        'event: response.completed',
        'data: {"type":"response.completed"}',
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    const images = await openAiCompatibleAdapter.generateImage({ ...profile, imageGenerationEndpoint: 'responses-api' }, {
      input: {
        conversationId: 'c1',
        prompt: 'edit test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        stream: true,
        partialImages: 1,
        inputFidelity: 'low',
        referenceImageIds: ['r1']
      },
      referenceImages: [{ name: 'ref.png', mimeType: 'image/png', dataUrl: referenceDataUrl }],
      onCallLog: (log) => {
        callLogs.push(log)
      }
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body || '{}'))
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37123/v1/responses', expect.objectContaining({ method: 'POST' }))
    expect(body.stream).toBe(true)
    expect(body.tool_choice).toEqual({ type: 'image_generation' })
    expect(body.tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'edit',
      model: 'gpt-image-1',
      size: '1024x1024',
      quality: 'high',
      input_fidelity: 'low',
      partial_images: 1
    })
    expect(body.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'edit test' },
          { type: 'input_image', image_url: referenceDataUrl }
        ]
      }
    ])
    expect(images[0].b64_json).toBe('d'.repeat(120))
    const loggedCall = callLogs[0]
    expect(loggedCall).toBeTruthy()
    expect(loggedCall).toMatchObject({
      endpoint: 'http://127.0.0.1:37123/v1/responses',
      transport: 'streaming-json',
      request: {
        headers: {
          Authorization: 'Bearer ***',
          'Content-Type': 'application/json'
        }
      }
    })
    expect(JSON.stringify(loggedCall.request.body)).toContain('[data-url:image/png;base64:120]')
  })

  it('defaults responses image-to-image requests to high input fidelity', async () => {
    const referenceDataUrl = `data:image/png;base64,${'f'.repeat(120)}`
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: response.image_generation_call.completed',
        `data: ${JSON.stringify({ type: 'response.image_generation_call.completed', result: 'g'.repeat(120) })}`,
        '',
        'event: response.completed',
        'data: {"type":"response.completed"}',
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    await openAiCompatibleAdapter.generateImage({ ...profile, imageGenerationEndpoint: 'responses-api' }, {
      input: {
        conversationId: 'c1',
        prompt: 'edit test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        stream: true,
        referenceImageIds: ['r1']
      },
      referenceImages: [{ name: 'ref.png', mimeType: 'image/png', dataUrl: referenceDataUrl }]
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body || '{}'))
    expect(body.tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'edit',
      input_fidelity: 'high'
    })
  })

  it('does not send input fidelity for responses gpt-image-2 edits', async () => {
    const referenceDataUrl = `data:image/png;base64,${'h'.repeat(120)}`
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: response.image_generation_call.completed',
        `data: ${JSON.stringify({ type: 'response.image_generation_call.completed', result: 'i'.repeat(120) })}`,
        '',
        'event: response.completed',
        'data: {"type":"response.completed"}',
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    await openAiCompatibleAdapter.generateImage({
      ...profile,
      defaultImageModel: 'gpt-image-2',
      imageGenerationEndpoint: 'responses-api'
    }, {
      input: {
        conversationId: 'c1',
        prompt: 'edit test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        stream: true,
        inputFidelity: 'low',
        referenceImageIds: ['r1']
      },
      referenceImages: [{ name: 'ref.png', mimeType: 'image/png', dataUrl: referenceDataUrl }]
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body || '{}'))
    expect(body.tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'edit',
      model: 'gpt-image-2'
    })
    expect(body.tools[0]).not.toHaveProperty('input_fidelity')
  })

  it('extracts responses image results nested inside output item stream events', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: response.output_item.done',
        `data: ${JSON.stringify({
          type: 'response.output_item.done',
          item: {
            type: 'image_generation_call',
            status: 'completed',
            result: 'e'.repeat(120)
          }
        })}`,
        '',
        'event: response.completed',
        'data: {"type":"response.completed"}',
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    const images = await openAiCompatibleAdapter.generateImage({ ...profile, imageGenerationEndpoint: 'responses-api' }, {
      input: {
        conversationId: 'c1',
        prompt: 'test',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1,
        stream: true
      },
      referenceImages: []
    })

    expect(images[0].b64_json).toBe('e'.repeat(120))
  })

  it('surfaces responses stream failures instead of reporting missing images', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: response.output_item.added',
        `data: ${JSON.stringify({
          type: 'response.output_item.added',
          item: {
            id: 'ig_123',
            type: 'image_generation_call',
            status: 'in_progress'
          },
          output_index: 1
        })}`,
        '',
        'event: response.image_generation_call.generating',
        `data: ${JSON.stringify({
          type: 'response.image_generation_call.generating',
          item_id: 'ig_123',
          output_index: 1
        })}`,
        '',
        'event: error',
        `data: ${JSON.stringify({
          type: 'error',
          error: {
            code: 'upstream_error',
            message: 'Upstream request failed',
            param: null
          }
        })}`,
        '',
        'event: response.failed',
        `data: ${JSON.stringify({
          type: 'response.failed',
          response: {
            id: 'resp_failed',
            status: 'failed',
            error: {
              code: 'upstream_error',
              message: 'Upstream request failed'
            }
          }
        })}`,
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    let thrown: unknown
    try {
      await openAiCompatibleAdapter.generateImage({ ...profile, defaultImageModel: 'gpt-image-2', imageGenerationEndpoint: 'responses-api' }, {
        input: {
          conversationId: 'c1',
          prompt: 'test',
          ratio: '1:1',
          size: '1024x1024',
          quality: 'auto',
          n: 1,
          stream: false
        },
        referenceImages: []
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('Upstream request failed（upstream_error）')
    expect((thrown as { details?: Record<string, unknown> }).details).toMatchObject({
      status: 200,
      responseError: {
        code: 'upstream_error',
        message: 'Upstream request failed'
      }
    })
    expect(JSON.stringify((thrown as { details?: Record<string, unknown> }).details)).toContain('providerError')
  })

  it('detects responses image-generation support through stream output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: response.image_generation_call.completed',
        `data: ${JSON.stringify({ type: 'response.image_generation_call.completed', result: 'b'.repeat(120) })}`,
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    const result = await openAiCompatibleAdapter.testConnection({
      ...profile,
      imageGenerationEndpoint: 'responses-api',
      enabledUsages: ['image']
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('Responses 图像工具检测成功')
  })

  it('reports connected responses image-generation endpoints with no image output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      [
        'event: response.created',
        'data: {"type":"response.created"}',
        ''
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))

    const result = await openAiCompatibleAdapter.testConnection({
      ...profile,
      imageGenerationEndpoint: 'responses-api',
      enabledUsages: ['image']
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('没有返回图片事件')
  })
})
