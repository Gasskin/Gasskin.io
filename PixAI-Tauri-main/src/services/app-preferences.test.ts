import { describe, expect, it } from 'vitest'
import { __setNotificationPermissionForTests } from '../lib/platform'
import { AppPreferencesStore } from './app-preferences'

describe('AppPreferencesStore', () => {
  it('defaults successful image notifications to disabled and close-to-tray to enabled', async () => {
    const store = new AppPreferencesStore()

    const preferences = await store.get()

    expect(preferences.notifyOnImageSuccess).toBe(false)
    expect(preferences.closeToTray).toBe(true)
    expect(preferences.notificationPermission).toBe('unsupported')
  })

  it('persists successful image notification preference changes', async () => {
    const store = new AppPreferencesStore()

    await store.update({ notifyOnImageSuccess: true, closeToTray: false })

    await expect(new AppPreferencesStore().get()).resolves.toMatchObject({
      notifyOnImageSuccess: true,
      closeToTray: false
    })
  })

  it('refreshes stored notification permission status', async () => {
    __setNotificationPermissionForTests('denied')
    const store = new AppPreferencesStore()

    const preferences = await store.refreshNotificationPermission()

    expect(preferences.notificationPermission).toBe('denied')
  })
})
