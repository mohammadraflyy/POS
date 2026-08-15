# Penjualan: Tanggal Editable, Scan Barcode, Rincian Riwayat, Bon Bisa Ditambah — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the cashier set or correct a sale's date, scan barcodes in the product catalog and in Pembelian, see a per-sale detail page with the customer in its own column, and add items to an unpaid bon from a three-dot action menu.

**Architecture:** All business logic goes into the existing main-process modules (`kasir.ts`, `inventory.ts`, `purchase.ts`) as plain functions taking a Drizzle db handle, so vitest can drive them without Electron. The IPC layer stays a thin adapter that converts rupiah/cents and enforces `requireUser()` / `requireAdmin()`. The renderer gets one new page (`SaleDetail.tsx`) and one new route; everything else is edits to existing pages.

**Tech Stack:** Electron + electron-vite, React 19 + react-router-dom (HashRouter), react-data-grid, Drizzle ORM over better-sqlite3, vitest, Tailwind with shadcn-style components in `src/renderer/components/ui/`.

**Spec:** `docs/superpowers/specs/2026-08-15-penjualan-editable-barcode-riwayat-design.md`

## Global Constraints

- Working directory for every command is `C:\Work\POS\desktop-node`.
- **better-sqlite3 ABI dance.** Main-process tests need the Node ABI build; the app needs the Electron ABI build. Before running vitest: `npm run rebuild:node`. After you finish testing and before launching the app: `npm run rebuild:electron`. Skipping the second step makes the app fail to boot.
- Run tests with `npx vitest run <file>` or `npx vitest run <file> -t "<test name>"`. The `npm test` script is `vitest run` over the whole suite.
- Typecheck with `npx tsc --noEmit -p tsconfig.json` — that one project covers main, preload, and renderer. There is no `tsconfig.web.json`; `tsconfig.node.json` covers only `electron.vite.config.ts` and is not worth running per task. `noUnusedLocals` and `noUnusedParameters` are on, so an unused import or variable fails the build.
- **No database migration in this plan.** Every column used already exists. Do not run `npm run db:generate`.
- Money is stored as integer cents in the database. `toRupiah`/`toCents` conversion happens only in the IPC layer (`src/main/ipc/*.ts`), never in `src/main/*.ts` business logic.
- `src/renderer/env.d.ts` is a hand-written mirror of what IPC handlers return. TypeScript will not catch drift between them. Any field added to a handler's return value must be added to `env.d.ts` in the same task.
- User-facing strings are Indonesian. Error messages must match this plan verbatim, because tests assert on them.
- Code comments are written in English, matching the existing codebase.
- Follow the existing file conventions: no semicolons, single quotes, 2-space indent, named exports.

---

## File Structure

**Created:**
- `src/renderer/pages/SaleDetail.tsx` — per-sale detail page at `/sale/:saleId`, including the "Tambah Item" panel for an unpaid bon.

**Modified:**
- `src/main/inventory.ts` — add `findProductByBarcode`.
- `src/main/purchase.ts` — add `findProductForPurchaseByBarcode`.
- `src/main/kasir.ts` — add `parseTanggalTransaksi`, `resolveItems` (extracted from `checkout`), `updateSaleDate`, `addItemsToSale`; `CheckoutInput` gains `tanggal`.
- `src/main/ipc/inventory.ts`, `src/main/ipc/purchase.ts`, `src/main/ipc/kasir.ts` — new handlers.
- `src/preload/index.ts`, `src/renderer/env.d.ts` — bridge and type mirror for the new handlers.
- `src/renderer/pages/Inventory.tsx` — barcode scan in the search box.
- `src/renderer/pages/inventory/MassInput.tsx` — read `?barcode=` and prefill the first row.
- `src/renderer/pages/Purchase.tsx` — barcode scan on Enter in the product palette.
- `src/renderer/pages/kasir/PaymentDialog.tsx`, `src/renderer/pages/Kasir.tsx` — sale date/time field.
- `src/renderer/pages/KasirHistory.tsx` — Pelanggan column, Metode column fix, three-dot menu, change-date dialog.
- `src/renderer/App.tsx` — the `/sale/:saleId` route.

**Tests:**
- `src/main/inventory.test.ts`, `src/main/purchase.test.ts`, `src/main/kasir.test.ts`.

## Deviation From the Spec

The spec sketches `addItemsToSale(db, saleId, items, userId)`. The `userId` parameter is dropped: `sales.userId` keeps the original cashier and `stock_movements` has no user column, so nothing would consume it. Task 10 uses `addItemsToSale(db, saleId, items)`.

---

### Task 1: Exact-barcode product lookup (catalog)

**Files:**
- Modify: `src/main/inventory.ts` (append after `searchProductsQuick`, around line 282)
- Modify: `src/main/ipc/inventory.ts` (after the `inventory:searchProducts` handler, around line 138)
- Modify: `src/preload/index.ts` (in the `inventory` block, after `searchProducts`)
- Modify: `src/renderer/env.d.ts` (in the `inventory` block, after `searchProducts`)
- Test: `src/main/inventory.test.ts`

**Interfaces:**
- Consumes: `ProductListItem`, `productListSelect`, `toListItem` — all already in `src/main/inventory.ts`.
- Produces: `findProductByBarcode(db, barcode: string): ProductListItem | null` and IPC channel `inventory:findByBarcode` returning `ProductListItemDto | null`. Task 2 calls `window.api.inventory.findByBarcode(q)`.

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/main/inventory.test.ts`. The seed already gives product 1 the barcode `'1234567890'` and leaves products 2 and 3 with `barcode: null`.

```ts
describe('findProductByBarcode', () => {
  it('returns the product whose barcode matches exactly', () => {
    const db = seedProducts()

    const found = findProductByBarcode(db, '1234567890')

    expect(found?.id).toBe(1)
    expect(found?.namaItem).toBe('Beras 5kg')
  })

  it('returns null for a barcode nothing carries', () => {
    const db = seedProducts()

    expect(findProductByBarcode(db, '9999999999')).toBeNull()
  })

  it('returns null for a partial match, so a scan can never pick the wrong product', () => {
    const db = seedProducts()

    expect(findProductByBarcode(db, '12345')).toBeNull()
  })

  it('returns null for an empty barcode instead of the first row in the table', () => {
    const db = seedProducts()

    expect(findProductByBarcode(db, '   ')).toBeNull()
  })
})
```

Add `findProductByBarcode` to the existing import from `./inventory` at the top of the file:

```ts
import {
  listProducts,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  searchProductsQuick,
  findProductByBarcode,
} from './inventory'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run rebuild:node
npx vitest run src/main/inventory.test.ts -t "findProductByBarcode"
```

Expected: FAIL — `findProductByBarcode is not a function`, or a TypeScript import error.

- [ ] **Step 3: Write the implementation**

Append to `src/main/inventory.ts`:

```ts
/**
 * Exact-barcode lookup for a hardware scanner. Deliberately `eq` and not `like`: a scan
 * that matched two products would add the wrong one and there is no human in the loop to
 * catch it. An empty barcode returns null rather than the first row in the table.
 */
export function findProductByBarcode(
  db: BetterSQLite3Database<typeof schema>,
  barcode: string,
): ProductListItem | null {
  const trimmed = barcode.trim()

  if (trimmed === '') {
    return null
  }

  const row = productListSelect(db).where(eq(products.barcode, trimmed)).get()

  return row ? toListItem(row) : null
}
```

`eq` and `products` are already imported at the top of the file.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/main/inventory.test.ts -t "findProductByBarcode"
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Expose it over IPC**

In `src/main/ipc/inventory.ts`, add `findProductByBarcode` to the import from `'../inventory'`, then add a handler right after the `inventory:searchProducts` handler:

```ts
  ipcMain.handle('inventory:findByBarcode', (_event, barcode: string) => {
    requireUser()

    const product = findProductByBarcode(db, barcode)

    return product ? toDto(product) : null
  })
```

In `src/preload/index.ts`, in the `inventory` block right after `searchProducts`:

```ts
    findByBarcode: (barcode: string) => invoke('inventory:findByBarcode', barcode),
