import { useEffect } from 'react'
import { Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ImageGenerationCallLog, ImageHistoryItem } from '../../shared/types'
import { useAppStore } from '../../store/app-store'

export function ImageCallLogModal({ item, onClose }: { item: ImageHistoryItem; onClose: () => void }) {
  const notify = useAppStore((state) => state.notify)
  const log = item.callLog

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!log) return null

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2))
      notify('已复制调用日志')
    } catch (error) {
      notify(error instanceof Error ? `复制失败：${error.message}` : '复制失败')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="provider-modal call-log-panel max-w-4xl"
        overlayClassName="call-log-backdrop"
        overlayProps={{
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
          onClick: (event) => event.stopPropagation()
        }}
        showCloseButton={false}
        aria-label="调用日志"
        aria-describedby={undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader className="modal-head flex-row items-center justify-between gap-3 space-y-0">
          <DialogTitle className="line-clamp-2 text-base">调用日志</DialogTitle>
          <div className="mini-controls flex items-center gap-1 pr-7">
            <Button className="icon-button" variant="outline" size="icon-sm" type="button" title="复制调用日志" onClick={() => void copyLog()}>
              <Copy size={15} />
            </Button>
            <Button className="icon-button" variant="outline" size="icon-sm" type="button" title="关闭" onClick={onClose}>
              <X size={15} />
            </Button>
          </div>
        </DialogHeader>
        <div className="call-log-body grid max-h-[70vh] gap-3 overflow-auto">
          <div className="call-log-meta flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {renderMetaText('供应商', log.provider.name)}
            {renderMetaSeparator()}
            {renderMetaText('端点', log.endpoint)}
            {renderMetaSeparator()}
            {renderMetaText('传输', formatTransport(log.transport))}
            {renderMetaSeparator()}
            {renderMetaText('时间', formatCallLogTimestamp(log.createdAt))}
          </div>
          <p className="text-xs text-muted-foreground">Authorization 与图片二进制/base64 已脱敏或摘要化，其他字段保持真实请求结构。</p>
          <CallLogSection title="供应商" value={log.provider} />
          <CallLogSection title="请求 Headers" value={log.request.headers} />
          <CallLogSection title="真实请求 Body" value={log.request.body} />
          <CallLogSection title="完整调用日志" value={log} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CallLogSection({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="call-log-section rounded-xl border border-border bg-muted/30 p-3">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs text-muted-foreground">{formatDetailValue(value)}</pre>
    </section>
  )
}

function renderMetaText(label: string, value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return (
    <span className="call-log-meta-item inline-flex items-center gap-1">
      <span className="call-log-meta-label font-medium text-foreground">{label}</span>
      <span className="call-log-meta-value">{String(value)}</span>
    </span>
  )
}

function renderMetaSeparator() {
  return <span className="call-log-meta-separator">|</span>
}

function formatTransport(transport: ImageGenerationCallLog['transport']): string {
  if (transport === 'streaming-json') return 'Streaming JSON'
  if (transport === 'streaming-multipart') return 'Streaming Multipart'
  if (transport === 'multipart') return 'Multipart'
  return 'JSON'
}

function formatCallLogTimestamp(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString()
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return '无'
  if (typeof value === 'string') return value.trim() || '无'
  return JSON.stringify(value, null, 2) || '无'
}
