# Import Harga Bertingkat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import tiered selling prices (`harga bertingkat`) from a legacy POS spreadsheet into `product_price_tiers`, for products and satuan that already exist.

**Architecture:** One new function `importHargaBertingkat(db, filePath)` in `desktop-node/src/main/inventory-bulk.ts`, built the same way as its two neighbours `importProducts` and `importSatuan`: read the first sheet with `xlsx`, scan downward for the row that carries the expected column labels, then walk the data rows inside a single transaction. An admin-only IPC handler opens the file dialog and calls it; a button on the Inventory page shows the counts.

**Tech Stack:** Electron + TypeScript, drizzle-orm over better-sqlite3, `xlsx` (already a dependency), vitest, React renderer.

**Spec:** `docs/superpowers/specs/2026-08-26-import-harga-bertingkat-design.md`

## Global Constraints

- **Money is stored in integer cents.** Every rupiah value read from a sheet becomes `Math.round(value * 100)` before it reaches the database. `1000_00` in test code means Rp 1.000.
- **This importer never creates anything but tiers.** No products, no categories, no `units` rows, no `product_units` rows. Unmatched input is counted and skipped.
- **`units.code` is stored uppercase** (`normalizeCode` in `master-satuan.ts`). Uppercase the sheet's satuan before comparing.
- **`electron-vite build` does not typecheck.** `npx tsc --noEmit` is the only real gate — run it, don't trust a green build.
- **Main-process vitest needs the Node ABI of better-sqlite3.** Close the running Electron app, `npm run rebuild:node`, run the tests, then `npm run rebuild:electron` before launching the app again. An open app makes `rebuild:node` fail with `EPERM`.
- **UI copy is Indonesian**, matching the surrounding buttons and result lines.
- All paths below are relative to `C:\Work\POS`.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `desktop-node/src/main/inventory-bulk.ts` | all spreadsheet importers | add `importHargaBertingkat` + its column map and result type |
| `desktop-node/src/main/inventory-bulk.test.ts` | their tests | add an `importHargaBertingkat` describe block |
| `desktop-node/src/main/ipc/inventory.ts` | inventory IPC surface | add `inventory:importHargaBertingkat` |
| `desktop-node/src/preload/index.ts` | renderer bridge | add `importHargaBertingkat` |
| `desktop-node/src/renderer/env.d.ts` | hand-written mirror of the bridge | add the same signature |
| `desktop-node/src/renderer/pages/Inventory.tsx` | product list screen | add the button, its busy flag, and its result line |

---

### Task 1: `importHargaBertingkat`

**Files:**
- Modify: `desktop-node/src/main/inventory-bulk.ts` (append after `importSatuan`, which currently ends at line 751)
- Test: `desktop-node/src/main/inventory-bulk.test.ts`

**Interfaces:**
- Consumes: existing module-private helpers in the same file — `parseImportNumber(value: unknown): number | null` and the `Db` type alias. Existing test helpers `seedDb()` and `writeTestSheet(rows: unknown[][]): string`.
- Produces:
  ```ts
  export interface ImportHargaBertingkatResult {
    satuanDiperbarui: number
    tierDitambahkan: number
    dilewatiProdukTidakDitemukan: number
    dilewatiSatuanTidakDitemukan: number
  }
  export function importHargaBertingkat(db: Db, filePath: string): ImportHargaBertingkatResult
  ```
  Task 2 relies on both names exactly as written.

**Background you need:**

`seedDb()` in the test file already creates: product `id: 1`, `kodeItem: 'BRS5'`; unit `id: 1`, `code: 'PCS'`; and its base `product_units` row `id: 101` (`isBaseUnit: true`). Those three ids are used literally in the tests below.

The target table, from `db/schema.ts`:

```ts
export const productPriceTiers = sqliteTable('product_price_tiers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  productUnitId: integer('product_unit_id').notNull().references(() => productUnits.id, { onDelete: 'cascade' }),
  minQty: integer('min_qty').notNull(),
  maxQty: integer('max_qty'),
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productUnitMinQtyUnique: uniqueIndex('product_price_tiers_product_unit_id_min_qty_unique').on(table.productUnitId, table.minQty),
}))
```

That unique index is why duplicate `Jml` values in one sheet row must be collapsed before insert, not after.

