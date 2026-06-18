import { getAdapter } from '../adapters/registry'
import { ProviderHttpError } from '../adapters/openai-compatible'
import { createErrorDetails, serializeError } from '../lib/errors'
import { createId } from '../lib/ids'
import { PlatformHttpProxyError, readLocalImageDataUrl, readRemoteImageUrl, storeDataUrlFile } from '../lib/platform'
import { elapsedMs, nowIso } from '../lib/time'
import { getDefaultImageSize, isImageSizeCompatible, normalizeImageGenerationTimeoutSeconds, normalizeRetryCount } from '../shared/image-options'
import type { GenerateImageInput, GenerateImageResult, GenerationMode, GenerationRun, ImageApiData, ImageGenerationCallLog, ImageHistoryItem, ReferenceImage } from '../shared/types'
import type { AppDatabase } from './app-database'
import type { ProviderSettingsStore } from './provider-settings'

export class ImageService {
  private activeRequests = new Map<string, Array<AbortController>>()

  constructor(
    private readonly database: AppDatabase,
    private readonly providers: ProviderSettingsStore
  ) {}

  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    const startedAt = Date.now()
    const settings = await this.providers.get()
    const runtimeProfile = await this.providers.getRuntimeProfile(settings.selectedImageProfileId)
    const adapter = getAdapter(runtimeProfile.type)
    const conversation = await this.database.getConversation(input.conversationId)
    const globalVisible = conversation?.autoSaveHistory !== false
    const keepFailureDetails = conversation?.keepFailureDetails !== false
    const prompt = input.prompt.trim()
    const model = input.model?.trim() || conversation?.model || runtimeProfile.defaultImageModel
    const size = input.size && isImageSizeCompatible(input.ratio, input.size) ? input.size : getDefaultImageSize(input.ratio)
    const referenceImages = (conversation?.referenceImages || []).filter((reference) => input.referenceImageIds?.includes(reference.id))
    const generationMode: GenerationMode = referenceImages.length > 0 ? 'image-to-image' : 'text-to-image'
    const maxRetries = normalizeRetryCount(input.maxRetries)

    if (!prompt) throw new ImageGenerationPreflightError('请先输入提示词。', 'validation', { reason: 'Prompt is required.' })
    if (!runtimeProfile.apiKey) throw new ImageGenerationPreflightError('API Key 尚未配置。', 'configuration', { profileId: runtimeProfile.id })
    if (generationMode === 'image-to-image' && !adapter.capabilities.includes('image-to-image')) {
      throw new ImageGenerationPreflightError('当前服务不支持图生图。', 'capability', { profileId: runtimeProfile.id })
    }

    const createdAt = nowIso()
    const run = await this.database.insertRun({
      id: createId('run'),
      conversationId: input.conversationId,
      prompt,
      model,
      ratio: input.ratio,
      size,
      quality: input.quality,
      n: input.n,
      status: 'running',
      durationMs: null,
      errorMessage: null,
      errorDetails: null,
      maxRetries,
      retryAttempts: {},
      retryFailures: {},
      generationMode,
      referenceImages,
      createdAt
    })

    const count = Math.min(10, Math.max(1, input.n || 1))
    const controllers = Array.from({ length: count }, () => new AbortController())
    this.activeRequests.set(run.id, controllers)
    const items: ImageHistoryItem[] = []
    let succeededCount = 0
    let canceledCount = 0

    await Promise.all(
      controllers.map(async (controller, requestIndex) => {
        if (controller.signal.aborted) return
        try {
          const generated = await this.requestWithRetries({
            input: { ...input, model, size, n: 1 },
            run,
            model,
            requestIndex,
            controller,
            maxRetries,
            startedAt
          })
          if (!generated.image) {
            items.push(generated.item)
            return
          }
          const dataUrl = await resolveGeneratedImageDataUrl(generated.image, input.outputFormat || 'png')
          const stored = dataUrl
            ? await persistGeneratedImage(createId('image'), dataUrl, input.outputFormat || 'png')
            : null
          items.push(
            await this.database.insertHistory({
              id: createId('history'),
              conversationId: input.conversationId,
              runId: run.id,
              prompt,
              model,
              ratio: input.ratio,
              size,
              quality: input.quality,
              requestIndex,
              durationMs: elapsedMs(startedAt),
              dataUrl: stored?.dataUrl || dataUrl,
              fileSizeBytes: stored?.fileSizeBytes ?? estimateImageBytes(generated.image),
              storagePath: stored?.path || null,
              status: 'succeeded',
              errorMessage: null,
              errorDetails: null,
              retryAttempt: generated.retryAttempt,
              globalVisible,
              generationMode,
              referenceImages: stripReferenceImagePayloads(referenceImages),
              callLog: generated.callLog,
              createdAt: nowIso()
            })
          )
          succeededCount += 1
        } catch (error) {
          if (controller.signal.aborted) {
            canceledCount += 1
            return
          }
          items.push(await this.createFailureItem(input, run, model, requestIndex, maxRetries, error, elapsedMs(startedAt)))
        }
      })
    )

