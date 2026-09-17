import { useEffect, useState } from 'react'

const DEFAULT_MARGIN = 10

/**
 * One fetch per app session, shared by every component that asks. The price forms render one
 * recommendation per satuan row, and each of those hitting IPC separately would be a burst of
 * identical calls for a value that changes about once a year.
 */
let pending: Promise<number> | null = null

/** call after saving the setting, so pages pick the new value up on their next mount */
export function resetMarginMinimalCache(): void {
  pending = null
}

/** the shop's minimum margin, as a percentage of the selling price */
export function useMarginMinimal(): number {
  const [margin, setMargin] = useState(DEFAULT_MARGIN)

  useEffect(() => {
    let aktif = true

    pending ??= window.api.kasir.getStoreSettings().then((settings) => settings.marginMinimalPersen)

    pending
      .then((value) => {
        if (aktif) {
          setMargin(value)
        }
      })
      .catch(() => {
        // a failed read must not blank the hint; the default is a usable floor
        pending = null
      })

    return () => {
      aktif = false
    }
  }, [])

  return margin
}
