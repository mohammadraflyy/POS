# Perbaikan Penjualan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six defects in the sales flow (scan, palette, unit picking, print, unit entry, cart ordering/numbering) and add full transaction editing on the Penjualan page.

**Architecture:** Renderer changes concentrate in `src/renderer/pages/Kasir.tsx` and its `kasir/` folder; pure cart rules stay in `cart-logic.ts` where they are unit-tested. Transaction editing is one new main-process function, `updateSale`, which reverses the old sale's stock inside a DB transaction before pricing the new lines, so raising a quantity past current stock still works. Two new IPC handlers (`kasir:getSaleForEdit`, `kasir:updateSale`) replace the narrower `kasir:updateSaleDate`.

**Tech Stack:** Electron 32, React 19, react-router-dom 6 (HashRouter), react-data-grid 7 beta, drizzle-orm over better-sqlite3, vitest, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-16-perbaikan-penjualan-design.md`

## Global Constraints

- All work is inside `desktop-node/`. Run every command from that directory.
- Verification is `npx tsc --noEmit` and `npm test` (vitest). There is no PHP, no artisan, no Pest here — the repo-root `CLAUDE.md` describes a different stack and does not apply.
- **Close the running Electron app before `npm test`.** A live app locks the better-sqlite3 binary and the suite fails on ABI, not on your code.
- No new npm dependencies. No database migration: `sale_items.price_source` already accepts `'manual'`, and `stock_movements.movement_type` keeps its existing four values.
- Money crossing IPC is in **rupiah**; money in the database is in **integer cents**. `toRupiah`/`toCents` in `src/main/ipc/kasir.ts` are the only conversion points.
- A cart line represents the base unit as `productUnitId: null`. A saved `sale_items` row always stores a real `product_units.id`, including for the base unit. Converting between the two is required whenever a sale is loaded into the cart.
- User-facing text is Indonesian. `bon` in code and data, "Pending Payment" in text the user reads.
- Every renderer file that calls `window.api.*` needs its matching type in `src/renderer/env.d.ts`. `tsc` will not catch a handler that returns a field `env.d.ts` never declared — check the handler, not just the types.

---

### Task 1: Cart shows newest first, with row numbers

**Files:**
- Modify: `src/renderer/pages/kasir/cart-logic.ts:145-155`
- Modify: `src/renderer/pages/kasir/CartGrid.tsx:51-52,75-78`
- Test: `src/renderer/pages/kasir/cart-logic.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `addLine(cart, product, qty?)` now prepends. Task 2 extends its signature further.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('addLine', ...)` block in `src/renderer/pages/kasir/cart-logic.test.ts`:

```ts
  it('puts a new line at the top so the newest item is first', () => {
    const other: Product = { ...product, id: 2, kodeItem: 'MIE1', namaItem: 'Mie Instan', baseProductUnitId: 2 }
    const cart: CartLine[] = [{ key: lineKey(2, null), product: other, productUnitId: null, satuan: 'PCS', qty: 1 }]

    const result = addLine(cart, product)

    expect(result.map((line) => line.key)).toEqual([lineKey(1, null), lineKey(2, null)])
  })

  it('leaves a merged line where it is instead of moving it to the top', () => {
    const other: Product = { ...product, id: 2, kodeItem: 'MIE1', namaItem: 'Mie Instan', baseProductUnitId: 2 }
    const cart: CartLine[] = [
      { key: lineKey(2, null), product: other, productUnitId: null, satuan: 'PCS', qty: 1 },
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 },
    ]

    const result = addLine(cart, product)

    expect(result.map((line) => line.key)).toEqual([lineKey(2, null), lineKey(1, null)])
    expect(result[1].qty).toBe(2)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts -t "top"`
Expected: FAIL — the new line comes back last, so the key arrays are in the wrong order.

- [ ] **Step 3: Prepend in `addLine`**

In `src/renderer/pages/kasir/cart-logic.ts`, replace the final `return` of `addLine`:

```ts
  // newest first: the cashier watches the top of the list, so a just-scanned
  // item must land where they are already looking. A merged line stays put -
  // rows jumping around while the same barcode is scanned repeatedly is worse
  // than a slightly out-of-order list.
  return [{ key, product, productUnitId: null, satuan: product.satuan, qty: addedQty }, ...cart]
```

- [ ] **Step 4: Run the cart-logic suite**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts`
Expected: PASS, including the pre-existing `addLine` and `restoreCart` tests.

- [ ] **Step 5: Add the row-number column**

In `src/renderer/pages/kasir/CartGrid.tsx`, delete these two lines (grep confirms nothing imports the constant):

```ts
/** index of the 'qty' column within the columns array (produk, satuan, harga, qty, subtotal, aksi) */
export const QTY_COLUMN_IDX = 3
```

Widen the reserved width to make room for the new column:

```ts
  const CART_OTHER_COLUMNS_WIDTH = 50 + 180 + 120 + 80 + 130 + 50
```

Insert this as the **first** entry of the `columns` array, before the `produk` column:

```tsx
    {
      key: 'no',
      name: 'No',
      width: 50,
      // the cart is never paginated, so the row number is just its position
      renderCell: ({ rowIdx }) => <span className="text-muted-foreground">{rowIdx + 1}</span>,
    },
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/kasir/cart-logic.ts src/renderer/pages/kasir/CartGrid.tsx src/renderer/pages/kasir/cart-logic.test.ts
git commit -m "feat(kasir): show newest cart line first and number the rows"
```

---

### Task 2: `addLine` can add a derived unit directly

**Files:**
- Modify: `src/renderer/pages/kasir/cart-logic.ts:145-155`
- Test: `src/renderer/pages/kasir/cart-logic.test.ts`

**Interfaces:**
- Consumes: `addLine` from Task 1.
- Produces: `addLine(cart: CartLine[], product: Product, qty?: number, productUnitId?: number | null): CartLine[]`. Task 3 calls it with a `productUnitId`.

- [ ] **Step 1: Write the failing tests**

Add to `describe('addLine', ...)`:

```ts
  it('adds a line for a derived unit when given its productUnitId', () => {
    const result = addLine([], product, 1, 9)

    expect(result).toEqual([{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }])
  })

  it('merges into the existing line for that same derived unit', () => {
    const cart: CartLine[] = [{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 2 }]

    const result = addLine(cart, product, 3, 9)

    expect(result).toEqual([{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 5 }])
  })

  it('keeps a derived-unit line separate from the base-unit line', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }]

    const result = addLine(cart, product, 1, 9)

    expect(result.map((line) => line.key)).toEqual([lineKey(1, 9), lineKey(1, null)])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts -t "derived unit"`
Expected: FAIL — `addLine` takes three parameters, so the fourth argument is ignored and a base-unit line comes back.

- [ ] **Step 3: Widen the signature**

Replace the whole of `addLine` in `src/renderer/pages/kasir/cart-logic.ts`:

```ts
/**
 * Adds `qty` of `product` at `productUnitId` (null = base unit), merging into an
 * existing line for that same unit. New lines go to the top; see Task 1's note.
 */
export function addLine(
  cart: CartLine[],
  product: Product,
  qty = 1,
  productUnitId: number | null = null,
): CartLine[] {
  const key = lineKey(product.id, productUnitId)
  const existing = cart.find((i) => i.key === key)
  const addedQty = qty > 0 ? roundQty(qty) : 1

  if (existing) {
    return cart.map((i) => (i.key === key ? { ...i, qty: roundQty(i.qty + addedQty) } : i))
  }

  const unit = productUnitId === null ? null : product.productUnits.find((u) => u.id === productUnitId)

  return [
    { key, product, productUnitId, satuan: unit?.satuan ?? product.satuan, qty: addedQty },
    ...cart,
  ]
}
```

- [ ] **Step 4: Run the cart-logic suite**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/kasir/cart-logic.ts src/renderer/pages/kasir/cart-logic.test.ts
git commit -m "feat(kasir): let addLine target a derived unit directly"
```

---

### Task 3: Scan works, palette closes, results list every unit

**Files:**
- Modify: `src/renderer/pages/kasir/cart-logic.ts` (add `UnitResult`, `expandUnitResults`)
- Modify: `src/renderer/pages/kasir/CommandPalette.tsx`
- Modify: `src/renderer/pages/Kasir.tsx:164-178,447-465,608-626`
- Test: `src/renderer/pages/kasir/cart-logic.test.ts`

**Interfaces:**
- Consumes: `addLine(cart, product, qty, productUnitId)` from Task 2.
- Produces: `UnitResult` type and `expandUnitResults(products, query, limit)` from `cart-logic.ts`; `CommandPaletteProps.results: UnitResult[]` and `onSelect: (result: UnitResult) => void`. Task 10 reuses `addProductToCart(product, qty, productUnitId)`.

- [ ] **Step 1: Write the failing tests**

Add a new block at the end of `src/renderer/pages/kasir/cart-logic.test.ts`, and add `expandUnitResults` to the import list at the top of the file:

```ts
describe('expandUnitResults', () => {
  it('returns one row per unit, base unit first', () => {
    const results = expandUnitResults([product], 'beras', 50)

    expect(results).toEqual([
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', hargaJual: 65000 },
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', hargaJual: 700000 },
    ])
  })

  it('matches on barcode, which is how a scan into the search box arrives', () => {
    expect(expandUnitResults([product], '8991234500015', 50)).toHaveLength(2)
  })

  it('matches on kode item and is case-insensitive', () => {
    expect(expandUnitResults([product], 'brs5', 50)).toHaveLength(2)
  })

  it('returns nothing for a blank query', () => {
    expect(expandUnitResults([product], '   ', 50)).toEqual([])
  })

  it('returns nothing when the query matches no product', () => {
    expect(expandUnitResults([product], 'tidak ada', 50)).toEqual([])
  })

  it('honours the limit', () => {
    expect(expandUnitResults([product], 'beras', 1)).toHaveLength(1)
  })

  it('tolerates a product with no barcode', () => {
    const noBarcode: Product = { ...product, barcode: null }

    expect(expandUnitResults([noBarcode], 'beras', 50)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts -t "expandUnitResults"`
Expected: FAIL — `expandUnitResults` is not exported from `./cart-logic`.

- [ ] **Step 3: Add `UnitResult` and `expandUnitResults`**

Append to `src/renderer/pages/kasir/cart-logic.ts`:

```ts
/** one selectable row in the product palette: a product *at one of its units* */
export interface UnitResult {
  /** same shape as a cart line's key, so React keys stay unique across units */
  key: string
  product: Product
  /** null means the base unit, matching CartLine */
  productUnitId: number | null
  satuan: string
  hargaJual: number
}

/**
 * Expands matching products into one row per satuan, so the cashier can pick DUS
 * without adding PCS first and converting. Matches barcode as well as name and
 * kode - a scanner types the barcode straight into the search box, and leaving
 * barcode out of this filter is what made scanning look broken.
 */
export function expandUnitResults(products: Product[], query: string, limit: number): UnitResult[] {
  const q = query.trim().toLowerCase()

  if (!q) {
    return []
  }

  const results: UnitResult[] = []

  for (const product of products) {
    const matches =
      product.namaItem.toLowerCase().includes(q) ||
      product.kodeItem.toLowerCase().includes(q) ||
      (product.barcode ?? '').toLowerCase().includes(q)

    if (!matches) {
      continue
    }

    results.push({
      key: lineKey(product.id, null),
      product,
      productUnitId: null,
      satuan: product.satuan,
      hargaJual: product.hargaJual,
    })

    for (const unit of product.productUnits) {
      results.push({
        key: lineKey(product.id, unit.id),
        product,
        productUnitId: unit.id,
        satuan: unit.satuan,
        hargaJual: unit.hargaJual,
      })
    }

    if (results.length >= limit) {
      break
    }
  }

  return results.slice(0, limit)
}
```

- [ ] **Step 4: Run the cart-logic suite**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the palette to take `UnitResult`**

Replace the props interface and the results list in `src/renderer/pages/kasir/CommandPalette.tsx`. Change the import line to:

```ts
import { lineKey, type Product, type UnitResult } from './cart-logic'
```

Change the interface:

```ts
export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (query: string) => void
  results: UnitResult[]
  products: Product[]
  jumlah: string
  onSelect: (result: UnitResult) => void
  onCloseAutoFocus: (event: Event) => void
}
```

Replace the `if (e.key !== 'Enter')` block inside `CommandInput`'s `onKeyDown` with:

```tsx
          if (e.key !== 'Enter') {
            return
          }

          const code = query.trim()
          const product = products.find((p) => p.barcode === code)

          if (!product) {
            return
          }

          e.preventDefault()
          // a scanned barcode always means the base unit
          onSelect({
            key: lineKey(product.id, null),
            product,
            productUnitId: null,
            satuan: product.satuan,
            hargaJual: product.hargaJual,
          })
```

Replace the `results.map(...)` block:

```tsx
            {results.map((result) => (
              <CommandItem
                key={result.key}
                value={result.key}
                disabled={result.product.stok <= 0}
                onSelect={() => onSelect(result)}
                className="flex items-center justify-between"
              >
                <span>
                  <span className="font-medium">{result.product.namaItem}</span>
                  <span className="text-muted-foreground"> &middot; {result.product.kodeItem}</span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {formatRupiah(result.hargaJual)} / {result.satuan}
                  {result.product.stok <= 0 && <span className="text-destructive">Habis</span>}
                </span>
              </CommandItem>
            ))}
```

- [ ] **Step 6: Wire Kasir.tsx**

In `src/renderer/pages/Kasir.tsx`, add `expandUnitResults` and `type UnitResult` to the existing import from `./kasir/cart-logic`.

Replace the `paletteResults` memo:

```tsx
  const paletteResults = useMemo(() => expandUnitResults(products, paletteQuery, 50), [products, paletteQuery])
```

Give `addProductToCart` the unit parameter:

```tsx
  function addProductToCart(product: Product, qty = 1, productUnitId: number | null = null) {
    setCart((prev) => addLine(prev, product, qty, productUnitId))
  }
```

Replace the search `Input`'s `onKeyDown` (the one on the `w-72` input, not the Jumlah input):

```tsx
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') {
                    return
                  }

                  e.preventDefault()
                  const code = paletteQuery.trim()
                  // A scanner types the barcode then Enter. Resolving it here means a
                  // scan never has to travel through the palette at all, and repeated
                  // scans work without touching the mouse.
                  const scanned = code === '' ? undefined : products.find((p) => p.barcode === code)

                  if (scanned) {
                    addProductToCart(scanned, Number(jumlah) || 1)
                    setPaletteQuery('')
                    setJumlah('1.00')
                    setScanError('')

                    return
                  }

                  setPaletteOpen(true)
                }}
```

Replace the palette's `onSelect`:

```tsx
        onSelect={(result) => {
          addProductToCart(result.product, Number(jumlah) || 1, result.productUnitId)
          setPaletteQuery('')
          setJumlah('1.00')
          setPaletteOpen(false)
        }}
```

Leave the global scanner effect at `Kasir.tsx:191-276` untouched — it still serves the case where nothing is focused.

- [ ] **Step 7: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 8: Manual check**

Run `npm run dev`, open Penjualan, and confirm:
1. Typing a product name shows one row per satuan (base plus each derived unit).
2. Selecting a row closes the palette and adds a line in that satuan.
3. Typing a barcode into the search box and pressing Enter adds the item without the palette opening.
4. Two scans in a row both land.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/pages/kasir/cart-logic.ts src/renderer/pages/kasir/cart-logic.test.ts src/renderer/pages/kasir/CommandPalette.tsx src/renderer/pages/Kasir.tsx
git commit -m "fix(kasir): match barcode in search, close palette on select, list every satuan"
```

---

### Task 4: Satuan comes from Master Satuan

**Files:**
- Create: `src/renderer/components/unit-select-editor.tsx`
- Modify: `src/renderer/pages/inventory/MassInput.tsx:239-256`
- Modify: `src/renderer/pages/Inventory.tsx:405-430`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `renderUnitSelectEditor<TRow>(units: UnitOption[], getSatuan: (row: TRow) => string, setSatuan: (row: TRow, satuan: string) => TRow)` returning a `react-data-grid` `renderEditCell` component; `interface UnitOption { id: number; code: string }`.

- [ ] **Step 1: Create the shared editor**

Create `src/renderer/components/unit-select-editor.tsx`:

```tsx
import type { RenderEditCellProps } from 'react-data-grid'

export interface UnitOption {
  id: number
  code: string
}

/**
 * Cell editor that limits a satuan column to the codes registered in Master Satuan.
 *
 * Mirrors the satuan editor in `kasir/CartGrid.tsx`: grid cell navigation only ever
 * focuses the cell wrapper, so a <select> rendered in `renderCell` would be
 * mouse-only. `renderEditCell` is how react-data-grid hands real keyboard focus to
 * one - F2 or Enter opens it and the grid defers all keys to it.
 *
 * Memoise the returned component (see the callers) - creating a new component type
 * on every render would remount the editor mid-edit and steal focus.
 */
export function renderUnitSelectEditor<TRow>(
  units: UnitOption[],
  getSatuan: (row: TRow) => string,
  setSatuan: (row: TRow, satuan: string) => TRow,
) {
  return function UnitSelectEditor({ row, onRowChange, onClose }: RenderEditCellProps<TRow>) {
    const current = getSatuan(row)
    const known = units.some((unit) => unit.code === current)

    return (
      <select
        ref={(select) => select?.focus()}
        defaultValue={current}
        onChange={(e) => onRowChange(setSatuan(row, e.target.value), true)}
        onBlur={() => onClose(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose(false)
          }
        }}
        className="h-full w-full bg-background px-2 text-sm outline-none"
      >
        {current === '' && <option value="">Pilih satuan...</option>}
        {/* a product saved before its satuan was deactivated must still show its own */}
        {current !== '' && !known && <option value={current}>{current}</option>}
        {units.map((unit) => (
          <option key={unit.id} value={unit.code}>
            {unit.code}
          </option>
        ))}
      </select>
    )
  }
}
```

- [ ] **Step 2: Use it in MassInput**

In `src/renderer/pages/inventory/MassInput.tsx`, add to the imports:

```tsx
import { useMemo } from 'react'
import { renderUnitSelectEditor, type UnitOption } from '@/components/unit-select-editor'
```

(`useMemo` joins the existing `import { useEffect, useState } from 'react'` line.)

Add state and a loader next to the other `useEffect` hooks:

```tsx
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([])

  useEffect(() => {
    window.api.masterSatuan
      .list()
      .then((list) => setUnitOptions(list.filter((unit) => unit.isActive).map((unit) => ({ id: unit.id, code: unit.code }))))
      .catch(() => setFormError('Gagal memuat daftar satuan.'))
  }, [])

  const satuanEditor = useMemo(
    () =>
      renderUnitSelectEditor<DraftRow>(
        unitOptions,
        (row) => row.satuan,
        (row, satuan) => ({ ...row, satuan }),
      ),
    [unitOptions],
  )
```

Replace `textColumn('satuan', 'Satuan', 90)` in the `columns` array with:

```tsx
    {
      key: 'satuan',
      name: 'Satuan',
      width: 90,
      editable: true,
      renderEditCell: satuanEditor,
      cellClass: (row) => (rowErrors[row.key]?.satuan ? 'bg-red-100 dark:bg-red-950' : undefined),
    },
```

- [ ] **Step 3: Use it in Inventory**

In `src/renderer/pages/Inventory.tsx`, add to the imports:

```tsx
import { useMemo } from 'react'
import { renderUnitSelectEditor, type UnitOption } from '@/components/unit-select-editor'
```

(`useMemo` joins the existing `import { useEffect, useRef, useState } from 'react'` line.)

Add state, loader and the memoised editor next to the other hooks:

```tsx
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([])

  useEffect(() => {
    window.api.masterSatuan
      .list()
      .then((list) => setUnitOptions(list.filter((unit) => unit.isActive).map((unit) => ({ id: unit.id, code: unit.code }))))
      .catch(() => setDeleteError('Gagal memuat daftar satuan.'))
  }, [])

  const satuanEditor = useMemo(
    () =>
      renderUnitSelectEditor<DraftRow>(
        unitOptions,
        (row) => row.satuan,
        (row, satuan) => ({ ...row, satuan }),
      ),
    [unitOptions],
  )
```

Replace `textColumn('satuan', 'Satuan', 90)` in the `columns` array with:

```tsx
    {
      key: 'satuan',
      name: 'Satuan',
      width: 90,
      editable: true,
      renderEditCell: satuanEditor,
      cellClass: (row) => (rowErrors[row.id] ? 'bg-red-100 dark:bg-red-950' : undefined),
    },
```

Leave `resolveOrCreateUnit` in `src/main/master-satuan.ts` alone — the Excel importers still need free text.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual check**

Run `npm run dev`:
1. Katalog Produk → Tambah Produk → the Satuan cell opens a dropdown listing Master Satuan codes, not a text box.
2. Pick one, save the row, confirm the product lands with that satuan.
3. Katalog Produk grid → editing an existing row's Satuan cell shows the same dropdown, and a product whose current satuan is missing from the list still shows its own value.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/unit-select-editor.tsx src/renderer/pages/inventory/MassInput.tsx src/renderer/pages/Inventory.tsx
git commit -m "feat(inventory): pick satuan from Master Satuan instead of free text"
```

---

### Task 5: Print/Cetak label, no confirmation, no waiting

**Files:**
- Modify: `src/renderer/pages/kasir/PaymentDialog.tsx:1-13,67-108,159-175,320-340`
- Modify: `src/renderer/pages/Kasir.tsx:97,339-418,579-598`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PaymentDialogProps` loses `printing: boolean`. Task 10 adds `editMode` to the same interface.

- [ ] **Step 1: Strip the confirmation from PaymentDialog**

In `src/renderer/pages/kasir/PaymentDialog.tsx`:

Delete the `useConfirm` import line and the `Spinner` import line. Delete `const { confirm, ConfirmDialog } = useConfirm()`. Delete the whole `submitWithPrint` function.

Remove `printing` from the props interface and from the destructured parameter list.

Replace `runAction`:

```tsx
  function runAction(action: Action) {
    if (action !== 'batal' && bonNeedsCustomer) {
      onEditCustomer()

      return
    }

    if (action === 'cetak') {
      onSubmit(true)
    } else if (action === 'simpan') {
      onSubmit(false)
    } else {
      onOpenChange(false)
    }
  }
```

In `handleShortcut`, change the guard from `if (processing || printing)` to `if (processing)`.

Replace every remaining `disabled={processing || printing}` with `disabled={processing}`.

Replace the whole `{printing ? (...) : (...)}` conditional with just the action block that was in the `else` branch, and rename the primary button's label:

```tsx
          <div className="space-y-2">
            <Button
              type="submit"
              disabled={processing || bonNeedsCustomer}
              className={cn(
                'w-full',
                selectedAction === 'cetak' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
              )}
            >
              {selectedAction === 'cetak' && <CornerDownLeft className="size-4" />}
              <Printer className="size-4" />
              Print/Cetak
            </Button>
```

The `Simpan`, `Batal` and shortcut-hint markup below it is unchanged.

Finally, unwrap the component's return: the outer `<>...</>` fragment and the trailing `{ConfirmDialog}` go away, leaving `<Dialog>` as the single root element.

- [ ] **Step 2: Stop Kasir waiting on the printer**

In `src/renderer/pages/Kasir.tsx`:

Delete the `const [printingSaleId, setPrintingSaleId] = useState<number | null>(null)` line and the entire `useEffect` that watches `printingSaleId` (the block starting `if (!printingSaleId) {`).

Replace the body of `handleCheckout`:

```tsx
  async function handleCheckout(shouldPrint: boolean) {
    setProcessing(true)
    setCheckoutError(null)
    setMessage(null)

    try {
      const sale = await window.api.kasir.checkout({
        metodePembayaran: metode,
        // tunai falls back to the walk-in name so the struk is never nameless;
        // bon must not, or an unnamed debt would silently be filed under it and
        // the main process could never reject it
        namaPelanggan: metode === 'bon' ? namaPelanggan.trim() || null : namaPelanggan.trim() || DEFAULT_PELANGGAN,
        dibayar: metode === 'tunai' ? Number(dibayar || 0) : null,
        tanggal,
        items: cart.map((line) => ({
          productId: line.product.id,
          productUnitId: line.productUnitId,
          qty: line.qty,
        })),
      })

      if (shouldPrint) {
        // The sale is already committed. Printing reaches hardware and can stall,
        // so it runs in the background rather than holding the till hostage - a
        // failure surfaces as an error naming the sale, which can be reprinted
        // from Riwayat.
        window.api.kasir.printReceipt(sale.saleId).catch((err) => {
          const reason = err instanceof Error ? err.message : 'kesalahan tidak diketahui'
          setError(`Transaksi #${sale.saleId} tersimpan, tetapi struk gagal dicetak: ${reason}. Cetak ulang dari Riwayat.`)
        })
      }

      setMessage('Transaksi disimpan.')
      setCheckoutError(null)
      resetAfterCheckout()
      refreshProducts()
      refreshCustomers()
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Gagal checkout')
    } finally {
      setProcessing(false)
    }
  }