```

In `src/renderer/env.d.ts`, in the `inventory` block right after the `searchProducts` declaration (which ends at line 169):

```ts
        findByBarcode: (barcode: string) => Promise<{
          id: number
          kodeItem: string
          barcode: string | null
          namaItem: string
          categoryName: string | null
          satuan: string
          hargaPokok: number
          hargaJual: number
          stok: number
          isActive: boolean
          unitsCount: number
          priceTiersCount: number
        } | null>
```

- [ ] **Step 6: Verify the tests and the types**

```bash
npx vitest run src/main/inventory.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all tests PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/inventory.ts src/main/inventory.test.ts src/main/ipc/inventory.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(inventory): exact-barcode product lookup for scanners"
```

---

### Task 2: Scan in the catalog search box, and prefill a new product from a scan

**Files:**
- Modify: `src/renderer/pages/Inventory.tsx` (search form around lines 479-493, `submitSearch` at line 164)
- Modify: `src/renderer/pages/inventory/MassInput.tsx` (`emptyRow` at line 31, the `useEffect` reading `searchParams` at line 70)

**Interfaces:**
- Consumes: `window.api.inventory.findByBarcode(barcode)` from Task 1.
- Produces: navigation to `/inventory/mass-input?barcode=<digits>`, which MassInput reads.

Behaviour: submitting the search form — Enter, which is what a USB scanner sends after the digits — first tries an exact barcode lookup. A hit navigates straight to that product's detail page. A miss on an all-digit string of 8 or more characters offers to create a new product carrying that barcode. Anything else falls through to the normal search that exists today.

- [ ] **Step 1: Add the scan branch to `Inventory.tsx`**

Add state next to the other `useState` calls in the component, near line 76:

```tsx
  const [scanMiss, setScanMiss] = useState<string | null>(null)
```

Replace `submitSearch` (line 164) with:

```tsx
  // A USB barcode scanner types the digits and then sends Enter, which submits this
  // form. Try an exact barcode first so a scan lands on one product instead of a
  // result list the cashier still has to click through.
  async function submitSearch(e: FormEvent) {
    e.preventDefault()

    const typed = search.trim()
    setScanMiss(null)

    if (typed !== '') {
      const scanned = await window.api.inventory.findByBarcode(typed)

      if (scanned) {
        navigate(`/inventory/${scanned.id}`)

        return
      }

      if (/^\d{8,}$/.test(typed)) {
        setScanMiss(typed)

        return
      }
    }

    loadPage(1)
  }
```

- [ ] **Step 2: Render the "create it" offer**

Directly below the closing `</form>` of the search form, around line 492:

```tsx
          {scanMiss && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
              <span className="text-muted-foreground">Barcode {scanMiss} belum terdaftar.</span>
              <Button
                type="button"
                size="sm"
                onClick={() => navigate(`/inventory/mass-input?barcode=${encodeURIComponent(scanMiss)}`)}
              >
                Buat produk baru dengan barcode ini
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setScanMiss(null)}>
                Tutup
              </Button>
            </div>
          )}
```

- [ ] **Step 3: Read the barcode in `MassInput.tsx`**

In the `useEffect` that reads `searchParams` (starts at line 70), replace the early return for the missing `ids` param so a `barcode` param prefills the first row instead:

```tsx
  useEffect(() => {
    const idsParam = searchParams.get('ids')
    const barcodeParam = searchParams.get('barcode')

    if (!idsParam) {
      // arriving from a scan that matched nothing - start with the barcode already filled
      if (barcodeParam) {
        setRows([{ ...emptyRow(), barcode: barcodeParam }])
      }

      setLoaded(true)
      return
    }
```

Leave the rest of the effect untouched.

- [ ] **Step 4: Verify types**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 5: Check it by hand in the running app**

```bash
npm run rebuild:electron
npm run dev
```

In Katalog Produk, type a registered barcode into the search box and press Enter: the product detail page opens. Type `99999999` and press Enter: the "belum terdaftar" bar appears, and its button opens Input Massal with the barcode already in the first row. Type `beras` and press Enter: the normal search runs.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/Inventory.tsx src/renderer/pages/inventory/MassInput.tsx
git commit -m "feat(inventory): scan a barcode in the catalog search to open or create a product"
```

---

### Task 3: Exact-barcode product lookup (Pembelian)

**Files:**
- Modify: `src/main/purchase.ts` (after `searchProductsForPurchase`, around line 433)
- Modify: `src/main/ipc/purchase.ts` (after the `purchase:searchProducts` handler, around line 135)
- Modify: `src/preload/index.ts` (in the `purchase` block, after `searchProducts`)
- Modify: `src/renderer/env.d.ts` (in the `purchase` block, after `searchProducts`, around line 329)
- Test: `src/main/purchase.test.ts`

**Interfaces:**
- Consumes: `PurchaseProductOption`, `getBaseProductUnit`, `listProductUnits` — already used by `searchProductsForPurchase`.
- Produces: `findProductForPurchaseByBarcode(db, barcode: string): PurchaseProductOption | null` and IPC channel `purchase:findProductByBarcode`. Task 4 calls `window.api.purchase.findProductByBarcode(q)`.

The returned shape must be identical to one element of `searchProductsForPurchase`'s result, because `addItem` in `Purchase.tsx` is reused unchanged.

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/main/purchase.test.ts`:

```ts
describe('findProductForPurchaseByBarcode', () => {
  it('returns the product whose barcode matches exactly, with its units', () => {
    const db = seedDb()
    db.update(products).set({ barcode: '8991002101234' }).where(eq(products.id, 1)).run()

    const found = findProductForPurchaseByBarcode(db, '8991002101234')

    expect(found?.id).toBe(1)
    expect(found?.satuan).toBe('PCS')
    expect(Array.isArray(found?.units)).toBe(true)
  })

  it('returns null for a barcode nothing carries', () => {
    const db = seedDb()

    expect(findProductForPurchaseByBarcode(db, '0000000000')).toBeNull()
  })

  it('returns null for a partial match', () => {
    const db = seedDb()
    db.update(products).set({ barcode: '8991002101234' }).where(eq(products.id, 1)).run()

    expect(findProductForPurchaseByBarcode(db, '899100')).toBeNull()
  })

  it('returns null for an empty barcode', () => {
    const db = seedDb()

    expect(findProductForPurchaseByBarcode(db, '')).toBeNull()
  })
})
```

Add `findProductForPurchaseByBarcode` to the existing import from `'./purchase'` at the top of the file.

If the seeded product 1 does not use a `PCS` base unit, read the seed block and assert on whatever base unit code it actually has instead of hard-coding `'PCS'`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run rebuild:node
npx vitest run src/main/purchase.test.ts -t "findProductForPurchaseByBarcode"
```

Expected: FAIL — `findProductForPurchaseByBarcode is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/main/purchase.ts`, right after `searchProductsForPurchase`:

```ts
/**
 * Exact-barcode lookup returning the same shape as {@link searchProductsForPurchase},
 * so the renderer's `addItem` can consume a scan and a click identically. `eq` not `like`:
 * an ambiguous scan would silently add the wrong product to a purchase.
 */
export function findProductForPurchaseByBarcode(
  db: BetterSQLite3Database<typeof schema>,
  barcode: string,
): PurchaseProductOption | null {
  const trimmed = barcode.trim()

  if (trimmed === '') {
    return null
  }

  const row = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      namaItem: products.namaItem,
      hargaPokok: products.hargaPokok,
    })
    .from(products)
    .where(eq(products.barcode, trimmed))
    .get()

  if (!row) {
    return null
  }

  const baseUnit = getBaseProductUnit(db, row.id)
  const derivedUnits = listProductUnits(db, row.id)
    .filter((u) => !u.isBaseUnit)
    .map((u) => ({ id: u.id, satuan: u.unitCode, konversi: u.conversionFactor }))

  return { ...row, satuan: baseUnit.unitCode, units: derivedUnits }
}
```

Confirm `eq` is in the `drizzle-orm` import at the top of `src/main/purchase.ts`; add it if it is missing.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/main/purchase.test.ts -t "findProductForPurchaseByBarcode"
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Expose it over IPC**

In `src/main/ipc/purchase.ts`, add `findProductForPurchaseByBarcode` to the import from `'../purchase'`, then add after the `purchase:searchProducts` handler:

```ts
  ipcMain.handle('purchase:findProductByBarcode', (_event, barcode: string) => {
    requireUser()

    const product = findProductForPurchaseByBarcode(db, barcode)

    if (!product) {
      return null
    }

    return {
      id: product.id,
      kodeItem: product.kodeItem,
      namaItem: product.namaItem,
      satuan: product.satuan,
      hargaPokok: toRupiah(product.hargaPokok),
      units: product.units,
    }
  })
```

In `src/preload/index.ts`, in the `purchase` block right after `searchProducts`:

```ts
    findProductByBarcode: (barcode: string) => invoke('purchase:findProductByBarcode', barcode),
```

In `src/renderer/env.d.ts`, in the `purchase` block right after the `searchProducts` declaration:

```ts
        findProductByBarcode: (barcode: string) => Promise<{
          id: number
          kodeItem: string
          namaItem: string
          satuan: string
          hargaPokok: number
          units: { id: number; satuan: string; konversi: number }[]
        } | null>
```

Note: the existing `purchase.searchProducts` declaration in `env.d.ts` lists a `level` field on `units` that the handler has never sent. Do not copy that field into the new declaration, and do not fix the old one in this task.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/main/purchase.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/purchase.ts src/main/purchase.test.ts src/main/ipc/purchase.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(purchase): exact-barcode product lookup for scanners"
```

---

### Task 4: Scan into the Pembelian product palette

**Files:**
- Modify: `src/renderer/pages/Purchase.tsx` (the product `CommandDialog` at lines 451-471, `addItem` at line 136)

**Interfaces:**
- Consumes: `window.api.purchase.findProductByBarcode` from Task 3, and the existing `addItem(product: SearchResult)`.
- Produces: nothing consumed by later tasks.

The palette searches over IPC inside a `useEffect`, so the scanner's Enter arrives before the results do and currently selects nothing. Enter gets its own barcode path.

- [ ] **Step 1: Add the Enter handler**

Add above the JSX return, next to the other handlers:

```tsx
  // The palette's search runs in a useEffect, so a scanner's trailing Enter lands
  // before the results do. Handle Enter with its own exact-barcode lookup, and leave
  // the palette open so consecutive scans stack up.
  async function handlePaletteKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') {
      return
    }

    const typed = paletteQuery.trim()

    if (typed === '') {
      return
    }

    const scanned = await window.api.purchase.findProductByBarcode(typed)

    if (!scanned) {
      return
    }

    e.preventDefault()
    addItem(scanned)
    setPaletteOpen(true)
    setPaletteQuery('')
  }
