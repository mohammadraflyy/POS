# Import Harga Bertingkat — Design Spec

**Status:** Not started.
**Scope:** `desktop-node/`. Read a legacy POS export of tiered selling prices and fill in `product_price_tiers` for products that already exist.
**Origin:** The owner supplied `DATA HARGA BERTINGKAT.xls`, a 3115-row export from the legacy POS. This document records what was reverse-engineered from it.

## The source file

One sheet, 3114 data rows under a single header row:

```
Kode Item | Barcode | Nama Item | Jenis | Merek | Rak | Tipe Item | Konversi | Satuan | Harga Pokok
          | Jml 1 | Harga Jml 1 | Jml 2 | Harga Jml 2 | Jml 3 | Harga Jml 3 | Jml 4 | Harga Jml 4 | Keterangan
```

One row per *product unit*, not per product: `001` appears twice, once as `Konversi 1 / RNTNG` and once as `Konversi 20 / DUS`. That is the same shape as our `product_units` table, and the same shape the existing `importSatuan` reads.

The four `Jml N` / `Harga Jml N` pairs are the tiers. A pair is unused when both cells are `0`, which is the common case — only **287 of 3114 rows** carry any tier at all:

| | rows |
| --- | --- |
| rows with at least one tier | 287 |
| …on a base-unit row (`Konversi = 1`) | 138 |
| …on a derived-unit row | 149 |
| `Jml 1` used | 287 |
| `Jml 2` used | 134 |
| `Jml 3` used | 127 |
| `Jml 4` used | 95 |
| tiers with `Jml > 0` but `Harga = 0` | 0 |

## What `Jml` means

`Jml` is a minimum quantity **expressed in the row's own satuan**. Confirmed with the owner.

The evidence for it is the multi-tier derived rows, which only parse one way:

```
105  MINYAK FILMA 2L   Konversi 6   DUS   Jml = 1 / 3 / 5 / 12
376  MINYAK CURAH      Konversi 10  KG    Jml = 1 / 2
```

Read as base units those become fractions of a DUS, which is meaningless.

The ambiguity worth recording: **112 of the 149 derived rows have `Jml == Konversi`** (`020 SASA 1000`, `PAK`, `Konversi 20`, `Jml 20`). Those parse equally well as "≥20 PAK" or as "20 PCS, i.e. 1 PAK". Nothing in the file distinguishes them. We take them at face value as "≥20 PAK", which is the same rule as everywhere else. The failure mode if that reading is wrong is benign: the tier simply never matches a real cart and the line falls back to `product_units.harga_jual`. The opposite reading would corrupt rows like `105` above.

## Target schema

`product_price_tiers` already fits without a migration:

```
product_id | product_unit_id | min_qty | max_qty | harga_jual
unique (product_unit_id, min_qty)
```

`max_qty` is written as `null` for every imported tier. `findTierForQty` (mirrored in `main/kasir.ts` and `renderer/pages/kasir/cart-logic.ts`) sorts by `min_qty` descending and takes the first tier the quantity clears, so consecutive open-ended tiers already behave as a staircase. Storing an upper bound would add a second source of truth for no behavioural gain.

Tiers on the base unit are legitimate — `PriceTier.productUnitId` is documented as "base rows included", and a cart line's `null` productUnitId resolves to `product.baseProductUnitId` before the tiers are filtered.

## Behaviour

New function in `desktop-node/src/main/inventory-bulk.ts`, alongside `importProducts` and `importSatuan`:

```ts
export function importHargaBertingkat(db: Db, filePath: string): ImportHargaBertingkatResult
```

### Header resolution

Reuse the existing label-map + scan-for-header-row pattern. Required labels: `kode item`, `konversi`, `satuan`, `jml 1`, `harga jml 1`. The `jml 2..4` / `harga jml 2..4` pairs are optional and each pair is only used when both of its columns resolve. If the required labels are never found, return an all-zero result rather than throwing — same contract as the other two importers.