- [ ] **Step 1: Extend the test file's imports**

At the top of `desktop-node/src/main/inventory-bulk.test.ts`, add `productPriceTiers` to the schema import and `importHargaBertingkat` + the result type to the module import. The two import statements become:

```ts
import { categories, products, productPriceHistories, productPriceTiers, productUnits, stockAdjustments, units, users } from './db/schema'
import {
  getProductsByIds,
  saveProductRows,
  validateBulkRows,
  bulkSaveProducts,
  importProducts,
  importSatuan,
  importHargaBertingkat,
  type BulkSaveRow,
  type ImportHargaBertingkatResult,
} from './inventory-bulk'
```

- [ ] **Step 2: Write the failing tests**

Append this whole block to the end of `desktop-node/src/main/inventory-bulk.test.ts`:

```ts
describe('importHargaBertingkat', () => {
  // Mirrors the real legacy export: four fixed (Jml N, Harga Jml N) pairs, unused ones zeroed.
  const TIER_HEADER = [
    'Kode Item',
    'Konversi',
    'Satuan',
    'Jml 1',
    'Harga Jml 1',
    'Jml 2',
    'Harga Jml 2',
    'Jml 3',
    'Harga Jml 3',
    'Jml 4',
    'Harga Jml 4',
  ]

  function emptyTierResult(): ImportHargaBertingkatResult {
    return {
      satuanDiperbarui: 0,
      tierDitambahkan: 0,
      dilewatiProdukTidakDitemukan: 0,
      dilewatiSatuanTidakDitemukan: 0,
    }
  }

  function tiersFor(db: ReturnType<typeof createDb>, productUnitId: number) {
    return db
      .select({
        minQty: productPriceTiers.minQty,
        maxQty: productPriceTiers.maxQty,
        hargaJual: productPriceTiers.hargaJual,
      })
      .from(productPriceTiers)
      .where(eq(productPriceTiers.productUnitId, productUnitId))
      .orderBy(productPriceTiers.minQty)
      .all()
  }

  /** Adds a DUS satuan (12 PCS) to the seeded BRS5 product, as product_units id 102. */
  function seedDusUnit(db: ReturnType<typeof createDb>) {
    const now = new Date()
    db.insert(units).values({ id: 2, code: 'DUS', name: 'Dus', symbol: 'dus', createdAt: now, updatedAt: now }).run()
    db.insert(productUnits)
      .values({
        id: 102,
        productId: 1,
        unitId: 2,
        jumlahKemasan: 12,
        conversionFactor: 12,
        hargaJual: 780000_00,
        isBaseUnit: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  it('stores every filled tier pair against the base unit, in cents and open-ended', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 1, 1000, 5, 950, 10, 925, 0, 0]])

    const result = importHargaBertingkat(db, filePath)

    expect(result).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 3 })
    expect(tiersFor(db, 101)).toEqual([
      { minQty: 1, maxQty: null, hargaJual: 1000_00 },
      { minQty: 5, maxQty: null, hargaJual: 950_00 },
      { minQty: 10, maxQty: null, hargaJual: 925_00 },
    ])
  })

  it('takes minQty from Jml verbatim on a derived unit row', () => {
    const db = seedDb()
    seedDusUnit(db)
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 12, 'DUS', 3, 770000, 0, 0, 0, 0, 0, 0]])

    const result = importHargaBertingkat(db, filePath)

    expect(result).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    // 3 means three DUS, not three PCS - Konversi is not applied
    expect(tiersFor(db, 102)).toEqual([{ minQty: 3, maxQty: null, hargaJual: 770000_00 }])
    expect(tiersFor(db, 101)).toEqual([])
  })

  it('matches the satuan case-insensitively', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'pcs', 2, 950, 0, 0, 0, 0, 0, 0]])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
  })

  it('leaves existing tiers alone for a row whose tier columns are all zero', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(productPriceTiers)
      .values({ productId: 1, productUnitId: 101, minQty: 6, maxQty: null, hargaJual: 60000_00, createdAt: now, updatedAt: now })
      .run()

    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 0, 0, 0, 0, 0, 0, 0, 0]])

    // a blank tier block means "not specified", never "delete what you have"
    expect(importHargaBertingkat(db, filePath)).toEqual(emptyTierResult())
    expect(tiersFor(db, 101)).toEqual([{ minQty: 6, maxQty: null, hargaJual: 60000_00 }])
  })

  it('skips a tier pair whose price is zero', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 1, 1000, 5, 0, 0, 0, 0, 0]])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    expect(tiersFor(db, 101)).toEqual([{ minQty: 1, maxQty: null, hargaJual: 1000_00 }])
  })

  it('counts an unknown kodeItem as dilewatiProdukTidakDitemukan', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['GHOST', 1, 'PCS', 1, 1000, 0, 0, 0, 0, 0, 0]])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), dilewatiProdukTidakDitemukan: 1 })
  })

  it('counts a satuan the product does not have as dilewatiSatuanTidakDitemukan', () => {
    const db = seedDb() // BRS5 only has PCS
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 12, 'DUS', 1, 780000, 0, 0, 0, 0, 0, 0]])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), dilewatiSatuanTidakDitemukan: 1 })
  })

  it('collapses a duplicated Jml into one tier, the later pair winning', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 5, 1000, 5, 900, 0, 0, 0, 0]])

    // the unique index on (product_unit_id, min_qty) would reject two rows here
    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    expect(tiersFor(db, 101)).toEqual([{ minQty: 5, maxQty: null, hargaJual: 900_00 }])
  })

  it('replaces rather than accumulates when re-run', () => {
    const db = seedDb()
    importHargaBertingkat(db, writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 1, 1000, 5, 950, 0, 0, 0, 0]]))

    const result = importHargaBertingkat(db, writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 1, 1100, 0, 0, 0, 0, 0, 0]]))

    expect(result).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    expect(tiersFor(db, 101)).toEqual([{ minQty: 1, maxQty: null, hargaJual: 1100_00 }])
  })

  it('works when the sheet carries only the first tier pair', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Satuan', 'Jml 1', 'Harga Jml 1'],
      ['BRS5', 'PCS', 2, 950],
    ])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    expect(tiersFor(db, 101)).toEqual([{ minQty: 2, maxQty: null, hargaJual: 950_00 }])
  })

  it('locates the header row even when preceded by a title block', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['DATA HARGA BERTINGKAT', '', '', '', '', '', '', '', '', '', ''],
      TIER_HEADER,
      ['BRS5', 1, 'PCS', 1, 1000, 0, 0, 0, 0, 0, 0],
    ])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
  })

  it('returns all-zero counts when no header row is found', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Ini', 'Bukan', 'Header'],
      ['a', 'b', 'c'],
    ])

    expect(importHargaBertingkat(db, filePath)).toEqual(emptyTierResult())
  })
})
```