    this.activeRequests.delete(run.id)
    const failedCount = count - succeededCount
    const errorMessage = failedCount > 0 && succeededCount === 0 ? (canceledCount === failedCount ? '生成已取消。' : '图片生成失败。') : null
    const errorDetails = errorMessage && keepFailureDetails
      ? createErrorDetails({ ...input, model }, canceledCount === failedCount ? 'canceled' : 'batch-failed', { succeededCount, failedCount, canceledCount })
      : null
    const completed = await this.database.updateRun(run.id, {
      status: succeededCount > 0 ? 'succeeded' : 'failed',
      durationMs: elapsedMs(startedAt),
      errorMessage,
      errorDetails
    })
    return {
      run: { ...completed, items },
      items,
      ...(errorMessage ? { errorMessage, errorDetails: errorDetails || undefined } : {}),
      canceled: canceledCount > 0 && succeededCount === 0
    }
  }

  cancel(runId: string, requestIndex?: number): void {
    const requests = this.activeRequests.get(runId)
    if (!requests) return
    if (typeof requestIndex === 'number') {
      requests[requestIndex]?.abort()
      return
    }
    if (requests.length > 1) return
    requests.forEach((request) => request.abort())
  }

  private async requestWithRetries({
    input,
    run,
    model,
    requestIndex,
    controller,
    maxRetries,
    startedAt
  }: {
    input: GenerateImageInput
    run: GenerationRun
    model: string
    requestIndex: number
    controller: AbortController
    maxRetries: number
    startedAt: number
  }): Promise<{ image: ImageApiData; retryAttempt: number; callLog: ImageGenerationCallLog | null } | { image: null; item: ImageHistoryItem; retryAttempt: number }> {
    const settings = await this.providers.get()
    const runtimeProfile = await this.providers.getRuntimeProfile(settings.selectedImageProfileId)
    const adapter = getAdapter(runtimeProfile.type)
    const conversation = await this.database.getConversation(input.conversationId)
    const references = await hydrateReferencesForRequest((conversation?.referenceImages || []).filter((reference) => input.referenceImageIds?.includes(reference.id)))
    let callLog: ImageGenerationCallLog | null = null
    for (let retryAttempt = 0; retryAttempt <= maxRetries; retryAttempt += 1) {
      const timeout = createTimeoutController(controller.signal, normalizeImageGenerationTimeoutSeconds(input.generationTimeoutSeconds) * 1000)
      try {
        const images = await adapter.generateImage(runtimeProfile, {
          input,
          referenceImages: references,
          signal: timeout.signal,
          onCallLog: (log) => {
            callLog = log
          }
        })
        const image = images.at(-1)
        if (image) return { image, retryAttempt, callLog }
        if (retryAttempt < maxRetries) continue
        throw new Error('图片接口没有返回图片。')
      } catch (error) {
        if (controller.signal.aborted) throw error
        const nextRun = await this.database.getRun(run.id)
        await this.database.updateRun(run.id, {
          retryAttempts: { ...(nextRun?.retryAttempts || {}), [requestIndex]: retryAttempt },
          retryFailures: {
            ...(nextRun?.retryFailures || {}),
            [requestIndex]: {
              errorMessage: getGenerationErrorMessage(error),
              errorDetails: createErrorDetails({ ...input, model }, getFailureStage(error, 'retry'), {
                retryAttempt,
                requestIndex,
                error: getFailureDetails(error)
              }),
              createdAt: nowIso()
            }
          }
        })
        if (retryAttempt < maxRetries) continue
        const item = await this.createFailureItem(input, run, model, requestIndex, retryAttempt, error, elapsedMs(startedAt), callLog)
        return { image: null, item, retryAttempt }
      } finally {
        timeout.cleanup()
      }
    }
    throw new Error('图片生成重试流程异常退出。')
  }

  private async createFailureItem(input: GenerateImageInput, run: GenerationRun, model: string, requestIndex: number, retryAttempt: number, error: unknown, durationMs: number, callLog: ImageGenerationCallLog | null = null): Promise<ImageHistoryItem> {
    const errorMessage = getGenerationErrorMessage(error)
    const details = getFailureDetails(error)
    const conversation = await this.database.getConversation(input.conversationId)
    const errorDetails = conversation?.keepFailureDetails === false ? null : createErrorDetails({ ...input, model }, getFailureStage(error, 'request-failed'), { requestIndex, retryAttempt, details })
    return this.database.insertHistory({
      id: createId('history'),
      conversationId: input.conversationId,
      runId: run.id,
      prompt: input.prompt.trim(),
      model,
      ratio: input.ratio,
      size: input.size || getDefaultImageSize(input.ratio),
      quality: input.quality,
      requestIndex,
      durationMs,
      dataUrl: null,
      fileSizeBytes: null,
      status: 'failed',
      errorMessage,
      errorDetails,
      retryAttempt,
      globalVisible: conversation?.autoSaveHistory !== false,
      generationMode: run.generationMode,
      referenceImages: run.referenceImages,
      callLog,
      createdAt: nowIso()
    })
  }
}

