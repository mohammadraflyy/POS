# Rekap Stock Value & Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a current-stock valuation report and a whole-page Excel export (which also introduces a new transaction-history table) to the existing Rekap module.

**Architecture:** Two new read-only query functions in `main/rekap.ts` (`getStockValue`, `getSalesHistory`) feed into the existing `getRekap` bundle. A new `buildRekapWorkbook` function turns that bundle into a 6-sheet `xlsx` workbook (reusing the `xlsx` package already installed for bulk-import reading). A new `rekap:exportExcel` IPC handler wraps that with a native save dialog, mirroring the existing `inventory:importProducts` handler's open-dialog pattern. The renderer gets two new `ReportTable` sections and one export button — no new UI primitives.

**Tech Stack:** Electron + React (renderer), better-sqlite3 + Drizzle ORM (main process), `xlsx` (SheetJS), Vitest, TypeScript.

## Global Constraints

- Money crosses the IPC boundary as Rupiah via explicit per-field `toRupiah`/`toCents` mapping in `ipc/rekap.ts` — this handler has no generic pass-through, every field is hand-mapped, so new fields need their own mapping lines too.
- All IPC handlers stay guarded by `getCurrentUser()`, matching every existing handler.
- `getStockValue` is **not** date-filtered — it always reflects current stock, independent of the page's `from`/`to` range.
- `getSalesHistory` returns **all** statuses (`selesai` and `dibatalkan`), one row per transaction (not per line-item), matching `/history`'s default unfiltered view.
- Spec: `docs/superpowers/specs/2026-08-09-rekap-stock-value-excel-export-design.md`.

---

### Task 1: Backend — `main/rekap.ts` new queries + `buildRekapWorkbook` (TDD)

**Files:**
- Modify: `desktop-node/src/main/rekap.ts`
- Test: `desktop-node/src/main/rekap.test.ts`

**Interfaces:**
- Produces: `StockValueRow { namaItem, kodeItem, stok, hargaPokok, nilai }`, `StockValueSummary { totalNilai, produk: StockValueRow[] }`, `getStockValue(db): StockValueSummary`, `SalesHistoryRow { id, createdAt, namaPelanggan, metodePembayaran, status, total, dibayar }`, `getSalesHistory(db, {from, to}): SalesHistoryRow[]`, `buildRekapWorkbook(rekap: RekapResult): XLSX.WorkBook`. `RekapResult` gains `stockValue: StockValueSummary` and `salesHistory: SalesHistoryRow[]`. These names/shapes are what Task 2 (IPC) imports.

- [ ] **Step 1: Add the new tests**

In `desktop-node/src/main/rekap.test.ts`, update the top import block:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import XLSX from 'xlsx'
import { createDb } from './db/migrate'
import { categories, products, productUnits, purchases, sales, saleItems, suppliers, users } from './db/schema'
import { getRekap, getStockValue, getSalesHistory, buildRekapWorkbook } from './rekap'
```

Add these new `describe` blocks anywhere after `seedBase`/`insertSale` are defined (e.g. right before the existing `describe('getRekap', ...)` block, or after it — placement doesn't matter, just keep them outside the existing block):

```typescript
describe('getStockValue', () => {
  it('computes nilai as stok * hargaPokok and totalNilai as the sum, sorted by nilai descending', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    const result = getStockValue(db)
    // Kopi: 100 * 1000_00 = 100000_00; Gula: 100 * 12000_00 = 1200000_00
    expect(result.produk).toEqual([
      { namaItem: 'Gula Pasir', kodeItem: 'GULA1', stok: 100, hargaPokok: 12000_00, nilai: 1200000_00 },
      { namaItem: 'Kopi Kapal Api', kodeItem: 'KOPI1', stok: 100, hargaPokok: 1000_00, nilai: 100000_00 },
    ])
    expect(result.totalNilai).toBe(1300000_00)
  })

  it('excludes products with zero stock and inactive products', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)
    const now = new Date()

    db.insert(products)
      .values([
        {
          id: 3,
          kodeItem: 'HABIS1',
          barcode: null,
          namaItem: 'Stok Habis',
          categoryId: null,
          satuan: 'PCS',
          hargaPokok: 5000_00,
          hargaJual: 6000_00,
          stok: 0,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 4,
          kodeItem: 'NONAKTIF1',
          barcode: null,
          namaItem: 'Produk Nonaktif',
          categoryId: null,
          satuan: 'PCS',
          hargaPokok: 5000_00,
          hargaJual: 6000_00,
          stok: 50,
          isActive: false,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run()

    const result = getStockValue(db)
    expect(result.produk.map((p) => p.namaItem)).toEqual(['Gula Pasir', 'Kopi Kapal Api'])
  })
})

