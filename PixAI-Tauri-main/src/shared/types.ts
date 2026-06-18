export type ImageRatio = '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9' | '9:21'
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high'
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'
export type ImageBackground = 'auto' | 'opaque'
export type ImageModeration = 'auto' | 'low'
export type ImageInputFidelity = 'low' | 'high'
export type ImageStatus = 'succeeded' | 'failed'
export type GenerationRunStatus = 'running' | ImageStatus
export type GenerationMode = 'text-to-image' | 'image-to-image'
export type ProviderType = 'openai-compatible'
export type ProviderUsage = 'image' | 'prompt'
export type ImageGenerationEndpoint = 'images-api' | 'responses-api'
export type AdapterCapability =
  | 'text-to-image'
  | 'image-to-image'
  | 'prompt-assist'
  | 'connection-test'
  | 'streaming'
  | 'input-fidelity'

export type ReferenceImage = {
  id: string
  name: string
  mimeType: string
  dataUrl: string
  fileSizeBytes: number
  storagePath?: string | null
  createdAt: string
}

export type ProviderProfile = {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  defaultImageModel: string
  defaultPromptModel: string
  imageGenerationEndpoint: ImageGenerationEndpoint
  enabledUsages: ProviderUsage[]
  capabilities: AdapterCapability[]
  apiKeyStored: boolean
  insecureStorage: boolean
  lastTest?: ConnectionTestResult
  createdAt: string
  updatedAt: string
}

export type ProviderProfileInput = Partial<
  Pick<
    ProviderProfile,
    | 'id'
    | 'name'
    | 'type'
    | 'baseUrl'
    | 'defaultImageModel'
    | 'defaultPromptModel'
    | 'imageGenerationEndpoint'
    | 'enabledUsages'
    | 'capabilities'
  >
> & {
  apiKey?: string | null
}

export type ProviderSettings = {
  profiles: ProviderProfile[]
  selectedImageProfileId: string
  selectedPromptProfileId: string
}

export type ProviderSettingsUpdate = Partial<
  Pick<ProviderSettings, 'selectedImageProfileId' | 'selectedPromptProfileId'>
>

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export type AppPreferences = {
  notifyOnImageSuccess: boolean
  closeToTray: boolean
  notificationPermission: NotificationPermissionState
}

export type AppPreferencesUpdate = Partial<AppPreferences>

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export type AppVersionInfo = {
  version: string
  platform: 'desktop' | 'browser'
  runtime: 'tauri' | 'browser'
  os?: 'windows' | 'macos' | 'linux' | 'unknown'
  arch?: 'x86_64' | 'aarch64' | 'i686' | 'armv7' | 'unknown'
  installerType?: 'msi' | 'nsis' | 'unknown'
}

export type AvailableAppUpdate = {
  version: string
  date: string | null
  notes: string | null
  rawJson: Record<string, unknown>
  installMode?: 'tauri' | 'github'
  releaseUrl?: string | null
  downloadUrl?: string | null
}

export type AppUpdateCheckResult = {
  currentVersion: string
  update: AvailableAppUpdate | null
}

export type AppUpdateInstallResult = {
  action: 'installed' | 'openedDownload'
}

export type AppUpdateState = {
  status: AppUpdateStatus
  currentVersion: string
  platform: AppVersionInfo['platform']
  runtime: AppVersionInfo['runtime']
  availableUpdate: AvailableAppUpdate | null
  lastCheckedAt: string | null
  errorMessage: string | null
  downloadedBytes: number | null
  contentLength: number | null
}

export type LegacyProviderSettingsUpdate = ProviderSettingsUpdate & {
  baseURL?: string
  baseUrl?: string
  apiKey?: string | null
  defaultModel?: string
  promptModel?: string
  imageGenerationEndpoint?: ImageGenerationEndpoint
}

export type ConnectionTestResult = {
  ok: boolean
  checkedAt: string
  endpoint: string
  message: string
  status?: number
  latencyMs?: number
}

export type ImageGenerationCallLog = {
  provider: {
    id: string
    name: string
    type: ProviderType
    baseUrl: string
    imageGenerationEndpoint: ImageGenerationEndpoint
  }
  endpoint: string
  method: 'POST'
  transport: 'json' | 'multipart' | 'streaming-json' | 'streaming-multipart'
  request: {
    headers: Record<string, string>
    body: unknown
  }
  createdAt: string
}

export type GenerateImageInput = {
  conversationId: string
  prompt: string
  model?: string
  ratio: ImageRatio
  size: string
  quality: ImageQuality
  n: number
  outputFormat?: ImageOutputFormat
  outputCompression?: number
  background?: ImageBackground
  moderation?: ImageModeration
  stream?: boolean
  partialImages?: number
  inputFidelity?: ImageInputFidelity
  referenceImageIds?: string[]
  maxRetries?: number
  generationTimeoutSeconds?: number
}

