import { describe, expect, it } from 'vitest'
import { getProfileSecret } from '../lib/platform'
import { DEFAULT_PROMPT_MODEL } from '../shared/image-options'
import { ProviderSettingsStore } from './provider-settings'

describe('ProviderSettingsStore', () => {
  it('starts without a default provider so the UI can prompt setup', async () => {
    const store = new ProviderSettingsStore()
    const settings = await store.get()

    expect(settings.profiles).toHaveLength(0)
    expect(settings.selectedImageProfileId).toBe('')
    expect(settings.selectedPromptProfileId).toBe('')
  })

  it('selects the first created profile for each compatible usage', async () => {
    const store = new ProviderSettingsStore()
    const settings = await store.upsertProfile({
      name: 'Local mock',
      baseUrl: 'http://127.0.0.1:37123'
    })
    const profile = settings.profiles[0]

    expect(profile.type).toBe('openai-compatible')
    expect(profile.baseUrl).toBe('http://127.0.0.1:37123')
    expect(profile.imageGenerationEndpoint).toBe('images-api')
    expect(settings.selectedImageProfileId).toBe(profile.id)
    expect(settings.selectedPromptProfileId).toBe(profile.id)
  })

  it('stores API keys through the secret boundary instead of profile metadata', async () => {
    const store = new ProviderSettingsStore()
    const settings = await store.upsertProfile({
      name: 'Local mock',
      baseUrl: 'http://127.0.0.1:37123',
      apiKey: 'sk-123456789'
    })
    const profile = settings.profiles.at(-1)

    expect(profile?.apiKeyStored).toBe(true)
    expect(JSON.stringify(profile)).not.toContain('sk-123456789')
    await expect(getProfileSecret(profile?.id || '')).resolves.toMatchObject({ value: 'sk-123456789' })
  })

  it('preserves an existing API key when editing profile metadata without a new key', async () => {
    const store = new ProviderSettingsStore()
    const settings = await store.upsertProfile({
      name: 'Local mock',
      baseUrl: 'http://127.0.0.1:37123',
      apiKey: 'sk-123456789'
    })
    const profile = settings.profiles.at(-1)

    const updated = await store.upsertProfile({
      id: profile?.id,
      name: 'Renamed mock',
      baseUrl: 'http://127.0.0.1:37124',
      enabledUsages: ['prompt']
    })
    const nextProfile = updated.profiles.find((item) => item.id === profile?.id)

    expect(nextProfile?.name).toBe('Renamed mock')
    expect(nextProfile?.apiKeyStored).toBe(true)
    await expect(getProfileSecret(profile?.id || '')).resolves.toMatchObject({ value: 'sk-123456789' })
  })

  it('migrates the old prompt default model to the current default', async () => {
    const store = new ProviderSettingsStore()
    const settings = await store.upsertProfile({
      name: 'Legacy prompt model',
      defaultPromptModel: 'gpt-4.1-mini'
    })
    const profile = settings.profiles.at(-1)

    expect(profile?.defaultPromptModel).toBe(DEFAULT_PROMPT_MODEL)
    expect(profile?.defaultPromptModel).toBe('gpt-5.4-mini')
  })

  it('stores the selected image generation endpoint per provider profile', async () => {
    const store = new ProviderSettingsStore()
    const settings = await store.upsertProfile({
      name: 'Responses image provider',
      enabledUsages: ['image'],
      imageGenerationEndpoint: 'responses-api'
    })
    const profile = settings.profiles.at(-1)

    expect(profile?.imageGenerationEndpoint).toBe('responses-api')
  })

  it('allows image and prompt selections to differ', async () => {
    const store = new ProviderSettingsStore()
    const imageSettings = await store.upsertProfile({ name: 'Image only', enabledUsages: ['image'] })
    const imageProfile = imageSettings.profiles.at(-1)
    const promptSettings = await store.upsertProfile({ name: 'Prompt only', enabledUsages: ['prompt'] })
    const promptProfile = promptSettings.profiles.at(-1)

    const settings = await store.update({
      selectedImageProfileId: imageProfile?.id,
      selectedPromptProfileId: promptProfile?.id
    })

    expect(settings.selectedImageProfileId).toBe(imageProfile?.id)
    expect(settings.selectedPromptProfileId).toBe(promptProfile?.id)
  })

  it('rejects incompatible profile selections by falling back to matching usages', async () => {
    const store = new ProviderSettingsStore()
    const imageSettings = await store.upsertProfile({ name: 'Image only', enabledUsages: ['image'] })
    const imageProfile = imageSettings.profiles.at(-1)
    const promptSettings = await store.upsertProfile({ name: 'Prompt only', enabledUsages: ['prompt'] })
    const promptProfile = promptSettings.profiles.at(-1)
    await store.update({ selectedImageProfileId: imageProfile?.id, selectedPromptProfileId: promptProfile?.id })

    const settings = await store.update({
      selectedImageProfileId: promptProfile?.id,
      selectedPromptProfileId: imageProfile?.id
    })

    expect(settings.selectedImageProfileId).toBe(imageProfile?.id)
    expect(settings.selectedPromptProfileId).toBe(promptProfile?.id)
  })

  it('falls back to a usage-compatible profile after deleting a selected profile', async () => {
    const store = new ProviderSettingsStore()
    const imageSettings = await store.upsertProfile({ name: 'Image only', enabledUsages: ['image'] })
    const imageProfile = imageSettings.profiles.at(-1)
    const promptSettings = await store.upsertProfile({ name: 'Prompt only', enabledUsages: ['prompt'] })
    const promptProfile = promptSettings.profiles.at(-1)
    await store.update({ selectedImageProfileId: imageProfile?.id, selectedPromptProfileId: promptProfile?.id })

    const settings = await store.deleteProfile(promptProfile?.id || '')

    expect(settings.selectedImageProfileId).toBe(imageProfile?.id)
    expect(settings.selectedPromptProfileId).toBe('')
  })

  it('allows deleting the last provider and returns to setup state', async () => {
    const store = new ProviderSettingsStore()
    const created = await store.upsertProfile({ name: 'Only provider' })
    const profile = created.profiles[0]

    const settings = await store.deleteProfile(profile.id)

    expect(settings.profiles).toHaveLength(0)
    expect(settings.selectedImageProfileId).toBe('')
    expect(settings.selectedPromptProfileId).toBe('')
  })
})
