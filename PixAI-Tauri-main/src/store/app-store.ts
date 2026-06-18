import { create } from 'zustand'
import { pixaiApi } from '../services/app-api'
import { ImageGenerationPreflightError } from '../services/image-service'
import { getBundledAppVersion } from '../shared/app-version'
import { DEFAULT_IMAGE_OUTPUT_FORMAT, DEFAULT_MODEL, getDefaultImageSize, isImageSizeCompatible, normalizeImageGenerationTimeoutSeconds } from '../shared/image-options'
import { sendSystemNotification } from '../lib/platform'
import { formatDuration } from '../lib/time'
import type {
  AppPreferences,
  AppPreferencesUpdate,
  AppUpdateState,
  CodexSkillStatus,
  Conversation,
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  GenerationRun,
  HistoryListOptions,
  ImageHistoryItem,
  PromptTemplate,
  PromptTemplateInput,
  ProviderProfileInput,
  ProviderSettings,
  ProviderSettingsUpdate,
  ReferenceImageFilePayload
} from '../shared/types'
import {
  beginConversationGeneration,
  endConversationGeneration,
  getConversationGenerationState as getConversationGenerationStateForId,
  markGenerationRequestRemoved,
  pruneRemovedGenerationIndexesByRunId
} from './generation-state'

type View = 'workspace' | 'gallery' | 'prompts'

type AppState = {
  view: View
  settingsVisible: boolean
  darkMode: boolean
  settings: ProviderSettings | null
  preferences: AppPreferences | null
  windowFocused: boolean
  conversations: Conversation[]
  activeConversationId: string | null
  runsByConversation: Record<string, GenerationRun[]>
  history: ImageHistoryItem[]
  templates: PromptTemplate[]
  codexSkillStatus: CodexSkillStatus | null
  codexSkillInstalling: boolean
  appUpdate: AppUpdateState
  query: string
  favoritesOnly: boolean
  loading: boolean
  generationClockMs: number
  generatingByConversation: Record<string, number>
  generationStartedAtByConversation: Record<string, number>
  removedGenerationIndexesByRunId: Record<string, number[]>
  promptAssistantRunning: { inspire: boolean; enrich: boolean }
  toast: string | null
  getConversationGenerationState: (conversationId: string) => { generating: boolean; startedAt: number | null; activeCount: number }
  load: () => Promise<void>
  setView: (view: View) => void
  toggleSettings: () => void
  toggleTheme: () => void
  setQuery: (query: string) => void
  setFavoritesOnly: (favoritesOnly: boolean) => Promise<void>
  setActiveConversation: (id: string) => Promise<void>
  createConversation: (template?: ConversationCreateInput) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  updateActiveConversation: (input: ConversationUpdate) => Promise<void>
  updateSettings: (input: ProviderSettingsUpdate) => Promise<void>
  updatePreferences: (input: AppPreferencesUpdate) => Promise<void>
  refreshNotificationPermission: () => Promise<void>
  requestNotificationPermission: () => Promise<void>
  setWindowFocused: (focused: boolean) => void
  upsertProfile: (input: ProviderProfileInput) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  testProfile: (id: string) => Promise<void>
  loadCodexSkillStatus: () => Promise<void>
  installCodexSkill: () => Promise<void>
  loadAppVersionInfo: () => Promise<void>
  checkForAppUpdate: (options?: { silent?: boolean }) => Promise<void>
  downloadAndInstallAppUpdate: () => Promise<void>
  importReferenceFiles: (files: File[]) => Promise<void>
  importReferencePayloads: (payloads: ReferenceImageFilePayload[]) => Promise<void>
  addHistoryAsReference: (historyId: string) => Promise<void>
  removeReferenceImage: (referenceImageId: string) => Promise<void>
  reorderReferenceImages: (referenceImageIds: string[]) => Promise<void>
  inspirePrompt: () => Promise<void>
  enrichPrompt: () => Promise<void>
  generate: () => Promise<void>
  retryHistory: (id: string) => Promise<void>
  cancelGeneration: (runId?: string, requestIndex?: number) => Promise<void>
  refreshConversationResults: (conversationId: string) => Promise<void>
  reloadHistory: (options?: Partial<HistoryListOptions>) => Promise<void>
  deleteHistory: (id: string) => Promise<void>
  deleteHistoryItems: (ids: string[]) => Promise<void>
  toggleFavorite: (item: ImageHistoryItem) => Promise<void>
  loadTemplates: () => Promise<void>
  saveTemplate: (input: PromptTemplateInput & { id?: string }) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  applyPromptTemplate: (template: PromptTemplate) => Promise<void>
  notify: (message: string | null) => void
}

