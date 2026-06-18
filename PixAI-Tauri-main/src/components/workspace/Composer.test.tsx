import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as platform from '../../lib/platform'
import type { Conversation } from '../../shared/types'
import { useAppStore } from '../../store/app-store'
import { Composer } from './Composer'

type TauriDropEvent = {
  payload: {
    type: 'drop'
    paths: string[]
    position: { x: number; y: number }
  }
}

type TauriDropHandler = (event: TauriDropEvent) => void

const tauriWindowMock = vi.hoisted(() => {
  const mock = {
    handlers: [] as TauriDropHandler[],
    onDragDropEvent: vi.fn(),
    unlisten: vi.fn()
  }
  return mock
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: tauriWindowMock.onDragDropEvent
  })
}))

const originalImportReferenceFiles = useAppStore.getState().importReferenceFiles
const originalImportReferencePayloads = useAppStore.getState().importReferencePayloads
const originalRemoveReferenceImage = useAppStore.getState().removeReferenceImage

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-prompt-expand-test',
    title: 'Logo prompt',
    draftPrompt: 'A long PixAI logo prompt with product details, reference images, prompt enrichment, gallery management, and local Codex bridge.',
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
    createdAt: '2026-05-23T12:00:00.000Z',
    updatedAt: '2026-05-23T12:00:00.000Z',
    ...overrides
  }
}

