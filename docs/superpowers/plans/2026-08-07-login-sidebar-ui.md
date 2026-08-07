# Login UI + App Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `desktop-node`'s Login page the web app's branded split-screen design, and give Kasir/History/Bon Payment a shared navigation sidebar (matching `resources/js/components/app-sidebar.tsx`), replacing the ad-hoc per-page auth-check and header buttons.

**Architecture:** Port the shadcn `Sidebar` primitive and its supporting nav components from the web app into `desktop-node`'s renderer, trimmed of mobile/tooltip features not needed on a fixed-size Electron window. A new `AppShell` component owns the auth guard and renders the sidebar chrome around each authenticated page's content, replacing the auth-check `useEffect` currently duplicated in `Kasir.tsx`, `KasirHistory.tsx`, and `BonPayment.tsx`.

**Tech Stack:** Electron + React 19 + TypeScript, `react-router-dom`, Tailwind v4, `@radix-ui/react-slot`, `class-variance-authority`, `lucide-react` — all already `desktop-node` dependencies.

## Global Constraints

- No new npm dependencies. Confirmed present in `desktop-node/package.json`: `@radix-ui/react-slot`, `class-variance-authority`, `lucide-react`, `react-router-dom`. Explicitly declined: `@radix-ui/react-tooltip` (no hover tooltip in icon-collapsed mode), `@radix-ui/react-dropdown-menu` and `@radix-ui/react-avatar` (simplified `NavUser`, no dropdown/avatar image), `@radix-ui/react-separator` (`SidebarSeparator` dropped — unused by this app's nav).
- The ported `ui/sidebar.tsx` drops: the `isMobile`/`Sheet` branch (desktop-only, no drawer mode), `SidebarMenuSkeleton` (nothing in this app's nav is skeleton-loaded), `SidebarMenuButton`'s `tooltip` prop, `SidebarSeparator`. Everything else ports verbatim, including the `sidebar_state` cookie persistence (7-day max-age) and the `Cmd/Ctrl+B` toggle shortcut.
- Sidebar nav shows all 5 web-app categories; only "Penjualan" (→ `/`) and "Riwayat Transaksi" (→ `/history`) are enabled — Dashboard, Pembelian, Katalog Produk, Stock Opname, Rekap render `disabled` (dimmed, non-interactive) since their pages don't exist yet in `desktop-node`.
- `AppShell` wraps Kasir, History, and Bon Payment. It owns the `window.api.auth.me()` check (redirect to `/login` on failure/null) and fetches store settings once for the sidebar's logo text. Each page drops its own duplicated `user` state/auth-`useEffect` and fetches its own data unconditionally on mount, relying on `AppShell` to guarantee it only mounts post-auth.
- `Receipt` (rendered by Kasir and History) stays exactly where it renders today: a sibling *outside* the JSX passed to `AppShell`, not inside it. No print-specific handling needed in `AppShell` — `main.css`'s `@media print { body * { visibility: hidden } .receipt-print { visibility: visible } }` rule works regardless of DOM nesting depth.
- Breadcrumbs (exact, matching the web source): Kasir → `[{title: 'Penjualan', href: '/'}]`; History → `[{title: 'Penjualan', href: '/'}, {title: 'Riwayat Transaksi', href: '/history'}]`; Bon Payment → same as History.
- `kasir:getStoreSettings` currently requires `getCurrentUser()` (`src/main/ipc/kasir.ts:148-150`) — this blocks the Login page's store-name fetch, since nobody is authenticated yet at that point. This handler must have its auth check removed as part of this plan (Task 1) — store name/address/phone/footer are branding-only, non-sensitive, and the web app already exposes them pre-login via a globally shared prop on its own login page.
- Login keeps username/password fields (no email — this app's auth is username-based). Drop "Remember me", "Forgot your password?", "Sign up" — none of those features exist in this app.

---

### Task 1: Login page redesign + `getStoreSettings` auth relaxation

**Files:**
- Modify: `desktop-node/src/main/ipc/kasir.ts:147-160`
- Modify: `desktop-node/src/renderer/pages/Login.tsx`

**Interfaces:**
- Consumes: `window.api.kasir.getStoreSettings()` (existing, `Promise<{namaToko: string; alamat: string | null; telepon: string | null; pesanFooter: string | null}>`), `window.api.auth.login(username, password)` (existing, unchanged).
- Produces: nothing new consumed by later tasks — this task is self-contained.

- [ ] **Step 1: Remove the auth check from `kasir:getStoreSettings`**

In `desktop-node/src/main/ipc/kasir.ts`, find:

```typescript
  ipcMain.handle('kasir:getStoreSettings', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const setting = db.select().from(storeSettings).get()
```

Replace with:

```typescript
  ipcMain.handle('kasir:getStoreSettings', () => {
    const setting = db.select().from(storeSettings).get()
```

- [ ] **Step 2: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors (confirms `getCurrentUser` is still used elsewhere in the file and the import isn't now unused — it is, by every other handler).

- [ ] **Step 3: Rewrite `Login.tsx`**

Replace the entire contents of `desktop-node/src/renderer/pages/Login.tsx` with:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, ClipboardList, LockKeyhole, ShoppingCart, Store, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const highlights = [
  { icon: ShoppingCart, text: 'Transaksi cepat dengan scan barcode' },
  { icon: Boxes, text: 'Kelola stok dan pembelian di satu tempat' },
  { icon: ClipboardList, text: 'Laporan penjualan yang selalu terbaru' },
]

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [storeName, setStoreName] = useState('POS')
  const navigate = useNavigate()

  useEffect(() => {
    window.api.kasir
      .getStoreSettings()
      .then((settings) => setStoreName(settings.namaToko))
      .catch(() => {})
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await window.api.auth.login(username, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal login')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative z-10 flex items-center gap-2 text-lg font-semibold">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/15">
            <Store className="size-5" />
          </div>
          {storeName}
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl leading-tight font-semibold text-balance">
            Satu aplikasi untuk seluruh operasional toko
          </h2>
          <ul className="space-y-4 text-sm text-indigo-100">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-indigo-200/70">&copy; {storeName}</p>
      </div>

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Store className="size-5" />
            </div>
            <span className="font-semibold">{storeName}</span>
          </div>

          <div className="mb-8 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Selamat datang kembali</h1>
            <p className="text-sm text-muted-foreground">Masuk untuk melanjutkan</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" />
                  <Input
                    id="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder="Username"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="Password"
                    className="pl-9"
                  />
                </div>
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" className="mt-1 w-full" disabled={isSubmitting}>
                Masuk
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as before this task (this task adds no automated tests — `Login.tsx` and the IPC auth-relaxation are UI/plumbing verified manually in Task 5).

- [ ] **Step 6: Commit**

```bash
cd desktop-node
git add src/main/ipc/kasir.ts src/renderer/pages/Login.tsx
git commit -m "Redesign Login page with branded split-screen layout"
```

---

### Task 2: Port `ui/sidebar.tsx` (trimmed) and `ui/breadcrumb.tsx`

**Files:**
- Create: `desktop-node/src/renderer/components/ui/sidebar.tsx`
- Create: `desktop-node/src/renderer/components/ui/breadcrumb.tsx`

**Interfaces:**
- Consumes: `Button` (`@/components/ui/button`), `Input` (`@/components/ui/input`), `cn` (`@/lib/utils`) — all existing.
- Produces: `SidebarProvider`, `Sidebar`, `SidebarTrigger`, `SidebarRail`, `SidebarInset`, `SidebarInput`, `SidebarHeader`, `SidebarFooter`, `SidebarContent`, `SidebarGroup`, `SidebarGroupAction`, `SidebarGroupContent`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuAction`, `SidebarMenuBadge`, `SidebarMenuButton`, `SidebarMenuItem`, `SidebarMenuSub`, `SidebarMenuSubButton`, `SidebarMenuSubItem`, `useSidebar` (named exports, `components/ui/sidebar.tsx`) — Task 3/4 import `Sidebar*` and `useSidebar` from here. `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis` (named exports, `components/ui/breadcrumb.tsx`) — Task 3 imports these.

- [ ] **Step 1: Create `ui/sidebar.tsx`**

Create `desktop-node/src/renderer/components/ui/sidebar.tsx`:

```typescript
import { Slot } from '@radix-ui/react-slot'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const SIDEBAR_COOKIE_NAME = 'sidebar_state'
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_WIDTH_ICON = '3rem'
const SIDEBAR_KEYBOARD_SHORTCUT = 'b'

type SidebarContext = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContext | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.')
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open],
  )

  const toggleSidebar = React.useCallback(() => {
    setOpen((open) => !open)
  }, [setOpen])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar])

  const state = open ? 'expanded' : 'collapsed'

  const contextValue = React.useMemo<SidebarContext>(
    () => ({ state, open, setOpen, toggleSidebar }),
    [state, open, setOpen, toggleSidebar],
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            '--sidebar-width': SIDEBAR_WIDTH,
            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn('group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
}) {
  const { state } = useSidebar()

  if (collapsible === 'none') {
    return (
      <div
        data-slot="sidebar"
        className={cn('bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col', className)}
        {...props}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === 'collapsed' ? collapsible : ''}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      <div
        className={cn(
          'relative h-svh w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear',
          'group-data-[collapsible=offcanvas]:w-0',
          'group-data-[side=right]:rotate-180',
          variant === 'floating' || variant === 'inset'
            ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]'
            : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
        )}
      />
      <div
        className={cn(
          'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex',
          side === 'left'
            ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
            : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
          variant === 'floating' || variant === 'inset'
            ? 'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]'
            : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l',
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar, state } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7', className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      {state === 'collapsed' ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle sidebar"
      className={cn(
        'hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex',
        'in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize',
        '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
        'hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full',
        '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
        '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
        className,
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        'bg-background relative flex max-w-full min-h-svh flex-1 flex-col',
        'peer-data-[variant=inset]:min-h-[calc(100svh-(--spacing(4)))] md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0',
        className,
      )}
      {...props}
    />
  )
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input data-slot="sidebar-input" data-sidebar="input" className={cn('bg-background h-8 w-full shadow-none', className)} {...props} />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" data-sidebar="header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" data-sidebar="footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden', className)}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" data-sidebar="group" className={cn('relative flex w-full min-w-0 flex-col p-2', className)} {...props} />
}

function SidebarGroupLabel({ className, asChild = false, ...props }: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'div'

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        'text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:select-none group-data-[collapsible=icon]:pointer-events-none',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({ className, asChild = false, ...props }: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        'text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        'after:absolute after:-inset-2 md:after:hidden',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group-content" data-sidebar="group-content" className={cn('w-full text-sm', className)} {...props} />
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" data-sidebar="menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className={cn('group/menu-item relative', className)} {...props} />
}

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        outline:
          'bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm group-data-[collapsible=icon]:p-0!',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = 'default',
  size = 'default',
  className,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean
  isActive?: boolean
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean
  showOnHover?: boolean
}) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        'text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        'after:absolute after:-inset-2 md:after:hidden',
        'peer-data-[size=sm]/menu-button:top-1',
        'peer-data-[size=default]/menu-button:top-1.5',
        'peer-data-[size=lg]/menu-button:top-2.5',
        'group-data-[collapsible=icon]:hidden',
        showOnHover &&
          'peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        'text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none',
        'peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground',
        'peer-data-[size=sm]/menu-button:top-1',
        'peer-data-[size=default]/menu-button:top-1.5',
        'peer-data-[size=lg]/menu-button:top-2.5',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        'border-sidebar-border mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-sub-item" data-sidebar="menu-sub-item" className={cn('group/menu-sub-item relative', className)} {...props} />
}

function SidebarMenuSubButton({
  asChild = false,
  size = 'md',
  isActive = false,
  className,
  ...props
}: React.ComponentProps<'a'> & {
  asChild?: boolean
  size?: 'sm' | 'md'
  isActive?: boolean
}) {
  const Comp = asChild ? Slot : 'a'

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        'text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 outline-hidden focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
        'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground',
        size === 'sm' && 'text-xs',
        size === 'md' && 'text-sm',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
}
```

- [ ] **Step 2: Create `ui/breadcrumb.tsx`**

Create `desktop-node/src/renderer/components/ui/breadcrumb.tsx` — verbatim port of `resources/js/components/ui/breadcrumb.tsx`:

```typescript
import { Slot } from '@radix-ui/react-slot'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Breadcrumb({ ...props }: React.ComponentProps<'nav'>) {
  return <nav aria-label="breadcrumb" data-slot="breadcrumb" {...props} />
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn('text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm break-words sm:gap-2.5', className)}
      {...props}
    />
  )
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="breadcrumb-item" className={cn('inline-flex items-center gap-1.5', className)} {...props} />
}

