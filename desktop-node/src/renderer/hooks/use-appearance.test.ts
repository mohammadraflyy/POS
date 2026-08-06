import { describe, expect, it } from 'vitest'
import { isDarkMode } from './use-appearance'

describe('isDarkMode', () => {
  it('is true for "dark"', () => {
    expect(isDarkMode('dark')).toBe(true)
  })

  it('is false for "light"', () => {
    expect(isDarkMode('light')).toBe(false)
  })

  it('falls back to false for "system" when there is no window (this test environment)', () => {
    expect(isDarkMode('system')).toBe(false)
  })
})