```

Remove `printing={printingSaleId !== null}` from the `<PaymentDialog>` props.

- [ ] **Step 3: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 4: Manual check**

Run `npm run dev`, add an item, press Bayar:
1. The primary button reads **Print/Cetak**.
2. Pressing it saves and closes the dialog immediately — no confirmation dialog, no "Mencetak struk..." spinner.
3. The cart is empty and ready for the next customer straight away.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/kasir/PaymentDialog.tsx src/renderer/pages/Kasir.tsx
git commit -m "perf(kasir): print in the background and drop the extra cetak confirmation"
```

---

### Task 6: Cache the compiled print helper

**Files:**
- Modify: `src/main/print-windows.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `printRaw(printerName: string, data: Buffer): Promise<void>` — signature unchanged, now serialised and DLL-cached.

- [ ] **Step 1: Rewrite the script and the runner**

Replace the contents of `src/main/print-windows.ts` below the imports. Keep the `import` block as it is, then:

```ts
const execFileAsync = promisify(execFile)

// Bump this when the C# below changes - the compiled DLL is cached by name, and a
// stale one would be reused silently.
const HELPER_VERSION = 'v1'
const DLL_PATH = join(tmpdir(), `pos-rawprint-${HELPER_VERSION}.dll`)
const SCRIPT_PATH = join(tmpdir(), `pos-rawprint-${HELPER_VERSION}.ps1`)