let generationClockTimer: number | null = null
let startupUpdateCheckStarted = false
const conversationUpdateVersions = new Map<string, number>()

const initialAppUpdateState: AppUpdateState = {
  status: 'idle',
  currentVersion: getBundledAppVersion(),
  platform: 'browser',
  runtime: 'browser',
  availableUpdate: null,
  lastCheckedAt: null,
  errorMessage: null,
  downloadedBytes: null,
  contentLength: null
}

function startGenerationClock(): void {
  if (generationClockTimer != null || typeof window === 'undefined') return
  generationClockTimer = window.setInterval(() => {
    useAppStore.setState({ generationClockMs: Date.now() })
  }, 1000)
}

function stopGenerationClock(): void {
  if (generationClockTimer == null) return
  window.clearInterval(generationClockTimer)
  generationClockTimer = null
}

function collectRunningRunIds(runsByConversation: Record<string, GenerationRun[]>): string[] {
  return Object.values(runsByConversation)
    .flatMap((runs) => runs.filter((run) => run.status === 'running').map((run) => run.id))
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'workspace',
  settingsVisible: true,
  darkMode: false,
  settings: null,
  preferences: null,
  windowFocused: true,
  conversations: [],
  activeConversationId: null,
  runsByConversation: {},
  history: [],
  templates: [],
  codexSkillStatus: null,
  codexSkillInstalling: false,
  appUpdate: initialAppUpdateState,
  query: '',
  favoritesOnly: false,
  loading: false,
  generationClockMs: Date.now(),
  generatingByConversation: {},
  generationStartedAtByConversation: {},
  removedGenerationIndexesByRunId: {},
  promptAssistantRunning: { inspire: false, enrich: false },
  toast: null,
  getConversationGenerationState: (conversationId) =>
    getConversationGenerationStateForId(conversationId, get().generatingByConversation, get().generationStartedAtByConversation),
  load: async () => {
    set({ loading: true })
    const [settings, preferences] = await Promise.all([
      pixaiApi.settings.get(),
      pixaiApi.preferences.refreshNotificationPermission()
    ])
    let conversations = await pixaiApi.conversation.list()
    if (conversations.length === 0) conversations = [await pixaiApi.conversation.create()]
    const activeConversationId = get().activeConversationId || conversations[0]?.id || null
    const runs = activeConversationId ? await pixaiApi.conversation.runs(activeConversationId) : []
    const history = await pixaiApi.history.list({ sort: 'newest' })
    const templates = await pixaiApi.templates.list()
    set({
      settings,
      preferences,
      conversations,
      activeConversationId,
      runsByConversation: activeConversationId ? { [activeConversationId]: runs } : {},
      history,
      templates,
      loading: false
    })
    await get().loadAppVersionInfo()
    if (!startupUpdateCheckStarted && get().appUpdate.runtime === 'tauri') {
      startupUpdateCheckStarted = true
      void get().checkForAppUpdate({ silent: true })
    }
  },
  setView: (view) => set({ view }),
  toggleSettings: () => set((state) => ({ settingsVisible: !state.settingsVisible, view: 'workspace' })),
  toggleTheme: () => set((state) => ({ darkMode: !state.darkMode })),
  setQuery: (query) => set({ query }),
  setFavoritesOnly: async (favoritesOnly) => {
    set({ favoritesOnly })
    await get().reloadHistory({ favoritesOnly })
  },
  setActiveConversation: async (id) => {
    set({ activeConversationId: id, view: 'workspace' })
    if (!get().runsByConversation[id]) {
      const runs = await pixaiApi.conversation.runs(id)
      set({ runsByConversation: { ...get().runsByConversation, [id]: runs } })
    }
  },
  createConversation: async (template = {}) => {
    const current = getActiveConversation(get())
    const conversation = await pixaiApi.conversation.create({
      ratio: template.ratio ?? current?.ratio,
      size: template.size ?? current?.size,
      quality: template.quality ?? current?.quality,
      model: template.model ?? current?.model,
      n: template.n ?? current?.n,
      outputFormat: template.outputFormat ?? current?.outputFormat,
      outputCompression: template.outputCompression ?? current?.outputCompression,
      background: template.background ?? current?.background,
      moderation: template.moderation ?? current?.moderation,
      stream: template.stream ?? current?.stream,
      partialImages: template.partialImages ?? current?.partialImages,
      inputFidelity: template.inputFidelity ?? current?.inputFidelity,
      maxRetries: template.maxRetries ?? current?.maxRetries,
      generationTimeoutSeconds: template.generationTimeoutSeconds ?? current?.generationTimeoutSeconds,
      autoSaveHistory: template.autoSaveHistory ?? current?.autoSaveHistory,
      keepFailureDetails: template.keepFailureDetails ?? current?.keepFailureDetails
    })
    set({
      conversations: [conversation, ...get().conversations],
      activeConversationId: conversation.id,
      view: 'workspace',
      runsByConversation: { ...get().runsByConversation, [conversation.id]: [] }
    })
    get().notify('已新建会话')
  },
  deleteConversation: async (id) => {
    await pixaiApi.conversation.delete(id)
    let conversations = get().conversations.filter((conversation) => conversation.id !== id)
    if (conversations.length === 0) conversations = [await pixaiApi.conversation.create()]
    const activeConversationId = get().activeConversationId === id ? conversations[0]?.id || null : get().activeConversationId
    const runsByConversation = { ...get().runsByConversation }
    delete runsByConversation[id]
    set({ conversations, activeConversationId, runsByConversation })
    await get().reloadHistory()
    get().notify('已删除会话，历史记录已保留')
  },
  updateActiveConversation: async (input) => {
    const id = get().activeConversationId
    if (!id) return
    const updateVersion = nextConversationUpdateVersion(id)
    const normalized = input.ratio && input.size === undefined ? { ...input, size: getDefaultImageSize(input.ratio) } : input
    set({
      conversations: get().conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, ...normalized, updatedAt: new Date().toISOString() } : conversation
      )
    })
    const updated = await pixaiApi.conversation.update(id, normalized)
    if (conversationUpdateVersions.get(id) !== updateVersion) return
    set({ conversations: get().conversations.map((conversation) => (conversation.id === id ? updated : conversation)) })
  },
  updateSettings: async (input) => {
    const settings = await pixaiApi.settings.update(input)
    set({ settings })
    get().notify('设置已保存')
  },
  updatePreferences: async (input) => {
    const preferences = await pixaiApi.preferences.update(input)
    set({ preferences })
    if (preferences.notifyOnImageSuccess) void get().refreshNotificationPermission()
    get().notify('设置已保存')
  },
  refreshNotificationPermission: async () => {
    const preferences = await pixaiApi.preferences.refreshNotificationPermission()
    set({ preferences })
  },
  requestNotificationPermission: async () => {
    const preferences = await pixaiApi.preferences.requestNotificationPermission()
    set({ preferences })
    get().notify(preferences.notificationPermission === 'granted' ? '系统通知已启用' : '系统通知权限不可用，已保留应用内提示')
  },
  setWindowFocused: (focused) => set({ windowFocused: focused }),
  upsertProfile: async (input) => {
    const settings = await pixaiApi.settings.upsertProfile(input)
    set({ settings })
    get().notify('服务配置已保存')
  },
  deleteProfile: async (id) => {
    const settings = await pixaiApi.settings.deleteProfile(id)
    set({ settings })
    get().notify('服务配置已删除')
  },
  testProfile: async (id) => {
    const settings = await pixaiApi.settings.testProfile(id)
    set({ settings })
    const profile = settings.profiles.find((item) => item.id === id)
    get().notify(profile?.lastTest?.message || '连接测试完成')
  },
  loadCodexSkillStatus: async () => {
    try {
      set({ codexSkillStatus: await pixaiApi.codexSkill.status() })
    } catch (error) {
      get().notify(error instanceof Error ? `技能状态读取失败：${error.message}` : '技能状态读取失败')
    }
  },
  installCodexSkill: async () => {
    if (get().codexSkillInstalling) return
    set({ codexSkillInstalling: true })
    try {
      const codexSkillStatus = await pixaiApi.codexSkill.install()
      set({ codexSkillStatus })
      get().notify('Codex 技能已安装到全局')
    } catch (error) {
      get().notify(error instanceof Error ? `技能安装失败：${error.message}` : '技能安装失败')
    } finally {
      set({ codexSkillInstalling: false })
    }
  },
  loadAppVersionInfo: async () => {
    try {
      const versionInfo = await pixaiApi.appUpdate.versionInfo()
      set({
        appUpdate: {
          ...get().appUpdate,
          currentVersion: versionInfo.version,
          platform: versionInfo.platform,
          runtime: versionInfo.runtime
        }
      })
    } catch (error) {
      set({
        appUpdate: {
          ...get().appUpdate,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : '版本信息读取失败'
        }
      })
    }
  },
  checkForAppUpdate: async (options = {}) => {
    const current = get().appUpdate
    if (current.status === 'checking' || current.status === 'downloading' || current.status === 'installing') return
    set({
      appUpdate: {
        ...current,
        status: 'checking',
        errorMessage: null,
        downloadedBytes: null,
        contentLength: null
      }
    })
    try {
      const result = await pixaiApi.appUpdate.check()
      const checkedAt = new Date().toISOString()
      const next: AppUpdateState = {
        ...get().appUpdate,
        status: result.update ? 'available' : 'upToDate',
        currentVersion: result.currentVersion,
        availableUpdate: result.update,
        lastCheckedAt: checkedAt,
        errorMessage: null,
        downloadedBytes: null,
        contentLength: null
      }
      set({ appUpdate: next })
      if (!options.silent) {
        get().notify(result.update ? `发现新版本 ${result.update.version}` : '当前已是最新版本')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '检查更新失败'
      set({
        appUpdate: {
          ...get().appUpdate,
          status: 'error',
          lastCheckedAt: new Date().toISOString(),
          errorMessage: message,
          downloadedBytes: null,
          contentLength: null
        }
      })
      if (!options.silent) get().notify(`检查更新失败：${message}`)
    }
  },
  downloadAndInstallAppUpdate: async () => {
    const current = get().appUpdate
    if (!current.availableUpdate || current.status === 'downloading' || current.status === 'installing') return
    set({
      appUpdate: {
        ...current,
        status: 'downloading',
        errorMessage: null,
        downloadedBytes: 0,
        contentLength: null
      }
    })
    try {
      const result = await pixaiApi.appUpdate.downloadAndInstall((progress) => {
        const state = useAppStore.getState().appUpdate
        set({
          appUpdate: {
            ...state,
            downloadedBytes: progress.downloadedBytes ?? state.downloadedBytes,
            contentLength: progress.contentLength ?? state.contentLength
          }
        })
      })
      if (result.action === 'openedDownload') {
        set({
          appUpdate: {
            ...get().appUpdate,
            status: 'available',
            errorMessage: null
          }
        })
        get().notify('已打开 GitHub Release 下载页')
        return
      }
      set({
        appUpdate: {
          ...get().appUpdate,
          status: 'installing',
          errorMessage: null
        }
      })
      get().notify('更新已安装，正在重启 PixAI')
      await pixaiApi.appUpdate.relaunch()
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载安装更新失败'
      set({
        appUpdate: {
          ...get().appUpdate,
          status: 'error',
          errorMessage: message
        }
      })
      get().notify(`更新失败：${message}`)
    }
  },
  importReferenceFiles: async (files) => {
    const id = get().activeConversationId
    if (!id || files.length === 0) return
    try {
      const referenceImages = await pixaiApi.reference.importFiles(id, files)
      set({ conversations: get().conversations.map((conversation) => (conversation.id === id ? { ...conversation, referenceImages } : conversation)) })
      get().notify(`已添加 ${files.length} 张参考图`)
    } catch (error) {
      get().notify(error instanceof Error ? error.message : '参考图添加失败')
    }
  },
  importReferencePayloads: async (payloads) => {
    const id = get().activeConversationId
    if (!id || payloads.length === 0) return
    try {
      const referenceImages = await pixaiApi.reference.importPayloads(id, payloads)
      set({ conversations: get().conversations.map((conversation) => (conversation.id === id ? { ...conversation, referenceImages } : conversation)) })
      get().notify(`已添加 ${payloads.length} 张参考图`)
    } catch (error) {
      get().notify(error instanceof Error ? error.message : '参考图添加失败')
    }
  },
  addHistoryAsReference: async (historyId) => {
    const id = get().activeConversationId
    if (!id) return
    const source = get().history.find((item) => item.id === historyId)
    const referenceImages = await pixaiApi.reference.addFromHistory(id, historyId)
    const updated = await pixaiApi.conversation.update(id, {
      referenceImages,
      draftPrompt: source?.prompt || '',
      model: source?.model,
      ratio: source?.ratio,
      size: source?.size || undefined,
      quality: source?.quality
    } as ConversationUpdate)
    set({
      conversations: get().conversations.map((conversation) => (conversation.id === id ? updated : conversation)),
      view: 'workspace'
    })
    get().notify('已进入编辑')
  },
  removeReferenceImage: async (referenceImageId) => {
    const id = get().activeConversationId
    if (!id) return
    const referenceImages = await pixaiApi.reference.remove(id, referenceImageId)
    set({ conversations: get().conversations.map((conversation) => (conversation.id === id ? { ...conversation, referenceImages } : conversation)) })
  },
  reorderReferenceImages: async (referenceImageIds) => {
    const id = get().activeConversationId
    if (!id) return
    const referenceImages = await pixaiApi.reference.reorder(id, referenceImageIds)
    set({ conversations: get().conversations.map((conversation) => (conversation.id === id ? { ...conversation, referenceImages } : conversation)) })
  },
  inspirePrompt: async () => {
    const conversation = getActiveConversation(get())
    if (!conversation || get().promptAssistantRunning.inspire) return
    set({ promptAssistantRunning: { ...get().promptAssistantRunning, inspire: true } })
    try {
      const prompt = await pixaiApi.prompt.inspire({ hasReferenceImages: conversation.referenceImages.length > 0 })
      await get().updateActiveConversation({ draftPrompt: prompt })
      get().notify('已生成灵感提示词')
    } catch (error) {
      get().notify(error instanceof Error ? `提示词生成失败：${error.message}` : '提示词生成失败')
    } finally {
      set({ promptAssistantRunning: { ...get().promptAssistantRunning, inspire: false } })
    }
  },
  enrichPrompt: async () => {
    const conversation = getActiveConversation(get())
    const prompt = conversation?.draftPrompt.trim() || ''
    if (!conversation || !prompt || get().promptAssistantRunning.enrich) return
    set({ promptAssistantRunning: { ...get().promptAssistantRunning, enrich: true } })
    try {
      const nextPrompt = await pixaiApi.prompt.enrich({
        prompt,
        hasReferenceImages: conversation.referenceImages.length > 0
      })
      await get().updateActiveConversation({ draftPrompt: nextPrompt })
      get().notify('已丰富提示词')
    } catch (error) {
      get().notify(error instanceof Error ? `提示词生成失败：${error.message}` : '提示词生成失败')
    } finally {
      set({ promptAssistantRunning: { ...get().promptAssistantRunning, enrich: false } })
    }
  },
  generate: async () => {
    const state = get()
    const conversation = getActiveConversation(state)
    if (!conversation) return
    const generationStartedAt = Date.now()
    set({ generationClockMs: generationStartedAt })
    startGenerationClock()
    const prompt = conversation.draftPrompt.trim()
    const input: GenerateImageInput = {
      conversationId: conversation.id,
      prompt,
      model: conversation.model || getSelectedImageProfile(state.settings)?.defaultImageModel || DEFAULT_MODEL,
      ratio: conversation.ratio,
      size: isImageSizeCompatible(conversation.ratio, conversation.size) ? conversation.size : getDefaultImageSize(conversation.ratio),
      quality: conversation.quality,
      n: conversation.n,
      outputFormat: conversation.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
      outputCompression: conversation.outputCompression ?? undefined,
      background: conversation.background,
      moderation: conversation.moderation,
      stream: conversation.stream,
      partialImages: conversation.partialImages ?? undefined,
      inputFidelity: conversation.inputFidelity ?? undefined,
      maxRetries: conversation.maxRetries,
      generationTimeoutSeconds: normalizeImageGenerationTimeoutSeconds(conversation.generationTimeoutSeconds),
      referenceImageIds: conversation.referenceImages.map((reference) => reference.id)
    }
    const nextGenerationState = beginConversationGeneration(conversation.id, {
      generatingByConversation: state.generatingByConversation,
      startedAtByConversation: state.generationStartedAtByConversation,
      removedIndexesByRunId: state.removedGenerationIndexesByRunId
    }, generationStartedAt)
    set({
      generatingByConversation: nextGenerationState.generatingByConversation,
      generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
      removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
    })
    const titlePatch = conversation.title === '新会话' && prompt ? { title: prompt.length > 18 ? `${prompt.slice(0, 18)}...` : prompt } : null
    try {
      if (titlePatch) await get().updateActiveConversation(titlePatch)
      const resultPromise = pixaiApi.image.generate(input)
      void get().refreshConversationResults(conversation.id)
      const result = await resultPromise
      const runs = await pixaiApi.conversation.runs(conversation.id)
      const history = await pixaiApi.history.list({
        query: state.query,
        favoritesOnly: state.favoritesOnly,
        sort: 'newest'
      })
      const runsByConversation = { ...get().runsByConversation, [conversation.id]: runs }
      const runningRunIds = collectRunningRunIds(runsByConversation)
      const prunedGenerationState = pruneRemovedGenerationIndexesByRunId(runningRunIds, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        runsByConversation,
        history,
        removedGenerationIndexesByRunId: prunedGenerationState.removedIndexesByRunId
      })
      const durationText = result.run.durationMs != null ? `，用时 ${formatDuration(result.run.durationMs)}` : ''
      const completionMessage = result.canceled ? `已取消${durationText}` : result.errorMessage ? `生成失败：${result.errorMessage}${durationText}` : `生成完成${durationText}`
      get().notify(completionMessage)
      if (!result.canceled) await notifyGenerationFinished(result.items, result.errorMessage || null, get, durationText)
    } catch (error) {
      const message = error instanceof ImageGenerationPreflightError ? error.message : error instanceof Error ? `生成失败：${error.message}` : '生成失败'
      get().notify(message)
      await notifyGenerationFinished([], message, get, '')
    } finally {
      const endedGenerationState = endConversationGeneration(conversation.id, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        generatingByConversation: endedGenerationState.generatingByConversation,
        generationStartedAtByConversation: endedGenerationState.startedAtByConversation,
        removedGenerationIndexesByRunId: endedGenerationState.removedIndexesByRunId
      })
      if (Object.keys(endedGenerationState.generatingByConversation).length === 0) stopGenerationClock()
    }
  },
  retryHistory: async (id) => {
    const item = findHistoryItem(get(), id) || await pixaiApi.history.get(id)
    if (!item || item.status !== 'failed') {
      get().notify('未找到可重试的失败记录')
      return
    }
    if (!item.conversationId) {
      get().notify('这条失败记录没有关联会话，无法重试')
      return
    }
    const storedConversation = get().conversations.find((conversation) => conversation.id === item.conversationId)
    const fetchedConversation = storedConversation ? null : await pixaiApi.conversation.get(item.conversationId)
    const conversation = storedConversation || fetchedConversation
    if (!conversation) {
      get().notify('未找到原会话，无法重试')
      return
    }
    const generationStartedAt = Date.now()
    set({
      activeConversationId: conversation.id,
      view: 'workspace',
      generationClockMs: generationStartedAt,
      conversations: storedConversation ? get().conversations : [conversation, ...get().conversations]
    })
    startGenerationClock()
    const referenceImageIds = item.referenceImages
      .map((reference) => reference.id)
      .filter((referenceId) => conversation.referenceImages.some((reference) => reference.id === referenceId))
    const input: GenerateImageInput = {
      conversationId: conversation.id,
      prompt: item.prompt.trim(),
      model: item.model || conversation.model || getSelectedImageProfile(get().settings)?.defaultImageModel || DEFAULT_MODEL,
      ratio: item.ratio,
      size: item.size && isImageSizeCompatible(item.ratio, item.size) ? item.size : getDefaultImageSize(item.ratio),
      quality: item.quality,
      n: 1,
      outputFormat: conversation.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
      outputCompression: conversation.outputCompression ?? undefined,
      background: conversation.background,
      moderation: conversation.moderation,
      stream: conversation.stream,
      partialImages: conversation.partialImages ?? undefined,
      inputFidelity: conversation.inputFidelity ?? undefined,
      maxRetries: conversation.maxRetries,
      generationTimeoutSeconds: normalizeImageGenerationTimeoutSeconds(conversation.generationTimeoutSeconds),
      referenceImageIds
    }
    const nextGenerationState = beginConversationGeneration(conversation.id, {
      generatingByConversation: get().generatingByConversation,
      startedAtByConversation: get().generationStartedAtByConversation,
      removedIndexesByRunId: get().removedGenerationIndexesByRunId
    }, generationStartedAt)
    set({
      generatingByConversation: nextGenerationState.generatingByConversation,
      generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
      removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
    })
    try {
      const resultPromise = pixaiApi.image.generate(input)
      void get().refreshConversationResults(conversation.id)
      const result = await resultPromise
      const runs = await pixaiApi.conversation.runs(conversation.id)
      const history = await pixaiApi.history.list({
        query: get().query,
        favoritesOnly: get().favoritesOnly,
        sort: 'newest'
      })
      const runsByConversation = { ...get().runsByConversation, [conversation.id]: runs }
      const runningRunIds = collectRunningRunIds(runsByConversation)
      const prunedGenerationState = pruneRemovedGenerationIndexesByRunId(runningRunIds, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        runsByConversation,
        history,
        removedGenerationIndexesByRunId: prunedGenerationState.removedIndexesByRunId
      })
      const durationText = result.run.durationMs != null ? `，用时 ${formatDuration(result.run.durationMs)}` : ''
      const completionMessage = result.errorMessage ? `重试失败：${result.errorMessage}${durationText}` : `重试完成${durationText}`
      get().notify(completionMessage)
      await notifyGenerationFinished(result.items, result.errorMessage || null, get, durationText)
    } catch (error) {
      const message = error instanceof ImageGenerationPreflightError ? error.message : error instanceof Error ? `重试失败：${error.message}` : '重试失败'
      get().notify(message)
      await notifyGenerationFinished([], message, get, '')
    } finally {
      const endedGenerationState = endConversationGeneration(conversation.id, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        generatingByConversation: endedGenerationState.generatingByConversation,
        generationStartedAtByConversation: endedGenerationState.startedAtByConversation,
        removedGenerationIndexesByRunId: endedGenerationState.removedIndexesByRunId
      })
      if (Object.keys(endedGenerationState.generatingByConversation).length === 0) stopGenerationClock()
    }
  },
  cancelGeneration: async (runId, requestIndex) => {
    if (!runId) return
    if (typeof requestIndex === 'number') {
      const nextGenerationState = markGenerationRequestRemoved(runId, requestIndex, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        generatingByConversation: nextGenerationState.generatingByConversation,
        generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
        removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
      })
    }
    await pixaiApi.image.cancel(runId, requestIndex)
  },
  refreshConversationResults: async (conversationId) => {
    const state = get()
    const runs = await pixaiApi.conversation.runs(conversationId)
    const history = await pixaiApi.history.list({
      query: state.query,
      favoritesOnly: state.favoritesOnly,
      sort: 'newest'
    })
    const runsByConversation = { ...get().runsByConversation, [conversationId]: runs }
    const runningRunIds = collectRunningRunIds(runsByConversation)
    const nextGenerationState = pruneRemovedGenerationIndexesByRunId(runningRunIds, {
      generatingByConversation: get().generatingByConversation,
      startedAtByConversation: get().generationStartedAtByConversation,
      removedIndexesByRunId: get().removedGenerationIndexesByRunId
    })
    set({
      runsByConversation,
      history,
      removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
    })
  },
  reloadHistory: async (options = {}) => {
    const state = get()
    const history = await pixaiApi.history.list({
      query: options.query ?? state.query,
      favoritesOnly: options.favoritesOnly ?? state.favoritesOnly,
      sort: options.sort ?? 'newest'
    })
    set({ history })
  },
  deleteHistory: async (id) => {
    const item = findHistoryItem(get(), id)
    if (item?.conversationId && item.runId && typeof item.requestIndex === 'number') {
      const activeRun = get().runsByConversation[item.conversationId]?.find((run) => run.id === item.runId && run.status === 'running')
      if (activeRun) {
        const nextGenerationState = markGenerationRequestRemoved(item.runId, item.requestIndex, {
          generatingByConversation: get().generatingByConversation,
          startedAtByConversation: get().generationStartedAtByConversation,
          removedIndexesByRunId: get().removedGenerationIndexesByRunId
        })
        set({
          generatingByConversation: nextGenerationState.generatingByConversation,
          generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
          removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
        })
      }
    }
    await pixaiApi.history.delete(id)
    await get().reloadHistory()
    if (item?.conversationId) {
      const runs = await pixaiApi.conversation.runs(item.conversationId)
      set({ runsByConversation: { ...get().runsByConversation, [item.conversationId]: runs } })
    }
    get().notify('已删除历史项')
  },
  deleteHistoryItems: async (ids) => {
    const selectedIds = new Set(ids)
    if (selectedIds.size === 0) return
    const state = get()
    const affectedConversationIds = new Set(
      Array.from(selectedIds)
        .map((id) => findHistoryItem(state, id))
        .filter((entry): entry is ImageHistoryItem => Boolean(entry?.conversationId))
        .map((entry) => entry.conversationId as string)
    )
    const itemsById = new Map(
      Array.from(selectedIds)
        .map((id) => findHistoryItem(state, id))
        .filter((entry): entry is ImageHistoryItem => Boolean(entry))
        .map((entry) => [entry.id, entry])
    )
    const selectedHistoryItems = Array.from(itemsById.values())
    const activeItems = selectedHistoryItems.filter((entry) => entry.conversationId && entry.runId && typeof entry.requestIndex === 'number')
    let nextRemovedIndexesByRunId = { ...state.removedGenerationIndexesByRunId }
    let nextGeneratingByConversation = { ...state.generatingByConversation }
    let nextStartedAtByConversation = { ...state.generationStartedAtByConversation }
    let removedStateChanged = false

    for (const item of activeItems) {
      const activeRun = state.runsByConversation[item.conversationId as string]?.find((run) => run.id === item.runId && run.status === 'running')
      if (activeRun) {
        const nextGenerationState = markGenerationRequestRemoved(item.runId as string, item.requestIndex as number, {
          generatingByConversation: nextGeneratingByConversation,
          startedAtByConversation: nextStartedAtByConversation,
          removedIndexesByRunId: nextRemovedIndexesByRunId
        })
        nextGeneratingByConversation = nextGenerationState.generatingByConversation
        nextStartedAtByConversation = nextGenerationState.startedAtByConversation
        nextRemovedIndexesByRunId = nextGenerationState.removedIndexesByRunId
        removedStateChanged = true
      }
    }
    if (removedStateChanged) {
      set({
        generatingByConversation: nextGeneratingByConversation,
        generationStartedAtByConversation: nextStartedAtByConversation,
        removedGenerationIndexesByRunId: nextRemovedIndexesByRunId
      })
    }
    await pixaiApi.history.deleteMany(Array.from(selectedIds))
    await get().reloadHistory()
    const runsByConversation = { ...get().runsByConversation }
    for (const conversationId of affectedConversationIds) {
      runsByConversation[conversationId] = await pixaiApi.conversation.runs(conversationId)
    }
    set({ runsByConversation })
    get().notify(`已删除 ${selectedIds.size} 条历史项`)
  },
  toggleFavorite: async (item) => {
    await pixaiApi.history.favorite(item.id, !item.favorite)
    await get().reloadHistory()
  },
  loadTemplates: async () => {
    const templates = await pixaiApi.templates.list()
    set({ templates })
  },
  saveTemplate: async (input) => {
    await pixaiApi.templates.upsert(input)
    await get().loadTemplates()
    get().notify('提示词模板已保存')
  },
  deleteTemplate: async (id) => {
    await pixaiApi.templates.delete(id)
    await get().loadTemplates()
    get().notify('提示词模板已删除')
  },
  applyPromptTemplate: async (template) => {
    const id = get().activeConversationId
    if (!id) return
    const updated = await pixaiApi.conversation.update(id, {
      draftPrompt: template.prompt,
      ratio: template.ratio,
      size: getDefaultImageSize(template.ratio),
      quality: template.quality,
      title: template.title
    })
    set({
      conversations: get().conversations.map((conversation) => (conversation.id === id ? updated : conversation)),
      view: 'workspace'
    })
    get().notify(`已套用「${template.title}」`)
  },
  notify: (message) => {
    set({ toast: message })
    if (message) window.setTimeout(() => set({ toast: null }), 2200)
  }
}))

