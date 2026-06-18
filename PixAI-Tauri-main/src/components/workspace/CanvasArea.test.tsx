import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationRun, ImageHistoryItem } from '../../shared/types'
import { useAppStore } from '../../store/app-store'
import { CanvasArea } from './CanvasArea'

function failedHistoryItem(id: string, requestIndex: number): ImageHistoryItem {
  return {
    id,
    conversationId: 'canvas-confirm-conversation',
    runId: 'canvas-confirm-run',
    prompt: `失败图片 ${id}`,
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'high',
    requestIndex,
    durationMs: 500,
    dataUrl: '',
    fileSizeBytes: 0,
    status: 'failed',
    errorMessage: '生成失败',
    errorDetails: null,
    retryAttempt: 0,
    favorite: false,
    generationMode: 'text-to-image',
    referenceImages: [],
    createdAt: '2026-06-02T10:00:00.000Z'
  }
}

function failedRun(): GenerationRun {
  return {
    id: 'canvas-confirm-run',
    conversationId: 'canvas-confirm-conversation',
    prompt: '失败记录',
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'high',
    n: 2,
    maxRetries: 0,
    generationMode: 'text-to-image',
    status: 'failed',
    errorMessage: '生成失败',
    errorDetails: null,
    durationMs: 500,
    retryAttempts: {},
    retryFailures: {},
    referenceImages: [],
    createdAt: '2026-06-02T10:00:00.000Z',
    items: [failedHistoryItem('history-failed-1', 0), failedHistoryItem('history-failed-2', 1)]
  }
}

describe('CanvasArea destructive actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAppStore.setState({
      activeConversationId: 'canvas-confirm-conversation',
      generatingByConversation: {},
      removedGenerationIndexesByRunId: {},
      deleteHistoryItems: vi.fn().mockResolvedValue(undefined),
      refreshConversationResults: vi.fn().mockResolvedValue(undefined)
    })
  })

  it('asks before clearing failed workspace records', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deleteHistoryItems = useAppStore.getState().deleteHistoryItems
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<CanvasArea runs={[failedRun()]} generationStartedAt={null} generating={false} generationClockMs={Date.now()} />)
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.clear-failed-button')?.click()
    })

    expect(confirm).toHaveBeenCalledWith('确认清空当前工作区的 2 条失败记录？')
    expect(deleteHistoryItems).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.clear-failed-button')?.click()
    })

    expect(deleteHistoryItems).toHaveBeenCalledWith(['history-failed-1', 'history-failed-2'])

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
