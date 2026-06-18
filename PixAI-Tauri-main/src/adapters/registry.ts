import type { ProviderType } from '../shared/types'
import { openAiCompatibleAdapter } from './openai-compatible'
import type { ProviderAdapter } from './types'

const adapters = new Map<ProviderType, ProviderAdapter>([[openAiCompatibleAdapter.type, openAiCompatibleAdapter]])

export function getAdapter(type: ProviderType): ProviderAdapter {
  const adapter = adapters.get(type)
  if (!adapter) throw new Error(`服务适配器未注册：${type}`)
  return adapter
}

export function listAdapters(): ProviderAdapter[] {
  return Array.from(adapters.values())
}
