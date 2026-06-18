import { Download, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AppUpdateState } from '../../shared/types'

type AppUpdateSectionProps = {
  appUpdate: AppUpdateState
  onCheck: () => void
  onInstall: () => void
  variant?: 'panel' | 'card'
}

export function AppUpdateSection({ appUpdate, onCheck, onInstall, variant = 'panel' }: AppUpdateSectionProps) {
  const checking = appUpdate.status === 'checking'
  const installing = appUpdate.status === 'downloading' || appUpdate.status === 'installing'
  const canInstall = appUpdate.status === 'available' && Boolean(appUpdate.availableUpdate)
  const status = getUpdateStatusText(appUpdate)
  const progressText = getProgressText(appUpdate)

  return (
    <Card className={`${variant === 'card' ? 'settings-status-card' : 'settings-section'} rounded-2xl shadow-none`}>
      <CardHeader className="section-title flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">关于应用 / 更新</CardTitle>
        <Badge variant={appUpdate.status === 'available' ? 'secondary' : appUpdate.status === 'error' ? 'destructive' : 'default'} className={`pill tiny ${appUpdate.status === 'available' ? 'warn' : appUpdate.status === 'error' ? 'bad' : 'good'}`}>
          {status.badge}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-4">
      <div className="app-update-card grid gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <div className="app-update-version flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">当前版本</span>
          <strong>v{appUpdate.currentVersion}</strong>
        </div>
        {appUpdate.availableUpdate ? (
          <div className="app-update-version flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">可用版本</span>
            <strong>v{appUpdate.availableUpdate.version}</strong>
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">{status.message}</p>
        {appUpdate.availableUpdate?.notes ? <p className="app-update-notes rounded-lg bg-background p-3 text-sm text-muted-foreground">{appUpdate.availableUpdate.notes}</p> : null}
        {progressText ? <div className="status-line text-xs text-muted-foreground">{progressText}</div> : null}
        {appUpdate.lastCheckedAt ? <div className="status-line text-xs text-muted-foreground">上次检查：{formatDateTime(appUpdate.lastCheckedAt)}</div> : null}
      </div>
      <div className="button-row app-update-actions flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCheck} disabled={checking || installing}>
          <RefreshCw className={checking ? 'spin animate-spin' : ''} size={15} />
          {checking ? '检查中' : '检查更新'}
        </Button>
        <Button className="primary-button" type="button" onClick={onInstall} disabled={!canInstall || installing}>
          <Download size={15} />
          {installing ? '更新中' : appUpdate.availableUpdate?.installMode === 'github' ? '打开下载' : '下载并重启'}
        </Button>
      </div>
      </CardContent>
    </Card>
  )
}

function getUpdateStatusText(appUpdate: AppUpdateState): { badge: string; message: string } {
  if (appUpdate.status === 'checking') return { badge: '检查中', message: '正在检查是否有新版本。' }
  if (appUpdate.status === 'available' && appUpdate.availableUpdate) {
    return {
      badge: '有更新',
      message: appUpdate.availableUpdate.installMode === 'github'
        ? `发现 GitHub Release 新版本 v${appUpdate.availableUpdate.version}。`
        : `发现新版本 v${appUpdate.availableUpdate.version}。`
    }
  }
  if (appUpdate.status === 'downloading') return { badge: '下载中', message: '正在下载更新包，请保持应用打开。' }
  if (appUpdate.status === 'installing') return { badge: '安装中', message: '更新已安装，正在准备重启。' }
  if (appUpdate.status === 'error') return { badge: '需重试', message: appUpdate.errorMessage || '检查更新失败，可以稍后重试。' }
  if (appUpdate.status === 'upToDate') return { badge: '最新', message: '当前已是最新版本。' }
  return { badge: '待检查', message: appUpdate.runtime === 'tauri' ? '尚未检查更新。' : '更新检查仅在桌面应用中可用。' }
}

function getProgressText(appUpdate: AppUpdateState): string | null {
  if (appUpdate.status !== 'downloading') return null
  const downloaded = appUpdate.downloadedBytes
  const total = appUpdate.contentLength
  if (downloaded == null) return '正在下载更新包'
  if (!total) return `已下载 ${formatBytes(downloaded)}`
  return `已下载 ${formatBytes(downloaded)} / ${formatBytes(total)}`
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