```

`addItem` closes the palette and clears the query, so `setPaletteOpen(true)` immediately after re-opens it for the next scan. Import the React keyboard event type at the top of the file:

```tsx
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
```

- [ ] **Step 2: Wire it to the input**

Change the product palette's `CommandInput` (line 458) to:

```tsx
        <CommandInput
          value={paletteQuery}
          onValueChange={setPaletteQuery}
          onKeyDown={handlePaletteKeyDown}
          placeholder="Cari nama / kode / barcode, atau scan barcode..."
        />
```

Leave the supplier palette's `CommandInput` alone.

- [ ] **Step 3: Verify types**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: clean. If `CommandInput` rejects `onKeyDown`, check `src/renderer/components/ui/command.tsx` — it forwards props to cmdk's input, so the prop passes through.

- [ ] **Step 4: Check it by hand**

```bash
npm run rebuild:electron
npm run dev
```

Give a product a barcode in Katalog Produk. In Pembelian, open the product palette, type that barcode and press Enter: a row appears and the palette stays open with an empty box. Scan the same barcode again: qty goes to 2. Type a product name and press Enter: the highlighted result is added as before.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/Purchase.tsx
git commit -m "feat(purchase): add scanned products straight from the palette"
```

---

### Task 5: Checkout accepts a sale date

**Files:**
- Modify: `src/main/kasir.ts` (`CheckoutInput` at lines 120-126, `checkout` transaction opening at lines 207-208)
- Modify: `src/main/ipc/kasir.ts` (`CheckoutRendererInput` at line 30, `kasir:checkout` handler at line 182)
- Modify: `src/preload/index.ts`, `src/renderer/env.d.ts`
- Test: `src/main/kasir.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `parseTanggalTransaksi(tanggal: string): Date` — exported, reused by Task 7.
  - `CheckoutInput.tanggal?: string | null` — a local `YYYY-MM-DDTHH:mm` string.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('checkout', ...)` block in `src/main/kasir.test.ts`:

```ts
  it('files the whole sale under the given date when tanggal is passed', () => {
    const db = seedDb()
    const tanggal = '2026-08-01T09:30'

    checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      tanggal,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    const expected = new Date(tanggal).toISOString()
    expect(db.select().from(sales).get()?.createdAt.toISOString()).toBe(expected)
    expect(db.select().from(saleItems).get()?.createdAt.toISOString()).toBe(expected)
    expect(db.select().from(stockMovements).get()?.createdAt.toISOString()).toBe(expected)
  })

  it('rejects a sale dated in the future', () => {
    const db = seedDb()
    const besok = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16)

    expect(() =>
      checkout(db, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 3000_00,
        userId: 1,
        tanggal: besok,
        items: [{ productId: 2, productUnitId: null, qty: 1 }],
      }),
    ).toThrow('Tanggal transaksi tidak boleh melewati waktu sekarang.')
  })

  it('rejects a tanggal that is not a date at all', () => {
    const db = seedDb()

    expect(() =>
      checkout(db, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 3000_00,
        userId: 1,
        tanggal: 'kemarin',
        items: [{ productId: 2, productUnitId: null, qty: 1 }],
      }),
    ).toThrow('Tanggal transaksi tidak valid.')
  })

  it('uses the current time when tanggal is omitted', () => {
    const db = seedDb()
    const before = Date.now()

    checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    const createdAt = db.select().from(sales).get()?.createdAt.getTime() ?? 0
    expect(createdAt).toBeGreaterThanOrEqual(before - 1000)
    expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000)
  })
```

`sales`, `saleItems`, and `stockMovements` are already imported in this test file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run rebuild:node
npx vitest run src/main/kasir.test.ts -t "tanggal"
```

Expected: FAIL — the date assertions fail because `tanggal` is ignored, and the two rejection tests fail because nothing throws.

- [ ] **Step 3: Write the implementation**

In `src/main/kasir.ts`, add above `CheckoutInput`:

```ts
/**
 * Parses the local `YYYY-MM-DDTHH:mm` string a `datetime-local` input produces.
 * A future-dated sale would land in a rekap period that has not happened yet, so it is
 * rejected. Backdating has no limit - entering yesterday's sale this morning is normal.
 */