function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentProps<'a'> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : 'a'

  return <Comp data-slot="breadcrumb-link" className={cn('hover:text-foreground transition-colors', className)} {...props} />
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn('text-foreground font-normal', className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li data-slot="breadcrumb-separator" role="presentation" aria-hidden="true" className={cn('[&>svg]:size-3.5', className)} {...props}>
      {children ?? <ChevronRight />}
    </li>
  )
}

function BreadcrumbEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span data-slot="breadcrumb-ellipsis" role="presentation" aria-hidden="true" className={cn('flex size-9 items-center justify-center', className)} {...props}>
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More</span>
    </span>
  )
}

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis }
```

- [ ] **Step 3: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors (neither file is imported anywhere yet, so this only checks they compile standalone).

- [ ] **Step 4: Commit**

```bash
cd desktop-node
git add src/renderer/components/ui/sidebar.tsx src/renderer/components/ui/breadcrumb.tsx
git commit -m "Port sidebar and breadcrumb shadcn/ui components"
```

---

### Task 3: Types, logo, nav components

**Files:**
- Modify: `desktop-node/src/renderer/types.ts`
- Create: `desktop-node/src/renderer/components/app-logo-icon.tsx`
- Create: `desktop-node/src/renderer/components/app-logo.tsx`
- Create: `desktop-node/src/renderer/components/nav-main.tsx`
- Create: `desktop-node/src/renderer/components/nav-user.tsx`
- Create: `desktop-node/src/renderer/components/breadcrumbs.tsx`

**Interfaces:**
- Consumes: `Sidebar*` components and `useSidebar` from Task 2's `ui/sidebar.tsx`; `Breadcrumb*` from Task 2's `ui/breadcrumb.tsx`; `Button` (existing); `AuthUser` (existing, `types.ts`).
- Produces: `NavItem` and `BreadcrumbItem` types (`types.ts`) — `{title: string; href: string; icon?: LucideIcon; disabled?: boolean}` and `{title: string; href?: string}` respectively. `AppLogo({name: string})`, `NavMain({items: NavItem[]; label: string})`, `NavUser({user: AuthUser})`, `Breadcrumbs({breadcrumbs: BreadcrumbItem[]})` (named exports) — Task 4's `app-sidebar.tsx` and `AppShell.tsx` import all of these.

- [ ] **Step 1: Add `NavItem` and `BreadcrumbItem` types**

Replace the entire contents of `desktop-node/src/renderer/types.ts` with:

```typescript
import type { LucideIcon } from 'lucide-react'

