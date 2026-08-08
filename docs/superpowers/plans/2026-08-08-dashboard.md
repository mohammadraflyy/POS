# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Dashboard (today's overview/landing page) in `desktop-node`, and make it the new post-login landing route — moving Kasir from `/` to `/kasir`.

**Architecture:** Same three-layer pattern as every prior slice, but with maximal reuse: `main/dashboard.ts`'s `getDashboard(db)` calls the already-shipped `main/rekap.ts`'s `getRekap(db, {from: today, to: today})` for the summary + top-products data (zero new queries for those), and adds exactly two new queries (`stokMenipis`, `transaksiTerbaru`). A thin auth-guarded IPC handler in `main/ipc/dashboard.ts`, and a renderer page reusing `ReportTable`/`Card`. A separate concern bundled into the same final task: the routing migration that makes `/` render `Dashboard` instead of `Kasir` (Kasir moves to `/kasir`), touching every existing file that assumed Kasir lived at `/`.

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, Vitest. No new npm dependencies.

## Global Constraints

- **`LOW_STOCK_THRESHOLD = 5`**, hardcoded, matching the source Laravel app exactly — no new settings UI for this.
- **`transaksiTerbaru` has no status or date filter** — the 5 most recent sales regardless of status/date, unlike every other query in this app. Cancelled sales and old sales are intentionally visible here.
- **Reuse `getRekap`, don't duplicate its formulas** — `getDashboard` computes today's local date (`${y}-${m}-${d}` pattern, matching every other local-date construction in this app) and calls `getRekap(db, {from: today, to: today})`, taking `summary` and `produkTerlaris` (already capped at 5) directly.
- **Dashboard becomes the new `/` route.** Kasir moves to `/kasir`. Every existing reference to `/` as Kasir's route must be updated:
  - `App.tsx`: `/` → `Dashboard`, add `/kasir` → `Kasir`.
  - `app-sidebar.tsx`: "Penjualan" nav item's `href` → `/kasir`; "Dashboard" nav item's `disabled: true` removed.
  - `Kasir.tsx`: its own breadcrumb `href` → `/kasir`.
  - `KasirHistory.tsx`: breadcrumb `href` → `/kasir`, and the "Ke Kasir" button's `navigate('/')` → `navigate('/kasir')`.
  - `BonPayment.tsx`: breadcrumb `href` → `/kasir`.
  - `Login.tsx`'s post-login `navigate('/')` needs **no change** — `/` now correctly resolves to Dashboard.
- **No dashboard customization, no real-time auto-refresh/polling** — a page-load snapshot, matching the source app exactly.
- **Match established renderer conventions**: this codebase uses `useNavigate()` + `<Button onClick={...}>`/plain `<button>` for internal navigation everywhere (`Purchase.tsx`, `KasirHistory.tsx`, etc.) — not React Router's `<Link>`, which no page in this app currently imports. Follow that convention for Dashboard's "Lihat Rekap Lengkap"/"Lihat semua" links, do not introduce `<Link>`.
- Money crosses the IPC boundary as Rupiah `number`; computed as integer cents in `main/dashboard.ts`. `createdAt` crosses the IPC boundary as an ISO string (`.toISOString()`), matching the established convention in `main/ipc/kasir.ts`.
- Every IPC handler is auth-guarded: `if (!getCurrentUser()) { throw new Error('Silakan login terlebih dahulu.') }`.

---

### Task 1: `getDashboard` business logic

**Files:**
- Create: `desktop-node/src/main/dashboard.ts`
- Test: `desktop-node/src/main/dashboard.test.ts`

**Interfaces:**
- Consumes: `getRekap`, `RekapSummary`, `ProdukTerlarisRow` from Task-independent, already-shipped `./rekap` (unmodified); `products`, `saleItems`, `sales` from `./db/schema` (unmodified).
- Produces:
  - `export interface StokMenipisRow { id: number; kodeItem: string; namaItem: string; satuan: string; stok: number }`
  - `export interface TransaksiTerbaruRow { id: number; namaPelanggan: string | null; metodePembayaran: 'tunai' | 'bon'; status: 'selesai' | 'dibatalkan'; total: number; dibayar: number; createdAt: Date; itemSummary: string }`
  - `export interface DashboardResult { summary: RekapSummary; stokMenipis: StokMenipisRow[]; produkTerlarisHariIni: ProdukTerlarisRow[]; transaksiTerbaru: TransaksiTerbaruRow[] }`
  - `export function getDashboard(db): DashboardResult`
  - Task 2's IPC layer calls this with these exact signatures.

