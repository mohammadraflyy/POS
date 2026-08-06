# Fase 2 Slice 2, Plan B — Cart & Payment UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal, unstyled `desktop-node/src/renderer/pages/Kasir.tsx` (from Fase 2 Slice 1) with a full port of the web app's Kasir UX — `react-data-grid` cart with inline qty editing and satuan pills, a keyboard-driven payment dialog, a command-palette product search, and every keyboard shortcut (barcode scan, `/`, `Alt+K`, lone-Enter-to-pay) — all wired to the IPC channels already built and tested in Slice 1. Printing (`Simpan + Cetak`) is explicitly **not** in this plan — every action here is "Simpan" only; cetak struk is Plan C.

**Architecture:** Business logic that was inline in the web `kasir.tsx` (unit/price resolution, the "cleanest satuan for a typed qty" algorithm) moves into a pure, tested module (`pages/kasir/cart-logic.ts`), mirroring the `main/kasir.ts` pattern from earlier plans. The 1298-line web component is split into 4 files under a new `pages/kasir/` folder (`cart-logic.ts`, `CartGrid.tsx`, `PaymentDialog.tsx`, `CommandPalette.tsx`) plus the orchestrating `pages/Kasir.tsx`, instead of one monolithic file — each has one clear responsibility and can be reasoned about independently.

**Tech Stack:** `react-data-grid` (cart grid), the 7 shadcn/ui components + `cn`/`formatRupiah`/`useAppearance` from Plan A, `lucide-react` icons already installed.

## Global Constraints

- New/modified code lives entirely under `desktop-node/`. Do not touch `app/`, `routes/`, `resources/`, `nativephp/`, or any other Laravel file — those are the read-only source of truth being ported from.
- Every ported piece of logic/markup must match its web source (`resources/js/pages/kasir.tsx`) **behaviorally** — same shortcuts, same resolution algorithm, same dialog interaction — adapted only for: (a) desktop-node's data shapes (camelCase, money already in Rupiah numbers not decimal strings, `productId`/`productUnitId` not nested Eloquent relations), (b) IPC calls (`window.api.kasir.*`) instead of Inertia `router.post`, (c) no printing (every "Simpan + Cetak" path becomes plain "Simpan" — Plan C adds printing back), (d) the existing "Transaksi Hari Ini + Batal" section from Slice 1 is **kept and restyled**, not removed, even though the web app has no equivalent on this page (the human explicitly decided this: it's the only way to cancel a sale until a separate History page exists in a future slice).
- Money in the renderer is always a Rupiah `number` (never cents, never a decimal string) — this was already true after Slice 1's IPC boundary conversion; nothing in this plan changes that contract.
- Two fixes carried forward from Plan A's final review, both folded into this plan since this is the first work that actually exercises them:
  1. `desktop-node/vitest.config.ts` has no `@` alias and its `include` glob is `*.test.ts` only — the first `.tsx`-adjacent test in this plan would silently not run and any test importing `@/lib/utils` would fail to resolve. Fixed in Task 1.
  2. `desktop-node/src/renderer/hooks/use-appearance.ts`'s `handleSystemThemeChange` calls `applyTheme` but never `notify()`, so React consumers of `resolvedAppearance` (this plan's `CartGrid`, for `rdg-dark`/`rdg-light`) go stale on an OS theme flip while `<html class="dark">` itself stays correct. This is a bug the web app has too (faithfully inherited), but the controller has decided to fix it now rather than carry it forward, since this plan is the first real consumer of `resolvedAppearance`. Fixed in Task 5.

---

## Task 1: Cart resolution logic (pure, tested) + vitest config fix

**Files:**
- Modify: `desktop-node/vitest.config.ts`
- Create: `desktop-node/src/renderer/pages/kasir/cart-logic.ts`
- Create: `desktop-node/src/renderer/pages/kasir/cart-logic.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions/types, no DB/IPC).
- Produces: `ProductUnitOption`, `PriceTier`, `Product`, `CartLine` types; `priceForQty(priceTiers, hargaJualDasar, qty): number`; `unitPrice(line: CartLine): number`; `lineKey(productId, productUnitId): string`; `unitKonversi(line: CartLine): number`; `QTY_EPSILON`; `pickUnitForBaseQty(product, baseQty): {productUnitId, qty, satuan}`; `resolveLineQty(line, typedQty): {productUnitId, qty, satuan}` — consumed by Task 2 (`CartGrid`), Task 4 (`CommandPalette`), and Task 5 (`Kasir.tsx`).

- [ ] **Step 1: Fix the vitest config**

`desktop-node/vitest.config.ts` currently reads:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
```

Replace it with (adds the `@` alias matching `electron.vite.config.ts`'s renderer mapping and `tsconfig.json`'s Plan-A fix, and widens `include` to also collect `.tsx` test files, which this and later plans may add):

```typescript
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

- [ ] **Step 2: Write the failing tests**

Create `desktop-node/src/renderer/pages/kasir/cart-logic.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { lineKey, pickUnitForBaseQty, resolveLineQty, unitKonversi, unitPrice, type CartLine, type Product } from './cart-logic'

const product: Product = {
  id: 1,
  kodeItem: 'BRS5',
  barcode: '8991234500015',
  namaItem: 'Beras 5kg',
  satuan: 'PCS',
  hargaJual: 65000,
  stok: 100,
  productUnits: [{ id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000 }],
  priceTiers: [{ minQty: 5, hargaJual: 62000 }],
}

describe('unitPrice', () => {
  it('uses tier pricing for the base unit when qty meets a tier', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 5 }
    expect(unitPrice(line)).toBe(62000)
  })

  it('falls back to the base price below any tier threshold', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2 }
    expect(unitPrice(line)).toBe(65000)
  })

  it('uses the fixed unit price when a productUnitId is set, ignoring tiers', () => {
    const line: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(unitPrice(line)).toBe(700000)
  })
})

describe('unitKonversi', () => {
  it('is 1 for the base unit', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }
    expect(unitKonversi(line)).toBe(1)
  })

  it('is the unit konversi for a derived unit', () => {
    const line: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(unitKonversi(line)).toBe(12)
  })
})

