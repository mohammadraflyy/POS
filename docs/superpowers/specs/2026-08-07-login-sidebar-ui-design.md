# Login UI + App Sidebar — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Ports the web app's branded login screen (`resources/js/layouts/auth/auth-pos-layout.tsx`) and its app-chrome sidebar (`resources/js/components/app-sidebar.tsx` + supporting shadcn `Sidebar` primitive) into the Electron renderer. Also centralizes the auth-guard logic currently duplicated across `Kasir.tsx`, `KasirHistory.tsx`, and `BonPayment.tsx`.

## Why

`desktop-node`'s `Login.tsx` is a bare unstyled form (no icons, no branding), and none of the authenticated pages (Kasir, History, Bon Payment) have the navigation chrome the web app gives them — there is no way to get from Kasir to History except a single button Kasir added itself, and no visual indication of what other modules exist or are coming.

## 1. Login Page

Port `AuthPosLayout`'s branded split-screen layout directly into `Login.tsx` (this app has no separate layout-wrapper mechanism like Inertia's `Page.layout` — `Login.tsx` renders its own full page). Structure:

- **Left panel** (`hidden lg:flex`, indigo gradient `from-indigo-600 via-indigo-700 to-violet-800`): store icon + name top-left, headline + 3 feature bullets (reuse the web source's copy: "Transaksi cepat dengan scan barcode", "Kelola stok dan pembelian di satu tempat", "Laporan penjualan yang selalu terbaru" — even though barcode/stok/laporan modules aren't built yet in desktop-node, this mirrors the web app's own aspirational copy verbatim), footer copyright line.
- **Right panel**: mobile-only compact logo header (`lg:hidden`), page title "Welcome back" / description "Masuk untuk melanjutkan" (Indonesian, since this app's UI is Indonesian throughout unlike the web app's English auth copy), then the form.
- **Form fields**: keep the existing username/password fields (this app has no email field — auth is username-based, confirmed in `main/auth.ts`). Add `Mail`→username icon (use `User` from `lucide-react` instead, since there's no email) and `LockKeyhole` icon insets matching the web source's icon-in-input pattern. Keep existing submit-disabled-while-processing and `role="alert"` error display. Drop "Remember me", "Forgot your password?", and "Sign up" — none of those features exist in this app (no password reset, no self-registration, single shared session).
- Store name shown in the left panel and mobile header comes from `window.api.kasir.getStoreSettings()` (`namaToko`), fetched on mount — matching the web source's `usePage().props.name` (there it's the whole app's config name; here the closest equivalent is the store's configured name, already exposed via existing IPC).

## 2. App Sidebar

New authenticated-shell component, `src/renderer/layouts/AppShell.tsx`, wrapping Kasir, History, and Bon Payment (per approval — all three, matching web parity since the web version keeps the sidebar visible during checkout too, and the shadcn sidebar's `collapsible="icon"` lets a cashier shrink it to reclaim screen space without leaving the page).

### Ported components (no new npm dependencies — confirmed all of `@radix-ui/react-slot`, `class-variance-authority`, `lucide-react`, `react-router-dom` are already desktop-node dependencies)

- **`components/ui/sidebar.tsx`** — ported from the 719-line web source, with these deliberate omissions (approved simplifications, not silent deviations):
  - The `isMobile`/`Sheet` branch inside `Sidebar` is stripped entirely — desktop-only, no drawer mode. `useIsMobile` is not ported; `SidebarProvider`'s `isMobile` is hardcoded `false`.
  - `SidebarMenuSkeleton` and its `Skeleton` import are dropped — nothing in this app's nav is loading-state/skeleton-rendered (nav items are static).
  - `SidebarMenuButton`'s `tooltip` prop and the `Tooltip`/`TooltipContent`/`TooltipTrigger` import are dropped — no hover tooltip in icon-collapsed mode (approved: avoids adding `@radix-ui/react-tooltip` as a new dependency for a 2-item nav).
  - Everything else (`SidebarProvider`, `Sidebar`, `SidebarTrigger`, `SidebarRail`, `SidebarInset`, `SidebarHeader`, `SidebarFooter`, `SidebarContent`, `SidebarGroup*`, `SidebarMenu*` except the two omissions above) ports verbatim, including the cookie-based collapsed-state persistence (`sidebar_state` cookie, 7-day max-age) and the `Cmd/Ctrl+B` toggle shortcut.
- **`components/ui/separator.tsx`** — ported verbatim (26 lines, used by `SidebarSeparator`, though nothing in this app's nav currently renders a separator — kept for a complete/reusable sidebar primitive rather than partially trimming it).
- **`components/ui/breadcrumb.tsx`** — ported verbatim, with `Link`/`href` swapped from Inertia to `react-router-dom`'s `Link`/`to`.
- **`components/app-logo-icon.tsx`** — ported verbatim (pure SVG, no framework dependency).
- **`components/app-logo.tsx`** — adapted: takes `name: string` as a prop instead of reading `usePage().props.name`.
- **`components/nav-main.tsx`** — adapted: active-state uses `react-router-dom`'s `useLocation()` (compare `location.pathname` against each item's `href`) instead of Inertia's `useCurrentUrl` hook. `NavItem` gains a `disabled?: boolean` field — when true, renders as a non-interactive dimmed row (`opacity-50 cursor-not-allowed`, no `Link`, no click handler) instead of a clickable link.
- **`components/breadcrumbs.tsx`** — adapted: `Link`/`href` swapped to `react-router-dom`.
- **`components/app-sidebar.tsx`** — adapted nav structure (approved: show all 5 web-app categories, disable the unbuilt ones):
  ```
  Ringkasan:  Dashboard (disabled)
  Penjualan:  Penjualan → /            (enabled)
              Riwayat Transaksi → /history  (enabled)
  Pembelian & Stok:  Pembelian (disabled), Katalog Produk (disabled), Stock Opname (disabled)
  Laporan:    Rekap (disabled)
  ```
  Same icons as the web source (`LayoutGrid`, `ShoppingCart`, `History`, `PackagePlus`, `Boxes`, `ClipboardCheck`, `ClipboardList` from `lucide-react`, already a dependency). Logo name comes from `AppShell`'s fetched store settings, passed down as a prop.

### Simplified (not ported verbatim)

- **`components/nav-user.tsx`** — the web version opens a dropdown menu (`@radix-ui/react-dropdown-menu`, not a desktop-node dependency) with a "Settings" link (no settings page exists) and shows an avatar image + email (this app's `AuthUser` type is `{id, username, name}` — no avatar, no email). Desktop-node's version: a plain `SidebarMenu` row showing an initials circle (computed from `name`, plain styled `<div>`, no Radix Avatar needed) + the user's `name`, and a direct "Keluar" button (calls `window.api.auth.logout()` then navigates to `/login` — the same action Kasir's own header button already performs today). No dropdown, no new dependencies.
- **Layout composition**: the web app splits this across 4 files (`AppShell`, `AppContent`, `AppSidebarHeader`, `AppSidebarLayout`) because it supports a `variant='header'` mode used elsewhere in the app. Desktop-node only ever needs the sidebar variant, so these consolidate into one file, `layouts/AppShell.tsx`, which:
  1. Owns the auth check: calls `window.api.auth.me()` on mount; on failure or `null`, navigates to `/login`. While the check is pending (before it resolves either way), renders `<p>Memuat...</p>` instead of the sidebar+content — the same placeholder text every ported page already uses for its own loading states, so no new UI convention is introduced. Once resolved to a valid user, renders the full sidebar+content.
  2. Fetches `getStoreSettings()` once (for the logo name).
  3. Renders `SidebarProvider > AppSidebar + SidebarInset > header(SidebarTrigger + Breadcrumbs) + children`.
  4. Takes a `breadcrumbs: {title: string; href?: string}[]` prop from the page, matching the web source's per-page `.layout.breadcrumbs` pattern.

## 3. Centralizing the auth guard (touches 3 existing pages)

`Kasir.tsx`, `KasirHistory.tsx`, and `BonPayment.tsx` each currently duplicate the same block:

```typescript
const [user, setUser] = useState<AuthUser | null>(null)
useEffect(() => {
  window.api.auth.me().then((result) => {
    if (!result) { navigate('/login'); return }
    setUser(result)
  }).catch(() => navigate('/login'))
}, [navigate])
```

...and gate their own data-fetching `useEffect` on `[user]`. Once `AppShell` owns this check and only renders `children` after authentication succeeds, all three pages drop this state/effect entirely and fetch their own data unconditionally in a plain `useEffect(() => { load() }, [])` — `AppShell` already guarantees they only mount post-auth.

Concretely:
- `Kasir.tsx`: removes `user` state + its auth `useEffect`; removes the inline header row showing `user.name` + "Riwayat Transaksi" + "Keluar" buttons (now redundant with the sidebar's `NavUser` + nav item) — the page's `print:hidden` wrapper now starts directly at the "Keranjang" heading. Its own data-loading `useEffect` (products, sales-today, store settings) drops the `if (!user) return` guard and its `[user]` dependency, running unconditionally on mount.
- `KasirHistory.tsx`: same removal; its "Ke Kasir" button in the filter form stays (still a useful in-page shortcut) but is no longer the only way back.
- `BonPayment.tsx`: same removal; its "Kembali" buttons stay unchanged (they navigate to `/history`, unrelated to the auth guard).
- Return value gates change from `if (!user) return <p>Memuat...</p>` to whatever each page's own data-readiness state already was (e.g. History already renders its grid empty-state independent of a loading flag; Kasir/BonPayment keep a minimal own-data loading check, just without the `user` part of it).

`AppShell` wraps each page's main content JSX as its `children`. `Receipt` (where a page renders one — Kasir and History) stays exactly where it already renders today: as the last sibling in the page's `return`, *outside* the JSX passed to `AppShell`. This requires no special print handling in `AppShell` itself — printing isolation is handled by the `@media print { body * { visibility: hidden } .receipt-print { visibility: visible } }` rule in `main.css`, which works regardless of DOM nesting depth (it's a `body *` universal selector, not tied to a specific wrapper element), so `Receipt` prints correctly whether or not the sidebar chrome sits between it and the page root.

## 4. Breadcrumbs (matching web exactly)

- Kasir: `[{title: 'Penjualan', href: '/'}]`
- History: `[{title: 'Penjualan', href: '/'}, {title: 'Riwayat Transaksi', href: '/history'}]`
- Bon Payment: same as History (no self-referencing third crumb — matches the web source, which doesn't add one either)

## Out of Scope

- No new npm dependencies (confirmed: `@radix-ui/react-slot`, `class-variance-authority`, `lucide-react`, `react-router-dom` all already present; tooltip and dropdown-menu explicitly declined above).
- No mobile/responsive drawer mode for the sidebar.
- No Settings/Profile/2FA pages or links — none exist in desktop-node.
- No changes to the 5 nav items that stay `disabled` — they get no route, no page, just a dimmed non-interactive row marking where they'll live once their modules are built.
- No changes to `Login.tsx`'s auth logic (`window.api.auth.login`) — this is a pure visual redesign of the same form/submit flow.