// Standard Microsoft-documented "RawPrinterHelper" technique (KB322091):
// P/Invoke winspool.drv directly so the byte buffer reaches the printer
// as-is, datatype "RAW" - no driver-side re-rendering, which is exactly
// what made Electron's webContents.print({silent:true}) unreliable here.
//
// Add-Type used to recompile this class on every single receipt, and that csc
// run was the bulk of the delay. It is now compiled once to a DLL and merely
// loaded on every later print.
const RAW_PRINT_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$DataPath,
  [Parameter(Mandatory=$true)][string]$DllPath
)

$ErrorActionPreference = 'Stop'

$source = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static void SendBytesToPrinter(string szPrinterName, byte[] pBytes)
    {
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        int dwWritten;
        bool bSuccess = false;

        di.pDocName = "POS Receipt";
        di.pDataType = "RAW";

        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero))
        {
            if (StartDocPrinter(hPrinter, 1, di))
            {
                if (StartPagePrinter(hPrinter))
                {
                    bSuccess = WritePrinter(hPrinter, pBytes, pBytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }

        if (!bSuccess)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
"@

if (-not (Test-Path $DllPath)) {
  Add-Type -TypeDefinition $source -OutputAssembly $DllPath -OutputType Library
}

Add-Type -Path $DllPath

$bytes = [System.IO.File]::ReadAllBytes($DataPath)
[RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
`

async function runPrint(printerName: string, data: Buffer): Promise<void> {
  const dataPath = join(tmpdir(), `pos-print-${randomUUID()}.bin`)

  writeFileSync(dataPath, data)
  writeFileSync(SCRIPT_PATH, RAW_PRINT_SCRIPT)

  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        '-PrinterName',
        printerName,
        '-DataPath',
        dataPath,
        '-DllPath',
        DLL_PATH,
      ],
      { timeout: 30_000 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Gagal mencetak: ${message}`)
  } finally {
    try {
      unlinkSync(dataPath)
    } catch {
      // best-effort cleanup
    }
  }
}

// One receipt at a time. Two concurrent runs would race to compile the same DLL
// and could interleave on the printer; the renderer now fires prints without
// awaiting them, so overlap is a real possibility rather than a theoretical one.
let printQueue: Promise<unknown> = Promise.resolve()

export function printRaw(printerName: string, data: Buffer): Promise<void> {
  const run = () => runPrint(printerName, data)
  const next = printQueue.then(run, run)

  printQueue = next.catch(() => undefined)

  return next
}
```

- [ ] **Step 2: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass. `escpos.test.ts` covers receipt bytes and is unaffected.

- [ ] **Step 3: Manual check on real hardware**

Run `npm run dev`, go to Pengaturan and press Test Print twice.
1. Both receipts print.
2. The second is noticeably faster than the first — the first compiles the DLL, the second loads it.
3. Confirm `%TEMP%\pos-rawprint-v1.dll` exists after the first print.

- [ ] **Step 4: Commit**

```bash
git add src/main/print-windows.ts
git commit -m "perf(print): compile the raw-print helper once and serialise print jobs"
```

---

### Task 7: Cart lines can carry a manual price

**Files:**
- Modify: `src/renderer/pages/kasir/cart-logic.ts:32-38,74-81`
- Modify: `src/renderer/pages/kasir/CartGrid.tsx`
- Modify: `src/renderer/pages/Kasir.tsx:303-306`
- Test: `src/renderer/pages/kasir/cart-logic.test.ts`

**Interfaces:**
- Consumes: `CartLine` from Task 1.
- Produces: `CartLine.hargaOverride?: number | null`; `applyHarga(cart: CartLine[], key: string, rawHarga: number): CartLine[]`; `CartGridProps.editMode: boolean`. Tasks 8–10 depend on `hargaOverride`.

- [ ] **Step 1: Write the failing tests**

Add `applyHarga` to the import list in `src/renderer/pages/kasir/cart-logic.test.ts`, then append:

```ts
describe('hargaOverride', () => {
  it('wins over the tier price', () => {
    const line: CartLine = {
      key: lineKey(1, null),
      product,
      productUnitId: null,
      satuan: 'PCS',
      qty: 5,
      hargaOverride: 50000,
    }

    expect(unitPrice(line)).toBe(50000)
  })

  it('wins over a derived unit price', () => {
    const line: CartLine = {
      key: lineKey(1, 9),
      product,
      productUnitId: 9,
      satuan: 'DUS',
      qty: 1,
      hargaOverride: 600000,
    }

    expect(unitPrice(line)).toBe(600000)
  })

  it('is ignored when null, falling back to normal pricing', () => {
    const line: CartLine = {
      key: lineKey(1, null),
      product,
      productUnitId: null,
      satuan: 'PCS',
      qty: 5,
      hargaOverride: null,
    }

    expect(unitPrice(line)).toBe(62000)
  })

  it('allows a deliberate zero, which is not the same as "no override"', () => {
    const line: CartLine = {
      key: lineKey(1, null),
      product,
      productUnitId: null,
      satuan: 'PCS',
      qty: 5,
      hargaOverride: 0,
    }

    expect(unitPrice(line)).toBe(0)
  })
})

describe('applyHarga', () => {
  it('sets the override on the matching line only', () => {
    const cart: CartLine[] = [
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 },
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 },
    ]

    const result = applyHarga(cart, lineKey(1, 9), 640000)

    expect(result[0].hargaOverride).toBeUndefined()
    expect(result[1].hargaOverride).toBe(640000)
  })

  it('rounds to whole rupiah and floors a negative at zero', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }]

    expect(applyHarga(cart, lineKey(1, null), 1234.6)[0].hargaOverride).toBe(1235)
    expect(applyHarga(cart, lineKey(1, null), -5)[0].hargaOverride).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts -t "harga"`
Expected: FAIL — `applyHarga` is not exported and `hargaOverride` is not a field of `CartLine`.

- [ ] **Step 3: Add the field, the price rule and the setter**

In `src/renderer/pages/kasir/cart-logic.ts`, extend the interface:

```ts
/** the base unit is represented as productUnitId: null */
export interface CartLine {
  key: string
  product: Product
  productUnitId: number | null
  satuan: string
  qty: number
  /**
   * Set only while editing a saved sale, where the cashier may correct a price
   * that was charged. Optional rather than always-null so the dozens of existing
   * call sites that build a CartLine keep compiling.
   */
  hargaOverride?: number | null
}
```

Add the override check as the first thing `unitPrice` does:

```ts
/** resolve the price for a cart line - a manual override first, then tiered by qty, scoped to the line's own unit */
export function unitPrice(line: CartLine): number {
  if (line.hargaOverride != null) {
    return line.hargaOverride
  }

  const normalPrice =
    line.productUnitId === null
      ? line.product.hargaJual
      : (line.product.productUnits.find((u) => u.id === line.productUnitId)?.hargaJual ?? line.product.hargaJual)

  return priceForQty(tiersForLine(line), normalPrice, line.qty)
}
```

Append the setter next to `applyQty`:

```ts
/** sets a manual price (in whole rupiah) on one line, overriding master and tier alike */
export function applyHarga(cart: CartLine[], key: string, rawHarga: number): CartLine[] {
  const harga = rawHarga > 0 ? Math.round(rawHarga) : 0

  return cart.map((i) => (i.key === key ? { ...i, hargaOverride: harga } : i))
}
```

Leave `StoredCartLine` and `toStoredCart` alone: the draft is only written outside edit mode, and outside edit mode the price column is not editable, so there is no override to lose.

- [ ] **Step 4: Run the cart-logic suite**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts`
Expected: PASS, including every pre-existing test — `hargaOverride` being optional means the old object literals still match under `toEqual`.

