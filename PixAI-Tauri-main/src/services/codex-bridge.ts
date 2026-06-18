import { emit, listen } from '@tauri-apps/api/event'
import { DEFAULT_IMAGE_MAX_RETRIES, DEFAULT_MODEL, getDefaultImageSize, isImageSizeCompatible } from '../shared/image-options'
import { copyBinaryFile, isTauriRuntime, markCodexBridgeReady, readBinaryFileBase64, readLocalImageFile, respondCodexBridge, writeDataUrlFile } from '../lib/platform'
import type { PixaiApi } from './app-api'
import { pixaiApi } from './app-api'
import { ImageGenerationPreflightError } from './image-service'
import type {
  CodexBridgeRequest,
  CodexBridgeResponse,
  CodexGenerateImageInput,
  CodexReeditImageInput,
  Conversation,
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  HistoryListOptions,
  ImageBackground,
  ImageHistoryItem,
  ImageInputFidelity,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ImageRatio,
  LegacyProviderSettingsUpdate,
  ProviderSettings,
  ReferenceImage,
  ReferenceImageFilePayload
} from '../shared/types'

type BridgeResult = {
  status?: number
  headers?: Record<string, string>
  body?: unknown
  bodyText?: string
  bodyBase64?: string
}

type JsonRecord = Record<string, unknown>

const CODEX_BRIDGE_REQUEST_EVENT = 'pixai://codex-bridge/request'
const CODEX_BRIDGE_CHANGE_EVENT = 'pixai://codex-bridge/changed'
const VALID_RATIOS: ImageRatio[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21']
const VALID_QUALITIES: ImageQuality[] = ['auto', 'low', 'medium', 'high']
const VALID_OUTPUT_FORMATS: ImageOutputFormat[] = ['png', 'jpeg', 'webp']
const VALID_BACKGROUNDS: ImageBackground[] = ['auto', 'opaque']
const VALID_MODERATIONS: ImageModeration[] = ['auto', 'low']
const VALID_INPUT_FIDELITIES: ImageInputFidelity[] = ['low', 'high']

let bridgeRegistration: Promise<void> | null = null

export function registerCodexBridgeHandler(api: PixaiApi = pixaiApi): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve()
  if (!bridgeRegistration) {
    bridgeRegistration = listen<CodexBridgeRequest>(CODEX_BRIDGE_REQUEST_EVENT, (event) => {
      void handleCodexBridgeEvent(api, event.payload)
    }).then(() => markCodexBridgeReady())
  }
  return bridgeRegistration
}

