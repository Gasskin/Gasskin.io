import { FolderOpen, PackageCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { pixaiApi } from '../../../services/app-api'
import { useAppStore } from '../../../store/app-store'

export function ExtensionsSettingsTab() {
  const {
    codexSkillStatus,
    codexSkillInstalling,
    installCodexSkill,
    notify
  } = useAppStore()

  const openCodexSkillDirectory = async () => {
    if (!codexSkillStatus?.path) return
    try {
      await pixaiApi.shell.openPath(codexSkillStatus.path)
    } catch (error) {
      notify(error instanceof Error ? `打开目录失败：${error.message}` : '打开目录失败')
    }
  }

  return (
    <Card className="settings-status-card rounded-2xl shadow-none">
      <CardHeader className="section-title flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Codex 技能安装</CardTitle>
        <Badge variant={codexSkillStatus?.installed ? 'default' : 'secondary'} className={`pill tiny ${codexSkillStatus?.installed ? 'good' : 'warn'}`}>
          {codexSkillStatus?.installed ? '已安装' : '未安装'}
        </Badge>
      </CardHeader>
      <CardContent>
      <div className="skill-install-card flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
        <div className="skill-install-copy grid min-w-0 gap-1">
          <strong>PixAI 生图工作台技能</strong>
          <span className="truncate text-sm text-muted-foreground">{codexSkillStatus?.path || '全局 Codex 技能目录'}</span>
        </div>
        <div className="button-row skill-actions flex shrink-0 items-center gap-2">
          <Button className="primary-button" type="button" onClick={() => void installCodexSkill()} disabled={codexSkillInstalling}>
            <PackageCheck size={15} />
            {codexSkillInstalling ? '安装中' : codexSkillStatus?.installed ? '重新安装到全局' : '一键安装到全局'}
          </Button>
          <Button
            className="icon-button"
            variant="outline"
            size="icon"
            type="button"
            onClick={() => void openCodexSkillDirectory()}
            title="打开技能目录"
            disabled={!codexSkillStatus?.installed || codexSkillStatus.path === 'browser-memory'}
          >
            <FolderOpen size={15} />
          </Button>
        </div>
      </div>
      </CardContent>
    </Card>
  )
}