- [ ] **Step 1: Write the failing tests**

Create `desktop-node/src/main/dashboard.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products, sales, saleItems, users } from './db/schema'
import { getDashboard } from './dashboard'
import { getRekap } from './rekap'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedUser(db: ReturnType<typeof createDb>) {
  const now = new Date()
  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()
}

function insertProduct(
  db: ReturnType<typeof createDb>,
  input: { id: number; namaItem: string; stok: number; isActive: boolean },
) {
  const now = new Date()
  db.insert(products)
    .values({
      id: input.id,
      kodeItem: `P${input.id}`,
      barcode: null,
      namaItem: input.namaItem,
      categoryId: null,
      satuan: 'PCS',
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: input.stok,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function insertSale(
  db: ReturnType<typeof createDb>,
  input: {
    id: number
    status: 'selesai' | 'dibatalkan'
    metodePembayaran: 'tunai' | 'bon'
    total: number
    dibayar: number
    createdAt: Date
    items: { productId: number; qty: number }[]
  },
) {
  db.insert(sales)
    .values({
      id: input.id,
      userId: 1,
      namaPelanggan: null,
      metodePembayaran: input.metodePembayaran,
      status: input.status,
      total: input.total,
      dibayar: input.dibayar,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .run()

  db.insert(saleItems)
    .values(
      input.items.map((item, i) => ({
        id: input.id * 100 + i,
        saleId: input.id,
        productId: item.productId,
        productUnitId: null,
        qty: item.qty,
        konversi: 1,
        satuan: null,
        hargaJual: 1500_00,
        hargaPokok: 1000_00,
        subtotal: item.qty * 1500_00,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })),
    )
    .run()
}

describe('getDashboard', () => {
  it('stokMenipis includes stok<=5, excludes stok=6 and inactive products', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Rendah', stok: 5, isActive: true })
    insertProduct(db, { id: 2, namaItem: 'Aman', stok: 6, isActive: true })
    insertProduct(db, { id: 3, namaItem: 'NonaktifRendah', stok: 0, isActive: false })

    const result = getDashboard(db)
    const names = result.stokMenipis.map((p) => p.namaItem)
    expect(names).toContain('Rendah')
    expect(names).not.toContain('Aman')
    expect(names).not.toContain('NonaktifRendah')
  })

  it('stokMenipis is ordered ascending by stok and capped at 10', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    for (let i = 0; i < 12; i++) {
      insertProduct(db, { id: i + 1, namaItem: `Produk ${i}`, stok: i, isActive: true })
    }

    const result = getDashboard(db)
    expect(result.stokMenipis).toHaveLength(10)
    expect(result.stokMenipis.map((p) => p.stok)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('transaksiTerbaru returns the 5 most recent sales descending by createdAt', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Kopi', stok: 100, isActive: true })

    for (let i = 0; i < 6; i++) {
      insertSale(db, {
        id: i + 1,
        status: i === 0 ? 'dibatalkan' : 'selesai',
        metodePembayaran: 'tunai',
        total: 1500_00,
        dibayar: 1500_00,
        createdAt: new Date(2020, 0, i + 1, 10, 0),
        items: [{ productId: 1, qty: 1 }],
      })
    }

    const result = getDashboard(db)
    expect(result.transaksiTerbaru).toHaveLength(5)
    expect(result.transaksiTerbaru.map((t) => t.id)).toEqual([6, 5, 4, 3, 2])
  })

  it('includes a cancelled sale with no status filter, when it is among the most recent', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Kopi', stok: 100, isActive: true })

    insertSale(db, {
      id: 1,
      status: 'dibatalkan',
      metodePembayaran: 'tunai',
      total: 1500_00,
      dibayar: 1500_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [{ productId: 1, qty: 1 }],
    })

    const result = getDashboard(db)
    expect(result.transaksiTerbaru).toHaveLength(1)
    expect(result.transaksiTerbaru[0]).toMatchObject({ id: 1, status: 'dibatalkan' })
  })

  it('itemSummary joins multiple line items into a comma-separated string', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Kopi', stok: 100, isActive: true })
    insertProduct(db, { id: 2, namaItem: 'Gula', stok: 100, isActive: true })

    insertSale(db, {
      id: 1,
      status: 'selesai',
      metodePembayaran: 'tunai',
      total: 4500_00,
      dibayar: 4500_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [
        { productId: 1, qty: 2 },
        { productId: 2, qty: 1 },
      ],
    })

    const result = getDashboard(db)
    expect(result.transaksiTerbaru[0].itemSummary).toBe('Kopi x2, Gula x1')
  })

  it('summary and produkTerlarisHariIni match a direct getRekap call scoped to today', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Kopi', stok: 100, isActive: true })

    const now = new Date()
    insertSale(db, {
      id: 1,
      status: 'selesai',
      metodePembayaran: 'tunai',
      total: 1500_00,
      dibayar: 1500_00,
      createdAt: now,
      items: [{ productId: 1, qty: 1 }],
    })

    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const expected = getRekap(db, { from: today, to: today })

    const result = getDashboard(db)
    expect(result.summary).toEqual(expected.summary)
    expect(result.produkTerlarisHariIni).toEqual(expected.produkTerlaris)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run dashboard.test.ts`
