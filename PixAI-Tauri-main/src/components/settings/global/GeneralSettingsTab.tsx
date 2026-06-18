import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '../../../store/app-store'
import { AppUpdateSection } from '../AppUpdateSection'
import { SettingsToggleRow } from '../SettingsToggleRow'

export function GeneralSettingsTab() {
  const {
    preferences,
    updatePreferences,
    appUpdate,
    checkForAppUpdate,
    downloadAndInstallAppUpdate
  } = useAppStore()

  if (!preferences) return null

  return (
    <>
      <Card className="settings-status-card rounded-2xl shadow-none">
        <CardHeader className="section-title flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">窗口与托盘</CardTitle>
          <Badge variant="outline" className="pill tiny">常规</Badge>
        </CardHeader>
        <CardContent>
        <div className="toggle-stack grid gap-2">
          <SettingsToggleRow
            label="关闭到系统托盘"
            help="开启后点击窗口关闭按钮会隐藏到托盘，托盘图标可恢复窗口或退出应用。"
            checked={preferences.closeToTray}
            onChange={() => void updatePreferences({ closeToTray: !preferences.closeToTray })}
          />
        </div>
        </CardContent>
      </Card>
      <AppUpdateSection
        appUpdate={appUpdate}
        onCheck={() => void checkForAppUpdate({ silent: false })}
        onInstall={() => void downloadAndInstallAppUpdate()}
        variant="card"
      />
    </>
  )
}
