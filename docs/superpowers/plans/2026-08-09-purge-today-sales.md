# Hapus Transaksi Hari Ini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "delete all of today's transactions" action to Settings' Zona Berbahaya section, restoring stock and skipping (not blocking on) Bon sales that already have payments recorded.

**Architecture:** A new `purgeTodaySales` function in `main/kasir.ts` finds today's sales (local calendar day), skips any with existing Bon payments, restores stock for the rest (reusing a stock-restore helper extracted from the existing `cancelSale`), and deletes them in one transaction. A new `kasir:purgeTodaySales` IPC handler wraps it, mirroring the existing `kasir:purgeSalesBefore` handler. The renderer gets one new component in Settings, `PurgeToday`, sibling to the existing `PurgeHistory`.

**Tech Stack:** Electron + React (renderer), better-sqlite3 + Drizzle ORM (main process), Vitest, TypeScript.

## Global Constraints

- "Today" means the local calendar day on `sales.createdAt` — start/end of day via `setHours(0,0,0,0)`/`setHours(23,59,59,999)`, matching the convention already used by `purgeSalesBefore`'s `endOfToday` and `rekap.ts`'s day-bucketing.
- Stock is restored for deleted sales unless the sale was already `dibatalkan` (which already had its stock restored by `cancelSale`) — never restore twice.
- A sale with existing `bonPayments` rows is skipped, not deleted, and does not block the rest of the batch.
- The whole delete runs inside one `db.transaction`.
- IPC handler stays guarded by `getCurrentUser()`, matching every existing handler in `ipc/kasir.ts`.
- Spec: `docs/superpowers/specs/2026-08-09-purge-today-sales-design.md`.

---

### Task 1: Backend — `main/kasir.ts` (TDD)

**Files:**
- Modify: `desktop-node/src/main/kasir.ts`
- Test: `desktop-node/src/main/kasir.test.ts`

**Interfaces:**
- Produces: `purgeTodaySales(db): { deleted: number; skipped: number }`. This name/signature is what Task 2 (IPC) imports.

- [ ] **Step 1: Add the new tests**

