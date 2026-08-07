# Pending Payment (Bon) — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only — completes the Kasir module (closes out Fase 2) by porting `resources/js/pages/kasir/bon-payment.tsx` and `app/Http/Controllers/BonPaymentController.php`.

## Why

`KasirHistory.tsx` (Slice 3) deliberately hid the "Bayar Bon" button because its target page didn't exist yet. This slice builds that page, wiring installment payments against unpaid `bon` sales.

## Terminology

Data and code keep the existing `bon` naming (`sales.metodePembayaran: 'bon'`, `bonPayments` table, `recordBonPayment` function, etc.) — unchanged from the already-shipped schema and Slice 1-3 code. Only **user-facing text** in this slice's scope uses "Pending Payment" instead of "Bon":

| Where | Current (already shipped) | New |
|---|---|---|
| History → Metode column | `Bon (nama)` | `Pending Payment (nama)` |
| History → Aksi button (new) | — | `Pending Payment` |
| New page → title | — | `Pending Payment — {nama}` |
| New page → browser title | — | `Pending Payment #{id}` |
| New page → paid-off message | — | `Pending payment ini sudah lunas.` |

Everything else (Total Transaksi, Sudah Dibayar, Sisa Piutang, Riwayat Pembayaran, Simpan Pembayaran, Lunas/Sisa Rp badges) is unaffected — never said "Bon" in the first place.

## Architecture

Same three-layer pattern as History (Slice 3):
1. Pure, unit-tested business logic in `main/kasir.ts`.
2. IPC handlers in `ipc/kasir.ts` doing Rupiah↔cents conversion at the boundary.
3. A renderer page ported near-verbatim from the Laravel/Inertia source, swapping `router.post`/`Link` for `window.api` calls and `react-router-dom`'s `useNavigate`/`useParams`.

## Business Logic

### `recordBonPayment(db, saleId, jumlahCents, keterangan)` — `main/kasir.ts`

Validates and applies one installment payment, inside a single `db.transaction`:

1. Sale must exist → else `"Transaksi tidak ditemukan."`
2. `sale.metodePembayaran === 'bon' && sale.status === 'selesai'` → else `"Transaksi ini bukan bon aktif."`
3. `jumlahCents` must be a positive integer → else `"Jumlah bayar harus lebih dari 0."`
4. `keterangan` (nullable) max 500 chars → else `"Keterangan maksimal 500 karakter."`
5. `sisaPiutang = sale.total - sale.dibayar`; `jumlahCents > sisaPiutang` → else `"Jumlah bayar melebihi sisa piutang."`
6. On success: insert into `bonPayments` (`tanggal` = today as `YYYY-MM-DD` string, `keterangan` = trimmed value or null), then `sales.dibayar += jumlahCents`.

Mirrors `BonPaymentController::store` + `StoreBonPaymentRequest` validation rules exactly (`jumlah: required|numeric|min:0.01` → positive-cents check; `keterangan: nullable|string|max:500`).

Unit tests (Vitest, alongside `checkout`/`cancelSale` in `main/kasir.test.ts`): happy path (dibayar increments, bonPayments row inserted with correct tanggal), rejects non-bon sale, rejects dibatalkan sale, rejects non-positive jumlah, rejects jumlah > sisaPiutang, rejects keterangan > 500 chars, allows null keterangan, allows exact-sisaPiutang payment (brings to Lunas).

## IPC — `ipc/kasir.ts`

### `kasir:getSaleDetail(saleId)`

Read-only. Returns sale + line items (for the item summary line) + full bon payment history, all money converted to Rupiah:

```typescript
{
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number       // Rupiah
  dibayar: number      // Rupiah
  createdAt: string    // ISO
  items: { id: number; qty: number; satuan: string; namaItem: string }[]
  bonPayments: { id: number; jumlah: number; tanggal: string; keterangan: string | null }[]
}
```

