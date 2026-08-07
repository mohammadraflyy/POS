# Pending Payment (Bon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Pending Payment page in `desktop-node` so cashiers can record installment payments against unpaid `bon` sales, closing out the last hidden piece of Fase 2 (Kasir).

**Architecture:** Same three-layer pattern as the History slice — a pure, unit-tested business-logic function in `main/kasir.ts`, IPC handlers in `ipc/kasir.ts` doing Rupiah↔cents conversion at the boundary, and a renderer page ported near-verbatim from `resources/js/pages/kasir/bon-payment.tsx`.

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, react-data-grid, Vitest.

## Global Constraints

- Data/code keeps the `bon` naming throughout (`metodePembayaran: 'bon'`, `bonPayments` table, `recordBonPayment` function name). Only user-facing text says "Pending Payment" — see the exact label table below.
- Money crosses the IPC boundary as Rupiah `number`; it is stored and computed in integer cents everywhere in `main/kasir.ts`, using the existing `toRupiah`/`toCents` helpers in `ipc/kasir.ts`.
- `bonPayments.tanggal` is stored as a plain `YYYY-MM-DD` string (matches the existing convention seen in `kasir.test.ts`'s `cancelSale` tests, e.g. `tanggal: '2026-08-06'`).
- Validation rules must match `BonPaymentController::store` + `StoreBonPaymentRequest` exactly: sale must be `metodePembayaran === 'bon' && status === 'selesai'`; `jumlah` positive; `jumlah <= sisaPiutang` (`total - dibayar`); `keterangan` nullable, max 500 chars.
- Label mapping (exact strings, approved by user):

  | Where | String |
  |---|---|
  | History → Metode column (bon rows) | `Pending Payment (${namaPelanggan})` |
  | History → Aksi button | `Pending Payment` |
  | New page → title | `Pending Payment — {namaPelanggan ?? \`Struk #${id}\`}` |
  | New page → browser title | `Pending Payment #{id}` |
  | New page → paid-off message | `Pending payment ini sudah lunas.` |

- No new npm dependencies — `Card`, `ReportTable`, `InputError` are plain ports of existing shadcn/local components already used by the web app.
- Run `npm run rebuild:node` before Vitest/typecheck work and `npm run rebuild:electron` before manual Electron verification (dual-ABI toolchain, same as every prior slice).

---

### Task 1: `recordBonPayment` business logic

**Files:**
- Modify: `desktop-node/src/main/kasir.ts`
- Test: `desktop-node/src/main/kasir.test.ts`

**Interfaces:**
- Consumes: `sales`, `bonPayments` from `./db/schema` (already imported in `kasir.ts`); `sql`, `eq` from `drizzle-orm` (already imported).
- Produces: `export function recordBonPayment(db: BetterSQLite3Database<typeof schema>, saleId: number, jumlahCents: number, keterangan: string | null): void` — later tasks (IPC handler) call this exact signature.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block at the end of `desktop-node/src/main/kasir.test.ts` (after the existing `describe('cancelSale', ...)` block, so after its closing `})` on line 555):

```typescript
describe('recordBonPayment', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedDbWithOneBonSale() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({
        id: 1,
        username: 'kasir1',
        passwordHash: 'hash',
        name: 'Kasir Satu',
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        satuan: 'PCS',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 10,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const result = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 3 }],
    })

    return { db, saleId: result.saleId, total: 3 * 65000_00 }
  }

  it('records a payment, increments dibayar, and inserts a bon_payments row dated today', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    const todayIso = new Date().toISOString().slice(0, 10)

    recordBonPayment(db, saleId, 50000_00, 'Cicilan pertama')

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.dibayar).toBe(50000_00)

    const payments = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).all()
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({
      saleId,
      jumlah: 50000_00,
      tanggal: todayIso,
      keterangan: 'Cicilan pertama',
    })
  })

  it('allows a payment with keterangan omitted (null)', () => {
    const { db, saleId } = seedDbWithOneBonSale()

    recordBonPayment(db, saleId, 10000_00, null)

    const payments = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).all()
    expect(payments[0].keterangan).toBeNull()
  })

  it('allows a payment that exactly clears sisaPiutang', () => {
    const { db, saleId, total } = seedDbWithOneBonSale()

    recordBonPayment(db, saleId, total, null)

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.dibayar).toBe(total)
  })

  it('accumulates dibayar across multiple payments', () => {
    const { db, saleId } = seedDbWithOneBonSale()

    recordBonPayment(db, saleId, 50000_00, null)
    recordBonPayment(db, saleId, 30000_00, null)

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.dibayar).toBe(80000_00)

    const payments = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).all()
    expect(payments).toHaveLength(2)
  })

  it('throws when the sale does not exist', () => {
    const { db } = seedDbWithOneBonSale()
    expect(() => recordBonPayment(db, 999, 1000_00, null)).toThrow('Transaksi tidak ditemukan.')
  })

  it('throws when the sale is not a bon sale', () => {
    const db = createDb(':memory:', migrationsFolder)
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
        stok: 10,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    expect(() => recordBonPayment(db, result.saleId, 1000_00, null)).toThrow('Transaksi ini bukan bon aktif.')
  })

  it('throws when the sale has been cancelled', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    cancelSale(db, saleId)

    expect(() => recordBonPayment(db, saleId, 1000_00, null)).toThrow('Transaksi ini bukan bon aktif.')
  })

  it('throws when jumlah is zero or negative', () => {
    const { db, saleId } = seedDbWithOneBonSale()

    expect(() => recordBonPayment(db, saleId, 0, null)).toThrow('Jumlah bayar harus lebih dari 0.')
    expect(() => recordBonPayment(db, saleId, -1000_00, null)).toThrow('Jumlah bayar harus lebih dari 0.')
  })

  it('throws when jumlah is not an integer', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    expect(() => recordBonPayment(db, saleId, 1000.5, null)).toThrow('Jumlah bayar harus lebih dari 0.')
  })

  it('throws when jumlah exceeds sisaPiutang', () => {
    const { db, saleId, total } = seedDbWithOneBonSale()
    expect(() => recordBonPayment(db, saleId, total + 1, null)).toThrow('Jumlah bayar melebihi sisa piutang.')
  })

  it('throws when keterangan exceeds 500 characters', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    const tooLong = 'a'.repeat(501)
    expect(() => recordBonPayment(db, saleId, 1000_00, tooLong)).toThrow('Keterangan maksimal 500 karakter.')
  })

  it('does not mutate state when a validation error is thrown', () => {
    const { db, saleId, total } = seedDbWithOneBonSale()

    expect(() => recordBonPayment(db, saleId, total + 1, null)).toThrow()

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.dibayar).toBe(0)
    expect(db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).all()).toHaveLength(0)
  })
})
```

Also update the top-of-file import to bring in `recordBonPayment`:

```typescript
import { checkout, type CheckoutInput, cancelSale, recordBonPayment } from './kasir'
```

(This replaces the existing `import { checkout, type CheckoutInput, cancelSale } from './kasir'` line.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run kasir.test.ts`
Expected: FAIL — `recordBonPayment is not a function` (or a TypeScript compile error naming the missing export).

- [ ] **Step 3: Implement `recordBonPayment`**

Add this function to `desktop-node/src/main/kasir.ts`, after `cancelSale` (end of file):

```typescript
export function recordBonPayment(
  db: BetterSQLite3Database<typeof schema>,
  saleId: number,
  jumlahCents: number,
  keterangan: string | null,
): void {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  if (sale.metodePembayaran !== 'bon' || sale.status !== 'selesai') {
    throw new Error('Transaksi ini bukan bon aktif.')
  }

  if (!Number.isInteger(jumlahCents) || jumlahCents <= 0) {
    throw new Error('Jumlah bayar harus lebih dari 0.')
  }

  if (keterangan && keterangan.length > 500) {
    throw new Error('Keterangan maksimal 500 karakter.')
  }

  const sisaPiutang = sale.total - sale.dibayar

  if (jumlahCents > sisaPiutang) {
    throw new Error('Jumlah bayar melebihi sisa piutang.')
  }

  const now = new Date()
  const tanggal = now.toISOString().slice(0, 10)

  db.transaction((tx) => {
    tx.insert(bonPayments)
      .values({
        saleId,
        jumlah: jumlahCents,
        tanggal,
        keterangan,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    tx.update(sales)
      .set({ dibayar: sql`${sales.dibayar} + ${jumlahCents}` })
      .where(eq(sales.id, saleId))
      .run()
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run kasir.test.ts`
Expected: PASS — all tests in `kasir.test.ts` green, including the 12 new `recordBonPayment` tests.

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd desktop-node
git add src/main/kasir.ts src/main/kasir.test.ts
git commit -m "Add recordBonPayment business logic"
```

---

### Task 2: IPC handlers, preload, and renderer types

**Files:**
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `recordBonPayment(db, saleId, jumlahCents, keterangan)` from Task 1; existing `toRupiah`/`toCents` helpers; `getCurrentUser` from `./auth`.
- Produces: IPC channels `kasir:getSaleDetail` (returns the shape below) and `kasir:recordBonPayment` (returns `void`); `window.api.kasir.getSaleDetail(saleId)` and `window.api.kasir.recordBonPayment({ saleId, jumlah, keterangan })` — Task 4's page calls these exact names.

  ```typescript
  // kasir:getSaleDetail return shape
  {
    id: number
    namaPelanggan: string | null
    metodePembayaran: 'tunai' | 'bon'
    status: 'selesai' | 'dibatalkan'
    total: number       // Rupiah
    dibayar: number      // Rupiah
    createdAt: string    // ISO
    items: { id: number; qty: number; satuan: string | null; namaItem: string }[]
    bonPayments: { id: number; jumlah: number; tanggal: string; keterangan: string | null }[]
  }
  ```

- [ ] **Step 1: Add the `getSaleDetail` and `recordBonPayment` IPC handlers**

In `desktop-node/src/main/ipc/kasir.ts`:

1. Add `bonPayments` to the schema import (currently `import { products, productUnits, productPriceTiers, sales, saleItems, storeSettings, users } from '../db/schema'`):

```typescript
import { products, productUnits, productPriceTiers, sales, saleItems, bonPayments, storeSettings, users } from '../db/schema'
```

2. Add `recordBonPayment` to the business-logic import (currently `import { checkout, cancelSale, type CheckoutInput } from '../kasir'`):

```typescript
import { checkout, cancelSale, recordBonPayment, type CheckoutInput } from '../kasir'
```

3. Add these two handlers inside `registerKasirIpc`, after the existing `kasir:listSalesHistory` handler (before the function's closing `}`):

```typescript
  ipcMain.handle('kasir:getSaleDetail', (_event, saleId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    if (!sale) {
      throw new Error('Transaksi tidak ditemukan.')
    }

    const itemRows = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()
    const productIds = itemRows.map((item) => item.productId)
    const productRows = productIds.length > 0 ? db.select().from(products).where(inArray(products.id, productIds)).all() : []
    const productNameById = new Map(productRows.map((product) => [product.id, product.namaItem]))

    const paymentRows = db
      .select()
      .from(bonPayments)
      .where(eq(bonPayments.saleId, saleId))
      .orderBy(desc(bonPayments.tanggal), desc(bonPayments.id))
      .all()

    return {
      id: sale.id,
      namaPelanggan: sale.namaPelanggan,
      metodePembayaran: sale.metodePembayaran,
      status: sale.status,
      total: toRupiah(sale.total),
      dibayar: toRupiah(sale.dibayar),
      createdAt: sale.createdAt.toISOString(),
      items: itemRows.map((item) => ({
        id: item.id,
        qty: item.qty,
        satuan: item.satuan,
        namaItem: productNameById.get(item.productId) ?? '',
      })),
      bonPayments: paymentRows.map((payment) => ({
        id: payment.id,
        jumlah: toRupiah(payment.jumlah),
        tanggal: payment.tanggal,
        keterangan: payment.keterangan,
      })),
    }
  })

  ipcMain.handle(
    'kasir:recordBonPayment',
    (_event, input: { saleId: number; jumlah: number; keterangan: string | null }) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      recordBonPayment(db, input.saleId, toCents(input.jumlah), input.keterangan)
    },
  )
```

- [ ] **Step 2: Expose the new channels in preload**

In `desktop-node/src/preload/index.ts`, add these two entries to the `kasir` object, after `listSalesHistory`:

```typescript
    getSaleDetail: (saleId: number) => invoke('kasir:getSaleDetail', saleId),
    recordBonPayment: (input: { saleId: number; jumlah: number; keterangan: string | null }) =>
      invoke('kasir:recordBonPayment', input),
```

- [ ] **Step 3: Add matching renderer types**

In `desktop-node/src/renderer/env.d.ts`, add these two entries to the `kasir` interface, after `listSalesHistory`'s closing `>`:

```typescript
        getSaleDetail: (saleId: number) => Promise<{
          id: number
          namaPelanggan: string | null
          metodePembayaran: 'tunai' | 'bon'
          status: 'selesai' | 'dibatalkan'
          total: number
          dibayar: number
          createdAt: string
          items: { id: number; qty: number; satuan: string | null; namaItem: string }[]
          bonPayments: { id: number; jumlah: number; tanggal: string; keterangan: string | null }[]
        }>
        recordBonPayment: (input: { saleId: number; jumlah: number; keterangan: string | null }) => Promise<void>
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions (this task adds no new automated tests; `recordBonPayment`'s business logic is already covered by Task 1).

- [ ] **Step 6: Commit**

```bash
cd desktop-node
git add src/main/ipc/kasir.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "Add kasir:getSaleDetail and kasir:recordBonPayment IPC handlers"
```

---

### Task 3: Port Card, ReportTable, InputError components

**Files:**
- Create: `desktop-node/src/renderer/components/ui/card.tsx`
- Create: `desktop-node/src/renderer/components/report-table.tsx`
- Create: `desktop-node/src/renderer/components/input-error.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`; `useAppearance` from `@/hooks/use-appearance`; `useElementWidth` from `@/hooks/use-element-width` (all already exist in `desktop-node`).
- Produces: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` (named exports); `ReportTable<T>` (named export, generic component, props `{ title, action?, columns, rows, rowKey, emptyMessage }`); `InputError` (named export, props `{ message?: string, className?: string }` plus standard `<p>` attributes) — Task 4's `BonPayment.tsx` imports all of these.

- [ ] **Step 1: Port `card.tsx`**

Create `desktop-node/src/renderer/components/ui/card.tsx` — verbatim port of `resources/js/components/ui/card.tsx`, only the import path changes to match desktop-node's alias:

```typescript
import * as React from 'react'

import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm', className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1.5 px-6', className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('leading-none font-semibold', className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('text-muted-foreground text-sm', className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center px-6', className)} {...props} />
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
```

- [ ] **Step 2: Port `report-table.tsx`**

Create `desktop-node/src/renderer/components/report-table.tsx` — verbatim port of `resources/js/components/report-table.tsx`:

```typescript
import type { Key, ReactNode } from 'react'
import { DataGrid } from 'react-data-grid'
import type { Column } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { useAppearance } from '@/hooks/use-appearance'
import { useElementWidth } from '@/hooks/use-element-width'

export function ReportTable<T>({
  title,
  action,
  columns,
  rows,
  rowKey,
  emptyMessage,
}: {
  title: string
  action?: ReactNode
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => Key
  emptyMessage: string
}) {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, width] = useElementWidth<HTMLDivElement>()
  const height = Math.min(320, Math.max(120, 42 + rows.length * 35))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div ref={widthRef}>
        {width > 0 && (
          <DataGrid
            className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
            columns={columns}
            rows={rows}
            rowKeyGetter={rowKey}
            renderers={{
              noRowsFallback: (
                <div className="col-span-full p-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>
              ),
            }}
            style={{ blockSize: height }}
          />
        )}
      </div>
    </div>
  )
}
```

Note: `numberCell` from the web source is unused by the Bon Payment page (it right-aligns money manually via an inline `<span>`, matching `KasirHistory.tsx`'s existing `Total` column pattern) — omitted as YAGNI.

- [ ] **Step 3: Port `input-error.tsx`**

Create `desktop-node/src/renderer/components/input-error.tsx`. `desktop-node` uses named exports throughout (no default exports appear anywhere in `src/renderer/components/`) — this port uses a named export instead of the web source's `export default`, otherwise identical:

```typescript
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function InputError({
  message,
  className = '',
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { message?: string }) {
  return message ? (
    <p {...props} className={cn('text-sm text-red-600 dark:text-red-400', className)}>
      {message}
    </p>
  ) : null
}
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors (these components aren't imported anywhere yet, so this only checks they compile standalone).

- [ ] **Step 5: Commit**

```bash
cd desktop-node
git add src/renderer/components/ui/card.tsx src/renderer/components/report-table.tsx src/renderer/components/input-error.tsx
git commit -m "Port Card, ReportTable, InputError components"
```

---

### Task 4: BonPayment page, routing, History wiring, and verification

**Files:**
- Create: `desktop-node/src/renderer/pages/BonPayment.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Modify: `desktop-node/src/renderer/pages/KasirHistory.tsx`

**Interfaces:**
- Consumes: `window.api.kasir.getSaleDetail`/`recordBonPayment` (Task 2); `Card`/`CardHeader`/`CardTitle`/`CardDescription`, `ReportTable`, `InputError` (Task 3); existing `Button`, `Input`, `Label`, `useAppearance`-independent auth pattern, `formatRupiah`, `cn` from `@/lib/utils`.
- Produces: route `/bon-payment/:saleId`.

- [ ] **Step 1: Create `BonPayment.tsx`**

Create `desktop-node/src/renderer/pages/BonPayment.tsx`:

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

interface SaleDetail {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  createdAt: string
  items: { id: number; qty: number; satuan: string | null; namaItem: string }[]
  bonPayments: { id: number; jumlah: number; tanggal: string; keterangan: string | null }[]
}

interface BonPaymentRow {
  id: number
  jumlah: number
  tanggal: string
  keterangan: string | null
}

export function BonPayment() {
  const navigate = useNavigate()
  const { saleId } = useParams<{ saleId: string }>()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [sale, setSale] = useState<SaleDetail | null>(null)
  const [jumlah, setJumlah] = useState('')
  const [keterangan, setKeterangan] = useState('')
  const [processing, setProcessing] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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
    window.api.kasir
      .getSaleDetail(Number(saleId))
      .then(setSale)
      .catch(() => setLoadError('Gagal memuat transaksi.'))
  }

  useEffect(() => {
    if (!user) {
      return
    }
    loadSale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function submit(e: FormEvent) {
    e.preventDefault()
    setProcessing(true)
    setFieldError(null)

    window.api.kasir
      .recordBonPayment({ saleId: Number(saleId), jumlah: Number(jumlah), keterangan: keterangan || null })
      .then(() => {
        setJumlah('')
        setKeterangan('')
        loadSale()
      })
      .catch((err) => setFieldError(err instanceof Error ? err.message : 'Gagal mencatat pembayaran'))
      .finally(() => setProcessing(false))
  }

  if (!user || !sale) {
    return <p>{loadError ?? 'Memuat...'}</p>
  }

  const sisaPiutang = sale.total - sale.dibayar
  const isLunas = sisaPiutang <= 0
  const canPay = sale.status === 'selesai' && !isLunas

  const columns: Column<BonPaymentRow>[] = [
    {
      key: 'tanggal',
      name: 'Tanggal',
      width: 140,
      renderCell: ({ row }) => new Date(row.tanggal).toLocaleDateString('id-ID'),
    },
    {
      key: 'jumlah',
      name: 'Jumlah',
      width: 150,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.jumlah)}</span>,
    },
    {
      key: 'keterangan',
      name: 'Keterangan',
      renderCell: ({ row }) => row.keterangan ?? '-',
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            Pending Payment &mdash; {sale.namaPelanggan ?? `Struk #${sale.id}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {sale.items.map((i) => `${i.namaItem} x${i.qty}`).join(', ')} &middot;{' '}
            {new Date(sale.createdAt).toLocaleString('id-ID')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/history')}>
          Kembali
        </Button>
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total Transaksi</CardDescription>
            <CardTitle className="text-2xl">{formatRupiah(sale.total)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sudah Dibayar</CardDescription>
            <CardTitle className="text-2xl">{formatRupiah(sale.dibayar)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sisa Piutang</CardDescription>
            <CardTitle
              className={cn('text-2xl', isLunas ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400')}
            >
              {formatRupiah(Math.max(sisaPiutang, 0))}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {canPay && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/30 p-4">
          <div className="grid gap-1">
            <Label htmlFor="jumlah">Jumlah Bayar</Label>
            <Input
              id="jumlah"
              type="number"
              autoFocus
              value={jumlah}
              onChange={(e) => setJumlah(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="keterangan">Keterangan (opsional)</Label>
            <Input id="keterangan" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className="w-64" />
          </div>
          <Button type="submit" disabled={processing}>
            Simpan Pembayaran
          </Button>
          <InputError message={fieldError ?? undefined} />
        </form>
      )}

      {!canPay && sale.status === 'selesai' && (
        <p className="text-sm font-medium text-green-600 dark:text-green-400">Pending payment ini sudah lunas.</p>
      )}

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

- [ ] **Step 2: Add the route**

In `desktop-node/src/renderer/App.tsx`, add the import and route:

```typescript
import { BonPayment } from './pages/BonPayment'
```

```typescript
        <Route path="/bon-payment/:saleId" element={<BonPayment />} />
```

(Add the import alongside the existing `KasirHistory` import, and the route alongside the existing `/history` route.)

- [ ] **Step 3: Wire up `KasirHistory.tsx`**

In `desktop-node/src/renderer/pages/KasirHistory.tsx`:

1. Change the Metode column's `renderCell` (currently `renderCell: ({ row }) => (row.metodePembayaran === 'bon' ? \`Bon (${row.namaPelanggan})\` : 'Tunai'),`) to:

```typescript
      renderCell: ({ row }) => (row.metodePembayaran === 'bon' ? `Pending Payment (${row.namaPelanggan})` : 'Tunai'),
```

2. Change the Aksi column's `renderCell` to add the "Pending Payment" button before "Batalkan" (currently only renders "Batalkan" conditionally, then "Cetak"):

```typescript
      renderCell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.metodePembayaran === 'bon' && row.status === 'selesai' && row.total - row.dibayar > 0 && (
            <Button variant="default" size="sm" onClick={() => navigate(`/bon-payment/${row.id}`)}>
              Pending Payment
            </Button>
          )}
          {row.status === 'selesai' && row.dibayar === 0 && (
            <Button variant="destructive" size="sm" onClick={() => cancelSale(row)}>
              Batalkan
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => printSale(row.id)}>
            Cetak
          </Button>
        </div>
      ),
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — all tests green (no new automated tests in this task; the page is verified manually in Step 7).

- [ ] **Step 6: Rebuild better-sqlite3 for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

(Run in background. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 7: Manual end-to-end verification via CDP**

Using the same CDP pattern established in the History slice (query `http://127.0.0.1:9222/json` for the page target's `webSocketDebuggerUrl`, then `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`):

1. Log in, navigate to History. Confirm a `bon` sale with `dibayar < total` shows a "Pending Payment" button in Aksi, and its Metode column reads `Pending Payment (nama)`.
2. Click "Pending Payment" → confirm navigation to `/bon-payment/:id` and the three cards show correct Total/Sudah Dibayar/Sisa Piutang values.
3. Submit a partial payment (less than sisaPiutang) with a keterangan → confirm the cards update (Sudah Dibayar increases, Sisa Piutang decreases), the payment appears in the "Riwayat Pembayaran" table, and the form is still visible (not yet lunas).
4. Attempt to overpay (jumlah greater than the current sisaPiutang) → confirm an error message appears via `InputError` and no state changes (cards stay the same, no new row in the payment table).
5. Pay off the remaining balance exactly → confirm the "Pending payment ini sudah lunas." message appears and the payment form disappears.
6. Click "Kembali" → confirm navigation back to `/history`, and confirm the now-paid-off sale's row no longer shows a "Pending Payment" button (Aksi shows only "Cetak") and its Status column reads "Lunas" instead of "Sisa Rp X".
7. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 8: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/pages/BonPayment.tsx src/renderer/App.tsx src/renderer/pages/KasirHistory.tsx
git commit -m "Add Pending Payment page with routing and History wiring"
```

---

## Plan Self-Review

**Spec coverage:** Terminology table → Global Constraints + Task 4 Steps 1/3. `recordBonPayment` business logic (all 5 validation rules + transaction) → Task 1. `kasir:getSaleDetail` / `kasir:recordBonPayment` IPC → Task 2. Component ports (`Card`, `ReportTable`, `InputError`) → Task 3. `BonPayment.tsx` page structure (header, 3 cards, conditional form, lunas message, payment history table) → Task 4 Step 1. `KasirHistory.tsx` button + label wiring → Task 4 Step 3. Out-of-scope items (no `checkout`/`cancelSale` changes, no schema changes, no code-identifier renames) — untouched by every task, confirmed by scoping each task's file list to only the files named in the spec.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code.

**Type consistency:** `recordBonPayment(db, saleId, jumlahCents, keterangan)` signature is identical across Task 1 (definition), Task 2 (IPC handler call site), and matches the IPC handler's own converted `toCents(input.jumlah)` call. `getSaleDetail`'s return shape is identical across Task 2's handler, env.d.ts, and Task 4's `SaleDetail` interface (field names/types match exactly: `id`, `namaPelanggan`, `metodePembayaran`, `status`, `total`, `dibayar`, `createdAt`, `items[{id,qty,satuan,namaItem}]`, `bonPayments[{id,jumlah,tanggal,keterangan}]`).