describe('Composer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    setTauriRuntime(false)
    tauriWindowMock.handlers = []
    tauriWindowMock.unlisten = vi.fn()
    tauriWindowMock.onDragDropEvent.mockReset()
    tauriWindowMock.onDragDropEvent.mockImplementation(async (handler: TauriDropHandler) => {
      tauriWindowMock.handlers.push(handler)
      return tauriWindowMock.unlisten
    })
    useAppStore.setState({
      activeConversationId: null,
      importReferenceFiles: originalImportReferenceFiles,
      importReferencePayloads: originalImportReferencePayloads,
      removeReferenceImage: originalRemoveReferenceImage,
      toast: null
    })
  })

  async function renderComposer(input = conversation()) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<Composer conversation={input} generating={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    return { host, root }
  }

  it('opens an expanded prompt editor from the composer', async () => {
    const { host, root } = await renderComposer()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="放大查看提示词"]')?.click()
    })

    expect(document.querySelector('[aria-label="提示词放大编辑"]')).not.toBeNull()
    expect(document.querySelector<HTMLTextAreaElement>('.prompt-expand-textarea')?.value).toContain('PixAI logo prompt')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('opens a large preview from a reference image thumbnail', async () => {
    const { host, root } = await renderComposer(
      conversation({
        referenceImages: [
          {
            id: 'reference-preview-test',
            name: 'reference.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,cmVmZXJlbmNl',
            fileSizeBytes: 9,
            createdAt: '2026-05-23T12:01:00.000Z'
          }
        ]
      })
    )

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="查看参考图"]')?.click()
    })

    expect(document.querySelector('[aria-label="参考图预览"]')).not.toBeNull()
    expect(document.querySelector<HTMLImageElement>('.image-preview-stage img')?.src).toContain('data:image/png;base64,cmVmZXJlbmNl')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('keeps reference removal separate from the preview trigger', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { host, root } = await renderComposer(
      conversation({
        referenceImages: [
          {
            id: 'reference-remove-test',
            name: 'remove.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,cmVtb3Zl',
            fileSizeBytes: 6,
            createdAt: '2026-05-23T12:02:00.000Z'
          }
        ]
      })
    )

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="移除参考图"]')?.click()
    })

    expect(document.querySelector('[aria-label="参考图预览"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('asks before removing a reference image', async () => {
    const removeReferenceImage = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ removeReferenceImage })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { host, root } = await renderComposer(
      conversation({
        referenceImages: [
          {
            id: 'reference-confirm-remove-test',
            name: 'remove.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,cmVtb3Zl',
            fileSizeBytes: 6,
            createdAt: '2026-05-23T12:02:00.000Z'
          }
        ]
      })
    )

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="移除参考图"]')?.click()
    })

    expect(confirm).toHaveBeenCalledWith('确认移除这张参考图？')
    expect(removeReferenceImage).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="移除参考图"]')?.click()
    })

    expect(removeReferenceImage).toHaveBeenCalledWith('reference-confirm-remove-test')
    expect(document.querySelector('[aria-label="参考图预览"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('imports pasted images from the prompt textarea as reference images', async () => {
    const importReferenceFiles = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ importReferenceFiles })
    const { host, root } = await renderComposer()
    const file = new File(['reference'], 'pasted.png', { type: 'image/png' })
    const textarea = document.querySelector<HTMLTextAreaElement>('.prompt-textarea')
    let defaultAllowed = true

    await act(async () => {
      defaultAllowed = textarea?.dispatchEvent(pasteEvent(transferWithFiles([file]))) ?? true
    })

    expect(defaultAllowed).toBe(false)
    expect(importReferenceFiles).toHaveBeenCalledWith([file])

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('keeps text paste in the prompt textarea', async () => {
    const importReferenceFiles = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ importReferenceFiles })
    const { host, root } = await renderComposer()
    const textarea = document.querySelector<HTMLTextAreaElement>('.prompt-textarea')
    let defaultAllowed = false

    await act(async () => {
      defaultAllowed = textarea?.dispatchEvent(pasteEvent(transferWithText())) ?? false
    })

    expect(defaultAllowed).toBe(true)
    expect(importReferenceFiles).not.toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('keeps mid-text edits locally stable while prompt persistence is pending', async () => {
    vi.useFakeTimers()
    const updateActiveConversation = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ updateActiveConversation })
    const input = conversation({ draftPrompt: '把 claude 替换成 gpt5.5' })
    const { host, root } = await renderComposer(input)
    const textarea = document.querySelector<HTMLTextAreaElement>('.prompt-textarea')

    await act(async () => {
      setTextareaValue(textarea, '把 claude 替换成 gpt5.5，中间插入')
    })

    expect(textarea?.value).toBe('把 claude 替换成 gpt5.5，中间插入')
    expect(updateActiveConversation).not.toHaveBeenCalled()

    await act(async () => {
      root.render(<Composer conversation={input} generating={false} />)
    })

    expect(document.querySelector<HTMLTextAreaElement>('.prompt-textarea')?.value).toBe('把 claude 替换成 gpt5.5，中间插入')

    await act(async () => {
      vi.advanceTimersByTime(300)
      await flushPromises()
    })

    expect(updateActiveConversation).toHaveBeenCalledWith({ draftPrompt: '把 claude 替换成 gpt5.5，中间插入' })

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('does not persist IME composition intermediate text from the prompt textarea', async () => {
    const updateActiveConversation = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ updateActiveConversation })
    const { host, root } = await renderComposer(conversation({ draftPrompt: '基于参考图重绘' }))
    const textarea = document.querySelector<HTMLTextAreaElement>('.prompt-textarea')

    await act(async () => {
      textarea?.dispatchEvent(compositionEvent('compositionstart'))
      setTextareaValue(textarea, '基于参考图zhong')
      await flushPromises()
    })

    expect(textarea?.value).toBe('基于参考图zhong')
    expect(updateActiveConversation).not.toHaveBeenCalled()

    await act(async () => {
      setTextareaDomValue(textarea, '基于参考图中')
      textarea?.dispatchEvent(compositionEvent('compositionend'))
      await flushPromises()
    })

    expect(updateActiveConversation).toHaveBeenCalledTimes(1)
    expect(updateActiveConversation).toHaveBeenCalledWith({ draftPrompt: '基于参考图中' })
    expect(updateActiveConversation).not.toHaveBeenCalledWith({ draftPrompt: '基于参考图zhong' })

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('imports dropped images from the prompt box as reference images', async () => {
    const importReferenceFiles = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ importReferenceFiles })
    const { host, root } = await renderComposer()
    const files = [
      new File(['one'], 'one.png', { type: 'image/png' }),
      new File(['two'], 'two.webp', { type: 'image/webp' })
    ]
    const promptBox = document.querySelector<HTMLDivElement>('.prompt-box')
    let defaultAllowed = true

    await act(async () => {
      defaultAllowed = promptBox?.dispatchEvent(dropEvent(transferWithFiles(files))) ?? true
    })

    expect(defaultAllowed).toBe(false)
    expect(importReferenceFiles).toHaveBeenCalledTimes(1)
    expect(importReferenceFiles.mock.calls[0]?.[0].map((file: File) => file.name)).toEqual(['one.png', 'two.webp'])

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('uses a safe preview source immediately after a stored local reference is added', async () => {
    setTauriRuntime(true)
    vi.spyOn(platform, 'imageSourceForDisplay').mockImplementation(async (dataUrl, storagePath) => {
      if (!storagePath) return dataUrl
      return `tauri-safe://${storagePath.replace(/\\/g, '/')}`
    })
    vi.spyOn(platform, 'imageSourceForDisplaySync').mockImplementation((dataUrl, storagePath) => {
      if (!storagePath) return dataUrl
      return `tauri-safe://${storagePath.replace(/\\/g, '/')}`
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let source: string | null = null

    await act(async () => {
      flushSync(() => {
        root.render(<Composer conversation={conversation()} generating={false} />)
      })
    })

    await act(async () => {
      flushSync(() => {
        root.render(
          <Composer
            conversation={conversation({
              referenceImages: [
                {
                  id: 'reference-stored-path-test',
                  name: 'stored.png',
                  mimeType: 'image/png',
                  dataUrl: 'C:\\stored\\references\\stored.png',
                  storagePath: 'C:\\stored\\references\\stored.png',
                  fileSizeBytes: 12,
                  createdAt: '2026-06-06T01:30:00.000Z'
                }
              ]
            })}
            generating={false}
          />
        )
      })
      source = host.querySelector<HTMLImageElement>('.reference-thumb img')?.getAttribute('src') || null
    })

    expect(source).toBe('tauri-safe://C:/stored/references/stored.png')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('does not fall back to a raw local reference path when no safe display source is available', async () => {
    const rawPath = 'C:\\stored\\references\\legacy.png'
    setTauriRuntime(true)
    vi.spyOn(platform, 'imageSourceForDisplay').mockResolvedValue(null)
    vi.spyOn(platform, 'imageSourceForDisplaySync').mockReturnValue(null)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      flushSync(() => {
        root.render(
          <Composer
            conversation={conversation({
              referenceImages: [
                {
                  id: 'reference-legacy-path-test',
                  name: 'legacy.png',
                  mimeType: 'image/png',
                  dataUrl: rawPath,
                  storagePath: rawPath,
                  fileSizeBytes: 12,
                  createdAt: '2026-06-06T01:30:00.000Z'
                }
              ]
            })}
            generating={false}
          />
        )
      })
      await flushPromises()
    })

    expect(host.querySelector<HTMLImageElement>('.reference-thumb img')).toBeNull()
    expect(host.innerHTML).not.toContain(rawPath)

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('ignores non-image drops in the prompt box', async () => {
    const importReferenceFiles = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ importReferenceFiles })
    const { host, root } = await renderComposer()
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    const promptBox = document.querySelector<HTMLDivElement>('.prompt-box')
    let defaultAllowed = false

    await act(async () => {
      defaultAllowed = promptBox?.dispatchEvent(dropEvent(transferWithFiles([file]))) ?? false
    })

    expect(defaultAllowed).toBe(true)
    expect(importReferenceFiles).not.toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it('imports Tauri-dropped image paths inside the prompt box as reference images', async () => {
    setTauriRuntime(true)
    const importReferencePayloads = vi.fn().mockResolvedValue(undefined)
    const payloadsByPath = new Map([
      ['C:\\drop\\one.png', { name: 'one.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,b25l', fileSizeBytes: 3 }],
      ['C:\\drop\\two.webp', { name: 'two.webp', mimeType: 'image/webp', dataUrl: 'data:image/webp;base64,dHdv', fileSizeBytes: 3 }]
    ])
    const readLocalImageFile = vi.spyOn(platform, 'readLocalImageFile').mockImplementation(async (path) => {
      const payload = payloadsByPath.get(path)
      if (!payload) throw new Error(`Unexpected path: ${path}`)
      return payload
    })
    useAppStore.setState({ importReferencePayloads })
    const { host, root } = await renderComposer()
    const promptBox = document.querySelector<HTMLDivElement>('.prompt-box')

    expect(promptBox).not.toBeNull()
    Object.defineProperty(promptBox, 'getBoundingClientRect', {
      value: () => ({
        x: 10,
        y: 20,
        left: 10,
        top: 20,
        right: 210,
        bottom: 220,
        width: 200,
        height: 200,
        toJSON: () => ({})
      })
    })

    await act(async () => {
      tauriWindowMock.handlers[0]?.({
        payload: {
          type: 'drop',
          paths: ['C:\\drop\\one.png', 'C:\\drop\\notes.txt', 'C:\\drop\\two.webp'],
          position: { x: 30, y: 40 }
        }
      })
      await flushPromises()
    })

    expect(readLocalImageFile).toHaveBeenCalledTimes(2)
    expect(readLocalImageFile).toHaveBeenNthCalledWith(1, 'C:\\drop\\one.png')
    expect(readLocalImageFile).toHaveBeenNthCalledWith(2, 'C:\\drop\\two.webp')
    expect(importReferencePayloads).toHaveBeenCalledWith([
      payloadsByPath.get('C:\\drop\\one.png'),
      payloadsByPath.get('C:\\drop\\two.webp')
    ])

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})

function pasteEvent(transfer: DataTransfer): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: transfer })
  return event
}

function dropEvent(transfer: DataTransfer): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  return event
}