Expected: FAIL — `Cannot find module './dashboard'`.

- [ ] **Step 3: Implement `dashboard.ts`**

Create `desktop-node/src/main/dashboard.ts`:

```typescript
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, saleItems, sales } from './db/schema'
import { getRekap, type ProdukTerlarisRow, type RekapSummary } from './rekap'

export interface StokMenipisRow {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  stok: number
}

export interface TransaksiTerbaruRow {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  createdAt: Date
  itemSummary: string
}

export interface DashboardResult {
  summary: RekapSummary
  stokMenipis: StokMenipisRow[]
  produkTerlarisHariIni: ProdukTerlarisRow[]
  transaksiTerbaru: TransaksiTerbaruRow[]
}

const LOW_STOCK_THRESHOLD = 5

export function getDashboard(db: BetterSQLite3Database<typeof schema>): DashboardResult {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const rekap = getRekap(db, { from: today, to: today })

  const stokMenipis: StokMenipisRow[] = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      namaItem: products.namaItem,
      satuan: products.satuan,
      stok: products.stok,
    })
    .from(products)
    .where(and(eq(products.isActive, true), lte(products.stok, LOW_STOCK_THRESHOLD)))
    .orderBy(products.stok)
    .limit(10)
    .all()

  const saleRows = db
    .select({
      id: sales.id,
      namaPelanggan: sales.namaPelanggan,
      metodePembayaran: sales.metodePembayaran,
      status: sales.status,
      total: sales.total,
      dibayar: sales.dibayar,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .orderBy(desc(sales.createdAt))
    .limit(5)
    .all()

  const saleIds = saleRows.map((s) => s.id)

  const itemRows =
    saleIds.length > 0
      ? db
          .select({
            saleId: saleItems.saleId,
            qty: saleItems.qty,
            namaItem: products.namaItem,
          })
          .from(saleItems)
          .innerJoin(products, eq(saleItems.productId, products.id))
          .where(inArray(saleItems.saleId, saleIds))
          .all()
      : []

  const transaksiTerbaru: TransaksiTerbaruRow[] = saleRows.map((sale) => {
    const items = itemRows.filter((item) => item.saleId === sale.id)
    const itemSummary = items.map((item) => `${item.namaItem} x${item.qty}`).join(', ')

    return {
      id: sale.id,
      namaPelanggan: sale.namaPelanggan,
      metodePembayaran: sale.metodePembayaran,
      status: sale.status,
      total: sale.total,
      dibayar: sale.dibayar,
      createdAt: sale.createdAt,
      itemSummary,
    }
  })

  return {
    summary: rekap.summary,
    stokMenipis,
    produkTerlarisHariIni: rekap.produkTerlaris,
    transaksiTerbaru,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run dashboard.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
cd desktop-node
git add src/main/dashboard.ts src/main/dashboard.test.ts
git status --short
```

Verify the output shows ONLY those two files. Never `git add .`/`-A`/`--all`.

```bash
git commit -m "Add Dashboard business logic"
```

---

### Task 2: Dashboard IPC handler, preload, renderer types

