# Rekap: Nilai Stock & Export Excel — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Extends the existing Rekap module (`main/rekap.ts`, `main/ipc/rekap.ts`, `renderer/pages/Rekap.tsx`) with two additive features: (1) a current-stock valuation report, (2) a transaction-history table plus a whole-page Excel export.

## Why

Two requests from the user:
- "Rekap Produk yang Ada" — they want to see the total value of stock currently on hand, not just sales/profit numbers.
- "Export Excel (Riwayat Transaksi masuk ke rekap)" — transaction history (currently only on the separate `/history` page) should also be visible from Rekap, and the whole Rekap page should be exportable to Excel.

Both are additive to the existing Rekap page — no existing report, route, or the `/history` page itself changes shape.

## 1. Backend — `main/rekap.ts`

Two new query functions, both called from inside `getRekap` so the renderer keeps getting everything in one round trip (matching the existing pattern — `getRekap` already bundles 5 things into one `RekapResult`).

```typescript
export interface StockValueRow {
  namaItem: string
  kodeItem: string
  stok: number
  hargaPokok: number
  nilai: number // stok * hargaPokok
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

- **`getStockValue(db): StockValueSummary`** — all `isActive` products with `stok > 0`, `nilai = stok * hargaPokok` (cost-basis, per user's explicit choice — this answers "how much capital is tied up in the warehouse", not potential resale value), sorted by `nilai` descending. `totalNilai` is the sum across all returned rows. **Not date-filtered** — this is a snapshot of current stock, unaffected by the page's date-range filter, per explicit confirmation (computing a historical stock valuation would require stock-movement history the schema doesn't track, and was explicitly ruled out as unnecessary complexity).
- **`getSalesHistory(db, {from, to}): SalesHistoryRow[]`** — all `sales` rows (both `selesai` and `dibatalkan` — matching `/history`'s default unfiltered view) with `createdAt` in range, flat one-row-per-transaction (not per line-item, per explicit choice — keeps the export from ballooning on stores with many items per receipt). No pagination: both the embedded table and the export want the complete range, and `ReportTable`'s underlying `react-data-grid` is already virtualized so a few thousand rows render fine.
- `RekapResult` gains `stockValue: StockValueSummary` and `salesHistory: SalesHistoryRow[]`.

**`ipc/rekap.ts`'s existing `rekap:getRekap` handler must be extended too**, not just `getRekap` itself — this handler currently hand-maps every money field from cents to Rupiah field-by-field (there's no generic pass-through), so `stockValue.totalNilai`/`stockValue.produk[].hargaPokok`/`.nilai` and `salesHistory[].total`/`.dibayar` each need their own `toRupiah(...)` mapping added alongside the existing ones, or the on-screen tables will show values 100x too large.

## 2. Excel export — `main/ipc/rekap.ts` + `main/rekap.ts`

New handler, modeled directly on the existing `inventory:importProducts` handler's save/open-dialog pattern (`main/ipc/inventory.ts`):

```typescript
ipcMain.handle('rekap:exportExcel', async (_event, input: { from: string; to: string }) => {
  if (!getCurrentUser()) throw new Error('Silakan login terlebih dahulu.')

  const window = getMainWindow()
  if (!window) throw new Error('Jendela aplikasi tidak ditemukan.')

  const result = await dialog.showSaveDialog(window, {
    defaultPath: `rekap-${input.from}-${input.to}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  if (result.canceled || !result.filePath) return null

  const rekap = getRekap(db, input)
  const workbook = buildRekapWorkbook(rekap)
  XLSX.writeFile(workbook, result.filePath)

  return result.filePath
})
```

`buildRekapWorkbook(rekap: RekapResult)` — new exported function in `main/rekap.ts`, next to `getRekap`. Uses the `xlsx` package already installed for bulk-import reading (`inventory-bulk.ts`) — no new dependency. One `XLSX.utils.json_to_sheet(...)` per section, appended via `XLSX.utils.book_append_sheet`, six sheets total: **Riwayat Transaksi**, **Laba per Kategori**, **Laba per Hari**, **Produk Terlaris**, **Pembelian per Supplier**, **Nilai Stock**. Sheet names are passed through `.slice(0, 31)` (Excel's hard sheet-name-length limit) even though none of ours are close — a one-line guard against a silent hard crash is cheap insurance for a "just works" export button. Money fields are written as plain Rupiah numbers, converted once inside `buildRekapWorkbook` (consistent with every other IPC boundary in this app using `toRupiah`/`toCents`).

## 3. Renderer — `renderer/pages/Rekap.tsx`

- **Nilai Stock**: a 5th summary `Card` ("Total Nilai Stock") added to the existing 4-card row (Omzet Tunai / Piutang / Jumlah Transaksi / Laba Kotor) — reuses the existing card pattern rather than inventing a new "total" treatment. Below the existing table sections, a new `ReportTable<StockValueRow>` (namaItem, stok, hargaPokok formatted via `formatRupiah`, nilai formatted via `formatRupiah`) — reuses the existing `ReportTable` component, no new UI primitive.
- **Riwayat Transaksi**: a new `ReportTable<SalesHistoryRow>` (tanggal, pelanggan, metode bayar, status, total, dibayar) alongside the other date-scoped tables.
- **Export Excel button**: one button in the filter row next to "Terapkan" (whole-page export, not per-section — matches the confirmed scope of one file with all six sheets). Calls `window.api.rekap.exportExcel({ from, to })`. On a returned path, shows a brief inline confirmation message ("Tersimpan ke {path}"). On `null` (dialog cancelled by user), does nothing — no error shown, since cancelling isn't a failure.

## Out of Scope

- Any change to the `/history` page itself (search, cancel-transaction, pagination) — it stays exactly as it is; Rekap's new table is a separate, simpler, read-only view scoped to the date range.
- Per-line-item transaction detail in the export or the embedded table (explicitly ruled out in favor of one-row-per-transaction).
- Historical/point-in-time stock valuation (computing what stock was worth on a past date) — current stock only.
- Per-section export buttons — only the single whole-page export exists.
