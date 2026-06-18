import type { ReactNode } from 'react'
import { ArrowRight, BookOpen, Download, GalleryHorizontalEnd, ImagePlus, Moon, PanelRightClose, PanelRightOpen, Plus, Settings, Sun, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { confirmDestructiveAction } from '../../lib/confirm'
import appLogo from '../../assets/app-logo.png'
import { IMAGE_QUALITY_LABELS, buildImageEndpoint } from '../../shared/image-options'
import { useAppStore } from '../../store/app-store'
import type { GlobalSettingsTab } from '../settings/global/GlobalSettingsModal'

export function MainLayout({
  children,
  onOpenGlobalSettings
}: {
  children: ReactNode
  onOpenGlobalSettings: (tab?: GlobalSettingsTab) => void
}) {
  const {
    conversations,
    activeConversationId,
    createConversation,
    darkMode,
    deleteConversation,
    setActiveConversation,
    setView,
    settingsVisible,
    settings,
    toggleSettings,
    toggleTheme,
    view,
    generatingByConversation,
    appUpdate
  } = useAppStore()
  const imageProfile = settings?.profiles.find((profile) => profile.id === settings.selectedImageProfileId)
  const endpoint = imageProfile ? buildImageEndpoint(imageProfile.baseUrl) : ''
  const hasAvailableUpdate = appUpdate.status === 'available' && Boolean(appUpdate.availableUpdate)
  const confirmDeleteConversation = () => confirmDestructiveAction('确认删除这个会话？会话下的生成任务会一起删除，历史图片会保留在图库。')

  return (
    <div className="shell app-frame flex h-dvh min-h-[720px] min-w-[1080px] flex-col overflow-hidden bg-[radial-gradient(circle_at_0%_0%,hsl(var(--primary)/0.09),transparent_28%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--secondary)/0.55))]">
      <header className="topbar flex h-16 shrink-0 items-center gap-3 border-b border-border/80 bg-background/86 px-4 backdrop-blur">
        <div className="brand flex w-[248px] shrink-0 items-center gap-3">
          <img className="brand-mark size-9 rounded-xl border border-border bg-card p-1.5 shadow-sm" src={appLogo} alt="" />
          <div className="leading-tight">
            <strong className="block text-base font-semibold">PixAI</strong>
            <span className="text-xs text-muted-foreground">Image workbench</span>
          </div>
        </div>
        <div className="endpoint flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span className={cn('size-2.5 shrink-0 rounded-full', imageProfile?.apiKeyStored ? 'bg-emerald-500' : 'bg-amber-500')} />
          <span className="shrink-0 text-muted-foreground">{imageProfile?.apiKeyStored ? '接口已配置' : imageProfile ? '等待配置密钥' : '未添加 Provider'}</span>
          <code className="truncate text-xs text-foreground/80">{endpoint || '请先在全局设置中添加 Provider'}</code>
        </div>
        <nav className="top-actions flex items-center gap-2">
          <Button variant="outline" type="button" onClick={toggleSettings} title={settingsVisible ? '隐藏参数栏' : '显示参数栏'}>
            {settingsVisible ? <PanelRightClose /> : <PanelRightOpen />}
            参数栏
          </Button>
          <Button variant={view === 'workspace' ? 'secondary' : 'ghost'} type="button" onClick={() => setView('workspace')}>
            <ImagePlus />
            工作台
          </Button>
          <Button variant={view === 'gallery' ? 'secondary' : 'ghost'} type="button" onClick={() => setView('gallery')}>
            <GalleryHorizontalEnd />
            图库
          </Button>
          <Button variant={view === 'prompts' ? 'secondary' : 'ghost'} type="button" onClick={() => setView('prompts')}>
            <BookOpen />
            提示词库
          </Button>
          <Button type="button" onClick={() => void createConversation()}>
            <Plus />
            新建会话
          </Button>
        </nav>
      </header>
      <div
        className={cn(
          'main-grid grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_340px] overflow-hidden',
          settingsVisible && view === 'workspace' ? '' : 'settings-hidden grid-cols-[260px_minmax(0,1fr)]'
        )}
      >
        <aside className="sidebar flex min-h-0 flex-col border-r border-border/80 bg-card/82">
          <div className="flex h-12 shrink-0 items-center justify-between px-4">
            <div className="section-title text-xs font-semibold uppercase tracking-wide text-muted-foreground">会话</div>
            <Badge variant="outline">{conversations.length}</Badge>
          </div>
          <ScrollArea className="session-list min-h-0 flex-1 px-3">
            <div className="grid gap-2 pb-3">
              {conversations.map((conversation) => {
                const generating = Boolean(generatingByConversation[conversation.id])
                const active = conversation.id === activeConversationId
                return (
                  <button
                    key={conversation.id}
                    className={cn(
                      'session group flex min-h-16 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                      active ? 'active border-primary/35 bg-primary/10 text-foreground shadow-sm' : 'border-transparent bg-transparent hover:bg-muted',
                      generating ? 'generating' : ''
                    )}
                    type="button"
                    onClick={() => void setActiveConversation(conversation.id)}
                  >
                    <span className="session-text grid min-w-0 flex-1 gap-1">
                      <strong className="truncate text-sm font-semibold">{conversation.title}</strong>
                      <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                        {conversation.draftPrompt || `${conversation.ratio} · ${IMAGE_QUALITY_LABELS[conversation.quality]}`}
                      </span>
                    </span>
                    <span className="session-loading-slot flex size-5 items-center justify-center">
                      {generating ? <span className="session-loading-indicator size-2 rounded-full bg-primary" aria-label="生成中" /> : null}
                    </span>
                    {conversations.length > 1 ? (
                      <span
                        className="session-delete flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        role="button"
                        tabIndex={0}
                        title="删除会话"
                        onClick={async (event) => {
                          event.stopPropagation()
                          if (!(await confirmDeleteConversation())) return
                          void deleteConversation(conversation.id)
                        }}
                        onKeyDown={async (event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          if (!(await confirmDeleteConversation())) return
                          void deleteConversation(conversation.id)
                        }}
                      >
                        <Trash2 size={14} />
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
          <div className="sidebar-footer shrink-0 border-t border-border p-3">
            <div className="version-line mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <strong className="text-foreground">PixAI</strong>
              <span>v{appUpdate.currentVersion}</span>
            </div>
            {hasAvailableUpdate ? (
              <button
                className="sidebar-update-banner mb-3 flex w-full items-center justify-between rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-left text-sm text-primary hover:bg-primary/15"
                type="button"
                onClick={() => onOpenGlobalSettings('general')}
                title={`发现新版本 v${appUpdate.availableUpdate?.version}`}
              >
                <span className="sidebar-update-copy grid gap-1">
                  <span className="sidebar-update-label inline-flex items-center gap-1 text-xs font-medium">
                    <Download size={14} />
                    有新版本
                  </span>
                  <strong>v{appUpdate.availableUpdate?.version} 可更新</strong>
                </span>
                <ArrowRight size={14} />
              </button>
            ) : null}
            <Separator className="mb-3" />
            <div className="icon-row flex items-center gap-2">
              <Button className="theme-toggle flex-1 justify-between" variant="outline" type="button" onClick={toggleTheme} title="切换主题">
                <span>{darkMode ? '深色模式' : '白天模式'}</span>
                {darkMode ? <Sun /> : <Moon />}
              </Button>
              <Button className="icon-button" variant="outline" size="icon" type="button" onClick={() => onOpenGlobalSettings('general')} title="全局设置">
                <Settings />
              </Button>
            </div>
          </div>
        </aside>
        {children}
      </div>
    </div>
  )
}