export interface AuthUser {
  id: number
  username: string
  name: string
}

export interface NavItem {
  title: string
  href: string
  icon?: LucideIcon
  disabled?: boolean
}

export interface BreadcrumbItem {
  title: string
  href?: string
}
```

- [ ] **Step 2: Create `app-logo-icon.tsx`**

Create `desktop-node/src/renderer/components/app-logo-icon.tsx` — verbatim port of `resources/js/components/app-logo-icon.tsx`, using a named export (this codebase's convention — no default exports appear anywhere in `desktop-node/src/renderer/components/`):

```typescript
import type { SVGAttributes } from 'react'

export function AppLogoIcon(props: SVGAttributes<SVGElement>) {
  return (
    <svg {...props} viewBox="0 0 40 42" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.2 5.63325L8.6 0.855469L0 5.63325V32.1434L16.2 41.1434L32.4 32.1434V23.699L40 19.4767V9.85547L31.4 5.07769L22.8 9.85547V18.2999L17.2 21.411V5.63325ZM38 18.2999L32.4 21.411V15.2545L38 12.1434V18.2999ZM36.9409 10.4439L31.4 13.5221L25.8591 10.4439L31.4 7.36561L36.9409 10.4439ZM24.8 18.2999V12.1434L30.4 15.2545V21.411L24.8 18.2999ZM23.8 20.0323L29.3409 23.1105L16.2 30.411L10.6591 27.3328L23.8 20.0323ZM7.6 27.9212L15.2 32.1434V38.2999L2 30.9666V7.92116L7.6 11.0323V27.9212ZM8.6 9.29991L3.05913 6.22165L8.6 3.14339L14.1409 6.22165L8.6 9.29991ZM30.4 24.8101L17.2 32.1434V38.2999L30.4 30.9666V24.8101ZM9.6 11.0323L15.2 7.92117V22.5221L9.6 25.6333V11.0323Z"
      />
    </svg>
  )
}
```

- [ ] **Step 3: Create `app-logo.tsx`**

Create `desktop-node/src/renderer/components/app-logo.tsx` — adapted: takes `name` as a prop instead of reading `usePage().props.name` (which doesn't exist in this app):

```typescript
import { AppLogoIcon } from './app-logo-icon'