describe('getSalesHistory', () => {
  it('returns both selesai and dibatalkan sales within range, ordered newest first', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    insertSale(db, {
      id: 1,
      metodePembayaran: 'tunai',
      status: 'selesai',
      total: 50000_00,
      dibayar: 50000_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 50000_00, hargaPokok: 1000_00, subtotal: 50000_00 }],
    })
    insertSale(db, {
      id: 2,
      metodePembayaran: 'tunai',
      status: 'dibatalkan',
      total: 20000_00,
      dibayar: 20000_00,
      createdAt: new Date(2026, 0, 16, 10, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 20000_00, hargaPokok: 1000_00, subtotal: 20000_00 }],
    })

    const result = getSalesHistory(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.map((r) => ({ id: r.id, status: r.status }))).toEqual([
      { id: 2, status: 'dibatalkan' },
      { id: 1, status: 'selesai' },
    ])
  })

  it('excludes sales outside the date range', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    insertSale(db, {
      id: 1,
      metodePembayaran: 'tunai',
      status: 'selesai',
      total: 50000_00,
      dibayar: 50000_00,
      createdAt: new Date(2025, 5, 1, 10, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 50000_00, hargaPokok: 1000_00, subtotal: 50000_00 }],
    })

    const result = getSalesHistory(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result).toEqual([])
  })
})