- [ ] **Step 5: Make the Harga column editable in edit mode**

In `src/renderer/pages/kasir/CartGrid.tsx`, add the price editor beside `renderQtyEditCell`:

```tsx
function renderHargaEditCell({ row, onRowChange, onClose }: RenderEditCellProps<CartLine>) {
  return (
    <input
      type="text"
      inputMode="numeric"
      ref={focusAndSelectQtyInput}
      // uncontrolled for the same reason as qty: re-syncing a parsed number on
      // every keystroke fights the cashier mid-edit
      defaultValue={unitPrice(row)}
      title="Harga khusus untuk baris ini - mengabaikan harga master dan harga bertingkat"
      className="h-full w-full bg-background px-2 text-right text-sm outline-none"
      onChange={(e) => onRowChange({ ...row, hargaOverride: Number(e.target.value) || 0 })}
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
```

Add `editMode` to the props interface and the destructured parameters:

```tsx
export interface CartGridProps {
  cart: CartLine[]
  width: number
  resolvedAppearance: 'light' | 'dark'
  /** editing a saved sale - only then may a price be overridden by hand */
  editMode: boolean
  gridRef: RefObject<DataGridHandle | null>
  onRowsChange: (rows: CartLine[], data: RowsChangeData<CartLine>) => void
  onCellKeyDown: (args: CellKeyDownArgs<CartLine>, event: CellKeyboardEvent) => void
  onChangeUnit: (line: CartLine, productUnitId: number | null) => void
  onRemoveLine: (key: string) => void
}
```

