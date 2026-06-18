import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPixaiApi } from './app-api'
import { handleCodexBridgeRequest } from './codex-bridge'

function bridgeRequest(path: string, method = 'GET', body?: unknown) {
  return {
    id: `request-${Math.random()}`,
    method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
    headers: {},
    port: 43117
  }
}

describe('codex bridge', () => {
  const bridgeImageBase64 = btoa('bridge-image'.repeat(8))

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/v1/responses')) {
          return new Response(JSON.stringify({ output_text: '桥接提示词' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        }
        return new Response(JSON.stringify({ data: [{ b64_json: bridgeImageBase64 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      })
    )
  })

  it('returns health information', async () => {
    const response = await handleCodexBridgeRequest(createPixaiApi(), bridgeRequest('/health'))
    const payload = JSON.parse(response.body || '{}')

    expect(response.status).toBe(200)
    expect(payload.bridge).toBe('codex')
    expect(payload.port).toBe(43117)
  })

  it('updates selected profile models through settings compatibility fields', async () => {
    const api = createPixaiApi()
    const response = await handleCodexBridgeRequest(
      api,
      bridgeRequest('/settings', 'PATCH', {
        defaultModel: 'gpt-image-2-fast',
        promptModel: 'gpt-5.4-mini',
        imageGenerationEndpoint: 'responses-api'
      })
    )
    const payload = JSON.parse(response.body || '{}')
    const imageProfile = payload.profiles.find((profile: { id: string }) => profile.id === payload.selectedImageProfileId)
    const promptProfile = payload.profiles.find((profile: { id: string }) => profile.id === payload.selectedPromptProfileId)

    expect(response.status).toBe(200)
    expect(imageProfile.defaultImageModel).toBe('gpt-image-2-fast')
    expect(imageProfile.imageGenerationEndpoint).toBe('responses-api')
    expect(payload.imageGenerationEndpoint).toBe('responses-api')
    expect(promptProfile.defaultPromptModel).toBe('gpt-5.4-mini')
  })

  it('accepts reference-compatible baseURL and apiKey settings fields', async () => {
    const api = createPixaiApi()
    const response = await handleCodexBridgeRequest(
      api,
      bridgeRequest('/settings', 'PATCH', {
        baseURL: 'http://127.0.0.1:37125',
        apiKey: 'sk-123456789',
        defaultModel: 'gpt-image-2',
        promptModel: 'gpt-5.4-mini'
      })
    )
    const payload = JSON.parse(response.body || '{}')
    const imageProfile = payload.imageProfile

    expect(response.status).toBe(200)
    expect(payload.baseURL).toBe('http://127.0.0.1:37125')
    expect(imageProfile.baseUrl).toBe('http://127.0.0.1:37125')
    expect(imageProfile.apiKeyStored).toBe(true)
    expect(payload.defaultModel).toBe('gpt-image-2')
    expect(payload.promptModel).toBe('gpt-5.4-mini')
  })

  it('generates images through the existing image service and exposes history file bytes', async () => {
    const api = createPixaiApi()
    const settings = await api.settings.upsertProfile({
      name: 'Local image',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['image'],
      apiKey: 'sk-123456789'
    })
    const profile = settings.profiles.at(-1)
    await api.settings.update({ selectedImageProfileId: profile?.id })

    const generateResponse = await handleCodexBridgeRequest(
      api,
      bridgeRequest('/generate', 'POST', {
        prompt: '桥接生成测试',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1
      })
    )
    const generated = JSON.parse(generateResponse.body || '{}')
    const historyId = generated.items[0].id
    const fileResponse = await handleCodexBridgeRequest(api, bridgeRequest(`/images/${historyId}/file`))

    expect(generateResponse.status).toBe(201)
    expect(generated.items[0].bridgeFileUrl).toContain(`/images/${historyId}/file`)
    expect(fileResponse.status).toBe(200)
    expect(fileResponse.headers?.['Content-Type']).toBe('image/png')
    expect(fileResponse.bodyBase64).toBe(bridgeImageBase64)
  })

  it('returns a preflight error without workspace records when image profile has no API key', async () => {
    const api = createPixaiApi()
    const settings = await api.settings.upsertProfile({
      name: 'No key image',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['image']
    })
    const profile = settings.profiles.at(-1)
    await api.settings.update({ selectedImageProfileId: profile?.id })

    const response = await handleCodexBridgeRequest(
      api,
      bridgeRequest('/generate', 'POST', {
        prompt: '桥接生成测试',
        ratio: '1:1',
        size: '1024x1024',
        quality: 'high',
        n: 1
      })
    )
    const payload = JSON.parse(response.body || '{}')
    const conversations = await api.conversation.list()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('API Key 尚未配置。')
    expect(await api.conversation.runs(conversations[0].id)).toHaveLength(0)
    expect(await api.history.list()).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('routes prompt assistant endpoints through the selected prompt provider', async () => {
    const api = createPixaiApi()
    const settings = await api.settings.upsertProfile({
      name: 'Local prompt',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['prompt'],
      apiKey: 'sk-123456789'
    })
    const profile = settings.profiles.at(-1)
    await api.settings.update({ selectedPromptProfileId: profile?.id })

    const inspire = await handleCodexBridgeRequest(api, bridgeRequest('/prompt/inspire', 'POST', {}))
    const enrich = await handleCodexBridgeRequest(api, bridgeRequest('/prompt/enrich', 'POST', { prompt: '短提示' }))

    expect(JSON.parse(inspire.body || '{}').prompt).toBe('桥接提示词')
    expect(JSON.parse(enrich.body || '{}').prompt).toBe('桥接提示词')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37123/v1/responses', expect.anything())
  })

  it('returns structured errors for unknown routes', async () => {
    const response = await handleCodexBridgeRequest(createPixaiApi(), bridgeRequest('/missing'))
    const payload = JSON.parse(response.body || '{}')

    expect(response.status).toBe(404)
    expect(payload.ok).toBe(false)
    expect(payload.error).toContain('未知 Codex Bridge 路由')
  })
})