export function AppLogo({ name }: { name: string }) {
  return (
    <>
      <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
        <AppLogoIcon className="size-5 fill-current text-white dark:text-black" />
      </div>
      <div className="ml-1 grid flex-1 text-left text-sm">
        <span className="mb-0.5 truncate leading-tight font-semibold">{name}</span>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Create `nav-main.tsx`**

Create `desktop-node/src/renderer/components/nav-main.tsx` — adapted: active-state via `react-router-dom`'s `useLocation()` instead of Inertia's `useCurrentUrl`; items may be `disabled` (renders a non-interactive dimmed row via `SidebarMenuButton`'s native `disabled` attribute, which already carries `disabled:pointer-events-none disabled:opacity-50` in `sidebarMenuButtonVariants`):

```typescript
import { Link, useLocation } from 'react-router-dom'
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import type { NavItem } from '../types'

export function NavMain({ items, label }: { items: NavItem[]; label: string }) {
  const location = useLocation()

  return (
    <SidebarGroup className="px-2 py-0">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            {item.disabled ? (
              <SidebarMenuButton disabled>
                {item.icon && <item.icon />}
                <span>{item.title}</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton asChild isActive={location.pathname === item.href}>
                <Link to={item.href}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
```

- [ ] **Step 5: Create `nav-user.tsx`**

Create `desktop-node/src/renderer/components/nav-user.tsx` — simplified (no dropdown menu, no avatar image, no Settings link — see Global Constraints):

```typescript
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import type { AuthUser } from '../types'

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function NavUser({ user }: { user: AuthUser }) {
  const navigate = useNavigate()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
          <div className="bg-sidebar-accent flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {initials(user.name)}
          </div>
          <span className="truncate">{user.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={async () => {
            await window.api.auth.logout()
            navigate('/login')
          }}
        >
          Keluar
        </Button>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
```

- [ ] **Step 6: Create `breadcrumbs.tsx`**

Create `desktop-node/src/renderer/components/breadcrumbs.tsx` — adapted: `react-router-dom`'s `Link` instead of Inertia's; the last item (or any item without an `href`) renders as plain text (`BreadcrumbPage`), matching the web source's `isLast` behavior:

```typescript
import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import type { BreadcrumbItem as BreadcrumbItemType } from '../types'

export function Breadcrumbs({ breadcrumbs }: { breadcrumbs: BreadcrumbItemType[] }) {
  if (breadcrumbs.length === 0) {
    return null
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((item, index) => {
          const isLast = index === breadcrumbs.length - 1

          return (
            <Fragment key={item.title}>
              <BreadcrumbItem>
                {isLast || !item.href ? (
                  <BreadcrumbPage>{item.title}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={item.href}>{item.title}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as before this task.

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/types.ts src/renderer/components/app-logo-icon.tsx src/renderer/components/app-logo.tsx src/renderer/components/nav-main.tsx src/renderer/components/nav-user.tsx src/renderer/components/breadcrumbs.tsx
git commit -m "Add NavItem/BreadcrumbItem types and nav building blocks"
```

---

### Task 4: `AppSidebar` and `AppShell`

**Files:**
- Create: `desktop-node/src/renderer/components/app-sidebar.tsx`
- Create: `desktop-node/src/renderer/layouts/AppShell.tsx`

**Interfaces:**
- Consumes: `Sidebar`, `SidebarContent`, `SidebarFooter`, `SidebarHeader`, `SidebarInset`, `SidebarMenu`, `SidebarMenuItem`, `SidebarProvider`, `SidebarTrigger` (Task 2); `AppLogo`, `NavMain`, `NavUser`, `Breadcrumbs` (Task 3); `NavItem`, `BreadcrumbItem`, `AuthUser` (Task 3's `types.ts`); `window.api.auth.me()`, `window.api.kasir.getStoreSettings()` (existing).
- Produces: `AppSidebar({storeName: string; user: AuthUser})` (`components/app-sidebar.tsx`), `AppShell({breadcrumbs: BreadcrumbItem[]; children: ReactNode})` (`layouts/AppShell.tsx`) — Task 5's pages import `AppShell`.

- [ ] **Step 1: Create `app-sidebar.tsx`**

Create `desktop-node/src/renderer/components/app-sidebar.tsx`. Nav structure matches the web source's 4 groups; only Kasir and History are enabled (see Global Constraints). The logo isn't wrapped in a link — there's no Dashboard page yet for it to sensibly navigate to:

```typescript
import { Boxes, ClipboardCheck, ClipboardList, History, LayoutGrid, PackagePlus, ShoppingCart } from 'lucide-react'
import { AppLogo } from './app-logo'
import { NavMain } from './nav-main'
import { NavUser } from './nav-user'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar'
import type { AuthUser, NavItem } from '../types'

const overviewNavItems: NavItem[] = [{ title: 'Dashboard', href: '/dashboard', icon: LayoutGrid, disabled: true }]

const penjualanNavItems: NavItem[] = [
  { title: 'Penjualan', href: '/', icon: ShoppingCart },
  { title: 'Riwayat Transaksi', href: '/history', icon: History },
]

const pembelianNavItems: NavItem[] = [
  { title: 'Pembelian', href: '/purchase', icon: PackagePlus, disabled: true },
  { title: 'Katalog Produk', href: '/inventory', icon: Boxes, disabled: true },
  { title: 'Stock Opname', href: '/stock-opname', icon: ClipboardCheck, disabled: true },
]

const laporanNavItems: NavItem[] = [{ title: 'Rekap', href: '/rekap', icon: ClipboardList, disabled: true }]

export function AppSidebar({ storeName, user }: { storeName: string; user: AuthUser }) {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <AppLogo name={storeName} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={overviewNavItems} label="Ringkasan" />
        <NavMain items={penjualanNavItems} label="Penjualan" />
        <NavMain items={pembelianNavItems} label="Pembelian & Stok" />
        <NavMain items={laporanNavItems} label="Laporan" />
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
```

- [ ] **Step 2: Create `AppShell.tsx`**

Create `desktop-node/src/renderer/layouts/AppShell.tsx`. Consolidates the web app's 4-file split (`AppShell`/`AppContent`/`AppSidebarHeader`/`AppSidebarLayout`) into one file, since `desktop-node` only ever needs the sidebar variant. Owns the auth check and the store-settings fetch (for the sidebar logo):

```typescript
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppSidebar } from '@/components/app-sidebar'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import type { AuthUser, BreadcrumbItem } from '../types'

export function AppShell({ breadcrumbs, children }: { breadcrumbs: BreadcrumbItem[]; children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [storeName, setStoreName] = useState('POS')

  useEffect(() => {
    window.api.auth
      .me()
      .then((result) => {
        if (!result) {
          navigate('/login')
          return
        }
        setUser(result)
      })
      .catch(() => navigate('/login'))
  }, [navigate])

  useEffect(() => {
    if (!user) {
      return
    }
    window.api.kasir
      .getStoreSettings()
      .then((settings) => setStoreName(settings.namaToko))
      .catch(() => {})
  }, [user])

  if (!user) {
    return <p>Memuat...</p>
  }

  return (
    <SidebarProvider>
      <AppSidebar storeName={storeName} user={user} />
      <SidebarInset>
        <header className="border-sidebar-border/50 group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-16 shrink-0 items-center gap-2 border-b px-6 transition-[width,height] ease-linear md:px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumbs breadcrumbs={breadcrumbs} />
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as before this task.

- [ ] **Step 5: Commit**

```bash
cd desktop-node
git add src/renderer/components/app-sidebar.tsx src/renderer/layouts/AppShell.tsx
git commit -m "Add AppSidebar and AppShell"
```

---

### Task 5: Wire `AppShell` into Kasir, History, Bon Payment; remove duplicated auth guard; verify

**Files:**
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx`
- Modify: `desktop-node/src/renderer/pages/KasirHistory.tsx`
- Modify: `desktop-node/src/renderer/pages/BonPayment.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 4); `BreadcrumbItem` (Task 3's `types.ts`).

- [ ] **Step 1: Edit `Kasir.tsx`**

Remove the now-unused `useNavigate` import and `AuthUser` import. Find:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CellKeyboardEvent, CellKeyDownArgs, DataGridHandle, RowsChangeData } from 'react-data-grid'
import { Search, ShoppingCart, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppearance } from '@/hooks/use-appearance'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatRupiah } from '@/lib/utils'
import type { AuthUser } from '../types'
import { CartGrid, QTY_COLUMN_IDX } from './kasir/CartGrid'
```

Replace with:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellKeyboardEvent, CellKeyDownArgs, DataGridHandle, RowsChangeData } from 'react-data-grid'
import { Search, ShoppingCart, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppearance } from '@/hooks/use-appearance'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
import { CartGrid, QTY_COLUMN_IDX } from './kasir/CartGrid'
```

Add a module-level breadcrumbs constant right after the imports (before `interface SaleDto`):

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Penjualan', href: '/' }]
```

Remove the `navigate` and `user` state, and the auth-check `useEffect`. Find:

```typescript
export function Kasir() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [products, setProducts] = useState<Product[]>([])
```

Replace with:

```typescript
export function Kasir() {
  const [products, setProducts] = useState<Product[]>([])
```

Find:

```typescript
  useEffect(() => {
    window.api.auth
      .me()
      .then((result) => {
        if (!result) {
          navigate('/login')
          return
        }
        setUser(result)
      })
      .catch(() => navigate('/login'))
  }, [navigate])

  useEffect(() => {
    if (!user) {
      return
    }
    refreshProducts()
    refreshSalesToday()
    window.api.kasir
      .getStoreSettings()
      .then(setStoreSettings)
      .catch(() => setStoreSettings({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
```

Replace with:

```typescript
  useEffect(() => {
    refreshProducts()
    refreshSalesToday()
    window.api.kasir
      .getStoreSettings()
      .then(setStoreSettings)
      .catch(() => setStoreSettings({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

Remove the loading guard and the old header row, and wrap the return value in `AppShell`. Find:

```typescript
  if (!user) {
    return <p>Memuat...</p>
  }

  return (
    <>
      <div className="flex-1 space-y-4 p-4 sm:p-6 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{user.name}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/history')}>
            Riwayat Transaksi
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await window.api.auth.logout()
              navigate('/login')
            }}
          >
            Keluar
          </Button>
        </div>
      </div>

      {scanError && (
```

Replace with:

```typescript
  return (
    <>
      <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex-1 space-y-4 p-4 sm:p-6 print:hidden">
      {scanError && (
```

Find the end of the page's main content div and close `AppShell` before the `Receipt` sibling. Find:

```typescript
      </section>
      </div>

      {receiptSale && storeSettings && <Receipt sale={receiptSale} storeSettings={storeSettings} />}
    </>
  )
}
```

Replace with:

```typescript
      </section>
      </div>
      </AppShell>

      {receiptSale && storeSettings && <Receipt sale={receiptSale} storeSettings={storeSettings} />}
    </>
  )
}
```

- [ ] **Step 2: Edit `KasirHistory.tsx`**

Find:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { DataGrid } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatRupiah } from '@/lib/utils'
import type { AuthUser } from '../types'
import { Receipt, type ReceiptSale, type StoreSettingsDto } from './kasir/Receipt'
```

Replace with:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { DataGrid } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
import { Receipt, type ReceiptSale, type StoreSettingsDto } from './kasir/Receipt'
```

Add a module-level breadcrumbs constant right after the existing `MIN_ITEM_WIDTH` constant:

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/' },
  { title: 'Riwayat Transaksi', href: '/history' },
]
```

Remove the `user` state and the auth-check `useEffect`. Find:

```typescript
export function KasirHistory() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const { resolvedAppearance } = useAppearance()
```

Replace with:

```typescript
export function KasirHistory() {
  const navigate = useNavigate()
  const { resolvedAppearance } = useAppearance()
```

Find:

```typescript
  useEffect(() => {
    window.api.auth
      .me()
      .then((result) => {
        if (!result) {
          navigate('/login')
          return
        }
        setUser(result)
      })
      .catch(() => navigate('/login'))
  }, [navigate])

  useEffect(() => {
    if (!user) {
      return
    }
    window.api.kasir
      .getStoreSettings()
      .then(setStoreSettings)
      .catch(() => setStoreSettings({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
```

Replace with:

```typescript
  useEffect(() => {
    window.api.kasir
      .getStoreSettings()
      .then(setStoreSettings)
      .catch(() => setStoreSettings({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }))
  }, [])
```

Find:

```typescript
  useEffect(() => {
    if (!user) {
      return
    }
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
```

Replace with:

```typescript
  useEffect(() => {
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

Remove the loading guard and wrap the return value in `AppShell`. Find:

```typescript
  if (!user) {
    return <p>Memuat...</p>
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Riwayat Transaksi</h1>
```

Replace with:

```typescript
  return (
    <>
      <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Riwayat Transaksi</h1>
```

Find the end of the page's main content div and close `AppShell` before the `Receipt` sibling. Find:

```typescript
        </div>
      </div>

      {receiptSale && storeSettings && <Receipt sale={receiptSale} storeSettings={storeSettings} />}
    </>
  )
}
```

Replace with:

```typescript
        </div>
      </div>
      </AppShell>

      {receiptSale && storeSettings && <Receipt sale={receiptSale} storeSettings={storeSettings} />}
    </>
  )
}
```

- [ ] **Step 3: Edit `BonPayment.tsx`**

Find:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InputError } from '@/components/input-error'
import { ReportTable } from '@/components/report-table'
import { cn, formatRupiah } from '@/lib/utils'
import type { AuthUser } from '../types'
```

Replace with:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InputError } from '@/components/input-error'
import { ReportTable } from '@/components/report-table'
import { cn, formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
```

Add a module-level breadcrumbs constant right after the `BonPaymentRow` interface (before `export function BonPayment()`):

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/' },
  { title: 'Riwayat Transaksi', href: '/history' },
]
```

Remove the `user` state and the auth-check `useEffect`. Find:

```typescript
export function BonPayment() {
  const navigate = useNavigate()
  const { saleId } = useParams<{ saleId: string }>()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [sale, setSale] = useState<SaleDetail | null>(null)
```

Replace with:

```typescript
export function BonPayment() {
  const navigate = useNavigate()
  const { saleId } = useParams<{ saleId: string }>()
  const [sale, setSale] = useState<SaleDetail | null>(null)
```

Find:

```typescript
  useEffect(() => {
    window.api.auth
      .me()
      .then((result) => {
        if (!result) {
          navigate('/login')
          return
        }
        setUser(result)
      })
      .catch(() => navigate('/login'))
  }, [navigate])

  function loadSale() {
```

Replace with:

```typescript
  function loadSale() {
```

Find:

```typescript
  useEffect(() => {
    if (!user) {
      return
    }
    loadSale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
```

Replace with:

```typescript
  useEffect(() => {
    loadSale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

Wrap both return branches in `AppShell`. Find:

```typescript
  if (!user || !sale) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <p>{loadError ?? 'Memuat...'}</p>
          {loadError && (
            <Button variant="outline" size="sm" onClick={() => navigate('/history')}>
              Kembali
            </Button>
          )}
        </div>
      </div>
    )
  }
