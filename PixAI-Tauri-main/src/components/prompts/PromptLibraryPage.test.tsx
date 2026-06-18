import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store/app-store'
import { PromptLibraryPage } from './PromptLibraryPage'

describe('PromptLibraryPage destructive actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAppStore.setState({
      templates: [
        {
          id: 'template-confirm-delete',
          title: '测试模板',
          category: '自定义',
          prompt: '生成一张测试图',
          ratio: '1:1',
          quality: 'high',
          createdAt: '2026-06-02T10:00:00.000Z',
          updatedAt: '2026-06-02T10:00:00.000Z'
        }
      ],
      applyPromptTemplate: vi.fn().mockResolvedValue(undefined),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
      saveTemplate: vi.fn().mockResolvedValue(undefined)
    })
  })

  it('asks before deleting a prompt template', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deleteTemplate = useAppStore.getState().deleteTemplate
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<PromptLibraryPage />)
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="删除"]')?.click()
    })

    expect(confirm).toHaveBeenCalledWith('确认删除这个提示词模板？')
    expect(deleteTemplate).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="删除"]')?.click()
    })

    expect(deleteTemplate).toHaveBeenCalledWith('template-confirm-delete')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