Throws `"Transaksi tidak ditemukan."` if the sale doesn't exist. Separate from `getReceipt` (which is shaped for printing, not this page's summary+history view).

### `kasir:recordBonPayment(saleId, jumlah, keterangan)`

Converts `jumlah` (Rupiah) to cents, calls `recordBonPayment`, returns nothing. On success the page refetches `getSaleDetail`.

### Preload (`preload/index.ts`) + types (`renderer/env.d.ts`)

Add `getSaleDetail(saleId)` and `recordBonPayment(saleId, jumlah, keterangan)` to `window.api.kasir`, matching the existing pattern for `getReceiptForSale`/`cancelSale`.

## Components to Port (verbatim, like `select.tsx`/`use-available-height.ts` in Slice 3)

- `src/renderer/components/ui/card.tsx` ← `resources/js/components/ui/card.tsx` (`Card`, `CardHeader`, `CardTitle`, `CardDescription`; `CardContent`/`CardFooter` included for completeness even though this page only needs the first three).
- `src/renderer/components/report-table.tsx` ← `resources/js/components/report-table.tsx` (generic `DataGrid` wrapper: title + optional action + auto-height based on row count `min(320, max(120, 42 + rows.length * 35))`).
- `src/renderer/components/input-error.tsx` ← `resources/js/components/input-error.tsx`.

## Renderer Page — `src/renderer/pages/BonPayment.tsx`

Route: `/bon-payment/:saleId` (added to `App.tsx`).

Ported from `bon-payment.tsx`:
- Auth guard identical to `Kasir.tsx`/`KasirHistory.tsx` (`window.api.auth.me()`, redirect to `/login` if null).
- On mount (and after a successful payment), `window.api.kasir.getSaleDetail(saleId)` → local state. `saleId` comes from `useParams<{ saleId: string }>()`.
- Header: title `Pending Payment — {namaPelanggan ?? \`Struk #${id}\`}`, item summary line (`{namaItem} x{qty}`, joined), formatted `createdAt`. "Kembali" button navigates to `/history`.
- 3 `Card`s: Total Transaksi, Sudah Dibayar, Sisa Piutang (`max(sisaPiutang, 0)`, amber if > 0 else green — same `cn()` pattern as `KasirHistory`'s status column).
- `canPay = status === 'selesai' && sisaPiutang > 0`. When true: form with `jumlah` (number input, autoFocus), `keterangan` (optional text), "Simpan Pembayaran" submit button, per-field error display via `InputError`. On submit: call `recordBonPayment`, clear the form and refetch on success, set an error state on failure (reusing the `role="alert"` pattern from `KasirHistory.tsx` rather than porting Inertia's per-field `errors` object — this app's IPC errors are single messages, not field-keyed).
- When `!canPay && status === 'selesai'`: `Pending payment ini sudah lunas.` message.
- `ReportTable` showing payment history: Tanggal / Jumlah (right-aligned Rupiah) / Keterangan (`-` if null), empty message `"Belum ada pembayaran."`.

## `KasirHistory.tsx` Changes

Aksi column gains a "Pending Payment" button, shown when `row.metodePembayaran === 'bon' && row.status === 'selesai' && (row.total - row.dibayar) > 0`, navigating to `/bon-payment/${row.id}`. Sits alongside the existing conditional "Batalkan" and always-present "Cetak" buttons (order: Pending Payment, Batalkan, Cetak — Pending Payment first since it's the primary action for an unpaid bon row).

Metode column's `Bon (${row.namaPelanggan})` label changes to `Pending Payment (${row.namaPelanggan})`.

## Out of Scope

- No changes to `checkout`/`cancelSale` logic — `cancelSale` already rejects sales with existing `bonPayments` rows, unaffected by this slice.
- No changes to the `bon_payments` DB schema — it was already created in the Fase 1 skeleton migration.
- No renaming of `bon`-prefixed code identifiers, types, or DB columns/tables (see Terminology above).
