import { getSystemNotificationPermission, readJsonState, requestSystemNotificationPermission, writeJsonState } from '../lib/platform'
import type { AppPreferences, AppPreferencesUpdate, NotificationPermissionState } from '../shared/types'

const STATE_NAME = 'app-preferences'

type AppPreferencesFile = Partial<AppPreferences>

export class AppPreferencesStore {
  private cache: AppPreferences | null = null

  async get(): Promise<AppPreferences> {
    if (this.cache) return this.cache
    const payload = await readJsonState(STATE_NAME)
    if (payload) {
      try {
        this.cache = normalizePreferences(JSON.parse(payload) as AppPreferencesFile)
        return this.cache
      } catch {
        // Corrupt preferences should not block app startup.
      }
    }
    this.cache = createDefaultPreferences(await readNotificationPermission())
    await this.save(this.cache)
    return this.cache
  }

  async update(input: AppPreferencesUpdate): Promise<AppPreferences> {
    const current = await this.get()
    const next = normalizePreferences({ ...current, ...input })
    await this.save(next)
    return next
  }

  async refreshNotificationPermission(): Promise<AppPreferences> {
    return this.update({ notificationPermission: await readNotificationPermission() })
  }

  async requestNotificationPermission(): Promise<AppPreferences> {
    const permission = normalizePermission(await requestSystemNotificationPermission())
    return this.update({ notificationPermission: permission })
  }

  private async save(preferences: AppPreferences): Promise<void> {
    this.cache = normalizePreferences(preferences)
    await writeJsonState(STATE_NAME, JSON.stringify(this.cache, null, 2))
  }
}

function createDefaultPreferences(notificationPermission: NotificationPermissionState = 'default'): AppPreferences {
  return {
    notifyOnImageSuccess: false,
    closeToTray: true,
    notificationPermission
  }
}

function normalizePreferences(preferences: AppPreferencesFile): AppPreferences {
  return {
    notifyOnImageSuccess: preferences.notifyOnImageSuccess === true,
    closeToTray: preferences.closeToTray !== false,
    notificationPermission: normalizePermission(preferences.notificationPermission)
  }
}

async function readNotificationPermission(): Promise<NotificationPermissionState> {
  return normalizePermission(await getSystemNotificationPermission())
}

function normalizePermission(permission: unknown): NotificationPermissionState {
  if (permission === 'granted' || permission === 'denied' || permission === 'default' || permission === 'unsupported') {
    return permission
  }
  return 'default'
}
