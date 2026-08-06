# Fase 2 Slice 2, Plan A — Styling Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Tailwind v4 and a minimal, verbatim-ported set of 7 shadcn/ui components + 3 supporting utils/hooks in `desktop-node/`, so Plan B can build the real Kasir cart/payment UI on top of a working, visually-correct styling foundation.

**Architecture:** Port CSS theme, `cn`/`formatRupiah` utils, and `useAppearance` dark-mode hook byte-for-byte from the source-of-truth web app (`resources/js/...`), adapted only where Electron genuinely differs from a server-rendered Inertia app (no SSR cookie, no Blade `@source` scanning). Components are not wired into any page yet — that's Plan B.

**Tech Stack:** Tailwind v4 (`@tailwindcss/vite`), Radix UI primitives (`@radix-ui/react-dialog`, `@radix-ui/react-label`, `@radix-ui/react-slot`), `cmdk` (Command palette primitive), `class-variance-authority`, `lucide-react`, `clsx` + `tailwind-merge`.

## Global Constraints

- New/modified code lives entirely under `desktop-node/`. Do not touch `app/`, `routes/`, `resources/`, `nativephp/`, or any other Laravel file — those are the read-only source of truth being ported from, not modified.
- Every ported file (CSS theme, components, utils, hook) must match its Laravel source **verbatim** except for the specific, named adaptations listed in each task (no SSR cookie in `useAppearance`, no Blade `@source` scanning in the CSS, `formatRupiah` takes a plain `number` not `number | string`).
- Components in this plan are **not** wired into any renderer page — `Kasir.tsx`/`Login.tsx` are untouched. Plan B does the wiring. Verification here is `tsc --noEmit` plus, for Task 1 only, a real runtime check that the Tailwind pipeline actually produces CSS (a misconfigured PostCSS/Vite plugin is a common silent failure mode).
- `better-sqlite3`'s native ABI: this plan's Task 1 needs `npm run dev` once for a real runtime check. Before that step, run `npm run rebuild:electron`; after it, run `npm run rebuild:node` (or `npm rebuild better-sqlite3`) to leave the tree on the plain-Node ABI other tasks' `npm test` needs. Tasks 2-6 only need `tsc --noEmit` and `npm test` — do not run `npm run dev` or touch the ABI in those tasks.
- The `@` import alias resolves to `desktop-node/src/renderer` in the Vite bundler (`electron.vite.config.ts`) but was pointing at `desktop-node/src` in `tsconfig.json` — a pre-existing mismatch that happens to be harmless today because nothing uses the `@` alias yet. Task 1 fixes `tsconfig.json` to match Vite's actual mapping before any task relies on it.

---

## Task 1: Tailwind v4 setup

**Files:**
- Modify: `desktop-node/package.json`
- Modify: `desktop-node/electron.vite.config.ts`
- Modify: `desktop-node/tsconfig.json`
- Modify: `desktop-node/src/renderer/assets/main.css`

**Interfaces:**
- Consumes: nothing.
- Produces: a working Tailwind v4 pipeline (utility classes resolve to real CSS at runtime) and CSS custom properties (`--background`, `--foreground`, `--primary`, etc., light + dark) on `:root`/`.dark` — consumed by every component in Tasks 4-6 and by Plan B. A corrected `@/*` → `src/renderer/*` path alias in `tsconfig.json` — consumed by every task in this plan that imports via `@/...`.

- [ ] **Step 1: Add the Tailwind dependencies**

```bash
cd desktop-node
npm install -D tailwindcss @tailwindcss/vite tw-animate-css
```

- [ ] **Step 2: Wire the Tailwind Vite plugin into the renderer build**

`desktop-node/electron.vite.config.ts` currently reads:

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['fsevents']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['fsevents']
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        external: ['fsevents']
      }
    }
  }
})
```

Add the `@tailwindcss/vite` import and plugin to the `renderer` section only (keep `main`/`preload` untouched):

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['fsevents']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['fsevents']
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        external: ['fsevents']
      }
    }
  }
})
```

- [ ] **Step 3: Fix the `@` path alias in tsconfig.json to match Vite's actual mapping**

`desktop-node/tsconfig.json` currently has:

