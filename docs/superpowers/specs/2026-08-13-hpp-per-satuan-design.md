# HPP per Satuan + Laba per Satuan — Design Spec

**Status:** Approved by the user on 2026-08-13. Both open design questions were answered explicitly (see "Decisions locked by the user" below).
**Scope:** `desktop-node/` only. Gives every `product_units` row its own cost (`harga_pokok`), drives that cost from the unit a purchase was actually made in, makes gross profit per sale line use the cost of the unit that was sold, and adds a per-unit profit breakdown plus margin/loss warnings in the UI.
**Supersedes nothing.** Extends the model built in `2026-08-09-multi-unit-price-tier-rebuild-design.md`, whose section 1c explicitly assumed "cost isn't a per-unit concept" — that is the assumption this spec reverses.

## The requirement, in the user's terms

> "ada kebutuhan dimana jika pembelian dalam bentuk dus maka hitungan laba akan menyesuaikan, dan jika beli dalam bentuk pak (satuan turunan dari dus) maka harga jual akan berbeda dan laba akan berbeda juga jika pembelian di lakukan dalam bentuk sak"

Buying in DUS, PAK, or SAK produces a different real cost per piece. Today all three are blended into one number and every profit figure in the app is computed from it. The shop owner wants the unit they *bought in* to drive the cost of the unit they *sell in*, so that "laba jual per dus" and "laba jual eceran" are separate, truthful numbers.

## What exists today

- `products.harga_pokok` — a single moving-average cost per **base unit**, updated in `main/purchase.ts` by `hitungHargaPokokRataRata(stokLama, hargaPokokLama, qtyDasar, nilaiBeli)`. Every purchase, in any unit, is normalised to base units (`qtyDasar = qty * konversi`) and averaged into this one field.
- `product_units` carries a per-unit **selling** price (`harga_jual`) but no cost.
- `sale_items.harga_pokok` snapshots `products.harga_pokok` at checkout — i.e. cost per base unit.
- Gross profit lives in exactly one place: `main/rekap.ts` line 124, `subtotal - qty * konversi * hargaPokok`. `dashboard.ts` reads the summary from `getRekap`, so it has no formula of its own.
- `purchase_items` already stores `product_unit_id`, `konversi`, and `harga_beli` per line — the per-unit purchase history is already recorded, it is simply never used for costing.

## Decisions locked by the user

1. **A purchase propagates cost downward, never upward.** Buying 2 DUS updates the cost of DUS *and* PAK *and* PCS. Buying 20 PCS updates only PCS. Rationale: the physical stock really did arrive inside those dus, so retail cost must follow the newest purchase; but 20 loose pieces do not tell you what a dus costs.
2. **Selling prices stay manual.** No markup percentage, no auto-recalculated `harga_jual`. The UI shows cost, margin, and a loss warning; the number in the field is always one a human typed.

## 1. Schema

### 1a. `product_units.harga_pokok` (new column)

```typescript
hargaPokok: integer('harga_pokok').notNull().default(0),
```

Cost in cents of **one** of that unit — Rp 500.000 for a DUS, Rp 5.000 for a PCS. Same convention as `harga_jual` on the same row, so the two are directly comparable for the margin display.

Migration backfill:

```sql
UPDATE product_units
SET harga_pokok = (SELECT harga_pokok FROM products WHERE products.id = product_units.product_id)
                  * conversion_factor;
```

Day one, every unit's cost is exactly `base cost x konversi` — identical to what the app computes implicitly today. No historical report changes value on the day this ships.

### 1b. `sale_items.harga_pokok` (meaning change, no new column)

The column changes from *"cost per base unit"* to *"cost of one of the unit that was actually transacted"*. Migration backfill:

```sql
UPDATE sale_items SET harga_pokok = harga_pokok * konversi;
```

Every past sale keeps its exact profit figure, because the `* konversi` that `rekap.ts` used to apply at read time is now baked into the stored value. The reason for reusing the column rather than adding `harga_pokok_satuan` next to it: two nearly-identical cost columns on the hottest table in the reporting path is a permanent source of "which one did you mean", and the only reader that computes profit is `rekap.ts`. A `/** ... */` comment on the schema field records the new meaning.

