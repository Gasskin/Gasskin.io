import { useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GallerySelect, type GallerySelectOption } from '../common/GallerySelect'
import { confirmDestructiveAction } from '../../lib/confirm'
import { elapsedMs, formatDuration } from '../../lib/time'
import { getGenerationAttemptStartedAt } from '../../generation-timing'
import type { GenerationRun, ImageHistoryItem } from '../../shared/types'
import { useAppStore } from '../../store/app-store'
import { getWorkspaceRunGridSlots, type WorkspaceRunGridSlot } from '../../workspace-placeholders'
import { getWorkspaceResultSummarySegments } from '../../workspace-summary'
import { GeneratingTile } from './GeneratingTile'
import { ImageTile } from './ImageTile'

const pageSizeOptions = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const pageSizeSelectOptions: Array<GallerySelectOption<number>> = pageSizeOptions.map((value) => ({
  value,
  label: `${value}张`
}))

export function CanvasArea({
  runs,
  generationStartedAt,
  generating,
  generationClockMs
}: {
  runs: GenerationRun[]
  generationStartedAt: number | null
  generating: boolean
  generationClockMs: number
}) {
  const {
    activeConversationId,
    generatingByConversation,
    removedGenerationIndexesByRunId,
    deleteHistoryItems,
    refreshConversationResults
  } = useAppStore()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(30)
  const [clearingFailed, setClearingFailed] = useState(false)
  const orderedRuns = useMemo(
    () => [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [runs]
  )
  const items = orderedRuns.flatMap((run) => run.items.map((item) => ({ item, run })))
  const failedItems = items.map(({ item }) => item).filter((item) => item.status === 'failed')
  const orderedSlots = useMemo(
    () =>
      orderedRuns.flatMap((run) => {
        const removedIndexes = run.status === 'running' ? removedGenerationIndexesByRunId[run.id] || [] : []
        const slots =
          run.status === 'running'
            ? getWorkspaceRunGridSlots(run.n, run.items, removedIndexes, run.retryAttempts)
            : run.items.map((item) => ({ type: 'item' as const, requestIndex: item.requestIndex, item }))
        return slots.map((slot) => ({ run, slot }))
      }),
    [orderedRuns, removedGenerationIndexesByRunId]
  )
  const runningRuns = orderedRuns.filter((run) => run.status === 'running')
  const pendingGenerationCount = activeConversationId ? generatingByConversation[activeConversationId] || 0 : 0
  const extraPendingCount = Math.max(pendingGenerationCount - runningRuns.length, 0)
  const visibleGeneratingCount = orderedSlots.filter(({ slot }) => slot.type === 'placeholder').length
  const generatingCount = visibleGeneratingCount + extraPendingCount
  const generationElapsedMs = generationStartedAt != null ? elapsedMs(generationStartedAt, generationClockMs) : null
  const summarySegments = getWorkspaceResultSummarySegments(items.map(({ item }) => item), generatingCount)
  const generationStatusText =
    generationElapsedMs != null && generating
      ? `正在生成 ${generatingCount} 项 · 已耗时 ${formatDuration(generationElapsedMs)}`
      : null
  const workspaceEntries: WorkspaceEntry[] = useMemo(
    () => [
      ...Array.from({ length: extraPendingCount }, (_value, index) => ({
        key: `pending-local-${index}`,
        type: 'pending' as const,
        generationElapsedMs
      })),
      ...orderedSlots.map(({ run, slot }) => ({
        key: slot.type === 'item' ? `${run.id}-item-${slot.item.id}` : `${run.id}-pending-${slot.requestIndex}`,
        type: 'slot' as const,
        run,
        slot
      }))
    ],
    [extraPendingCount, generationElapsedMs, orderedSlots]
  )
  const pageCount = Math.max(1, Math.ceil(workspaceEntries.length / pageSize))
  const visibleEntries = useMemo(() => {
    const start = (page - 1) * pageSize
    return workspaceEntries.slice(start, start + pageSize)
  }, [page, pageSize, workspaceEntries])
  const clearFailedItems = async () => {
    if (clearingFailed || failedItems.length === 0) return
    if (!(await confirmDestructiveAction(`确认清空当前工作区的 ${failedItems.length} 条失败记录？`))) return
    setClearingFailed(true)
    try {
      await deleteHistoryItems(failedItems.map((item) => item.id))
    } finally {
      setClearingFailed(false)
    }
  }

  useEffect(() => {
    if (!generating || !activeConversationId) return undefined
    void refreshConversationResults(activeConversationId)
    const timer = window.setInterval(() => {
      void refreshConversationResults(activeConversationId)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [activeConversationId, generating, refreshConversationResults])

  useEffect(() => {
    setPage(1)
  }, [activeConversationId])

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, pageCount))
  }, [pageCount])

  return (
    <section className="canvas-area flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="history-head flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="history-title inline-flex items-center gap-2 text-sm font-semibold">
          <ImageIcon size={16} />
          当前工作区
        </div>
        <div className="workspace-head-actions flex min-w-0 flex-1 items-center justify-end gap-2">
          {failedItems.length > 0 ? (
            <Button
              type="button"
              className="clear-failed-button"
              variant="destructive"
              size="sm"
              title={clearingFailed ? '正在清空失败图片' : '清空当前工作区中的失败图片'}
              disabled={clearingFailed}
              onClick={() => void clearFailedItems()}
            >
              <Trash2 size={14} />
              {clearingFailed ? '清理中' : '清空失败'}
            </Button>
          ) : null}
          <div className="workspace-summary flex flex-wrap items-center justify-end gap-1.5" aria-label="工作区结果统计">
            {generationStatusText ? <Badge className="summary-chip active">{generationStatusText}</Badge> : null}
            {summarySegments.map((segment) => (
              <Badge key={segment.key} variant="outline" className={`summary-chip ${segment.tone}`}>
                {segment.label} <strong>{segment.value}</strong>
                {segment.suffix ? ` ${segment.suffix}` : ''}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      <div className="preview-grid grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(210px,1fr))] content-start items-start gap-3 overflow-auto p-4">
        {workspaceEntries.length === 0 && !generating ? (
          <div className="empty-state grid-empty col-span-full grid min-h-80 place-items-center rounded-2xl border border-dashed border-border bg-muted/35 text-sm text-muted-foreground">
            生成后的图片会显示在这里
          </div>
        ) : null}
        {visibleEntries.map((entry) => renderWorkspaceEntry(entry, generationClockMs))}
      </div>
      {workspaceEntries.length > 0 ? (
        <div className="gallery-pagination workspace-pagination flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-2 overflow-hidden border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            上一页
          </Button>
          <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">{page}/{pageCount}</span>
          <Button variant="outline" size="sm" type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
            下一页
          </Button>
          <GallerySelect
            value={pageSize}
            options={pageSizeSelectOptions}
            ariaLabel="每页数量"
            className="page-size-select h-9 w-20 shrink-0 px-3 *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:leading-none"
            onChange={(value) => {
              setPageSize(value)
              setPage(1)
            }}
          />
        </div>
      ) : null}
    </section>
  )
}

type WorkspaceEntry =
  | {
      key: string
      type: 'pending'
      generationElapsedMs: number | null
    }
  | {
      key: string
      type: 'slot'
      run: GenerationRun
      slot: WorkspaceRunGridSlot
    }

function renderWorkspaceEntry(entry: WorkspaceEntry, generationClockMs: number) {
  if (entry.type === 'pending') {
    return <GeneratingTile key={entry.key} generationElapsedMs={entry.generationElapsedMs} />
  }
  return renderSlot(entry.run, entry.slot, generationClockMs, entry.key)
}

function renderSlot(run: GenerationRun, slot: WorkspaceRunGridSlot, generationClockMs: number, key: string) {
  if (slot.type === 'item') {
    return <ImageTile key={key} item={slot.item as ImageHistoryItem} />
  }
  const startedAt = Date.parse(run.createdAt)
  const retryFailure = run.retryFailures?.[slot.requestIndex] ?? null
  const attemptStartedAt = getGenerationAttemptStartedAt(Number.isFinite(startedAt) ? startedAt : null, retryFailure?.createdAt)
  return (
    <GeneratingTile
      key={key}
      runId={run.id}
      requestIndex={slot.requestIndex}
      generationElapsedMs={attemptStartedAt != null ? elapsedMs(attemptStartedAt, generationClockMs) : null}
      retryAttempt={slot.retryAttempt}
      maxRetries={run.maxRetries}
      retryFailure={retryFailure}
    />
  )
}
