import { createId } from '../lib/ids'
import { readJsonState, storeDataUrlFile, writeJsonState } from '../lib/platform'
import { nowIso } from '../lib/time'
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  DEFAULT_MODEL,
  getDefaultImageSize,
  isImageSizeCompatible,
  normalizeImageGenerationTimeoutSeconds,
  normalizeRetryCount
} from '../shared/image-options'
import type {
  Conversation,
  ConversationCreateInput,
  ConversationUpdate,
  GenerationRun,
  HistoryListOptions,
  ImageHistoryItem,
  ImageRatio,
  ReferenceImage
} from '../shared/types'

const STATE_NAME = 'pixai-data'
export const MAX_REFERENCE_IMAGES = 8
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024

type PersistedData = {
  conversations: Conversation[]
  runs: GenerationRun[]
  history: ImageHistoryItem[]
}

export class AppDatabase {
  private data: PersistedData | null = null

  async load(): Promise<void> {
    if (this.data) return
    const payload = await readJsonState(STATE_NAME)
    if (payload) {
      try {
        const normalized = await normalizeData(JSON.parse(payload) as PersistedData)
        this.data = normalized.data
        await this.recoverInterruptedRuns()
        if (normalized.changed) await this.save()
        return
      } catch {
        // Start fresh when the local data file is invalid.
      }
    }
    this.data = (await normalizeData({ conversations: [], runs: [], history: [] })).data
    await this.save()
  }