Add `editable` and `renderEditCell` to the existing `harga` column, leaving its `renderCell` as it is:

```tsx
    {
      key: 'harga',
      name: 'Harga',
      width: 120,
      // a new sale always prices from master and tier; only a correction to a
      // saved sale may set a price by hand
      editable: () => editMode,
      renderEditCell: renderHargaEditCell,
      renderCell: ({ row }) => {
```

- [ ] **Step 6: Route price edits in Kasir**

In `src/renderer/pages/Kasir.tsx`, add `applyHarga` to the `./kasir/cart-logic` import, then replace `handleCartRowsChange`:

```tsx
  function handleCartRowsChange(newRows: CartLine[], { indexes, column }: RowsChangeData<CartLine>) {
    const editedRow = newRows[indexes[0]]

    if (column.key === 'harga') {
      setCart((prev) => applyHarga(prev, editedRow.key, editedRow.hargaOverride ?? 0))

      return
    }

    applyResolvedQty(editedRow.key, editedRow.qty)
  }
```

Pass the new prop on `<CartGrid ... />`. Until Task 10 introduces edit mode, hard-code it:

```tsx
                    editMode={false}
```

- [ ] **Step 7: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/pages/kasir/cart-logic.ts src/renderer/pages/kasir/cart-logic.test.ts src/renderer/pages/kasir/CartGrid.tsx src/renderer/pages/Kasir.tsx
git commit -m "feat(kasir): allow a manual per-line price while editing a sale"
```

---

### Task 8: `updateSale` in the main process

**Files:**
- Modify: `src/main/kasir.ts:47-89,109-113,159-223,381-397`
- Test: `src/main/kasir.test.ts`

**Interfaces:**
- Consumes: nothing from the renderer tasks.
- Produces: `updateSale(db, saleId, input: UpdateSaleInput): { total: number }`; `CartItemInput.hargaJual?: number | null` (cents); `resolveCartItem(product, productUnit, priceTiers, qty, hargaOverride?)`; `ResolvedItem.priceSource` widened to include `'manual'`. `updateSaleDate` is deleted. Task 9 wires all of this to IPC.

- [ ] **Step 1: Write the failing tests**

Add `updateSale` to the import block in `src/main/kasir.test.ts` and remove `updateSaleDate` from it. Delete the whole `describe('updateSaleDate', ...)` block. Append:

```ts
describe('updateSale', () => {
  function seedBaseSale() {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 6000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 2 }],
    })

    return { db, saleId }
  }

  it('leaves stock untouched when nothing about the lines changed', () => {
    const { db, saleId } = seedBaseSale()
    const before = db.select().from(products).where(eq(products.id, 2)).get()?.stok

    updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 6000_00,
      tanggal: '2026-08-15T09:00',
      items: [{ productId: 2, productUnitId: null, qty: 2 }],
    })

    expect(db.select().from(products).where(eq(products.id, 2)).get()?.stok).toBe(before)
  })

  it('returns stock for a line that was removed', () => {
    const { db, saleId } = seedBaseSale()

    updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      tanggal: '2026-08-15T09:00',
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    // seeded at 100, sold 2, now only 1 is sold
    expect(db.select().from(products).where(eq(products.id, 2)).get()?.stok).toBe(99)
  })

  it('allows raising qty past current stock, because the old lines are put back first', () => {
    const db = seedDb()
    // product 1 is seeded with stok 10; sell all of it
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 620000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 10 }],
    })
    expect(db.select().from(products).where(eq(products.id, 1)).get()?.stok).toBe(0)

    updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 620000_00,
      tanggal: '2026-08-15T09:00',
      items: [{ productId: 1, productUnitId: null, qty: 8 }],
    })

    expect(db.select().from(products).where(eq(products.id, 1)).get()?.stok).toBe(2)
  })

  it('still rejects a qty that does not fit even after the old lines are restored', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 620000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 10 }],
    })

    expect(() =>
      updateSale(db, saleId, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 999999_00,
        tanggal: '2026-08-15T09:00',
        items: [{ productId: 1, productUnitId: null, qty: 11 }],
      }),
    ).toThrow('Stok Beras 5kg tidak cukup.')

    // the failed edit rolled back: the sale still holds its original 10
    expect(db.select().from(products).where(eq(products.id, 1)).get()?.stok).toBe(0)
  })

  it('moves the sale to a new date', () => {
    const { db, saleId } = seedBaseSale()

    updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 6000_00,
      tanggal: '2026-07-04T14:05',
      items: [{ productId: 2, productUnitId: null, qty: 2 }],
    })

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.createdAt.toISOString()).toBe(new Date('2026-07-04T14:05').toISOString())
  })

  it('rejects a future date', () => {
    const { db, saleId } = seedBaseSale()

    expect(() =>
      updateSale(db, saleId, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 6000_00,
        tanggal: '2099-01-01T00:00',
        items: [{ productId: 2, productUnitId: null, qty: 2 }],
      }),
    ).toThrow('Tanggal transaksi tidak boleh melewati waktu sekarang.')
  })

  it('charges a manual price and records it as such', () => {
    const { db, saleId } = seedBaseSale()

    updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 5000_00,
      tanggal: '2026-08-15T09:00',
      items: [{ productId: 2, productUnitId: null, qty: 2, hargaJual: 2500_00 }],
    })

    const item = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get()
    expect(item?.hargaJual).toBe(2500_00)
    expect(item?.subtotal).toBe(5000_00)
    expect(item?.priceSource).toBe('manual')
    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()?.total).toBe(5000_00)
  })

  it('keeps the original cost on a line that was already on the sale', () => {
    const { db, saleId } = seedBaseSale()
    const costBefore = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get()?.hargaPokok

    // the product is repurchased at a higher cost after the sale
    db.update(productUnits).set({ hargaPokok: 9999_00 }).where(eq(productUnits.id, 102)).run()

    updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 9000_00,
      tanggal: '2026-08-15T09:00',
      items: [{ productId: 2, productUnitId: null, qty: 3 }],
    })

    expect(db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get()?.hargaPokok).toBe(costBefore)
  })

  it('takes the current cost for a line that is genuinely new', () => {
    const { db, saleId } = seedBaseSale()

    updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 71000_00,
      tanggal: '2026-08-15T09:00',
      items: [
        { productId: 2, productUnitId: null, qty: 2 },
        { productId: 1, productUnitId: null, qty: 1 },
      ],
    })

    const added = db.select().from(saleItems).where(eq(saleItems.productId, 1)).get()
    expect(added?.hargaPokok).toBe(60000_00)
  })

  it('rejects a bon without a customer name', () => {
    const { db, saleId } = seedBaseSale()

    expect(() =>
      updateSale(db, saleId, {
        metodePembayaran: 'bon',
        namaPelanggan: '  ',
        dibayar: 0,
        tanggal: '2026-08-15T09:00',
        items: [{ productId: 2, productUnitId: null, qty: 2 }],
      }),
    ).toThrow('Nama pelanggan wajib diisi untuk transaksi bon.')
  })

  it('rejects cash that does not cover the new total', () => {
    const { db, saleId } = seedBaseSale()

    expect(() =>
      updateSale(db, saleId, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 1000_00,
        tanggal: '2026-08-15T09:00',
        items: [{ productId: 2, productUnitId: null, qty: 2 }],
      }),
    ).toThrow('Uang bayar kurang dari total belanja.')
  })

  it('rejects dropping dibayar below payments already recorded against the bon', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Budi',
      dibayar: null,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 2 }],
    })
    recordBonPayment(db, saleId, 4000_00, null)

    expect(() =>
      updateSale(db, saleId, {
        metodePembayaran: 'bon',
        namaPelanggan: 'Budi',
        dibayar: 1000_00,
        tanggal: '2026-08-15T09:00',
        items: [{ productId: 2, productUnitId: null, qty: 2 }],
      }),
    ).toThrow('Dibayar tidak boleh kurang dari pembayaran yang sudah tercatat.')
  })

  it('edits a partly paid bon as long as dibayar still covers what was recorded', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Budi',
      dibayar: null,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 2 }],
    })
    recordBonPayment(db, saleId, 4000_00, null)

    updateSale(db, saleId, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Budi',
      dibayar: 4000_00,
      tanggal: '2026-08-15T09:00',
      items: [{ productId: 2, productUnitId: null, qty: 3 }],
    })

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.total).toBe(9000_00)
    expect(sale?.dibayar).toBe(4000_00)
  })

  it('rejects an empty cart', () => {
    const { db, saleId } = seedBaseSale()

    expect(() =>
      updateSale(db, saleId, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 0,
        tanggal: '2026-08-15T09:00',
        items: [],
      }),
    ).toThrow('Keranjang tidak boleh kosong.')
  })

  it('rejects an unknown sale', () => {
    const db = seedDb()

    expect(() =>
      updateSale(db, 999, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 0,
        tanggal: '2026-08-15T09:00',
        items: [{ productId: 2, productUnitId: null, qty: 1 }],
      }),
    ).toThrow('Transaksi tidak ditemukan.')
  })

  it('keeps the movement ledger in step with products.stok', () => {
    const { db, saleId } = seedBaseSale()

    updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 15000_00,
      tanggal: '2026-08-15T09:00',
      items: [{ productId: 2, productUnitId: null, qty: 5 }],
    })

    const movements = db.select().from(stockMovements).where(eq(stockMovements.productId, 2)).all()
    const netMoved = movements.reduce((sum, row) => sum + row.baseQuantity, 0)
    const stok = db.select().from(products).where(eq(products.id, 2)).get()?.stok

    expect(stok).toBe(100 + netMoved)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/kasir.test.ts -t "updateSale"`
Expected: FAIL — `updateSale` is not exported from `./kasir`.

- [ ] **Step 3: Let a resolved item carry a manual price**

In `src/main/kasir.ts`, widen `ResolvedItem` and `resolveCartItem`:

```ts
export interface ResolvedItem {
  productId: number
  productUnitId: number
  satuan: string
  konversi: number
  hargaJual: number
  hargaPokok: number
  qty: number
  qtyDasar: number
  priceSource: 'normal' | 'price_tier' | 'manual'
}

