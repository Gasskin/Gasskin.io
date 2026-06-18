import { Copy, Pencil, Plus, Trash2, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { confirmDestructiveAction } from '../../lib/confirm'
import type { PromptTemplate } from '../../shared/types'
import { useAppStore } from '../../store/app-store'

export function PromptLibraryPage() {
  const { applyPromptTemplate, deleteTemplate, notify, saveTemplate, templates } = useAppStore()
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<PromptTemplate | null>(null)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return templates.filter((template) => !q || `${template.title} ${template.category} ${template.prompt}`.toLowerCase().includes(q))
  }, [query, templates])

  const copyPrompt = async (prompt: string) => {
    await navigator.clipboard.writeText(prompt)
    notify('提示词已复制')
  }

  const deletePromptTemplate = async (id: string) => {
    if (!(await confirmDestructiveAction('确认删除这个提示词模板？'))) return
    await deleteTemplate(id)
  }

  return (
    <section className="page flex h-full min-h-0 flex-col overflow-hidden p-5">
      <div className="page-header mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <span className="eyebrow text-xs font-semibold uppercase tracking-wide text-muted-foreground">提示词库</span>
          <h1 className="text-2xl font-semibold tracking-normal">提示词库</h1>
        </div>
        <div className="toolbar flex items-center gap-2">
          <Input className="w-64" value={query} placeholder="搜索模板" onChange={(event) => setQuery(event.target.value)} />
          <Button
            type="button"
            onClick={() =>
              setDraft({
                id: '',
                title: '',
                category: '自定义',
                prompt: '',
                ratio: '1:1',
                quality: 'high',
                createdAt: '',
                updatedAt: ''
              })
            }
          >
            <Plus size={15} />
            新建
          </Button>
        </div>
      </div>
      {draft ? (
        <form
          className="template-editor mb-4 grid shrink-0 gap-3 rounded-2xl border border-border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void saveTemplate({
              id: draft.id || undefined,
              title: draft.title,
              category: draft.category,
              prompt: draft.prompt,
              ratio: draft.ratio,
              quality: draft.quality
            }).then(() => setDraft(null))
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Input value={draft.title} placeholder="标题" onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            <Input value={draft.category} placeholder="分类" onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
          </div>
          <Textarea className="min-h-28" value={draft.prompt} placeholder="提示词正文" onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} />
          <div className="button-row flex justify-end gap-2">
            <Button type="submit">保存模板</Button>
            <Button variant="outline" type="button" onClick={() => setDraft(null)}>
              取消
            </Button>
          </div>
        </form>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="template-grid grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 pr-3">
          {filtered.map((template) => (
            <Card className="template-card rounded-2xl border border-border/80 shadow-sm ring-0" key={template.id}>
              <CardHeader>
                <span className="text-xs font-medium text-muted-foreground">{template.category}</span>
                <CardTitle className="line-clamp-1 text-base">{template.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-5 text-sm leading-6 text-muted-foreground">{template.prompt}</p>
              </CardContent>
              <CardFooter className="tile-actions justify-end gap-1">
                <Button variant="ghost" size="icon-sm" type="button" onClick={() => void applyPromptTemplate(template)} title="套用">
                  <WandSparkles size={15} />
                </Button>
                <Button variant="ghost" size="icon-sm" type="button" onClick={() => void copyPrompt(template.prompt)} title="复制">
                  <Copy size={15} />
                </Button>
                <Button variant="ghost" size="icon-sm" type="button" onClick={() => setDraft(template)} title="编辑">
                  <Pencil size={15} />
                </Button>
                <Button variant="ghost" size="icon-sm" type="button" onClick={() => void deletePromptTemplate(template.id)} title="删除">
                  <Trash2 size={15} />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </section>
  )
}