**Files:**
- Create: `desktop-node/src/main/ipc/dashboard.ts`
- Modify: `desktop-node/src/main/index.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `getDashboard`, `DashboardResult` (and nested types) from Task 1's `main/dashboard.ts`; `getCurrentUser` from `./auth` (existing).
- Produces: IPC channel `dashboard:getDashboard`; `window.api.dashboard.getDashboard` — Task 3's page calls this exact name.

- [ ] **Step 1: Create `ipc/dashboard.ts`**

Create `desktop-node/src/main/ipc/dashboard.ts`:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { getDashboard } from '../dashboard'
import { getCurrentUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

export function registerDashboardIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('dashboard:getDashboard', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const result = getDashboard(db)

    return {
      summary: {
        omzetTunai: toRupiah(result.summary.omzetTunai),
        piutangBeredar: toRupiah(result.summary.piutangBeredar),
        jumlahTransaksi: result.summary.jumlahTransaksi,
        labaKotor: toRupiah(result.summary.labaKotor),
      },
      stokMenipis: result.stokMenipis,
      produkTerlarisHariIni: result.produkTerlarisHariIni.map((row) => ({
        namaItem: row.namaItem,
        qtyTerjual: row.qtyTerjual,
        totalPenjualan: toRupiah(row.totalPenjualan),
      })),
      transaksiTerbaru: result.transaksiTerbaru.map((row) => ({
        id: row.id,
        namaPelanggan: row.namaPelanggan,
        metodePembayaran: row.metodePembayaran,
        status: row.status,
        total: toRupiah(row.total),
        dibayar: toRupiah(row.dibayar),
        createdAt: row.createdAt.toISOString(),
        itemSummary: row.itemSummary,
      })),
    }
  })
}
```

- [ ] **Step 2: Register the IPC handler**

In `desktop-node/src/main/index.ts`, find:

```typescript
import { registerRekapIpc } from './ipc/rekap'
```

Replace with:

```typescript
import { registerRekapIpc } from './ipc/rekap'
import { registerDashboardIpc } from './ipc/dashboard'
```

Find:

```typescript
  registerRekapIpc(db)
  createWindow()
```

Replace with:

```typescript
  registerRekapIpc(db)
  registerDashboardIpc(db)
  createWindow()
```

- [ ] **Step 3: Expose the channel in preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
  rekap: {
    getRekap: (input: { from: string; to: string }) => invoke('rekap:getRekap', input),
  },
}
```

Replace with:

```typescript
  rekap: {
    getRekap: (input: { from: string; to: string }) => invoke('rekap:getRekap', input),
  },
  dashboard: {
    getDashboard: () => invoke('dashboard:getDashboard'),
  },
}
```

- [ ] **Step 4: Add matching renderer types**

In `desktop-node/src/renderer/env.d.ts`, find:

```typescript
          labaPerKategori: { categoryName: string; omzet: number; laba: number }[]
          labaPerHari: { tanggal: string; omzet: number; laba: number }[]
          produkTerlaris: { namaItem: string; qtyTerjual: number; totalPenjualan: number }[]
          pembelianPerSupplier: { supplierName: string; totalPembelian: number }[]
        }>
      }
    }
  }
}
```

Replace with:

```typescript
          labaPerKategori: { categoryName: string; omzet: number; laba: number }[]
          labaPerHari: { tanggal: string; omzet: number; laba: number }[]
          produkTerlaris: { namaItem: string; qtyTerjual: number; totalPenjualan: number }[]
          pembelianPerSupplier: { supplierName: string; totalPembelian: number }[]
        }>
      }
      dashboard: {
        getDashboard: () => Promise<{
          summary: {
            omzetTunai: number
            piutangBeredar: number
            jumlahTransaksi: number
            labaKotor: number
          }
          stokMenipis: { id: number; kodeItem: string; namaItem: string; satuan: string; stok: number }[]
          produkTerlarisHariIni: { namaItem: string; qtyTerjual: number; totalPenjualan: number }[]
          transaksiTerbaru: {
            id: number
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
            createdAt: string
            itemSummary: string
          }[]
        }>
      }
    }
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
cd desktop-node
git add src/main/ipc/dashboard.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts
git status --short
```

Verify the output shows ONLY those four files.

```bash
git commit -m "Add Dashboard IPC handler"
```

---

### Task 3: `Dashboard.tsx` page, routing migration, sidebar, manual verification

**Files:**
- Create: `desktop-node/src/renderer/pages/Dashboard.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Modify: `desktop-node/src/renderer/components/app-sidebar.tsx`
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx`
- Modify: `desktop-node/src/renderer/pages/KasirHistory.tsx`
- Modify: `desktop-node/src/renderer/pages/BonPayment.tsx`

**Interfaces:**
- Consumes: `window.api.dashboard.getDashboard()` (Task 2); `AppShell`, `ReportTable` (`@/components/report-table`), `Card`/`CardDescription`/`CardHeader`/`CardTitle` (`@/components/ui/card`), `Button`, `useNavigate` from `react-router-dom` (all existing).
- Produces: `export function Dashboard()` — a full page component; `App.tsx` renders it at `/`, `Kasir` moves to `/kasir`.

- [ ] **Step 1: Create `Dashboard.tsx`**

Create `desktop-node/src/renderer/pages/Dashboard.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { TriangleAlert } from 'lucide-react'
import { ReportTable } from '@/components/report-table'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface DashboardSummary {
  omzetTunai: number
  piutangBeredar: number
  jumlahTransaksi: number
  labaKotor: number
}

