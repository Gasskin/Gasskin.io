import { describe, expect, it } from 'vitest'
import { shouldShowFailedImageRetryChip } from './generation-retry-display'

describe('generation retry display', () => {
  it('shows retry chips on final failed images after at least one retry', () => {
    expect(shouldShowFailedImageRetryChip(0)).toBe(false)
    expect(shouldShowFailedImageRetryChip(1)).toBe(true)
  })
})
