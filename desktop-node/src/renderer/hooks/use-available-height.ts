import { useCallback, useEffect, useState } from 'react'

/** Tracks how much viewport height remains below an element, for grids that should fill the screen without growing the whole page. */
export function useAvailableHeight<T extends HTMLElement>(bottomReserve = 0) {
  const [el, setEl] = useState<T | null>(null)
  const [height, setHeight] = useState(0)
  const ref = useCallback((node: T | null) => setEl(node), [])

  useEffect(() => {
    if (!el) {
      return
    }

    const node = el

    function measure() {
      const top = node.getBoundingClientRect().top
      setHeight(Math.max(200, window.innerHeight - top - bottomReserve))
    }

    measure()
    window.addEventListener('resize', measure)

    return () => window.removeEventListener('resize', measure)
  }, [el, bottomReserve])

  return [ref, height] as const
}