```json
    "paths": {
      "@/*": ["src/*"]
    }
```

Change it to match `electron.vite.config.ts`'s renderer alias (`@` → `src/renderer`):

```json
    "paths": {
      "@/*": ["src/renderer/*"]
    }
```

- [ ] **Step 4: Replace the renderer's CSS with the Tailwind theme**

`desktop-node/src/renderer/assets/main.css` currently has the electron-vite scaffold's default Vite-starter CSS (hardcoded dark colors, centered flex body, etc.) — this actively conflicts with Tailwind/shadcn styling and must be fully replaced, not appended to. Replace the entire file with:

```css
@import 'tailwindcss';

@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

@theme {
  --font-sans:
    'Instrument Sans', ui-sans-serif, system-ui, sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol',
    'Noto Color Emoji';

  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);

  --color-background: var(--background);
  --color-foreground: var(--foreground);

  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);

  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);

  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);

  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);

  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);

  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);

  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);

  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.87 0 0);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.145 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.145 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.396 0.141 25.723);
  --destructive-foreground: oklch(0.637 0.237 25.331);
  --border: oklch(0.269 0 0);
  --input: oklch(0.269 0 0);
  --ring: oklch(0.439 0 0);
}

@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
  }
}
```

Note what was deliberately left out of this port, matching the plan's scope: the `--chart-*`/`--sidebar-*` CSS variables from the web app's theme (unused by any of the 7 components this plan ports — add them later if a future component needs them), the Blade-specific `@source` directives (Vite scans the project automatically, no Laravel views to point at), and the `@page`/`.receipt-print` print CSS (that belongs to Plan C, not this plan).

- [ ] **Step 5: Verify the Tailwind pipeline actually produces CSS at runtime**

This is a real runtime check, not just a typecheck — a misconfigured Tailwind/Vite plugin is a common silent failure (the app still builds, just with no styling). Switch to the Electron ABI, launch the app, and use Chrome DevTools Protocol to confirm both the theme's CSS custom properties and a plain Tailwind utility class are actually applied:

```bash
cd desktop-node
npm run rebuild:electron
```

Launch `npm run dev` in the background (or with a timeout), connect via CDP (Node's built-in `WebSocket`, `--remote-debugging-port`, poll `/json/version` for the target — the same technique used in this project's earlier plans), and evaluate:

```javascript
(() => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
  const probe = document.createElement('div')
  probe.className = 'bg-red-500'
  document.body.appendChild(probe)
  const bgColor = getComputedStyle(probe).backgroundColor
  probe.remove()
  return { customPropertyBackground: bg, tailwindUtilityBgColor: bgColor }
})()
```

Expected: `customPropertyBackground` is a non-empty `oklch(...)` string (proves the `:root` theme block loaded), and `tailwindUtilityBgColor` is `rgb(239, 68, 68)` (Tailwind's `red-500` — proves the utility-class pipeline itself works, not just that the CSS file was included verbatim). If either check fails, the Tailwind plugin or CSS import is misconfigured — do not proceed to later tasks until this passes.

After verifying, stop the dev process and switch back:

```bash
npm run rebuild:node
```

- [ ] **Step 6: Run the existing test suite and typecheck to confirm nothing broke**

```bash
cd desktop-node
npm run test
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
```

Expected: all existing tests still pass (this task added no new `.test.ts` files), both typechecks clean.

- [ ] **Step 7: Commit**

```bash
cd C:\Work\POS
git add desktop-node/package.json desktop-node/package-lock.json desktop-node/electron.vite.config.ts desktop-node/tsconfig.json desktop-node/src/renderer/assets/main.css
git commit -m "Add Tailwind v4 pipeline and port the shadcn/ui color theme"
```

---

## Task 2: `cn` and `formatRupiah` utils

**Files:**
- Create: `desktop-node/src/renderer/lib/utils.ts`
- Create: `desktop-node/src/renderer/lib/utils.test.ts`

**Interfaces:**
- Consumes: `clsx`, `tailwind-merge` (new dependencies, this task).
- Produces: `cn(...inputs: ClassValue[]): string`, `formatRupiah(value: number): string` — consumed by every component in Tasks 4-6 and by Plan B's `Kasir.tsx`.

- [ ] **Step 1: Add the dependencies**

```bash
cd desktop-node
npm install clsx tailwind-merge
```

- [ ] **Step 2: Write the failing tests**

Create `desktop-node/src/renderer/lib/utils.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { cn, formatRupiah } from './utils'

describe('cn', () => {
  it('merges class names and resolves Tailwind conflicts (last one wins)', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b')
  })
})

describe('formatRupiah', () => {
  it('formats a whole Rupiah amount with thousand separators', () => {
    expect(formatRupiah(15000)).toBe('Rp 15.000')
  })

  it('formats zero', () => {
    expect(formatRupiah(0)).toBe('Rp 0')
  })

  it('formats a large amount', () => {
    expect(formatRupiah(1250000)).toBe('Rp 1.250.000')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd desktop-node
npm run test
```

Expected: FAIL — `lib/utils.ts` does not exist.

- [ ] **Step 4: Write the implementation**

Create `desktop-node/src/renderer/lib/utils.ts`. This is a verbatim port of `resources/js/lib/utils.ts`'s `cn`, minus the Inertia-specific `toUrl` helper (not used anywhere in this plan or Plan B/C's scope), and `formatRupiah` adapted to take a plain `number` — desktop-node's IPC layer already converts cents to a Rupiah `number` at the boundary (Slice 1), unlike Laravel which sends decimal strings:

```typescript
import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(value)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd desktop-node
npm run test
```

Expected: PASS — all new tests plus everything from Slice 1 and Task 1.

- [ ] **Step 6: Commit**

```bash
cd C:\Work\POS
git add desktop-node/package.json desktop-node/package-lock.json desktop-node/src/renderer/lib/utils.ts desktop-node/src/renderer/lib/utils.test.ts
git commit -m "Add cn and formatRupiah renderer utils"
```

---

## Task 3: `useAppearance` dark-mode hook

**Files:**
- Create: `desktop-node/src/renderer/hooks/use-appearance.ts`
- Create: `desktop-node/src/renderer/hooks/use-appearance.test.ts`
- Modify: `desktop-node/src/renderer/main.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Appearance`/`ResolvedAppearance` types, `isDarkMode(appearance: Appearance): boolean` (exported for testing), `useAppearance(): UseAppearanceReturn`, `initializeTheme(): void` — consumed by Plan B's `Kasir.tsx` (`resolvedAppearance` is used to pick `react-data-grid`'s `rdg-dark`/`rdg-light` class, per the source-of-truth `kasir.tsx`).

- [ ] **Step 1: Write the failing test**

Create `desktop-node/src/renderer/hooks/use-appearance.test.ts`. This tests only the exported pure decision function, not the full `useSyncExternalStore`-based hook (which needs a real DOM/localStorage to exercise meaningfully — out of scope for this plan; Plan B's manual/CDP verification exercises the hook for real once it's wired into a page). Run under Vitest's default Node environment (no `window`/`document`), so `'system'` deterministically resolves to `false` here — that's the behavior being verified, not a limitation of the test:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd desktop-node
npm run test
```

Expected: FAIL — `hooks/use-appearance.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `desktop-node/src/renderer/hooks/use-appearance.ts`. This is a port of `resources/js/hooks/use-appearance.tsx` with one adaptation: the `setCookie` calls are removed (they existed only so Inertia's server-side render could read the theme cookie on the next page load — Electron has no SSR, so `localStorage` alone is sufficient), and `isDarkMode` gains an `export` keyword so it's directly testable:

```typescript
import { useSyncExternalStore } from 'react'

export type ResolvedAppearance = 'light' | 'dark'
export type Appearance = ResolvedAppearance | 'system'

export type UseAppearanceReturn = {
  readonly appearance: Appearance
  readonly resolvedAppearance: ResolvedAppearance
  readonly updateAppearance: (mode: Appearance) => void
}

const listeners = new Set<() => void>()
let currentAppearance: Appearance = 'system'

const prefersDark = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const getStoredAppearance = (): Appearance => {
  if (typeof window === 'undefined') {
    return 'system'
  }

  return (localStorage.getItem('appearance') as Appearance) || 'system'
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

const handleSystemThemeChange = (): void => applyTheme(currentAppearance)

export function initializeTheme(): void {
  if (typeof window === 'undefined') {
    return
  }

  if (!localStorage.getItem('appearance')) {
    localStorage.setItem('appearance', 'system')
  }

  currentAppearance = getStoredAppearance()
  applyTheme(currentAppearance)

  mediaQuery()?.addEventListener('change', handleSystemThemeChange)
}

export function useAppearance(): UseAppearanceReturn {
  const appearance: Appearance = useSyncExternalStore(
    subscribe,
    () => currentAppearance,
    () => 'system',
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
```

- [ ] **Step 4: Call `initializeTheme()` at app startup**

`desktop-node/src/renderer/main.tsx` currently reads:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

Add the `initializeTheme` import and call it once before rendering, so the correct light/dark class is on `<html>` before React ever paints (avoids a flash of the wrong theme):

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initializeTheme } from './hooks/use-appearance'
import './assets/main.css'

initializeTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd desktop-node
npm run test
```

Expected: PASS — all tests from Tasks 1-2 plus the 3 new `isDarkMode` tests.

- [ ] **Step 6: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/hooks/use-appearance.ts desktop-node/src/renderer/hooks/use-appearance.test.ts desktop-node/src/renderer/main.tsx
git commit -m "Add useAppearance dark-mode hook"
```

---

## Task 4: Button, Badge, Input, Label components

**Files:**
- Create: `desktop-node/src/renderer/components/ui/button.tsx`
- Create: `desktop-node/src/renderer/components/ui/badge.tsx`
- Create: `desktop-node/src/renderer/components/ui/input.tsx`
- Create: `desktop-node/src/renderer/components/ui/label.tsx`

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces: `Button`, `buttonVariants`, `Badge`, `badgeVariants`, `Input`, `Label` — consumed by Plan B's `Kasir.tsx` and by Task 5's Dialog (`DialogClose` styling references button-like classes but does not import `Button` directly — no cross-dependency here).

- [ ] **Step 1: Add the dependencies**

```bash
cd desktop-node
npm install class-variance-authority @radix-ui/react-slot @radix-ui/react-label
```

- [ ] **Step 2: Port Button**

Create `desktop-node/src/renderer/components/ui/button.tsx` — verbatim port of `resources/js/components/ui/button.tsx`:

```typescript
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
```

- [ ] **Step 3: Port Badge**

Create `desktop-node/src/renderer/components/ui/badge.tsx` — verbatim port of `resources/js/components/ui/badge.tsx`:

```typescript
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline: 'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
```

- [ ] **Step 4: Port Input**

Create `desktop-node/src/renderer/components/ui/input.tsx` — verbatim port of `resources/js/components/ui/input.tsx`:

```typescript
import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
```

- [ ] **Step 5: Port Label**

Create `desktop-node/src/renderer/components/ui/label.tsx` — verbatim port of `resources/js/components/ui/label.tsx`:

```typescript
import * as LabelPrimitive from '@radix-ui/react-label'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
```

