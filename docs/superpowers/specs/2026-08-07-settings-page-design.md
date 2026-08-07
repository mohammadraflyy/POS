# Settings Page (Phase 1) — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Phase 1 of a two-phase Settings feature — this phase ships a working Settings page (store info editing, purge history, test scanner) reachable from the sidebar. Phase 2 (separate spec/plan, built after this one) adds ESC/POS-based silent printing, a paper-width setting (58mm/80mm), and Test Print — the printer-hardware piece, which depends on this phase's page shell existing.

## Why

`desktop-node`'s Kasir/History/Bon Payment pages are done, but there's no way to edit the store's name/address/phone/receipt-footer (currently only readable via `getStoreSettings`, no update path), no way to purge old transaction history, and no way to verify a barcode scanner is working outside of actually using it during a live sale. The web app already has all three on its "Pengaturan Toko" settings page (`resources/js/pages/settings/store.tsx`) — this phase ports that page's non-printer sections.

## 1. Settings Page & Routing

New page `src/renderer/pages/Settings.tsx` at route `/settings`, added to `App.tsx`. Wrapped in `AppShell` with breadcrumb `[{title: 'Pengaturan'}]` (single crumb, no `href` — it isn't nested under Penjualan, matching how the web app's Settings section is a separate top-level area, not a child of Penjualan/Kasir).

**Entry point:** `NavUser`'s user-info row (currently a plain non-interactive `SidebarMenuButton` showing initials + name) becomes a `DropdownMenuTrigger` wrapping that same button. The dropdown content has one item, "Pengaturan" (with a `Settings` icon from `lucide-react`), navigating to `/settings`. The "Keluar" button stays exactly as it is today — a separate, always-visible `Button` below the user row, not inside the dropdown, since logout is the more common action and shouldn't need an extra click to reveal.

This requires `@radix-ui/react-dropdown-menu` as a new dependency (not currently in `desktop-node`) — justified now that there's an actual destination for it, unlike when `NavUser` was first built during the Login+Sidebar plan and deliberately left dropdown-free because no Settings page existed yet.

Port `src/renderer/components/ui/dropdown-menu.tsx` verbatim from `resources/js/components/ui/dropdown-menu.tsx` (255 lines, standard shadcn primitive — `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, and the rest of the family, all built on `@radix-ui/react-dropdown-menu` + existing `cn`/`lucide-react`).

## 2. Store Info Form

Section on the Settings page: `nama_toko` (required, text), `alamat` (optional, text), `telepon` (optional, text), `pesan_footer` (optional, text) — the same fields already read by `getStoreSettings`, now editable. Matches `StoreSettingUpdateRequest`'s validation exactly: `nama_toko` required, max 255; `alamat` nullable, max 255; `telepon` nullable, max 50; `pesan_footer` nullable, max 255.

New business logic `updateStoreSettings(db, input)` in `main/kasir.ts` (tested like `checkout`/`recordBonPayment`/`cancelSale`), **upserting** — the `store_settings` table is not seeded anywhere in `desktop-node` (confirmed: no seed script writes to it, and `getStoreSettings`'s current fallback-to-defaults behavior implies the row may not exist), so the function inserts a new row if none exists yet, or updates the existing single row otherwise. New IPC handler `kasir:updateStoreSettings`, preload + `env.d.ts` wiring, following the exact pattern established by `kasir:recordBonPayment`.

Errors on save show inline via the existing `role="alert"` pattern already used across the app's forms — no need for field-by-field error mapping, matching how `BonPayment.tsx`'s single-message error display already works for this app's IPC-error style (not Inertia's per-field `errors` object).

## 3. Test Scanner

Verbatim port of the web app's `TestScan` component logic: a `window.addEventListener('keydown', ...)` buffer identical in shape to the one already running in `Kasir.tsx` for barcode scanning (buffers fast keystrokes ending in `Enter`, ignores input when a text field is focused, treats bursts under 4 characters as noise). Displays the last scanned code + a timestamp. No IPC, no backend — pure client-side demo, self-contained to the Settings page.

## 4. Purge History

Section with a date input ("Sebelum tanggal") and a destructive "Hapus Riwayat" button. Matches `PurgeSalesController`/`PurgeSalesRequest` exactly: deletes every `sales` row with `createdAt` before the given date, rejecting a future date. The cutoff is **local midnight** on the given date (`new Date(\`${beforeDate}T00:00:00\`)`), matching the existing local-time convention already used by `listSalesHistory`'s own `dari`/`sampai` date filters in `ipc/kasir.ts` — not UTC, which a prior plan's review flagged as a real bug class in this exact codebase. Cascades to `sale_items` and `bon_payments` automatically via the existing `onDelete: 'cascade'` foreign keys already in `desktop-node`'s schema — no manual cleanup needed. Reports how many transactions were deleted.

New business logic `purgeSalesBefore(db, beforeDate: Date): number` in `main/kasir.ts` (tested), returning the deleted-row count via Drizzle's `.run().changes`. New IPC handler `kasir:purgeSalesBefore`.

**Confirmation:** port `src/renderer/hooks/use-confirm.tsx` from `resources/js/hooks/use-confirm.tsx` — an in-app confirm dialog (`await confirm({title, description, confirmLabel, destructive})` resolving to `true`/`false`) built entirely on the `Dialog`/`DialogContent`/`DialogHeader`/`DialogFooter`/`DialogTitle`/`DialogDescription` primitives already ported to `desktop-node` (from the Kasir checkout slice) — zero new dependencies. This replaces a bare `window.confirm()` for this one destructive action; existing `window.confirm()` calls elsewhere in the app (`Kasir.tsx`'s clear-cart, `KasirHistory.tsx`'s cancel-sale) are untouched — out of scope for this plan.

## 5. Small Component Ports

- `src/renderer/components/heading.tsx` — verbatim port of `resources/js/components/heading.tsx` (title/description/variant, ~20 lines), used above each of the page's sections.
- `src/renderer/components/ui/dropdown-menu.tsx` — see §1.

## Out of Scope (this phase)

- ESC/POS printing, paper-width setting, Test Print — Phase 2, separate spec/plan.
- Any other web-app settings pages (Profile, Security, Appearance) — none apply to `desktop-node` (no email, no 2FA, no passkeys, no per-user theme override beyond the existing `use-appearance` hook).
- Retrofitting existing `window.confirm()` call sites to use the new `useConfirm` hook.
