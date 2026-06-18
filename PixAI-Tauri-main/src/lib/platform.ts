import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { downloadDir } from '@tauri-apps/api/path'
import { openPath } from '@tauri-apps/plugin-opener'
import { open, save } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AppVersionInfo, CodexBridgeResponse, CodexSkillInstallRequest, CodexSkillStatus, ImageHistoryItem, ReferenceImageFilePayload } from '../shared/types'

type SecretWriteResult = {
  insecure_storage: boolean
  backend: string
}

type SecretReadResult = {
  value: string | null
  insecure_storage: boolean
  backend: string
}

type HttpProxyResponse = {
  status: number
  status_text: string
  body: string
}

type HttpProxyRequestPayload = {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  bodyBase64?: string
  timeoutMs?: number
  firstByteTimeoutMs?: number
}

export type PlatformFetchOptions = {
  timeoutMs?: number
  firstByteTimeoutMs?: number
}

export type PlatformStreamResponse = {
  status: number
  statusText: string
  text: string
}

type LocalImageReadResult = ReferenceImageFilePayload
type RemoteImageReadResult = ReferenceImageFilePayload

type StoredDataUrlFileResult = {
  path: string
  dataUrl: string
  mimeType: string
  fileSizeBytes: number
}

type CloseRequestAction = 'hide' | 'quit' | false
type DesktopPlatformInfo = Required<Pick<AppVersionInfo, 'os' | 'arch' | 'installerType'>>
type DesktopPlatformInfoResult = {
  os?: string
  arch?: string
  installerType?: string
  installer_type?: string
}

type DownloadableHistoryImage = Pick<ImageHistoryItem, 'id' | 'dataUrl' | 'storagePath'>

type DownloadHistoryImagesResult = {
  savedCount: number
  canceled: boolean
}

const memoryStorage = new Map<string, string>()
const memorySecrets = new Map<string, string>()
const imageSourceCache = new Map<string, string>()
let mockNotificationPermission: NotificationPermission | 'unsupported' | null = null
const notificationLog: Array<{ title: string; body?: string }> = []
const MAX_REMOTE_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function fetchJsonThroughPlatform(url: string, init: RequestInit, options: PlatformFetchOptions = {}): Promise<Response> {
  if (!isTauriRuntime()) return fetch(url, init)
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  let result: HttpProxyResponse
  try {
    result = await invoke<HttpProxyResponse>('http_proxy', {
      request: {
        url,
        method: init.method || 'GET',
        headers,
        body: typeof init.body === 'string' ? init.body : undefined,
        timeoutMs: options.timeoutMs,
        firstByteTimeoutMs: options.firstByteTimeoutMs
      }
    })
  } catch (error) {
    throw PlatformHttpProxyError.fromInvokeError(url, init.method || 'GET', error)
  }
  return new Response(result.body, {
    status: result.status,
    statusText: result.status_text
  })
}

export async function fetchMultipartThroughPlatform(url: string, init: RequestInit, options: PlatformFetchOptions = {}): Promise<Response> {
  if (!isTauriRuntime()) return fetch(url, init)
  const requestPayload = await buildHttpProxyRequestPayload(url, init)
  let result: HttpProxyResponse
  try {
    result = await invoke<HttpProxyResponse>('http_proxy', {
      request: {
        ...requestPayload,
        timeoutMs: options.timeoutMs,
        firstByteTimeoutMs: options.firstByteTimeoutMs
      }
    } satisfies { request: HttpProxyRequestPayload })
  } catch (error) {
    throw PlatformHttpProxyError.fromInvokeError(url, init.method || 'GET', error)
  }
  return new Response(result.body, {
    status: result.status,
    statusText: result.status_text
  })
}

