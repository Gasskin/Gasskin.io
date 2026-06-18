import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from './app-database'
import { ImageService } from './image-service'
import { ProviderSettingsStore } from './provider-settings'

describe('ImageService', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  })

  it('downloads remote image urls before persisting generated history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/v1/images/generations')) {
          return new Response(JSON.stringify({ data: [{ url: 'https://example.test/generated.png' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        }
        if (url === 'https://example.test/generated.png') {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              'content-type': 'image/png',
              'content-length': '3'
            }
          })
        }
        throw new Error(`Unexpected fetch URL: ${url}`)
      })
    )
    const providers = new ProviderSettingsStore()
    const settings = await providers.upsertProfile({
      name: 'Image provider',
      baseUrl: 'http://127.0.0.1:37123',
      enabledUsages: ['image'],
      apiKey: 'sk-123456789'
    })
    await providers.update({ selectedImageProfileId: settings.profiles.at(-1)?.id })
    const database = new AppDatabase()
    const conversation = await database.createConversation()
    const service = new ImageService(database, providers)

    const result = await service.generate({
      conversationId: conversation.id,
      prompt: 'a generated cat',
      ratio: '1:1',
      size: '1024x1024',
      quality: 'high',
      n: 1,
      outputFormat: 'png',
      maxRetries: 0
    })

    expect(fetch).toHaveBeenCalledWith('https://example.test/generated.png', {
      headers: { Accept: 'image/png,image/jpeg,image/webp' }
    })
    expect(result.items[0]).toMatchObject({
      status: 'succeeded',
      dataUrl: 'data:image/png;base64,AQID',
      fileSizeBytes: 3
    })
    expect(result.items[0].storagePath).toContain('browser-memory/images/')
  })
})
