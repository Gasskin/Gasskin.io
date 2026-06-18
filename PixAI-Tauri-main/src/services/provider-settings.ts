import { getAdapter } from '../adapters/registry'
import type { ProviderRuntimeProfile } from '../adapters/types'
import { createId } from '../lib/ids'
import {
  deleteProfileSecret,
  getProfileSecret,
  readJsonState,
  setProfileSecret,
  writeJsonState
} from '../lib/platform'
import { nowIso } from '../lib/time'
import { DEFAULT_MODEL, DEFAULT_PROMPT_MODEL, trimBaseUrl } from '../shared/image-options'
import type { ConnectionTestResult, ImageGenerationEndpoint, ProviderProfile, ProviderProfileInput, ProviderSettings, ProviderSettingsUpdate, ProviderUsage } from '../shared/types'

const STATE_NAME = 'provider-settings'
const LEGACY_DEFAULT_PROMPT_MODELS = new Set(['gpt-4.1-mini'])

type ProviderSettingsFile = ProviderSettings

export class ProviderSettingsStore {
  private cache: ProviderSettings | null = null

  async get(): Promise<ProviderSettings> {
    if (this.cache) return this.cache
    const payload = await readJsonState(STATE_NAME)
    if (payload) {
      try {
        this.cache = normalizeSettings(JSON.parse(payload) as ProviderSettingsFile)
        return this.cache
      } catch {
        // Fall back to defaults when settings are corrupt.
      }
    }
    this.cache = createDefaultSettings()
    await this.save(this.cache)
    return this.cache
  }

  async update(input: ProviderSettingsUpdate): Promise<ProviderSettings> {
    const current = await this.get()
    const next = normalizeSettings({
      ...current,
      ...input
    }, current)
    await this.save(next)
    return next
  }

  async upsertProfile(input: ProviderProfileInput): Promise<ProviderSettings> {
    const current = await this.get()
    const now = nowIso()
    const existing = input.id ? current.profiles.find((profile) => profile.id === input.id) : null
    const type = input.type || existing?.type || 'openai-compatible'
    const adapter = getAdapter(type)
    const id = existing?.id || input.id || createId('provider')
    let apiKeyStored = existing?.apiKeyStored || false
    let insecureStorage = existing?.insecureStorage || false
    if (input.apiKey !== undefined) {
      const key = input.apiKey?.trim() || ''
      if (key) {
        const secretResult = await setProfileSecret(id, key)
        apiKeyStored = true
        insecureStorage = secretResult.insecureStorage
      } else {
        await deleteProfileSecret(id)
        apiKeyStored = false
        insecureStorage = false
      }
    }

    const profile: ProviderProfile = {
      id,
      name: input.name?.trim() || existing?.name || 'OpenAI 兼容接口',
      type,
      baseUrl: trimBaseUrl(input.baseUrl || existing?.baseUrl || 'https://api.openai.com'),
      defaultImageModel: input.defaultImageModel?.trim() || existing?.defaultImageModel || DEFAULT_MODEL,
      defaultPromptModel: normalizePromptModel(input.defaultPromptModel?.trim() || existing?.defaultPromptModel),
      imageGenerationEndpoint: normalizeImageGenerationEndpoint(input.imageGenerationEndpoint || existing?.imageGenerationEndpoint),
      enabledUsages: input.enabledUsages || existing?.enabledUsages || ['image', 'prompt'],
      capabilities: input.capabilities || existing?.capabilities || adapter.capabilities,
      apiKeyStored,
      insecureStorage,
      lastTest: existing?.lastTest,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }

    const profiles = existing
      ? current.profiles.map((item) => (item.id === existing.id ? profile : item))
      : [...current.profiles, profile]
    const next = normalizeSettings({
      profiles,
      selectedImageProfileId: current.selectedImageProfileId || profile.id,
      selectedPromptProfileId: current.selectedPromptProfileId || profile.id
    })
    await this.save(next)
    return next
  }

