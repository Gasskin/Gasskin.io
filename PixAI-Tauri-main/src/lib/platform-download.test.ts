import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn(),
  invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/path', () => ({
  downloadDir: vi.fn()
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn()
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn()
}))

let coreModule = undefined as unknown as typeof import('@tauri-apps/api/core')
let dialogModule = undefined as unknown as typeof import('@tauri-apps/plugin-dialog')
let openerModule = undefined as unknown as typeof import('@tauri-apps/plugin-opener')
let pathModule = undefined as unknown as typeof import('@tauri-apps/api/path')
let downloadHistoryImages = undefined as unknown as typeof import('./platform')['downloadHistoryImages']
let resetPlatformState = undefined as unknown as typeof import('./platform')['__resetPlatformStateForTests']

describe('downloadHistoryImages', () => {
  const originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__')

  beforeEach(async () => {
    vi.resetModules()
    coreModule = await import('@tauri-apps/api/core')
    dialogModule = await import('@tauri-apps/plugin-dialog')
    openerModule = await import('@tauri-apps/plugin-opener')
    pathModule = await import('@tauri-apps/api/path')
    const platform = await import('./platform')
    downloadHistoryImages = platform.downloadHistoryImages
    resetPlatformState = platform.__resetPlatformStateForTests

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true
    })

    vi.clearAllMocks()
    vi.mocked(pathModule.downloadDir).mockResolvedValue('C:\\Users\\admin\\Downloads')
    vi.mocked(dialogModule.open).mockResolvedValue('E:\\BatchExports')
    vi.mocked(dialogModule.save).mockResolvedValue('E:\\SingleExports\\ignored.png')
    vi.mocked(openerModule.openPath).mockResolvedValue(undefined)
    vi.mocked(coreModule.invoke).mockImplementation(async (command: string, args?: any) => {
      if (command === 'read_local_image_file') {
        return {
          name: 'local-source.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,aGVsbG8=',
          fileSizeBytes: 5
        }
      }
      if (command === 'copy_binary_file') {
        return `copied:${String(args?.filename)}`
      }
      if (command === 'write_binary_file_in_directory') {
        return `written:${String(args?.filename)}`
      }
      throw new Error(`unexpected command ${command}`)
    })
  })

  afterEach(() => {
    restoreWindowProperty('__TAURI_INTERNALS__', originalTauriDescriptor)
    vi.clearAllMocks()
    resetPlatformState()
  })

  it('selects one folder and saves multiple selected images there', async () => {
    const result = await downloadHistoryImages([
      {
        id: 'data-source-1',
        dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
        storagePath: null
      },
      {
        id: 'data-source-2',
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        storagePath: null
      }
    ])

    expect(pathModule.downloadDir).toHaveBeenCalledTimes(1)
    expect(dialogModule.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: '选择批量下载文件夹',
      defaultPath: 'C:\\Users\\admin\\Downloads'
    })
    expect(result).toEqual({
      savedCount: 2,
      canceled: false
    })
    expect(openerModule.openPath).toHaveBeenCalledWith('E:\\BatchExports')
  })

  it('returns canceled when the batch folder dialog is dismissed', async () => {
    vi.mocked(dialogModule.open).mockResolvedValue(null)

    const result = await downloadHistoryImages([
      {
        id: 'data-source-1',
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        storagePath: null
      },
      {
        id: 'data-source-2',
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        storagePath: null
      }
    ])

    expect(result).toEqual({
      savedCount: 0,
      canceled: true
    })
    expect(openerModule.openPath).not.toHaveBeenCalled()
  })
})

function restoreWindowProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor)
    return
  }
  Reflect.deleteProperty(window, name)
}