**Verified reader inventory** for `sale_items.harga_pokok`: written in `main/kasir.ts` (checkout), read in `main/rekap.ts` (profit), plus test fixtures. Receipt printing (`main/escpos.ts`) and sale history (`main/ipc/kasir.ts`) do not read it.

### 1c. `products.harga_pokok` — unchanged, still the base cost

It stays, it stays authoritative for stock valuation (`getStockValue`), the product form, bulk import, and as the seed for new units. It is mathematically the `konversi = 1` case of the per-unit rule below, so the base `product_units` row and `products.harga_pokok` will always hold the same number. That mirroring is deliberate: rewriting every `products.harga_pokok` reader is a far larger change than keeping one denormalised field in sync, exactly as `products.harga_jual` already mirrors the base unit's selling price in the current model.

## 2. The costing rule

One generalised helper replaces the existing one:

```typescript
/**
 * Weighted-average cost of one `konversi`-sized unit after receiving `qtyDasarMasuk`
 * base units for `nilaiBeli`. Works in whole rupiah of inventory value so a
 * derived-unit purchase is not rounded twice on its way between units.
 */
export function hitungHargaPokokSatuan(
  stokDasarLama: number,
  hargaPokokSatuanLama: number,
  konversi: number,
  qtyDasarMasuk: number,
  nilaiBeli: number,
): number {
  const basisStok = Math.max(0, stokDasarLama)
  const totalQty = basisStok + qtyDasarMasuk

  if (totalQty <= 0) {
    return hargaPokokSatuanLama
  }

  return Math.round((basisStok * hargaPokokSatuanLama + nilaiBeli * konversi) / totalQty)
}
```

`hitungHargaPokokRataRata` is kept as a thin call with `konversi = 1`, so its existing tests and its callers keep working unchanged.

Derivation: averaging in unit `V` wants `(stokDalamV * hppV_lama + nilaiBeli) / (stokDalamV + qtyMasukV)` where `stokDalamV = stokDasar / K_V` and `qtyMasukV = qtyDasar / K_V`. Multiplying numerator and denominator by `K_V` clears both divisions and yields the integer form above. Stock basis stays in base units for every unit, so no fractional stock is ever materialised.

### Applying it in `recordPurchase`

Per purchase line (qty `Q`, unit `U`, conversion `K_U`, line value `S`, `qtyDasar = Q * K_U`):

- For every `product_units` row `V` of that product where **`conversion_factor <= K_U`** (unit `U` itself included, since `K_U <= K_U`): `hargaPokok_V = hitungHargaPokokSatuan(stokDasarLama, hargaPokok_V, K_V, qtyDasar, S)`.
- Units with `conversion_factor > K_U` are left alone.
- `products.harga_pokok` is updated exactly as it is today (it is the `K_V = 1` case, and stays equal to the base row).

The existing running-totals loop already compounds `stok` and cost line by line for multi-line purchases of the same product; the per-unit cost map must compound the same way, keyed by `product_unit_id`.

`product_price_histories` keeps recording base-cost before/after only. A per-unit cost history is not in scope.

### Cost when a unit is edited or created outside a purchase

- **New unit added** (`addProductUnit`, base-unit creation, unit chain recompute in `inventory-units.ts`): seed `harga_pokok = products.harga_pokok * conversion_factor`.
- **`conversion_factor` recomputed** because a lower link in the chain changed: re-derive that unit's cost the same way. A unit whose size changed no longer has a meaningful cost history at its old size.
- **Manual `harga_pokok` edit** on the product (product form in `inventory.ts`, bulk import in `inventory-bulk.ts`): reset *every* unit of that product to `harga_pokok_baru * conversion_factor`. A human overriding the cost is stating the truth for the whole product; letting stale per-unit costs survive that would produce numbers nobody can explain.
- **Stock opname / manual stock adjustment**: no cost change. An adjustment moves quantity, not value. (It does shift the averaging basis for the *next* purchase, which is the existing behaviour for base cost and is correct.)

## 3. Profit per sale line

- `main/kasir.ts` `resolveCartItem` snapshots `productUnit.hargaPokok` instead of `product.hargaPokok`. `ProductUnitRow` gains the field; the query that loads units must select it.
- `main/rekap.ts` profit becomes `subtotal - qty * hargaPokok` (the `* konversi` moves into the stored snapshot).
- Cancellation and purge paths are untouched — they reverse stock, not cost.