export async function handleCodexBridgeRequest(api: PixaiApi, request: CodexBridgeRequest): Promise<CodexBridgeResponse> {
  try {
    const url = new URL(request.path, `http://127.0.0.1:${request.port}`)
    const result = await routeCodexBridgeRequest(api, {
      ...request,
      method: request.method.toUpperCase(),
      path: normalizePath(url.pathname),
      url
    })
    return toBridgeResponse(request.id, result)
  } catch (error) {
    const status = error instanceof BridgeHttpError ? error.status : error instanceof ImageGenerationPreflightError ? 400 : 500
    return toBridgeResponse(request.id, {
      status,
      body: {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }
}

async function handleCodexBridgeEvent(api: PixaiApi, request: CodexBridgeRequest): Promise<void> {
  const response = await handleCodexBridgeRequest(api, request)
  await respondCodexBridge(response)
}

async function routeCodexBridgeRequest(
  api: PixaiApi,
  request: CodexBridgeRequest & { path: string; url: URL }
): Promise<BridgeResult> {
  const { method, path, url } = request
  const body = readJsonBody(request.body)

  if (method === 'GET' && path === '/health') return health(request.port)
  if (method === 'GET' && path === '/settings') return { body: await publicSettings(api) }
  if (method === 'PATCH' && path === '/settings') return updateSettings(api, body)
  if (method === 'GET' && path === '/conversations') return { body: await api.conversation.list() }
  if (method === 'POST' && path === '/conversations') return createConversation(api, body)
  if (method === 'GET' && path === '/history') return listHistory(api, url, request.port)
  if (method === 'POST' && path === '/generate') return generate(api, body, request.port)
  if (method === 'POST' && path.startsWith('/images/') && path.endsWith('/reedit')) {
    return reedit(api, extractPathId(path, '/images/', '/reedit'), body, request.port)
  }
  if (method === 'GET' && path.startsWith('/images/') && path.endsWith('/file')) {
    return imageFile(api, extractPathId(path, '/images/', '/file'))
  }
  if (method === 'GET' && path.startsWith('/images/')) {
    const item = await requireHistory(api, extractPathId(path, '/images/', ''))
    return { body: enrichHistoryItem(item, request.port) }
  }
  if (method === 'DELETE' && path.startsWith('/images/')) return deleteHistory(api, extractPathId(path, '/images/', ''))
  if (method === 'PATCH' && path.startsWith('/images/') && path.endsWith('/favorite')) {
    return favoriteHistory(api, extractPathId(path, '/images/', '/favorite'), body, request.port)
  }
  if (method === 'POST' && path === '/images/export') return exportImages(api, body)
  if (method === 'POST' && path === '/prompt/inspire') return inspirePrompt(api, body)
  if (method === 'POST' && path === '/prompt/enrich') return enrichPrompt(api, body)

  throw new BridgeHttpError(404, `未知 Codex Bridge 路由：${method} ${path}`)
}

function health(port: number): BridgeResult {
  return {
    body: {
      ok: true,
      app: 'PixAI',
      version: '0.0.1',
      bridge: 'codex',
      host: '127.0.0.1',
      port,
      endpoints: [
        'GET /health',
        'GET /settings',
        'PATCH /settings',
        'GET /conversations',
        'POST /conversations',
        'GET /history',
        'GET /images/:id',
        'GET /images/:id/file',
        'DELETE /images/:id',
        'PATCH /images/:id/favorite',
        'POST /images/:id/reedit',
        'POST /generate',
        'POST /prompt/inspire',
        'POST /prompt/enrich'
      ]
    }
  }
}

async function publicSettings(api: PixaiApi): Promise<ProviderSettings & Record<string, unknown>> {
  return withCompatibilitySettings(await api.settings.get())
}

async function updateSettings(api: PixaiApi, body: unknown): Promise<BridgeResult> {
  const input = asRecord(body)
  const current = await api.settings.get()
  const update: LegacyProviderSettingsUpdate = {}
  if ('selectedImageProfileId' in input) update.selectedImageProfileId = readOptionalString(input.selectedImageProfileId, 'selectedImageProfileId')
  if ('selectedPromptProfileId' in input) update.selectedPromptProfileId = readOptionalString(input.selectedPromptProfileId, 'selectedPromptProfileId')
  const selectedImageProfileId = update.selectedImageProfileId || current.selectedImageProfileId
  const selectedPromptProfileId = update.selectedPromptProfileId || current.selectedPromptProfileId

  let next = await api.settings.update(update)
  const baseUrl = readOptionalString(input.baseURL ?? input.baseUrl, 'baseURL')
  const apiKey = 'apiKey' in input ? readOptionalString(input.apiKey, 'apiKey') || null : undefined
  const imageModel = readOptionalString(input.defaultImageModel ?? input.defaultModel, 'defaultImageModel')
  const promptModel = readOptionalString(input.defaultPromptModel ?? input.promptModel, 'defaultPromptModel')
  const imageGenerationEndpoint = readEnum(input.imageGenerationEndpoint, ['images-api', 'responses-api'] as const, 'imageGenerationEndpoint', true)
  if (!next.profiles.length && (baseUrl || apiKey !== undefined || imageModel || promptModel || imageGenerationEndpoint)) {
    next = await api.settings.upsertProfile({
      name: 'OpenAI 兼容接口',
      baseUrl: baseUrl || undefined,
      apiKey,
      defaultImageModel: imageModel || undefined,
      defaultPromptModel: promptModel || undefined,
      imageGenerationEndpoint: imageGenerationEndpoint || undefined
    })
  } else if (baseUrl || apiKey !== undefined) {
    const profileIds = Array.from(new Set([selectedImageProfileId, selectedPromptProfileId].filter(Boolean)))
    for (const profileId of profileIds) {
      const profile = next.profiles.find((item) => item.id === profileId)
      if (!profile) throw new BridgeHttpError(404, '未找到服务配置。')
      next = await api.settings.upsertProfile({
        id: profile.id,
        baseUrl: baseUrl || profile.baseUrl,
        apiKey
      })
    }
  }
  if (imageModel) {
    const imageProfile = next.profiles.find((profile) => profile.id === (selectedImageProfileId || next.selectedImageProfileId))
    if (!imageProfile) throw new BridgeHttpError(404, '未找到图片服务配置。')
    next = await api.settings.upsertProfile({ id: imageProfile.id, defaultImageModel: imageModel })
  }
  if (promptModel) {
    const promptProfile = next.profiles.find((profile) => profile.id === (selectedPromptProfileId || next.selectedPromptProfileId))
    if (!promptProfile) throw new BridgeHttpError(404, '未找到提示词服务配置。')
    next = await api.settings.upsertProfile({ id: promptProfile.id, defaultPromptModel: promptModel })
  }
  if (imageGenerationEndpoint) {
    const imageProfile = next.profiles.find((profile) => profile.id === (selectedImageProfileId || next.selectedImageProfileId))
    if (!imageProfile) throw new BridgeHttpError(404, '未找到图片服务配置。')
    next = await api.settings.upsertProfile({ id: imageProfile.id, imageGenerationEndpoint })
  }

  await notifyBridgeChange('settings')
  return { body: withCompatibilitySettings(next) }
}

async function createConversation(api: PixaiApi, body: unknown): Promise<BridgeResult> {
  const input = asRecord(body, true)
  const createInput: ConversationCreateInput = {}
  const ratio = readEnum(input.ratio, VALID_RATIOS, 'ratio', true)
  if (ratio) createInput.ratio = ratio
  if ('size' in input) createInput.size = readOptionalString(input.size, 'size')
  const quality = readEnum(input.quality, VALID_QUALITIES, 'quality', true)
  if (quality) createInput.quality = quality
  if ('n' in input) createInput.n = readInteger(input.n, 'n', 1, 10)
  if ('model' in input) createInput.model = readOptionalString(input.model, 'model')
  const outputFormat = readEnum(input.outputFormat, VALID_OUTPUT_FORMATS, 'outputFormat', true)
  if (outputFormat) createInput.outputFormat = outputFormat
  if ('outputCompression' in input) createInput.outputCompression = readNullableInteger(input.outputCompression, 'outputCompression', 0, 100)
  const background = readEnum(input.background, VALID_BACKGROUNDS, 'background', true)
  if (background) createInput.background = background
  const moderation = readEnum(input.moderation, VALID_MODERATIONS, 'moderation', true)
  if (moderation) createInput.moderation = moderation
  if ('stream' in input) createInput.stream = readBoolean(input.stream, 'stream')
  if ('partialImages' in input) createInput.partialImages = readNullableInteger(input.partialImages, 'partialImages', 0, 3)
  const inputFidelity = readEnum(input.inputFidelity, VALID_INPUT_FIDELITIES, 'inputFidelity', true)
  if (inputFidelity) createInput.inputFidelity = inputFidelity
  if ('maxRetries' in input) createInput.maxRetries = readInteger(input.maxRetries, 'maxRetries', 0, 10)
  if ('generationTimeoutSeconds' in input) {
    createInput.generationTimeoutSeconds = readInteger(input.generationTimeoutSeconds, 'generationTimeoutSeconds', 1, 1800)
  }
  if ('autoSaveHistory' in input) createInput.autoSaveHistory = readBoolean(input.autoSaveHistory, 'autoSaveHistory')
  if ('keepFailureDetails' in input) createInput.keepFailureDetails = readBoolean(input.keepFailureDetails, 'keepFailureDetails')

  const conversation = await api.conversation.create(createInput)
  const title = readOptionalString(input.title, 'title')?.trim()
  const next = title ? await api.conversation.update(conversation.id, { title }) : conversation
  await notifyBridgeChange('conversation')
  return { status: 201, body: next }
}

async function listHistory(api: PixaiApi, url: URL, port: number): Promise<BridgeResult> {
  const options: HistoryListOptions = {
    query: url.searchParams.get('query') || undefined,
    sort: readEnum(url.searchParams.get('sort') || undefined, ['newest', 'oldest'] as const, 'sort', true),
    favoritesOnly: parseOptionalBooleanQuery(url.searchParams.get('favoritesOnly')) ?? undefined,
    status: readEnum(url.searchParams.get('status') || undefined, ['succeeded', 'failed', 'all'] as const, 'status', true),
    model: url.searchParams.get('model') || undefined,
    ratio: readEnum(url.searchParams.get('ratio') || undefined, ['all', ...VALID_RATIOS] as const, 'ratio', true),
    quality: readEnum(url.searchParams.get('quality') || undefined, ['all', ...VALID_QUALITIES] as const, 'quality', true)
  }
  const limit = parseOptionalIntegerQuery(url.searchParams.get('limit'), 'limit', 1, 500)
  const offset = parseOptionalIntegerQuery(url.searchParams.get('offset'), 'offset', 0, Number.MAX_SAFE_INTEGER) || 0
  const allItems = await api.history.list(options)
  const items = allItems.slice(offset, limit ? offset + limit : undefined).map((item) => enrichHistoryItem(item, port))
  return {
    body: {
      total: allItems.length,
      offset,
      limit: limit || null,
      items
    }
  }
}

async function generate(api: PixaiApi, body: unknown, port: number): Promise<BridgeResult> {
  const input = readCodexGenerateInput(body)
  const prepared = await prepareGeneration(api, input)
  const result = await api.image.generate(prepared.generateInput)
  const items = result.items.map((item) => enrichHistoryItem(item, port))
  await notifyBridgeChange('generation')
  return {
    status: result.errorMessage ? 202 : 201,
    body: {
      ...result,
      items,
      run: {
        ...result.run,
        items
      },
      conversation: await api.conversation.update(prepared.conversation.id, {}),
      references: prepared.references,
      importedReferences: prepared.importedReferences
    }
  }
}

async function reedit(api: PixaiApi, historyId: string, body: unknown, port: number): Promise<BridgeResult> {
  const source = await requireHistory(api, historyId)
  if (source.status !== 'succeeded' || !source.dataUrl) {
    throw new BridgeHttpError(400, '只能重新编辑已成功生成且有本地图片数据的历史项。')
  }
  const input = readCodexReeditInput(body)
  const prepared = await prepareGeneration(api, {
    ...input,
    prompt: input.prompt?.trim() || source.prompt,
    conversationId: input.conversationId ?? source.conversationId ?? undefined,
    referenceHistoryIds: [source.id],
    clearReferences: input.clearReferences ?? true,
    ratio: input.ratio ?? source.ratio,
    size: input.size ?? source.size ?? undefined,
    quality: input.quality ?? source.quality,
    model: input.model ?? source.model
  })
  const result = await api.image.generate(prepared.generateInput)
  const items = result.items.map((item) => enrichHistoryItem(item, port))
  await notifyBridgeChange('generation')
  return {
    status: result.errorMessage ? 202 : 201,
    body: {
      source: enrichHistoryItem(source, port),
      ...result,
      items,
      run: {
        ...result.run,
        items
      },
      conversation: await api.conversation.update(prepared.conversation.id, {}),
      references: prepared.references,
      importedReferences: prepared.importedReferences
    }
  }
}

async function deleteHistory(api: PixaiApi, id: string): Promise<BridgeResult> {
  await requireHistory(api, id)
  await api.history.delete(id)
  await notifyBridgeChange('history')
  return { body: { ok: true, deletedId: id } }
}

async function favoriteHistory(api: PixaiApi, id: string, body: unknown, port: number): Promise<BridgeResult> {
  const input = asRecord(body)
  const item = await api.history.favorite(id, readBoolean(input.favorite, 'favorite'))
  await notifyBridgeChange('history')
  return { body: enrichHistoryItem(item, port) }
}

async function exportImages(api: PixaiApi, body: unknown): Promise<BridgeResult> {
  const input = asRecord(body)
  const ids = readStringArray(input.ids, 'ids')
  const directory = readRequiredString(input.directory, 'directory')
  const exported: Array<{ id: string; path: string }> = []
  const skipped: Array<{ id: string; reason: string }> = []
  for (const id of ids) {
    const item = await api.history.get(id)
    if (!item?.dataUrl || item.status !== 'succeeded') {
      skipped.push({ id, reason: '图片不可用或未成功生成。' })
      continue
    }
    const extension = extensionFromImageSource(item)
    const filename = `${safeFilename(item.id)}.${extension}`
    if (item.dataUrl.startsWith('data:')) {
      exported.push({ id, path: await writeDataUrlFile(directory, filename, item.dataUrl) })
    } else if (item.storagePath) {
      exported.push({ id, path: await copyStoredImageFile(item.storagePath, directory, filename) })
    } else {
      skipped.push({ id, reason: '图片文件路径不可用。' })
    }
  }
  return { body: { ok: true, directory, exported, skipped } }
}

async function imageFile(api: PixaiApi, id: string): Promise<BridgeResult> {
  const item = await requireHistory(api, id)
  if (item.status !== 'succeeded' || !item.dataUrl) throw new BridgeHttpError(404, '未找到图片文件。')
  if (!item.dataUrl.startsWith('data:') && item.storagePath) {
    return {
      headers: {
        'Content-Type': mimeTypeFromImageSource(item),
        'Content-Disposition': `inline; filename="${safeFilename(item.id)}.${extensionFromImageSource(item)}"`
      },
      bodyBase64: base64FromBytes(await readStoredImageFile(item.storagePath))
    }
  }
  return {
    headers: {
      'Content-Type': mimeTypeFromDataUrl(item.dataUrl),
      'Content-Disposition': `inline; filename="${safeFilename(item.id)}.${extensionFromDataUrl(item.dataUrl)}"`
    },
    bodyBase64: base64FromDataUrl(item.dataUrl)
  }
}

async function inspirePrompt(api: PixaiApi, body: unknown): Promise<BridgeResult> {
  const input = asRecord(body, true)
  const prompt = await api.prompt.inspire({
    hasReferenceImages: 'hasReferenceImages' in input ? readBoolean(input.hasReferenceImages, 'hasReferenceImages') : undefined
  })
  await notifyBridgeChange('prompt')
  return { body: { prompt } }
}

async function enrichPrompt(api: PixaiApi, body: unknown): Promise<BridgeResult> {
  const input = asRecord(body)
  const prompt = await api.prompt.enrich({
    prompt: readRequiredString(input.prompt, 'prompt'),
    hasReferenceImages: 'hasReferenceImages' in input ? readBoolean(input.hasReferenceImages, 'hasReferenceImages') : undefined
  })
  await notifyBridgeChange('prompt')
  return { body: { prompt } }
}

async function prepareGeneration(
  api: PixaiApi,
  input: CodexGenerateImageInput
): Promise<{
  conversation: Conversation
  generateInput: GenerateImageInput
  references: ReferenceImage[]
  importedReferences: Array<ReferenceImage & { sourcePath: string; sourceHistoryId?: string }>
}> {
  let conversation = input.conversationId ? await api.conversation.get(input.conversationId) : (await api.conversation.list())[0] || null
  if (input.conversationId && !conversation) throw new BridgeHttpError(404, '未找到会话。')
  if (!conversation) conversation = await api.conversation.create()

  let workingReferences = conversation.referenceImages
  if (input.clearReferences === true) {
    const retained = new Set(input.referenceImageIds || [])
    workingReferences = workingReferences.filter((reference) => retained.has(reference.id))
    conversation = await api.conversation.update(conversation.id, { referenceImages: workingReferences } as ConversationUpdate)
  }

  const importedReferences: Array<ReferenceImage & { sourcePath: string; sourceHistoryId?: string }> = []
  if (input.referenceHistoryIds?.length) {
    const beforeIds = new Set(workingReferences.map((reference) => reference.id))
    workingReferences = await api.reference.addFromHistoryMany(conversation.id, input.referenceHistoryIds)
    for (const reference of workingReferences.filter((item) => !beforeIds.has(item.id))) {
      importedReferences.push({ ...reference, sourcePath: '', sourceHistoryId: input.referenceHistoryIds[importedReferences.length] })
    }
  }

  if (input.referenceImagePaths?.length) {
    const payloads: ReferenceImageFilePayload[] = []
    for (const imagePath of input.referenceImagePaths) payloads.push(await readLocalImageFile(imagePath))
    const beforeIds = new Set(workingReferences.map((reference) => reference.id))
    workingReferences = await api.reference.importPayloads(conversation.id, payloads)
    const added = workingReferences.filter((item) => !beforeIds.has(item.id))
    for (const [index, reference] of added.entries()) {
      importedReferences.push({ ...reference, sourcePath: input.referenceImagePaths[index] || reference.name })
    }
  }

  const conversationReferences = workingReferences
  const baseReferenceIds =
    input.useConversationReferences === true && (input.referenceImageIds || []).length === 0 && importedReferences.length === 0
      ? conversationReferences.map((reference) => reference.id)
      : []
  const referenceImageIds = [
    ...(input.referenceImageIds || []),
    ...importedReferences.map((reference) => reference.id),
    ...baseReferenceIds
  ].filter((id, index, ids) => Boolean(id) && ids.indexOf(id) === index)

  const settings = await api.settings.get()
  const imageProfile = settings.profiles.find((profile) => profile.id === settings.selectedImageProfileId)
  const ratio = input.ratio ?? conversation.ratio
  const size = input.size && isImageSizeCompatible(ratio, input.size) ? input.size : conversation.size || getDefaultImageSize(ratio)
  const model = input.model?.trim() || conversation.model || imageProfile?.defaultImageModel || DEFAULT_MODEL
  const generateInput: GenerateImageInput = {
    conversationId: conversation.id,
    prompt: input.prompt,
    model,
    ratio,
    size,
    quality: input.quality ?? conversation.quality,
    n: input.n ?? conversation.n,
    outputFormat: input.outputFormat ?? conversation.outputFormat,
    outputCompression: input.outputCompression ?? conversation.outputCompression ?? undefined,
    background: input.background ?? conversation.background,
    moderation: input.moderation ?? conversation.moderation,
    stream: input.stream ?? conversation.stream,
    partialImages: input.partialImages ?? conversation.partialImages ?? undefined,
    inputFidelity: input.inputFidelity ?? conversation.inputFidelity ?? undefined,
    maxRetries: input.maxRetries ?? conversation.maxRetries ?? DEFAULT_IMAGE_MAX_RETRIES,
    generationTimeoutSeconds: input.generationTimeoutSeconds ?? conversation.generationTimeoutSeconds,
    referenceImageIds
  }

  conversation = await api.conversation.update(conversation.id, {
    draftPrompt: input.prompt,
    title: input.title?.trim() || deriveTitle(conversation, input.prompt),
    model,
    ratio,
    size,
    quality: generateInput.quality,
    n: generateInput.n,
    outputFormat: generateInput.outputFormat,
    outputCompression: generateInput.outputCompression ?? null,
    background: generateInput.background,
    moderation: generateInput.moderation,
    stream: generateInput.stream,
    partialImages: generateInput.partialImages ?? 0,
    inputFidelity: generateInput.inputFidelity ?? null,
    maxRetries: generateInput.maxRetries,
    generationTimeoutSeconds: generateInput.generationTimeoutSeconds
  })

  return {
    conversation,
    generateInput,
    references: conversation.referenceImages.filter((reference) => referenceImageIds.includes(reference.id)),
    importedReferences
  }
}

async function requireHistory(api: PixaiApi, id: string): Promise<ImageHistoryItem> {
  const item = await api.history.get(id)
  if (!item) throw new BridgeHttpError(404, '未找到历史记录。')
  return item
}

function readCodexGenerateInput(body: unknown): CodexGenerateImageInput {
  const input = asRecord(body)
  const prompt = readRequiredString(input.prompt, 'prompt').trim()
  if (!prompt) throw new BridgeHttpError(400, 'prompt 不能为空。')
  const ratio = readEnum(input.ratio, VALID_RATIOS, 'ratio', true)
  const quality = readEnum(input.quality, VALID_QUALITIES, 'quality', true)
  const outputFormat = readEnum(input.outputFormat, VALID_OUTPUT_FORMATS, 'outputFormat', true)
  const background = readEnum(input.background, VALID_BACKGROUNDS, 'background', true)
  const moderation = readEnum(input.moderation, VALID_MODERATIONS, 'moderation', true)
  const inputFidelity = readEnum(input.inputFidelity, VALID_INPUT_FIDELITIES, 'inputFidelity', true)
  return {
    prompt,
    conversationId: readOptionalString(input.conversationId, 'conversationId'),
    title: readOptionalString(input.title, 'title'),
    model: readOptionalString(input.model, 'model'),
    ratio,
    size: readOptionalString(input.size, 'size'),
    quality,
    n: input.n === undefined ? undefined : readInteger(input.n, 'n', 1, 10),
    outputFormat,
    outputCompression: input.outputCompression === undefined ? undefined : readInteger(input.outputCompression, 'outputCompression', 0, 100),
    background,
    moderation,
    stream: input.stream === undefined ? undefined : readBoolean(input.stream, 'stream'),
    partialImages: input.partialImages === undefined ? undefined : readInteger(input.partialImages, 'partialImages', 0, 3),
    inputFidelity,
    maxRetries: input.maxRetries === undefined ? undefined : readInteger(input.maxRetries, 'maxRetries', 0, 10),
    generationTimeoutSeconds:
      input.generationTimeoutSeconds === undefined
        ? undefined
        : readInteger(input.generationTimeoutSeconds, 'generationTimeoutSeconds', 1, 1800),
    referenceImageIds: readOptionalStringArray(input.referenceImageIds, 'referenceImageIds'),
    referenceHistoryIds: readOptionalStringArray(input.referenceHistoryIds, 'referenceHistoryIds'),
    referenceImagePaths: readOptionalStringArray(input.referenceImagePaths, 'referenceImagePaths'),
    useConversationReferences:
      input.useConversationReferences === undefined ? undefined : readBoolean(input.useConversationReferences, 'useConversationReferences'),
    clearReferences: input.clearReferences === undefined ? undefined : readBoolean(input.clearReferences, 'clearReferences')
  }
}

function readCodexReeditInput(body: unknown): CodexReeditImageInput {
  const record = asRecord(body, true)
  const generateInput = readCodexGenerateInput({
    ...record,
    prompt: typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt : 'placeholder'
  })
  return {
    ...generateInput,
    prompt: typeof record.prompt === 'string' ? record.prompt : undefined
  }
}

function toBridgeResponse(requestId: string, result: BridgeResult): CodexBridgeResponse {
  const headers = { ...(result.headers || {}) }
  if (result.bodyBase64) {
    return {
      requestId,
      status: result.status || 200,
      headers,
      bodyBase64: result.bodyBase64
    }
  }
  if (!headers['Content-Type']) headers['Content-Type'] = 'application/json; charset=utf-8'
  return {
    requestId,
    status: result.status || 200,
    headers,
    body: result.bodyText ?? JSON.stringify(result.body ?? { ok: true }, null, 2)
  }
}

function readJsonBody(body: string | null): unknown {
  if (body === null || !body.trim()) return undefined
  try {
    return JSON.parse(body)
  } catch {
    throw new BridgeHttpError(400, '请求体必须是有效 JSON。')
  }
}

function asRecord(value: unknown, allowMissing = false): JsonRecord {
  if (value === undefined || value === null) {
    if (allowMissing) return {}
    throw new BridgeHttpError(400, 'JSON 请求体不能为空。')
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeHttpError(400, 'JSON 请求体必须是对象。')
  }
  return value as JsonRecord
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new BridgeHttpError(400, `${field} 必须是字符串。`)
  return value
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return readRequiredString(value, field)
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new BridgeHttpError(400, `${field} 必须是字符串数组。`)
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new BridgeHttpError(400, `${field}[${index}] 必须是字符串。`)
    return item
  })
}

function readOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  return readStringArray(value, field)
}

function readInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BridgeHttpError(400, `${field} 必须是数字。`)
  const next = Math.trunc(value)
  if (next < min || next > max) throw new BridgeHttpError(400, `${field} 必须在 ${min} 到 ${max} 之间。`)
  return next
}

function readNullableInteger(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null || value === undefined) return null
  return readInteger(value, field, min, max)
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new BridgeHttpError(400, `${field} 必须是布尔值。`)
  return value
}

function readEnum<T extends string>(value: unknown, values: readonly T[], field: string, optional = false): T | undefined {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined
    throw new BridgeHttpError(400, `${field} 不能为空。`)
  }
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new BridgeHttpError(400, `${field} 必须是以下值之一：${values.join(', ')}。`)
  }
  return value as T
}

function parseOptionalBooleanQuery(value: string | null): boolean | undefined {
  if (value === null || value === '') return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new BridgeHttpError(400, 'favoritesOnly 必须是 true 或 false。')
}

function parseOptionalIntegerQuery(value: string | null, field: string, min: number, max: number): number | undefined {
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new BridgeHttpError(400, `${field} 必须是数字。`)
  const next = Math.trunc(parsed)
  if (next < min || next > max) throw new BridgeHttpError(400, `${field} 必须在 ${min} 到 ${max} 之间。`)
  return next
}