interface StokMenipisRow {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  stok: number
}

interface ProdukTerlarisRow {
  namaItem: string
  qtyTerjual: number
  totalPenjualan: number
}

interface TransaksiTerbaruRow {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  createdAt: string
  itemSummary: string
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Dashboard', href: '/' }]

export function Dashboard() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [stokMenipis, setStokMenipis] = useState<StokMenipisRow[]>([])
  const [produkTerlarisHariIni, setProdukTerlarisHariIni] = useState<ProdukTerlarisRow[]>([])
  const [transaksiTerbaru, setTransaksiTerbaru] = useState<TransaksiTerbaruRow[]>([])

  useEffect(() => {
    window.api.dashboard.getDashboard().then((result) => {
      setSummary(result.summary)
      setStokMenipis(result.stokMenipis)
      setProdukTerlarisHariIni(result.produkTerlarisHariIni)
      setTransaksiTerbaru(result.transaksiTerbaru)
    })
  }, [])

  const stokMenipisColumns: Column<StokMenipisRow>[] = [
    { key: 'kodeItem', name: 'Kode', width: 90 },
    { key: 'namaItem', name: 'Produk' },
    {
      key: 'stok',
      name: 'Stok',
      width: 100,
      renderCell: ({ row }) => (
        <span className="flex w-full items-center justify-end gap-1 text-right">
          {row.stok <= 0 && <TriangleAlert className="size-3.5 text-destructive" />}
          {row.stok} {row.satuan}
        </span>
      ),
    },
  ]

  const produkTerlarisColumns: Column<ProdukTerlarisRow>[] = [
    { key: 'namaItem', name: 'Produk' },
    { key: 'qtyTerjual', name: 'Qty', width: 80 },
    {
      key: 'totalPenjualan',
      name: 'Total',
      width: 130,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.totalPenjualan)}</span>,
    },
  ]

  const transaksiColumns: Column<TransaksiTerbaruRow>[] = [
    {
      key: 'createdAt',
      name: 'Waktu',
      width: 160,
      renderCell: ({ row }) => new Date(row.createdAt).toLocaleString('id-ID'),
    },
    { key: 'itemSummary', name: 'Item' },
    {
      key: 'metodePembayaran',
      name: 'Metode',
      width: 110,
      renderCell: ({ row }) => (row.metodePembayaran === 'bon' ? `Bon (${row.namaPelanggan})` : 'Tunai'),
    },
    {
      key: 'status',
      name: 'Status',
      width: 130,
      renderCell: ({ row }) => {
        if (row.status === 'dibatalkan') {
          return <span className="text-destructive">Dibatalkan</span>
        }

        const sisaPiutang = row.total - row.dibayar

        if (row.metodePembayaran === 'bon' && sisaPiutang > 0) {
          return <span className="text-amber-600 dark:text-amber-400">Sisa {formatRupiah(sisaPiutang)}</span>
        }

        return <span className="text-green-600 dark:text-green-400">Lunas</span>
      },
    },
    {
      key: 'total',
      name: 'Total',
      width: 120,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.total)}</span>,
    },
  ]

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <Button variant="outline" size="sm" onClick={() => navigate('/rekap')}>
            Lihat Rekap Lengkap
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Omzet Hari Ini</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.omzetTunai ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Transaksi Hari Ini</CardDescription>
              <CardTitle className="text-2xl">{summary?.jumlahTransaksi ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Laba Hari Ini</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.labaKotor ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Piutang Bon Beredar</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.piutangBeredar ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ReportTable<StokMenipisRow>
            title="Stok Menipis"
            columns={stokMenipisColumns}
            rows={stokMenipis}
            rowKey={(row) => row.id}
            emptyMessage="Semua stok aman."
            action={
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => navigate('/inventory')}
              >
                Lihat semua
              </button>
            }
          />
          <ReportTable<ProdukTerlarisRow>
            title="Produk Terlaris Hari Ini"
            columns={produkTerlarisColumns}
            rows={produkTerlarisHariIni}
            rowKey={(row) => row.namaItem}
            emptyMessage="Belum ada penjualan hari ini."
          />
        </div>

        <ReportTable<TransaksiTerbaruRow>
          title="Transaksi Terbaru"
          columns={transaksiColumns}
          rows={transaksiTerbaru}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada transaksi."
          action={
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => navigate('/history')}
            >
              Lihat semua
            </button>
          }
        />
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 2: Migrate the routes — Dashboard takes `/`, Kasir moves to `/kasir`**

