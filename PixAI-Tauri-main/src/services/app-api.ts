import { openPath } from '@tauri-apps/plugin-opener'
import { storeDataUrlFile } from '../lib/platform'
import { AppDatabase } from './app-database'
import { AppUpdateService } from './app-update'
import { AppPreferencesStore } from './app-preferences'
import { getPixaiCodexSkillStatus, installPixaiCodexSkill } from './codex-skill-installer'
import { ImageService } from './image-service'
import { PromptService } from './prompt-service'
import { PromptTemplateStore } from './prompt-templates'
import { ProviderSettingsStore } from './provider-settings'
import type {
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  HistoryListOptions,
  ImageHistoryItem,
  PromptAssistInput,
  PromptTemplateInput,
  ProviderProfileInput,
  ProviderSettingsUpdate,
  AppPreferencesUpdate,
  ReferenceImageFilePayload
} from '../shared/types'

type ReferenceImageImportPayload = ReferenceImageFilePayload & { storagePath?: string | null }

export type PixaiApi = ReturnType<typeof createPixaiApi>

export function createPixaiApi() {
  const database = new AppDatabase()
  const providers = new ProviderSettingsStore()
  const preferences = new AppPreferencesStore()
  const images = new ImageService(database, providers)
  const prompts = new PromptService(providers)
  const templates = new PromptTemplateStore()
  const appUpdate = new AppUpdateService()

  return {
    settings: {
      get: () => providers.get(),
      update: (input: ProviderSettingsUpdate) => providers.update(input),
      upsertProfile: (input: ProviderProfileInput) => providers.upsertProfile(input),
      deleteProfile: (id: string) => providers.deleteProfile(id),
      testProfile: (id: string) => providers.testProfile(id)
    },
    preferences: {
      get: () => preferences.get(),
      update: (input: AppPreferencesUpdate) => preferences.update(input),
      refreshNotificationPermission: () => preferences.refreshNotificationPermission(),
      requestNotificationPermission: () => preferences.requestNotificationPermission()
    },
    conversation: {
      list: () => database.listConversations(),
      get: (id: string) => database.getConversation(id),
      create: (input?: ConversationCreateInput) => database.createConversation(input),
      update: (id: string, input: ConversationUpdate) => database.updateConversation(id, input),
      delete: (id: string) => database.deleteConversation(id),
      runs: (id: string) => database.listRuns(id)
    },
    image: {
      generate: (input: GenerateImageInput) => images.generate(input),
      cancel: (runId: string, requestIndex?: number) => images.cancel(runId, requestIndex)
    },
    prompt: {
      inspire: (input?: PromptAssistInput) => prompts.inspire(input),
      enrich: (input: PromptAssistInput & { prompt: string }) => prompts.enrich(input)
    },
    reference: {
      importFiles: (conversationId: string, files: File[]) => importReferenceFiles(database, conversationId, files),
      importPayloads: (conversationId: string, files: ReferenceImageImportPayload[]) => database.importReferenceImages(conversationId, files),
      addFromHistoryMany: (conversationId: string, historyIds: string[]) => importHistoryReferences(database, conversationId, historyIds),
      addFromHistory: (conversationId: string, historyId: string) => database.addHistoryImageAsReference(conversationId, historyId),
      remove: (conversationId: string, referenceImageId: string) => database.removeReference(conversationId, referenceImageId),
      reorder: (conversationId: string, referenceImageIds: string[]) => database.reorderReferences(conversationId, referenceImageIds)
    },
    history: {
      list: (options?: HistoryListOptions) => database.listHistory(options),
      get: (id: string) => database.getHistory(id),
      delete: (id: string) => database.deleteHistory(id),
      deleteMany: (ids: string[]) => database.deleteHistoryMany(ids),
      favorite: (id: string, favorite: boolean) => database.setFavorite(id, favorite)
    },
    templates: {
      list: () => templates.list(),
      upsert: (input: PromptTemplateInput & { id?: string }) => templates.upsert(input),
      delete: (id: string) => templates.delete(id)
    },
    appUpdate: {
      versionInfo: () => appUpdate.getVersionInfo(),
      check: () => appUpdate.check(),
      downloadAndInstall: (onProgress?: Parameters<AppUpdateService['downloadAndInstall']>[0]) => appUpdate.downloadAndInstall(onProgress),
      relaunch: () => appUpdate.relaunch()
    },
    codexSkill: {
      status: () => getPixaiCodexSkillStatus(),
      install: () => installPixaiCodexSkill()
    },
    shell: {
      openPath: (path: string) => openPath(path)
    }
  }
}

export const pixaiApi = createPixaiApi()

async function importReferenceFiles(database: AppDatabase, conversationId: string, files: File[]) {
  const payload = await Promise.all(
    files.map(async (file) => {
      const dataUrl = await fileToDataUrl(file)
      const stored = await storeDataUrlFile('references', file.name || 'reference.png', dataUrl)
      return {
        name: file.name,
        mimeType: file.type || stored.mimeType,
        dataUrl: stored.dataUrl,
        fileSizeBytes: stored.fileSizeBytes || file.size,
        storagePath: stored.path
      }
    })
  )
  return database.importReferenceImages(conversationId, payload)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'))
    reader.readAsDataURL(file)
  })
}

async function importHistoryReferences(database: AppDatabase, conversationId: string, historyIds: string[]) {
  const files: ReferenceImageImportPayload[] = []
  for (const historyId of historyIds) {
    const item = await database.getHistory(historyId)
    if (!item?.dataUrl) throw new Error(`历史图片不可用：${historyId}`)
    files.push(historyItemToReferencePayload(item))
  }
  return database.importReferenceImages(conversationId, files)
}

function historyItemToReferencePayload(item: ImageHistoryItem): ReferenceImageImportPayload {
  return {
    name: `${item.id}.${extensionFromDataUrl(item.dataUrl || '')}`,
    mimeType: mimeTypeFromDataUrl(item.dataUrl || ''),
    dataUrl: item.dataUrl || '',
    fileSizeBytes: item.fileSizeBytes || 0,
    storagePath: item.storagePath || null
  }
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  return /^data:([^;]+);base64,/i.exec(dataUrl)?.[1] || 'image/png'
}

function extensionFromDataUrl(dataUrl: string): string {
  const mimeType = mimeTypeFromDataUrl(dataUrl)
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}
