import type { ChangeEvent, ClipboardEvent, CompositionEvent, DragEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Image, Loader2, Maximize2, Sparkles, WandSparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { confirmDestructiveAction } from '../../lib/confirm'
import { imageSourceForDisplay, imageSourceForDisplaySync, isTauriRuntime, readLocalImageFile } from '../../lib/platform'
import { IMAGE_QUALITY_LABELS } from '../../shared/image-options'
import type { Conversation, ReferenceImage } from '../../shared/types'
import { useAppStore } from '../../store/app-store'

const PROMPT_DRAFT_SAVE_DELAY_MS = 250

export function Composer({ conversation, generating }: { conversation: Conversation; generating: boolean }) {
  const {
    enrichPrompt,
    generate,
    importReferenceFiles,
    importReferencePayloads,
    inspirePrompt,
    notify,
    promptAssistantRunning,
    removeReferenceImage,
    updateActiveConversation
  } = useAppStore()
  const synchronousReferenceSources = useMemo(
    () => buildReferenceSourceMap(conversation.referenceImages),
    [conversation.referenceImages]
  )
  const [referenceSources, setReferenceSources] = useState<Record<string, string>>(synchronousReferenceSources)
  const [draftPrompt, setDraftPrompt] = useState(conversation.draftPrompt)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [previewReference, setPreviewReference] = useState<ReferenceImage | null>(null)
  const composingPromptRef = useRef(false)
  const draftPromptRef = useRef(conversation.draftPrompt)
  const persistedDraftPromptRef = useRef(conversation.draftPrompt)
  const promptSaveTimerRef = useRef<number | null>(null)
  const promptSaveVersionRef = useRef(0)
  const previousConversationIdRef = useRef(conversation.id)
  const promptBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => clearPromptSaveTimer(), [])

  useEffect(() => {
    if (previousConversationIdRef.current !== conversation.id) {
      clearPromptSaveTimer()
      composingPromptRef.current = false
      promptSaveVersionRef.current += 1
      previousConversationIdRef.current = conversation.id
      persistedDraftPromptRef.current = conversation.draftPrompt
      draftPromptRef.current = conversation.draftPrompt
      setDraftPrompt(conversation.draftPrompt)
      return
    }

    persistedDraftPromptRef.current = conversation.draftPrompt
    if (composingPromptRef.current || promptSaveTimerRef.current != null) return
    if (draftPromptRef.current === conversation.draftPrompt) return
    draftPromptRef.current = conversation.draftPrompt
    setDraftPrompt(conversation.draftPrompt)
  }, [conversation.id, conversation.draftPrompt])

  useEffect(() => {
    let canceled = false
    setReferenceSources((currentSources) => ({
      ...currentSources,
      ...synchronousReferenceSources
    }))
    void Promise.all(
      conversation.referenceImages.map(async (reference) => [
        reference.id,
        await imageSourceForDisplay(reference.dataUrl, reference.storagePath)
      ] as const)
    ).then((entries) => {
      if (canceled) return
      setReferenceSources(Object.fromEntries(entries.filter((entry): entry is [string, string] => Boolean(entry[1]))))
    })
    return () => {
      canceled = true
    }
  }, [conversation.referenceImages, synchronousReferenceSources])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let disposed = false
    let unlisten: (() => void) | undefined

    const importDroppedPaths = async (paths: string[]) => {
      const imagePaths = paths.filter(isReferenceImagePath)
      if (imagePaths.length === 0) return
      try {
        const payloads = await Promise.all(imagePaths.map((path) => readLocalImageFile(path)))
        await importReferencePayloads(payloads)
      } catch (error) {
        notify(error instanceof Error ? error.message : '参考图添加失败')
      }
    }

    void getCurrentWindow().onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type !== 'drop') return
      if (!isTauriDropInsideElement(payload.position, promptBoxRef.current)) return
      void importDroppedPaths(payload.paths)
    }).then((cleanup) => {
      if (disposed) {
        cleanup()
        return
      }
      unlisten = cleanup
    }).catch((error) => {
      notify(error instanceof Error ? `拖放监听启动失败：${error.message}` : '拖放监听启动失败')
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [importReferencePayloads, notify])

  const onFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return
    void importReferenceFiles(Array.from(files))
  }

  function clearPromptSaveTimer(): void {
    if (promptSaveTimerRef.current == null) return
    window.clearTimeout(promptSaveTimerRef.current)
    promptSaveTimerRef.current = null
  }

  async function persistDraftPromptNow(nextPrompt = draftPromptRef.current): Promise<void> {
    clearPromptSaveTimer()
    if (nextPrompt === persistedDraftPromptRef.current) return
    const saveVersion = promptSaveVersionRef.current + 1
    promptSaveVersionRef.current = saveVersion
    await updateActiveConversation({ draftPrompt: nextPrompt })
    if (promptSaveVersionRef.current !== saveVersion) return
    persistedDraftPromptRef.current = nextPrompt
  }

  function scheduleDraftPromptSave(): void {
    clearPromptSaveTimer()
    if (composingPromptRef.current) return
    if (draftPromptRef.current === persistedDraftPromptRef.current) return
    promptSaveTimerRef.current = window.setTimeout(() => {
      promptSaveTimerRef.current = null
      void persistDraftPromptNow()
    }, PROMPT_DRAFT_SAVE_DELAY_MS)
  }

  function updateDraftPrompt(nextPrompt: string): void {
    draftPromptRef.current = nextPrompt
    setDraftPrompt(nextPrompt)
    scheduleDraftPromptSave()
  }

  function onPromptCompositionStart(): void {
    composingPromptRef.current = true
    clearPromptSaveTimer()
  }

  function onPromptCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>): void {
    composingPromptRef.current = false
    updateDraftPrompt(event.currentTarget.value)
    void persistDraftPromptNow(event.currentTarget.value)
  }

  async function onEnrichPrompt(): Promise<void> {
    await persistDraftPromptNow()
    await enrichPrompt()
  }

  async function onInspirePrompt(): Promise<void> {
    clearPromptSaveTimer()
    await inspirePrompt()
  }

  async function onGenerate(): Promise<void> {
    await persistDraftPromptNow()
    await generate()
  }

  async function onRemoveReferenceImage(referenceId: string): Promise<void> {
    if (!(await confirmDestructiveAction('确认移除这张参考图？'))) return
    await removeReferenceImage(referenceId)
  }

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onFiles(event.dataTransfer.files)
  }

  const onPromptPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = imageFilesFromTransfer(event.clipboardData)
    if (imageFiles.length === 0) return
    event.preventDefault()
    onFiles(imageFiles)
  }

  const onPromptDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (hasImageTransfer(event.dataTransfer)) event.preventDefault()
  }

  const onPromptDrop = (event: DragEvent<HTMLDivElement>) => {
    const imageFiles = imageFilesFromTransfer(event.dataTransfer)
    if (imageFiles.length === 0) return
    event.preventDefault()
    onFiles(imageFiles)
  }

  return (
    <section className="composer rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="composer-head mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="composer-tools flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="pill good">{conversation.referenceImages.length > 0 ? '图生图' : '文生图'}</Badge>
            <Badge variant="outline" className="pill blue">{conversation.size}</Badge>
            <Badge variant="outline" className="pill">已保存</Badge>
          </div>
        </div>
        <div className="composer-actions flex items-center gap-2">
          <Button variant="outline" size="sm" type="button" onClick={() => void onInspirePrompt()} disabled={promptAssistantRunning.inspire}>
            {promptAssistantRunning.inspire ? <Loader2 className="spin animate-spin" /> : <Sparkles />}
            灵感
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={() => void onEnrichPrompt()} disabled={!draftPrompt.trim() || promptAssistantRunning.enrich}>
            {promptAssistantRunning.enrich ? <Loader2 className="spin animate-spin" /> : <WandSparkles />}
            丰富
          </Button>
        </div>
      </div>
      {conversation.referenceImages.length > 0 ? (
        <div className="reference-row mb-3 flex gap-2 overflow-x-auto pb-1">
          {conversation.referenceImages.map((reference) => {
            const source = referenceSources[reference.id] || synchronousReferenceSources[reference.id] || null
            return (
              <div className="reference-thumb group relative size-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted" key={reference.id}>
                <button className="reference-preview-button h-full w-full" type="button" onClick={() => setPreviewReference(reference)} title="查看参考图">
                  {source ? <img className="h-full w-full object-cover" src={source} alt={reference.name} /> : null}
                </button>
                <button
                  className="reference-remove-button absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
                  type="button"
                  onClick={() => void onRemoveReferenceImage(reference.id)}
                  title="移除参考图"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
      <div ref={promptBoxRef} className="prompt-box rounded-xl border border-input bg-background" onDragOver={onPromptDragOver} onDrop={onPromptDrop}>
        <Textarea
          className="prompt-textarea min-h-28 resize-none border-0 bg-transparent p-3 text-base shadow-none focus-visible:ring-0"
          value={draftPrompt}
          placeholder="描述你想生成的画面..."
          onChange={(event) => updateDraftPrompt(event.target.value)}
          onCompositionStart={onPromptCompositionStart}
          onCompositionEnd={onPromptCompositionEnd}
          onPaste={onPromptPaste}
        />
        <div className="prompt-foot flex items-center gap-2 border-t border-border px-2 py-2">
          <label
            className="reference-footer-button inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            title="添加参考图"
          >
            <Image size={17} />
            {conversation.referenceImages.length > 0 ? <span>{conversation.referenceImages.length}</span> : null}
            <input
              className="hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event: ChangeEvent<HTMLInputElement>) => onFiles(event.target.files)}
            />
          </label>
          <div className="hint min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {conversation.ratio} · {conversation.size} · {IMAGE_QUALITY_LABELS[conversation.quality]}
          </div>
          <Button className="prompt-expand-button" variant="ghost" size="icon-sm" type="button" onClick={() => setPromptExpanded(true)} title="放大查看提示词" aria-label="放大查看提示词">
            <Maximize2 size={16} />
          </Button>
          <Button className="generate-button" type="button" onClick={() => void onGenerate()} disabled={!draftPrompt.trim()}>
            {generating ? <Loader2 className="spin animate-spin" /> : <WandSparkles />}
            {generating ? '继续生成' : '生成图片'}
          </Button>
        </div>
      </div>
      {promptExpanded ? (
        <PromptExpandModal
          conversation={conversation}
          draftPrompt={draftPrompt}
          generating={generating}
          onClose={() => setPromptExpanded(false)}
          onGenerate={() => void onGenerate()}
          onPromptChange={updateDraftPrompt}
          onPromptCompositionStart={onPromptCompositionStart}
          onPromptCompositionEnd={onPromptCompositionEnd}
        />
      ) : null}
      {previewReference ? (
        <ReferencePreviewModal
          reference={previewReference}
          source={referenceSources[previewReference.id] || synchronousReferenceSources[previewReference.id] || null}
          onClose={() => setPreviewReference(null)}
        />
      ) : null}
    </section>
  )
}

function imageFilesFromTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return []
  const itemFiles = Array.from(transfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null && isImageFile(file))
  if (itemFiles.length > 0) return itemFiles
  return Array.from(transfer.files || []).filter(isImageFile)
}

function hasImageTransfer(transfer: DataTransfer | null): boolean {
  return imageFilesFromTransfer(transfer).length > 0
}

function isImageFile(file: File): boolean {
  return file.type.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)
}

function isReferenceImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(path)
}

function isTauriDropInsideElement(position: { x: number; y: number }, element: HTMLElement | null): boolean {
  if (!element) return false
  const scaleFactor = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const x = position.x / scaleFactor
  const y = position.y / scaleFactor
  const rect = element.getBoundingClientRect()
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function ReferencePreviewModal({ reference, source, onClose }: { reference: ReferenceImage; source: string | null; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="image-preview-panel max-w-5xl" aria-label="参考图预览" aria-describedby={undefined}>
        <DialogHeader className="image-preview-head">
          <DialogTitle className="truncate">{reference.name}</DialogTitle>
          <span className="text-sm text-muted-foreground">
            {reference.mimeType} · {formatFileSize(reference.fileSizeBytes)}
          </span>
        </DialogHeader>
        <div className="image-preview-stage grid max-h-[72vh] place-items-center overflow-hidden rounded-xl bg-muted">
          {source ? <img className="max-h-[72vh] max-w-full object-contain" src={source} alt={reference.name} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function buildReferenceSourceMap(references: ReferenceImage[]): Record<string, string> {
  return Object.fromEntries(
    references
      .map((reference) => [reference.id, imageSourceForDisplaySync(reference.dataUrl, reference.storagePath)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  )
}

function PromptExpandModal({
  conversation,
  draftPrompt,
  generating,
  onClose,
  onGenerate,
  onPromptChange,
  onPromptCompositionStart,
  onPromptCompositionEnd
}: {
  conversation: Conversation
  draftPrompt: string
  generating: boolean
  onClose: () => void
  onGenerate: () => void
  onPromptChange: (draftPrompt: string) => void
  onPromptCompositionStart: () => void
  onPromptCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="prompt-expand-panel max-w-4xl" aria-label="提示词放大编辑" aria-describedby={undefined}>
        <DialogHeader className="prompt-expand-head">
          <DialogTitle>提示词</DialogTitle>
          <span className="text-sm text-muted-foreground">
            {conversation.ratio} · {conversation.size} · {IMAGE_QUALITY_LABELS[conversation.quality]}
          </span>
        </DialogHeader>
        <Textarea
          className="prompt-expand-textarea min-h-[46vh] resize-none text-base"
          value={draftPrompt}
          placeholder="描述你想生成的画面..."
          autoFocus
          onChange={(event) => onPromptChange(event.target.value)}
          onCompositionStart={onPromptCompositionStart}
          onCompositionEnd={onPromptCompositionEnd}
        />
        <div className="prompt-expand-actions flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{draftPrompt.trim().length} 字符</span>
          <Button
            className="generate-button"
            type="button"
            onClick={() => {
              onClose()
              onGenerate()
            }}
            disabled={!draftPrompt.trim()}
          >
            {generating ? <Loader2 className="spin animate-spin" /> : <WandSparkles />}
            {generating ? '继续生成' : '生成图片'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