- [ ] **Step 3: Run the tests and verify they fail**

```bash
cd C:/Work/POS/desktop-node
npm run rebuild:node
npx vitest run src/main/inventory-bulk.test.ts -t importHargaBertingkat
```

Expected: the file fails to compile — `importHargaBertingkat` is not exported from `./inventory-bulk`.

If instead you get `NODE_MODULE_VERSION` / ABI errors, the Electron app is still running. Close it and re-run `npm run rebuild:node`.

- [ ] **Step 4: Widen the drizzle import in the implementation file**

`desktop-node/src/main/inventory-bulk.ts` line 1 currently reads:

```ts
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
```

Change it to add `desc`:

```ts
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
```

`productPriceTiers`, `productUnits`, `products`, and `units` are already imported on line 5 — no change needed there.

- [ ] **Step 5: Write the implementation**

Append to the end of `desktop-node/src/main/inventory-bulk.ts`:

```ts
const IMPORT_TIER_COLUMN_LABELS: Record<string, string[]> = {
  kodeItem: ['kode item'],
  satuan: ['satuan'],
  jml1: ['jml 1'],
  hargaJml1: ['harga jml 1'],
  jml2: ['jml 2'],
  hargaJml2: ['harga jml 2'],
  jml3: ['jml 3'],
  hargaJml3: ['harga jml 3'],
  jml4: ['jml 4'],
  hargaJml4: ['harga jml 4'],
}

// "Konversi" is deliberately absent: product_units already owns the conversion,
// and requiring a column nothing reads would only reject otherwise-valid files.
const IMPORT_TIER_REQUIRED_COLUMNS = ['kodeItem', 'satuan', 'jml1', 'hargaJml1']

const IMPORT_TIER_PAIRS: [string, string][] = [
  ['jml1', 'hargaJml1'],
  ['jml2', 'hargaJml2'],
  ['jml3', 'hargaJml3'],
  ['jml4', 'hargaJml4'],
]

function resolveImportTierColumns(sheetRow: unknown[]): Record<string, number> | null {
  const found: Record<string, number> = {}

  sheetRow.forEach((cell, index) => {
    const text = String(cell ?? '').trim().toLowerCase()
    if (!text) {
      return
    }

    for (const [field, labels] of Object.entries(IMPORT_TIER_COLUMN_LABELS)) {
      if (!(field in found) && labels.includes(text)) {
        found[field] = index
      }
    }
  })

  const hasAllRequired = IMPORT_TIER_REQUIRED_COLUMNS.every((field) => field in found)
  return hasAllRequired ? found : null
}

export interface ImportHargaBertingkatResult {
  satuanDiperbarui: number
  tierDitambahkan: number
  dilewatiProdukTidakDitemukan: number
  dilewatiSatuanTidakDitemukan: number
}

const EMPTY_IMPORT_HARGA_BERTINGKAT_RESULT: ImportHargaBertingkatResult = {
  satuanDiperbarui: 0,
  tierDitambahkan: 0,
  dilewatiProdukTidakDitemukan: 0,
  dilewatiSatuanTidakDitemukan: 0,
}

/**
 * Reads a legacy POS "harga bertingkat" export: one row per product satuan, each
 * carrying up to four (Jml N, Harga Jml N) pairs. `Jml` is a minimum quantity in
 * that row's own satuan - the file's `Konversi` column is never applied to it.
 *
 * Matches on kodeItem + satuan against existing rows only; never creates a product,
 * a unit, or a satuan. For every satuan the file actually prices, its tiers are
 * replaced wholesale so a re-import converges instead of piling up stale rows.
 */
export function importHargaBertingkat(db: Db, filePath: string): ImportHargaBertingkatResult {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]

  if (!sheetName) {
    return { ...EMPTY_IMPORT_HARGA_BERTINGKAT_RESULT }
  }

  const sheet = workbook.Sheets[sheetName]
  const sheetRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  let columns: Record<string, number> | null = null
  let headerIndex = -1

  for (let i = 0; i < sheetRows.length; i++) {
    const resolved = resolveImportTierColumns(sheetRows[i])
    if (resolved) {
      columns = resolved
      headerIndex = i
      break
    }
  }

  if (!columns) {
    return { ...EMPTY_IMPORT_HARGA_BERTINGKAT_RESULT }
  }

  const resolvedColumns = columns
  const dataRows = sheetRows.slice(headerIndex + 1)
  const result = { ...EMPTY_IMPORT_HARGA_BERTINGKAT_RESULT }
  const now = new Date()

  db.transaction((tx) => {
    for (const sheetRow of dataRows) {
      const kodeItem = String(sheetRow[resolvedColumns.kodeItem] ?? '').trim()
      const satuan = String(sheetRow[resolvedColumns.satuan] ?? '').trim().toUpperCase()

      if (!kodeItem || !satuan) {
        continue
      }

      // Parsed before the lookups so a row with no tiers at all - by far the common
      // case in these exports - is never counted as a miss and never deletes anything.
      const byMinQty = new Map<number, number>()

      for (const [qtyField, hargaField] of IMPORT_TIER_PAIRS) {
        const qtyIndex = resolvedColumns[qtyField]
        const hargaIndex = resolvedColumns[hargaField]

        if (qtyIndex === undefined || hargaIndex === undefined) {
          continue
        }

        const minQty = parseImportNumber(sheetRow[qtyIndex])
        const harga = parseImportNumber(sheetRow[hargaIndex])

        if (minQty === null || harga === null || !Number.isInteger(minQty) || minQty <= 0 || harga <= 0) {
          continue
        }

        // a repeated Jml would violate the (product_unit_id, min_qty) unique index,
        // so the later pair simply overwrites the earlier one
        byMinQty.set(minQty, Math.round(harga * 100))
      }

      if (byMinQty.size === 0) {
        continue
      }

      const product = tx.select({ id: products.id }).from(products).where(eq(products.kodeItem, kodeItem)).get()

      if (!product) {
        result.dilewatiProdukTidakDitemukan++
        continue
      }

      const productUnit = tx
        .select({ id: productUnits.id })
        .from(productUnits)
        .innerJoin(units, eq(productUnits.unitId, units.id))
        .where(and(eq(productUnits.productId, product.id), eq(units.code, satuan)))
        // a product holding two rows for one unit code is a data bug, but ordering
        // makes the pick deterministic rather than whatever sqlite returns first
        .orderBy(desc(productUnits.isBaseUnit))
        .get()

      if (!productUnit) {
        result.dilewatiSatuanTidakDitemukan++
        continue
      }

      tx.delete(productPriceTiers).where(eq(productPriceTiers.productUnitId, productUnit.id)).run()

      for (const [minQty, hargaJual] of byMinQty) {
        tx.insert(productPriceTiers)
          .values({
            productId: product.id,
            productUnitId: productUnit.id,
            minQty,
            // findTierForQty picks the highest minQty the quantity clears, so
            // open-ended tiers already stack into a staircase
            maxQty: null,
            hargaJual,
            createdAt: now,
            updatedAt: now,
          })
          .run()

        result.tierDitambahkan++
      }

      result.satuanDiperbarui++
    }
  })

  return result
}
```

