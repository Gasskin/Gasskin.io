import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDuration } from '../../lib/time'
import { imageSourceForDisplay, imageSourceForDisplaySync } from '../../lib/platform'
import type { ImageHistoryItem } from '../../shared/types'

export function ImagePreviewModal({ item, onClose }: { item: ImageHistoryItem; onClose: () => void }) {
  const [imageSource, setImageSource] = useState<string | null>(() => imageSourceForDisplaySync(item.dataUrl, item.storagePath))
  useEffect(() => {
    let canceled = false
    const syncSource = imageSourceForDisplaySync(item.dataUrl, item.storagePath)
    if (syncSource) setImageSource(syncSource)
    void imageSourceForDisplay(item.dataUrl, item.storagePath).then((source) => {
      if (!canceled && source) setImageSource(source)
    })
    return () => {
      canceled = true
    }
  }, [item.dataUrl, item.storagePath])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!imageSource) return null

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="image-preview-panel max-w-6xl" aria-label="图片预览" aria-describedby={undefined}>
        <DialogHeader className="image-preview-head">
          <DialogTitle className="line-clamp-2">{item.prompt}</DialogTitle>
          <span className="text-sm text-muted-foreground">
            {item.model} · {item.size || item.ratio}
            {item.durationMs != null ? ` · ${formatDuration(item.durationMs)}` : ''}
          </span>
        </DialogHeader>
        <div className="image-preview-stage grid max-h-[74vh] place-items-center overflow-hidden rounded-xl bg-muted">
          <img className="max-h-[74vh] max-w-full object-contain" src={imageSource} alt={item.prompt} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