### Per row

1. Read `kodeItem`, `satuan`, and the up-to-four `(Jml, Harga)` pairs through `parseImportNumber`.
2. Drop any pair where `Jml <= 0` or `Harga <= 0`.
3. No pairs left → skip the row silently and **do not touch existing tiers**. A blank tier block in this export means "not specified", not "delete what you have"; 2827 rows are blank and a delete-on-blank reading would wipe every tier set through the UI.
4. Duplicate `Jml` values within one row → last one wins, so the unique index cannot be violated by the file.
5. `hargaJual` is stored in cents: `Math.round(harga * 100)`, matching `importProducts` and `importSatuan`.

### Matching

- Product by `kodeItem` only. Never creates a product, never creates a satuan.
- Satuan by `units.code` compared uppercase, against that product's `product_units` rows — base row included.
- `Konversi` from the file is read only to identify the row; it is not written. `product_units` already owns the conversion, set by `importSatuan` or the product form, and overwriting it from this file would let a price import silently restate the satuan chain.

Unmatched product → `dilewatiProdukTidakDitemukan`. Matched product but unmatched satuan → `dilewatiSatuanTidakDitemukan`.

### Writing

One transaction over the whole file. For each matched `product_unit` that the file supplies tiers for: delete its existing `product_price_tiers` rows, then insert the parsed ones. Replace rather than merge, so re-running the import after fixing the spreadsheet converges instead of accumulating stale tiers.

### Result

```ts
export interface ImportHargaBertingkatResult {
  satuanDiperbarui: number
  tierDitambahkan: number
  dilewatiProdukTidakDitemukan: number
  dilewatiSatuanTidakDitemukan: number
}
```

Counted per *satuan*, not per product, because that is the granularity the file and the table both work at.

## Wiring

| Layer | Change |
| --- | --- |
| `src/main/ipc/inventory.ts` | `inventory:importHargaBertingkat` handler — `requireAdmin()`, same `dialog.showOpenDialog` filter (`xlsx`/`xls`/`csv`), returns `null` on cancel |
| `src/preload/index.ts` | `importHargaBertingkat: () => invoke('inventory:importHargaBertingkat')` |
| `src/renderer/env.d.ts` | mirror the result type on the `inventory` API |
| `src/renderer/pages/Inventory.tsx` | "Import Harga Bertingkat" button next to "Import Satuan", with its own `importing…` flag and result line, calling `loadPage(currentPage)` on success so `priceTiersCount` in the product list refreshes |

`env.d.ts` is a hand-written mirror that `tsc` cannot cross-check against the handler, so the result type must be copied deliberately.

## Testing

`desktop-node/src/main/inventory-bulk.test.ts`, reusing the existing xlsx-fixture helper:

1. Multiple tiers on a base-unit row are stored against the base `product_units` row.
2. A tier on a derived-unit row is stored against that unit, with `minQty` taken verbatim from `Jml`.
3. Rows whose tier columns are all `0` are skipped and leave pre-existing tiers untouched.
4. Unknown `kodeItem` → `dilewatiProdukTidakDitemukan`.
5. Known product, unknown satuan → `dilewatiSatuanTidakDitemukan`.
6. Duplicate `Jml` in one row resolves to a single tier instead of violating the unique index.
7. Importing twice replaces rather than accumulates.
8. `maxQty` is `null` and `hargaJual` is in cents.

Main-process tests need the better-sqlite3 node ABI: `npm run rebuild:node` before, `npm run rebuild:electron` after, with the app closed.

## Out of scope

- Editing tiers from this screen. `ProductDetail` already owns that.
- Importing `Harga Pokok` from this file. The cost columns here duplicate what `importProducts` and the purchase flow already maintain, and moving-average HPP must not be overwritten by a price sheet.
- Any use of `Barcode`, `Jenis`, `Merek`, `Rak`, `Tipe Item`, `Keterangan`.
