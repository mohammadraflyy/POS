# Fase 2 Slice 1 — Kasir Checkout Inti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Laravel Kasir checkout flow (cart → tier/unit pricing → stock validation → transaction save → cancel) into `desktop-node/`, with a minimal but genuinely usable cart UI, on top of the Fase 1 skeleton (auth, IPC, Drizzle schema already in place).

**Architecture:** Pure, Electron-free business logic in `desktop-node/src/main/kasir.ts` (mirrors `auth.ts`'s pattern), wrapped by IPC handlers in `desktop-node/src/main/ipc/kasir.ts` that do all Rupiah↔cents conversion at the boundary, consumed by a new `Kasir.tsx` renderer page that replaces the Fase 1 `Home.tsx` placeholder.

**Tech Stack:** Drizzle ORM (`drizzle-orm/better-sqlite3`), Vitest, React + `react-router-dom` (already in place from Fase 1).

## Global Constraints

- New/modified code lives entirely under `desktop-node/`. Do not touch `app/`, `routes/`, `resources/`, `nativephp/`, or any other Laravel file.
- Money is stored as **integer cents** in the DB (Fase 1 decision). `desktop-node/src/main/kasir.ts` works **exclusively in cents** — no Rupiah conversion inside it. Rupiah↔cents conversion (×100 in, ÷100 out) happens only in `desktop-node/src/main/ipc/kasir.ts`.
- Date columns (`tanggal`) are `text` (`'YYYY-MM-DD'`), not touched by this plan (checkout/cancel don't write to any `tanggal` column).
- All business logic must be plain, Electron-free functions, testable via Vitest with a real in-memory SQLite DB (no mocks) — same pattern as `desktop-node/src/main/auth.ts`.
- Validation error messages must match the existing Laravel app's Indonesian messages exactly (listed per-task below) — the renderer displays them as-is.
- `better-sqlite3` in this environment is currently built for plain Node (Vitest-compatible) — do not run `npm run dev`, `npm run rebuild:electron`, or anything Electron-related during Tasks 1-4 (pure logic + IPC wiring, verified via `tsc`/Vitest only). Task 5 needs the Electron ABI for its manual verification step — see that task for the switch.

---

## Task 1: Pure resolve logic — `priceForQty` + `resolveCartItem`

**Files:**
- Create: `desktop-node/src/main/kasir.ts`
- Create: `desktop-node/src/main/kasir.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DB).
- Produces: `PriceTier` type, `priceForQty(priceTiers, hargaJualDasar, qty): number`, `ResolvedItem` type, `ProductRow`/`ProductUnitRow` types, `resolveCartItem(product, productUnit, priceTiers, qty): ResolvedItem` (throws `Error` with message `` `Stok ${product.namaItem} tidak cukup.` `` when stock is insufficient) — consumed by Task 2's `checkout`.

- [ ] **Step 1: Write the failing tests**

Create `desktop-node/src/main/kasir.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { priceForQty, resolveCartItem, type ProductRow, type ProductUnitRow } from './kasir'

describe('priceForQty', () => {
  it('falls back to the base price when there are no tiers', () => {
    expect(priceForQty([], 10000, 5)).toBe(10000)
  })

  it('applies a tier when qty meets its threshold', () => {
    expect(priceForQty([{ minQty: 10, hargaJual: 9000 }], 10000, 12)).toBe(9000)
  })

  it('picks the highest satisfied tier threshold', () => {
    const tiers = [
      { minQty: 10, hargaJual: 9500 },
      { minQty: 50, hargaJual: 9000 },
    ]
    expect(priceForQty(tiers, 10000, 60)).toBe(9000)
    expect(priceForQty(tiers, 10000, 20)).toBe(9500)
    expect(priceForQty(tiers, 10000, 5)).toBe(10000)
  })
})

describe('resolveCartItem', () => {
  const product: ProductRow = {
    id: 1,
    namaItem: 'Beras 5kg',
    satuan: 'PCS',
    hargaJual: 65000_00,
    hargaPokok: 60000_00,
    stok: 10,
  }

  it('resolves the base unit with tier pricing when no product unit is given', () => {
    const result = resolveCartItem(product, null, [{ minQty: 5, hargaJual: 62000_00 }], 5)
    expect(result).toEqual({
      productId: 1,
      productUnitId: null,
      satuan: 'PCS',
      konversi: 1,
      hargaJual: 62000_00,
      hargaPokok: 60000_00,
      qty: 5,
      qtyDasar: 5,
    })
  })

  it('resolves a product unit, overriding satuan/konversi/hargaJual', () => {
    const unit: ProductUnitRow = { id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000_00 }
    const result = resolveCartItem(product, unit, [], 2)
    expect(result).toEqual({
      productId: 1,
      productUnitId: 9,
      satuan: 'DUS',
      konversi: 12,
      hargaJual: 700000_00,
      hargaPokok: 60000_00,
      qty: 2,
      qtyDasar: 24,
    })
  })

  it('throws when base-unit stock is insufficient', () => {
    expect(() => resolveCartItem(product, null, [], 11)).toThrow('Stok Beras 5kg tidak cukup.')
  })

  it('throws when a product-unit purchase would exceed base-unit stock', () => {
    const unit: ProductUnitRow = { id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000_00 }
    expect(() => resolveCartItem(product, unit, [], 1)).toThrow('Stok Beras 5kg tidak cukup.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd desktop-node
npm run test
```

Expected: FAIL — `kasir.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `desktop-node/src/main/kasir.ts`:

```typescript
export interface PriceTier {
  minQty: number
  hargaJual: number
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  const applicable = priceTiers
    .filter((tier) => qty >= tier.minQty)
    .sort((a, b) => b.minQty - a.minQty)

  return applicable[0]?.hargaJual ?? hargaJualDasar
}

export interface ProductRow {
  id: number
  namaItem: string
  satuan: string
  hargaJual: number
  hargaPokok: number
  stok: number
}

export interface ProductUnitRow {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
}

export interface ResolvedItem {
  productId: number
  productUnitId: number | null
  satuan: string
  konversi: number
  hargaJual: number
  hargaPokok: number
  qty: number
  qtyDasar: number
}

export function resolveCartItem(
  product: ProductRow,
  productUnit: ProductUnitRow | null,
  priceTiers: PriceTier[],
  qty: number,
): ResolvedItem {
  let satuan: string
  let konversi: number
  let hargaJual: number
  let productUnitId: number | null

  if (productUnit) {
    satuan = productUnit.satuan
    konversi = productUnit.konversi
    hargaJual = productUnit.hargaJual
    productUnitId = productUnit.id
  } else {
    satuan = product.satuan
    konversi = 1
    hargaJual = priceForQty(priceTiers, product.hargaJual, qty)
    productUnitId = null
  }

  const qtyDasar = qty * konversi

  if (product.stok < qtyDasar) {
    throw new Error(`Stok ${product.namaItem} tidak cukup.`)
  }

  return {
    productId: product.id,
    productUnitId,
    satuan,
    konversi,
    hargaJual,
    hargaPokok: product.hargaPokok,
    qty,
    qtyDasar,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd desktop-node
npm run test
```

Expected: PASS — all tests in `kasir.test.ts` (plus the 4 pre-existing tests from Fase 1) green.

- [ ] **Step 5: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/main/kasir.ts desktop-node/src/main/kasir.test.ts
git commit -m "Add priceForQty and resolveCartItem pure logic"
```

---

## Task 2: `checkout` (DB transaction)

**Files:**
- Modify: `desktop-node/src/main/kasir.ts`
- Modify: `desktop-node/src/main/kasir.test.ts`

**Interfaces:**
- Consumes: `resolveCartItem`, `ResolvedItem` (Task 1); `createDb` (Fase 1's `desktop-node/src/main/db/migrate.ts`); `products`, `productUnits`, `productPriceTiers`, `sales`, `saleItems` (Fase 1's `desktop-node/src/main/db/schema.ts`).
- Produces: `CartItemInput` type, `CheckoutInput` type, `CheckoutResult` type, `checkout(db, input): CheckoutResult` — consumed by Task 4's IPC handler.

- [ ] **Step 1: Write the failing tests**

Append to `desktop-node/src/main/kasir.test.ts` (add these imports to the top alongside the existing ones, and add a new `describe` block at the end of the file):

```typescript
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { products, productUnits, productPriceTiers, sales, saleItems } from './db/schema'
import { checkout, type CheckoutInput } from './kasir'
```

```typescript
describe('checkout', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedDb() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(products)
      .values([
        {
          id: 1,
          kodeItem: 'BRS5',
          namaItem: 'Beras 5kg',
          satuan: 'PCS',
          hargaJual: 65000_00,
          hargaPokok: 60000_00,
          stok: 10,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 2,
          kodeItem: 'MIE1',
          namaItem: 'Mie Instan',
          satuan: 'PCS',
          hargaJual: 3000_00,
          hargaPokok: 2500_00,
          stok: 100,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run()

    db.insert(productUnits)
      .values({
        id: 9,
        productId: 2,
        satuan: 'DUS',
        konversi: 40,
        hargaJual: 110000_00,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(productPriceTiers)
      .values({
        id: 1,
        productId: 1,
        minQty: 5,
        hargaJual: 62000_00,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return db
  }

  it('checks out a tunai sale with base-unit tier pricing, decrements stock, snapshots sale_items', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 310000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    }

    const result = checkout(db, input)

    expect(result.total).toBe(5 * 62000_00)

    const sale = db.select().from(sales).where(eq(sales.id, result.saleId)).get()
    expect(sale?.total).toBe(5 * 62000_00)
    expect(sale?.dibayar).toBe(310000_00)
    expect(sale?.status).toBe('selesai')

    const items = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      productId: 1,
      productUnitId: null,
      qty: 5,
      konversi: 1,
      satuan: 'PCS',
      hargaJual: 62000_00,
      hargaPokok: 60000_00,
      subtotal: 5 * 62000_00,
    })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(5)
  })

  it('checks out a product-unit line, converting qty to base-unit stock', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 110000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: 9, qty: 1 }],
    }

    checkout(db, input)

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    expect(product?.stok).toBe(60) // 100 - (1 * 40)
  })

  it('creates a bon sale with dibayar = 0, no dibayar validation', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 3 }],
    }

    const result = checkout(db, input)

    const sale = db.select().from(sales).where(eq(sales.id, result.saleId)).get()
    expect(sale?.metodePembayaran).toBe('bon')
    expect(sale?.namaPelanggan).toBe('Bu Siti')
    expect(sale?.dibayar).toBe(0)
  })

  it('rolls back everything when stock is insufficient', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 999999_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 999 }],
    }

    expect(() => checkout(db, input)).toThrow('Stok Beras 5kg tidak cukup.')

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(10)
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('rolls back the whole transaction when dibayar is less than the total', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 1000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    }

    expect(() => checkout(db, input)).toThrow('Uang bayar kurang dari total belanja.')

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(10)
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('throws when a product does not exist', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 100_00,
      userId: 1,
      items: [{ productId: 999, productUnitId: null, qty: 1 }],
    }

    expect(() => checkout(db, input)).toThrow('Produk tidak ditemukan.')
  })

  it('throws when the given product unit does not belong to the product', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 100_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: 9, qty: 1 }], // unit 9 belongs to product 2
    }

    expect(() => checkout(db, input)).toThrow('Satuan tidak valid untuk Beras 5kg.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd desktop-node
npm run test
```

Expected: FAIL — `checkout` and `CheckoutInput` are not exported from `kasir.ts`.

- [ ] **Step 3: Write the implementation**

Add to `desktop-node/src/main/kasir.ts` (append; keep the existing `priceForQty`/`resolveCartItem` code above untouched):

```typescript
import { eq, inArray, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems } from './db/schema'

export interface CartItemInput {
  productId: number
  productUnitId: number | null
  qty: number
}

export interface CheckoutInput {
  metodePembayaran: 'tunai' | 'bon'
  namaPelanggan: string | null
  dibayar: number | null
  userId: number
  items: CartItemInput[]
}

export interface CheckoutResult {
  saleId: number
  total: number
}

export function checkout(db: BetterSQLite3Database<typeof schema>, input: CheckoutInput): CheckoutResult {
  const productIds = input.items.map((item) => item.productId)
  const productRows = db.select().from(products).where(inArray(products.id, productIds)).all()
  const productsById = new Map(productRows.map((product) => [product.id, product]))

  const unitRows = db.select().from(productUnits).where(inArray(productUnits.productId, productIds)).all()
  const tierRows = db
    .select()
    .from(productPriceTiers)
    .where(inArray(productPriceTiers.productId, productIds))
    .all()

  const resolvedItems: ResolvedItem[] = []

  for (const item of input.items) {
    const product = productsById.get(item.productId)

    if (!product) {
      throw new Error('Produk tidak ditemukan.')
    }

    let unit: ProductUnitRow | null = null
    if (item.productUnitId) {
      const found = unitRows.find((row) => row.id === item.productUnitId && row.productId === product.id)
      if (!found) {
        throw new Error(`Satuan tidak valid untuk ${product.namaItem}.`)
      }
      unit = { id: found.id, satuan: found.satuan, konversi: found.konversi, hargaJual: found.hargaJual }
    }

    const tiers: PriceTier[] = tierRows
      .filter((row) => row.productId === product.id)
      .map((row) => ({ minQty: row.minQty, hargaJual: row.hargaJual }))

    resolvedItems.push(resolveCartItem(product, unit, tiers, item.qty))
  }

  return db.transaction((tx) => {
    const now = new Date()
    const dibayarAwal = input.metodePembayaran === 'tunai' ? (input.dibayar ?? 0) : 0

    const [sale] = tx
      .insert(sales)
      .values({
        userId: input.userId,
        namaPelanggan: input.namaPelanggan,
        metodePembayaran: input.metodePembayaran,
        status: 'selesai',
        total: 0,
        dibayar: dibayarAwal,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    let total = 0

    for (const line of resolvedItems) {
      const subtotal = line.qty * line.hargaJual
      total += subtotal

      tx.insert(saleItems)
        .values({
          saleId: sale.id,
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
          konversi: line.konversi,
          satuan: line.satuan,
          hargaJual: line.hargaJual,
          hargaPokok: line.hargaPokok,
          subtotal,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`${products.stok} - ${line.qtyDasar}` })
        .where(eq(products.id, line.productId))
        .run()
    }

    tx.update(sales).set({ total }).where(eq(sales.id, sale.id)).run()

    if (input.metodePembayaran === 'tunai' && dibayarAwal < total) {
      throw new Error('Uang bayar kurang dari total belanja.')
    }

    return { saleId: sale.id, total }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd desktop-node
npm run test
```

Expected: PASS — all `checkout` tests plus everything from Task 1 and Fase 1.

- [ ] **Step 5: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/main/kasir.ts desktop-node/src/main/kasir.test.ts
git commit -m "Add checkout transaction logic"
```

---

## Task 3: `cancelSale`

**Files:**
- Modify: `desktop-node/src/main/kasir.ts`
- Modify: `desktop-node/src/main/kasir.test.ts`

**Interfaces:**
- Consumes: `createDb` (Fase 1); `sales`, `saleItems`, `products`, `bonPayments` (Fase 1 schema).
- Produces: `cancelSale(db, saleId): void` — consumed by Task 4's IPC handler.

- [ ] **Step 1: Write the failing tests**

Add this import to the top of `desktop-node/src/main/kasir.test.ts`:

```typescript
import { bonPayments } from './db/schema'
import { cancelSale } from './kasir'
```

Append this `describe` block at the end of `desktop-node/src/main/kasir.test.ts`:

```typescript
describe('cancelSale', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedDbWithOneSale() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        satuan: 'PCS',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 5,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 400000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    })

    return { db, saleId: result.saleId }
  }

  it('restores stock and marks the sale as dibatalkan', () => {
    const { db, saleId } = seedDbWithOneSale()

    cancelSale(db, saleId)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(5)

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.status).toBe('dibatalkan')
  })

  it('throws when the sale is already cancelled', () => {
    const { db, saleId } = seedDbWithOneSale()
    cancelSale(db, saleId)

    expect(() => cancelSale(db, saleId)).toThrow('Transaksi sudah dibatalkan.')
  })

  it('throws when the sale has bon payments recorded', () => {
    const { db, saleId } = seedDbWithOneSale()
    const now = new Date()

    db.insert(bonPayments)
      .values({ saleId, jumlah: 10000_00, tanggal: '2026-08-06', createdAt: now, updatedAt: now })
      .run()

    expect(() => cancelSale(db, saleId)).toThrow('Tidak bisa membatalkan, bon sudah ada pembayaran.')
  })

  it('throws when the sale does not exist', () => {
    const { db } = seedDbWithOneSale()
    expect(() => cancelSale(db, 999)).toThrow('Transaksi tidak ditemukan.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd desktop-node
npm run test
```

Expected: FAIL — `cancelSale` is not exported from `kasir.ts`.

- [ ] **Step 3: Write the implementation**

Add to `desktop-node/src/main/kasir.ts` (append; add `bonPayments` to the existing schema import list from `./db/schema`):

```typescript
export function cancelSale(db: BetterSQLite3Database<typeof schema>, saleId: number): void {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  if (sale.status === 'dibatalkan') {
    throw new Error('Transaksi sudah dibatalkan.')
  }

  const hasBonPayment = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).get()

  if (hasBonPayment) {
    throw new Error('Tidak bisa membatalkan, bon sudah ada pembayaran.')
  }

  const items = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()

  db.transaction((tx) => {
    for (const item of items) {
      tx.update(products)
        .set({ stok: sql`${products.stok} + ${item.qty * item.konversi}` })
        .where(eq(products.id, item.productId))
        .run()
    }

    tx.update(sales).set({ status: 'dibatalkan' }).where(eq(sales.id, saleId)).run()
  })
}
```

Remember to add `bonPayments` to the `import { products, productUnits, productPriceTiers, sales, saleItems } from './db/schema'` line at the top of `kasir.ts` (from Task 2) so it reads `import { products, productUnits, productPriceTiers, sales, saleItems, bonPayments } from './db/schema'`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd desktop-node
npm run test
```

Expected: PASS — all tests in `kasir.test.ts` (Tasks 1-3) plus Fase 1's 4 tests, all green.

- [ ] **Step 5: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/main/kasir.ts desktop-node/src/main/kasir.test.ts
git commit -m "Add cancelSale logic"
```

---

## Task 4: IPC handlers + preload bridge

**Files:**
- Create: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/main/ipc/auth.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/main/index.ts`

**Interfaces:**
- Consumes: `checkout`, `cancelSale` (Task 2, 3); `getCurrentUser` (this task, added to `ipc/auth.ts`); `products`, `productUnits`, `sales`, `saleItems` (Fase 1 schema).
- Produces: IPC channels `kasir:listProducts`, `kasir:listSalesToday`, `kasir:checkout`, `kasir:cancelSale`; `registerKasirIpc(db)`; `window.api.kasir.{listProducts,listSalesToday,checkout,cancelSale}` — consumed by Task 5's renderer page. All money values crossing this boundary are **Rupiah** (not cents) — `listProducts`/`listSalesToday` return Rupiah, `checkout` accepts and returns Rupiah.

- [ ] **Step 1: Export `getCurrentUser` from the auth IPC module**

`desktop-node/src/main/ipc/auth.ts` currently reads:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { verifyLogin, type AuthUser } from '../auth'

let currentUser: AuthUser | null = null

export function registerAuthIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('auth:login', (_event, username: string, password: string) => {
    currentUser = verifyLogin(db, username, password)
    return currentUser
  })

  ipcMain.handle('auth:logout', () => {
    currentUser = null
  })

  ipcMain.handle('auth:me', () => {
    return currentUser
  })
}
```

Add one export right after the `registerAuthIpc` function (keep everything else in the file unchanged):

```typescript
export function getCurrentUser(): AuthUser | null {
  return currentUser
}
```

- [ ] **Step 2: Write the IPC handlers**

Create `desktop-node/src/main/ipc/kasir.ts`:

```typescript
import { ipcMain } from 'electron'
import { eq, gte } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { products, productUnits, sales, saleItems } from '../db/schema'
import { checkout, cancelSale, type CheckoutInput } from '../kasir'
import { getCurrentUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}

interface CheckoutRendererInput {
  metodePembayaran: 'tunai' | 'bon'
  namaPelanggan: string | null
  dibayar: number | null
  items: { productId: number; productUnitId: number | null; qty: number }[]
}

export function registerKasirIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('kasir:listProducts', () => {
    const productRows = db.select().from(products).where(eq(products.isActive, true)).all()
    const unitRows = db.select().from(productUnits).all()

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
    }))
  })

  ipcMain.handle('kasir:listSalesToday', () => {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const saleRows = db.select().from(sales).where(gte(sales.createdAt, startOfDay)).all()
    const itemRows = db.select().from(saleItems).all()

    return saleRows
      .map((sale) => ({
        id: sale.id,
        namaPelanggan: sale.namaPelanggan,
        metodePembayaran: sale.metodePembayaran,
        status: sale.status,
        total: toRupiah(sale.total),
        dibayar: toRupiah(sale.dibayar),
        items: itemRows
          .filter((item) => item.saleId === sale.id)
          .map((item) => ({
            productId: item.productId,
            qty: item.qty,
            satuan: item.satuan,
            hargaJual: toRupiah(item.hargaJual),
            subtotal: toRupiah(item.subtotal),
          })),
      }))
      .sort((a, b) => b.id - a.id)
  })

  ipcMain.handle('kasir:checkout', (_event, input: CheckoutRendererInput) => {
    const user = getCurrentUser()
    if (!user) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const checkoutInput: CheckoutInput = {
      metodePembayaran: input.metodePembayaran,
      namaPelanggan: input.namaPelanggan,
      dibayar: input.dibayar === null ? null : toCents(input.dibayar),
      userId: user.id,
      items: input.items,
    }

    const result = checkout(db, checkoutInput)
    return { saleId: result.saleId, total: toRupiah(result.total) }
  })

  ipcMain.handle('kasir:cancelSale', (_event, saleId: number) => {
    const user = getCurrentUser()
    if (!user) {
      throw new Error('Silakan login terlebih dahulu.')
    }
    cancelSale(db, saleId)
  })
}
```

- [ ] **Step 3: Expose the new channels in preload**

`desktop-node/src/preload/index.ts` currently reads:

```typescript
import { contextBridge, ipcRenderer } from 'electron'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((err: Error) => {
    throw new Error(err.message.replace(/^Error invoking remote method '[^']*': \w*Error: /, ''))
  })
}

const api = {
  auth: {
    login: (username: string, password: string) =>
      invoke('auth:login', username, password),
    logout: () => invoke('auth:logout'),
    me: () => invoke('auth:me'),
  },
}

contextBridge.exposeInMainWorld('api', api)
```

Add a `kasir` key to the `api` object (keep the existing `invoke` helper and `auth` key untouched):

```typescript
const api = {
  auth: {
    login: (username: string, password: string) =>
      invoke('auth:login', username, password),
    logout: () => invoke('auth:logout'),
    me: () => invoke('auth:me'),
  },
  kasir: {
    listProducts: () => invoke('kasir:listProducts'),
    listSalesToday: () => invoke('kasir:listSalesToday'),
    checkout: (input: {
      metodePembayaran: 'tunai' | 'bon'
      namaPelanggan: string | null
      dibayar: number | null
      items: { productId: number; productUnitId: number | null; qty: number }[]
    }) => invoke('kasir:checkout', input),
    cancelSale: (saleId: number) => invoke('kasir:cancelSale', saleId),
  },
}
```

- [ ] **Step 4: Register the new IPC handlers in the main process**

`desktop-node/src/main/index.ts` currently has, inside `app.whenReady().then(() => { ... })`:

```typescript
app.whenReady().then(() => {
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  createWindow()
})
```

Add the import `import { registerKasirIpc } from './ipc/kasir'` near the top (alongside the existing `import { registerAuthIpc } from './ipc/auth'`), and add `registerKasirIpc(db)` right after `registerAuthIpc(db)`:

```typescript
app.whenReady().then(() => {
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  registerKasirIpc(db)
  createWindow()
})
```

- [ ] **Step 5: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.node.json
```

Expected: no type errors.

- [ ] **Step 6: Run the full test suite once more**

```bash
cd desktop-node
npm run test
```

Expected: PASS — nothing in this task touches test files, so this just confirms nothing broke.

- [ ] **Step 7: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/main/ipc/kasir.ts desktop-node/src/main/ipc/auth.ts desktop-node/src/preload/index.ts desktop-node/src/main/index.ts
git commit -m "Add Kasir IPC handlers and preload bridge"
```

---

## Task 5: Renderer Kasir page, replacing the Home placeholder

**Files:**
- Create: `desktop-node/src/renderer/pages/Kasir.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Delete: `desktop-node/src/renderer/pages/Home.tsx`

**Interfaces:**
- Consumes: `window.api.auth.{me,logout}` (Fase 1), `window.api.kasir.{listProducts,listSalesToday,checkout,cancelSale}` (Task 4), `AuthUser` type (`desktop-node/src/renderer/types.ts`, Fase 1).
- Produces: a working Kasir page reachable at `/` after login.

- [ ] **Step 1: Write the Kasir page**

Create `desktop-node/src/renderer/pages/Kasir.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AuthUser } from '../types'

interface ProductUnitDto {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
}

interface ProductDto {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaJual: number
  stok: number
  productUnits: ProductUnitDto[]
}

interface CartLine {
  productId: number
  productUnitId: number | null
  qty: number
}

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
  const [products, setProducts] = useState<ProductDto[]>([])
  const [salesToday, setSalesToday] = useState<SaleDto[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [metodePembayaran, setMetodePembayaran] = useState<'tunai' | 'bon'>('tunai')
  const [namaPelanggan, setNamaPelanggan] = useState('')
  const [dibayar, setDibayar] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.auth.me().then((result) => {
      if (!result) {
        navigate('/login')
        return
      }
      setUser(result)
    })
  }, [navigate])

  useEffect(() => {
    if (!user) {
      return
    }
    refreshProducts()
    refreshSalesToday()
  }, [user])

  function refreshProducts() {
    window.api.kasir.listProducts().then(setProducts)
  }

  function refreshSalesToday() {
    window.api.kasir.listSalesToday().then(setSalesToday)
  }

  function addToCart(productId: number) {
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === productId && line.productUnitId === null)
      if (existing) {
        return prev.map((line) => (line === existing ? { ...line, qty: line.qty + 1 } : line))
      }
      return [...prev, { productId, productUnitId: null, qty: 1 }]
    })
  }

  function updateQty(index: number, qty: number) {
    setCart((prev) => prev.map((line, i) => (i === index ? { ...line, qty } : line)))
  }

  function updateUnit(index: number, productUnitId: number | null) {
    setCart((prev) => prev.map((line, i) => (i === index ? { ...line, productUnitId } : line)))
  }

  function removeLine(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index))
  }

  function lineProduct(line: CartLine): ProductDto | undefined {
    return products.find((p) => p.id === line.productId)
  }

  function lineHargaJual(line: CartLine): number {
    const product = lineProduct(line)
    if (!product) {
      return 0
    }
    if (line.productUnitId) {
      return product.productUnits.find((unit) => unit.id === line.productUnitId)?.hargaJual ?? 0
    }
    return product.hargaJual
  }

  const total = cart.reduce((sum, line) => sum + line.qty * lineHargaJual(line), 0)
  const dibayarNumber = Number(dibayar) || 0
  const kembalian = Math.max(dibayarNumber - total, 0)

  async function handleCheckout() {
    setError(null)
    setMessage(null)
    try {
      await window.api.kasir.checkout({
        metodePembayaran,
        namaPelanggan: metodePembayaran === 'bon' ? namaPelanggan : null,
        dibayar: metodePembayaran === 'tunai' ? dibayarNumber : null,
        items: cart.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
        })),
      })
      setMessage('Transaksi disimpan.')
      setCart([])
      setNamaPelanggan('')
      setDibayar('')
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal checkout')
    }
  }

  async function handleCancel(saleId: number) {
    setError(null)
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

  const filteredProducts = products.filter(
    (product) =>
      product.namaItem.toLowerCase().includes(search.toLowerCase()) ||
      product.kodeItem.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <h1>Kasir</h1>
      <p>
        {user.name}{' '}
        <button
          onClick={async () => {
            await window.api.auth.logout()
            navigate('/login')
          }}
        >
          Keluar
        </button>
      </p>

      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}

      <section>
        <h2>Produk</h2>
        <input placeholder="Cari produk..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <table>
          <tbody>
            {filteredProducts.map((product) => (
              <tr key={product.id}>
                <td>{product.namaItem}</td>
                <td>{product.satuan}</td>
                <td>Rp{product.hargaJual.toLocaleString('id-ID')}</td>
                <td>Stok: {product.stok}</td>
                <td>
                  <button onClick={() => addToCart(product.id)}>Tambah</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Cart</h2>
        <table>
          <tbody>
            {cart.map((line, index) => {
              const product = lineProduct(line)
              if (!product) {
                return null
              }
              return (
                <tr key={index}>
                  <td>{product.namaItem}</td>
                  <td>
                    {product.productUnits.length > 0 ? (
                      <select
                        value={line.productUnitId ?? ''}
                        onChange={(e) => updateUnit(index, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">{product.satuan}</option>
                        {product.productUnits.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.satuan}
                          </option>
                        ))}
                      </select>
                    ) : (
                      product.satuan
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={line.qty}
                      onChange={(e) => updateQty(index, Number(e.target.value))}
                    />
                  </td>
                  <td>Rp{(line.qty * lineHargaJual(line)).toLocaleString('id-ID')}</td>
                  <td>
                    <button onClick={() => removeLine(index)}>Hapus</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p>Total: Rp{total.toLocaleString('id-ID')}</p>

        <div>
          <label>
            <input
              type="radio"
              checked={metodePembayaran === 'tunai'}
              onChange={() => setMetodePembayaran('tunai')}
            />
            Tunai
          </label>
          <label>
            <input type="radio" checked={metodePembayaran === 'bon'} onChange={() => setMetodePembayaran('bon')} />
            Bon
          </label>
        </div>

        {metodePembayaran === 'tunai' ? (
          <div>
            <label>
              Dibayar
              <input type="number" min={0} value={dibayar} onChange={(e) => setDibayar(e.target.value)} />
            </label>
            <p>Kembalian: Rp{kembalian.toLocaleString('id-ID')}</p>
          </div>
        ) : (
          <label>
            Nama Pelanggan
            <input value={namaPelanggan} onChange={(e) => setNamaPelanggan(e.target.value)} />
          </label>
        )}

        <button onClick={handleCheckout} disabled={cart.length === 0}>
          Checkout
        </button>
      </section>

      <section>
        <h2>Transaksi Hari Ini</h2>
        <table>
          <tbody>
            {salesToday.map((sale) => (
              <tr key={sale.id}>
                <td>#{sale.id}</td>
                <td>{sale.metodePembayaran}</td>
                <td>{sale.status}</td>
                <td>Rp{sale.total.toLocaleString('id-ID')}</td>
                <td>{sale.status === 'selesai' && <button onClick={() => handleCancel(sale.id)}>Batal</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the router, remove Home**

Replace the contents of `desktop-node/src/renderer/App.tsx`:

```typescript
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Login } from './pages/Login'
import { Kasir } from './pages/Kasir'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Kasir />} />
      </Routes>
    </HashRouter>
  )
}

export default App
```

Delete `desktop-node/src/renderer/pages/Home.tsx` (its "prove the stack works" role is now filled by the real Kasir page).

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

Expected: PASS — all tests from Fase 1 and Tasks 1-3 of this plan, unaffected by renderer-only changes.

- [ ] **Step 5: Seed a dev product and switch to the Electron ABI**

The dev DB currently only has the `admin` user (from Fase 1). Add one product for manual testing — from `desktop-node/`, run:

```bash
node --experimental-strip-types -e "
const path = require('node:path');
const { createDb } = require('./src/main/db/migrate.ts');
const { products } = require('./src/main/db/schema.ts');
const db = createDb(path.resolve('dev.sqlite'), path.resolve('drizzle'));
const now = new Date();
db.insert(products).values({
  kodeItem: 'BRS5', namaItem: 'Beras 5kg', satuan: 'PCS',
  hargaJual: 65000_00, hargaPokok: 60000_00, stok: 20,
  createdAt: now, updatedAt: now,
}).run();
console.log('Seeded 1 dev product');
"
```

If `--experimental-strip-types` isn't available in the installed Node version, use `npx tsx -e "<same script body>"` instead — `tsx` is already a devDependency from Fase 1.

Then switch the native module to the Electron ABI (see the plan's Global Constraints and `docs/superpowers/plans/2026-08-06-desktop-node-fase1-skeleton.md`'s "Environment Notes" for why this matters):

```bash
npm run rebuild:electron
```

- [ ] **Step 6: Manual end-to-end verification**

```bash
npm run dev
```

Log in as `admin`/`password`, then verify:
1. The Kasir page loads with "Beras 5kg" visible in the product list.
2. Click "Tambah" to add it to the cart, confirm it appears with qty 1 and the correct subtotal.
3. Select "Tunai", enter a `dibayar` amount greater than the total, confirm "Kembalian" updates live.
4. Click "Checkout" — confirm a success message appears, the cart clears, and the new sale appears under "Transaksi Hari Ini" with the correct total.
5. Click "Batal" on that sale — confirm it disappears from the actionable list (status changes) and the product's stock in the product list goes back up.
6. Try checkout with `dibayar` less than the total — confirm the exact error message "Uang bayar kurang dari total belanja." is shown and no sale is created.

If this sandbox has no display, use the same CDP-driven approach from Fase 1 Task 7 (Node's built-in `WebSocket`, `--remote-debugging-port`, `Runtime.evaluate`) to drive and verify these steps without a visible window, and say explicitly what you verified this way.

After verification, switch back to the plain-Node ABI so tests keep working for whoever picks up the next slice:

```bash
npm rebuild better-sqlite3
```

(or `npm run rebuild:node`, added in Fase 1's final cleanup).

- [ ] **Step 7: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/pages/Kasir.tsx desktop-node/src/renderer/App.tsx
git rm desktop-node/src/renderer/pages/Home.tsx
git commit -m "Add Kasir page, replacing the Fase 1 Home placeholder"
```

---

## Self-Review Notes

- **Spec coverage:** `priceForQty` tier resolution ✅ (Task 1), `resolveCartItem` base/unit pricing + stock check ✅ (Task 1), `checkout` transaction (tunai/bon, tier/unit pricing, stock decrement, snapshot, dibayar validation + rollback, product/unit-not-found errors) ✅ (Task 2), `cancelSale` (stock restore, already-cancelled guard, bon-payment guard) ✅ (Task 3), IPC + Rupiah/cents boundary conversion ✅ (Task 4), minimal usable cart UI + today's sales + cancel button ✅ (Task 5). Print, scan, History page, bon payment UI are explicitly out of scope per the spec and not included here.
- **No placeholders:** every step has complete, runnable code or exact commands.
- **Type consistency:** `CartItemInput`/`CheckoutInput`/`CheckoutResult` (Task 2) match exactly between `kasir.ts`'s `checkout` and `ipc/kasir.ts`'s handler (which constructs a `CheckoutInput` from its own `CheckoutRendererInput`). `ResolvedItem`/`ProductRow`/`ProductUnitRow`/`PriceTier` (Task 1) are reused unchanged by `checkout` (Task 2). The renderer's `ProductDto`/`SaleDto`/`CartLine` shapes (Task 5) match exactly what `ipc/kasir.ts`'s `listProducts`/`listSalesToday`/`checkout` return (Task 4).