export type PromptAssistInput = {
  prompt?: string
  hasReferenceImages?: boolean
}

export type ReferenceImageFilePayload = {
  name: string
  mimeType: string
  dataUrl: string
  fileSizeBytes: number
}

export type Conversation = {
  id: string
  title: string
  draftPrompt: string
  model: string
  ratio: ImageRatio
  size: string
  quality: ImageQuality
  n: number
  outputFormat: ImageOutputFormat
  outputCompression: number | null
  background: ImageBackground
  moderation: ImageModeration
  stream: boolean
  partialImages: number | null
  inputFidelity: ImageInputFidelity | null
  maxRetries: number
  generationTimeoutSeconds: number
  autoSaveHistory: boolean
  keepFailureDetails: boolean
  referenceImages: ReferenceImage[]
  createdAt: string
  updatedAt: string
}

export type ConversationUpdate = Partial<
  Pick<
    Conversation,
    | 'title'
    | 'draftPrompt'
    | 'model'
    | 'ratio'
    | 'size'
    | 'quality'
    | 'n'
    | 'outputFormat'
    | 'outputCompression'
    | 'background'
    | 'moderation'
    | 'stream'
    | 'partialImages'
    | 'inputFidelity'
    | 'maxRetries'
    | 'generationTimeoutSeconds'
    | 'autoSaveHistory'
    | 'keepFailureDetails'
    | 'referenceImages'
  >
>

export type ConversationCreateInput = Partial<ConversationUpdate>

export type ImageHistoryItem = {
  id: string
  conversationId: string | null
  runId: string | null
  prompt: string
  model: string
  ratio: ImageRatio
  size: string | null
  quality: ImageQuality
  requestIndex: number | null
  durationMs: number | null
  dataUrl: string | null
  fileSizeBytes: number | null
  storagePath?: string | null
  status: ImageStatus
  errorMessage: string | null
  errorDetails: string | null
  retryAttempt: number
  favorite: boolean
  globalVisible?: boolean
  generationMode: GenerationMode
  referenceImages: ReferenceImage[]
  callLog?: ImageGenerationCallLog | null
  createdAt: string
}

export type GenerationRunRetryFailure = {
  errorMessage: string
  errorDetails: string
  createdAt: string
}

export type GenerationRun = {
  id: string
  conversationId: string
  prompt: string
  model: string
  ratio: ImageRatio
  size: string | null
  quality: ImageQuality
  n: number
  status: GenerationRunStatus
  durationMs: number | null
  errorMessage: string | null
  errorDetails: string | null
  maxRetries: number
  retryAttempts: Record<number, number>
  retryFailures: Record<number, GenerationRunRetryFailure>
  generationMode: GenerationMode
  referenceImages: ReferenceImage[]
  createdAt: string
  items: ImageHistoryItem[]
}

export type GenerateImageResult = {
  run: GenerationRun
  items: ImageHistoryItem[]
  errorMessage?: string
  errorDetails?: string
  canceled?: boolean
}

export type HistoryListOptions = {
  query?: string
  sort?: 'newest' | 'oldest'
  favoritesOnly?: boolean
  status?: ImageStatus | 'all'
  model?: string
  ratio?: ImageRatio | 'all'
  quality?: ImageQuality | 'all'
}

export type PromptTemplate = {
  id: string
  title: string
  category: string
  prompt: string
  ratio: ImageRatio
  quality: ImageQuality
  createdAt: string
  updatedAt: string
}

export type PromptTemplateInput = Partial<Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>>

export type ImageApiData = {
  b64_json?: string
  url?: string
}

export type CodexBridgeChangeType = 'settings' | 'conversation' | 'history' | 'generation' | 'prompt'

export type CodexBridgeRequest = {
  id: string
  method: string
  path: string
  body: string | null
  headers: Record<string, string>
  port: number
}

export type CodexBridgeResponse = {
  requestId: string
  status: number
  headers?: Record<string, string>
  body?: string
  bodyBase64?: string
}

export type CodexSkillFile = {
  relativePath: string
  content: string
}

export type CodexSkillInstallRequest = {
  name: string
  files: CodexSkillFile[]
}

export type CodexSkillStatus = {
  name: string
  installed: boolean
  path: string
  skillMdPath: string
}

export type CodexGenerateImageInput = Partial<Omit<GenerateImageInput, 'conversationId' | 'referenceImageIds'>> & {
  prompt: string
  conversationId?: string
  title?: string
  referenceImageIds?: string[]
  referenceHistoryIds?: string[]
  referenceImagePaths?: string[]
  useConversationReferences?: boolean
  clearReferences?: boolean
}

export type CodexReeditImageInput = Partial<CodexGenerateImageInput> & {
  prompt?: string
}