- [ ] **Step 6: Run the tests and verify they pass**

```bash
cd C:/Work/POS/desktop-node
npx vitest run src/main/inventory-bulk.test.ts
```

Expected: PASS, including the pre-existing `importProducts` / `importSatuan` / `saveProductRows` blocks.

- [ ] **Step 7: Typecheck**

```bash
cd C:/Work/POS/desktop-node
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
cd C:/Work/POS
git add desktop-node/src/main/inventory-bulk.ts desktop-node/src/main/inventory-bulk.test.ts
git commit -m "feat(inventory): import tiered prices from the legacy POS export"
```

---

### Task 2: Wire it to the Inventory page

**Files:**
- Modify: `desktop-node/src/main/ipc/inventory.ts` (import line 23; new handler after the `inventory:importSatuan` handler, which ends at line 344)
- Modify: `desktop-node/src/preload/index.ts:130`
- Modify: `desktop-node/src/renderer/env.d.ts:328-334`
- Modify: `desktop-node/src/renderer/pages/Inventory.tsx` (state at lines 115-116, function after `runImportSatuan` which ends at line 163, result line near 541, button at lines 593-595)

**Interfaces:**
- Consumes: `importHargaBertingkat` and `ImportHargaBertingkatResult` from Task 1.
- Produces: IPC channel `inventory:importHargaBertingkat`, exposed to the renderer as `window.api.inventory.importHargaBertingkat()`, resolving to `ImportHargaBertingkatResult | null` (`null` when the user cancels the file dialog).