In `desktop-node/src/main/kasir.test.ts`, add this new `describe` block anywhere after the existing `describe('purgeSalesBefore', ...)` block (or anywhere at the top level — placement doesn't matter):

```typescript
describe('purgeTodaySales', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedProductAndUser(db: ReturnType<typeof createDb>) {
    const now = new Date()

    db.insert(users)
      .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        satuan: 'PCS',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 100,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  function seedTodayAndYesterday() {
    const db = createDb(':memory:', migrationsFolder)
    seedProductAndUser(db)

    const todaySale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00 * 5,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    })

    const yesterdaySale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00 * 2,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 2 }],
    })
    db.update(sales).set({ createdAt: new Date('2020-01-01T10:00:00') }).where(eq(sales.id, yesterdaySale.saleId)).run()

    return { db, todaySaleId: todaySale.saleId, yesterdaySaleId: yesterdaySale.saleId }
  }

  it('deletes only sales created today, returns the count deleted, leaves older sales untouched', () => {
    const { db, todaySaleId, yesterdaySaleId } = seedTodayAndYesterday()

    const result = purgeTodaySales(db)

    expect(result).toEqual({ deleted: 1, skipped: 0 })
    expect(db.select().from(sales).where(eq(sales.id, todaySaleId)).get()).toBeUndefined()
    expect(db.select().from(sales).where(eq(sales.id, yesterdaySaleId)).get()).toBeDefined()
  })

  it('restores stock for deleted sales, leaves stock for untouched older sales alone', () => {
    const { db } = seedTodayAndYesterday()

    purgeTodaySales(db)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    // 100 - 5 (today) - 2 (yesterday) = 93, then +5 restored for today's deleted sale = 98
    expect(product?.stok).toBe(98)
  })

  it('cascades to sale_items for deleted sales', () => {
    const { db, todaySaleId } = seedTodayAndYesterday()

    purgeTodaySales(db)

    expect(db.select().from(saleItems).where(eq(saleItems.saleId, todaySaleId)).all()).toHaveLength(0)
  })

  it('does not double-restore stock for an already-dibatalkan sale', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedProductAndUser(db)

    const sale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00 * 5,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    })

    cancelSale(db, sale.saleId) // stok: 100 - 5 + 5 = 100

    const result = purgeTodaySales(db)

    expect(result).toEqual({ deleted: 1, skipped: 0 })
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(100) // not 105 - no double restore
  })

  it('skips a bon sale with existing payments, leaves it in the database, still deletes the rest', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedProductAndUser(db)
    const now = new Date()

    const bonSale = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 3 }],
    })

    db.insert(bonPayments)
      .values({ saleId: bonSale.saleId, jumlah: 10000_00, tanggal: '2026-01-01', createdAt: now, updatedAt: now })
      .run()

    const otherSale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    const result = purgeTodaySales(db)

    expect(result).toEqual({ deleted: 1, skipped: 1 })
    expect(db.select().from(sales).where(eq(sales.id, bonSale.saleId)).get()).toBeDefined()
    expect(db.select().from(sales).where(eq(sales.id, otherSale.saleId)).get()).toBeUndefined()
  })

  it('returns zero deleted and skipped when there are no sales today', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedProductAndUser(db)

    const result = purgeTodaySales(db)

    expect(result).toEqual({ deleted: 0, skipped: 0 })
  })
})
```

Update the top import blocks to include the new function under test. Change:

```typescript
import { checkout, type CheckoutInput, cancelSale, recordBonPayment, updateStoreSettings, purgeSalesBefore } from './kasir'
```

to:

```typescript
import { checkout, type CheckoutInput, cancelSale, recordBonPayment, updateStoreSettings, purgeSalesBefore, purgeTodaySales } from './kasir'
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd desktop-node
npx vitest run src/main/kasir.test.ts
```

Expected: FAIL — `purgeTodaySales` is not exported from `./kasir` yet.

- [ ] **Step 3: Implement in `kasir.ts`**

Update the top import line:

```typescript
import { eq, inArray, lt, sql } from 'drizzle-orm'
```

becomes:

```typescript
import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
```

Replace the existing `cancelSale` function (from `export function cancelSale(` through its closing `}`) with:

```typescript
type Db = BetterSQLite3Database<typeof schema>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

function restoreStockForItems(tx: Tx, items: { productId: number; qty: number; konversi: number }[]): void {
  for (const item of items) {
    tx.update(products)
      .set({ stok: sql`${products.stok} + ${item.qty * item.konversi}` })
      .where(eq(products.id, item.productId))
      .run()
  }
}

export function cancelSale(db: Db, saleId: number): void {
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
    restoreStockForItems(tx, items)
    tx.update(sales).set({ status: 'dibatalkan' }).where(eq(sales.id, saleId)).run()
  })
}

export function purgeTodaySales(db: Db): { deleted: number; skipped: number } {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const todaySales = db
    .select()
    .from(sales)
    .where(and(gte(sales.createdAt, startOfToday), lte(sales.createdAt, endOfToday)))
    .all()

  let deleted = 0
  let skipped = 0

  db.transaction((tx) => {
    for (const sale of todaySales) {
      const hasBonPayment = tx.select().from(bonPayments).where(eq(bonPayments.saleId, sale.id)).get()

      if (hasBonPayment) {
        skipped++
        continue
      }

      if (sale.status !== 'dibatalkan') {
        const items = tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).all()
        restoreStockForItems(tx, items)
      }

      tx.delete(sales).where(eq(sales.id, sale.id)).run()
      deleted++
    }
  })

  return { deleted, skipped }
}
```

This extracts `cancelSale`'s previously-inline stock-restore loop into `restoreStockForItems`, reused by both functions. `cancelSale`'s public behavior is unchanged — same checks, same order, same error messages. Only its parameter type changes from the inline `BetterSQLite3Database<typeof schema>` to the new local `Db` alias (identical type, just named — matches the `Db`/`Tx` alias pattern already used in `main/inventory-bulk.ts`).

Do not change any other function in this file (`checkout`, `recordBonPayment`, `updateStoreSettings`, `purgeSalesBefore`, etc.) — leave their signatures exactly as they are.

- [ ] **Step 4: Run the tests to see them pass**

```bash
npx vitest run src/main/kasir.test.ts
```

Expected: PASS, all tests green — including every pre-existing `cancelSale` test (they must still pass unchanged, proving the extraction didn't alter behavior).

- [ ] **Step 5: Commit**

```bash
git add desktop-node/src/main/kasir.ts desktop-node/src/main/kasir.test.ts
git commit -m "feat: add purgeTodaySales, extract shared stock-restore helper from cancelSale"
```

---

### Task 2: IPC — `main/ipc/kasir.ts`

**Files:**
- Modify: `desktop-node/src/main/ipc/kasir.ts`

**Interfaces:**
- Consumes: `purgeTodaySales` from Task 1.
- Produces: `kasir:purgeTodaySales` channel returning `Promise<{ deleted: number; skipped: number }>` — consumed by Task 3 (preload).

- [ ] **Step 1: Update the import line**

Replace:

```typescript
import { checkout, cancelSale, recordBonPayment, updateStoreSettings, purgeSalesBefore, type CheckoutInput } from '../kasir'
```

with:

```typescript
import { checkout, cancelSale, recordBonPayment, updateStoreSettings, purgeSalesBefore, purgeTodaySales, type CheckoutInput } from '../kasir'
```

- [ ] **Step 2: Add the new handler**

Add this immediately after the existing `kasir:purgeSalesBefore` handler:

```typescript
  ipcMain.handle('kasir:purgeSalesBefore', (_event, before: string) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const deleted = purgeSalesBefore(db, new Date(`${before}T00:00:00`))
    return { deleted }
  })

  ipcMain.handle('kasir:purgeTodaySales', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return purgeTodaySales(db)
  })
}
```

(The existing `kasir:purgeSalesBefore` handler shown above is unchanged context — only the new `kasir:purgeTodaySales` handler and the closing `}` after it are new.)

- [ ] **Step 3: Typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: errors in `preload/index.ts`, `env.d.ts`, `Settings.tsx` (not yet updated — Tasks 3-4). No errors should point at `main/ipc/kasir.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add desktop-node/src/main/ipc/kasir.ts
git commit -m "feat: expose kasir:purgeTodaySales IPC channel"
```

---

### Task 3: Preload + renderer ambient types

**Files:**
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `kasir:purgeTodaySales` channel from Task 2.
- Produces: `window.api.kasir.purgeTodaySales(): Promise<{ deleted: number; skipped: number }>` — consumed by Task 4 (`Settings.tsx`).

- [ ] **Step 1: Update `preload/index.ts`**

Replace:

```typescript
    purgeSalesBefore: (before: string) => invoke('kasir:purgeSalesBefore', before),
```

with:

```typescript
    purgeSalesBefore: (before: string) => invoke('kasir:purgeSalesBefore', before),
    purgeTodaySales: () => invoke('kasir:purgeTodaySales'),
```

- [ ] **Step 2: Update `env.d.ts`**

Replace:

```typescript
        purgeSalesBefore: (before: string) => Promise<{ deleted: number }>
```

with:

```typescript
        purgeSalesBefore: (before: string) => Promise<{ deleted: number }>
        purgeTodaySales: () => Promise<{ deleted: number; skipped: number }>
```

- [ ] **Step 3: Commit**

```bash
git add desktop-node/src/preload/index.ts desktop-node/src/renderer/env.d.ts
git commit -m "feat: update preload/env types for purgeTodaySales"
```

---

### Task 4: Renderer UI — `pages/Settings.tsx`

**Files:**
- Modify: `desktop-node/src/renderer/pages/Settings.tsx`

**Interfaces:**
- Consumes: `window.api.kasir.purgeTodaySales` from Task 3.

- [ ] **Step 1: Add the `PurgeToday` component**

Add this new function immediately before the existing `function PurgeHistory() {` definition:

```typescript
function PurgeToday() {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  async function purge() {
    const ok = await confirm({
      title: 'Hapus Transaksi Hari Ini',
      description:
        'Semua transaksi hari ini akan dihapus permanen dan stok yang terjual dikembalikan. Transaksi Bon yang sudah ada pembayarannya akan dilewati. Tindakan ini tidak bisa dibatalkan.',
      confirmLabel: 'Hapus Permanen',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setProcessing(true)
    setError(null)
    setMessage(null)

    try {
      const result = await window.api.kasir.purgeTodaySales()
      setMessage(
        result.skipped > 0
          ? `${result.deleted} transaksi dihapus, ${result.skipped} dilewati (sudah ada pembayaran bon).`
          : `${result.deleted} transaksi dihapus.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus transaksi')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/50 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Hapus Transaksi Hari Ini</p>
        <p className="text-sm text-muted-foreground">
          Hapus permanen semua transaksi hari ini dan kembalikan stoknya - cocok buat bersihkan transaksi tes atau salah
          input. Transaksi Bon yang sudah dibayar sebagian dilewati.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <Button type="button" variant="destructive" disabled={processing} onClick={purge}>
        Hapus Transaksi Hari Ini
      </Button>
      {ConfirmDialog}
    </div>
  )
}
```

- [ ] **Step 2: Add it to the Zona Berbahaya section**

Replace:

```typescript
        <div className="space-y-6">
          <Heading variant="small" title="Zona Berbahaya" description="Tindakan permanen yang tidak bisa dibatalkan" />
          <PurgeHistory />
        </div>
