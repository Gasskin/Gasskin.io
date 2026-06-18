import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirm as dialogConfirm } from '@tauri-apps/plugin-dialog'
import { confirmDestructiveAction } from './confirm'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn()
}))

describe('confirmDestructiveAction', () => {
  const originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__')

  afterEach(() => {
    restoreWindowProperty('__TAURI_INTERNALS__', originalTauriDescriptor)
    vi.restoreAllMocks()
  })

  it('uses the Tauri dialog confirm in desktop runtime', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true
    })
    const fallbackConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(dialogConfirm).mockResolvedValue(true)

    await expect(confirmDestructiveAction('确认删除？')).resolves.toBe(true)

    expect(dialogConfirm).toHaveBeenCalledWith('确认删除？', {
      title: 'PixAI',
      kind: 'warning'
    })
    expect(fallbackConfirm).not.toHaveBeenCalled()
  })

  it('falls back to window.confirm outside Tauri', async () => {
    const fallbackConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await expect(confirmDestructiveAction('确认删除？')).resolves.toBe(false)

    expect(fallbackConfirm).toHaveBeenCalledWith('确认删除？')
  })
})

function restoreWindowProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor)
    return
  }
  Reflect.deleteProperty(window, name)
}