describe('buildRekapWorkbook', () => {
  it('produces a workbook with all six expected sheets', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    const rekap = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    const workbook = buildRekapWorkbook(rekap)

    expect(workbook.SheetNames).toEqual([
      'Riwayat Transaksi',
      'Laba per Kategori',
      'Laba per Hari',
      'Produk Terlaris',
      'Pembelian per Supplier',
      'Nilai Stock',
    ])
  })

  it('converts money fields from cents to Rupiah in the Nilai Stock sheet', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    const rekap = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    const workbook = buildRekapWorkbook(rekap)
    const sheet = workbook.Sheets['Nilai Stock']
    const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]

    const gula = rows.find((r) => r.Produk === 'Gula Pasir')
    expect(gula).toMatchObject({ 'Harga Pokok': 12000, Nilai: 1200000 })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd desktop-node
npx vitest run src/main/rekap.test.ts
```

Expected: FAIL — `getStockValue`/`getSalesHistory`/`buildRekapWorkbook` are not exported from `./rekap` yet.

- [ ] **Step 3: Implement in `rekap.ts`**

Update the top import line:

```typescript
import { and, desc, eq, gt, gte, lte, sql } from 'drizzle-orm'
```

Add `import XLSX from 'xlsx'` below it.

Add `products` alongside the other already-imported schema tables if not already present (it already is, per the existing `saleItemRows` query).

Add these new interfaces near the top, after `PembelianPerSupplierRow`:

```typescript
export interface StockValueRow {
  namaItem: string
  kodeItem: string
  stok: number
  hargaPokok: number
  nilai: number
}

export interface StockValueSummary {
  totalNilai: number
  produk: StockValueRow[]
}

export interface SalesHistoryRow {
  id: number
  createdAt: string
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}
```

Update `RekapResult`:

```typescript
export interface RekapResult {
  summary: RekapSummary
  labaPerKategori: LabaPerKategoriRow[]
  labaPerHari: LabaPerHariRow[]
  produkTerlaris: ProdukTerlarisRow[]
  pembelianPerSupplier: PembelianPerSupplierRow[]
  stockValue: StockValueSummary
  salesHistory: SalesHistoryRow[]
}
```

Add these two functions after `getRekap` (or anywhere at module scope — placement doesn't matter):

```typescript
export function getStockValue(db: BetterSQLite3Database<typeof schema>): StockValueSummary {
  const rows = db
    .select({
      namaItem: products.namaItem,
      kodeItem: products.kodeItem,
      stok: products.stok,
      hargaPokok: products.hargaPokok,
    })
    .from(products)
    .where(and(eq(products.isActive, true), gt(products.stok, 0)))
    .all()

  const produk: StockValueRow[] = rows
    .map((row) => ({ ...row, nilai: row.stok * row.hargaPokok }))
    .sort((a, b) => b.nilai - a.nilai)

  const totalNilai = produk.reduce((sum, row) => sum + row.nilai, 0)

  return { totalNilai, produk }
}

export function getSalesHistory(
  db: BetterSQLite3Database<typeof schema>,
  input: { from: string; to: string },
): SalesHistoryRow[] {
  const rangeStart = new Date(`${input.from}T00:00:00`)
  const rangeEnd = new Date(`${input.to}T23:59:59`)

  return db
    .select({
      id: sales.id,
      createdAt: sales.createdAt,
      namaPelanggan: sales.namaPelanggan,
      metodePembayaran: sales.metodePembayaran,
      status: sales.status,
      total: sales.total,
      dibayar: sales.dibayar,
    })
    .from(sales)
    .where(and(gte(sales.createdAt, rangeStart), lte(sales.createdAt, rangeEnd)))
    .orderBy(desc(sales.createdAt))
    .all()
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

function toRupiahExport(cents: number): number {
  return cents / 100
}

export function buildRekapWorkbook(rekap: RekapResult): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()

  const sheets: { name: string; rows: Record<string, unknown>[] }[] = [
    {
      name: 'Riwayat Transaksi',
      rows: rekap.salesHistory.map((row) => ({
        Tanggal: new Date(row.createdAt).toLocaleString('id-ID'),
        Pelanggan: row.namaPelanggan ?? '-',
        Metode: row.metodePembayaran,
        Status: row.status,
        Total: toRupiahExport(row.total),
        Dibayar: toRupiahExport(row.dibayar),
      })),
    },
    {
      name: 'Laba per Kategori',
      rows: rekap.labaPerKategori.map((row) => ({
        Kategori: row.categoryName,
        Omzet: toRupiahExport(row.omzet),
        Laba: toRupiahExport(row.laba),
      })),
    },
    {
      name: 'Laba per Hari',
      rows: rekap.labaPerHari.map((row) => ({
        Tanggal: row.tanggal,
        Omzet: toRupiahExport(row.omzet),
        Laba: toRupiahExport(row.laba),
      })),
    },
    {
      name: 'Produk Terlaris',
      rows: rekap.produkTerlaris.map((row) => ({
        Produk: row.namaItem,
        'Qty Terjual': row.qtyTerjual,
        'Total Penjualan': toRupiahExport(row.totalPenjualan),
      })),
    },
    {
      name: 'Pembelian per Supplier',
      rows: rekap.pembelianPerSupplier.map((row) => ({
        Supplier: row.supplierName,
        'Total Pembelian': toRupiahExport(row.totalPembelian),
      })),
    },
    {
      name: 'Nilai Stock',
      rows: rekap.stockValue.produk.map((row) => ({
        'Kode Item': row.kodeItem,
        Produk: row.namaItem,
        Stok: row.stok,
        'Harga Pokok': toRupiahExport(row.hargaPokok),
        Nilai: toRupiahExport(row.nilai),
      })),
    },
  ]

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31))
  }

  return workbook
}
```

Finally, update `getRekap`'s return statement to add the two new fields:

```typescript
  return {
    summary: {
      omzetTunai: omzetTunaiRow?.total ?? 0,
      piutangBeredar: piutangRow?.piutang ?? 0,
      jumlahTransaksi: jumlahTransaksiRow?.count ?? 0,
      labaKotor,
    },
    labaPerKategori,
    labaPerHari,
    produkTerlaris,
    pembelianPerSupplier,
    stockValue: getStockValue(db),
    salesHistory: getSalesHistory(db, input),
  }
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
npx vitest run src/main/rekap.test.ts
```

Expected: PASS, all tests green (existing tests included — none of them assert a full `toEqual` on the whole `result` object, so the two new `RekapResult` fields don't break them).

- [ ] **Step 5: Commit**

```bash
git add desktop-node/src/main/rekap.ts desktop-node/src/main/rekap.test.ts
git commit -m "feat: add stock valuation and sales history queries, Excel workbook builder"
```

---

### Task 2: IPC — `main/ipc/rekap.ts`

**Files:**
- Modify: `desktop-node/src/main/ipc/rekap.ts`

**Interfaces:**
- Consumes: `getRekap`, `buildRekapWorkbook` from Task 1.
- Produces: extended `rekap:getRekap` response (adds `stockValue`, `salesHistory`), new `rekap:exportExcel(input): Promise<string | null>` channel — consumed by Task 3 (preload).

- [ ] **Step 1: Replace the file**

Replace the full contents of `desktop-node/src/main/ipc/rekap.ts` with:

```typescript
import { dialog, ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import XLSX from 'xlsx'
import * as schema from '../db/schema'
import { getRekap, buildRekapWorkbook } from '../rekap'
import { getMainWindow } from '../index'
import { getCurrentUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

export function registerRekapIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('rekap:getRekap', (_event, input: { from: string; to: string }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const result = getRekap(db, input)

    return {
      summary: {
        omzetTunai: toRupiah(result.summary.omzetTunai),
        piutangBeredar: toRupiah(result.summary.piutangBeredar),
        jumlahTransaksi: result.summary.jumlahTransaksi,
        labaKotor: toRupiah(result.summary.labaKotor),
      },
      labaPerKategori: result.labaPerKategori.map((row) => ({
        categoryName: row.categoryName,
        omzet: toRupiah(row.omzet),
        laba: toRupiah(row.laba),
      })),
      labaPerHari: result.labaPerHari.map((row) => ({
        tanggal: row.tanggal,
        omzet: toRupiah(row.omzet),
        laba: toRupiah(row.laba),
      })),
      produkTerlaris: result.produkTerlaris.map((row) => ({
        namaItem: row.namaItem,
        qtyTerjual: row.qtyTerjual,
        totalPenjualan: toRupiah(row.totalPenjualan),
      })),
      pembelianPerSupplier: result.pembelianPerSupplier.map((row) => ({
        supplierName: row.supplierName,
        totalPembelian: toRupiah(row.totalPembelian),
      })),
      stockValue: {
        totalNilai: toRupiah(result.stockValue.totalNilai),
        produk: result.stockValue.produk.map((row) => ({
          namaItem: row.namaItem,
          kodeItem: row.kodeItem,
          stok: row.stok,
          hargaPokok: toRupiah(row.hargaPokok),
          nilai: toRupiah(row.nilai),
        })),
      },
      salesHistory: result.salesHistory.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        namaPelanggan: row.namaPelanggan,
        metodePembayaran: row.metodePembayaran,
        status: row.status,
        total: toRupiah(row.total),
        dibayar: toRupiah(row.dibayar),
      })),
    }
  })

  ipcMain.handle('rekap:exportExcel', async (_event, input: { from: string; to: string }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const window = getMainWindow()
    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    const result = await dialog.showSaveDialog(window, {
      defaultPath: `rekap-${input.from}-${input.to}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const rekap = getRekap(db, input)
    const workbook = buildRekapWorkbook(rekap)
    XLSX.writeFile(workbook, result.filePath)

    return result.filePath
  })
}
```

- [ ] **Step 2: Typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: errors in `preload/index.ts`, `env.d.ts`, `Rekap.tsx` (not yet updated — Tasks 3-4). No errors should point at `main/ipc/rekap.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add desktop-node/src/main/ipc/rekap.ts
git commit -m "feat: extend rekap:getRekap with stock value/sales history, add rekap:exportExcel"
```

---

### Task 3: Preload + renderer ambient types

**Files:**
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: IPC channels from Task 2.
- Produces: `window.api.rekap.getRekap(input): Promise<{...extended shape...}>`, `window.api.rekap.exportExcel(input): Promise<string | null>` — consumed by Task 4 (`Rekap.tsx`).

- [ ] **Step 1: Update `preload/index.ts`**

Replace:

```typescript
  rekap: {
    getRekap: (input: { from: string; to: string }) => invoke('rekap:getRekap', input),
  },
```

with:

```typescript
  rekap: {
    getRekap: (input: { from: string; to: string }) => invoke('rekap:getRekap', input),
    exportExcel: (input: { from: string; to: string }) => invoke('rekap:exportExcel', input),
  },
```

- [ ] **Step 2: Update `env.d.ts`**

Replace:

```typescript
      rekap: {
        getRekap: (input: { from: string; to: string }) => Promise<{
          summary: {
            omzetTunai: number
            piutangBeredar: number
            jumlahTransaksi: number
            labaKotor: number
          }
          labaPerKategori: { categoryName: string; omzet: number; laba: number }[]
          labaPerHari: { tanggal: string; omzet: number; laba: number }[]
          produkTerlaris: { namaItem: string; qtyTerjual: number; totalPenjualan: number }[]
          pembelianPerSupplier: { supplierName: string; totalPembelian: number }[]
        }>
      }
```

with:

```typescript
      rekap: {
        getRekap: (input: { from: string; to: string }) => Promise<{
          summary: {
            omzetTunai: number
            piutangBeredar: number
            jumlahTransaksi: number
            labaKotor: number
          }
          labaPerKategori: { categoryName: string; omzet: number; laba: number }[]
          labaPerHari: { tanggal: string; omzet: number; laba: number }[]
          produkTerlaris: { namaItem: string; qtyTerjual: number; totalPenjualan: number }[]
          pembelianPerSupplier: { supplierName: string; totalPembelian: number }[]
          stockValue: {
            totalNilai: number
            produk: { namaItem: string; kodeItem: string; stok: number; hargaPokok: number; nilai: number }[]
          }
          salesHistory: {
            id: number
            createdAt: string
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
          }[]
        }>
        exportExcel: (input: { from: string; to: string }) => Promise<string | null>
      }
```

- [ ] **Step 3: Commit**

```bash
git add desktop-node/src/preload/index.ts desktop-node/src/renderer/env.d.ts
git commit -m "feat: update preload/env types for stock value, sales history, Excel export"
```

---

### Task 4: Renderer UI — `Rekap.tsx`

**Files:**
- Modify: `desktop-node/src/renderer/pages/Rekap.tsx`

**Interfaces:**
- Consumes: `window.api.rekap.getRekap`/`exportExcel` from Task 3.

- [ ] **Step 1: Add the two new row-shape interfaces**

After the existing `PembelianPerSupplierRow` interface, add:

```typescript
interface StockValueRow {
  namaItem: string
  kodeItem: string
  stok: number
  hargaPokok: number
  nilai: number
}

interface SalesHistoryRow {
  id: number
  createdAt: string
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}
```

- [ ] **Step 2: Add state and update `load`**

Add these state declarations alongside the existing ones (after `pembelianPerSupplier`):

```typescript
  const [stockValue, setStockValue] = useState<{ totalNilai: number; produk: StockValueRow[] } | null>(null)
  const [salesHistory, setSalesHistory] = useState<SalesHistoryRow[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
```

Update the `load` function's `.then(...)` callback to also set the two new pieces of state:

```typescript
  function load(rangeFrom: string, rangeTo: string) {
    window.api.rekap.getRekap({ from: rangeFrom, to: rangeTo }).then((result) => {
      setSummary(result.summary)
      setLabaPerKategori(result.labaPerKategori)
      setLabaPerHari(result.labaPerHari)
      setProdukTerlaris(result.produkTerlaris)
      setPembelianPerSupplier(result.pembelianPerSupplier)
      setStockValue(result.stockValue)
      setSalesHistory(result.salesHistory)
    })
  }
```

- [ ] **Step 3: Add the export handler**

Add this function near `submitFilter`:

```typescript
  function exportExcel() {
    setExporting(true)
    setExportError(null)
    setExportMessage(null)

    window.api.rekap
      .exportExcel({ from, to })
      .then((path) => {
        if (path) {
          setExportMessage(`Tersimpan ke ${path}`)
        }
      })
      .catch((err) => setExportError(err instanceof Error ? err.message : 'Gagal mengekspor'))
      .finally(() => setExporting(false))
  }
```

- [ ] **Step 4: Add the two new column definitions**

Add alongside the existing column definitions (after `pembelianPerSupplierColumns`):

```typescript
  const stockValueColumns: Column<StockValueRow>[] = [
    { key: 'kodeItem', name: 'Kode', width: 100 },
    { key: 'namaItem', name: 'Produk' },
    { key: 'stok', name: 'Stok', width: 90 },
    {
      key: 'hargaPokok',
      name: 'Harga Pokok',
      width: 130,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.hargaPokok)}</span>,
    },
    {
      key: 'nilai',
      name: 'Nilai',
      width: 150,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.nilai)}</span>,
    },
  ]

  const salesHistoryColumns: Column<SalesHistoryRow>[] = [
    {
      key: 'createdAt',
      name: 'Tanggal',
      width: 160,
      renderCell: ({ row }) => new Date(row.createdAt).toLocaleString('id-ID'),
    },
    { key: 'namaPelanggan', name: 'Pelanggan', renderCell: ({ row }) => row.namaPelanggan ?? '-' },
    {
      key: 'metodePembayaran',
      name: 'Metode',
      width: 100,
      renderCell: ({ row }) => (row.metodePembayaran === 'bon' ? 'Bon' : 'Tunai'),
    },
    {
      key: 'status',
      name: 'Status',
      width: 110,
      renderCell: ({ row }) => (row.status === 'dibatalkan' ? 'Dibatalkan' : 'Selesai'),
    },
    {
      key: 'total',
      name: 'Total',
      width: 120,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.total)}</span>,
    },
    {
      key: 'dibayar',
      name: 'Dibayar',
      width: 120,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.dibayar)}</span>,
    },
  ]
```

- [ ] **Step 5: Update the JSX**

Add an "Export Excel" button to the filter `<form>`, right after the existing "Terapkan" button:

```typescript
          <Button type="submit" variant="secondary">
            Terapkan
          </Button>
          <Button type="button" variant="outline" onClick={exportExcel} disabled={exporting}>
            Export Excel
          </Button>
```

Right after the closing `</form>`, add the export feedback messages:

```typescript
        {exportError && (
          <p role="alert" className="text-sm text-destructive">
            {exportError}
          </p>
        )}
        {exportMessage && <p className="text-sm text-muted-foreground">{exportMessage}</p>}
```

Change the summary-cards grid from 4 to 5 columns and add the new card as the 5th:

```typescript
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader>
              <CardDescription>Omzet Tunai</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.omzetTunai ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Piutang Bon Beredar</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.piutangBeredar ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Jumlah Transaksi</CardDescription>
              <CardTitle className="text-2xl">{summary?.jumlahTransaksi ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Laba Kotor</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.labaKotor ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Total Nilai Stock</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(stockValue?.totalNilai ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
        </div>
```

Add a full-width Riwayat Transaksi table right after that summary-cards `<div>`. Note the file has two `<div className="grid gap-4 lg:grid-cols-2">` blocks (one wrapping `ReportTable<ProdukTerlarisRow>`/`ReportTable<PembelianPerSupplierRow>`, one wrapping `ReportTable<LabaPerKategoriRow>`/`ReportTable<LabaPerHariRow>`) — insert before the **first** one (the Produk Terlaris / Pembelian per Supplier row):

```typescript
        <ReportTable<SalesHistoryRow>
          title="Riwayat Transaksi"
          columns={salesHistoryColumns}
          rows={salesHistory}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada transaksi pada rentang ini."
        />
```

Add a full-width Nilai Stock table at the very end, after the last existing `<div className="grid gap-4 lg:grid-cols-2">` row (Laba per Kategori / Laba per Hari), still inside the outer `<div className="flex flex-1 flex-col gap-4 p-4">`:

```typescript
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Nilai stock selalu berdasarkan data terkini, tidak mengikuti filter tanggal di atas.</p>
          <ReportTable<StockValueRow>
            title="Nilai Stock"
            columns={stockValueColumns}
            rows={stockValue?.produk ?? []}
            rowKey={(row) => row.kodeItem}
            emptyMessage="Belum ada produk dengan stok."
          />
        </div>
```

- [ ] **Step 6: Typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: no errors anywhere in the project.

- [ ] **Step 7: Manually verify in the running app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev
```

Log in, open Rekap, and confirm: the 5th "Total Nilai Stock" card shows a number, the Nilai Stock table lists products sorted by value descending and doesn't change when you change the date filter, the Riwayat Transaksi table shows transactions in range, and clicking "Export Excel" opens a native save dialog, writes a file, and shows the "Tersimpan ke ..." confirmation. Open the resulting `.xlsx` file and confirm it has 6 sheets with the expected data.

If you cannot get the Electron dev app running in this environment (a known pre-existing `better-sqlite3` ABI issue — `npm run rebuild:electron` and `npm run dev` need the module built for Electron's Node ABI, which is incompatible with the CLI Node ABI `npm test`/`npx tsc` need), that's acceptable: report DONE_WITH_CONCERNS explaining exactly what you could and couldn't verify, and afterwards run `npm run rebuild:node` from `desktop-node/` to restore the CLI-compatible build before finishing, so the test suite works for whoever picks this up next.

- [ ] **Step 8: Run the full test suite**

```bash
cd desktop-node
npm test
```

Expected: all tests pass. (If you ran `npm run rebuild:electron` in Step 7, run `npm run rebuild:node` first — the two builds are mutually exclusive on this machine.)

- [ ] **Step 9: Commit**

```bash
git add desktop-node/src/renderer/pages/Rekap.tsx
git commit -m "feat: add stock value and sales history sections plus Excel export to Rekap"
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

Expected: all test files pass, including `rekap.test.ts` and every previously-passing test.

- [ ] **Step 3: Commit** (only if Step 1/2 required any fixes; otherwise skip — nothing to commit)