  async listConversations(): Promise<Conversation[]> {
    await this.load()
    return [...this.requireData().conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getConversation(id: string): Promise<Conversation | null> {
    await this.load()
    return this.requireData().conversations.find((conversation) => conversation.id === id) || null
  }

  async createConversation(input: ConversationCreateInput = {}): Promise<Conversation> {
    await this.load()
    const data = this.requireData()
    const now = nowIso()
    const ratio = input.ratio || '1:1'
    const conversation: Conversation = {
      id: createId('conversation'),
      title: '新会话',
      draftPrompt: '',
      model: input.model || DEFAULT_MODEL,
      ratio,
      size: input.size && isImageSizeCompatible(ratio, input.size) ? input.size : getDefaultImageSize(ratio),
      quality: input.quality || 'high',
      n: normalizeInteger(input.n, 1, 10) ?? 1,
      outputFormat: input.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
      outputCompression: input.outputCompression ?? null,
      background: input.background || 'auto',
      moderation: input.moderation || 'auto',
      stream: input.stream || false,
      partialImages: input.partialImages ?? 0,
      inputFidelity: input.inputFidelity ?? null,
      maxRetries: normalizeRetryCount(input.maxRetries),
      generationTimeoutSeconds: normalizeImageGenerationTimeoutSeconds(input.generationTimeoutSeconds),
      autoSaveHistory: input.autoSaveHistory ?? true,
      keepFailureDetails: input.keepFailureDetails ?? true,
      referenceImages: [],
      createdAt: now,
      updatedAt: now
    }
    data.conversations.unshift(conversation)
    await this.save()
    return conversation
  }

  async updateConversation(id: string, input: ConversationUpdate): Promise<Conversation> {
    await this.load()
    const data = this.requireData()
    const current = data.conversations.find((conversation) => conversation.id === id)
    if (!current) throw new Error('Conversation not found.')
    const ratio = input.ratio || current.ratio
    const next: Conversation = {
      ...current,
      ...input,
      ratio,
      size: normalizeConversationSize(ratio, input.size, input.ratio ? undefined : current.size),
      n: normalizeInteger(input.n, 1, 10) ?? current.n,
      outputCompression: input.outputCompression !== undefined ? input.outputCompression : current.outputCompression,
      partialImages: input.partialImages !== undefined ? input.partialImages : current.partialImages,
      maxRetries: input.maxRetries !== undefined ? normalizeRetryCount(input.maxRetries) : current.maxRetries,
      generationTimeoutSeconds:
        input.generationTimeoutSeconds !== undefined
          ? normalizeImageGenerationTimeoutSeconds(input.generationTimeoutSeconds)
          : current.generationTimeoutSeconds,
      updatedAt: nowIso()
    }
    data.conversations = data.conversations.map((conversation) => (conversation.id === id ? next : conversation))
    await this.save()
    return next
  }

  async deleteConversation(id: string): Promise<void> {
    await this.load()
    const data = this.requireData()
    data.conversations = data.conversations.filter((conversation) => conversation.id !== id)
    data.runs = data.runs.filter((run) => run.conversationId !== id)
    data.history = data.history.map((item) => (item.conversationId === id ? { ...item, conversationId: null } : item))
    await this.save()
  }

  async insertRun(input: Omit<GenerationRun, 'items'>): Promise<GenerationRun> {
    await this.load()
    const run: GenerationRun = { ...input, items: [], referenceImages: stripReferenceImagePayloads(input.referenceImages || []) }
    this.requireData().runs.unshift(run)
    await this.save()
    return run
  }

  async updateRun(id: string, input: Partial<Pick<GenerationRun, 'status' | 'errorMessage' | 'errorDetails' | 'durationMs' | 'retryAttempts' | 'retryFailures'>>): Promise<GenerationRun> {
    await this.load()
    const data = this.requireData()
    const current = data.runs.find((run) => run.id === id)
    if (!current) throw new Error('未找到生成任务。')
    const next = { ...current, ...input }
    data.runs = data.runs.map((run) => (run.id === id ? next : run))
    await this.save()
    return this.hydrateRun(next)
  }

  async getRun(id: string): Promise<GenerationRun | null> {
    await this.load()
    const run = this.requireData().runs.find((item) => item.id === id)
    return run ? this.hydrateRun(run) : null
  }

  async listRuns(conversationId: string): Promise<GenerationRun[]> {
    await this.load()
    return this.requireData()
      .runs.filter((run) => run.conversationId === conversationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((run) => this.hydrateRun(run))
  }

  async insertHistory(input: Omit<ImageHistoryItem, 'favorite'> & { favorite?: boolean; globalVisible?: boolean }): Promise<ImageHistoryItem> {
    await this.load()
    const item: ImageHistoryItem = { ...input, favorite: Boolean(input.favorite), globalVisible: input.globalVisible !== false }
    this.requireData().history.unshift(item)
    await this.save()
    return item
  }

  async listHistory(options: HistoryListOptions = {}): Promise<ImageHistoryItem[]> {
    await this.load()
    const query = options.query?.trim().toLowerCase() || ''
    const filtered = this.requireData().history.filter((item) => {
      if (item.globalVisible === false) return false
      if (query && !`${item.prompt} ${item.model} ${item.size || ''}`.toLowerCase().includes(query)) return false
      if (options.favoritesOnly && !item.favorite) return false
      if (options.status && options.status !== 'all' && item.status !== options.status) return false
      if (options.model && item.model !== options.model) return false
      if (options.ratio && options.ratio !== 'all' && item.ratio !== options.ratio) return false
      if (options.quality && options.quality !== 'all' && item.quality !== options.quality) return false
      return true
    })
    return filtered.sort((a, b) => (options.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)))
  }

  async getHistory(id: string): Promise<ImageHistoryItem | null> {
    await this.load()
    return this.requireData().history.find((item) => item.id === id) || null
  }

  async deleteHistory(id: string): Promise<void> {
    await this.load()
    const data = this.requireData()
    data.history = data.history.filter((item) => item.id !== id)
    await this.save()
  }

  async deleteHistoryMany(ids: string[]): Promise<number> {
    await this.load()
    const selectedIds = new Set(ids)
    if (selectedIds.size === 0) return 0
    const data = this.requireData()
    const before = data.history.length
    data.history = data.history.filter((item) => !selectedIds.has(item.id))
    const deletedCount = before - data.history.length
    if (deletedCount > 0) await this.save()
    return deletedCount
  }

  async setFavorite(id: string, favorite: boolean): Promise<ImageHistoryItem> {
    await this.load()
    const data = this.requireData()
    const item = data.history.find((entry) => entry.id === id)
    if (!item) throw new Error('未找到历史记录。')
    const next = { ...item, favorite }
    data.history = data.history.map((entry) => (entry.id === id ? next : entry))
    await this.save()
    return next
  }

  async importReferenceImages(conversationId: string, files: Array<{ name: string; mimeType: string; dataUrl: string; fileSizeBytes: number; storagePath?: string | null }>): Promise<ReferenceImage[]> {
    await this.load()
    const conversation = await this.getConversation(conversationId)
    if (!conversation) throw new Error('Conversation not found.')
    if (conversation.referenceImages.length + files.length > MAX_REFERENCE_IMAGES) {
      throw new Error(`最多只能添加 ${MAX_REFERENCE_IMAGES} 张参考图。`)
    }
    const now = nowIso()
    const references = files.map((file, index) => {
      const mimeType = validateReferenceImage(file)
      const source = normalizeReferenceSource(file.dataUrl, file.storagePath)
      return {
        id: createId('reference'),
        name: file.name || `reference-${conversation.referenceImages.length + index + 1}.png`,
        mimeType,
        dataUrl: source.dataUrl,
        fileSizeBytes: file.fileSizeBytes,
        storagePath: source.storagePath,
        createdAt: now
      }
    })
    const next = [...conversation.referenceImages, ...references]
    await this.updateConversation(conversationId, { referenceImages: next } as ConversationUpdate)
    return next
  }

  async addHistoryImageAsReference(conversationId: string, historyId: string): Promise<ReferenceImage[]> {
    const item = await this.getHistory(historyId)
    if (!item?.dataUrl) throw new Error('Image data not found.')
    const reference: ReferenceImage = {
      id: createId('reference'),
      name: `${item.id}.png`,
      mimeType: mimeTypeFromDataUrl(item.dataUrl),
      dataUrl: item.dataUrl,
      fileSizeBytes: item.fileSizeBytes || 0,
      storagePath: item.storagePath || null,
      createdAt: nowIso()
    }
    await this.updateConversation(conversationId, { referenceImages: [reference] } as ConversationUpdate)
    return [reference]
  }

  async removeReference(conversationId: string, referenceImageId: string): Promise<ReferenceImage[]> {
    const conversation = await this.getConversation(conversationId)
    if (!conversation) throw new Error('Conversation not found.')
    const next = conversation.referenceImages.filter((reference) => reference.id !== referenceImageId)
    await this.updateConversation(conversationId, { referenceImages: next } as ConversationUpdate)
    return next
  }

  async reorderReferences(conversationId: string, referenceImageIds: string[]): Promise<ReferenceImage[]> {
    const conversation = await this.getConversation(conversationId)
    if (!conversation) throw new Error('Conversation not found.')
    const byId = new Map(conversation.referenceImages.map((reference) => [reference.id, reference]))
    const ordered = referenceImageIds.map((id) => byId.get(id)).filter((reference): reference is ReferenceImage => Boolean(reference))
    const missing = conversation.referenceImages.filter((reference) => !referenceImageIds.includes(reference.id))
    const next = [...ordered, ...missing].slice(0, MAX_REFERENCE_IMAGES)
    await this.updateConversation(conversationId, { referenceImages: next } as ConversationUpdate)
    return next
  }

  async recoverInterruptedRuns(): Promise<number> {
    await this.load()
    const data = this.requireData()
    let count = 0
    data.runs = data.runs.map((run) => {
      if (run.status !== 'running') return run
      count += 1
      return {
        ...run,
        status: 'failed',
        durationMs: run.durationMs ?? 0,
        errorMessage: '生成被中断。',
        errorDetails: JSON.stringify({ stage: 'interrupted-run-recovery', runId: run.id }, null, 2)
      }
    })
    if (count > 0) await this.save()
    return count
  }

  private hydrateRun(run: GenerationRun): GenerationRun {
    const items = this.requireData()
      .history.filter((item) => item.runId === run.id)
      .sort((a, b) => {
        const requestSort = (a.requestIndex ?? 999) - (b.requestIndex ?? 999)
        return requestSort || a.createdAt.localeCompare(b.createdAt)
      })
    return { ...run, items }
  }

  private requireData(): PersistedData {
    if (!this.data) throw new Error('Database is not loaded.')
    return this.data
  }

  private async save(): Promise<void> {
    await writeJsonState(STATE_NAME, JSON.stringify(this.requireData(), null, 2))
  }
}

async function normalizeData(data: PersistedData): Promise<{ data: PersistedData; changed: boolean }> {
  let changed = false
  const strip = (references: ReferenceImage[] = []) => stripReferenceImagePayloads(references, () => {
    changed = true
  })
  const persistReference = async (reference: ReferenceImage): Promise<ReferenceImage> => {
    if (!reference.dataUrl?.startsWith('data:')) {
      const source = normalizeReferenceSource(reference.dataUrl || '', reference.storagePath)
      if (source.changed) {
        changed = true
        return { ...reference, dataUrl: source.dataUrl, storagePath: source.storagePath }
      }
      return reference
    }
    const stored = await storeDataUrlFile('references', reference.name || `${reference.id}.png`, reference.dataUrl)
    const source = normalizeReferenceSource(stored.dataUrl, stored.path)
    changed = true
    return {
      ...reference,
      dataUrl: source.dataUrl,
      fileSizeBytes: stored.fileSizeBytes || reference.fileSizeBytes,
      storagePath: source.storagePath
    }
  }
  const persistHistoryItem = async (item: ImageHistoryItem): Promise<ImageHistoryItem> => {
    if (!item.dataUrl?.startsWith('data:')) {
      const recoveredPath = item.storagePath || storagePathFromAssetUrl(item.dataUrl)
      if (recoveredPath && recoveredPath !== item.storagePath) {
        changed = true
        return { ...item, storagePath: recoveredPath }
      }
      return item
    }
    const stored = await storeDataUrlFile('images', `${item.id}.${extensionFromDataUrl(item.dataUrl)}`, item.dataUrl)
    changed = true
    return {
      ...item,
      dataUrl: stored.dataUrl,
      fileSizeBytes: stored.fileSizeBytes || item.fileSizeBytes,
      storagePath: stored.path
    }
  }
  const normalized = {
    conversations: Array.isArray(data.conversations)
      ? await Promise.all(data.conversations.map(async (conversation) => ({
        ...conversation,
        size: isImageSizeCompatible(conversation.ratio, conversation.size)
          ? conversation.size
          : getDefaultImageSize(conversation.ratio),
        referenceImages: await Promise.all((conversation.referenceImages || []).map(persistReference))
      })))
      : [],
    runs: Array.isArray(data.runs)
      ? data.runs.map((run) => ({
        ...run,
        referenceImages: strip(run.referenceImages || [])
      }))
      : [],
    history: Array.isArray(data.history)
      ? await Promise.all(data.history.map(async (item) => persistHistoryItem({
        ...item,
        referenceImages: strip(item.referenceImages || [])
      })))
      : []
  }
  return { data: normalized, changed }
}

function stripReferenceImagePayloads(references: ReferenceImage[], onStripped?: () => void): ReferenceImage[] {
  return references.map((reference) => ({
    ...reference,
    dataUrl: reference.dataUrl ? (onStripped?.(), '') : reference.dataUrl
  }))
}

function normalizeReferenceSource(dataUrl: string, storagePath?: string | null): { dataUrl: string; storagePath: string | null; changed: boolean } {
  const assetPath = storagePathFromAssetUrl(dataUrl)
  const localPath = storagePathFromLocalPath(dataUrl)
  const recoveredPath = storagePath || assetPath || localPath
  const shouldClearDataUrl = Boolean(recoveredPath && dataUrl && !dataUrl.startsWith('data:') && (assetPath || localPath))
  const next = {
    dataUrl: shouldClearDataUrl ? '' : dataUrl,
    storagePath: recoveredPath || storagePath || null
  }
  return {
    ...next,
    changed: next.dataUrl !== dataUrl || next.storagePath !== (storagePath || null)
  }
}

function normalizeConversationSize(ratio: ImageRatio, nextSize: string | undefined, currentSize: string | undefined): string {
  if (nextSize && isImageSizeCompatible(ratio, nextSize)) return nextSize
  if (currentSize && isImageSizeCompatible(ratio, currentSize)) return currentSize
  return getDefaultImageSize(ratio)
}

function normalizeInteger(value: number | null | undefined, min: number, max: number): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function validateReferenceImage(file: { name: string; mimeType: string; fileSizeBytes: number }): string {
  const mimeType = normalizeReferenceMimeType(file.mimeType, file.name)
  if (!mimeType) throw new Error('仅支持 PNG、JPG、WEBP 参考图。')
  if (file.fileSizeBytes > MAX_REFERENCE_IMAGE_BYTES) throw new Error('单张参考图不能超过 20MB。')
  return mimeType
}

function normalizeReferenceMimeType(mimeType: string, name: string): string | null {
  const normalized = mimeType.toLowerCase()
  if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(normalized)) return normalized
  if (/\.(png)$/i.test(name)) return 'image/png'
  if (/\.(jpg|jpeg)$/i.test(name)) return 'image/jpeg'
  if (/\.(webp)$/i.test(name)) return 'image/webp'
  return null
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

function storagePathFromAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const encoded = /^https?:\/\/asset\.localhost\/(.+)$/i.exec(value)?.[1]
  if (!encoded) return null
  return decodeURIComponent(encoded)
}

function storagePathFromLocalPath(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\') || value.startsWith('/')) return value
  return null
}

export function ratioFromSize(size: string | null): ImageRatio {
  if (!size) return '1:1'
  const match = /^(\d+)x(\d+)$/i.exec(size)
  if (!match) return '1:1'
  const width = Number(match[1])
  const height = Number(match[2])
  if (width === height) return '1:1'
  return width > height ? '16:9' : '9:16'
}
