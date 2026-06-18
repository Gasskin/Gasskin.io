import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAiCompatibleAdapter } from '../adapters/openai-compatible'
import { __getSentNotificationsForTests, __setNotificationPermissionForTests, getProfileSecret } from '../lib/platform'
import { pixaiApi } from '../services/app-api'
import type { GenerateImageResult, GenerationRun, ImageHistoryItem } from '../shared/types'
import { useAppStore } from './app-store'

describe('useAppStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads settings, templates, and creates an initial conversation', async () => {
    await useAppStore.getState().load()
    const state = useAppStore.getState()

    expect(state.settings?.profiles).toEqual([])
    expect(state.templates.length).toBeGreaterThan(0)
    expect(state.conversations).toHaveLength(1)
    expect(state.activeConversationId).toBe(state.conversations[0].id)
  })

  it('does not install or query the Codex Skill during normal app load', async () => {
    const statusSpy = vi.spyOn(pixaiApi.codexSkill, 'status')
    const installSpy = vi.spyOn(pixaiApi.codexSkill, 'install')

    await useAppStore.getState().load()

    expect(statusSpy).not.toHaveBeenCalled()
    expect(installSpy).not.toHaveBeenCalled()
  })

  it('loads app version info and starts one silent update check during normal app load', async () => {
    const versionSpy = vi.spyOn(pixaiApi.appUpdate, 'versionInfo').mockResolvedValue({
      version: '0.0.2',
      platform: 'desktop',
      runtime: 'tauri'
    })
    const checkSpy = vi.spyOn(pixaiApi.appUpdate, 'check').mockResolvedValue({
      currentVersion: '0.0.2',
      update: null
    })

    await useAppStore.getState().load()
    await vi.waitFor(() => expect(checkSpy).toHaveBeenCalledTimes(1))

    expect(versionSpy).toHaveBeenCalled()
    expect(useAppStore.getState().appUpdate).toMatchObject({
      status: 'upToDate',
      currentVersion: '0.0.2',
      availableUpdate: null,
      errorMessage: null
    })
  })

  it('stores available update metadata after a manual check', async () => {
    vi.spyOn(pixaiApi.appUpdate, 'check').mockResolvedValue({
      currentVersion: '0.0.2',
      update: {
        version: '0.0.3',
        date: '2026-05-24T00:00:00Z',
        notes: '更新说明',
        rawJson: {}
      }
    })

    await useAppStore.getState().checkForAppUpdate({ silent: false })

    expect(useAppStore.getState().appUpdate).toMatchObject({
      status: 'available',
      currentVersion: '0.0.2',
      availableUpdate: expect.objectContaining({ version: '0.0.3' }),
      errorMessage: null
    })
    expect(useAppStore.getState().toast).toBe('发现新版本 0.0.3')
  })

  it('keeps update check failures visible without clearing the workspace', async () => {
    vi.spyOn(pixaiApi.appUpdate, 'check').mockRejectedValue(new Error('updater endpoint missing'))

    await useAppStore.getState().checkForAppUpdate({ silent: false })

    expect(useAppStore.getState().appUpdate).toMatchObject({
      status: 'error',
      errorMessage: 'updater endpoint missing'
    })
    expect(useAppStore.getState().conversations).toHaveLength(1)
    expect(useAppStore.getState().toast).toBe('检查更新失败：updater endpoint missing')
  })

  it('applies prompt templates to the active conversation', async () => {
    await useAppStore.getState().load()
    const template = useAppStore.getState().templates[0]

    await useAppStore.getState().applyPromptTemplate(template)
    const conversation = useAppStore.getState().conversations[0]

    expect(conversation.draftPrompt).toBe(template.prompt)
    expect(conversation.title).toBe(template.title)
  })

  it('keeps the latest active conversation update when older saves resolve later', async () => {
    await useAppStore.getState().load()
    const conversation = useAppStore.getState().conversations[0]
    let resolveFirst: () => void = () => undefined
    let resolveSecond: () => void = () => undefined
    vi.spyOn(pixaiApi.conversation, 'update')
      .mockImplementationOnce((id, input) => new Promise((resolve) => {
        resolveFirst = () => resolve({
          ...conversation,
          ...input,
          id,
          draftPrompt: String(input.draftPrompt || ''),
          updatedAt: '2026-05-29T12:00:01.000Z'
        })
      }))
      .mockImplementationOnce((id, input) => new Promise((resolve) => {
        resolveSecond = () => resolve({
          ...conversation,
          ...input,
          id,
          draftPrompt: String(input.draftPrompt || ''),
          updatedAt: '2026-05-29T12:00:02.000Z'
        })
      }))

    const firstSave = useAppStore.getState().updateActiveConversation({ draftPrompt: '旧输入' })
    const secondSave = useAppStore.getState().updateActiveConversation({ draftPrompt: '最新输入' })

    expect(useAppStore.getState().conversations[0].draftPrompt).toBe('最新输入')

    resolveSecond()
    await secondSave
    expect(useAppStore.getState().conversations[0].draftPrompt).toBe('最新输入')

    resolveFirst()
    await firstSave
    expect(useAppStore.getState().conversations[0].draftPrompt).toBe('最新输入')
  })

  it('shows generation state immediately while image generation is pending', async () => {
    await useAppStore.getState().load()
    await useAppStore.getState().updateActiveConversation({ draftPrompt: '一只发光的玻璃风铃', n: 2 })
    const conversation = useAppStore.getState().conversations[0]
    const run: GenerationRun = {
      id: 'run-pending-test',
      conversationId: conversation.id,
      prompt: conversation.draftPrompt,
      model: conversation.model,
      ratio: conversation.ratio,
      size: conversation.size,
      quality: conversation.quality,
      n: 2,
      status: 'succeeded',
      durationMs: 1200,
      errorMessage: null,
      errorDetails: null,
      maxRetries: 0,
      retryAttempts: {},
      retryFailures: {},
      generationMode: 'text-to-image',
      referenceImages: [],
      createdAt: new Date().toISOString(),
      items: []
    }
    let resolveGenerate: (value: GenerateImageResult) => void = () => undefined
    vi.spyOn(pixaiApi.image, 'generate').mockImplementation(
      () => new Promise((resolve) => {
        resolveGenerate = resolve
      })
    )
    vi.spyOn(pixaiApi.conversation, 'runs').mockResolvedValue([])

    const generation = useAppStore.getState().generate()

    expect(useAppStore.getState().getConversationGenerationState(conversation.id)).toMatchObject({
      generating: true,
      activeCount: 1
    })

    resolveGenerate({ run, items: [] })
    await generation

    expect(useAppStore.getState().getConversationGenerationState(conversation.id)).toMatchObject({
      generating: false,
      activeCount: 0
    })
  })

  it('shows preflight generation errors as direct toast messages', async () => {
    await useAppStore.getState().load()
    await useAppStore.getState().updateActiveConversation({ draftPrompt: '一座玻璃城市' })
    const conversation = useAppStore.getState().conversations[0]

    await useAppStore.getState().generate()

    expect(useAppStore.getState().toast).toBe('生成失败：请先添加 Provider。')
    expect(useAppStore.getState().runsByConversation[conversation.id] || []).toHaveLength(0)
    expect(await pixaiApi.history.list()).toHaveLength(0)
  })

  it('does not send a system notification while the notification setting is disabled', async () => {
    await prepareSuccessfulGeneration()
    useAppStore.getState().setWindowFocused(false)

    await useAppStore.getState().generate()

    expect(__getSentNotificationsForTests()).toHaveLength(0)
  })

  it('does not send a system notification while the app is focused', async () => {
    await prepareSuccessfulGeneration()
    await useAppStore.getState().updatePreferences({ notifyOnImageSuccess: true, notificationPermission: 'granted' })
    useAppStore.getState().setWindowFocused(true)

    await useAppStore.getState().generate()

    expect(__getSentNotificationsForTests()).toHaveLength(0)
  })

  it('sends one completion system notification while unfocused', async () => {
    await prepareSuccessfulGeneration()
    __setNotificationPermissionForTests('granted')
    await useAppStore.getState().updatePreferences({ notifyOnImageSuccess: true, notificationPermission: 'granted' })
    useAppStore.getState().setWindowFocused(false)

    await useAppStore.getState().generate()

    expect(__getSentNotificationsForTests()).toEqual([
      expect.objectContaining({ title: 'PixAI 图片生成完成' })
    ])
  })

  it('keeps the existing completion toast when notification permission is unavailable', async () => {
    await prepareSuccessfulGeneration()
    __setNotificationPermissionForTests('denied')
    await useAppStore.getState().updatePreferences({ notifyOnImageSuccess: true, notificationPermission: 'denied' })
    useAppStore.getState().setWindowFocused(false)

    await useAppStore.getState().generate()

    expect(__getSentNotificationsForTests()).toHaveLength(0)
    expect(useAppStore.getState().toast).toContain('生成完成')
  })

  it('sends a system notification for failed image generation while unfocused', async () => {
    await prepareSuccessfulGeneration()
    __setNotificationPermissionForTests('granted')
    await useAppStore.getState().updatePreferences({ notifyOnImageSuccess: true, notificationPermission: 'granted' })
    useAppStore.getState().setWindowFocused(false)
    vi.mocked(openAiCompatibleAdapter.generateImage).mockRejectedValue(new Error('upstream failed'))

    await useAppStore.getState().generate()

    expect(__getSentNotificationsForTests()).toEqual([
      expect.objectContaining({ title: 'PixAI 图片生成失败' })
    ])
    expect(useAppStore.getState().toast).toContain('生成失败')
  })

  it('deletes multiple history items through the batch API', async () => {
    await useAppStore.getState().load()
    const deleteManySpy = vi.spyOn(pixaiApi.history, 'deleteMany').mockResolvedValue(2)
    const deleteSpy = vi.spyOn(pixaiApi.history, 'delete')
    vi.spyOn(pixaiApi.conversation, 'runs').mockResolvedValue([])

    await useAppStore.getState().deleteHistoryItems(['history-1', 'history-2'])

    expect(deleteManySpy).toHaveBeenCalledWith(['history-1', 'history-2'])
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('retries a failed history item with its original generation parameters', async () => {
    await useAppStore.getState().load()
    const conversation = {
      ...useAppStore.getState().conversations[0],
      model: 'gpt-image-2',
      ratio: '16:9' as const,
      size: '1792x1008',
      quality: 'high' as const,
      maxRetries: 3
    }
    const failedItem: ImageHistoryItem = {
      id: 'history-retry-store-test',
      conversationId: conversation.id,
      runId: 'run-retry-source',
      prompt: '一座雨夜玻璃城市',
      model: 'gpt-image-2',
      ratio: '16:9',
      size: '1792x1008',
      quality: 'high',
      requestIndex: 0,
      durationMs: 1200,
      dataUrl: null,
      fileSizeBytes: null,
      status: 'failed',
      errorMessage: '图片请求失败，HTTP 状态码 502。',
      errorDetails: null,
      retryAttempt: 3,
      favorite: false,
      generationMode: 'text-to-image',
      referenceImages: [],
      createdAt: '2026-06-02T14:00:00.000Z'
    }
    const retryRun: GenerationRun = {
      id: 'run-retry-new',
      conversationId: conversation.id,
      prompt: failedItem.prompt,
      model: failedItem.model,
      ratio: failedItem.ratio,
      size: failedItem.size,
      quality: failedItem.quality,
      n: 1,
      status: 'succeeded',
      durationMs: 900,
      errorMessage: null,
      errorDetails: null,
      maxRetries: conversation.maxRetries,
      retryAttempts: {},
      retryFailures: {},
      generationMode: 'text-to-image',
      referenceImages: [],
      createdAt: '2026-06-02T14:01:00.000Z',
      items: []
    }
    useAppStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
      history: [failedItem],
      runsByConversation: {
        [conversation.id]: [{
          ...retryRun,
          id: 'run-retry-source',
          status: 'failed',
          items: [failedItem]
        }]
      }
    })
    const generateSpy = vi.spyOn(pixaiApi.image, 'generate').mockResolvedValue({ run: retryRun, items: [] })
    vi.spyOn(pixaiApi.conversation, 'runs').mockResolvedValue([retryRun])
    vi.spyOn(pixaiApi.history, 'list').mockResolvedValue([])

    await useAppStore.getState().retryHistory(failedItem.id)

    expect(generateSpy).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: conversation.id,
      prompt: failedItem.prompt,
      model: failedItem.model,
      ratio: failedItem.ratio,
      size: failedItem.size,
      quality: failedItem.quality,
      n: 1,
      maxRetries: 3
    }))
    expect(useAppStore.getState().toast).toContain('重试完成')
  })
})

async function prepareSuccessfulGeneration(): Promise<void> {
  await useAppStore.getState().load()
  const settings = await pixaiApi.settings.upsertProfile({
    id: 'default-openai-compatible',
    apiKey: 'sk-123456789'
  })
  useAppStore.setState({ settings })
  await expect(getProfileSecret(settings.selectedImageProfileId)).resolves.toMatchObject({ value: 'sk-123456789' })
  await useAppStore.getState().updateActiveConversation({ draftPrompt: '一座玻璃城市', n: 2 })
  vi.spyOn(openAiCompatibleAdapter, 'generateImage').mockResolvedValue([
    { b64_json: 'aGVsbG8=' }
  ])
}