```

Replace with:

```typescript
  if (!sale) {
    return (
      <AppShell breadcrumbs={BREADCRUMBS}>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <p>{loadError ?? 'Memuat...'}</p>
            {loadError && (
              <Button variant="outline" size="sm" onClick={() => navigate('/history')}>
                Kembali
              </Button>
            )}
          </div>
        </div>
      </AppShell>
    )
  }
```

Find:

```typescript
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
```

Replace with:

```typescript
  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
```

Find the end of the file:

```typescript
      <ReportTable<BonPaymentRow>
        title="Riwayat Pembayaran"
        rows={sale.bonPayments}
        rowKey={(row) => row.id}
        emptyMessage="Belum ada pembayaran."
        columns={columns}
      />
    </div>
  )
}
```

Replace with:

```typescript
      <ReportTable<BonPaymentRow>
        title="Riwayat Pembayaran"
        rows={sale.bonPayments}
        rowKey={(row) => row.id}
        emptyMessage="Belum ada pembayaran."
        columns={columns}
      />
    </div>
    </AppShell>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as before this task (this task is pure UI wiring, no new automated tests — verified manually in Step 7).

- [ ] **Step 6: Rebuild better-sqlite3 for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

Run in background. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.

- [ ] **Step 7: Manual end-to-end verification via CDP**

