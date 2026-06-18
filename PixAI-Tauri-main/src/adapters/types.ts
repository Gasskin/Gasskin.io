import type {
  AdapterCapability,
  ConnectionTestResult,
  GenerateImageInput,
  ImageGenerationCallLog,
  ImageApiData,
  PromptAssistInput,
  ProviderProfile,
  ProviderType
} from '../shared/types'

export type ProviderRuntimeProfile = ProviderProfile & {
  apiKey: string | null
}

export type ImageGenerationRequest = {
  input: GenerateImageInput
  referenceImages: Array<{ name: string; mimeType: string; dataUrl: string }>
  signal?: AbortSignal
  onCallLog?: (log: ImageGenerationCallLog) => void
}

export interface ProviderAdapter {
  type: ProviderType
  label: string
  capabilities: AdapterCapability[]
  testConnection(profile: ProviderRuntimeProfile, signal?: AbortSignal): Promise<ConnectionTestResult>
  generateImage(profile: ProviderRuntimeProfile, request: ImageGenerationRequest): Promise<ImageApiData[]>
  inspirePrompt(profile: ProviderRuntimeProfile, input?: PromptAssistInput, signal?: AbortSignal): Promise<string>
  enrichPrompt(profile: ProviderRuntimeProfile, input: PromptAssistInput & { prompt: string }, signal?: AbortSignal): Promise<string>
}
