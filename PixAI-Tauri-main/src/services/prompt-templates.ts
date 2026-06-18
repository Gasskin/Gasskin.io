import { createId } from '../lib/ids'
import { readJsonState, writeJsonState } from '../lib/platform'
import { nowIso } from '../lib/time'
import type { PromptTemplate, PromptTemplateInput } from '../shared/types'

const STATE_NAME = 'prompt-templates'

const seeds: PromptTemplate[] = [
  {
    id: 'template-cinematic-portrait',
    title: '电影感人像',
    category: '人像',
    prompt: '电影感人像，柔和侧逆光，浅景深，真实皮肤纹理，优雅构图，细腻情绪，高级调色',
    ratio: '3:4',
    quality: 'high',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'template-product-studio',
    title: '产品棚拍',
    category: '产品',
    prompt: '高端产品棚拍，干净背景，柔光箱反射，精确材质细节，商业广告构图，清晰锐利',
    ratio: '1:1',
    quality: 'high',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
]

export class PromptTemplateStore {
  private templates: PromptTemplate[] | null = null

  async list(): Promise<PromptTemplate[]> {
    await this.load()
    return [...this.requireTemplates()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async upsert(input: PromptTemplateInput & { id?: string }): Promise<PromptTemplate> {
    await this.load()
    const templates = this.requireTemplates()
    const current = input.id ? templates.find((template) => template.id === input.id) : null
    const now = nowIso()
    const template: PromptTemplate = {
      id: current?.id || createId('template'),
      title: input.title?.trim() || current?.title || '未命名模板',
      category: input.category?.trim() || current?.category || '自定义',
      prompt: input.prompt?.trim() || current?.prompt || '',
      ratio: input.ratio || current?.ratio || '1:1',
      quality: input.quality || current?.quality || 'high',
      createdAt: current?.createdAt || now,
      updatedAt: now
    }
    this.templates = current
      ? templates.map((item) => (item.id === current.id ? template : item))
      : [template, ...templates]
    await this.save()
    return template
  }

  async delete(id: string): Promise<void> {
    await this.load()
    this.templates = this.requireTemplates().filter((template) => template.id !== id)
    await this.save()
  }

  private async load(): Promise<void> {
    if (this.templates) return
    const payload = await readJsonState(STATE_NAME)
    if (payload) {
      try {
        const parsed = JSON.parse(payload) as PromptTemplate[]
        this.templates = Array.isArray(parsed) ? parsed : seeds
        return
      } catch {
        // Use seeded templates when persisted data is corrupt.
      }
    }
    this.templates = seeds
    await this.save()
  }

  private requireTemplates(): PromptTemplate[] {
    if (!this.templates) throw new Error('Prompt templates are not loaded.')
    return this.templates
  }

  private async save(): Promise<void> {
    await writeJsonState(STATE_NAME, JSON.stringify(this.requireTemplates(), null, 2))
  }
}
