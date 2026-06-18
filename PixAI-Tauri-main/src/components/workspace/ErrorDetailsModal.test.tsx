import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { ImageHistoryItem } from '../../shared/types'
import { ErrorDetailsModal } from './ErrorDetailsModal'

function failedItem(): ImageHistoryItem {
  return {
    id: 'history-error-test',
    conversationId: 'conversation-error-test',
    runId: 'run-error-test',
    prompt: 'test prompt',
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'high',
    requestIndex: 0,
    durationMs: 123,
    dataUrl: null,
    fileSizeBytes: null,
    status: 'failed',
    errorMessage: '图片接口没有返回图片。',
    errorDetails: JSON.stringify({ stage: 'request-failed', details: { responseBody: '{}' } }),
    retryAttempt: 0,
    favorite: false,
    generationMode: 'text-to-image',
    referenceImages: [],
    createdAt: '2026-05-22T14:14:51.341Z'
  }
}

describe('ErrorDetailsModal', () => {
  async function renderFailedTileHarness() {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    function FailedTileHarness() {
      const [open, setOpen] = useState(true)
      return (
        <article onClick={() => setOpen(true)}>
          {open ? <ErrorDetailsModal item={failedItem()} onClose={() => setOpen(false)} /> : null}
        </article>
      )
    }

    await act(async () => {
      root.render(<FailedTileHarness />)
    })
    return { host, root }
  }

  it('does not bubble close clicks back to the failed tile opener', async () => {
    const { host, root } = await renderFailedTileHarness()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="关闭"]')?.click()
    })

    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('does not bubble backdrop closes back to the failed tile opener', async () => {
    const { host, root } = await renderFailedTileHarness()

    await act(async () => {
      document.querySelector<HTMLElement>('.error-details-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      document.querySelector<HTMLElement>('.error-details-backdrop')?.click()
    })

    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
