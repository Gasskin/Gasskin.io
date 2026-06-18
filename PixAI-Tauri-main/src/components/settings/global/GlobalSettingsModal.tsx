import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore } from '../../../store/app-store'
import { ExtensionsSettingsTab } from './ExtensionsSettingsTab'
import { GeneralSettingsTab } from './GeneralSettingsTab'
import { NotificationSettingsTab } from './NotificationSettingsTab'
import { ServicesSettingsTab } from './ServicesSettingsTab'

export type GlobalSettingsTab = 'general' | 'notifications' | 'services' | 'extensions'

const TAB_OPTIONS: Array<{ id: GlobalSettingsTab; label: string }> = [
  { id: 'general', label: '常规' },
  { id: 'notifications', label: '通知' },
  { id: 'services', label: '服务' },
  { id: 'extensions', label: '扩展' }
]

export function GlobalSettingsModal({
  open,
  initialTab = 'general',
  onClose
}: {
  open: boolean
  initialTab?: GlobalSettingsTab
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<GlobalSettingsTab>(initialTab)
  const loadCodexSkillStatus = useAppStore((state) => state.loadCodexSkillStatus)

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
  }, [initialTab, open])

  useEffect(() => {
    if (!open) return
    void loadCodexSkillStatus()
  }, [loadCodexSkillStatus, open])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="global-settings-modal grid max-h-[calc(100vh-44px)] max-w-6xl grid-cols-[220px_minmax(0,1fr)] gap-0 overflow-hidden p-0" aria-label="全局设置" aria-describedby={undefined}>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as GlobalSettingsTab)} orientation="vertical" className="contents">
          <nav className="global-settings-nav border-r border-border bg-muted/35 p-4" aria-label="全局设置导航">
            <div className="global-settings-nav-title mb-4 grid gap-1 border-b border-border pb-4">
              <strong className="text-base">全局设置</strong>
              <span className="text-xs leading-5 text-muted-foreground">低频配置与环境状态集中放在这里。</span>
            </div>
            <TabsList className="grid h-auto w-full justify-stretch gap-1 bg-transparent p-0">
              {TAB_OPTIONS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="h-10 w-full justify-start rounded-lg px-4 text-sm">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>
          <div className="global-settings-body min-w-0">
            <DialogHeader className="modal-head global-settings-head border-b border-border px-4 py-4">
              <DialogTitle>{getTabTitle(activeTab)}</DialogTitle>
              <span className="text-sm text-muted-foreground">{getTabSummary(activeTab)}</span>
            </DialogHeader>
            <ScrollArea className="h-[min(680px,calc(100vh-150px))]">
              <div className="global-settings-content grid gap-4 p-4">
                {activeTab === 'general' ? <GeneralSettingsTab /> : null}
                {activeTab === 'notifications' ? <NotificationSettingsTab /> : null}
                {activeTab === 'services' ? <ServicesSettingsTab /> : null}
                {activeTab === 'extensions' ? <ExtensionsSettingsTab /> : null}
              </div>
            </ScrollArea>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function getTabTitle(tab: GlobalSettingsTab): string {
  if (tab === 'notifications') return '通知'
  if (tab === 'services') return '服务'
  if (tab === 'extensions') return '扩展'
  return '常规'
}

function getTabSummary(tab: GlobalSettingsTab): string {
  if (tab === 'notifications') return '通知开关、权限状态和系统提示都在这里处理。'
  if (tab === 'services') return 'Provider 维护、默认选择和模型默认值集中管理。'
  if (tab === 'extensions') return 'Codex 技能安装与目录操作不再挤在工作区参数栏。'
  return '窗口行为和应用更新属于应用级配置，与当前会话分层。'
}