export function resolveCartItem(
  product: ProductRow,
  productUnit: ProductUnitRow,
  priceTiers: PriceTier[],
  qty: number,
  /** whole cents; set only when a sale is being corrected by hand */
  hargaOverride?: number | null,
): ResolvedItem {
  const normalPrice = productUnit.hargaJual
  const tier = findTierForQty(priceTiers, qty)

  const hargaJual = hargaOverride != null ? hargaOverride : (tier?.hargaJual ?? normalPrice)
  const priceSource: 'normal' | 'price_tier' | 'manual' =
    hargaOverride != null ? 'manual' : tier ? 'price_tier' : 'normal'

  const qtyDasar = qty * productUnit.conversionFactor

  if (product.stok < qtyDasar) {
    throw new Error(`Stok ${product.namaItem} tidak cukup.`)
  }

  return {
    productId: product.id,
    productUnitId: productUnit.id,
    satuan: productUnit.unitCode,
    konversi: productUnit.conversionFactor,
    hargaJual,
    // the cost of the unit actually being sold - a DUS line carries the DUS cost, so
    // rekap never has to multiply back up through konversi
    hargaPokok: productUnit.hargaPokok,
    qty,
    qtyDasar,
    priceSource,
  }
}
```

Extend the input type:

```ts
export interface CartItemInput {
  productId: number
  productUnitId: number | null
  qty: number
  /** whole cents; overrides master and tier pricing for this line alone */
  hargaJual?: number | null
}
```

- [ ] **Step 4: Let `resolveItems` run inside a transaction**

Still in `src/main/kasir.ts`, change only the signature of `resolveItems` and the `resolveCartItem` call inside it. The function body reads through `db.select()` and nothing else, so narrowing the parameter to that one method is enough to accept a transaction object too:

```ts
function resolveItems(db: Pick<Db, 'select'>, items: CartItemInput[]): ResolvedItem[] {
```

and inside the loop:

```ts
    const resolved = resolveCartItem(product, unit, tiers, item.qty, item.hargaJual)
```

> `Db` is declared below `resolveItems` in the current file. Move the `type Db = ...` and `type Tx = ...` declarations up so they sit above `resolveItems`. If `tsc` still rejects passing `tx`, fall back to `resolveItems(tx as unknown as Pick<Db, 'select'>, items)` at the one call site in `updateSale` and leave a comment saying why.

- [ ] **Step 5: Replace `updateSaleDate` with `updateSale`**

Delete the entire `updateSaleDate` function from `src/main/kasir.ts` and put this in its place:

```ts
export interface UpdateSaleInput {
  metodePembayaran: MetodePembayaran
  namaPelanggan: string | null
  /** whole cents; ignored for qris and transfer, which always settle in full */
  dibayar: number | null
  /** local `YYYY-MM-DDTHH:mm` */
  tanggal: string
  items: CartItemInput[]
}

/**
 * Rewrites a saved sale in place: its lines, its prices, who it is filed under, how it
 * was paid, and when it happened.
 *
 * The old lines are reversed *inside* the transaction before the new ones are priced,
 * which is what lets the cashier raise the qty of something this very sale sold out.
 * Reversal rows are logged as `sale_cancel` and the new lines as `sale`: nothing in the
 * app reads `movement_type` back, and what has to stay true is that the ledger still
 * sums to `products.stok`.
 *
 * A line that was already on the sale keeps the `hargaPokok` it was sold at. Re-reading
 * today's cost would rewrite historical margin every time an old sale is corrected.
 */
export function updateSale(db: Db, saleId: number, input: UpdateSaleInput): { total: number } {
  if (input.items.length < 1) {
    throw new Error('Keranjang tidak boleh kosong.')
  }

  for (const item of input.items) {
    if (!(item.qty > 0)) {
      throw new Error('Qty harus lebih dari 0.')
    }
  }

  if (input.metodePembayaran === 'bon' && !input.namaPelanggan?.trim()) {
    throw new Error('Nama pelanggan wajib diisi untuk transaksi bon.')
  }

  const tanggalBaru = parseTanggalTransaksi(input.tanggal)
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  const sudahDibayar = db
    .select()
    .from(bonPayments)
    .where(eq(bonPayments.saleId, saleId))
    .all()
    .reduce((sum, row) => sum + row.jumlah, 0)

  return db.transaction((tx) => {
    const oldItems = tx.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()

    restoreStockForItems(
      tx,
      oldItems.map((item) => ({
        saleId,
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        konversi: item.konversi,
      })),
    )

    tx.delete(saleItems).where(eq(saleItems.saleId, saleId)).run()

    const resolvedItems = resolveItems(tx, input.items)

    const hargaPokokLama = new Map(oldItems.map((item) => [`${item.productId}:${item.productUnitId}`, item.hargaPokok]))

    const now = new Date()
    let total = 0

    for (const line of resolvedItems) {
      const subtotal = Math.round(line.qty * line.hargaJual)
      total += subtotal

      tx.insert(saleItems)
        .values({
          saleId,
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
          konversi: line.konversi,
          baseQuantity: line.qtyDasar,
          satuan: line.satuan,
          hargaJual: line.hargaJual,
          hargaPokok: hargaPokokLama.get(`${line.productId}:${line.productUnitId}`) ?? line.hargaPokok,
          priceSource: line.priceSource,
          subtotal,
          createdAt: tanggalBaru,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`${products.stok} - ${line.qtyDasar}` })
        .where(eq(products.id, line.productId))
        .run()

      tx.insert(stockMovements)
        .values({
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: -line.qty,
          conversionFactor: line.konversi,
          baseQuantity: -line.qtyDasar,
          movementType: 'sale',
          referenceId: saleId,
          createdAt: tanggalBaru,
        })
        .run()
    }

    const lunasNonTunai = (METODE_NON_TUNAI as readonly string[]).includes(input.metodePembayaran)
    const dibayarBaru = lunasNonTunai ? total : (input.dibayar ?? 0)

    if (input.metodePembayaran === 'tunai' && dibayarBaru < total) {
      throw new Error('Uang bayar kurang dari total belanja.')
    }

    if (dibayarBaru < sudahDibayar) {
      throw new Error('Dibayar tidak boleh kurang dari pembayaran yang sudah tercatat.')
    }

    tx.update(sales)
      .set({
        namaPelanggan: input.namaPelanggan,
        metodePembayaran: input.metodePembayaran,
        total,
        dibayar: dibayarBaru,
        createdAt: tanggalBaru,
        updatedAt: now,
      })
      .where(eq(sales.id, saleId))
      .run()

    return { total }
  })
}
```

- [ ] **Step 6: Run the main-process suite**

Run: `npm test -- src/main/kasir.test.ts`
Expected: PASS, all `updateSale` tests plus the pre-existing `checkout`, `cancelSale`, `deleteSale` and `addItemsToSale` blocks.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `src/main/ipc/kasir.ts`, which still imports the deleted `updateSaleDate`. Task 9 fixes those.

- [ ] **Step 8: Commit**

```bash
git add src/main/kasir.ts src/main/kasir.test.ts
git commit -m "feat(kasir): add updateSale, replacing the date-only updateSaleDate"
```

---

### Task 9: IPC, preload and renderer types for editing

**Files:**
- Modify: `src/main/ipc/kasir.ts:6-18,214-220`
- Modify: `src/preload/index.ts:35-37`
- Modify: `src/renderer/env.d.ts:62-64`

**Interfaces:**
- Consumes: `updateSale`, `UpdateSaleInput` from Task 8.
- Produces: `window.api.kasir.getSaleForEdit(saleId)` and `window.api.kasir.updateSale(input)`; `window.api.kasir.updateSaleDate` is gone. Task 10 calls both.

- [ ] **Step 1: Swap the handlers**

In `src/main/ipc/kasir.ts`, replace `updateSaleDate` with `updateSale` in the import block from `../kasir`.

Delete the `kasir:updateSaleDate` handler and put these two in its place:

```ts
  // requireAdmin, not requireUser: rewriting a saved sale shifts the rekap and the cash
  // book on two days at once, the same blast radius as delete and purge.
  ipcMain.handle('kasir:getSaleForEdit', (_event, saleId: number) => {
    requireAdmin()

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    if (!sale) {
      throw new Error('Transaksi tidak ditemukan.')
    }

    const itemRows = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()

    return {
      id: sale.id,
      namaPelanggan: sale.namaPelanggan,
      metodePembayaran: sale.metodePembayaran,
      status: sale.status,
      dibayar: toRupiah(sale.dibayar),
      createdAt: sale.createdAt.toISOString(),
      items: itemRows.map((item) => ({
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        hargaJual: toRupiah(item.hargaJual),
        priceSource: item.priceSource,
      })),
    }
  })

  ipcMain.handle(
    'kasir:updateSale',
    (
      _event,
      input: {
        saleId: number
        metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
        namaPelanggan: string | null
        dibayar: number | null
        tanggal: string
        items: { productId: number; productUnitId: number | null; qty: number; hargaJual?: number | null }[]
      },
    ) => {
      requireAdmin()

      const result = updateSale(db, input.saleId, {
        metodePembayaran: input.metodePembayaran,
        namaPelanggan: input.namaPelanggan,
        dibayar: input.dibayar === null ? null : toCents(input.dibayar),
        tanggal: input.tanggal,
        items: input.items.map((item) => ({
          productId: item.productId,
          productUnitId: item.productUnitId,
          qty: item.qty,
          hargaJual: item.hargaJual == null ? null : toCents(item.hargaJual),
        })),
      })

      return { total: toRupiah(result.total) }
    },
  )
```

- [ ] **Step 2: Update the preload bridge**

In `src/preload/index.ts`, replace the `updateSaleDate` line inside `kasir`:

```ts
    getSaleForEdit: (saleId: number) => invoke('kasir:getSaleForEdit', saleId),
    updateSale: (input: {
      saleId: number
      metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
      namaPelanggan: string | null
      dibayar: number | null
      tanggal: string
      items: { productId: number; productUnitId: number | null; qty: number; hargaJual?: number | null }[]
    }) => invoke('kasir:updateSale', input),
```

- [ ] **Step 3: Update the renderer types**

In `src/renderer/env.d.ts`, replace the `updateSaleDate:` line inside the `kasir` block. Copy the field list from the handler in Step 1 — this file is a hand-maintained mirror and `tsc` cannot tell you when it drifts:

```ts
        getSaleForEdit: (saleId: number) => Promise<{
          id: number
          namaPelanggan: string | null
          metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
          status: 'selesai' | 'dibatalkan'
          dibayar: number
          createdAt: string
          items: {
            productId: number
            productUnitId: number | null
            qty: number
            hargaJual: number
            priceSource: 'normal' | 'price_tier' | 'manual'
          }[]
        }>
        updateSale: (input: {
          saleId: number
          metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
          namaPelanggan: string | null
          dibayar: number | null
          tanggal: string
          items: { productId: number; productUnitId: number | null; qty: number; hargaJual?: number | null }[]
        }) => Promise<{ total: number }>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `src/renderer/pages/KasirHistory.tsx`, which still calls the removed `updateSaleDate`. Task 10 fixes those.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/kasir.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(kasir): expose getSaleForEdit and updateSale over IPC"
```

---

### Task 10: Edit mode on the Penjualan page

**Files:**
- Modify: `src/renderer/pages/kasir/cart-logic.ts` (add `EditSaleItem`, `cartFromSale`)
- Modify: `src/renderer/pages/kasir/PaymentDialog.tsx`
- Modify: `src/renderer/pages/Kasir.tsx`
- Modify: `src/renderer/pages/KasirHistory.tsx:1-30,73-75,197-225,304-355,462-486`
- Test: `src/renderer/pages/kasir/cart-logic.test.ts`

**Interfaces:**
- Consumes: `addLine`/`applyHarga`/`UnitResult` (Tasks 2, 3, 7), `getSaleForEdit`/`updateSale` (Task 9), `CartGridProps.editMode` (Task 7), `PaymentDialogProps` without `printing` (Task 5).
- Produces: `cartFromSale(items: EditSaleItem[], products: Product[]): CartLine[]`; `PaymentDialogProps.editMode: boolean`.

- [ ] **Step 1: Write the failing tests**

Add `cartFromSale` and `type EditSaleItem` to the imports in `src/renderer/pages/kasir/cart-logic.test.ts`, then append:

```ts
describe('cartFromSale', () => {
  it('maps the stored base product_units id back to the cart null base unit', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 2, hargaJual: 65000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product])).toEqual([
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2, hargaOverride: null },
    ])
  })

  it('keeps a derived unit as itself', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 9, qty: 1, hargaJual: 700000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product])).toEqual([
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1, hargaOverride: null },
    ])
  })

  it('turns a manually priced line back into an override', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 1, hargaJual: 55000, priceSource: 'manual' },
    ]

    expect(cartFromSale(items, [product])[0].hargaOverride).toBe(55000)
  })

  it('leaves a tier-priced line to be recomputed rather than pinning it', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 5, hargaJual: 62000, priceSource: 'price_tier' },
    ]

    expect(cartFromSale(items, [product])[0].hargaOverride).toBeNull()
  })

  it('drops a line whose product is gone from the catalog', () => {
    const items: EditSaleItem[] = [
      { productId: 77, productUnitId: 1, qty: 1, hargaJual: 1000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product])).toEqual([])
  })

  it('preserves the saved order of the lines', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 9, qty: 1, hargaJual: 700000, priceSource: 'normal' },
      { productId: 1, productUnitId: 1, qty: 2, hargaJual: 65000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product]).map((line) => line.key)).toEqual([lineKey(1, 9), lineKey(1, null)])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts -t "cartFromSale"`
Expected: FAIL — `cartFromSale` is not exported from `./cart-logic`.

- [ ] **Step 3: Add `cartFromSale`**

Append to `src/renderer/pages/kasir/cart-logic.ts`:

```ts
/** one line of a saved sale, as `kasir:getSaleForEdit` hands it over */
export interface EditSaleItem {
  productId: number
  productUnitId: number | null
  qty: number
  hargaJual: number
  priceSource: 'normal' | 'price_tier' | 'manual'
}