## 4. Rekap: profit broken down per unit

New `labaPerSatuan` section on `RekapResult`, built in the same pass that already walks `saleItemRows`:

| Field | Source |
| --- | --- |
| `satuan` | `units.code` joined through `sale_items.product_unit_id`; falls back to the `sale_items.satuan` snapshot when the unit row was deleted |
| `qtyTerjual` | sum of `sale_items.qty` |
| `omzet` | sum of `subtotal` |
| `laba` | sum of the per-line profit |
| `marginPersen` | `laba / omzet * 100`, `0` when `omzet` is `0` |

Sorted by `laba` descending, mirroring `labaPerKategori`. Flows through `ipc/rekap.ts` (rupiah conversion), the `preload/index.ts` and `renderer/env.d.ts` mirror, a card in `pages/Rekap.tsx`, and one extra sheet in the Excel export — all following the existing `labaPerKategori` pattern exactly.

## 5. UI: cost, margin, loss warning

In `pages/inventory/ProductDetailDialog.tsx`:

- Each unit row shows its `hargaPokok` and margin percent (`(hargaJual - hargaPokok) / hargaPokok * 100`, shown as `-` when cost is `0`).
- `hargaJual < hargaPokok` renders in destructive colour with a short "di bawah modal" label.
- Each price tier row is checked against its own unit's `hargaPokok` and flagged the same way. The tier DTO needs no new field — a tier already carries `productUnitId`, and the dialog already holds the unit list, so it reads the cost from there.

The IPC unit DTO grows a `hargaPokok` field, mirrored in `preload/index.ts` and `renderer/env.d.ts`. (Prior bug worth remembering: `env.d.ts` can declare a field the handler never sends and TypeScript will not catch it — add the field on the handler side first.)

## Explicitly out of scope

- Per-unit stock. `products.stok` stays a single base-unit quantity.
- Automatic selling price / markup percentages.
- FIFO or lot-level costing.
- Per-unit cost history in `product_price_histories`.
- Purchase-side price tiers (recorded separately as a future need).

## Known limitation

The rule is still a moving average, now per unit. Buying a single expensive PCS as a sample moves the PCS cost even though nearly all physical stock came in cheaply by the dus. That is inherent to averaging and matches how the base cost already behaves today — it is not introduced by this change, only made visible per unit. FIFO/lot costing is the fix if it ever becomes a real problem.

## Testing

- **`hitungHargaPokokSatuan`** unit tests: `konversi = 1` reproduces `hitungHargaPokokRataRata` exactly; zero stock; negative stock; a derived unit's cost equals `base cost * konversi` when every purchase went through the base unit.
- **`recordPurchase`**: buying in DUS moves DUS, PAK, and PCS; buying in PCS moves PCS but leaves DUS and PAK untouched; two lines for the same product in one purchase compound correctly.
- **Migration test**: column presence, and both backfills producing values identical to the pre-migration computed figures.
- **`checkout`**: the sale line snapshots the transacted unit's cost, not the base cost.
- **`getRekap`**: profit unchanged for a base-unit sale; a DUS sale after a DUS purchase yields the DUS-cost profit; `labaPerSatuan` groups and sorts correctly.
- **The worked example end to end** (figures written in rupiah for readability; the columns themselves hold cents, converted at the IPC boundary by `toCents`/`toRupiah` as everywhere else): base PCS, PAK = 10 PCS, DUS = 10 PAK, so `conversion_factor` is 1 / 10 / 100. Starting stock 0.
  1. Buy 2 DUS at Rp 500.000 each — line value Rp 1.000.000, `qtyDasar` 200. Costs become DUS 500.000, PAK 50.000, PCS 5.000.
  2. Buy 20 PCS at Rp 6.000 each — line value Rp 120.000, `qtyDasar` 20. PCS becomes 5.091 (`(200 * 5000 + 120000 * 1) / 220`); PAK stays 50.000 and DUS stays 500.000 because their `conversion_factor` exceeds the purchased unit's.
  3. Sell 1 PCS at 7.000 → profit 1.909. Sell 1 DUS at 560.000 → profit 60.000.
