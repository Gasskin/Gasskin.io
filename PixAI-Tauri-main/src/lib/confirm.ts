import { confirm } from '@tauri-apps/plugin-dialog'
import { isTauriRuntime } from './platform'

export async function confirmDestructiveAction(message: string): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (isTauriRuntime()) {
    try {
      return await confirm(message, {
        title: 'PixAI',
        kind: 'warning'
      })
    } catch {
      return false
    }
  }
  if (typeof window.confirm !== 'function') return false
  try {
    return window.confirm(message)
  } catch {
    return false
  }
}