- [ ] **Step 6: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors. (This is the first real exercise of the `@/*` → `src/renderer/*` alias fixed in Task 1 — if this fails with a "cannot find module '@/lib/utils'" error, the alias fix didn't take; double-check `tsconfig.json`.)

- [ ] **Step 7: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — this task adds no new test files, this just confirms nothing broke.

- [ ] **Step 8: Commit**

```bash
cd C:\Work\POS
git add desktop-node/package.json desktop-node/package-lock.json desktop-node/src/renderer/components/ui/button.tsx desktop-node/src/renderer/components/ui/badge.tsx desktop-node/src/renderer/components/ui/input.tsx desktop-node/src/renderer/components/ui/label.tsx
git commit -m "Port Button, Badge, Input, Label shadcn/ui components"
```

---

## Task 5: Dialog and Spinner components

**Files:**
- Create: `desktop-node/src/renderer/components/ui/dialog.tsx`
- Create: `desktop-node/src/renderer/components/ui/spinner.tsx`

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces: `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `Spinner` — consumed by Plan B's `Kasir.tsx` (payment dialog) and by Task 6's `Command` (built on top of `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`).

- [ ] **Step 1: Add the dependency**

```bash
cd desktop-node
npm install @radix-ui/react-dialog
```

(`lucide-react` is needed by both files in this task but is added once, in Task 6, since Command also needs it and installing it twice is wasteful — **actually**, since this task needs it first, add it here instead and skip re-adding in Task 6.)

```bash
npm install lucide-react
```

- [ ] **Step 2: Port Dialog**

Create `desktop-node/src/renderer/components/ui/dialog.tsx` — verbatim port of `resources/js/components/ui/dialog.tsx`:

```typescript
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
```

- [ ] **Step 3: Port Spinner**

Create `desktop-node/src/renderer/components/ui/spinner.tsx` — verbatim port of `resources/js/components/ui/spinner.tsx`:

```typescript
import { Loader2Icon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
```

- [ ] **Step 4: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 5: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — no new test files in this task.

- [ ] **Step 6: Commit**

```bash
cd C:\Work\POS
git add desktop-node/package.json desktop-node/package-lock.json desktop-node/src/renderer/components/ui/dialog.tsx desktop-node/src/renderer/components/ui/spinner.tsx
git commit -m "Port Dialog and Spinner shadcn/ui components"
```

---

## Task 6: Command and CommandDialog components

**Files:**
- Create: `desktop-node/src/renderer/components/ui/command.tsx`

**Interfaces:**
- Consumes: `cn` (Task 2), `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription` (Task 5).
- Produces: `Command`, `CommandDialog`, `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandList`, `CommandSeparator`, `CommandShortcut` — consumed by Plan B's `Kasir.tsx` (product-search command palette).

- [ ] **Step 1: Add the dependency**

```bash
cd desktop-node
npm install cmdk
```

- [ ] **Step 2: Port Command**

Create `desktop-node/src/renderer/components/ui/command.tsx` — verbatim port of `resources/js/components/ui/command.tsx`:

```typescript
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import * as React from 'react'

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md',
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  shouldFilter,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  shouldFilter?: boolean
  onCloseAutoFocus?: React.ComponentProps<typeof DialogContent>['onCloseAutoFocus']
}) {
  return (
    <Dialog {...props}>
      <DialogContent className={cn('overflow-hidden p-0', className)} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={shouldFilter}
          className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-9 items-center gap-2 border-b px-3">
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto', className)}
      {...props}
    />
  )
}

function CommandEmpty({ ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className="py-6 text-center text-sm" {...props} />
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator data-slot="command-separator" className={cn('bg-border -mx-1 h-px', className)} {...props} />
  )
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('text-muted-foreground ml-auto text-xs tracking-widest', className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 4: Run the full test suite one final time**

```bash
cd desktop-node
npm run test
```

Expected: PASS — every test from Slice 1 and this plan (Tasks 1-3's new tests), nothing broken by the component ports.

- [ ] **Step 5: Commit**

```bash
cd C:\Work\POS
git add desktop-node/package.json desktop-node/package-lock.json desktop-node/src/renderer/components/ui/command.tsx
git commit -m "Port Command and CommandDialog shadcn/ui components"
```

---

## Self-Review Notes

- **Spec coverage:** Tailwind v4 pipeline + theme ✅ (Task 1), `cn`/`formatRupiah` ✅ (Task 2), `useAppearance` (cookie/SSR dropped, as specified) ✅ (Task 3), all 7 named shadcn/ui components (`Button`, `Input`, `Label`, `Badge`, `Dialog`, `Command`, `Spinner`) ✅ (Tasks 4-6). Wiring these into `Kasir.tsx`, the cart grid, payment dialog, command palette, and print CSS are explicitly Plan B/C scope, not here.
- **No placeholders:** every step has complete, runnable code or exact commands. The one CSS variable set (`--chart-*`/`--sidebar-*`) intentionally omitted from Task 1 is explained inline, not left as a TODO.
- **Type consistency:** `cn` (Task 2) is imported identically (`from '@/lib/utils'`) by every component in Tasks 4-6, matching the `@/*` → `src/renderer/*` alias fixed in Task 1. `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription` exported from Task 5 are imported by name in Task 6's `command.tsx` with matching names — no renames introduced.