export class ImageGenerationPreflightError extends Error {
  constructor(
    message: string,
    readonly stage: 'validation' | 'configuration' | 'capability',
    readonly details: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ImageGenerationPreflightError'
  }
}

function createTimeoutController(parentSignal: AbortSignal, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const abort = () => controller.abort(parentSignal.reason)
  const timer = window.setTimeout(() => controller.abort(new DOMException('图片生成超时。', 'TimeoutError')), timeoutMs)
  if (parentSignal.aborted) abort()
  else parentSignal.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer)
      parentSignal.removeEventListener('abort', abort)
    }
  }
}

async function persistGeneratedImage(id: string, dataUrl: string, outputFormat: string): Promise<{ path: string; dataUrl: string; fileSizeBytes: number }> {
  const extension = outputFormat === 'jpeg' ? 'jpg' : outputFormat
  return storeDataUrlFile('images', `${id}.${extension}`, dataUrl)
}

function imageDataToDataUrl(image: ImageApiData, outputFormat: string): string | null {
  if (image.b64_json) return `data:image/${outputFormat === 'jpeg' ? 'jpeg' : outputFormat};base64,${image.b64_json}`
  if (image.url?.startsWith('data:')) return image.url
  return null
}

async function resolveGeneratedImageDataUrl(image: ImageApiData, outputFormat: string): Promise<string | null> {
  const directDataUrl = imageDataToDataUrl(image, outputFormat)
  if (directDataUrl) return directDataUrl
  if (!image.url) return null
  const payload = await readRemoteImageUrl(image.url)
  return payload.dataUrl
}

function estimateImageBytes(image: ImageApiData): number | null {
  if (!image.b64_json) return null
  return Math.floor((image.b64_json.length * 3) / 4)
}

function stripReferenceImagePayloads(references: ReferenceImage[]): ReferenceImage[] {
  return references.map((reference) => ({
    ...reference,
    dataUrl: ''
  }))
}

async function hydrateReferencesForRequest(references: ReferenceImage[]): Promise<ReferenceImage[]> {
  return Promise.all(references.map(async (reference) => {
    if (reference.dataUrl.startsWith('data:') || !reference.storagePath) return reference
    return {
      ...reference,
      dataUrl: await readLocalImageDataUrl(reference.storagePath)
    }
  }))
}

function getGenerationErrorMessage(error: unknown): string {
  if (error instanceof PlatformHttpProxyError) {
    return isUnconfirmedTransportError(error) ? `响应未确认：${error.message}` : error.message
  }
  return error instanceof Error ? error.message : '图片生成失败。'
}

function getFailureStage(error: unknown, fallback: string): string {
  if (error instanceof PlatformHttpProxyError) return isUnconfirmedTransportError(error) ? 'transport' : 'configuration'
  if (error instanceof ProviderHttpError) return 'http'
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout'
  return fallback
}

function getFailureDetails(error: unknown): Record<string, unknown> {
  if (error instanceof ProviderHttpError) return error.details
  if (error instanceof PlatformHttpProxyError) return {
    ...error.details,
    note: '上游可能已收到请求并完成生成，但客户端没有收到完整响应。请在服务端日志或历史结果中复核。'
  }
  return serializeError(error)
}

function isUnconfirmedTransportError(error: PlatformHttpProxyError): boolean {
  return error.details.stage !== 'configuration'
}
