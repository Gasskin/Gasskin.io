import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDuration } from '../../lib/time'
import { shouldShowRetryAttemptChip } from '../../generation-retry-display'
import type { GenerationRunRetryFailure, ImageHistoryItem } from '../../shared/types'
import { useAppStore } from '../../store/app-store'
import { ErrorDetailsModal } from './ErrorDetailsModal'

export function GeneratingTile({
  runId,
  requestIndex,
  generationElapsedMs,
  retryAttempt = 0,
  maxRetries = 0,
  retryFailure = null
}: {
  runId?: string
  requestIndex?: number
  generationElapsedMs: number | null
  retryAttempt?: number
  maxRetries?: number
  retryFailure?: GenerationRunRetryFailure | null
}) {
  const { cancelGeneration } = useAppStore()
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false)
  const canCancel = Boolean(runId && typeof requestIndex === 'number')
  const canOpenRetryDetails = Boolean(retryFailure)
  const showRetryAttemptChip = shouldShowRetryAttemptChip({ retryAttempt, maxRetries, retryFailure })
  const retryFailureItem = useMemo<ImageHistoryItem | null>(() => {
    if (!retryFailure) return null
    return {
      id: `${runId || 'running'}-${requestIndex ?? 'unknown'}-retry-failure`,
      conversationId: null,
      runId: runId || null,
      prompt: '',
      model: '',
      ratio: '1:1',
      size: null,
      quality: 'auto',
      requestIndex: requestIndex ?? null,
      durationMs: null,
      dataUrl: null,
      fileSizeBytes: null,
      status: 'failed',
      errorMessage: retryFailure.errorMessage,
      errorDetails: retryFailure.errorDetails,
      retryAttempt: Math.max(0, retryAttempt - 1),
      favorite: false,
      generationMode: 'text-to-image',
      referenceImages: [],
      createdAt: retryFailure.createdAt
    }
  }, [requestIndex, retryAttempt, retryFailure, runId])

  const openRetryDetails = () => {
    if (canOpenRetryDetails) setErrorDetailsOpen(true)
  }

  return (
    <article
      className={`image-tile generating-card flex min-h-[300px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm${canOpenRetryDetails ? ' retry-details-card cursor-pointer' : ''}`}
      aria-label={canOpenRetryDetails ? '重试中，点击查看上次失败详情' : '生成中'}
      role={canOpenRetryDetails ? 'button' : undefined}
      tabIndex={canOpenRetryDetails ? 0 : undefined}
      title={canOpenRetryDetails ? '点击查看上次失败详情' : undefined}
      onClick={openRetryDetails}
      onKeyDown={(event) => {
        if (!canOpenRetryDetails) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openRetryDetails()
        }
      }}
    >
      <div className="image-frame generating-frame grid aspect-square w-full place-items-center bg-muted/50">
        <div className="generating-center grid justify-items-center gap-3 text-center">
          <Loader2 className="spin animate-spin text-primary" size={28} />
          <span className="generating-label text-sm font-medium">生成中</span>
          {showRetryAttemptChip ? (
            <Badge variant="outline" className="retry-chip">{`重试第 ${retryAttempt} 次`}</Badge>
          ) : retryFailure ? (
            <Badge variant="outline" className="retry-chip">重试中</Badge>
          ) : null}
        </div>
      </div>
      <div className="generating-meta mt-auto flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
        <span>{`已耗时 ${formatDuration(generationElapsedMs ?? 0)}`}</span>
        {canCancel ? (
          <Button
            type="button"
            className="cancel-chip"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              void cancelGeneration(runId, requestIndex)
            }}
          >
            取消
          </Button>
        ) : null}
      </div>
      {errorDetailsOpen && retryFailureItem ? (
        <ErrorDetailsModal item={retryFailureItem} onClose={() => setErrorDetailsOpen(false)} />
      ) : null}
    </article>
  )
}
