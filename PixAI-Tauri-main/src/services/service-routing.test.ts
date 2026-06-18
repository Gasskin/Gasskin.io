import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from './app-database'
import { ImageService } from './image-service'
import { PromptService } from './prompt-service'
import { ProviderSettingsStore } from './provider-settings'
import { PlatformHttpProxyError } from '../lib/platform'

describe('service routing', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/v1/responses')) {
          return new Response(JSON.stringify({ output_text: 'routed prompt' }), { status: 200 })
        }
        return new Response(JSON.stringify({ data: [{ b64_json: 'a'.repeat(120) }] }), { status: 200 })
      })
    )
  })

  it('routes image and prompt calls through separately selected provider profiles', async () => {
    const providers = new ProviderSettingsStore()
    const first = await providers.upsertProfile({
      name: 'Image provider',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['image'],
      apiKey: 'sk-123456789'
    })
    const imageProfile = first.profiles.at(-1)
    const second = await providers.upsertProfile({
      name: 'Prompt provider',
      baseUrl: 'http://127.0.0.1:37124',
      enabledUsages: ['prompt'],
      apiKey: 'sk-123456789'
    })
    const promptProfile = second.profiles.at(-1)
    await providers.update({ selectedImageProfileId: imageProfile?.id, selectedPromptProfileId: promptProfile?.id })

    const database = new AppDatabase()
    const conversation = await database.createConversation()
    const imageService = new ImageService(database, providers)
    const promptService = new PromptService(providers)

    const result = await imageService.generate({
      conversationId: conversation.id,
      prompt: 'a luminous city',
      ratio: '1:1',
      size: '1024x1024',
      quality: 'high',
      n: 1
    })
    await promptService.inspire()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37123/v1/images/generations', expect.anything())
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:37124/v1/responses', expect.anything())
    expect(result.items[0].callLog).toMatchObject({
      provider: {
        name: 'Image provider'
      },
      endpoint: 'http://127.0.0.1:37123/v1/images/generations',
      request: {
        headers: {
          Authorization: 'Bearer ***'
        },
        body: {
          prompt: 'a luminous city'
        }
      }
    })
  })

  it('honors auto-save history and failure-detail conversation toggles', async () => {
    const providers = new ProviderSettingsStore()
    const settings = await providers.upsertProfile({
      name: 'Image provider',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['image'],
      apiKey: 'sk-123456789'
    })
    const imageProfile = settings.profiles.at(-1)
    await providers.update({ selectedImageProfileId: imageProfile?.id })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }))

    const database = new AppDatabase()
    const conversation = await database.createConversation({ autoSaveHistory: false, keepFailureDetails: false })
    const imageService = new ImageService(database, providers)

    const result = await imageService.generate({
      conversationId: conversation.id,
      prompt: 'a luminous city',
      ratio: '1:1',
      size: '1024x1024',
      quality: 'high',
      n: 1,
      maxRetries: 0
    })
    const history = await database.listHistory()

    expect(result.items[0].errorDetails).toBeNull()
    expect(history).toHaveLength(0)
  })

  it('shows missing API keys as preflight errors without creating workspace records', async () => {
    const providers = new ProviderSettingsStore()
    const settings = await providers.upsertProfile({
      name: 'Image provider',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['image']
    })
    const imageProfile = settings.profiles.at(-1)
    await providers.update({ selectedImageProfileId: imageProfile?.id })

    const database = new AppDatabase()
    const conversation = await database.createConversation()
    const imageService = new ImageService(database, providers)

    await expect(imageService.generate({
      conversationId: conversation.id,
      prompt: 'a luminous city',
      ratio: '1:1',
      size: '1024x1024',
      quality: 'high',
      n: 1
    })).rejects.toThrow('API Key 尚未配置。')

    await expect(database.listRuns(conversation.id)).resolves.toHaveLength(0)
    await expect(database.listHistory()).resolves.toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('normalizes incompatible generation sizes to the selected ratio presets', async () => {
    const providers = new ProviderSettingsStore()
    const settings = await providers.upsertProfile({
      name: 'Image provider',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['image'],
      apiKey: 'sk-123456789'
    })
    const imageProfile = settings.profiles.at(-1)
    await providers.update({ selectedImageProfileId: imageProfile?.id })

    const database = new AppDatabase()
    const conversation = await database.createConversation()
    const imageService = new ImageService(database, providers)

    await imageService.generate({
      conversationId: conversation.id,
      prompt: 'a wide luminous city',
      ratio: '16:9',
      size: '1024x1024',
      quality: 'high',
      n: 1
    })
    const runs = await database.listRuns(conversation.id)

    expect(runs[0].size).toBe('1792x1008')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:37123/v1/images/generations',
      expect.objectContaining({
        body: expect.stringContaining('"size":"1792x1008"')
      })
    )
  })

  it('records platform transport failures as unconfirmed responses', async () => {
    const providers = new ProviderSettingsStore()
    const settings = await providers.upsertProfile({
      name: 'Image provider',
      baseUrl: 'https://ai-pixel.online',
      enabledUsages: ['image'],
      apiKey: 'sk-123456789'
    })
    const imageProfile = settings.profiles.at(-1)
    await providers.update({ selectedImageProfileId: imageProfile?.id })
    const transportError = PlatformHttpProxyError.fromInvokeError(
      'https://ai-pixel.online/v1/images/generations',
      'POST',
      JSON.stringify({
        stage: 'send',
        message: '请求接口失败：error sending request for url (https://ai-pixel.online/v1/images/generations)',
        url: 'https://ai-pixel.online/v1/images/generations',
        isTimeout: false,
        isConnect: true,
        isRequest: true,
        isBody: false,
        sourceChain: ['connection closed before message completed']
      })
    )
    vi.mocked(fetch)
      .mockRejectedValueOnce(transportError)
      .mockRejectedValueOnce(transportError)

    const database = new AppDatabase()
    const conversation = await database.createConversation()
    const imageService = new ImageService(database, providers)

    const result = await imageService.generate({
      conversationId: conversation.id,
      prompt: 'a luminous city',
      ratio: '1:1',
      size: '1024x1024',
      quality: 'high',
      n: 1,
      maxRetries: 0
    })

    expect(result.items[0].errorMessage).toContain('响应未确认')
    expect(result.items[0].errorDetails).toContain('"stage": "transport"')
    expect(result.items[0].errorDetails).toContain('"isConnect": true')
    expect(result.items[0].errorDetails).toContain('上游可能已收到请求并完成生成')
  })

  it('retries HTTP 502 image failures with the default retry count', async () => {
    const providers = new ProviderSettingsStore()
    const settings = await providers.upsertProfile({
      name: 'Image provider',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['image'],
      apiKey: 'sk-123456789'
    })
    const imageProfile = settings.profiles.at(-1)
    await providers.update({ selectedImageProfileId: imageProfile?.id })
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'bad gateway' } }), { status: 502, statusText: 'Bad Gateway' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'b'.repeat(120) }] }), { status: 200 }))

    const database = new AppDatabase()
    const conversation = await database.createConversation()
    const imageService = new ImageService(database, providers)

    const result = await imageService.generate({
      conversationId: conversation.id,
      prompt: 'a luminous city',
      ratio: '1:1',
      size: '1024x1024',
      quality: 'high',
      n: 1
    })
    const runs = await database.listRuns(conversation.id)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.items[0]).toMatchObject({
      status: 'succeeded',
      retryAttempt: 1
    })
    expect(runs[0].retryFailures[0]?.errorMessage).toContain('bad gateway')
  })
})