describe('pickUnitForBaseQty', () => {
  it('picks the base unit when the qty does not divide evenly into any derived unit', () => {
    expect(pickUnitForBaseQty(product, 5)).toEqual({ productUnitId: null, qty: 5, satuan: 'PCS' })
  })

  it('picks the derived unit with the largest konversi that divides evenly', () => {
    expect(pickUnitForBaseQty(product, 24)).toEqual({ productUnitId: 9, qty: 2, satuan: 'DUS' })
  })

  it('rounds up to at least 1 when the base qty is below any unit', () => {
    expect(pickUnitForBaseQty(product, 0.3)).toEqual({ productUnitId: null, qty: 1, satuan: 'PCS' })
  })
})

describe('resolveLineQty', () => {
  it('converts a typed qty in the current unit to base units, then picks the cleanest unit', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }
    expect(resolveLineQty(line, 24)).toEqual({ productUnitId: 9, qty: 2, satuan: 'DUS' })
  })

  it('resolves a typed qty while already on a derived unit', () => {
    const line: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(resolveLineQty(line, 0.5)).toEqual({ productUnitId: null, qty: 6, satuan: 'PCS' })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd desktop-node
npm run test
```

Expected: FAIL — `cart-logic.ts` does not exist.

- [ ] **Step 4: Write the implementation**

Create `desktop-node/src/renderer/pages/kasir/cart-logic.ts`. This is a port of `resources/js/pages/kasir.tsx`'s `unitPrice`/`lineKey`/`unitKonversi`/`pickUnitForBaseQty`/`resolveLineQty`, adapted to desktop-node's camelCase, already-numeric (not decimal-string) `Product` shape, and reusing the `priceForQty` naming already established in `main/kasir.ts` (Slice 1) instead of the web app's inline tier-filtering logic in `unitPrice`:

```typescript
export interface ProductUnitOption {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
}

export interface PriceTier {
  minQty: number
  hargaJual: number
}

export interface Product {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  satuan: string
  hargaJual: number
  stok: number
  productUnits: ProductUnitOption[]
  priceTiers: PriceTier[]
}

/** the base unit is represented as productUnitId: null */
export interface CartLine {
  key: string
  product: Product
  productUnitId: number | null
  satuan: string
  qty: number
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  const applicable = priceTiers.filter((tier) => qty >= tier.minQty).sort((a, b) => b.minQty - a.minQty)
  return applicable[0]?.hargaJual ?? hargaJualDasar
}

/** resolve the price for a cart line - fixed for a derived unit, tiered by qty for the base unit */
export function unitPrice(line: CartLine): number {
  if (line.productUnitId !== null) {
    const unit = line.product.productUnits.find((u) => u.id === line.productUnitId)
    return unit?.hargaJual ?? line.product.hargaJual
  }

  return priceForQty(line.product.priceTiers, line.product.hargaJual, line.qty)
}

export function lineKey(productId: number, productUnitId: number | null): string {
  return `${productId}:${productUnitId ?? 'base'}`
}

export function unitKonversi(line: CartLine): number {
  if (line.productUnitId === null) {
    return 1
  }

  return line.product.productUnits.find((u) => u.id === line.productUnitId)?.konversi ?? 1
}

export const QTY_EPSILON = 1e-6

/**
 * Picks the cleanest satuan for a quantity expressed in the product's base
 * unit: the one with the largest konversi that still divides evenly, so
 * typing e.g. 0.1 DUS (= 1 RNTNG at the base) resolves to "1 RNTNG" rather
 * than staying "0.1 DUS", and typing 10 RNTNG while on the base unit
 * resolves up to "1 DUS". Falls back to rounding at the base unit when
 * nothing divides evenly (a true fractional amount with no matching unit).
 */
export function pickUnitForBaseQty(
  product: Product,
  baseQty: number,
): { productUnitId: number | null; qty: number; satuan: string } {
  const candidates = [
    { id: null as number | null, satuan: product.satuan, konversi: 1 },
    ...product.productUnits.map((u) => ({ id: u.id as number | null, satuan: u.satuan, konversi: u.konversi })),
  ]

  const exact = candidates
    .filter((c) => {
      const q = baseQty / c.konversi
      return Math.abs(q - Math.round(q)) < QTY_EPSILON
    })
    .sort((a, b) => b.konversi - a.konversi)

  const best = exact[0] ?? candidates[0]
  const resolvedBaseQty = exact[0] ? baseQty : Math.max(1, Math.round(baseQty))

  return {
    productUnitId: best.id,
    qty: Math.max(1, Math.round(resolvedBaseQty / best.konversi)),
    satuan: best.satuan,
  }
}

/** typedQty is in whatever satuan the line currently has selected */
export function resolveLineQty(line: CartLine, typedQty: number) {
  const baseQty = typedQty * unitKonversi(line)
  return pickUnitForBaseQty(line.product, baseQty)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd desktop-node
npm run test
```

Expected: PASS — all 10 new tests plus everything from Fase 1/Slice 1/Plan A (39 existing).

- [ ] **Step 6: Commit**

```bash
cd C:\Work\POS
git add desktop-node/vitest.config.ts desktop-node/src/renderer/pages/kasir/cart-logic.ts desktop-node/src/renderer/pages/kasir/cart-logic.test.ts
git commit -m "Add cart resolution logic and fix vitest's @ alias"
```

---

## Task 2: `useElementWidth` hook, `barcode` field, and `CartGrid`

**Files:**
- Create: `desktop-node/src/renderer/hooks/use-element-width.ts`
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`
- Create: `desktop-node/src/renderer/pages/kasir/CartGrid.tsx`

**Interfaces:**
- Consumes: `CartLine`, `Product`, `unitPrice` (Task 1); `cn`, `formatRupiah` (Plan A `lib/utils`); `Button` (Plan A).
- Produces: `useElementWidth<T>(): [ref, width]`; `window.api.kasir.listProducts()` now includes `barcode: string | null` per product; `QTY_COLUMN_IDX` (exported constant); `CartGrid` component — consumed by Task 5 (`Kasir.tsx`, which also needs `QTY_COLUMN_IDX` for `focusCartQty`).

- [ ] **Step 1: Add the `react-data-grid` dependency**

```bash
cd desktop-node
npm install react-data-grid
```

- [ ] **Step 2: Port `useElementWidth`**

Create `desktop-node/src/renderer/hooks/use-element-width.ts` — verbatim port of `resources/js/hooks/use-element-width.ts`:

```typescript
import { useCallback, useRef, useState } from 'react'

/** Tracks an element's rendered width, for grids whose column library needs a pixel width to fill available space. */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect()

    if (!el) {
      return
    }

    observerRef.current = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width)
    })
    observerRef.current.observe(el)
  }, [])

  return [ref, width] as const
}
```

- [ ] **Step 3: Add `barcode` to the `kasir:listProducts` IPC response**

`desktop-node/src/main/ipc/kasir.ts`'s `kasir:listProducts` handler currently maps each product to (lines 34-52 of the current file):

```typescript
    return productRows.map((product) => ({
      id: product.id,
      kodeItem: product.kodeItem,
      namaItem: product.namaItem,
      satuan: product.satuan,
      hargaJual: toRupiah(product.hargaJual),
      stok: product.stok,
      productUnits: unitRows
        .filter((unit) => unit.productId === product.id)
        .map((unit) => ({
          id: unit.id,
          satuan: unit.satuan,
          konversi: unit.konversi,
          hargaJual: toRupiah(unit.hargaJual),
        })),
      priceTiers: tierRows
        .filter((tier) => tier.productId === product.id)
        .map((tier) => ({ minQty: tier.minQty, hargaJual: toRupiah(tier.hargaJual) })),
    }))
```

Add `barcode: product.barcode,` right after `kodeItem` (the `products` table already has this column, from the Fase 1 schema — it was just never selected into this response before):

```typescript
    return productRows.map((product) => ({
      id: product.id,
      kodeItem: product.kodeItem,
      barcode: product.barcode,
      namaItem: product.namaItem,
      satuan: product.satuan,
      hargaJual: toRupiah(product.hargaJual),
      stok: product.stok,
      productUnits: unitRows
        .filter((unit) => unit.productId === product.id)
        .map((unit) => ({
          id: unit.id,
          satuan: unit.satuan,
          konversi: unit.konversi,
          hargaJual: toRupiah(unit.hargaJual),
        })),
      priceTiers: tierRows
        .filter((tier) => tier.productId === product.id)
        .map((tier) => ({ minQty: tier.minQty, hargaJual: toRupiah(tier.hargaJual) })),
    }))
```

- [ ] **Step 4: Update the `listProducts` type in `env.d.ts`**

`desktop-node/src/renderer/env.d.ts`'s `listProducts` return type currently reads:

```typescript
        listProducts: () => Promise<
          {
            id: number
            kodeItem: string
            namaItem: string
            satuan: string
            hargaJual: number
            stok: number
            productUnits: { id: number; satuan: string; konversi: number; hargaJual: number }[]
            priceTiers: { minQty: number; hargaJual: number }[]
          }[]
        >
```

Add `barcode: string | null` right after `kodeItem`:

```typescript
        listProducts: () => Promise<
          {
            id: number
            kodeItem: string
            barcode: string | null
            namaItem: string
            satuan: string
            hargaJual: number
            stok: number
            productUnits: { id: number; satuan: string; konversi: number; hargaJual: number }[]
            priceTiers: { minQty: number; hargaJual: number }[]
          }[]
        >
```

- [ ] **Step 5: Write `CartGrid`**

Create `desktop-node/src/renderer/pages/kasir/CartGrid.tsx`. This is a port of the cart `DataGrid` block from `resources/js/pages/kasir.tsx` (its `renderQtyEditCell`, `cartColumns`, and the `<DataGrid>` JSX), extracted into its own component that takes the cart and callbacks as props instead of owning state directly (state stays in `Kasir.tsx`, Task 5 — this component is presentational):

```typescript
import type { RefObject } from 'react'
import type {
  CellKeyboardEvent,
  CellKeyDownArgs,
  Column,
  DataGridHandle,
  RenderEditCellProps,
  RowsChangeData,
} from 'react-data-grid'
import { DataGrid } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatRupiah } from '@/lib/utils'
import { unitPrice, type CartLine } from './cart-logic'

function focusAndSelectQtyInput(input: HTMLInputElement | null) {
  input?.focus()
  input?.select()
}

function renderQtyEditCell({ row, onRowChange, onClose }: RenderEditCellProps<CartLine>) {
  return (
    <input
      type="text"
      inputMode="decimal"
      ref={focusAndSelectQtyInput}
      value={row.qty}
      title="Boleh diisi pecahan, misalnya 0.5 - otomatis dibulatkan ke satuan yang pas"
      className="h-full w-full bg-background px-2 text-center text-sm font-semibold outline-none"
      onChange={(e) => onRowChange({ ...row, qty: Number(e.target.value) || 0 })}
      onBlur={() => onClose(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onClose(true, false)
        } else if (e.key === 'Escape') {
          onClose(false)
        }
      }}
    />
  )
}

/** index of the 'qty' column within the columns array (produk, satuan, harga, qty, subtotal, aksi) */
export const QTY_COLUMN_IDX = 3

export interface CartGridProps {
  cart: CartLine[]
  width: number
  resolvedAppearance: 'light' | 'dark'
  gridRef: RefObject<DataGridHandle>
  onRowsChange: (rows: CartLine[], data: RowsChangeData<CartLine>) => void
  onCellKeyDown: (args: CellKeyDownArgs<CartLine>, event: CellKeyboardEvent) => void
  onChangeUnit: (line: CartLine, productUnitId: number | null) => void
  onRemoveLine: (key: string) => void
}

export function CartGrid({
  cart,
  width,
  resolvedAppearance,
  gridRef,
  onRowsChange,
  onCellKeyDown,
  onChangeUnit,
  onRemoveLine,
}: CartGridProps) {
  const CART_OTHER_COLUMNS_WIDTH = 180 + 120 + 80 + 130 + 50
  const produkWidth = Math.max(160, width - CART_OTHER_COLUMNS_WIDTH - 2)

  const columns: Column<CartLine>[] = [
    {
      key: 'produk',
      name: 'Produk',
      width: produkWidth,
      renderCell: ({ row }) => <span className="font-medium">{row.product.namaItem}</span>,
    },
    {
      key: 'satuan',
      name: 'Satuan',
      width: 180,
      renderCell: ({ row }) =>
        row.product.productUnits.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 py-1">
            <button
              type="button"
              onClick={() => onChangeUnit(row, null)}
              className={cn(
                'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                row.productUnitId === null
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background hover:bg-accent',
              )}
            >
              {row.product.satuan}
            </button>
            {row.product.productUnits.map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => onChangeUnit(row, unit.id)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                  row.productUnitId === unit.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent',
                )}
              >
                {unit.satuan}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{row.satuan}</span>
        ),
    },
    {
      key: 'harga',
      name: 'Harga',
      width: 120,
      renderCell: ({ row }) => <span className="text-xs text-muted-foreground">{formatRupiah(unitPrice(row))}</span>,
    },
    {
      key: 'qty',
      name: 'Qty',
      width: 80,
      editable: true,
      renderEditCell: renderQtyEditCell,
      renderCell: ({ row }) => (
        <span
          className="text-sm font-semibold"
          title="Boleh diisi pecahan, misalnya 0.5 - otomatis dibulatkan ke satuan yang pas"
        >
          {row.qty}
        </span>
      ),
    },
    {
      key: 'subtotal',
      name: 'Subtotal',
      width: 130,
      renderCell: ({ row }) => (
        <span className="w-full text-right font-semibold">{formatRupiah(row.qty * unitPrice(row))}</span>
      ),
    },
    {
      key: 'aksi',
      name: '',
      width: 50,
      renderCell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onRemoveLine(row.key)}
        >
          <X className="size-4" />
        </Button>
      ),
    },
  ]

  return (
    <DataGrid
      ref={gridRef}
      className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
      columns={columns}
      rows={cart}
      onRowsChange={onRowsChange}
      onCellKeyDown={onCellKeyDown}
      rowKeyGetter={(row) => row.key}
      headerRowHeight={44}
      rowHeight={48}
      style={{ blockSize: 44 + cart.length * 48 + 2 }}
    />
  )
}
```

- [ ] **Step 6: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 7: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — no new test files in this task (`CartGrid` is presentational; it's exercised in Task 5's manual verification), confirms nothing broke.

- [ ] **Step 8: Commit**

```bash
cd C:\Work\POS
git add desktop-node/package.json desktop-node/package-lock.json desktop-node/src/renderer/hooks/use-element-width.ts desktop-node/src/main/ipc/kasir.ts desktop-node/src/renderer/env.d.ts desktop-node/src/renderer/pages/kasir/CartGrid.tsx
git commit -m "Add useElementWidth, barcode field, and CartGrid"
```

---

## Task 3: `PaymentDialog`

**Files:**
- Create: `desktop-node/src/renderer/pages/kasir/PaymentDialog.tsx`

**Interfaces:**
- Consumes: `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`, `Button`, `Input`, `Label` (Plan A); `cn`, `formatRupiah` (Plan A `lib/utils`).
- Produces: `PaymentDialog` component (props: `open`, `onOpenChange`, `total`, `metode`, `setMetode`, `namaPelanggan`, `setNamaPelanggan`, `dibayar`, `setDibayar`, `processing`, `error`, `onSubmit`) — consumed by Task 5 (`Kasir.tsx`).

- [ ] **Step 1: Write `PaymentDialog`**

Create `desktop-node/src/renderer/pages/kasir/PaymentDialog.tsx`. This is a port of `resources/js/pages/kasir.tsx`'s `PaymentDialog` function, with two adaptations: (1) no printing in this plan, so the 3-action cycle (`cetak`/`simpan`/`batal`) becomes 2 actions (`simpan`/`batal`), the "Simpan + Cetak" button becomes a plain "Simpan" button, and the `printing`/spinner state is dropped entirely; (2) desktop-node's `checkout` throws a single `Error` message rather than Laravel's per-field validation errors object, so the web app's per-field `InputError` components become one shared `error: string | null` prop shown once at the bottom of the form:

```typescript
import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Banknote, CornerDownLeft, HandCoins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, formatRupiah } from '@/lib/utils'

const actions = ['simpan', 'batal'] as const
type Action = (typeof actions)[number]

export interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  metode: 'tunai' | 'bon'
  setMetode: (metode: 'tunai' | 'bon') => void
  namaPelanggan: string
  setNamaPelanggan: (value: string) => void
  dibayar: string
  setDibayar: (value: string) => void
  processing: boolean
  error: string | null
  onSubmit: () => void
}

export function PaymentDialog({
  open,
  onOpenChange,
  total,
  metode,
  setMetode,
  namaPelanggan,
  setNamaPelanggan,
  dibayar,
  setDibayar,
  processing,
  error,
  onSubmit,
}: PaymentDialogProps) {
  const totalBayar = metode === 'tunai' ? Number(dibayar || 0) : 0
  const selisih = total - totalBayar
  const isLunas = metode === 'tunai' && selisih <= 0

  // PageUp/PageDown cycle which action Enter will fire, so the whole
  // dialog can be driven without a mouse: type the amount, PgDn/PgUp to
  // the action you want, Enter to run it. Alt+letter shortcuts don't type
  // into focused inputs, so those work regardless of what's focused too.
  const [selectedAction, setSelectedAction] = useState<Action>('simpan')
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)

    if (open) {
      setSelectedAction('simpan')
    }
  }

  function runAction(action: Action) {
    if (action === 'simpan') {
      onSubmit()
    } else {
      onOpenChange(false)
    }
  }

  function handleShortcut(e: ReactKeyboardEvent) {
    if (processing) {
      return
    }

    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      const index = actions.indexOf(selectedAction)
      const delta = e.key === 'PageDown' ? 1 : -1
      setSelectedAction(actions[(index + delta + actions.length) % actions.length])

      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      runAction(selectedAction)

      return
    }

    if (!e.altKey) {
      return
    }

    switch (e.key.toLowerCase()) {
      case 't':
        e.preventDefault()
        setMetode('tunai')
        break
      case 'b':
        e.preventDefault()
        setMetode('bon')
        break
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>Pembayaran</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
          onKeyDown={handleShortcut}
          className="space-y-5"
        >
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={metode === 'tunai' ? 'default' : 'outline'}
              disabled={processing}
              onClick={() => setMetode('tunai')}
            >
              <Banknote className="size-4" />
              Tunai
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+T</kbd>
            </Button>
            <Button
              type="button"
              variant={metode === 'bon' ? 'default' : 'outline'}
              disabled={processing}
              onClick={() => setMetode('bon')}
            >
              <HandCoins className="size-4" />
              Bon
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+B</kbd>
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-foreground px-5 py-4">
            <span className="text-sm text-background/60">Total Tagihan</span>
            <span className="text-4xl font-bold text-background tabular-nums">{formatRupiah(total)}</span>
          </div>

          {metode === 'tunai' ? (
            <div className="grid gap-2">
              <Label htmlFor="dibayar">Uang Tunai</Label>
              <Input
                id="dibayar"
                autoFocus
                inputMode="numeric"
                placeholder="0"
                value={dibayar}
                disabled={processing}
                onChange={(e) => setDibayar(e.target.value)}
                className="h-16 text-right text-2xl font-semibold tabular-nums"
              />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="nama_pelanggan">Nama Pelanggan</Label>
              <Input
                id="nama_pelanggan"
                autoFocus
                value={namaPelanggan}
                disabled={processing}
                onChange={(e) => setNamaPelanggan(e.target.value)}
                className="h-16 text-xl"
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-green-500/15 px-5 py-3.5 dark:bg-green-500/20">
              <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                {metode === 'tunai' ? 'Dibayar' : 'Bon'}
              </span>
              <span className="text-2xl font-bold text-green-700 tabular-nums dark:text-green-400">
                {formatRupiah(totalBayar)}
              </span>
            </div>

            <div
              className={cn(
                'flex items-center justify-between rounded-xl px-5 py-3.5',
                isLunas ? 'bg-green-500/15 dark:bg-green-500/20' : 'bg-orange-500/15 dark:bg-orange-500/20',
              )}
            >
              <span
                className={cn(
                  'text-sm font-semibold',
                  isLunas ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400',
                )}
              >
                {isLunas ? 'Kembalian' : 'Kekurangan'}
              </span>
              <span
                className={cn(
                  'text-2xl font-bold tabular-nums',
                  isLunas ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400',
                )}
              >
                {formatRupiah(Math.abs(selisih))}
              </span>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <Button
              type="submit"
              disabled={processing}
              className={cn(
                'w-full',
                selectedAction === 'simpan' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
              )}
            >
              {selectedAction === 'simpan' && <CornerDownLeft className="size-4" />}
              Simpan
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={processing}
              className={cn(
                'w-full',
                selectedAction === 'batal' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
              )}
              onClick={() => onOpenChange(false)}
            >
              {selectedAction === 'batal' && <CornerDownLeft className="size-3.5" />}
              Batal
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Esc</kbd>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">PgUp/PgDn</kbd> pilih aksi &middot;{' '}
              <kbd className="rounded border bg-muted px-1.5 py-0.5">Enter</kbd> jalankan
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 3: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — no new test files, confirms nothing broke.

- [ ] **Step 4: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/pages/kasir/PaymentDialog.tsx
git commit -m "Add keyboard-driven PaymentDialog"
```

---

## Task 4: `CommandPalette`

**Files:**
- Create: `desktop-node/src/renderer/pages/kasir/CommandPalette.tsx`

**Interfaces:**
- Consumes: `CommandDialog`/`CommandEmpty`/`CommandGroup`/`CommandInput`/`CommandItem`/`CommandList` (Plan A); `formatRupiah` (Plan A `lib/utils`); `Product` (Task 1).
- Produces: `CommandPalette` component (props: `open`, `onOpenChange`, `query`, `onQueryChange`, `results`, `onSelect`, `onCloseAutoFocus`) — consumed by Task 5 (`Kasir.tsx`).

- [ ] **Step 1: Write `CommandPalette`**

Create `desktop-node/src/renderer/pages/kasir/CommandPalette.tsx`. This is a port of the `CommandDialog` block from `resources/js/pages/kasir.tsx`, extracted into its own component. The state it reads (`paletteQuery`/results filtering) stays owned by `Kasir.tsx` (Task 5), passed in as props — this component is presentational plus its own keyboard handling for the search input:

```typescript
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { formatRupiah } from '@/lib/utils'
import type { Product } from './cart-logic'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (query: string) => void
  results: Product[]
  onSelect: (product: Product) => void
  onCloseAutoFocus: (event: Event) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  onSelect,
  onCloseAutoFocus,
}: CommandPaletteProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title="Cari Produk"
      description="Cari produk untuk ditambahkan ke keranjang"
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={onQueryChange}
        onKeyDown={(e) => {
          if (e.key === 'PageDown' || e.key === 'PageUp') {
            e.preventDefault()
            e.currentTarget.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: e.key === 'PageDown' ? 'ArrowDown' : 'ArrowUp',
                bubbles: true,
              }),
            )

            return
          }

          if (e.key !== 'Enter') {
            return
          }

          const code = query.trim()
          const product = results.find((p) => p.barcode === code)

          if (!product) {
            return
          }

          e.preventDefault()
          onSelect(product)
        }}
        placeholder="Cari nama / kode produk..."
      />
      <CommandList>
        <CommandEmpty>{query.trim() === '' ? 'Ketik untuk mencari produk.' : 'Produk tidak ditemukan.'}</CommandEmpty>
        {results.length > 0 && (
          <CommandGroup heading="Produk">
            {results.map((product) => (
              <CommandItem
                key={product.id}
                value={product.id.toString()}
                disabled={product.stok <= 0}
                onSelect={() => onSelect(product)}
                className="flex items-center justify-between"
              >
                <span>
                  <span className="font-medium">{product.namaItem}</span>
                  <span className="text-muted-foreground"> &middot; {product.kodeItem}</span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {formatRupiah(product.hargaJual)} / {product.satuan}
                  {product.stok <= 0 && <span className="text-destructive">Habis</span>}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">&uarr;&darr;</kbd>
          <kbd className="rounded border bg-muted px-1.5 py-0.5">PgUp/PgDn</kbd>
          pilih
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">&crarr;</kbd>
          tambah
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">esc</kbd>
          tutup
        </span>
      </div>
    </CommandDialog>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 3: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — no new test files, confirms nothing broke.

- [ ] **Step 4: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/pages/kasir/CommandPalette.tsx
git commit -m "Add CommandPalette product search"
```

---

## Task 5: Assemble `Kasir.tsx`, fix `useAppearance`, manual verification

**Files:**
- Modify: `desktop-node/src/renderer/hooks/use-appearance.ts`
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-4 (`cart-logic.ts`, `CartGrid`, `PaymentDialog`, `CommandPalette`), `useAppearance` (Plan A, fixed in this task), `useElementWidth` (Task 2), `Badge`/`Button` (Plan A), `window.api.kasir.*`/`window.api.auth.*` (Slice 1, unchanged).
- Produces: the real, fully-interactive Kasir page.

- [ ] **Step 1: Fix `useAppearance`'s missed `notify()` call**

`desktop-node/src/renderer/hooks/use-appearance.ts` currently has:

```typescript
const handleSystemThemeChange = (): void => applyTheme(currentAppearance)
```

Change it to also notify subscribed React components (so `useAppearance()`'s `resolvedAppearance` re-renders on an OS light/dark flip, not just the `<html>` class):

```typescript
const handleSystemThemeChange = (): void => {
  applyTheme(currentAppearance)
  notify()
}
```

- [ ] **Step 2: Replace `Kasir.tsx`**

Replace the entire contents of `desktop-node/src/renderer/pages/Kasir.tsx` with:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CellKeyboardEvent, CellKeyDownArgs, DataGridHandle, RowsChangeData } from 'react-data-grid'
import { Search, ShoppingCart, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppearance } from '@/hooks/use-appearance'
import { useElementWidth } from '@/hooks/use-element-width'
import { cn, formatRupiah } from '@/lib/utils'
import type { AuthUser } from '../types'
import { CartGrid, QTY_COLUMN_IDX } from './kasir/CartGrid'
import { PaymentDialog } from './kasir/PaymentDialog'
import { CommandPalette } from './kasir/CommandPalette'
import { lineKey, resolveLineQty, unitPrice, type CartLine, type Product } from './kasir/cart-logic'

interface SaleDto {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}

export function Kasir() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [salesToday, setSalesToday] = useState<SaleDto[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [scanError, setScanError] = useState('')
  const [metode, setMetode] = useState<'tunai' | 'bon'>('tunai')
  const [namaPelanggan, setNamaPelanggan] = useState('')
  const [dibayar, setDibayar] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const { resolvedAppearance } = useAppearance()
  const [cartWidthRef, cartGridWidth] = useElementWidth<HTMLDivElement>()
  const cartGridRef = useRef<DataGridHandle>(null)
  const lastTouchedKeyRef = useRef<string | null>(null)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function refreshProducts() {
    window.api.kasir
      .listProducts()
      .then(setProducts)
      .catch(() => setError('Gagal memuat data.'))
  }

  function refreshSalesToday() {
    window.api.kasir
      .listSalesToday()
      .then(setSalesToday)
      .catch(() => setError('Gagal memuat data.'))
  }

  const total = useMemo(() => cart.reduce((sum, line) => sum + line.qty * unitPrice(line), 0), [cart])
  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + line.qty, 0), [cart])

  const paletteResults = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase()

    if (!q) {
      return []
    }

    return products
      .filter((p) => p.namaItem.toLowerCase().includes(q) || p.kodeItem.toLowerCase().includes(q))
      .slice(0, 50)
  }, [products, paletteQuery])

  function addProductToCart(product: Product) {
    const key = lineKey(product.id, null)
    lastTouchedKeyRef.current = key

    setCart((prev) => {
      const existing = prev.find((i) => i.key === key)

      if (existing) {
        return prev.map((i) => (i.key === key ? { ...i, qty: i.qty + 1 } : i))
      }

      return [...prev, { key, product, productUnitId: null, satuan: product.satuan, qty: 1 }]
    })
  }

  function changeLineUnit(line: CartLine, productUnitId: number | null) {
    const newKey = lineKey(line.product.id, productUnitId)

    if (newKey === line.key) {
      return
    }

    setCart((prev) => {
      if (prev.some((i) => i.key === newKey)) {
        return prev
          .filter((i) => i.key !== line.key)
          .map((i) => (i.key === newKey ? { ...i, qty: i.qty + line.qty } : i))
      }

      const unit = line.product.productUnits.find((u) => u.id === productUnitId)

      return prev.map((i) =>
        i.key === line.key
          ? { ...i, key: newKey, productUnitId, satuan: unit?.satuan ?? line.product.satuan }
          : i,
      )
    })
  }

  // Hardware scanners type a barcode + Enter almost instantly (unlike a
  // human). We buffer keystrokes globally and treat a fast burst ending in
  // Enter as a scan - only while no input/textarea is focused, so it never
  // fights with normal typing in the search box, payment fields, etc.
  const scanBuffer = useRef('')
  const scanLastKeyAt = useRef(0)

  useEffect(() => {
    function isEditableFocused() {
      const el = document.activeElement

      return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }

    function handleKeydown(e: globalThis.KeyboardEvent) {
      if (isEditableFocused()) {
        return
      }

      if (e.key === '/' && scanBuffer.current === '') {
        e.preventDefault()
        setPaletteQuery('')
        setPaletteOpen(true)

        return
      }

      if (e.altKey && e.key.toLowerCase() === 'k' && !paymentOpen) {
        e.preventDefault()
        clearCart()

        return
      }

      const now = Date.now()

      if (now - scanLastKeyAt.current > 100) {
        scanBuffer.current = ''
      }

      scanLastKeyAt.current = now

      if (e.key === 'Enter') {
        const code = scanBuffer.current
        scanBuffer.current = ''

        if (code.length < 4) {
          // Not a fast scan burst - treat a lone Enter as the "Bayar"
          // shortcut so checkout can be fully keyboard driven. Only when
          // nothing else is focused, so it doesn't double-fire alongside a
          // button's own native Enter-activates click.
          if (
            cart.length > 0 &&
            !paymentOpen &&
            (document.activeElement === document.body || document.activeElement === null)
          ) {
            e.preventDefault()
            setPaymentOpen(true)
          }

          return
        }

        e.preventDefault()
        const product = products.find((p) => p.barcode === code)

        if (!product) {
          setScanError(`Barcode "${code}" tidak ditemukan.`)
        } else {
          setScanError('')
          addProductToCart(product)
        }

        return
      }

      if (e.key.length === 1) {
        scanBuffer.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeydown)

    return () => window.removeEventListener('keydown', handleKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, cart.length, paymentOpen])

  /** resolves rawQty to the cleanest satuan and merges into an existing line for that satuan if one exists */
  function applyResolvedQty(key: string, rawQty: number) {
    setCart((prev) => {
      const line = prev.find((i) => i.key === key)

      if (!line) {
        return prev
      }

      const resolved = resolveLineQty(line, rawQty > 0 ? rawQty : 1)
      const newKey = lineKey(line.product.id, resolved.productUnitId)

      if (prev.some((i) => i.key === newKey && i.key !== line.key)) {
        return prev
          .filter((i) => i.key !== line.key)
          .map((i) => (i.key === newKey ? { ...i, qty: i.qty + resolved.qty } : i))
      }

      return prev.map((i) =>
        i.key === line.key
          ? { ...i, key: newKey, productUnitId: resolved.productUnitId, satuan: resolved.satuan, qty: resolved.qty }
          : i,
      )
    })
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((i) => i.key !== key))
  }

  function clearCart() {
    if (cart.length === 0) {
      return
    }

    if (!confirm('Kosongkan keranjang?')) {
      return
    }

    setCart([])
  }

  function handleCartRowsChange(newRows: CartLine[], { indexes }: RowsChangeData<CartLine>) {
    const editedRow = newRows[indexes[0]]
    applyResolvedQty(editedRow.key, editedRow.qty)
  }

  // A cell being selected (not yet in edit mode) still counts as "nothing
  // to type" - Enter there should behave like the global lone-Enter
  // shortcut and jump to Bayar, not start editing the cell.
  function handleCartCellKeyDown(args: CellKeyDownArgs<CartLine>, event: CellKeyboardEvent) {
    if (args.mode !== 'ACTIVE') {
      return
    }

    if (event.key === 'Enter' && cart.length > 0 && !paymentOpen) {
      event.preventGridDefault()
      event.preventDefault()
      setPaymentOpen(true)

      return
    }

    if (event.altKey && event.key.toLowerCase() === 'k' && !paymentOpen) {
      event.preventGridDefault()
      event.preventDefault()
      clearCart()
    }
  }

  function focusCartQty(key: string | null) {
    if (!key) {
      return
    }

    const rowIdx = cart.findIndex((line) => line.key === key)

    if (rowIdx === -1) {
      return
    }

    cartGridRef.current?.setActivePosition({ rowIdx, idx: QTY_COLUMN_IDX }, { shouldFocus: true })
  }

  function resetAfterCheckout() {
    setPaymentOpen(false)
    setCart([])
    setNamaPelanggan('')
    setDibayar('')
  }

  async function handleCheckout() {
    setProcessing(true)
    setError(null)
    setMessage(null)

    try {
      await window.api.kasir.checkout({
        metodePembayaran: metode,
        namaPelanggan: metode === 'bon' ? namaPelanggan : null,
        dibayar: metode === 'tunai' ? Number(dibayar || 0) : null,
        items: cart.map((line) => ({
          productId: line.product.id,
          productUnitId: line.productUnitId,
          qty: line.qty,
        })),
      })
      setMessage('Transaksi disimpan.')
      resetAfterCheckout()
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal checkout')
    } finally {
      setProcessing(false)
    }
  }

  async function handleCancel(saleId: number) {
    setError(null)
    setMessage(null)

    try {
      await window.api.kasir.cancelSale(saleId)
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan')
    }
  }

  if (!user) {
    return <p>Memuat...</p>
  }

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{user.name}</p>
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

      {scanError && (
        <p role="alert" className="text-sm text-destructive">
          {scanError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShoppingCart className="size-4" />
          Keranjang
          {cartItemCount > 0 && <Badge variant="secondary">{cartItemCount}</Badge>}
        </h2>
        <div className="flex items-center gap-2">
          {cart.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={clearCart}
            >
              <Trash2 className="size-3.5" />
              Kosongkan
              <kbd className="ml-1 rounded border px-1.5 py-0.5 text-xs">Alt+K</kbd>
            </Button>
          )}
          <Button
            type="button"
            onClick={() => {
              setPaletteQuery('')
              setPaletteOpen(true)
            }}
          >
            <Search className="size-4" />
            Cari / Tambah Produk
            <kbd className="ml-1 rounded border border-primary-foreground/30 px-1.5 py-0.5 text-xs">/</kbd>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">/</kbd>
          Cari Produk
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">Enter</kbd>
          Bayar
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">Alt+K</kbd>
          Kosongkan
        </span>
        <span>Klik pill satuan untuk ganti satuan</span>
      </div>

      <div className="overflow-hidden rounded-xl border">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
            <ShoppingCart className="size-8 opacity-40" />
            Keranjang kosong. Scan barcode atau cari produk untuk mulai.
          </div>
        ) : (
          <div ref={cartWidthRef}>
            {cartGridWidth > 0 && (
              <CartGrid
                cart={cart}
                width={cartGridWidth}
                resolvedAppearance={resolvedAppearance}
                gridRef={cartGridRef}
                onRowsChange={handleCartRowsChange}
                onCellKeyDown={handleCartCellKeyDown}
                onChangeUnit={changeLineUnit}
                onRemoveLine={removeFromCart}
              />
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-xl border p-4">
        <span className="text-muted-foreground">Total</span>
        <span className="text-2xl font-bold">{formatRupiah(total)}</span>
        <Button
          type="button"
          size="lg"
          className="h-14 px-10 text-lg"
          disabled={cart.length === 0}
          onClick={() => setPaymentOpen(true)}
        >
          Bayar
        </Button>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={total}
        metode={metode}
        setMetode={setMetode}
        namaPelanggan={namaPelanggan}
        setNamaPelanggan={setNamaPelanggan}
        dibayar={dibayar}
        setDibayar={setDibayar}
        processing={processing}
        error={error}
        onSubmit={handleCheckout}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        results={paletteResults}
        onSelect={(product) => {
          addProductToCart(product)
          setPaletteQuery('')
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          focusCartQty(lastTouchedKeyRef.current)
        }}
      />

      <section className="space-y-2">
        <h2 className="font-semibold">Transaksi Hari Ini</h2>
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <tbody>
              {salesToday.map((sale) => (
                <tr key={sale.id} className="border-b last:border-0">
                  <td className="p-2">#{sale.id}</td>
                  <td className="p-2 capitalize">{sale.metodePembayaran}</td>
                  <td className="p-2">
                    <Badge variant={sale.status === 'selesai' ? 'secondary' : 'outline'}>{sale.status}</Badge>
                  </td>
                  <td className="p-2 text-right font-medium">{formatRupiah(sale.total)}</td>
                  <td className="p-2 text-right">
                    {sale.status === 'selesai' && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleCancel(sale.id)}>
                        Batal
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
```

Note: `onSelect` in the `CommandPalette` usage above deliberately does **not** close the palette after adding a product — this matches the web app's actual behavior (`resources/js/pages/kasir.tsx`'s `CommandItem onSelect`), which lets you add several products in a row from one `/` search without reopening it each time.

- [ ] **Step 3: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
```

Expected: no type errors on either.

- [ ] **Step 4: Run the full test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — every test from Fase 1, Slice 1, Plan A, and Tasks 1-4 of this plan (49 total), unaffected by this renderer-only change.

- [ ] **Step 5: Seed a dev product with a barcode and switch to the Electron ABI**

The dev DB from earlier plans has an `admin` user and (if `dev.sqlite` still exists from Slice 1's manual verification) possibly a "Beras 5kg" product without a `barcode`. From `desktop-node/`, run a quick script to ensure at least one product has a barcode set (needed to test the scan shortcut) — write a temporary `.ts` file following the same `createDb` pattern `src/main/db/seed.ts` uses, run it with `npx tsx`, then delete it (don't commit it):

```typescript
// temporary, not committed
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './src/main/db/migrate'
import { products } from './src/main/db/schema'

const db = createDb(path.resolve('dev.sqlite'), path.resolve('drizzle'))
const existing = db.select().from(products).limit(1).all()

if (existing.length === 0) {
  const now = new Date()
  db.insert(products)
    .values({
      kodeItem: 'BRS5',
      barcode: '8991234500015',
      namaItem: 'Beras 5kg',
      satuan: 'PCS',
      hargaJual: 65000_00,
      hargaPokok: 60000_00,
      stok: 20,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  console.log('Seeded 1 dev product with a barcode')
} else {
  db.update(products).set({ barcode: '8991234500015' }).where(eq(products.id, existing[0].id)).run()
  console.log('Set a barcode on the existing dev product')
}
```

Then switch to the Electron ABI:

```bash
cd desktop-node
npm run rebuild:electron
```

- [ ] **Step 6: Manual end-to-end verification**

```bash
npm run dev
```

Log in as `admin`/`password`. Since this sandbox likely has no display, use the CDP-driven approach from earlier plans (Node's built-in `WebSocket`, `--remote-debugging-port`, `Runtime.evaluate`) to drive and verify each of the following, reporting exactly what you observed for each:

1. The Kasir page loads with Tailwind styling visibly applied (not the old plain-HTML look) — no product table is shown by default (matches web parity), just the "Cari / Tambah Produk" button and an empty cart state.
2. Press `/` (or click "Cari / Tambah Produk") — the command palette opens, typing part of "Beras" shows it in the results, selecting it adds it to the cart and the palette stays open (per the note in Step 2).
3. In the cart grid, the qty cell is editable — typing `24` and confirming resolves the line to `2 DUS` (the seeded product's derived unit with konversi 12), proving `resolveLineQty` is wired correctly end-to-end.
4. Click a satuan pill to switch the line back to the base unit (PCS) — confirm the row updates.
5. Press Enter with nothing focused (or click "Bayar") — the payment dialog opens. Type an amount in "Uang Tunai" and confirm "Kembalian" updates live.
6. Press PageDown/PageUp in the dialog — confirm the highlighted action (ring around the button) cycles between Simpan/Batal. Press Enter on Simpan — confirm the sale saves, the dialog closes, the cart clears, and the new sale appears under "Transaksi Hari Ini" styled with a Badge.
7. Click "Batal" on that sale — confirm the stock (checked via the command palette's product listing) is restored.
8. Trigger the barcode-scan path directly (simulate the fast-keystroke-then-Enter pattern the global listener expects, via CDP dispatching synthetic `keydown` events for `"8991234500015"` followed by `Enter`, with nothing focused) — confirm the product is added to the cart the same way the command palette would.

After verification, switch back to the plain-Node ABI:

```bash
npm run rebuild:node
```

- [ ] **Step 7: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/hooks/use-appearance.ts desktop-node/src/renderer/pages/Kasir.tsx
git commit -m "Assemble full Kasir cart/payment UI, fix useAppearance notify()"
```

---

## Self-Review Notes

- **Spec coverage:** `react-data-grid` cart with qty inline-edit + satuan pills ✅ (Task 2), keyboard-driven payment dialog ✅ (Task 3), command palette ✅ (Task 4), all shortcuts (scan, `/`, `Alt+K`, lone-Enter) ✅ (Task 5), Tailwind styling throughout ✅ (Tasks 2-5, via Plan A's components/theme), "Transaksi Hari Ini + Batal" kept per the human's explicit decision ✅ (Task 5). Printing is explicitly excluded per the plan's Global Constraints — Plan C's job. The two Plan-A-carried-forward fixes are both addressed (vitest config in Task 1, `notify()` in Task 5).
- **No placeholders:** every step has complete, runnable code or exact commands, including the one-off dev-seed script (marked not-committed, consistent with how earlier plans handled manual-verification seeding).
- **Type consistency:** `CartLine`/`Product`/`ProductUnitOption`/`PriceTier` (Task 1) are imported unchanged by `CartGrid` (Task 2), `CommandPalette` (Task 4), and `Kasir.tsx` (Task 5) — no renamed fields. `CartGridProps`/`PaymentDialogProps`/`CommandPaletteProps` (Tasks 2-4) match exactly how `Kasir.tsx` (Task 5) invokes each component (prop names, callback signatures). `QTY_COLUMN_IDX` exported from `CartGrid` (Task 2) is imported by name in `Kasir.tsx` (Task 5)'s `focusCartQty`.