function enrichHistoryItem<T extends ImageHistoryItem>(item: T, port: number): T & {
  fileUrl: string | null
  bridgeFileUrl: string
} {
  return {
    ...item,
    fileUrl: item.dataUrl?.startsWith('data:') ? item.dataUrl : item.storagePath || item.dataUrl,
    bridgeFileUrl: `http://127.0.0.1:${port}/images/${encodeURIComponent(item.id)}/file`
  }
}

function deriveTitle(conversation: Conversation, prompt: string): string {
  if (conversation.title.trim() && conversation.draftPrompt.trim()) return conversation.title
  const compact = prompt.replace(/\s+/g, ' ').trim()
  return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact || conversation.title
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

function extractPathId(path: string, prefix: string, suffix: string): string {
  if (!path.startsWith(prefix) || (suffix && !path.endsWith(suffix))) throw new BridgeHttpError(404, '路由不存在。')
  const encoded = path.slice(prefix.length, suffix ? -suffix.length : undefined)
  const id = decodeURIComponent(encoded)
  if (!id) throw new BridgeHttpError(400, '图片 ID 不能为空。')
  return id
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  return /^data:([^;]+);base64,/i.exec(dataUrl)?.[1] || 'image/png'
}

function mimeTypeFromImageSource(item: ImageHistoryItem): string {
  if (item.dataUrl?.startsWith('data:')) return mimeTypeFromDataUrl(item.dataUrl)
  const extension = extensionFromImageSource(item)
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  return 'image/png'
}

function base64FromDataUrl(dataUrl: string): string {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) throw new BridgeHttpError(404, '图片数据不可用。')
  return match[1]
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return btoa(binary)
}