In `desktop-node/src/renderer/App.tsx`, find:

```typescript
import { Rekap } from './pages/Rekap'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Kasir />} />
```

Replace with:

```typescript
import { Rekap } from './pages/Rekap'
import { Dashboard } from './pages/Dashboard'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/kasir" element={<Kasir />} />
```

- [ ] **Step 3: Update the sidebar — enable Dashboard, point Penjualan at `/kasir`**

In `desktop-node/src/renderer/components/app-sidebar.tsx`, find:

```typescript
const overviewNavItems: NavItem[] = [{ title: 'Dashboard', href: '/dashboard', icon: LayoutGrid, disabled: true }]

const penjualanNavItems: NavItem[] = [
  { title: 'Penjualan', href: '/', icon: ShoppingCart },
```

Replace with:

```typescript
const overviewNavItems: NavItem[] = [{ title: 'Dashboard', href: '/', icon: LayoutGrid }]

const penjualanNavItems: NavItem[] = [
  { title: 'Penjualan', href: '/kasir', icon: ShoppingCart },
```

- [ ] **Step 4: Update `Kasir.tsx`'s breadcrumb**

In `desktop-node/src/renderer/pages/Kasir.tsx`, find:

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Penjualan', href: '/' }]
```

Replace with:

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Penjualan', href: '/kasir' }]
```

- [ ] **Step 5: Update `KasirHistory.tsx`'s breadcrumb and "Ke Kasir" button**

In `desktop-node/src/renderer/pages/KasirHistory.tsx`, find:

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/' },
  { title: 'Riwayat Transaksi', href: '/history' },
]
```

Replace with:

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/kasir' },
  { title: 'Riwayat Transaksi', href: '/history' },
]
```

Find:

```typescript
          <Button type="button" variant="outline" onClick={() => navigate('/')}>
            Ke Kasir
          </Button>
```

Replace with:

```typescript
          <Button type="button" variant="outline" onClick={() => navigate('/kasir')}>
            Ke Kasir
          </Button>
```

- [ ] **Step 6: Update `BonPayment.tsx`'s breadcrumb**

In `desktop-node/src/renderer/pages/BonPayment.tsx`, find:

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/' },
  { title: 'Riwayat Transaksi', href: '/history' },
]
```

Replace with:

```typescript
const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/kasir' },
  { title: 'Riwayat Transaksi', href: '/history' },
]
```

- [ ] **Step 7: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — all tests green.

- [ ] **Step 9: Rebuild for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

(Run in background/detached. If a prior Electron dev instance is still running and holding the port, stop it first: `tasklist //FI "IMAGENAME eq electron.exe"`, `taskkill //F //IM electron.exe`. Confirm launch via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 10: Manual end-to-end verification via CDP**

