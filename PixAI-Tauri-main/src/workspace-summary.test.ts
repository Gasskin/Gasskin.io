import { describe, expect, it } from 'vitest'
import type { ImageHistoryItem } from './shared/types'
import { formatWorkspaceResultSummary, getWorkspaceResultSummarySegments } from './workspace-summary'

describe('workspace result summary', () => {
  it('counts total, succeeded, failed, and generating items', () => {
    const items = [
      { status: 'succeeded' },
      { status: 'failed' },
      { status: 'succeeded' }
    ] as ImageHistoryItem[]

    expect(formatWorkspaceResultSummary(items, 2)).toBe('共 5 条 · 成功 2 · 失败 1 · 生成中 2')
  })

  it('returns highlighted summary segments', () => {
    expect(getWorkspaceResultSummarySegments([{ status: 'failed' }] as ImageHistoryItem[], 1)).toEqual([
      { key: 'total', label: '共', value: 2, suffix: '条', tone: 'total' },
      { key: 'succeeded', label: '成功', value: 0, tone: 'success' },
      { key: 'failed', label: '失败', value: 1, tone: 'danger' },
      { key: 'generating', label: '生成中', value: 1, tone: 'active' }
    ])
  })
})
