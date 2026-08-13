# Buku Kas Harian — Design Spec

**Status:** Step 1 of 5 shipped (commit `a81fd4e`). Steps 2–5 not started.
**Scope:** `desktop-node/`. Turn the owner's hand-kept daily cash book into something the app produces from the transactions it already records.
**Origin:** The owner pasted a real cash book covering 01–13 August 2026. This document records what was reverse-engineered from it, so nobody has to derive it twice.

## What the owner actually keeps

A **cash book** (buku kas), not a profit & loss. Its subject is *the money in the drawer*, so a sale paid by QRIS is subtracted from takings rather than added.

Columns, in order:

```
TGL | pendapatan | POT FAKTUR | QR/TRF/dana | BON | selisih − | selisih + | keterangan | pengeluaran | bersih | SISA UANG
```

Per-row formula, recovered by solving the rows and confirmed against the sheet's own totals:

```
bersih    = pendapatan − QR/TRF/dana + BON + selisih(+) − pengeluaran
SISA UANG = saldo sebelumnya + bersih
```

### Three cross-checks that confirm the reading

| Check | Computed | Sheet says |
| --- | --- | --- |
| Σ pendapatan | 199.832.200 | 199.832.200 |
| Σ QR/TRF/dana | 21.904.800 | 21.904.800 |
| 21.799.000 (saldo awal) + Σ bersih | 11.102.600 | 11.102.600 |

Σ pengeluaran also reconciles at 190.569.300 (the large belanja rows plus the smaller ones that carry a keterangan).

The one figure that does *not* reconcile as a single column is `10.102.200` in the totals row: it equals BON (1.248.000 + 7.000.000 = 8.248.000) **plus** selisih+ (1.854.200). Two columns landed in one total cell — a formula drift in the manual sheet, and a small argument for moving this into the app.

### Column meanings, as used

- **pendapatan** — gross takings for the day, all payment methods.
- **POT FAKTUR** — unused in this period (all zero).
- **QR/TRF/dana** — non-cash takings. Subtracted because the money never entered the drawer.
- **BON** — a *purchase* taken on credit, which **reduces** cash out. Not the customer credit that `sales.metodePembayaran = 'bon'` means in the app. Same word, opposite party.
- **selisih − / +** — cash-count discrepancy at closing.
- **keterangan** — free text: supplier names, or items.
- **pengeluaran** — everything paid out: belanja barang, but also `DPAM` (water), `KARYAWAN` (payroll), and debt repayments.
- **bersih** — net cash movement for the row. Negative on pure-expense rows.

Each date usually carries two rows: one expense row (suppliers in keterangan, negative bersih) and one takings row.

## The structural mismatch that governs the whole design

**The cash book is cash-basis. The app is goods-basis.**

Rows like `byr gula 10.000.000`, `byr kartika`, `byr APS`, `byr segitiga`, `byr sultan` are **debt repayments**, not goods arriving. The goods came in on an earlier date and were already written down then.

The app records a purchase when **goods arrive** (`purchases.tanggal`). If the cash book were generated straight from `purchases`, every credit purchase would be counted twice — once when the goods came, once when the debt was paid — and `SISA UANG` would drift badly.

Nothing in the current schema can express this: `purchases` has `total` and no notion of how much of it was actually paid.

## The five steps, in order

Each step is useful on its own and testable on its own.

### 1. Non-cash payment methods — **DONE** (`a81fd4e`)

`sales.metodePembayaran` widened to `tunai | bon | qris | transfer`. Both new methods settle in full at checkout (`dibayar = total`), so they imply neither change nor piutang, but they are excluded from `omzetTunai`. `getRekap` gained `omzetNonTunai` — the **QR/TRF/dana** column.

### 2. Supplier debt — **NEXT**

- `purchases.dibayar` (integer cents): how much was paid when the goods arrived. `total − dibayar` is the debt. This is the **BON** column.
- New table `purchase_payments(purchaseId, jumlah, tanggal, keterangan, userId)`, mirroring the existing `bon_payments` for customer credit. These are the `byr <supplier>` rows.
- A lump payment to one supplier allocates **oldest invoice first**, so the owner can keep paying in bulk while the app still knows which invoice is settled.

Decision recorded: per-purchase debt with allocation, **not** a per-supplier running balance. The running-balance model is simpler but loses which invoice is outstanding. Revisit only if the owner says invoice-level tracking is unwanted.

### 3. Operating expenses

`pengeluaran` is not only belanja. `DPAM`, `KARYAWAN`, and similar have no home in the schema — there is no expense table at all. Needs a `cash_expenses` (or similarly named) table with date, category, amount, note.

### 4. Daily cash close

The cashier counts physical cash; the app computes what it should be from the day's cash sales, cash purchases, expenses and opening balance. The difference is **selisih − / +**. Nothing like this exists — no closing flow, no opening balance anywhere.

### 5. The Buku Kas report

Opening balance, per-day assembly, carry-forward, and an Excel export laid out like the owner's sheet.

## Verified starting facts (checked against the code, 2026-08-13)

- `metodePembayaran` appears **126 times across 21 files**; 55 of those in 15 non-test files. Step 1 touched all of them.
- Before step 1 there was **no** main→renderer push channel: zero `webContents.send`, zero `ipcRenderer.on`. All IPC is request/response `invoke`.
- Zero `setInterval` and zero `new Notification` in `src/`. No toast library is installed.
- `purchases` has no payment or debt columns.
- Money is integer cents everywhere; `toCents`/`toRupiah` convert only at the IPC boundary.

## Out of scope

- Accrual accounting or a real P&L. This is a cash book.
- Payment-gateway integration. Separate analysis: QRIS/DANA direct is closed to a single merchant (`X-PARTNER-ID` is issued only under a partner agreement); an aggregator plus polling is the realistic route. See memory `qris-dana-integration-findings`.
