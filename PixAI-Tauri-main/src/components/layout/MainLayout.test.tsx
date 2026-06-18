import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MainLayout } from './MainLayout'
import { useAppStore } from '../../store/app-store'

describe('MainLayout', () => {
  beforeEach(() => {
    useAppStore.setState({
      conversations: [
        {
          id: 'layout-update-test',
          title: '测试会话',
          draftPrompt: '',
          model: 'gpt-image-1',
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
          createdAt: '2026-05-24T00:00:00.000Z',
          updatedAt: '2026-05-24T00:00:00.000Z'
        }
      ],
      activeConversationId: 'layout-update-test',
      generatingByConversation: {},
      darkMode: false,
      settingsVisible: true,
      view: 'workspace',
      settings: {
        profiles: [
          {
            id: 'default-openai-compatible',
            name: '默认服务',
            type: 'openai-compatible',
            baseUrl: 'https://example.com',
            defaultImageModel: 'gpt-image-1',
            defaultPromptModel: 'gpt-4.1',
            imageGenerationEndpoint: 'images-api',
            enabledUsages: ['image', 'prompt'],
            capabilities: ['text-to-image', 'prompt-assist', 'connection-test'],
            apiKeyStored: true,
            insecureStorage: false,
            createdAt: '2026-05-24T00:00:00.000Z',
            updatedAt: '2026-05-24T00:00:00.000Z'
          }
        ],
        selectedImageProfileId: 'default-openai-compatible',
        selectedPromptProfileId: 'default-openai-compatible'
      },
      appUpdate: {
        status: 'available',
        currentVersion: '0.0.2',
        platform: 'desktop',
        runtime: 'tauri',
        availableUpdate: {
          version: '0.0.3',
          date: '2026-05-24T00:00:00.000Z',
          notes: '测试更新',
          rawJson: {}
        },
        lastCheckedAt: '2026-05-24T00:00:00.000Z',
        errorMessage: null,
        downloadedBytes: null,
        contentLength: null
      }
    })
  })

  it('shows an update banner in the sidebar and opens general settings when clicked', async () => {
    const onOpenGlobalSettings = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MainLayout onOpenGlobalSettings={onOpenGlobalSettings}>
          <main />
        </MainLayout>
      )
    })

    const banner = document.querySelector<HTMLButtonElement>('.sidebar-update-banner')
    expect(banner?.textContent).toContain('有新版本')
    expect(banner?.textContent).toContain('v0.0.3 可更新')

    await act(async () => {
      banner?.click()
    })

    expect(onOpenGlobalSettings).toHaveBeenCalledWith('general')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('asks before deleting a session from the sidebar', async () => {
    const deleteConversation = vi.fn().mockResolvedValue(undefined)
    const firstConversation = useAppStore.getState().conversations[0]
    useAppStore.setState({
      conversations: [
        firstConversation,
        {
          ...firstConversation,
          id: 'layout-delete-test',
          title: '待删除会话',
          updatedAt: '2026-05-24T00:01:00.000Z'
        }
      ],
      deleteConversation
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MainLayout onOpenGlobalSettings={vi.fn()}>
          <main />
        </MainLayout>
      )
    })

    await act(async () => {
      document.querySelector<HTMLElement>('.session-delete')?.click()
    })

    expect(confirm).toHaveBeenCalledWith('确认删除这个会话？会话下的生成任务会一起删除，历史图片会保留在图库。')
    expect(deleteConversation).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await act(async () => {
      document.querySelector<HTMLElement>('.session-delete')?.click()
    })

    expect(deleteConversation).toHaveBeenCalledWith('layout-update-test')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
