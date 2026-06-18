import { afterEach, describe, expect, it } from 'vitest'
import { applyDocumentTheme } from './theme'

describe('applyDocumentTheme', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.style.removeProperty('color-scheme')
  })

  it('puts dark mode on the document root so portal content inherits theme variables', () => {
    const cleanup = applyDocumentTheme(true)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')

    cleanup()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('')
  })

  it('clears root dark mode when switching back to light mode', () => {
    document.documentElement.classList.add('dark')

    applyDocumentTheme(false)

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
