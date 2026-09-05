import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/**
 * Reads a persisted value, falling back to `initial` when it is missing or
 * corrupt (a hand-edited or half-written entry must not break the page).
 */
export function readSticky<T>(storage: Pick<Storage, 'getItem'>, key: string, initial: T): T {
  const raw = storage.getItem(key)

  if (raw === null) {
    return initial
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return initial
  }
}

export function writeSticky<T>(storage: Pick<Storage, 'setItem'>, key: string, value: T): void {
  storage.setItem(key, JSON.stringify(value))
}

/**
 * `useState` that survives a remount for the rest of the app session. Used for
 * table filters, which would otherwise reset every time a page navigates away
 * to an editor and back.
 */
export function useStickyState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readSticky(sessionStorage, key, initial))

  useEffect(() => {
    writeSticky(sessionStorage, key, value)
  }, [key, value])

  return [value, setValue]
}
