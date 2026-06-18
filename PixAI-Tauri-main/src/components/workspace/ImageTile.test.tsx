import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageHistoryItem } from '../../shared/types'
import { useAppStore } from '../../store/app-store'
import { ImageTile } from './ImageTile'

function succeededItem(overrides: Partial<ImageHistoryItem> = {}): ImageHistoryItem {
  return {
    id: 'history-preview-test',
    conversationId: 'conversation-preview-test',
    runId: 'run-preview-test',
    prompt: '一位身穿银白色未来感长袍的年轻女性',
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'high',
    requestIndex: 0,
    durationMs: 214000,
    dataUrl: 'data:image/png;base64,aGVsbG8=',
    fileSizeBytes: 5,
    status: 'succeeded',
    errorMessage: null,
    errorDetails: null,
    retryAttempt: 0,
    favorite: false,
    generationMode: 'text-to-image',
    referenceImages: [],
    createdAt: '2026-05-22T14:14:51.341Z',
    ...overrides
  }
}

describe('ImageTile', () => {
  const originalDeleteHistory = useAppStore.getState().deleteHistory
  const originalRetryHistory = useAppStore.getState().retryHistory
  const originalAddHistoryAsReference = useAppStore.getState().addHistoryAsReference

  beforeEach(() => {
    vi.restoreAllMocks()
    useAppStore.setState({
      deleteHistory: originalDeleteHistory,
      retryHistory: originalRetryHistory,
      addHistoryAsReference: originalAddHistoryAsReference
    })
  })

  async function renderTile() {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<ImageTile item={succeededItem()} />)
    })
    return { host, root }
  }

  async function renderTileForItem(item: ImageHistoryItem) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<ImageTile item={item} />)
    })
    return { host, root }
  }

  async function renderTileWithCallLog() {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<ImageTile item={succeededItem({
        callLog: {
          provider: {
            id: 'profile-1',
            name: 'OpenAI',
            type: 'openai-compatible',
            baseUrl: 'https://api.openai.com',
            imageGenerationEndpoint: 'responses-api'
          },
          endpoint: 'https://api.openai.com/v1/responses',
          method: 'POST',
          transport: 'streaming-json',
          request: {
            headers: {
              Authorization: 'Bearer ***',
              'Content-Type': 'application/json'
            },
            body: {
              model: 'gpt-5.4-mini',
              tools: [{ type: 'image_generation', action: 'edit', model: 'gpt-image-2' }]
            }
          },
          createdAt: '2026-05-29T12:00:00.000Z'
        }
      })} />)
    })
    return { host, root }
  }

  it('opens a large image preview from the generated image', async () => {
    const { host, root } = await renderTile()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="查看大图"]')?.click()
    })

    expect(document.querySelector('[aria-label="图片预览"]')).not.toBeNull()
    expect(document.querySelector<HTMLImageElement>('.image-preview-stage img')?.src).toContain('data:image/png;base64,aGVsbG8=')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('closes the large image preview without reopening it', async () => {
    const { host, root } = await renderTile()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="查看大图"]')?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.image-preview-panel button[title="关闭"]')?.click()
    })

    expect(document.querySelector('[aria-label="图片预览"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('opens the generation call log from the tile actions', async () => {
    const { host, root } = await renderTileWithCallLog()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="查看调用日志"]')?.click()
    })

    expect(document.querySelector('[aria-label="调用日志"]')).not.toBeNull()
    expect(document.body.textContent).toContain('https://api.openai.com/v1/responses')
    expect(document.body.textContent).toContain('Bearer ***')
    expect(document.body.textContent).toContain('action')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('asks before deleting a generated image', async () => {
    const deleteHistory = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ deleteHistory })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { host, root } = await renderTile()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="删除"]')?.click()
    })

    expect(confirm).toHaveBeenCalledWith('确认删除这张图片记录？')
    expect(deleteHistory).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="删除"]')?.click()
    })

    expect(deleteHistory).toHaveBeenCalledWith('history-preview-test')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('asks before deleting a failed image record', async () => {
    const deleteHistory = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ deleteHistory })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { host, root } = await renderTileForItem(succeededItem({
      id: 'history-failed-delete-test',
      status: 'failed',
      errorMessage: '上游接口失败',
      dataUrl: '',
      fileSizeBytes: 0
    }))

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="删除"]')?.click()
    })

    expect(confirm).toHaveBeenCalledWith('确认删除这张图片记录？')
    expect(deleteHistory).toHaveBeenCalledWith('history-failed-delete-test')
    expect(document.querySelector('[aria-label="生成失败"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('retries a failed image record from the failed tile actions', async () => {
    const retryHistory = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ retryHistory })
    const { host, root } = await renderTileForItem(succeededItem({
      id: 'history-failed-retry-test',
      status: 'failed',
      errorMessage: '图片请求失败，HTTP 状态码 502。',
      dataUrl: '',
      fileSizeBytes: 0,
      retryAttempt: 2
    }))

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="重试"]')?.click()
    })

    expect(retryHistory).toHaveBeenCalledWith('history-failed-retry-test')
    expect(document.body.textContent).toContain('重试第 2 次')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
