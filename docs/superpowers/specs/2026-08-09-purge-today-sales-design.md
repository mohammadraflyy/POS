# Hapus Transaksi Hari Ini — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Adds a one-click "delete all of today's transactions" action to Settings' existing "Zona Berbahaya" section, alongside the existing `PurgeHistory` (delete-before-date) action.

## Why

The existing "Zona Berbahaya" purge only deletes transactions *before* a chosen date — it can't clean up today's own data. The user wants a quick way to wipe today's transactions after test runs or cashier mistakes, without waiting for tomorrow so yesterday's data becomes purgeable, and without hand-cancelling each one.

## 1. Backend — `main/kasir.ts`

```typescript
export function purgeTodaySales(db: BetterSQLite3Database<typeof schema>): { deleted: number; skipped: number } {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const todaySales = db.select().from(sales)
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

Decisions, each confirmed explicitly with the user:
- **Bulk, one action** — not a per-row delete button. This is a cleanup tool for "today was a mess", not a routine per-transaction action.
- **"Today" = local calendar day** on `createdAt`, matching the day-boundary convention already used by `purgeSalesBefore`'s `endOfToday` and `getRekap`'s day-bucketing.
- **Stock is restored** for deleted sales, same as `cancelSale` — because this models "these transactions shouldn't have happened", unlike the existing before-date purge (old, already-reconciled history, stock effects left alone).
- **Already-`dibatalkan` sales are deleted without restoring stock again** — `cancelSale` already returned that stock when the sale was cancelled; restoring it a second time here would over-credit stock.
- **Sales with existing Bon payments are skipped, not blocking**, mirroring `cancelSale`'s existing "can't cancel a bon sale with payments" rule but applied per-row instead of all-or-nothing — the bulk action still deletes everything it safely can and reports what it skipped, matching the existing "valid rows saved, invalid rows reported" convention from Inventory's bulk-entry feature.
- **`sale_items`/`bon_payments` cascade automatically** via the existing `onDelete: 'cascade'` FK constraints (confirmed live at runtime, not just in migrations, since the FK-pragma-during-migration fix from the Rekap feature). No skipped sale has payments to cascade-delete in the first place, by construction.
- **Whole operation runs in one `db.transaction`** — all-or-nothing at the SQL level; a mid-loop crash can't leave a half-deleted day.

**Refactor alongside this**: `cancelSale`'s existing inline stock-restore loop (`for (const item of items) { tx.update(products)... }`) is extracted into a shared `restoreStockForItems(tx, items)` helper, used by both `cancelSale` and `purgeTodaySales` — this is naming and reusing logic that already existed, not a new abstraction over hypothetical future needs.

## 2. IPC — `main/ipc/kasir.ts`

```typescript
ipcMain.handle('kasir:purgeTodaySales', () => {
  if (!getCurrentUser()) {
    throw new Error('Silakan login terlebih dahulu.')
  }

  return purgeTodaySales(db)
})
```

Same auth-guard pattern as every existing handler in this file, placed next to the existing `kasir:purgeSalesBefore` handler. No money conversion needed — response is just `{ deleted, skipped }` counts.

`preload/index.ts` gets `purgeTodaySales: () => invoke('kasir:purgeTodaySales')`. `env.d.ts` gets `purgeTodaySales: () => Promise<{ deleted: number; skipped: number }>`.

## 3. Renderer — `pages/Settings.tsx`

A new `PurgeToday` component, sibling to the existing `PurgeHistory` inside the "Zona Berbahaya" section (same `Heading`, same destructive-bordered card styling). Reuses `useConfirm`/`Button`/error-message state exactly as `PurgeHistory` does — no new UI primitive.

- Confirm dialog explicitly states: permanent, stock will be restored, Bon transactions with payments will be skipped, cannot be undone (`destructive: true`, matching `PurgeHistory`'s confirm styling).
- Result message: `"{deleted} transaksi dihapus."` normally, or `"{deleted} transaksi dihapus, {skipped} dilewati (sudah ada pembayaran bon)."` when `skipped > 0`.
- Errors surface the same way as `PurgeHistory` (`role="alert"` destructive text).

## Out of Scope

- Per-transaction selective delete (explicitly ruled out in favor of bulk).
- A routine/scheduled "daily reset" workflow — this is a manual cleanup tool, not part of a day-open/day-close flow.
- Deleting Bon-payment records themselves or forcing deletion past the Bon-payment protection — those sales are always skipped, never force-deleted.