Using the same CDP pattern established in prior slices (query `http://127.0.0.1:9222/json` for the page target's `webSocketDebuggerUrl`, then `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`):

1. Navigate to the Login page (unauthenticated). Confirm the branded split-screen layout renders: left indigo panel with highlights (only visible at `lg` width — resize the Electron window or check via `document.body.innerText` that the highlight text exists in the DOM regardless of viewport), right panel with username/password form. Confirm the store name (fetched via the now-unauthenticated `getStoreSettings` call) appears in the panel — not the fallback `'POS'` — proving Task 1's auth-relaxation fix works.
2. Log in with `admin`/`password`. Confirm navigation to `/` (Kasir) succeeds and the sidebar renders: logo + store name, "Ringkasan" group with disabled "Dashboard", "Penjualan" group with enabled "Penjualan" (active/highlighted, since we're on `/`) and "Riwayat Transaksi", "Pembelian & Stok" group with 3 disabled items, "Laporan" group with disabled "Rekap". Confirm the sidebar footer shows the logged-in user's initials + name + a "Keluar" button.
3. Confirm the breadcrumb in the header reads "Penjualan" (single crumb, no separator).
4. Click a disabled nav item (e.g. "Rekap"). Confirm nothing happens (no navigation, no error) — the button is inert.
5. Click "Riwayat Transaksi" in the sidebar. Confirm navigation to `/history`, the breadcrumb now reads "Penjualan / Riwayat Transaksi", and "Riwayat Transaksi" is now the active/highlighted nav item instead of "Penjualan".
6. Click the sidebar's collapse trigger (top-left of the header, the `SidebarTrigger` button). Confirm the sidebar shrinks to icon-only width and the nav items still show icons (no crash, no layout break). Click again to expand.
7. From History, click a row's "Pending Payment" button (use the same bon-sale seed data from prior slices' verification if `dev.sqlite` still has it, or seed a fresh one via the pattern documented in the History/Pending-Payment plans). Confirm navigation to `/bon-payment/:id`, the breadcrumb still reads "Penjualan / Riwayat Transaksi" (no third crumb), and the sidebar is present and functional (collapse/expand still works).
8. Click "Keluar" in the sidebar footer. Confirm navigation to `/login` and that `window.api.auth.me()` now returns null (session cleared) — e.g. by attempting to navigate back to `/` via `window.location.hash = '#/'` and confirming it bounces back to `/login`.
9. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 8: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/pages/Kasir.tsx src/renderer/pages/KasirHistory.tsx src/renderer/pages/BonPayment.tsx
git commit -m "Wire AppShell into Kasir, History, and Bon Payment"
```

---

## Plan Self-Review

**Spec coverage:** Login redesign (§1) → Task 1. `getStoreSettings` auth relaxation (discovered during planning, required for §1 to function) → Task 1 Step 1. Sidebar primitive port with documented omissions (§2) → Task 2 (`ui/sidebar.tsx`, `ui/breadcrumb.tsx`) and Task 3 (`app-logo*`, `nav-main`, `nav-user`, `breadcrumbs`). Simplified `NavUser` (§2, "Simplified" subsection) → Task 3 Step 5. Consolidated `AppShell` (§2, "Layout composition") → Task 4 Step 2. Auth-guard centralization (§3) → Task 5. Breadcrumbs per page (§4) → Task 5 Steps 1-3 (module-level `BREADCRUMBS` constants). Out-of-scope items (no new deps, no mobile drawer, no Settings pages, no `Login.tsx` auth-logic changes) — untouched by every task, confirmed by scoping each task's file list to only what the spec names.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code.

**Type consistency:** `AppShell({breadcrumbs: BreadcrumbItem[]; children: ReactNode})` signature is identical across Task 4 Step 2 (definition) and Task 5 Steps 1-3 (all three call sites pass a `BreadcrumbItem[]` constant). `AppSidebar({storeName: string; user: AuthUser})` matches between Task 4 Step 1 (definition) and Step 2 (`AppShell`'s call site). `NavItem`/`BreadcrumbItem` field names (`title`, `href`, `icon`, `disabled`) are identical across Task 3 Step 1 (`types.ts` definition), Task 3 Steps 4-6 (`nav-main.tsx`, `breadcrumbs.tsx` consumption), and Task 4 Step 1 (`app-sidebar.tsx`'s nav-item arrays).
