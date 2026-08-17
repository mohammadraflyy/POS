import { useSyncExternalStore } from 'react'

export type ResolvedAppearance = 'light' | 'dark'
export type Appearance = ResolvedAppearance | 'system'

export type UseAppearanceReturn = {
  readonly appearance: Appearance
  readonly resolvedAppearance: ResolvedAppearance
  readonly updateAppearance: (mode: Appearance) => void
}

const DEFAULT_APPEARANCE: Appearance = 'dark'

const listeners = new Set<() => void>()
let currentAppearance: Appearance = DEFAULT_APPEARANCE

const prefersDark = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const getStoredAppearance = (): Appearance => {
  if (typeof window === 'undefined') {
    return DEFAULT_APPEARANCE
  }

  return (localStorage.getItem('appearance') as Appearance) || DEFAULT_APPEARANCE
}

export const isDarkMode = (appearance: Appearance): boolean => {
  return appearance === 'dark' || (appearance === 'system' && prefersDark())
}

const applyTheme = (appearance: Appearance): void => {
  if (typeof document === 'undefined') {
    return
  }

  const isDark = isDarkMode(appearance)

  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'

  // The native title bar is hidden, so the window-controls overlay is painted
  // by the main process and has to be repainted alongside the page theme.
  window.api?.app?.setTitleBarTheme(isDark)
}

const subscribe = (callback: () => void) => {
  listeners.add(callback)

  return () => listeners.delete(callback)
}

const notify = (): void => listeners.forEach((listener) => listener())

const mediaQuery = (): MediaQueryList | null => {
  if (typeof window === 'undefined') {
    return null
  }

  return window.matchMedia('(prefers-color-scheme: dark)')
}

const handleSystemThemeChange = (): void => {
  applyTheme(currentAppearance)
  notify()
}

export function initializeTheme(): void {
  if (typeof window === 'undefined') {
    return
  }

  if (!localStorage.getItem('appearance')) {
    localStorage.setItem('appearance', DEFAULT_APPEARANCE)
  }

  currentAppearance = getStoredAppearance()
  applyTheme(currentAppearance)

  mediaQuery()?.addEventListener('change', handleSystemThemeChange)
}

export function useAppearance(): UseAppearanceReturn {
  const appearance: Appearance = useSyncExternalStore(
    subscribe,
    () => currentAppearance,
    () => DEFAULT_APPEARANCE,
  )

  const resolvedAppearance: ResolvedAppearance = isDarkMode(appearance)
    ? 'dark'
    : 'light'

  const updateAppearance = (mode: Appearance): void => {
    currentAppearance = mode
    localStorage.setItem('appearance', mode)
    applyTheme(mode)
    notify()
  }

  return { appearance, resolvedAppearance, updateAppearance } as const
}