function transferWithFiles(files: File[]): DataTransfer {
  return {
    files: fileList(files),
    items: dataTransferItems(files)
  } as unknown as DataTransfer
}

function transferWithText(): DataTransfer {
  return {
    files: fileList([]),
    items: [
      {
        kind: 'string',
        type: 'text/plain',
        getAsFile: () => null
      }
    ]
  } as unknown as DataTransfer
}

function fileList(files: File[]): FileList {
  return Object.assign(files, {
    item: (index: number) => files[index] || null
  }) as unknown as FileList
}

function dataTransferItems(files: File[]): DataTransferItemList {
  return Object.assign(
    files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file
    })),
    {
      item: (index: number) => files[index] || null
    }
  ) as unknown as DataTransferItemList
}

function setTextareaValue(textarea: HTMLTextAreaElement | null | undefined, value: string): void {
  setTextareaDomValue(textarea, value)
  textarea?.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
}

function setTextareaDomValue(textarea: HTMLTextAreaElement | null | undefined, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
}

function compositionEvent(type: 'compositionstart' | 'compositionend'): Event {
  if (typeof CompositionEvent === 'function') return new CompositionEvent(type, { bubbles: true, cancelable: true })
  return new Event(type, { bubbles: true, cancelable: true })
}

function setTauriRuntime(enabled: boolean): void {
  const tauriWindow = window as Window & { __TAURI_INTERNALS__?: unknown }
  if (!enabled) {
    Reflect.deleteProperty(tauriWindow, '__TAURI_INTERNALS__')
    return
  }
  Object.defineProperty(tauriWindow, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {}
  })
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
