import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, ProviderProfile } from '../../../shared/types'
import { useAppStore } from '../../../store/app-store'
import { ServicesSettingsTab } from './ServicesSettingsTab'

function conversation(): Conversation {
  return {
    id: 'services-confirm-conversation',
    title: '服务设置确认测试',
    draftPrompt: '',
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'high',
    n: 1,
    outputFormat: 'png',
    outputCompression: null,
    background: 'auto',
    moderation: 'auto',
    stream: false,
    partialImages: null,
    inputFidelity: null,
    maxRetries: 0,
    generationTimeoutSeconds: 600,
    autoSaveHistory: true,
    keepFailureDetails: true,
    referenceImages: [],
    createdAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z'
  }
}

function provider(): ProviderProfile {
  return {
    id: 'provider-confirm-delete',
    name: '确认删除 Provider',
    type: 'openai-compatible',
    baseUrl: 'https://example.com',
    defaultImageModel: 'gpt-image-2',
    defaultPromptModel: 'gpt-4.1',
    imageGenerationEndpoint: 'images-api',
    enabledUsages: ['image', 'prompt'],
    capabilities: ['text-to-image', 'image-to-image', 'prompt-assist', 'connection-test'],
    apiKeyStored: true,
    insecureStorage: false,
    createdAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z'
  }
}

describe('ServicesSettingsTab destructive actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    const profile = provider()
    useAppStore.setState({
      activeConversationId: 'services-confirm-conversation',
      conversations: [conversation()],
      settings: {
        profiles: [profile],
        selectedImageProfileId: profile.id,
        selectedPromptProfileId: profile.id
      },
      updateActiveConversation: vi.fn().mockResolvedValue(undefined),
      updateSettings: vi.fn().mockResolvedValue(undefined),
      upsertProfile: vi.fn().mockResolvedValue(undefined),
      deleteProfile: vi.fn().mockResolvedValue(undefined)
    })
  })

  it('asks before deleting a provider profile', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deleteProfile = useAppStore.getState().deleteProfile
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<ServicesSettingsTab />)
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="编辑 Provider"]')?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.provider-modal .danger-button')?.click()
    })

    expect(confirm).toHaveBeenCalledWith('删除此服务配置？')
    expect(deleteProfile).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.provider-modal .danger-button')?.click()
    })

    expect(deleteProfile).toHaveBeenCalledWith('provider-confirm-delete')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