export function parseTanggalTransaksi(tanggal: string): Date {
  const parsed = new Date(tanggal)

  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Tanggal transaksi tidak valid.')
  }

  if (parsed.getTime() > Date.now()) {
    throw new Error('Tanggal transaksi tidak boleh melewati waktu sekarang.')
  }

  return parsed
}
```

Add the field to `CheckoutInput`:

```ts
export interface CheckoutInput {
  metodePembayaran: MetodePembayaran
  namaPelanggan: string | null
  dibayar: number | null
  userId: number
  /** local `YYYY-MM-DDTHH:mm`; omit to stamp the sale with the current time */
  tanggal?: string | null
  items: CartItemInput[]
}
```

In `checkout`, hoist the timestamp out of the transaction so a bad date fails before anything is written. Replace:

```ts
  return db.transaction((tx) => {
    const now = new Date()
```

with:

```ts
  const now = input.tanggal ? parseTanggalTransaksi(input.tanggal) : new Date()

  return db.transaction((tx) => {
```

Everything downstream already reads `now`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/main/kasir.test.ts
```

Expected: PASS, including every pre-existing checkout test.

- [ ] **Step 5: Pass it through the IPC layer**

In `src/main/ipc/kasir.ts`, add `tanggal` to `CheckoutRendererInput`:

```ts
interface CheckoutRendererInput {
  metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
  namaPelanggan: string | null
  dibayar: number | null
  tanggal?: string | null
  items: { productId: number; productUnitId: number | null; qty: number }[]
}
```

and to the `checkoutInput` the handler builds:

```ts
    const checkoutInput: CheckoutInput = {
      metodePembayaran: input.metodePembayaran,
      namaPelanggan: input.namaPelanggan,
      dibayar: input.dibayar === null ? null : toCents(input.dibayar),
      userId: user.id,
      tanggal: input.tanggal ?? null,
      items: input.items,
    }
```

In `src/preload/index.ts`, add `tanggal?: string | null` to the `checkout` input type. In `src/renderer/env.d.ts`, add the same field to the `checkout` declaration.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/main/kasir.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/kasir.ts src/main/kasir.test.ts src/main/ipc/kasir.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(kasir): let checkout record a sale under a chosen date and time"
```

---

### Task 6: Sale date field in the payment dialog

**Files:**
- Modify: `src/renderer/pages/kasir/PaymentDialog.tsx` (props at lines 16-31, JSX after the customer button around line 247)
- Modify: `src/renderer/pages/Kasir.tsx` (state near line 93, `resetAfterCheckout` at line 330, `handleCheckout` at line 337, `<PaymentDialog>` props at line 603)

**Interfaces:**
- Consumes: `window.api.kasir.checkout({ ..., tanggal })` from Task 5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add a helper for the default value**

At the top of `src/renderer/pages/Kasir.tsx`, below the imports:

```tsx
/** current local time in the `YYYY-MM-DDTHH:mm` shape a datetime-local input wants */
function nowForInput(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}
```

Do not use `toISOString().slice(0, 16)` here — that yields UTC and would show the cashier a time hours off their own clock.

- [ ] **Step 2: Add the state and wire the checkout call**

Next to the other `useState` calls in `Kasir.tsx`, near line 93:

```tsx
  const [tanggal, setTanggal] = useState(nowForInput())
```

In `handleCheckout`, add `tanggal` to the payload passed to `window.api.kasir.checkout`, right after `dibayar`:

```tsx
        tanggal,
```

In `resetAfterCheckout`, add:

```tsx
    setTanggal(nowForInput())
```

so the next sale starts from the clock again rather than keeping a backdate.

Pass the pair to the dialog in the `<PaymentDialog>` element:

```tsx
        tanggal={tanggal}
        setTanggal={setTanggal}
```

- [ ] **Step 3: Render the field in `PaymentDialog.tsx`**

Add to `PaymentDialogProps`:

```tsx
  /** local `YYYY-MM-DDTHH:mm` the sale will be filed under */
  tanggal: string
  setTanggal: (value: string) => void
```

Add `tanggal` and `setTanggal` to the destructured parameter list of the component.

Insert this block directly after the customer `<button>` that ends around line 247, before the `bonNeedsCustomer` warning:

```tsx
          {/* backdating a sale is normal here: the cashier often enters yesterday's
              sale the next morning. The main process rejects future dates. */}
          <div className="grid gap-2">
            <Label htmlFor="tanggal-transaksi">Tanggal &amp; Jam Transaksi</Label>
            <Input
              id="tanggal-transaksi"
              type="datetime-local"
              value={tanggal}
              disabled={processing || printing}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </div>
```

`Label` and `Input` are already imported in this file.

- [ ] **Step 4: Verify types**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 5: Check it by hand**

```bash
npm run rebuild:electron
npm run dev
```

Ring up a sale, set the date field to yesterday, save. The sale appears in Riwayat under yesterday's date. Open the payment dialog again: the field shows the current time, not yesterday. Set it to tomorrow and save: the dialog shows `Tanggal transaksi tidak boleh melewati waktu sekarang.` and nothing is written.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/Kasir.tsx src/renderer/pages/kasir/PaymentDialog.tsx
git commit -m "feat(kasir): choose the sale date and time at checkout"
```

---

### Task 7: Change a saved sale's date (admin only)

**Files:**
- Modify: `src/main/kasir.ts` (append below the `Db` type alias at line 285, after `cancelSale`)
- Modify: `src/main/ipc/kasir.ts` (after the `kasir:deleteSale` handler, around line 208)
- Modify: `src/preload/index.ts`, `src/renderer/env.d.ts`
- Test: `src/main/kasir.test.ts`

**Interfaces:**
- Consumes: `parseTanggalTransaksi` from Task 5.
- Produces: `updateSaleDate(db, saleId: number, tanggal: string): void` and IPC channel `kasir:updateSaleDate` guarded by `requireAdmin()`. Task 12 calls `window.api.kasir.updateSaleDate({ saleId, tanggal })`.

- [ ] **Step 1: Lift `seedDb` to module scope**

`seedDb` currently lives inside `describe('checkout', ...)` in `src/main/kasir.test.ts` (line 208), and Tasks 7 and 10 both need it. Move the `seedDb` function and its `migrationsFolder` constant out to module scope, just below `seedPcsBaseUnits`. This is an indentation-only move — do not change its body.

Run the suite to prove the move changed nothing:

```bash
npm run rebuild:node
npx vitest run src/main/kasir.test.ts
```

Expected: PASS, same count as before.

- [ ] **Step 2: Write the failing tests**

Add a new `describe` block at module scope in `src/main/kasir.test.ts`:

```ts
describe('updateSaleDate', () => {
  it('moves the sale to the new date', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    updateSaleDate(db, saleId, '2026-07-04T14:05')

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.createdAt.toISOString()).toBe(new Date('2026-07-04T14:05').toISOString())
  })

  it('leaves stock movements where they are, because they record when the goods left', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })
    const before = db.select().from(stockMovements).get()?.createdAt.toISOString()

    updateSaleDate(db, saleId, '2026-07-04T14:05')

    expect(db.select().from(stockMovements).get()?.createdAt.toISOString()).toBe(before)
  })

  it('rejects a sale that does not exist', () => {
    const db = seedDb()

    expect(() => updateSaleDate(db, 999, '2026-07-04T14:05')).toThrow('Transaksi tidak ditemukan.')
  })

  it('rejects a future date', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })
    const besok = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16)

    expect(() => updateSaleDate(db, saleId, besok)).toThrow('Tanggal transaksi tidak boleh melewati waktu sekarang.')
  })
})
```

Add `updateSaleDate` to the import from `'./kasir'`.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/main/kasir.test.ts -t "updateSaleDate"
```

Expected: FAIL — `updateSaleDate is not a function`.

- [ ] **Step 4: Write the implementation**

Append to `src/main/kasir.ts`, below the `Db` type alias:

```ts
/**
 * Moves a saved sale to another date. Only `sales.createdAt` moves: every money report
 * (rekap, buku kas) reads its period from that column, while `sale_items` and
 * `stock_movements` record when the goods physically left and stay where they are.
 *
 * Cancelled sales may be redated too - the status says nothing about when it happened.
 */
export function updateSaleDate(db: Db, saleId: number, tanggal: string): void {
  const tanggalBaru = parseTanggalTransaksi(tanggal)
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  db.update(sales).set({ createdAt: tanggalBaru, updatedAt: new Date() }).where(eq(sales.id, saleId)).run()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/main/kasir.test.ts
```

Expected: PASS.

- [ ] **Step 6: Expose it over IPC, admin only**

In `src/main/ipc/kasir.ts`, add `updateSaleDate` to the import from `'../kasir'`, then add after the `kasir:deleteSale` handler:

```ts
  // requireAdmin, not requireUser: redating a saved sale shifts the rekap and the cash
  // book on two days at once, the same blast radius as delete and purge.
  ipcMain.handle('kasir:updateSaleDate', (_event, input: { saleId: number; tanggal: string }) => {
    requireAdmin()

    updateSaleDate(db, input.saleId, input.tanggal)
  })
```

In `src/preload/index.ts`, in the `kasir` block after `deleteSale`:

```ts
    updateSaleDate: (input: { saleId: number; tanggal: string }) => invoke('kasir:updateSaleDate', input),
```

In `src/renderer/env.d.ts`, in the `kasir` block after `deleteSale`:

```ts
        updateSaleDate: (input: { saleId: number; tanggal: string }) => Promise<void>
```

- [ ] **Step 7: Verify**

```bash
npx vitest run src/main/kasir.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS, tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/main/kasir.ts src/main/kasir.test.ts src/main/ipc/kasir.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(kasir): admins can move a saved sale to another date"
```

---

### Task 8: Widen the sale detail payload

**Files:**
- Modify: `src/main/ipc/kasir.ts` (`kasir:getSaleDetail` handler, lines 369-412)
- Modify: `src/renderer/env.d.ts` (`getSaleDetail` declaration, lines 96-106)

**Interfaces:**
- Consumes: nothing new.
- Produces: `kasir:getSaleDetail` now also returns, per item, `productId`, `productUnitId`, `hargaJual`, `subtotal`, `priceSource`; and at the top level, `kasirName`. Task 9 renders all of them.

`BonPayment.tsx` also calls this handler but declares its own narrower local `SaleDetail` interface, so the extra fields do not break it. Leave that file alone.

- [ ] **Step 1: Extend the handler**

In the `kasir:getSaleDetail` handler, add the cashier lookup after the `paymentRows` query:

```ts
    const kasir = sale.userId
      ? db.select({ name: users.name }).from(users).where(eq(users.id, sale.userId)).get()
      : null
```

`users` is already imported in this file.

Then extend the returned object:

```ts
    return {
      id: sale.id,
      namaPelanggan: sale.namaPelanggan,
      metodePembayaran: sale.metodePembayaran,
      status: sale.status,
      total: toRupiah(sale.total),
      dibayar: toRupiah(sale.dibayar),
      createdAt: sale.createdAt.toISOString(),
      kasirName: kasir?.name ?? null,
      items: itemRows.map((item) => ({
        id: item.id,
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        satuan: item.satuan,
        namaItem: productNameById.get(item.productId) ?? '',
        hargaJual: toRupiah(item.hargaJual),
        subtotal: toRupiah(item.subtotal),
        priceSource: item.priceSource,
      })),
      bonPayments: paymentRows.map((payment) => ({
        id: payment.id,
        jumlah: toRupiah(payment.jumlah),
        tanggal: payment.tanggal,
        keterangan: payment.keterangan,
      })),
    }
```

- [ ] **Step 2: Mirror it in `env.d.ts`**

Replace the `getSaleDetail` declaration with:

```ts
        getSaleDetail: (saleId: number) => Promise<{
          id: number
          namaPelanggan: string | null
          metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
          status: 'selesai' | 'dibatalkan'
          total: number
          dibayar: number
          createdAt: string
          kasirName: string | null
          items: {
            id: number
            productId: number
            productUnitId: number | null
            qty: number
            satuan: string | null
            namaItem: string
            hargaJual: number
            subtotal: number
            priceSource: 'normal' | 'price_tier' | 'manual'
          }[]
          bonPayments: { id: number; jumlah: number; tanggal: string; keterangan: string | null }[]
        }>
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: clean, including `BonPayment.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/kasir.ts src/renderer/env.d.ts
git commit -m "feat(kasir): return per-item prices and the cashier name with sale details"
```

---

### Task 9: Sale detail page, plus the customer column in Riwayat

**Files:**
- Create: `src/renderer/pages/SaleDetail.tsx`
- Modify: `src/renderer/App.tsx` (imports at lines 1-18, routes at lines 24-42)
- Modify: `src/renderer/pages/KasirHistory.tsx` (`OTHER_COLUMNS_WIDTH` at line 36, the `metodePembayaran` column at lines 178-183, the `<DataGrid>` element at line 304)

**Interfaces:**
- Consumes: `window.api.kasir.getSaleDetail` as widened in Task 8.
- Produces: route `/sale/:saleId` and the `SaleDetail` component. Task 11 adds the "Tambah Item" panel to this file; Task 12 links to this route from the action menu.

- [ ] **Step 1: Create the page**

Create `src/renderer/pages/SaleDetail.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { ReportTable } from '@/components/report-table'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SaleDetailItem {
  id: number
  productId: number
  productUnitId: number | null
  qty: number
  satuan: string | null
  namaItem: string
  hargaJual: number
  subtotal: number
  priceSource: 'normal' | 'price_tier' | 'manual'
}

interface BonPaymentRow {
  id: number
  jumlah: number
  tanggal: string
  keterangan: string | null
}

interface SaleDetailData {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  createdAt: string
  kasirName: string | null
  items: SaleDetailItem[]
  bonPayments: BonPaymentRow[]
}

const METODE_LABEL: Record<SaleDetailData['metodePembayaran'], string> = {
  tunai: 'Tunai',
  bon: 'Bon',
  qris: 'QRIS',
  transfer: 'Transfer',
}

const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/kasir' },
  { title: 'Riwayat Transaksi', href: '/history' },
]

const ITEM_COLUMNS: Column<SaleDetailItem>[] = [
  { key: 'namaItem', name: 'Item', width: 320 },
  {
    key: 'qty',
    name: 'Qty',
    width: 100,
    renderCell: ({ row }) => <span className="w-full text-right">{row.qty}</span>,
  },
  { key: 'satuan', name: 'Satuan', width: 100, renderCell: ({ row }) => row.satuan ?? '-' },
  {
    key: 'hargaJual',
    name: 'Harga',
    width: 140,
    renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.hargaJual)}</span>,
  },
  {
    key: 'subtotal',
    name: 'Subtotal',
    width: 140,
    renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.subtotal)}</span>,
  },
]

const PAYMENT_COLUMNS: Column<BonPaymentRow>[] = [
  { key: 'tanggal', name: 'Tanggal', width: 160 },
  {
    key: 'jumlah',
    name: 'Jumlah',
    width: 160,
    renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.jumlah)}</span>,
  },
  { key: 'keterangan', name: 'Keterangan', width: 320, renderCell: ({ row }) => row.keterangan ?? '-' },
]

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}

export function SaleDetail() {
  const navigate = useNavigate()
  const { saleId } = useParams<{ saleId: string }>()
  const [sale, setSale] = useState<SaleDetailData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  function loadSale() {
    window.api.kasir
      .getSaleDetail(Number(saleId))
      .then((data) => {
        setSale(data)
        setLoadError(null)
      })
      .catch(() => setLoadError('Gagal memuat transaksi.'))
  }

  useEffect(() => {
    loadSale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId])

  const sisa = sale ? sale.total - sale.dibayar : 0

  return (
    <AppShell breadcrumbs={[...BREADCRUMBS, { title: `Transaksi #${saleId}`, href: `/sale/${saleId}` }]}>
      <Page>
        <PageHeader title={`Transaksi #${saleId}`} />

        <div>
          <Button variant="outline" onClick={() => navigate('/history')}>
            Kembali ke Riwayat
          </Button>
        </div>

        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}

        {sale && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tanggal" value={new Date(sale.createdAt).toLocaleString('id-ID')} />
              <Field label="Pelanggan" value={sale.namaPelanggan ?? 'UMUM'} />
              <Field label="Metode" value={METODE_LABEL[sale.metodePembayaran]} />
              <Field label="Kasir" value={sale.kasirName ?? '-'} />
            </div>

            <ReportTable
              title="Item"
              columns={ITEM_COLUMNS}
              rows={sale.items}
              rowKey={(row) => row.id}
              emptyMessage="Transaksi ini tidak punya item."
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Total" value={formatRupiah(sale.total)} />
              <Field label="Dibayar" value={formatRupiah(sale.dibayar)} />
              <Field
                label={sale.status === 'dibatalkan' ? 'Status' : 'Sisa'}
                value={sale.status === 'dibatalkan' ? 'Dibatalkan' : formatRupiah(sisa)}
              />
            </div>

            {sale.bonPayments.length > 0 && (
              <ReportTable
                title="Riwayat Pembayaran Bon"
                columns={PAYMENT_COLUMNS}
                rows={sale.bonPayments}
                rowKey={(row) => row.id}
                emptyMessage="Belum ada pembayaran."
              />
            )}
          </>
        )}
      </Page>
    </AppShell>
  )
}
```

If `PageHeader` accepts an `action` prop (check `src/renderer/components/page.tsx`), move the "Kembali ke Riwayat" button into it and drop the wrapping `<div>`. Do not add a prop to the shared component for this.

- [ ] **Step 2: Register the route**

In `src/renderer/App.tsx`, add the import next to the other page imports:

```tsx
import { SaleDetail } from './pages/SaleDetail'
```

and the route next to `/bon-payment/:saleId`:

```tsx
        <Route path="/sale/:saleId" element={<SaleDetail />} />
```

- [ ] **Step 3: Split the customer out of the Metode column in `KasirHistory.tsx`**

Add above the component, next to `BREADCRUMBS`:

```tsx
const METODE_LABEL: Record<SaleHistoryRow['metodePembayaran'], string> = {
  tunai: 'Tunai',
  bon: 'Bon',
  qris: 'QRIS',
  transfer: 'Transfer',
}
```

Replace the single `metodePembayaran` column at lines 178-183 with two columns:

```tsx
    {
      key: 'namaPelanggan',
      name: 'Pelanggan',
      width: 200,
      renderCell: ({ row }) => row.namaPelanggan ?? 'UMUM',
    },
    {
      key: 'metodePembayaran',
      name: 'Metode',
      width: 120,
      // the old ternary here predated qris and transfer and rendered both as "Tunai"
      renderCell: ({ row }) => METODE_LABEL[row.metodePembayaran],
    },
```

Update the width constant on line 36 to match the new column set — id 60, tanggal 180, pelanggan 200, metode 120, status 140, total 120, aksi 380:

```tsx
const OTHER_COLUMNS_WIDTH = 60 + 180 + 200 + 120 + 140 + 120 + 380
```

- [ ] **Step 4: Make the row open the detail page**

Add to the `<DataGrid>` element in `KasirHistory.tsx`:

```tsx
              onCellClick={({ row, column }) => {
                if (column.key !== 'aksi') {
                  navigate(`/sale/${row.id}`)
                }
              }}
```

The guard keeps a click on an action button from also navigating. If this version of react-data-grid names the prop differently, check its types and use the equivalent cell- or row-click prop.

- [ ] **Step 5: Verify types**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 6: Check it by hand**

```bash
npm run rebuild:electron
npm run dev
```

In Riwayat: Pelanggan is its own column, a QRIS sale reads "QRIS" and not "Tunai", and clicking a row opens `/sale/<id>` showing items, prices, totals, and — for a bon with instalments — the payment history.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/SaleDetail.tsx src/renderer/App.tsx src/renderer/pages/KasirHistory.tsx
git commit -m "feat(kasir): sale detail page and a customer column in the history grid"
```

---

### Task 10: Add items to an unpaid bon (backend)

**Files:**
- Modify: `src/main/kasir.ts` (extract `resolveItems` from `checkout` lines 148-205, then append `addItemsToSale`)
- Modify: `src/main/ipc/kasir.ts` (after the `kasir:recordBonPayment` handler)
- Modify: `src/preload/index.ts`, `src/renderer/env.d.ts`
- Test: `src/main/kasir.test.ts`

**Interfaces:**
- Consumes: `resolveCartItem`, `CartItemInput`, `ResolvedItem`, `Db` — all already in `src/main/kasir.ts`; `seedDb` lifted to module scope in Task 7.
- Produces: `addItemsToSale(db, saleId: number, items: CartItemInput[]): { total: number }` and IPC channel `kasir:addItemsToSale`. Task 11 calls `window.api.kasir.addItemsToSale({ saleId, items })`.

- [ ] **Step 1: Extract the item resolver from `checkout`**

This is a pure refactor with no behaviour change; the existing checkout tests are the safety net. In `src/main/kasir.ts`, move lines 148-205 of `checkout` — the product load, the unit load, the tier load, and the resolve loop with its stock check — into a module-level function placed just above `checkout`:

```ts
/**
 * Turns cart lines into priced, stock-checked sale lines. Shared by `checkout` and
 * `addItemsToSale` so a line added to an existing bon is priced by exactly the same
 * tier rules and cost snapshot as one rung up at the till.
 */
function resolveItems(db: BetterSQLite3Database<typeof schema>, items: CartItemInput[]): ResolvedItem[] {
  const productIds = items.map((item) => item.productId)
  const productRows = db.select().from(products).where(inArray(products.id, productIds)).all()
  const productsById = new Map(productRows.map((product) => [product.id, product]))

  const unitRows = db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      unitId: productUnits.unitId,
      unitCode: units.code,
      conversionFactor: productUnits.conversionFactor,
      hargaJual: productUnits.hargaJual,
      hargaPokok: productUnits.hargaPokok,
      isBaseUnit: productUnits.isBaseUnit,
    })
    .from(productUnits)
    .innerJoin(units, eq(productUnits.unitId, units.id))
    .where(inArray(productUnits.productId, productIds))
    .all()

  const tierRows = db
    .select()
    .from(productPriceTiers)
    .where(inArray(productPriceTiers.productId, productIds))
    .all()

  const resolvedItems: ResolvedItem[] = []
  const qtyDasarByProduct = new Map<number, number>()

  for (const item of items) {
    const product = productsById.get(item.productId)

    if (!product) {
      throw new Error('Produk tidak ditemukan.')
    }

    const unit = item.productUnitId
      ? unitRows.find((row) => row.id === item.productUnitId && row.productId === product.id)
      : unitRows.find((row) => row.productId === product.id && row.isBaseUnit)

    if (!unit) {
      throw new Error(`Satuan tidak valid untuk ${product.namaItem}.`)
    }

    // tiers hang off the unit being sold, so a DUS line prices against DUS tiers
    // and never against the base unit's
    const tiers: PriceTier[] = tierRows
      .filter((row) => row.productUnitId === unit.id)
      .map((row) => ({ minQty: row.minQty, maxQty: row.maxQty, hargaJual: row.hargaJual }))

    const resolved = resolveCartItem(product, unit, tiers, item.qty)
    const previousQtyDasar = qtyDasarByProduct.get(product.id) ?? 0
    const totalQtyDasar = previousQtyDasar + resolved.qtyDasar

    if (product.stok < totalQtyDasar) {
      throw new Error(`Stok ${product.namaItem} tidak cukup.`)
    }

    qtyDasarByProduct.set(product.id, totalQtyDasar)
    resolvedItems.push(resolved)
  }

  return resolvedItems
}
```

In `checkout`, replace those deleted lines with:

```ts
  const resolvedItems = resolveItems(db, input.items)
```

- [ ] **Step 2: Run the existing tests to prove the refactor changed nothing**

```bash
npm run rebuild:node
npx vitest run src/main/kasir.test.ts
```

Expected: PASS, exactly as before the refactor. Commit the refactor on its own:

```bash
git add src/main/kasir.ts
git commit -m "refactor(kasir): extract resolveItems from checkout"
```

- [ ] **Step 3: Write the failing tests for `addItemsToSale`**

Add to `src/main/kasir.test.ts`:

```ts
describe('addItemsToSale', () => {
  function seedWithBon() {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Sri',
      dibayar: null,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 2 }],
    })

    return { db, saleId }
  }

  it('appends the item, raises the total, and cuts stock', () => {
    const { db, saleId } = seedWithBon()
    const stokAwal = db.select().from(products).where(eq(products.id, 2)).get()?.stok ?? 0
    const totalAwal = db.select().from(sales).where(eq(sales.id, saleId)).get()?.total ?? 0

    const result = addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 3 }])

    expect(result.total).toBe(totalAwal + 3 * 3000_00)
    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()?.total).toBe(totalAwal + 3 * 3000_00)
    expect(db.select().from(products).where(eq(products.id, 2)).get()?.stok).toBe(stokAwal - 3)
    expect(db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()).toHaveLength(2)
  })

  it('logs a stock movement for the added line', () => {
    const { db, saleId } = seedWithBon()

    addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 3 }])

    const movements = db.select().from(stockMovements).where(eq(stockMovements.referenceId, saleId)).all()
    expect(movements).toHaveLength(2)
    expect(movements[1].movementType).toBe('sale')
    expect(movements[1].quantity).toBe(-3)
  })

  it('does not move the sale date, because the bon is still the old bon', () => {
    const { db, saleId } = seedWithBon()
    const before = db.select().from(sales).where(eq(sales.id, saleId)).get()?.createdAt.toISOString()

    addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 1 }])

    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()?.createdAt.toISOString()).toBe(before)
  })

  it('refuses a sale that is not a bon', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    expect(() => addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 1 }])).toThrow(
      'Hanya transaksi bon yang bisa ditambah item.',
    )
  })

  it('refuses a cancelled sale', () => {
    const { db, saleId } = seedWithBon()
    cancelSale(db, saleId)

    expect(() => addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 1 }])).toThrow(
      'Transaksi yang dibatalkan tidak bisa ditambah item.',
    )
  })

  it('refuses a bon that is already settled', () => {
    const { db, saleId } = seedWithBon()
    const total = db.select().from(sales).where(eq(sales.id, saleId)).get()?.total ?? 0
    recordBonPayment(db, saleId, total, null)

    expect(() => addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 1 }])).toThrow(
      'Bon sudah lunas, tidak bisa ditambah item.',
    )
  })

  it('refuses a sale that does not exist', () => {
    const db = seedDb()

    expect(() => addItemsToSale(db, 999, [{ productId: 2, productUnitId: null, qty: 1 }])).toThrow(
      'Transaksi tidak ditemukan.',
    )
  })

  it('refuses an empty item list', () => {
    const { db, saleId } = seedWithBon()

    expect(() => addItemsToSale(db, saleId, [])).toThrow('Tidak ada item yang ditambahkan.')
  })

  it('writes nothing when one line asks for more qty than there is stock', () => {
    const { db, saleId } = seedWithBon()
    const stokAwal = db.select().from(products).where(eq(products.id, 1)).get()?.stok ?? 0
    const itemsAwal = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all().length

    expect(() =>
      addItemsToSale(db, saleId, [
        { productId: 2, productUnitId: null, qty: 1 },
        { productId: 1, productUnitId: null, qty: 9999 },
      ]),
    ).toThrow('Stok Beras 5kg tidak cukup.')

    expect(db.select().from(products).where(eq(products.id, 1)).get()?.stok).toBe(stokAwal)
    expect(db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()).toHaveLength(itemsAwal)
  })
})
```

Add `addItemsToSale` to the import from `'./kasir'`. `cancelSale` and `recordBonPayment` are already imported; `recordBonPayment` takes cents, which is what the assertion reads out of the row.

- [ ] **Step 4: Run the tests to verify they fail**

```bash
npx vitest run src/main/kasir.test.ts -t "addItemsToSale"
```

Expected: FAIL — `addItemsToSale is not a function`.

- [ ] **Step 5: Write the implementation**

Append to `src/main/kasir.ts`, below `updateSaleDate`:

```ts
/**
 * Appends lines to an existing unpaid bon: the customer took more goods on the same tab.
 *
 * The new lines are stamped with today's date while `sales.createdAt` stays put - the
 * goods left today, but the debt is still the old debt. `dibayar` is untouched, so the
 * outstanding balance rises by exactly the added subtotal.
 *
 * Only unpaid bon qualify. A cash, qris or transfer sale is money already counted, and
 * editing it would silently disagree with the day's takings.
 */
export function addItemsToSale(db: Db, saleId: number, items: CartItemInput[]): { total: number } {
  if (items.length < 1) {
    throw new Error('Tidak ada item yang ditambahkan.')
  }

  for (const item of items) {
    if (!(item.qty > 0)) {
      throw new Error('Qty harus lebih dari 0.')
    }
  }

  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  if (sale.status !== 'selesai') {
    throw new Error('Transaksi yang dibatalkan tidak bisa ditambah item.')
  }

  if (sale.metodePembayaran !== 'bon') {
    throw new Error('Hanya transaksi bon yang bisa ditambah item.')
  }

  if (sale.dibayar >= sale.total) {
    throw new Error('Bon sudah lunas, tidak bisa ditambah item.')
  }

  const resolvedItems = resolveItems(db, items)

  return db.transaction((tx) => {
    const now = new Date()
    let tambahan = 0

    for (const line of resolvedItems) {
      const subtotal = Math.round(line.qty * line.hargaJual)
      tambahan += subtotal

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
          hargaPokok: line.hargaPokok,
          priceSource: line.priceSource,
          subtotal,
          createdAt: now,
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
          createdAt: now,
        })
        .run()
    }

    const total = sale.total + tambahan

    tx.update(sales).set({ total, updatedAt: now }).where(eq(sales.id, saleId)).run()

    return { total }
  })
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/main/kasir.test.ts
```

Expected: PASS, all 9 new tests plus every pre-existing one.

- [ ] **Step 7: Expose it over IPC**

In `src/main/ipc/kasir.ts`, add `addItemsToSale` to the import from `'../kasir'`, then add after the `kasir:recordBonPayment` handler:

```ts
  ipcMain.handle(
    'kasir:addItemsToSale',
    (_event, input: { saleId: number; items: { productId: number; productUnitId: number | null; qty: number }[] }) => {
      requireUser()

      const result = addItemsToSale(db, input.saleId, input.items)

      return { total: toRupiah(result.total) }
    },
  )
```

In `src/preload/index.ts`, in the `kasir` block after `recordBonPayment`:

```ts
    addItemsToSale: (input: {
      saleId: number
      items: { productId: number; productUnitId: number | null; qty: number }[]
    }) => invoke('kasir:addItemsToSale', input),
```

In `src/renderer/env.d.ts`, in the `kasir` block after `recordBonPayment`:

```ts
        addItemsToSale: (input: {
          saleId: number
          items: { productId: number; productUnitId: number | null; qty: number }[]
        }) => Promise<{ total: number }>
```

- [ ] **Step 8: Verify**

```bash
npx vitest run src/main/kasir.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS, tsc clean.

- [ ] **Step 9: Commit**

```bash
git add src/main/kasir.ts src/main/kasir.test.ts src/main/ipc/kasir.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(kasir): add items to an unpaid bon"
```

---

### Task 11: "Tambah Item" panel on the sale detail page

**Files:**
- Modify: `src/renderer/pages/SaleDetail.tsx` (created in Task 9)

**Interfaces:**
- Consumes: `window.api.kasir.addItemsToSale` from Task 10, and the existing `window.api.kasir.listProducts`.
- Produces: nothing consumed by later tasks.

`kasir.listProducts` already returns every product with its `baseProductUnitId`, `productUnits`, and `stok` — enough to pick a unit and a qty without a second call. Use it rather than adding a new search handler.

- [ ] **Step 1: Add the panel's types, state, and handlers**

Add this interface next to the other interfaces in `SaleDetail.tsx`:

```tsx
interface KasirProduct {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  satuan: string
  hargaJual: number
  stok: number
  baseProductUnitId: number
  productUnits: { id: number; satuan: string; konversi: number; hargaJual: number }[]
}
```

Add `FormEvent` to the React type imports at the top:

```tsx
import type { FormEvent } from 'react'
```

Add inside the component, below `loadSale`:

```tsx
  const [addOpen, setAddOpen] = useState(false)
  const [catalog, setCatalog] = useState<KasirProduct[]>([])
  const [pickedId, setPickedId] = useState('')
  const [pickedUnitId, setPickedUnitId] = useState('base')
  const [qty, setQty] = useState('1')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    if (!addOpen || catalog.length > 0) {
      return
    }

    window.api.kasir
      .listProducts()
      .then(setCatalog)
      .catch(() => setAddError('Gagal memuat daftar produk.'))
  }, [addOpen, catalog.length])

  const picked = catalog.find((product) => product.id === Number(pickedId))

  async function submitAddItem(e: FormEvent) {
    e.preventDefault()

    const productId = Number(pickedId)
    const jumlah = Number(qty)

    if (!productId || !(jumlah > 0)) {
      setAddError('Pilih produk dan isi qty lebih dari 0.')

      return
    }

    setSaving(true)
    setAddError(null)

    try {
      await window.api.kasir.addItemsToSale({
        saleId: Number(saleId),
        items: [{ productId, productUnitId: pickedUnitId === 'base' ? null : Number(pickedUnitId), qty: jumlah }],
      })

      setPickedId('')
      setPickedUnitId('base')
      setQty('1')
      setAddOpen(false)
      loadSale()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Gagal menambah item')
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 2: Render the panel**

Add inside the `{sale && (...)}` block, after the bon payments table:

```tsx
            {sale.metodePembayaran === 'bon' && sale.status === 'selesai' && sisa > 0 && (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Tambah Item ke Bon</h2>
                  <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen((open) => !open)}>
                    {addOpen ? 'Tutup' : 'Tambah Item'}
                  </Button>
                </div>

                {addOpen && (
                  <form onSubmit={submitAddItem} className="flex flex-wrap items-end gap-2">
                    <div className="grid gap-1">
                      <Label className="text-xs">Produk</Label>
                      <select
                        value={pickedId}
                        onChange={(e) => {
                          setPickedId(e.target.value)
                          setPickedUnitId('base')
                        }}
                        className="h-9 w-72 rounded-md border bg-transparent px-3 text-sm"
                      >
                        <option value="">Pilih produk...</option>
                        {catalog.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.namaItem} (stok {product.stok})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-1">
                      <Label className="text-xs">Satuan</Label>
                      <select
                        value={pickedUnitId}
                        onChange={(e) => setPickedUnitId(e.target.value)}
                        className="h-9 w-40 rounded-md border bg-transparent px-3 text-sm"
                      >
                        <option value="base">{picked?.satuan ?? 'Satuan dasar'}</option>
                        {picked?.productUnits
                          .filter((unit) => unit.id !== picked.baseProductUnitId)
                          .map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.satuan}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="grid gap-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        value={qty}
                        inputMode="decimal"
                        onChange={(e) => setQty(e.target.value)}
                        className="w-28 text-right"
                      />
                    </div>

                    <Button type="submit" disabled={saving}>
                      {saving ? 'Menyimpan...' : 'Simpan'}
                    </Button>
                  </form>
                )}

                {addError && (
                  <p role="alert" className="text-sm text-destructive">
                    {addError}
                  </p>
                )}
              </div>
            )}
```

Add the two imports this needs at the top of the file:

```tsx
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
```

A plain `<select>` is used rather than the shadcn `Select` component because the unit list is bound to the picked product and re-renders on every change; the native element handles that without extra state.

- [ ] **Step 3: Verify types**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 4: Check it by hand**

```bash
npm run rebuild:electron
npm run dev
```

Ring up a bon for a named customer. Open it from Riwayat. The "Tambah Item ke Bon" panel is there: add 2 of a product, save. The item table gains a row, Total and Sisa rise, and the product's stock drops in Katalog Produk. Pay the bon off in full, reload the page: the panel is gone.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/SaleDetail.tsx
git commit -m "feat(kasir): add items to a bon from the sale detail page"
```

---

### Task 12: Three-dot action menu in Riwayat

**Files:**
- Modify: `src/renderer/pages/KasirHistory.tsx` (imports, `OTHER_COLUMNS_WIDTH` at line 36, the `aksi` column at lines 208-232, and a new change-date dialog at the end of the JSX)

**Interfaces:**
- Consumes: `window.api.kasir.updateSaleDate` from Task 7, `window.api.auth.me()`, and the `/sale/:saleId` route from Task 9.
- Produces: nothing consumed by later tasks. This is the last task.

- [ ] **Step 1: Add the imports and the admin check**

At the top of `KasirHistory.tsx`:

```tsx
import { MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
```

Inside the component, next to the other state:

```tsx
  const [isAdmin, setIsAdmin] = useState(false)
  const [dateTarget, setDateTarget] = useState<SaleHistoryRow | null>(null)
  const [dateValue, setDateValue] = useState('')
  const [savingDate, setSavingDate] = useState(false)

  useEffect(() => {
    // the main process enforces requireAdmin anyway; this only hides a menu item
    // the cashier would always be refused
    window.api.auth
      .me()
      .then((user) => setIsAdmin(user?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])
```

- [ ] **Step 2: Add the change-date handlers**

```tsx
  function openDateDialog(sale: SaleHistoryRow) {
    const created = new Date(sale.createdAt)
    const pad = (n: number) => String(n).padStart(2, '0')

    setDateValue(
      `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}T${pad(created.getHours())}:${pad(created.getMinutes())}`,
    )
    setDateTarget(sale)
  }

  async function saveDate() {
    if (!dateTarget) {
      return
    }

    setSavingDate(true)
    setError(null)

    try {
      await window.api.kasir.updateSaleDate({ saleId: dateTarget.id, tanggal: dateValue })
      setDateTarget(null)
      loadPage(currentPage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah tanggal')
    } finally {
      setSavingDate(false)
    }
  }
```

- [ ] **Step 3: Replace the action column**

Replace the whole `aksi` column object at lines 208-232 with:

```tsx
    {
      key: 'aksi',
      name: '',
      width: 60,
      renderCell: ({ row }) => {
        const sisaPiutang = row.total - row.dibayar
        const bonBelumLunas = row.metodePembayaran === 'bon' && row.status === 'selesai' && sisaPiutang > 0

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`Aksi transaksi ${row.id}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/sale/${row.id}`)}>Detail</DropdownMenuItem>
              {bonBelumLunas && (
                <DropdownMenuItem onSelect={() => navigate(`/sale/${row.id}`)}>Tambah Item</DropdownMenuItem>
              )}
              {bonBelumLunas && (
                <DropdownMenuItem onSelect={() => navigate(`/bon-payment/${row.id}`)}>Bayar Bon</DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => printSale(row.id)}>Cetak Struk</DropdownMenuItem>
              {isAdmin && <DropdownMenuItem onSelect={() => openDateDialog(row)}>Ubah Tanggal</DropdownMenuItem>}
              {row.status === 'selesai' && row.dibayar === 0 && (
                <DropdownMenuItem onSelect={() => cancelSale(row)}>Batalkan</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => deleteSale(row)}>
                Hapus
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
```

Update the width constant on line 36 to match the 60px action column:

```tsx
const OTHER_COLUMNS_WIDTH = 60 + 180 + 200 + 120 + 140 + 120 + 60
```

If `DropdownMenuItem` in this codebase does not accept a `variant` prop, check `src/renderer/components/ui/dropdown-menu.tsx` and use `className="text-destructive"` instead.

- [ ] **Step 4: Render the change-date dialog**

Add next to `{ConfirmDialog}` at the bottom of the returned JSX:

```tsx
      <Dialog open={dateTarget !== null} onOpenChange={(open) => !open && setDateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Tanggal Transaksi #{dateTarget?.id}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">Tanggal &amp; Jam</Label>
              <Input type="datetime-local" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Mengubah tanggal menggeser transaksi ini di rekap dan buku kas, pada hari lama maupun hari baru.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDateTarget(null)}>
                Batal
              </Button>
              <Button disabled={savingDate} onClick={saveDate}>
                {savingDate ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Verify types**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 6: Check it by hand, as both roles**

```bash
npm run rebuild:electron
npm run dev
```

As admin: every row has a three-dot button; the menu shows Detail, Cetak Struk, Ubah Tanggal, Hapus, plus Tambah Item and Bayar Bon on an unpaid bon and Batalkan on an unpaid sale. Ubah Tanggal opens the dialog pre-filled with the sale's own date; saving moves the row and changes that day's Rekap totals. As a kasir user: Ubah Tanggal is absent from the menu.

- [ ] **Step 7: Run the whole suite and restore the Electron ABI**

```bash
npm run rebuild:node
npm test
npm run rebuild:electron
```

Expected: the full vitest suite passes, and the app still boots afterwards.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/pages/KasirHistory.tsx
git commit -m "feat(kasir): three-dot action menu and admin date editing in the history grid"
```

---

## Self-Review Notes

**Spec coverage.** Fitur 1 → Tasks 5, 6, 7, and the menu item in Task 12. Fitur 2 → Tasks 1, 2, 3, 4. Fitur 3 → Tasks 8, 9. Fitur 4 → Tasks 10, 11, 12. The two defects named in the spec are fixed in Task 9 (the "Tunai" label) and Task 4 (the scanner's Enter).

**Deliberate deviation.** `addItemsToSale` drops the spec's `userId` parameter; see the note above Task 1.

**Not covered by automated tests.** Every renderer change is verified by hand — the repo has no renderer test setup, and adding one is out of scope for this plan.