  async deleteProfile(id: string): Promise<ProviderSettings> {
    const current = await this.get()
    const profiles = current.profiles.filter((profile) => profile.id !== id)
    await deleteProfileSecret(id)
    const next = normalizeSettings({
      profiles,
      selectedImageProfileId: current.selectedImageProfileId === id ? '' : current.selectedImageProfileId,
      selectedPromptProfileId: current.selectedPromptProfileId === id ? '' : current.selectedPromptProfileId
    })
    await this.save(next)
    return next
  }

  async getRuntimeProfile(profileId: string): Promise<ProviderRuntimeProfile> {
    const settings = await this.get()
    if (!settings.profiles.length) throw new Error('请先添加 Provider。')
    const profile = settings.profiles.find((item) => item.id === profileId)
    if (!profile) throw new Error('请先选择可用的 Provider。')
    const secret = await getProfileSecret(profile.id)
    if (profile.insecureStorage !== secret.insecureStorage && profile.apiKeyStored) {
      await this.upsertProfile({
        ...profile,
        apiKey: undefined
      })
    }
    return { ...profile, apiKey: secret.value }
  }

  async testProfile(id: string): Promise<ProviderSettings> {
    const runtimeProfile = await this.getRuntimeProfile(id)
    const adapter = getAdapter(runtimeProfile.type)
    const result = await adapter.testConnection(runtimeProfile)
    return this.updateProfileTestResult(id, result)
  }

  async updateProfileTestResult(id: string, lastTest: ConnectionTestResult): Promise<ProviderSettings> {
    const current = await this.get()
    const profiles = current.profiles.map((profile) =>
      profile.id === id ? { ...profile, lastTest, updatedAt: nowIso() } : profile
    )
    const next = normalizeSettings({ ...current, profiles })
    await this.save(next)
    return next
  }

  private async save(settings: ProviderSettings): Promise<void> {
    this.cache = normalizeSettings(settings)
    await writeJsonState(STATE_NAME, JSON.stringify(this.cache, null, 2))
  }
}

function createDefaultSettings(): ProviderSettings {
  return {
    profiles: [],
    selectedImageProfileId: '',
    selectedPromptProfileId: ''
  }
}

function normalizeSettings(settings: ProviderSettings, fallback?: ProviderSettings): ProviderSettings {
  const profiles = (settings.profiles || []).map(normalizeProfile)
  return {
    profiles,
    selectedImageProfileId: selectProfileForUsage(profiles, settings.selectedImageProfileId, 'image', fallback?.selectedImageProfileId),
    selectedPromptProfileId: selectProfileForUsage(profiles, settings.selectedPromptProfileId, 'prompt', fallback?.selectedPromptProfileId)
  }
}

function normalizeProfile(profile: ProviderProfile): ProviderProfile {
  return {
    ...profile,
    imageGenerationEndpoint: normalizeImageGenerationEndpoint(profile.imageGenerationEndpoint),
    defaultPromptModel: normalizePromptModel(profile.defaultPromptModel)
  }
}

function normalizeImageGenerationEndpoint(endpoint?: ImageGenerationEndpoint): ImageGenerationEndpoint {
  return endpoint === 'responses-api' ? 'responses-api' : 'images-api'
}

function normalizePromptModel(model?: string): string {
  const candidate = model?.trim()
  if (!candidate || LEGACY_DEFAULT_PROMPT_MODELS.has(candidate)) return DEFAULT_PROMPT_MODEL
  return candidate
}

function selectProfileForUsage(profiles: ProviderProfile[], selectedId: string | undefined, usage: ProviderUsage, fallbackId?: string): string {
  const selected = profiles.find((profile) => profile.id === selectedId && profile.enabledUsages.includes(usage))
  const fallback = profiles.find((profile) => profile.id === fallbackId && profile.enabledUsages.includes(usage))
  return selected?.id || fallback?.id || profiles.find((profile) => profile.enabledUsages.includes(usage))?.id || ''
}