Log in as `admin`/`password`. Using the established CDP pattern (query `http://127.0.0.1:9222/json`, `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`, `Page.enable` before any `Page.captureScreenshot` call — a prior slice found `captureScreenshot` can hang without it):

1. Confirm login redirects to `/` and `/` now shows the Dashboard (title "Dashboard", breadcrumb "Dashboard") — not Kasir.
2. Confirm the sidebar's "Dashboard" entry is enabled (not dimmed) and highlighted as active on this page. Confirm "Penjualan" now links to `/kasir`.
3. Click "Penjualan" in the sidebar — confirm it navigates to `/kasir` and Kasir (the checkout page) renders correctly there, with its own breadcrumb reading "Penjualan" and pointing back at `/kasir`.
4. From Kasir, complete a real checkout (add an item to cart, checkout with `tunai`) to guarantee at least one real "today" transaction exists, if the dev DB doesn't already have one from today.
5. Navigate back to `/` (Dashboard) — confirm the 4 summary cards reflect the transaction just completed (Omzet Hari Ini and Transaksi Hari Ini should have increased).
6. Confirm "Stok Menipis" shows real data if any active product has `stok <= 5` in the dev DB (check via Katalog Produk first if unsure), or shows "Semua stok aman." if none do.
7. Confirm "Produk Terlaris Hari Ini" and "Transaksi Terbaru" show real data reflecting the checkout just completed, including the correct item summary and a green "Lunas" status (since it was a fully-paid tunai sale).
8. Click "Lihat Rekap Lengkap" — confirm it navigates to `/rekap` and the Rekap page loads correctly (this route was unaffected by this change, just confirming the link works).
9. Navigate to Riwayat Transaksi (`/history`) — confirm its breadcrumb's "Penjualan" link and its own "Ke Kasir" button both correctly go to `/kasir`, not a broken `/` route.
10. If any bon (unpaid) sale exists in the dev DB, confirm it shows the amber "Sisa {rupiah}" status correctly in Transaksi Terbaru (only if such a sale happens to be among the 5 most recent — do not create one solely for this check if none exists naturally).
11. Take at least one real screenshot of the fully-loaded Dashboard and visually confirm the layout: header + "Lihat Rekap Lengkap" button, 4-card grid, 2-column row (Stok Menipis + Produk Terlaris), full-width Transaksi Terbaru table — not just an innerText check.
12. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 11: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

(If this fails with an `EPERM`/unlink error, an Electron process is still holding the native module file locked — kill `electron.exe` processes first, then retry.)

- [ ] **Step 12: Commit**

```bash
cd desktop-node
git add src/renderer/pages/Dashboard.tsx src/renderer/App.tsx src/renderer/components/app-sidebar.tsx src/renderer/pages/Kasir.tsx src/renderer/pages/KasirHistory.tsx src/renderer/pages/BonPayment.tsx
git status --short
```

Verify the output shows ONLY those six files.

```bash
git commit -m "Add Dashboard page, migrate Kasir from / to /kasir"
```

---

## Plan Self-Review

**Spec coverage:** `LOW_STOCK_THRESHOLD=5` hardcoded → Task 1, directly tested at the boundary (5 included, 6 excluded). `transaksiTerbaru` has no status/date filter → Task 1, directly tested (a cancelled sale appears when recent enough). `getRekap` reuse (no duplicated formulas) → Task 1, directly tested via a cross-check against a live `getRekap` call. Full routing migration (6 files) → Task 3, every enumerated file from the Global Constraints section has its own step. `useNavigate`-based internal links, not `<Link>` → Task 3's `Dashboard.tsx` code. `createdAt` as ISO string over IPC → Task 2. Auth guard → Task 2.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code, including all 6 routing-migration file edits with exact find/replace text.

**Type consistency:** `StokMenipisRow`/`TransaksiTerbaruRow`/`DashboardResult` (Task 1) match Task 2's IPC handler's Rupiah-converted return shape and `env.d.ts`'s Promise type field-for-field. `window.api.dashboard.getDashboard()`'s response shape is identical across preload, `env.d.ts` (Task 2), and `Dashboard.tsx`'s local interfaces and call site (Task 3). `RekapSummary`/`ProdukTerlarisRow` are imported from `./rekap`, not redefined, in Task 1 — Task 2 and Task 3's local shapes match those types' fields exactly (verified against the already-shipped `main/rekap.ts`).