function extensionFromDataUrl(dataUrl: string): string {
  const mimeType = mimeTypeFromDataUrl(dataUrl)
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function extensionFromImageSource(item: ImageHistoryItem): string {
  if (item.dataUrl?.startsWith('data:')) return extensionFromDataUrl(item.dataUrl)
  const source = item.storagePath || item.dataUrl || ''
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(source)?.[1]?.toLowerCase()
  return extension === 'jpg' || extension === 'jpeg' || extension === 'webp' ? extension : 'png'
}

async function readStoredImageFile(path: string): Promise<Uint8Array> {
  return base64ToBytes(await readBinaryFileBase64(path))
}

async function copyStoredImageFile(sourcePath: string, directory: string, filename: string): Promise<string> {
  return copyBinaryFile(sourcePath, directory, filename)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'pixai-image'
}

function withCompatibilitySettings(settings: ProviderSettings): ProviderSettings & Record<string, unknown> {
  const imageProfile = settings.profiles.find((profile) => profile.id === settings.selectedImageProfileId) || settings.profiles[0]
  const promptProfile = settings.profiles.find((profile) => profile.id === settings.selectedPromptProfileId) || imageProfile
  return {
    ...settings,
    baseURL: imageProfile?.baseUrl,
    baseUrl: imageProfile?.baseUrl,
    defaultModel: imageProfile?.defaultImageModel,
    promptModel: promptProfile?.defaultPromptModel,
    imageGenerationEndpoint: imageProfile?.imageGenerationEndpoint,
    apiKeyStored: Boolean(imageProfile?.apiKeyStored),
    imageProfile,
    promptProfile
  }
}

async function notifyBridgeChange(type: string): Promise<void> {
  if (!isTauriRuntime()) return
  await emit(CODEX_BRIDGE_CHANGE_EVENT, { type, createdAt: new Date().toISOString() })
}

class BridgeHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'BridgeHttpError'
  }
}