There is no automated test for this layer — the two existing importers have none either, and there is no renderer test harness for `Inventory.tsx`. `tsc --noEmit` plus one manual run against the owner's real file is the check.

- [ ] **Step 1: Add the IPC handler**

In `desktop-node/src/main/ipc/inventory.ts`, extend the import on line 23:

```ts
import {
  getProductsByIds,
  bulkSaveProducts,
  importProducts,
  importSatuan,
  importHargaBertingkat,
  type BulkSaveRow,
} from '../inventory-bulk'
```

Then add this handler immediately after the closing `})` of the `inventory:importSatuan` handler:

```ts
  ipcMain.handle('inventory:importHargaBertingkat', async () => {
    requireAdmin()

    const window = getMainWindow()
    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return importHargaBertingkat(db, result.filePaths[0])
  })
```

- [ ] **Step 2: Expose it through the preload bridge**

In `desktop-node/src/preload/index.ts`, directly after line 130 (`importSatuan: () => invoke('inventory:importSatuan'),`) add:

```ts
    importHargaBertingkat: () => invoke('inventory:importHargaBertingkat'),
```

- [ ] **Step 3: Mirror the type in `env.d.ts`**

`desktop-node/src/renderer/env.d.ts` is hand-written and `tsc` cannot cross-check it against the handler, so this must be copied deliberately. After the `importSatuan` entry that ends on line 334, add:

