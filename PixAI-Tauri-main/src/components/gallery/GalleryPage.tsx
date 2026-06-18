import { Download, Heart, Search, Square, SquareCheckBig, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ImageTile } from '../workspace/ImageTile'
import { confirmDestructiveAction } from '../../lib/confirm'
import { downloadHistoryImages } from '../../lib/platform'
import { useAppStore } from '../../store/app-store'

export function GalleryPage() {
  const { favoritesOnly, history, query, reloadHistory, setFavoritesOnly, setQuery, deleteHistory, toggleFavorite, notify } = useAppStore()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const filtered = useMemo(() => history.filter((item) => {
    const q = query.trim().toLowerCase()
    return !q || `${item.prompt} ${item.model} ${item.size || ''}`.toLowerCase().includes(q)
  }), [history, query])
  const selectedItems = filtered.filter((item) => selectedIds.includes(item.id))
  const selectableIds = filtered.map((item) => item.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id))

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : selectableIds)
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const downloadSelected = async () => {
    const result = await downloadHistoryImages(selectedItems)
    if (result.savedCount > 0) {
      notify(result.savedCount > 1 ? `已保存 ${result.savedCount} 张图片到所选文件夹` : '已保存 1 张图片')
      return
    }
    if (!result.canceled) notify('没有可下载的图片')
  }

  const deleteSelected = async () => {
    if (!(await confirmDestructiveAction(`确认删除选中的 ${selectedItems.length} 张图片记录？`))) return
    for (const item of selectedItems) {
      await deleteHistory(item.id)
    }
    setSelectedIds([])
  }

  const favoriteSelected = async (favorite: boolean) => {
    for (const item of selectedItems) {
      if (item.favorite !== favorite) await toggleFavorite(item)
    }
  }

  return (
    <section className="page flex h-full min-h-0 flex-col overflow-hidden p-5">
      <div className="page-header mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <span className="eyebrow text-xs font-semibold uppercase tracking-wide text-muted-foreground">图库</span>
          <h1 className="text-2xl font-semibold tracking-normal">跨会话历史</h1>
        </div>
        <div className="toolbar flex flex-wrap items-center justify-end gap-2">
          <label className="search relative min-w-64">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <Search size={15} />
              </span>
              <Input
                className="pl-9"
                value={query}
              placeholder="搜索提示词 / 模型 / 尺寸"
              onChange={(event) => {
                setQuery(event.target.value)
                void reloadHistory({ query: event.target.value })
              }}
            />
          </label>
          <Button type="button" variant={favoritesOnly ? 'secondary' : 'outline'} className={favoritesOnly ? 'active' : ''} onClick={() => void setFavoritesOnly(!favoritesOnly)}>
            <Heart size={15} />
            收藏
          </Button>
          <Button variant="outline" type="button" onClick={toggleSelectAll}>
            {allSelected ? <SquareCheckBig size={15} /> : <Square size={15} />}
            全选
          </Button>
          <Button variant="outline" type="button" onClick={() => void downloadSelected()} disabled={selectedItems.length === 0}>
            <Download size={15} />
            下载
          </Button>
          <Button variant="outline" type="button" onClick={() => void favoriteSelected(true)} disabled={selectedItems.length === 0}>
            <Heart size={15} />
            收藏选中
          </Button>
          <Button variant="outline" type="button" onClick={() => void favoriteSelected(false)} disabled={selectedItems.length === 0}>
            取消收藏
          </Button>
          <Button variant="destructive" type="button" onClick={() => void deleteSelected()} disabled={selectedItems.length === 0}>
            <Trash2 size={15} />
            删除选中
          </Button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state grid flex-1 place-items-center rounded-2xl border border-dashed border-border bg-card text-sm text-muted-foreground">图库还是空的。</div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="gallery-list grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 pr-3">
            {filtered.map((item) => (
              <Card className="gallery-item overflow-hidden rounded-2xl border border-border/80 p-2 shadow-sm ring-0" key={item.id}>
                <label className="selection-row mb-2 flex items-center gap-2 rounded-lg px-1 text-sm text-muted-foreground">
                  <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={() => toggleSelected(item.id)} aria-label="选择图片" />
                  选择
                </label>
                <ImageTile item={item} />
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </section>
  )
}