/**
 * Rebuilds a cart from a saved sale.
 *
 * `sale_items` always stores a real `product_units.id`, including for the base unit,
 * while the cart says "base unit" as `productUnitId: null` - so the base row's id has
 * to be translated back on the way in, or the base line would look like a derived one
 * that no longer exists.
 *
 * Only a line that was priced by hand comes back as an override. A `price_tier` or
 * `normal` line is left to be recomputed, so correcting its qty re-prices it the way
 * the till would have.
 */
export function cartFromSale(items: EditSaleItem[], products: Product[]): CartLine[] {
  const cart: CartLine[] = []

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId)

    if (!product) {
      continue
    }

    const isBase = item.productUnitId === null || item.productUnitId === product.baseProductUnitId
    const productUnitId = isBase ? null : item.productUnitId
    const unit = productUnitId === null ? null : product.productUnits.find((u) => u.id === productUnitId)

    cart.push({
      key: lineKey(product.id, productUnitId),
      product,
      productUnitId,
      satuan: unit?.satuan ?? product.satuan,
      qty: item.qty,
      hargaOverride: item.priceSource === 'manual' ? item.hargaJual : null,
    })
  }

  return cart
}
```

- [ ] **Step 4: Run the cart-logic suite**

Run: `npx vitest run src/renderer/pages/kasir/cart-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Teach PaymentDialog about edit mode**

In `src/renderer/pages/kasir/PaymentDialog.tsx`, add to the props interface and the destructured parameters:

```ts
  /** editing a saved sale: there is nothing to print, only changes to save */
  editMode: boolean
```

Replace the `actions` constant with a mode-aware pair:

```tsx
const actions = ['cetak', 'simpan', 'batal'] as const
const editActions = ['simpan', 'batal'] as const
type Action = (typeof actions)[number]
```

