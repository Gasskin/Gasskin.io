import { useEffect, useState } from 'react'
import { Copy, Download, Edit3, EllipsisVertical, Heart, ImageDown, RotateCcw, ScrollText, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { ImageHistoryItem } from '../../shared/types'
import { confirmDestructiveAction } from '../../lib/confirm'
import { formatDuration } from '../../lib/time'
import { DownloadCanceledError, downloadImageSource, imageSourceForDisplay, imageSourceForDisplaySync } from '../../lib/platform'
import { useAppStore } from '../../store/app-store'
import { shouldShowFailedImageRetryChip } from '../../generation-retry-display'
import { ErrorDetailsModal } from './ErrorDetailsModal'
import { ImageCallLogModal } from './ImageCallLogModal'
import { ImagePreviewModal } from './ImagePreviewModal'

export function ImageTile({ item }: { item: ImageHistoryItem }) {
  const { addHistoryAsReference, deleteHistory, notify, retryHistory, toggleFavorite } = useAppStore()
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false)
  const [callLogOpen, setCallLogOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [imageSource, setImageSource] = useState<string | null>(() => imageSourceForDisplaySync(item.dataUrl, item.storagePath))
  const showFailedRetryChip = shouldShowFailedImageRetryChip(item.retryAttempt)
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
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(item.prompt)
    notify('提示词已复制')
  }
  const copyImage = async () => {
    if (!item.dataUrl) {
      const copyText = item.storagePath || item.dataUrl
      if (!copyText) return
      await navigator.clipboard.writeText(copyText)
      notify('图片路径已复制')
      return
    }
    if (!item.dataUrl.startsWith('data:')) {
      await navigator.clipboard.writeText(item.storagePath || item.dataUrl)
      notify('图片路径已复制')
      return
    }
    try {
      const blob = dataUrlToBlob(item.dataUrl)
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      notify('图片已复制')
    } catch {
      await navigator.clipboard.writeText(item.dataUrl)
      notify('图片数据已复制')
    }
  }
  const downloadImage = async () => {
    if (!imageSource) return
    try {
      await downloadImageSource(
        item.dataUrl || imageSource,
        `${item.id}.${extensionFromDataUrl(item.dataUrl || item.storagePath || imageSource)}`,
        item.storagePath
      )
      notify('图片已保存')
    } catch (error) {
      if (error instanceof DownloadCanceledError) return
      notify(error instanceof Error ? error.message : '图片下载失败')
    }
  }
  const openPreview = () => {
    if (imageSource) setPreviewOpen(true)
  }
  const deleteItem = async () => {
    if (!(await confirmDestructiveAction('确认删除这张图片记录？'))) return
    await deleteHistory(item.id)
  }

  if (item.status === 'failed') {
    return (
      <article
        className="image-tile failed error-tile group flex min-h-[300px] flex-col overflow-hidden rounded-2xl border border-destructive/25 bg-destructive/5"
        role="button"
        tabIndex={0}
        title="点击查看错误详情"
        onClick={() => setErrorDetailsOpen(true)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setErrorDetailsOpen(true)
        }}
      >
        <div className="image-frame fail-content grid flex-1 place-items-center p-4 text-center">
          <div className="grid gap-2">
            <strong className="text-sm text-destructive">{item.errorMessage || '生成失败'}</strong>
            {showFailedRetryChip ? <Badge variant="destructive" className="retry-chip justify-self-center">{`重试第 ${item.retryAttempt} 次`}</Badge> : null}
            <span className="text-xs text-muted-foreground">点击查看错误详情</span>
          </div>
        </div>
        <div className="tile-actions flex justify-end gap-1 border-t border-destructive/15 p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void retryHistory(item.id)
            }}
            title="重试"
          >
            <RotateCcw size={15} />
          </Button>
          {item.callLog ? (
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setCallLogOpen(true)
              }}
              title="查看调用日志"
            >
              <ScrollText size={15} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void deleteItem()
            }}
            title="删除"
          >
            <Trash2 size={15} />
          </Button>
        </div>
        {errorDetailsOpen ? <ErrorDetailsModal item={item} onClose={() => setErrorDetailsOpen(false)} /> : null}
        {callLogOpen ? <ImageCallLogModal item={item} onClose={() => setCallLogOpen(false)} /> : null}
      </article>
    )
  }

  return (
    <article className="image-tile group flex min-h-[300px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button className="image-frame image-preview-trigger aspect-square w-full overflow-hidden bg-muted" type="button" title="查看大图" onClick={openPreview}>
        {imageSource ? <img className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" src={imageSource} alt={item.prompt} /> : null}
      </button>
      <div className="tile-body grid gap-1 p-3">
        <strong className="line-clamp-2 text-sm leading-5">{item.prompt}</strong>
        <span className="truncate text-xs text-muted-foreground">
          {item.model} · {item.size || item.ratio}
          {item.durationMs != null ? ` · ${formatDuration(item.durationMs)}` : ''}
        </span>
      </div>
      <div className="tile-actions mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border p-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Button variant="ghost" size="icon-sm" type="button" onClick={copyPrompt} title="复制提示词">
            <Copy size={15} />
          </Button>
          {imageSource ? (
            <Button variant="ghost" size="icon-sm" type="button" onClick={() => void downloadImage()} title="下载图片">
              <Download size={15} />
            </Button>
          ) : null}
          {item.callLog ? (
            <Button variant="ghost" size="icon-sm" type="button" onClick={() => setCallLogOpen(true)} title="查看调用日志">
              <ScrollText size={15} />
            </Button>
          ) : null}
          {imageSource ? (
            <ImageTileMoreMenu
              onCopyImage={() => void copyImage()}
              onAddAsReference={() => void addHistoryAsReference(item.id)}
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button className={cn(item.favorite ? 'text-rose-600' : '')} variant="ghost" size="icon-sm" type="button" onClick={() => void toggleFavorite(item)} title="收藏">
            <Heart size={15} fill={item.favorite ? 'currentColor' : 'none'} />
          </Button>
          <Button variant="ghost" size="icon-sm" type="button" onClick={() => void deleteItem()} title="删除">
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      {previewOpen ? <ImagePreviewModal item={item} onClose={() => setPreviewOpen(false)} /> : null}
      {callLogOpen ? <ImageCallLogModal item={item} onClose={() => setCallLogOpen(false)} /> : null}
    </article>
  )
}

function ImageTileMoreMenu({
  onCopyImage,
  onAddAsReference
}: {
  onCopyImage: () => void
  onAddAsReference: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} title="更多操作" aria-label="更多操作">
        <EllipsisVertical size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={() => onCopyImage()}>
          <ImageDown size={15} />
          复制图片
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddAsReference()}>
          <Edit3 size={15} />
          作为参考图编辑
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) return new Blob([dataUrl], { type: 'text/plain' })
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: match[1] })
}

function extensionFromDataUrl(dataUrl: string): string {
  if (!dataUrl.startsWith('data:')) {
    const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(dataUrl)?.[1]?.toLowerCase()
    return extension === 'jpg' || extension === 'jpeg' || extension === 'webp' ? extension : 'png'
  }
  const mimeType = /^data:([^;]+);base64,/i.exec(dataUrl)?.[1] || ''
  if (mimeType.includes('jpeg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  return 'png'
}
