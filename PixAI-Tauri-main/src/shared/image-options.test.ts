import { describe, expect, it } from 'vitest'
import { getDefaultImageSize, getImageSizeOptions, isImageSizeCompatible } from './image-options'

describe('image size presets', () => {
  it('uses reference app defaults for common ratios', () => {
    expect(getDefaultImageSize('1:1')).toBe('1024x1024')
    expect(getDefaultImageSize('16:9')).toBe('1792x1008')
    expect(getDefaultImageSize('9:16')).toBe('1008x1792')
  })

  it('exposes high resolution preset menus by ratio', () => {
    expect(getImageSizeOptions('1:1').map((option) => option.label)).toContain('2K 2048×2048')
    expect(getImageSizeOptions('16:9').map((option) => option.label)).toContain('4K 3840×2160')
    expect(isImageSizeCompatible('16:9', '1792x1008')).toBe(true)
    expect(isImageSizeCompatible('16:9', '1024x1024')).toBe(false)
  })
})