```ts
        importHargaBertingkat: () => Promise<{
          satuanDiperbarui: number
          tierDitambahkan: number
          dilewatiProdukTidakDitemukan: number
          dilewatiSatuanTidakDitemukan: number
        } | null>
```

- [ ] **Step 4: Add the page state and handler**

In `desktop-node/src/renderer/pages/Inventory.tsx`, after line 116 (`const [importSatuanResult, setImportSatuanResult] = useState<string | null>(null)`) add:

```tsx
  const [importingTier, setImportingTier] = useState(false)
  const [importTierResult, setImportTierResult] = useState<string | null>(null)
```

Then, directly after the closing brace of `runImportSatuan`, add:

```tsx
  function runImportHargaBertingkat() {
    setImportingTier(true)
    setImportTierResult(null)

    window.api.inventory
      .importHargaBertingkat()
      .then((result) => {
        if (result === null) {
          return
        }

        setImportTierResult(
          `${result.satuanDiperbarui} satuan diperbarui (${result.tierDitambahkan} tingkatan harga), ` +
            `${result.dilewatiProdukTidakDitemukan} dilewati (produk tidak ditemukan), ` +
            `${result.dilewatiSatuanTidakDitemukan} dilewati (satuan tidak ditemukan).`,
        )
        loadPage(currentPage)
      })
      .catch((err) => {
        setImportTierResult(err instanceof Error ? err.message : 'Gagal mengimpor')
      })
      .finally(() => setImportingTier(false))
  }
```

`loadPage(currentPage)` matters here: the product list's `priceTiersCount` column comes from the server, so without the reload the new tiers stay invisible.

- [ ] **Step 5: Add the button**

In the same file, after the "Import Satuan" button (lines 593-595) add:

```tsx
            <Button type="button" variant="outline" disabled={importingTier} onClick={runImportHargaBertingkat}>
              {importingTier ? 'Mengimpor...' : 'Import Harga Bertingkat'}
            </Button>
```

- [ ] **Step 6: Add the result line**

Lines 541-545 currently read:

```tsx
        {importSatuanResult && (
          <p role="status" className="text-sm text-muted-foreground">
            {importSatuanResult}
          </p>
        )}
```

Add this sibling immediately after it, matching that markup exactly:

```tsx
        {importTierResult && (
          <p role="status" className="text-sm text-muted-foreground">
            {importTierResult}
          </p>
        )}
```

- [ ] **Step 7: Typecheck**

```bash
cd C:/Work/POS/desktop-node
npx tsc --noEmit
```

Expected: no output. A `Property 'importHargaBertingkat' does not exist` error here means Step 3 was skipped or mistyped.

- [ ] **Step 8: Run the app against the real file**

```bash
cd C:/Work/POS/desktop-node
npm run rebuild:electron
npm run dev
```

Log in as an admin, open Inventory, click **Import Harga Bertingkat**, pick `C:\Users\USER\Downloads\DATA HARGA BERTINGKAT.xls`.

Expected, from that file's own numbers: 287 rows carry tiers, so `satuanDiperbarui + dilewatiProdukTidakDitemukan + dilewatiSatuanTidakDitemukan` should equal **287**, and `tierDitambahkan` should be at most 643 (`287 + 134 + 127 + 95`). How large the two `dilewati` counts are depends on how much of the legacy catalog this database already holds — a big number there means products or satuan still need importing first, not that this importer is broken.

Then spot-check one product: open the product with kodeItem `020` (`SASA 1000`) and confirm its PCS tiers read 1 → 1.000, 5 → 1.000, 10 → 925.

- [ ] **Step 9: Commit**

```bash
cd C:/Work/POS
git add desktop-node/src/main/ipc/inventory.ts desktop-node/src/preload/index.ts desktop-node/src/renderer/env.d.ts desktop-node/src/renderer/pages/Inventory.tsx
git commit -m "feat(inventory): add the Import Harga Bertingkat button"
```

---

## Done when

- `npx vitest run src/main/inventory-bulk.test.ts` passes, including the twelve new cases.
- `npx tsc --noEmit` is clean.
- The Inventory page imports the owner's real file and the tier counts on the product list go up.
