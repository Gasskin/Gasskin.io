import { useEffect, useMemo } from 'react'
import { Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ImageHistoryItem } from '../../shared/types'
import { useAppStore } from '../../store/app-store'

type ErrorPayload = {
  stage?: unknown
  timestamp?: unknown
  request?: unknown
  details?: unknown
}

export function ErrorDetailsModal({ item, onClose }: { item: ImageHistoryItem; onClose: () => void }) {
  const notify = useAppStore((state) => state.notify)
  const payload = useMemo(() => parseErrorPayload(item.errorDetails), [item.errorDetails])
  const details = isRecord(payload?.details) ? payload.details : null
  const responseBody = typeof details?.responseBody === 'string' ? details.responseBody : null
  const copyText = item.errorDetails || item.errorMessage || '生成失败'

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const copyError = async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      notify('已复制错误信息')
    } catch (error) {
      notify(error instanceof Error ? `复制失败：${error.message}` : '复制失败')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="provider-modal error-details-panel max-w-4xl"
        overlayClassName="error-details-backdrop"
        overlayProps={{
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
          onClick: (event) => event.stopPropagation()
        }}
        showCloseButton={false}
        aria-label="错误详情"
        aria-describedby={undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader className="modal-head flex-row items-center justify-between gap-3 space-y-0">
          <DialogTitle className="line-clamp-2 text-base">{item.errorMessage || '生成失败'}</DialogTitle>
          <div className="mini-controls flex items-center gap-1 pr-7">
            <Button className="icon-button" variant="outline" size="icon-sm" type="button" title="复制全部错误信息" onClick={() => void copyError()}>
              <Copy size={15} />
            </Button>
            <Button className="icon-button" variant="outline" size="icon-sm" type="button" title="关闭" onClick={onClose}>
              <X size={15} />
            </Button>
          </div>
        </DialogHeader>
        <div className="error-details-body grid max-h-[70vh] gap-3 overflow-auto">
          <div className="error-details-meta flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {renderMetaText('阶段', payload?.stage)}
            {renderMetaSeparator()}
            {renderMetaText('时间', formatErrorTimestamp(payload?.timestamp) || item.createdAt)}
            {renderMetaSeparator()}
            {renderMetaText('接口', details?.endpoint)}
          </div>
          <ErrorSection title="请求参数" value={payload?.request ?? '无请求参数'} />
          <ErrorSection title="响应体" value={responseBody ?? details?.responseError ?? details ?? '无响应体'} />
          <ErrorSection title="原始错误详情" value={payload ?? copyText} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ErrorSection({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="error-details-section rounded-xl border border-border bg-muted/30 p-3">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs text-muted-foreground">{formatDetailValue(value)}</pre>
    </section>
  )
}

function parseErrorPayload(errorDetails: string | null): ErrorPayload | null {
  if (!errorDetails) return null
  try {
    const payload = JSON.parse(errorDetails) as ErrorPayload
    return isRecord(payload) ? payload : null
  } catch {
    return null
  }
}

function renderMetaText(label: string, value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return (
    <span className="error-details-meta-item inline-flex items-center gap-1">
      <span className="error-details-meta-label font-medium text-foreground">{label}</span>
      <span className="error-details-meta-value">{String(value)}</span>
    </span>
  )
}

function renderMetaSeparator() {
  return <span className="error-details-meta-separator">|</span>
}

function formatErrorTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString()
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return '无'
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return '无'
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2) || '无'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
