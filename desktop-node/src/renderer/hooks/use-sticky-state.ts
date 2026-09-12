import { useCallback, useEffect, useRef, useState } from 'react'
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

export function clearSticky(storage: Pick<Storage, 'removeItem'>, key: string): void {
  storage.removeItem(key)
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

/**
 * `useState` for a form the user is filling in, surviving even a restart of the app -
 * localStorage, where `useStickyState` uses sessionStorage. A half-entered purchase is
 * still there tomorrow morning.
 *
 * The third element resets the field *and* drops the stored draft; call it once a save
 * succeeds, or the saved values come back as a ghost draft on the next visit.
 *
 * Only ever put typed input in here. Not rows loaded from the database - a stale price
 * or stock redisplayed as if it were current is worse than an empty form - and never a
 * password: localStorage is plain text on disk.
 */
export function useDraftState<T>(
  key: string,
  initial: T,
  /**
   * Set false while the form is showing a record it loaded rather than something being
   * typed from scratch - an edit form shares its fields with the new-entry form, and
   * storing the loaded record would reopen the next blank form pre-filled from it.
   * Suppresses both the write and the read at mount, so a page that opens straight into
   * edit mode never flashes the new-entry draft. `clear` keeps working either way.
   */
  enabled = true,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  // read once, on the mode the form mounted in; flipping `enabled` later only gates writes
  const [value, setValue] = useState<T>(() => (enabled ? readSticky(localStorage, key, initial) : initial))
  // frozen on first render: callers pass object literals, whose identity changes every
  // render and would otherwise rebuild `clear` (and its callers' effects) endlessly
  const initialRef = useRef(initial)

  useEffect(() => {
    if (!enabled) {
      return
    }

    writeSticky(localStorage, key, value)
  }, [enabled, key, value])

  const clear = useCallback(() => {
    clearSticky(localStorage, key)
    setValue(initialRef.current)
  }, [key])

  return [value, setValue, clear]
}