Inside the component, just above `const [selectedAction, ...]`:

```tsx
  const availableActions: readonly Action[] = editMode ? editActions : actions
```

Change the initial state and the reopen reset to use it:

```tsx
  const [selectedAction, setSelectedAction] = useState<Action>(editMode ? 'simpan' : 'cetak')
```

```tsx
    if (open) {
      setSelectedAction(editMode ? 'simpan' : 'cetak')
    }
```

In `handleShortcut`, swap `actions` for `availableActions` in the PageUp/PageDown branch:

```tsx
      const index = availableActions.indexOf(selectedAction)
      const delta = e.key === 'PageDown' ? 1 : -1
      setSelectedAction(availableActions[(index + delta + availableActions.length) % availableActions.length])
```

Change the form's `onSubmit` so Enter does the right thing in each mode:

```tsx
          onSubmit={(e) => {
            e.preventDefault()
            runAction(editMode ? 'simpan' : 'cetak')
          }}
```

Wrap the Print/Cetak button so it disappears in edit mode:

```tsx
            {!editMode && (
              <Button
                type="submit"
                disabled={processing || bonNeedsCustomer}
                className={cn(
                  'w-full',
                  selectedAction === 'cetak' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                )}
              >
                {selectedAction === 'cetak' && <CornerDownLeft className="size-4" />}
                <Printer className="size-4" />
                Print/Cetak
              </Button>
            )}
```

and relabel Simpan in the two-column block below it:

```tsx
                  {selectedAction === 'simpan' && <CornerDownLeft className="size-3.5" />}
                  {editMode ? 'Simpan Perubahan' : 'Simpan'}
                  <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+S</kbd>
```

- [ ] **Step 6: Wire edit mode into Kasir**

In `src/renderer/pages/Kasir.tsx`:

Add the router import:

```tsx
import { useNavigate, useSearchParams } from 'react-router-dom'
```

Add `cartFromSale` and `type EditSaleItem` to the `./kasir/cart-logic` import.

At the top of the component, before the other state:

```tsx
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editSaleId = Number(searchParams.get('edit')) || null
```

Change the draft seed so edit mode never reads the cashier's parked cart:

```tsx
  // In edit mode the draft is left completely alone - the cart the cashier walked
  // away from has to be waiting for them when they come back.
  const [initialDraft] = useState(() => (editSaleId === null ? readStoredDraft() : EMPTY_DRAFT))
```

Guard the draft-writing effect:

```tsx
  useEffect(() => {
    if (editSaleId !== null) {
      return
    }

    const draft: KasirDraft = { cart: toStoredCart(cart), metode, namaPelanggan, dibayar, jumlah }

    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  }, [cart, metode, namaPelanggan, dibayar, jumlah, editSaleId])
```

Add a ref for the sale being loaded, next to `pendingRestoreRef`:

```tsx
  // the sale's lines can only be rebuilt once the catalog has loaded, the same
  // dance the draft does
  const pendingEditRef = useRef<EditSaleItem[]>([])
```

Extend `refreshProducts` to resolve it:

```tsx
  function refreshProducts() {
    window.api.kasir
      .listProducts()
      .then((list) => {
        setProducts(list)

        if (pendingEditRef.current.length > 0) {
          setCart(cartFromSale(pendingEditRef.current, list))
          pendingEditRef.current = []

          return
        }

        if (pendingRestoreRef.current.length > 0) {
          setCart(restoreCart(pendingRestoreRef.current, list))
          pendingRestoreRef.current = []
        }
      })
      .catch(() => setError('Gagal memuat data.'))
  }
```

Load the sale on mount. Note the date formatting: `sale.createdAt` is an ISO string in UTC, so slicing it would show the wrong wall-clock time. Use the same local-time formatting `openDateDialog` used in `KasirHistory.tsx:197-206`:

```tsx
  useEffect(() => {
    if (editSaleId === null) {
      return
    }

    window.api.kasir
      .getSaleForEdit(editSaleId)
      .then((sale) => {
        const created = new Date(sale.createdAt)
        const pad = (n: number) => String(n).padStart(2, '0')

        setMetode(sale.metodePembayaran)
        setNamaPelanggan(sale.namaPelanggan ?? DEFAULT_PELANGGAN)
        setDibayar(String(sale.dibayar))
        setTanggal(
          `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}T${pad(created.getHours())}:${pad(created.getMinutes())}`,
        )
        pendingEditRef.current = sale.items
        refreshProducts()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat transaksi.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSaleId])
```

Stop the "refresh tanggal when the dialog opens" effect from overwriting the sale's own date:

```tsx
  useEffect(() => {
    if (paymentOpen && editSaleId === null) {
      setTanggal(nowForInput())
    }
  }, [paymentOpen, editSaleId])
```

Add the save handler next to `handleCheckout`:

```tsx
  async function handleSaveEdit() {
    if (editSaleId === null) {
      return
    }

    setProcessing(true)
    setCheckoutError(null)

    try {
      await window.api.kasir.updateSale({
        saleId: editSaleId,
        metodePembayaran: metode,
        namaPelanggan: metode === 'bon' ? namaPelanggan.trim() || null : namaPelanggan.trim() || DEFAULT_PELANGGAN,
        // Unlike checkout, a bon must send its dibayar too: an edited bon may already
        // carry recorded payments, and sending null would read as 0 and trip
        // updateSale's "tidak boleh kurang dari pembayaran yang sudah tercatat" guard
        // on every single save. Only qris and transfer settle themselves.
        dibayar: metode === 'qris' || metode === 'transfer' ? null : Number(dibayar || 0),
        tanggal,
        items: cart.map((line) => ({
          productId: line.product.id,
          productUnitId: line.productUnitId,
          qty: line.qty,
          hargaJual: line.hargaOverride ?? null,
        })),
      })

      navigate('/history')
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan')
    } finally {
      setProcessing(false)
    }
  }
```

Mark the header. Replace the `PageHeader`'s `title` prop:

```tsx
        title={editSaleId === null ? 'Penjualan' : `Penjualan — Mode Edit #${editSaleId}`}
```

Add a way out, as the first entry inside the `PageHeader`'s `actions` fragment:

```tsx
            {editSaleId !== null && (
              <Button type="button" variant="outline" onClick={() => navigate('/history')}>
                Batal
              </Button>
            )}
```

Relabel the big button in the total card:

```tsx
                {editSaleId === null ? 'Bayar' : 'Simpan Perubahan'}
```

Pass the new props through — on `<CartGrid>`, replacing the hard-coded `editMode={false}` from Task 7:

```tsx
                    editMode={editSaleId !== null}
```

and on `<PaymentDialog>`:

```tsx
        editMode={editSaleId !== null}
        onSubmit={editSaleId === null ? handleCheckout : () => handleSaveEdit()}
```

- [ ] **Step 7: Replace Ubah Tanggal with Edit Transaksi in Riwayat**

In `src/renderer/pages/KasirHistory.tsx`:

Delete the `dateTarget`, `dateValue` and `savingDate` state declarations; the `openDateDialog` and `saveDate` functions; and the entire trailing `<Dialog open={dateTarget !== null} ...>` block. Remove the now-unused `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` and `Label` imports if nothing else in the file uses them.

Replace the `Ubah Tanggal` dropdown item with:

```tsx
              {isAdmin && (
                <DropdownMenuItem onSelect={() => navigate(`/kasir?edit=${row.id}`)}>Edit Transaksi</DropdownMenuItem>
              )}
```

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors anywhere, all tests pass.

- [ ] **Step 9: Manual check**

Run `npm run dev`, logged in as an admin:
1. Put two items in the cart on Penjualan and navigate away without paying.
2. Riwayat → a sale → Edit Transaksi. The cart shows that sale's lines, numbered, with its own date and customer.
3. Change a qty, override a price, add an item by scanning, remove a line. Press Simpan Perubahan.
4. Riwayat shows the new total; open the sale's Detail and confirm the changed line, and that the manual price shows as such.
5. Go back to Penjualan with no `?edit` — **the two items parked in step 1 are still there.**
6. Check Katalog Produk: stock for every product you touched matches what the edit implies.
7. Log in as a cashier: the Edit Transaksi menu item is not offered.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/pages/kasir/cart-logic.ts src/renderer/pages/kasir/cart-logic.test.ts src/renderer/pages/kasir/PaymentDialog.tsx src/renderer/pages/Kasir.tsx src/renderer/pages/KasirHistory.tsx
git commit -m "feat(kasir): edit a saved transaction from the Penjualan page"
```

---

## Final Verification

- [ ] Close the Electron app, then run `npx tsc --noEmit && npm test` from `desktop-node/`. Both clean.
- [ ] `git log --oneline` shows ten focused commits on `feat/perbaikan-penjualan-edit-transaksi`.
- [ ] Walk the seven items in the spec's Ringkasan against the running app one last time.
