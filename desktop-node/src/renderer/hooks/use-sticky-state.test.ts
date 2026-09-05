import { describe, expect, it } from 'vitest'
import { readSticky, writeSticky } from './use-sticky-state'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('sticky state storage', () => {
  it('falls back to the initial value when nothing is stored', () => {
    expect(readSticky(fakeStorage(), 'inventory.search', '')).toBe('')
  })

  it('falls back to the initial value when the stored entry is corrupt', () => {
    expect(readSticky(fakeStorage({ 'opname.categoryIds': '[3,' }), 'opname.categoryIds', [])).toEqual([])
  })

  it('round-trips a value through the storage', () => {
    const storage = fakeStorage()

    writeSticky(storage, 'opname.categoryIds', [3, 7])

    expect(readSticky(storage, 'opname.categoryIds', [])).toEqual([3, 7])
  })
})