export async function fetchMultipartTextStreamThroughPlatform(url: string, init: RequestInit, options: PlatformFetchOptions = {}): Promise<PlatformStreamResponse> {
  if (!isTauriRuntime()) {
    const response = await fetch(url, init)
    return {
      status: response.status,
      statusText: response.statusText,
      text: await response.text()
    }
  }
  const requestPayload = await buildHttpProxyRequestPayload(url, init)
  return fetchTextStreamThroughPlatformPayload(url, init.method || 'GET', requestPayload, options)
}

export async function fetchTextStreamThroughPlatform(url: string, init: RequestInit, options: PlatformFetchOptions = {}): Promise<PlatformStreamResponse> {
  if (!isTauriRuntime()) {
    const response = await fetch(url, init)
    return {
      status: response.status,
      statusText: response.statusText,
      text: await response.text()
    }
  }

  const requestPayload = await buildHttpProxyRequestPayload(url, init)
  return fetchTextStreamThroughPlatformPayload(url, init.method || 'GET', requestPayload, options)
}

async function fetchTextStreamThroughPlatformPayload(url: string, method: string, requestPayload: HttpProxyRequestPayload, options: PlatformFetchOptions): Promise<PlatformStreamResponse> {
  const streamId = globalThis.crypto?.randomUUID?.() || `stream-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const chunks: Uint8Array[] = []
  const decoder = new TextDecoder()
  let status = 0
  let statusText = ''
  let settled = false
  let unlisten: (() => void) | undefined
  let listenerReady: Promise<void> | undefined

  const streamPromise = new Promise<PlatformStreamResponse>((resolve, reject) => {
    const handleStreamEvent = (event: { payload: PlatformStreamEvent }) => {
      const payload = event.payload
      if (payload.streamId !== streamId) return
      if (payload.kind === 'chunk') {
        if (payload.chunkBase64) chunks.push(base64ToBytes(payload.chunkBase64))
        return
      }
      if (typeof payload.status === 'number') status = payload.status
      if (typeof payload.statusText === 'string') statusText = payload.statusText
      if (payload.kind === 'error') {
        settled = true
        reject(new Error(payload.error || '平台代理流式请求失败。'))
        return
      }
      if (payload.kind === 'done') {
        settled = true
        try {
          const text = decodeUtf8Chunks(chunks, decoder)
          resolve({ status, statusText, text })
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }
    listenerReady = listen<PlatformStreamEvent>('pixai://http-proxy-stream', handleStreamEvent)
      .then((cleanup) => {
        unlisten = cleanup
      })
    void listenerReady.catch((error) => {
      if (!settled) reject(error)
    })
  })

  try {
    if (!listenerReady) throw new Error('无法注册平台流式监听器。')
    await listenerReady
    await invoke('http_proxy_stream', {
      request: {
        ...requestPayload,
        streamId,
        timeoutMs: options.timeoutMs,
        firstByteTimeoutMs: options.firstByteTimeoutMs
      }
    })
    return await streamPromise
  } catch (error) {
    throw PlatformHttpProxyError.fromInvokeError(url, method, error)
  } finally {
    if (unlisten) unlisten()
  }
}

export async function readJsonState(name: string): Promise<string | null> {
  if (isTauriRuntime()) {
    return invoke<string | null>('read_json_state', { name })
  }
  return memoryStorage.get(name) || globalThis.localStorage?.getItem(`pixai:${name}`) || null
}

export async function writeJsonState(name: string, payload: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke('write_json_state', { name, payload })
    return
  }
  memoryStorage.set(name, payload)
  globalThis.localStorage?.setItem(`pixai:${name}`, payload)
}

export async function setProfileSecret(profileId: string, apiKey: string): Promise<{ insecureStorage: boolean; backend: string }> {
  if (isTauriRuntime()) {
    const result = await invoke<SecretWriteResult>('set_profile_secret', { profileId, apiKey })
    return { insecureStorage: result.insecure_storage, backend: result.backend }
  }
  memorySecrets.set(profileId, apiKey)
  return { insecureStorage: true, backend: 'browser-memory' }
}

export async function getProfileSecret(profileId: string): Promise<{ value: string | null; insecureStorage: boolean; backend: string }> {
  if (isTauriRuntime()) {
    const result = await invoke<SecretReadResult>('get_profile_secret', { profileId })
    return { value: result.value, insecureStorage: result.insecure_storage, backend: result.backend }
  }
  return { value: memorySecrets.get(profileId) || null, insecureStorage: true, backend: 'browser-memory' }
}

export async function deleteProfileSecret(profileId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke('delete_profile_secret', { profileId })
    return
  }
  memorySecrets.delete(profileId)
}

export async function getAppDataDir(): Promise<string> {
  if (isTauriRuntime()) return invoke<string>('app_data_dir')
  return 'browser-memory'
}

export async function getAppInstallerType(): Promise<'msi' | 'nsis' | 'unknown'> {
  if (!isTauriRuntime()) return 'unknown'
  return normalizeInstallerType(await invoke<string>('app_installer_type'))
}

export async function getDesktopPlatformInfo(): Promise<DesktopPlatformInfo> {
  if (!isTauriRuntime()) {
    return {
      os: 'unknown',
      arch: 'unknown',
      installerType: 'unknown'
    }
  }

  try {
    const result = await invoke<DesktopPlatformInfoResult>('desktop_platform_info')
    return {
      os: normalizeDesktopOs(result.os),
      arch: normalizeDesktopArch(result.arch),
      installerType: normalizeInstallerType(result.installerType ?? result.installer_type)
    }
  } catch {
    return {
      os: 'unknown',
      arch: 'unknown',
      installerType: await getAppInstallerType()
    }
  }
}

function normalizeDesktopOs(value: unknown): DesktopPlatformInfo['os'] {
  if (value === 'windows' || value === 'macos' || value === 'linux') return value
  return 'unknown'
}

function normalizeDesktopArch(value: unknown): DesktopPlatformInfo['arch'] {
  if (value === 'x86_64' || value === 'aarch64' || value === 'i686' || value === 'armv7') return value
  return 'unknown'
}

function normalizeInstallerType(value: unknown): DesktopPlatformInfo['installerType'] {
  if (value === 'msi' || value === 'nsis') return value
  return 'unknown'
}

export async function getWindowFocused(): Promise<boolean> {
  if (!isTauriRuntime()) return document.hasFocus()
  return getCurrentWindow().isFocused()
}

export async function watchWindowFocus(onChange: (focused: boolean) => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    const update = () => onChange(document.hasFocus())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    update()
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }
  const currentWindow = getCurrentWindow()
  onChange(await currentWindow.isFocused())
  const unlisten = await currentWindow.onFocusChanged(({ payload }) => onChange(payload))
  return unlisten
}

export async function watchCloseRequested(onCloseRequested: () => CloseRequestAction | Promise<CloseRequestAction>): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined
  const currentWindow = getCurrentWindow()
  return currentWindow.onCloseRequested(async (event) => {
    const action = await onCloseRequested()
    if (!action) return
    event.preventDefault()
    if (action === 'quit') {
      await invoke('quit_app')
      return
    }
    await invoke('hide_main_window')
  })
}

export async function getSystemNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (mockNotificationPermission) return mockNotificationPermission
  if (isTauriRuntime()) return 'granted'
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

export async function requestSystemNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (mockNotificationPermission) return mockNotificationPermission
  if (isTauriRuntime()) return 'granted'
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  try {
    return await window.Notification.requestPermission()
  } catch {
    return getSystemNotificationPermission()
  }
}

export async function sendSystemNotification(title: string, body?: string): Promise<void> {
  notificationLog.push({ title, body })
  if (mockNotificationPermission === 'unsupported' || mockNotificationPermission === 'denied') {
    throw new Error('系统通知权限不可用。')
  }
  if (mockNotificationPermission === 'default') return
  if (!isTauriRuntime() && !mockNotificationPermission && typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission !== 'granted') {
    throw new Error('系统通知权限不可用。')
  }
  if (isTauriRuntime()) {
    await invoke('send_system_notification', { request: { title, body } })
    return
  }
  const notification = new Notification(title, body ? { body } : undefined)
  notification.onclick = () => {
    void activateMainWindow()
    window.dispatchEvent(new Event('pixai:system-notification-activated'))
  }
}

export async function notifyWindowSentToTray(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('send_system_notification', {
    request: {
      title: 'PixAI 已最小化到系统托盘',
      body: '点击托盘图标可恢复窗口，右键可退出。'
    }
  })
}

export async function activateMainWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    window.focus()
    return
  }
  await invoke('activate_main_window')
}

export async function readLocalImageFile(path: string): Promise<ReferenceImageFilePayload> {
  if (!isTauriRuntime()) throw new Error('本地图片路径只能在 Tauri 应用中读取。')
  const result = await invoke<LocalImageReadResult>('read_local_image_file', { path })
  return result
}

export async function readRemoteImageUrl(url: string): Promise<ReferenceImageFilePayload> {
  const normalizedUrl = normalizeRemoteImageUrl(url)
  if (isTauriRuntime()) {
    return invoke<RemoteImageReadResult>('read_remote_image_url', { url: normalizedUrl })
  }
  return readRemoteImageUrlInBrowser(normalizedUrl)
}

export async function readLocalImageDataUrl(path: string): Promise<string> {
  const payload = await readLocalImageFile(path)
  return payload.dataUrl
}

export async function writeDataUrlFile(directory: string, filename: string, dataUrl: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('导出图片只能在 Tauri 应用中执行。')
  return invoke<string>('write_data_url_file', { directory, filename, dataUrl })
}

export async function downloadImageSource(source: string | null, filename: string, storagePath?: string | null): Promise<void> {
  const blob = await resolveDownloadBlob(source, storagePath)
  if (!blob) throw new Error('图片内容不可用，无法下载。')
  if (isTauriRuntime()) {
    const selectedPath = await save({
      defaultPath: filename,
      filters: [
        {
          name: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'webp']
        }
      ]
    })
    if (!selectedPath) throw new DownloadCanceledError()
    await invoke('write_binary_file', {
      path: selectedPath,
      bytesBase64: await blobToBase64(blob)
    })
    return
  }
  await downloadBlob(blob, filename)
}

export async function downloadHistoryImages(items: DownloadableHistoryImage[]): Promise<DownloadHistoryImagesResult> {
  const downloadable = items.filter((item) => Boolean(item.dataUrl || item.storagePath))
  if (downloadable.length === 0) return { savedCount: 0, canceled: false }

  if (!isTauriRuntime() || downloadable.length === 1) {
    let savedCount = 0
    for (const item of downloadable) {
      try {
        await downloadImageSource(item.dataUrl ?? item.storagePath ?? null, historyDownloadFilename(item), item.storagePath)
        savedCount += 1
      } catch (error) {
        if (error instanceof DownloadCanceledError) {
          return { savedCount, canceled: true }
        }
      }
    }
    return { savedCount, canceled: false }
  }

  const directory = await selectDownloadDirectory()
  if (!directory) return { savedCount: 0, canceled: true }

  let savedCount = 0
  for (const item of downloadable) {
    try {
      await downloadImageSourceToDirectory(item.dataUrl ?? item.storagePath ?? null, historyDownloadFilename(item), item.storagePath, directory)
      savedCount += 1
    } catch {
      // Keep batch downloads moving when one history item is temporarily unavailable.
    }
  }
  if (savedCount > 0) {
    try {
      await openPath(directory)
    } catch {
      // Opening the folder is a convenience; never block the download result on it.
    }
  }
  return { savedCount, canceled: false }
}

export async function downloadImageSourceToDirectory(source: string | null, filename: string, storagePath: string | null | undefined, directory: string): Promise<void> {
  const blob = await resolveDownloadBlob(source, storagePath)
  if (!blob) throw new Error('图片内容不可用，无法下载。')
  if (storagePath && isLocalFilePath(storagePath)) {
    await copyBinaryFile(storagePath, directory, filename)
    return
  }
  if (isTauriRuntime()) {
    await invoke('write_binary_file_in_directory', {
      directory,
      filename,
      bytesBase64: await blobToBase64(blob)
    })
    return
  }
  await downloadBlob(blob, filename)
}

export async function readBinaryFileBase64(path: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('读取图片文件只能在 Tauri 应用中执行。')
  return invoke<string>('read_binary_file_base64', { path })
}

export async function copyBinaryFile(source: string, directory: string, filename: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('复制图片文件只能在 Tauri 应用中执行。')
  return invoke<string>('copy_binary_file', { source, directory, filename })
}

export async function storeDataUrlFile(namespace: string, filename: string, dataUrl: string): Promise<StoredDataUrlFileResult> {
  if (!isTauriRuntime()) {
    const blob = dataUrlToBlob(dataUrl)
    return {
      path: `browser-memory/${namespace}/${filename}`,
      dataUrl,
      mimeType: blob.type || mimeTypeFromDataUrl(dataUrl),
      fileSizeBytes: blob.size
    }
  }
  const result = await invoke<StoredDataUrlFileResult>('store_data_url_file', { namespace, filename, dataUrl })
  return { ...result, dataUrl: result.path }
}

export function imageSourceFromStoredPath(dataUrl: string | null, storagePath?: string | null): string | null {
  if (!dataUrl) return null
  if (dataUrl.startsWith('data:') || /^https?:\/\//i.test(dataUrl)) return dataUrl
  if (!storagePath && /^[a-z]:[\\/]/i.test(dataUrl)) return null
  return dataUrl
}

export function imageSourceForDisplaySync(dataUrl: string | null, storagePath?: string | null): string | null {
  const cacheKey = imageDisplayCacheKey(dataUrl, storagePath)
  if (cacheKey) {
    const cached = imageSourceCache.get(cacheKey)
    if (cached) return cached
  }
  const localPath = storagePath || (dataUrl ? storagePathFromAssetUrl(dataUrl) || (/^[a-z]:[\\/]/i.test(dataUrl) ? dataUrl : null) : null)
  if (localPath && isTauriRuntime()) {
    try {
      const source = convertFileSrc(localPath)
      if (cacheKey) imageSourceCache.set(cacheKey, source)
      return source
    } catch {
      return null
    }
  }
  if (!dataUrl) return null
  if (dataUrl.startsWith('data:') || /^https?:\/\//i.test(dataUrl)) {
    if (cacheKey) imageSourceCache.set(cacheKey, dataUrl)
    return dataUrl
  }
  return null
}

export async function imageSourceForDisplay(dataUrl: string | null, storagePath?: string | null): Promise<string | null> {
  const syncSource = imageSourceForDisplaySync(dataUrl, storagePath)
  if (syncSource) return syncSource
  const cacheKey = imageDisplayCacheKey(dataUrl, storagePath)
  if (storagePath) {
    const source = await readLocalImageDataUrl(storagePath)
    if (cacheKey) imageSourceCache.set(cacheKey, source)
    return source
  }
  if (!dataUrl) return null
  if (dataUrl.startsWith('data:')) {
    if (cacheKey) imageSourceCache.set(cacheKey, dataUrl)
    return dataUrl
  }
  const path = storagePathFromAssetUrl(dataUrl) || (/^[a-z]:[\\/]/i.test(dataUrl) ? dataUrl : null)
  if (path) {
    const source = await readLocalImageDataUrl(path)
    if (cacheKey) imageSourceCache.set(cacheKey, source)
    return source
  }
  if (cacheKey) imageSourceCache.set(cacheKey, dataUrl)
  return dataUrl
}

function imageDisplayCacheKey(dataUrl: string | null, storagePath?: string | null): string | null {
  return storagePath || dataUrl || null
}

export async function respondCodexBridge(response: CodexBridgeResponse): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('codex_bridge_respond', { response })
}

export async function markCodexBridgeReady(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('codex_bridge_ready')
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) return new Blob([dataUrl], { type: 'text/plain' })
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: match[1] })
}

async function resolveDownloadBlob(source: string | null | undefined, storagePath?: string | null): Promise<Blob | null> {
  if (!source && !storagePath) return null
  if (source?.startsWith('data:')) return dataUrlToBlob(source)

  const localPath = storagePath || (source && isLocalFilePath(source) ? source : null)
  if (localPath && isTauriRuntime()) {
    return dataUrlToBlob(await readLocalImageDataUrl(localPath))
  }

  if (source && /^(?:https?|blob|asset):/i.test(source)) {
    const response = await fetch(source)
    if (!response.ok) throw new Error('图片下载失败。')
    return await response.blob()
  }

  if (source) return dataUrlToBlob(source)
  return null
}

async function readRemoteImageUrlInBrowser(url: string): Promise<ReferenceImageFilePayload> {
  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'image/png,image/jpeg,image/webp' } })
  } catch (error) {
    throw new Error(error instanceof Error ? `图片链接下载失败：${error.message}` : '图片链接下载失败。')
  }
  if (!response.ok) throw new Error(`图片链接下载失败：HTTP ${response.status}。`)

  const contentLength = parseContentLength(response.headers.get('content-length'))
  if (contentLength != null && contentLength > MAX_REMOTE_REFERENCE_IMAGE_BYTES) {
    throw new Error('单张参考图不能超过 20MB。')
  }

  const filename = filenameFromUrl(url, response.headers.get('content-disposition'))
  const mimeType = normalizeRemoteImageMimeType(response.headers.get('content-type'), filename)
  const bytes = await readResponseBytesWithLimit(response)

  return {
    name: ensureImageFilename(filename, mimeType),
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    fileSizeBytes: bytes.byteLength
  }
}

function normalizeRemoteImageUrl(value: string): string {
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('请输入有效的 HTTP/HTTPS 图片链接。')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 HTTP/HTTPS 图片链接。')
  }
  return parsed.toString()
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeRemoteImageMimeType(contentType: string | null, filename: string): string {
  const headerMimeType = contentType?.split(';')[0]?.trim().toLowerCase() || ''
  const supportedHeaderMimeType = supportedReferenceMimeType(headerMimeType)
  if (supportedHeaderMimeType) return supportedHeaderMimeType
  if (headerMimeType && headerMimeType !== 'application/octet-stream' && headerMimeType !== 'binary/octet-stream') {
    throw new Error('仅支持 PNG、JPG、WEBP 参考图。')
  }
  const filenameMimeType = mimeTypeFromFilename(filename)
  if (filenameMimeType) return filenameMimeType
  throw new Error('仅支持 PNG、JPG、WEBP 参考图。')
}

function supportedReferenceMimeType(value: string): string | null {
  if (value === 'image/png') return 'image/png'
  if (value === 'image/jpeg' || value === 'image/jpg') return 'image/jpeg'
  if (value === 'image/webp') return 'image/webp'
  return null
}

function mimeTypeFromFilename(filename: string): string | null {
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(filename)?.[1]?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  return null
}

async function readResponseBytesWithLimit(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_REMOTE_REFERENCE_IMAGE_BYTES) throw new Error('单张参考图不能超过 20MB。')
    return new Uint8Array(buffer)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (total + value.byteLength > MAX_REMOTE_REFERENCE_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('单张参考图不能超过 20MB。')
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  return concatResponseBytes(chunks, total)
}

function concatResponseBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function filenameFromUrl(url: string, contentDisposition: string | null): string {
  const dispositionFilename = filenameFromContentDisposition(contentDisposition)
  if (dispositionFilename) return dispositionFilename
  const rawName = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
  try {
    return decodeURIComponent(rawName) || 'reference.png'
  } catch {
    return rawName || 'reference.png'
  }
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ''))
    } catch {
      return encoded.trim().replace(/^"|"$/g, '')
    }
  }
  return /filename="?([^";]+)"?/i.exec(value)?.[1]?.trim() || null
}

function ensureImageFilename(filename: string, mimeType: string): string {
  if (mimeTypeFromFilename(filename)) return filename
  const stem = filename.replace(/\.[a-z0-9]+$/i, '') || 'reference'
  return `${stem}.${extensionFromMimeType(mimeType)}`
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (typeof document === 'undefined') throw new Error('下载只能在浏览器环境中执行。')
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.rel = 'noreferrer'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error || new Error('图片编码失败。'))
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('图片编码失败。'))
          return
        }
        resolve(reader.result)
      }
      reader.readAsDataURL(blob)
    })
    return dataUrl.split(',')[1] || ''
  }

  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary)
}

async function selectDownloadDirectory(): Promise<string | null> {
  const defaultPath = await safeDownloadDir()
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择批量下载文件夹',
    defaultPath: defaultPath || undefined
  })
  return typeof selected === 'string' ? selected : null
}

async function safeDownloadDir(): Promise<string | null> {
  try {
    return await downloadDir()
  } catch {
    return null
  }
}

function historyDownloadFilename(item: DownloadableHistoryImage): string {
  return `${item.id}.${extensionFromSource(item.dataUrl || item.storagePath || '')}`
}

function extensionFromSource(source: string): string {
  if (!source.startsWith('data:')) {
    const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(source)?.[1]?.toLowerCase()
    return extension === 'jpg' || extension === 'jpeg' || extension === 'webp' ? extension : 'png'
  }
  const mimeType = /^data:([^;]+);base64,/i.exec(source)?.[1] || ''
  if (mimeType.includes('jpeg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  return 'png'
}

export class DownloadCanceledError extends Error {
  constructor() {
    super('已取消下载')
    this.name = 'DownloadCanceledError'
  }
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  return /^data:([^;]+);base64,/i.exec(dataUrl)?.[1] || 'image/png'
}

function storagePathFromAssetUrl(value: string): string | null {
  const encoded = /^https?:\/\/asset\.localhost\/(.+)$/i.exec(value)?.[1]
  return encoded ? decodeURIComponent(encoded) : null
}

function isLocalFilePath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\')
}

export async function getCodexSkillStatus(name: string): Promise<CodexSkillStatus> {
  if (!isTauriRuntime()) {
    return {
      name,
      installed: false,
      path: 'browser-memory',
      skillMdPath: 'browser-memory/SKILL.md'
    }
  }
  return invoke<CodexSkillStatus>('codex_skill_status', { name })
}

export async function installCodexSkill(request: CodexSkillInstallRequest): Promise<CodexSkillStatus> {
  if (!isTauriRuntime()) throw new Error('Codex Skill 只能在 Tauri 应用中安装。')
  return invoke<CodexSkillStatus>('install_codex_skill', { request })
}

export function __resetPlatformStateForTests(): void {
  memoryStorage.clear()
  memorySecrets.clear()
  imageSourceCache.clear()
  mockNotificationPermission = null
  notificationLog.length = 0
  globalThis.localStorage?.clear()
}

export function __setNotificationPermissionForTests(permission: NotificationPermission | 'unsupported' | null): void {
  mockNotificationPermission = permission
}

export function __getSentNotificationsForTests(): Array<{ title: string; body?: string }> {
  return [...notificationLog]
}

export class PlatformHttpProxyError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown>
  ) {
    super(message)
    this.name = 'PlatformHttpProxyError'
  }

  static fromInvokeError(endpoint: string, method: string, error: unknown): PlatformHttpProxyError {
    const diagnostics = parsePlatformError(error)
    const stage = typeof diagnostics.stage === 'string' ? diagnostics.stage : 'transport'
    const message = typeof diagnostics.message === 'string' && diagnostics.message.trim()
      ? diagnostics.message
      : error instanceof Error
        ? error.message
        : String(error || '平台代理请求失败。')
    return new PlatformHttpProxyError(message, {
      endpoint,
      method,
      stage,
      diagnostics
    })
  }
}

type PlatformStreamEvent = {
  streamId: string
  kind: 'chunk' | 'done' | 'error'
  status?: number
  statusText?: string
  chunkBase64?: string
  error?: string
}

function parsePlatformError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  }
  if (typeof error !== 'string') return { value: String(error) }
  try {
    const parsed = JSON.parse(error)
    return isRecord(parsed) ? parsed : { value: error }
  } catch {
    return { message: error, stage: inferPlainPlatformErrorStage(error) }
  }
}

function decodeUtf8Chunks(chunks: Uint8Array[], decoder: TextDecoder): string {
  let text = ''
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true })
  }
  text += decoder.decode()
  return text
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function buildHttpProxyRequestPayload(url: string, init: RequestInit): Promise<HttpProxyRequestPayload> {
  const method = init.method || 'GET'
  const headers = new Headers(init.headers)
  const body = init.body
  if (body == null) {
    return {
      url,
      method,
      headers: Object.fromEntries(headers.entries())
    }
  }
  if (typeof body === 'string') {
    return {
      url,
      method,
      headers: Object.fromEntries(headers.entries()),
      body
    }
  }
  if (body instanceof FormData) {
    const multipart = await encodeMultipartFormData(body)
    headers.set('Content-Type', `multipart/form-data; boundary=${multipart.boundary}`)
    return {
      url,
      method,
      headers: Object.fromEntries(headers.entries()),
      bodyBase64: bytesToBase64(multipart.body)
    }
  }
  const request = new Request(url, {
    method,
    headers,
    body: body as BodyInit
  })
  const bodyBase64 = bytesToBase64(new Uint8Array(await request.arrayBuffer()))
  return {
    url,
    method,
    headers: Object.fromEntries(request.headers.entries()),
    bodyBase64
  }
}

async function encodeMultipartFormData(form: FormData): Promise<{ boundary: string; body: Uint8Array }> {
  const boundary = `----PixAIFormBoundary${globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now()}${Math.random().toString(16).slice(2)}`}`
  const chunks: Uint8Array[] = []
  const encoder = new TextEncoder()
  for (const [name, value] of form.entries()) {
    chunks.push(encoder.encode(`--${boundary}\r\n`))
    if (value instanceof File) {
      chunks.push(encoder.encode(
        `Content-Disposition: form-data; name="${escapeMultipartName(name)}"; filename="${escapeMultipartName(value.name || 'file')}"\r\n` +
        `Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`
      ))
      chunks.push(await blobToBytes(value))
      chunks.push(encoder.encode('\r\n'))
    } else {
      chunks.push(encoder.encode(
        `Content-Disposition: form-data; name="${escapeMultipartName(name)}"\r\n\r\n` +
        `${String(value)}\r\n`
      ))
    }
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`))
  return { boundary, body: concatBytes(chunks) }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function escapeMultipartName(value: string): string {
  return value.replace(/[\r\n"]/g, '_')
}

function blobToBytes(value: Blob): Promise<Uint8Array> {
  if (typeof value.arrayBuffer === 'function') {
    return value.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error || new Error('Unable to read multipart file.'))
    reader.readAsArrayBuffer(value)
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function inferPlainPlatformErrorStage(message: string): string {
  if (message.startsWith('接口地址无效') || message.startsWith('仅支持 HTTP/HTTPS') || message.startsWith('请求方法无效')) {
    return 'configuration'
  }
  return 'transport'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
