import { act, type ChangeEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, ProviderProfile, ProviderSettings } from '../../../shared/types'
import { useAppStore } from '../../../store/app-store'
import { WorkspaceConfigPanel } from './WorkspaceConfigPanel'

vi.mock('../../common/GallerySelect', () => ({
  GallerySelect: ({
    value,
    options,
    ariaLabel,
    disabled,
    onChange
  }: {
    value: string
    options: Array<{ value: string; label: string }>
    ariaLabel: string
    disabled?: boolean
    onChange: (value: string) => void
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))

vi.mock('../SettingsToggleRow', () => ({
  SettingsToggleRow: ({ label }: { label: string }) => <div>{label}</div>
}))

describe('WorkspaceConfigPanel', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeConversationId: 'workspace-config-test',
      conversations: [conversation()],
      settings: providerSettings(),
      upsertProfile: vi.fn().mockResolvedValue(undefined),
      updateSettings: vi.fn().mockResolvedValue(undefined),
      updateActiveConversation: vi.fn().mockResolvedValue(undefined)
    })
  })

  it('saves the image generation endpoint from the workspace engine card', async () => {
    const upsertProfile = vi.fn().mockResolvedValue(undefined)
    const updateSettings = vi.fn().mockResolvedValue(undefined)
    const updateActiveConversation = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ upsertProfile, updateSettings, updateActiveConversation })
    const { host, root } = await renderPanel()
    const endpointSelect = document.querySelector<HTMLSelectElement>('select[aria-label="生图端点"]')

    expect(endpointSelect?.value).toBe('responses-api')

    await act(async () => {
      setSelectValue(endpointSelect, 'images-api')
    })
    await act(async () => {
      findButtonByText('保存引擎设置')?.click()
      await flushPromises()
    })

    expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 'image-provider',
      defaultImageModel: 'gpt-image-2',
      imageGenerationEndpoint: 'images-api'
    }))
    expect(updateSettings).toHaveBeenCalledWith({
      selectedImageProfileId: 'image-provider',
      selectedPromptProfileId: 'prompt-provider'
    })
    expect(updateActiveConversation).toHaveBeenCalledWith({ model: 'gpt-image-2' })

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})

async function renderPanel() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<WorkspaceConfigPanel onOpenGlobalSettings={vi.fn()} />)
  })
  return { host, root }
}

function conversation(): Conversation {
  return {
    id: 'workspace-config-test',
    title: '测试会话',
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
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z'
  }
}

function providerSettings(): ProviderSettings {
  return {
    profiles: [
      providerProfile({
        id: 'image-provider',
        name: 'AIO',
        defaultImageModel: 'gpt-image-2',
        defaultPromptModel: 'gpt-5.4-mini',
        imageGenerationEndpoint: 'responses-api',
        enabledUsages: ['image']
      }),
      providerProfile({
        id: 'prompt-provider',
        name: 'AIO Prompt',
        defaultImageModel: 'gpt-image-2',
        defaultPromptModel: 'gpt-5.4-mini',
        imageGenerationEndpoint: 'images-api',
        enabledUsages: ['prompt']
      })
    ],
    selectedImageProfileId: 'image-provider',
    selectedPromptProfileId: 'prompt-provider'
  }
}

function providerProfile(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'provider',
    name: 'Provider',
    type: 'openai-compatible',
    baseUrl: 'https://example.com',
    defaultImageModel: 'gpt-image-2',
    defaultPromptModel: 'gpt-5.4-mini',
    imageGenerationEndpoint: 'images-api',
    enabledUsages: ['image', 'prompt'],
    capabilities: ['text-to-image', 'image-to-image', 'prompt-assist', 'connection-test'],
    apiKeyStored: true,
    insecureStorage: false,
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    ...overrides
  }
}

function setSelectValue(select: HTMLSelectElement | null | undefined, value: string): void {
  if (!select) return
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
}

function findButtonByText(text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.includes(text)) || null
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
