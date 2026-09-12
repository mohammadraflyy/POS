import { describe, expect, it } from 'vitest'
import { clearSticky, readSticky, writeSticky } from './use-sticky-state'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
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

  it('reads the initial value again once a draft is cleared', () => {
    const storage = fakeStorage()
    writeSticky(storage, 'purchase.draft', { catatan: 'titipan', items: [1] })

    clearSticky(storage, 'purchase.draft')

    // the saved purchase must not come back as a ghost draft on the next visit
    expect(readSticky(storage, 'purchase.draft', { catatan: '', items: [] })).toEqual({ catatan: '', items: [] })
  })

  it('clearing a key nothing was stored under is a no-op', () => {
    const storage = fakeStorage({ 'inventory.search': '"beras"' })

    clearSticky(storage, 'purchase.draft')

    expect(readSticky(storage, 'inventory.search', '')).toBe('beras')
  })
})
