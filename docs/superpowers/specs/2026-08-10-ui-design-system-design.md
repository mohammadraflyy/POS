# UI Design System — Phase 1

**Date:** 2026-08-10
**Status:** Approved, not yet implemented
**Scope:** Foundation only. The Kasir screen redesign gets its own spec afterwards.

## Problem

The app looks assembled rather than designed. Two concrete causes, both visible in the code:

1. **No shared page structure.** The wrapper `<div className="flex flex-1 flex-col gap-4 p-4">` and the heading `<h1 className="text-xl font-semibold">` are hand-copied across ten pages: Dashboard, Supplier, BonPayment, Purchase, KasirHistory, Inventory, Settings, StockOpname, MassInput and Rekap. Most carry both; Supplier and Inventory have only the wrapper, Settings only the heading — which is itself the symptom. Nothing governs them, so page eleven will invent its own numbers.
2. **No accent.** The palette is fully achromatic (chroma 0 on every token). Primary actions, selected rows and totals carry no more visual weight than the text around them, so the eye has nothing to land on.

## Decisions

Settled during brainstorming:

- **Direction:** monochrome plus a single accent, used sparingly — primary actions, selected rows, totals. Green and red stay reserved for paid/cancelled status.
- **Accent:** deep blue. Culturally neutral, reads well in both themes, and does not collide with the green already used for "Lunas" and change-due.
- **Density:** hybrid. Tables stay tight so many rows stay visible; anything touching money or a primary action gets room.
- **Approach:** tokens plus three shared layout components, rather than a CSS-only pass. A CSS-only pass would fix colour but leave the copy-pasted spacing untouched.

## Design

### 1. Foundation tokens — `desktop-node/src/renderer/assets/main.css`

In shadcn, `--accent` is the hover-background token, **not** the brand colour. The blue goes on `--primary`; `--accent` stays grey. Swapping them would turn every hover blue.

| Token | Light | Dark | Why |
|---|---|---|---|
| `--primary` | `oklch(0.45 0.13 250)` | `oklch(0.65 0.13 250)` | accent; lightened in dark for contrast |
| `--primary-foreground` | `oklch(0.99 0 0)` | `oklch(0.15 0 0)` | |
| `--ring` | `var(--primary)` | `var(--primary)` | the app is keyboard-first; focus must be visible |

Every other token keeps its current value — the neutral greys are already right.

Rhythm and type, applied through the components in section 2 rather than memorised per page:

- Page title: `text-lg font-semibold tracking-tight`, down from `text-xl`. A smaller title reads calmer.
- Page padding `p-6`, block gap `gap-6`, up from `p-4`/`gap-4`.
- All numerals — money, qty, stock — use `tabular-nums` so digits line up between rows.

### 2. Shared layout components — `desktop-node/src/renderer/components/page.tsx`

Three small components replacing the copy-pasted blocks:

```tsx
<Page>                                  // flex flex-1 flex-col gap-6 p-6
  <PageHeader title="Riwayat Transaksi" actions={<Button …/>} />
  <Toolbar>…filters…</Toolbar>          // flex flex-wrap items-end gap-2
  …content…
</Page>
```

- `Page` — the outer wrapper, owns page padding and block rhythm.
- `PageHeader` — a `title` string plus an optional `actions` slot rendered right-aligned.
- `Toolbar` — the filter/action row most list pages already have in some form.

Each page swaps only its outer wrapper; contents are untouched.

### 3. Table and money rules

Grid colours already follow the app tokens as of commit `f8c3192`. What remains are content rules:

- Money and numeric columns: right-aligned with `tabular-nums`, without exception.
- Row height: no page sets its own `rowHeight`; every grid uses the react-data-grid default, so rows match across pages.
- The money path gets room: total at `text-3xl`, Bayar button `h-14`, dialog inputs `h-16` (several already are).

### 4. Out of scope for this phase

Kasir layout redesign, Dashboard, dark-mode toggle behaviour, icons, animation. Kasir gets its own spec once this foundation lands.

## Build order

1. Tokens in `main.css`.
2. `components/page.tsx`.
3. Migrate the ten pages to `Page`/`PageHeader`/`Toolbar`.
4. Table and money rules.

## Verification

This is a presentation-only change, so the existing suite is the safety net: **all 306 tests must stay green**. A red test means behaviour changed by accident. Plus `npx tsc --noEmit -p tsconfig.json` and `npm run build`.

Main-process tests need the ABI dance — `npm run rebuild:node`, run tests, `npm run rebuild:electron` — or the app will not boot afterwards.

## Known risk

`Inventory.tsx`, `KasirHistory.tsx` and `MassInput.tsx` compute the name-column width by hand (`OTHER_COLUMNS_WIDTH = 50 + 60 + 110 + …`), summing every other column's fixed width. Any change to cell padding or column widths puts that sum out of step with reality, and the name column silently mis-sizes.

Section 3 does not change padding, but all three constants must be checked against their column lists during implementation. `Inventory.tsx` is already out of step: its `no` column dropped its explicit `width` while the constant still counts 60 for it.