function getActiveConversation(state: AppState): Conversation | null {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId) || null
}

function nextConversationUpdateVersion(conversationId: string): number {
  const nextVersion = (conversationUpdateVersions.get(conversationId) || 0) + 1
  conversationUpdateVersions.set(conversationId, nextVersion)
  return nextVersion
}

function findHistoryItem(state: AppState, id: string): ImageHistoryItem | null {
  return state.history.find((item) => item.id === id)
    || Object.values(state.runsByConversation).flatMap((runs) => runs.flatMap((run) => run.items)).find((item) => item.id === id)
    || null
}

function getSelectedImageProfile(settings: ProviderSettings | null) {
  return settings?.profiles.find((profile) => profile.id === settings.selectedImageProfileId) || settings?.profiles[0] || null
}

async function notifyGenerationFinished(items: ImageHistoryItem[], errorMessage: string | null, get: () => AppState, durationText: string): Promise<void> {
  const state = get()
  if (!state.preferences?.notifyOnImageSuccess) return
  if (state.windowFocused) return
  if (state.preferences.notificationPermission !== 'granted') return
  const successes = items.filter((item) => item.status === 'succeeded')
  const failures = items.filter((item) => item.status === 'failed')
  const title = errorMessage ? 'PixAI 图片生成失败' : 'PixAI 图片生成完成'
  const body = errorMessage
    ? `${errorMessage}${durationText}`
    : buildSuccessNotificationBody(successes, failures, durationText)
  await sendSystemNotification(title, body).catch(() => undefined)
}

function buildSuccessNotificationBody(successes: ImageHistoryItem[], failures: ImageHistoryItem[], durationText: string): string {
  const first = successes[0]
  if (!first) return `生成完成${durationText}`
  const resultText = failures.length > 0
    ? `${successes.length} 张成功，${failures.length} 张失败`
    : successes.length > 1
      ? `${successes.length} 张图片`
      : `${first.ratio} · ${first.quality}`
  return `${resultText}${durationText}`
}