```

with:

```typescript
        <div className="space-y-6">
          <Heading variant="small" title="Zona Berbahaya" description="Tindakan permanen yang tidak bisa dibatalkan" />
          <PurgeToday />
          <PurgeHistory />
        </div>
```

- [ ] **Step 3: Typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: no errors anywhere in the project.

- [ ] **Step 4: Manually verify in the running app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev
```

Log in, open Pengaturan (Settings), scroll to Zona Berbahaya, and confirm: "Hapus Transaksi Hari Ini" appears above "Hapus Riwayat Transaksi", clicking it shows a confirm dialog with the expected warning text, confirming deletes today's transactions and shows a result message, and (if you have a way to create a Bon sale with a payment today first) confirm such a sale is skipped and reported rather than blocking the whole action.

If you cannot get the Electron dev app running in this environment (the known pre-existing `better-sqlite3` Node-ABI-vs-Electron-ABI environment issue — `npm run rebuild:node` and `npm run rebuild:electron` produce mutually exclusive builds), that's acceptable: report DONE_WITH_CONCERNS explaining exactly what you could and couldn't verify. Either way, run `npm run rebuild:node` afterward to restore the CLI-Node-compatible build the test suite needs, before finishing.

- [ ] **Step 5: Run the full test suite**

```bash
cd desktop-node
npm test
```

Expected: all tests pass. (If you ran `npm run rebuild:electron` in Step 4, run `npm run rebuild:node` first — the two builds are mutually exclusive on this machine.)

- [ ] **Step 6: Commit**

```bash
git add desktop-node/src/renderer/pages/Settings.tsx
git commit -m "feat: add Hapus Transaksi Hari Ini to Settings' Zona Berbahaya"
```

---

### Task 5: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: clean, no output.

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: all test files pass, including `kasir.test.ts` and every previously-passing test.

- [ ] **Step 3: Commit** (only if Step 1/2 required any fixes; otherwise skip — nothing to commit)
