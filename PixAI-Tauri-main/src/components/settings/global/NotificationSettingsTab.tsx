import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '../../../store/app-store'
import { SettingsToggleRow } from '../SettingsToggleRow'

export function NotificationSettingsTab() {
  const {
    preferences,
    updatePreferences,
    requestNotificationPermission,
    refreshNotificationPermission
  } = useAppStore()

  useEffect(() => {
    if (!preferences?.notifyOnImageSuccess) return
    void refreshNotificationPermission()
  }, [preferences?.notifyOnImageSuccess, refreshNotificationPermission])

  if (!preferences) return null

  const notificationPermissionLabel = getNotificationPermissionLabel(preferences.notificationPermission)
  const showNotificationPermissionWarning = preferences.notifyOnImageSuccess && preferences.notificationPermission !== 'granted'

  return (
    <Card className="settings-status-card rounded-2xl shadow-none">
      <CardHeader className="section-title flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">通知状态</CardTitle>
        <Badge variant={preferences.notificationPermission === 'granted' ? 'default' : 'secondary'} className={`pill tiny ${preferences.notificationPermission === 'granted' ? 'good' : 'warn'}`}>
          {notificationPermissionLabel}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-3">
      <div className="toggle-stack grid gap-2">
        <SettingsToggleRow
          label="生图完成通知"
          help="开启后，PixAI 失焦时每次生图结束都会发送系统通知，成功或失败都会提示。"
          checked={preferences.notifyOnImageSuccess}
          onChange={() => void updatePreferences({ notifyOnImageSuccess: !preferences.notifyOnImageSuccess })}
        />
      </div>
      {showNotificationPermissionWarning ? (
        <div className="settings-warning flex items-center justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span>系统通知权限未开启，生成结束时会退回应用内提示。</span>
          <Button variant="outline" size="sm" type="button" onClick={() => void requestNotificationPermission()}>
            开启权限
          </Button>
        </div>
      ) : null}
      </CardContent>
    </Card>
  )
}

function getNotificationPermissionLabel(permission: string): string {
  if (permission === 'granted') return '系统已允许'
  if (permission === 'denied') return '系统已拒绝'
  if (permission === 'unsupported') return '不支持'
  return '待授权'
}
