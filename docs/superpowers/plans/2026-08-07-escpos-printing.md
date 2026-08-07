# ESC/POS Raw Printing (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `desktop-node`'s dialog-based print flow (`webContents.print({silent: false})`) with true silent printing — a pure-TypeScript ESC/POS byte builder plus a Windows `winspool.drv` raw-print transport — and add printer/paper-width settings and a Test Print tool.

**Architecture:** Two new dependency-free modules in `main/`: `escpos.ts` (pure function building raw ESC/POS bytes from receipt data) and `print-windows.ts` (shells out to an embedded PowerShell script using the standard Microsoft `winspool.drv` P/Invoke raw-printing technique). `kasir:printReceipt` changes from "capture whatever's on screen" to `printReceipt(saleId)`, re-deriving the receipt server-side and sending it through this new pipeline. `Receipt.tsx` and its print CSS become dead code and are deleted.

**Tech Stack:** Electron 32, TypeScript, Drizzle ORM + better-sqlite3, Node built-ins only (`child_process`, `fs`, `os`, `path`) — zero new npm dependencies. Windows-only (matches the app's existing implicit posture).

## Global Constraints

- Zero new npm dependencies. `node-thermal-printer`'s Windows driver (`printer` package) was spiked directly in this repo and fails on `npm install` — before native compilation even starts — due to an unresolvable `grunt@~0.4` peer conflict from 2013-era tooling. Printer listing uses Electron's own built-in `webContents.getPrintersAsync()`.
- Character width: 32 columns for `58mm`, 48 columns for `80mm` (Font A defaults, industry-standard for these two physical widths).
- Receipt text encoding is plain ASCII (`Buffer.from(text, 'ascii')`) — every current piece of receipt copy is ASCII-only, including `formatRupiah`'s output (already strips its Unicode non-breaking space).
- `store_settings.receipt_width` defaults to `'58mm'` (the originally-documented EPPOS EP58M printer size) — this dev machine's 80mm hardware is a per-store setting change, not a new global default.
- `store_settings.printer_name` is nullable — `null` means "use the OS default printer," resolved at print time via `getPrintersAsync()`'s `isDefault` flag.
- `printReceipt(saleId)` re-derives the full receipt server-side via the existing `getReceipt` helper — the renderer never sends receipt content, only a `saleId` (nothing client-computed is trusted for money-relevant print output, matching this codebase's existing trust boundary).
- Dead code removed as part of this work, not left unreferenced: `src/renderer/pages/kasir/Receipt.tsx`, the `.receipt-print`/`@media print`/`@page` block in `main.css`, and the `kasir:getReceiptForSale` IPC channel (its only caller simplifies to calling `printReceipt(saleId)` directly).
- `print-windows.ts`'s `printRaw` is not unit-testable (spawns a real process, touches a real printer) — verified manually in the final task, same as the print flow's prior implementations.

---

### Task 1: Schema + `updateStoreSettings`/`getStoreSettings` extension

**Files:**
- Modify: `desktop-node/src/main/db/schema.ts`
- Modify: `desktop-node/src/main/kasir.ts`
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/main/kasir.test.ts`
- Create (via `db:generate`): a new migration under `desktop-node/drizzle/`

**Interfaces:**
- Produces: `storeSettings` schema gains `printerName: text('printer_name')` (nullable) and `receiptWidth: text('receipt_width', {enum: ['58mm', '80mm']}).notNull().default('58mm')`. `updateStoreSettings(db, input)`'s `input` type gains `printerName: string | null` and `receiptWidth: '58mm' | '80mm'` (both required — matches this function's existing full-replace-update convention). `kasir:getStoreSettings`'s return type gains the same two fields (defaults `null`/`'58mm'` when no row exists). Task 4 consumes both.

- [ ] **Step 1: Add the two new schema columns**

In `desktop-node/src/main/db/schema.ts`, find:

```typescript
export const storeSettings = sqliteTable('store_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  namaToko: text('nama_toko').notNull(),
  alamat: text('alamat'),
  telepon: text('telepon'),
  pesanFooter: text('pesan_footer'),
  ...timestamps(),
})
```

Replace with:

```typescript
export const storeSettings = sqliteTable('store_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  namaToko: text('nama_toko').notNull(),
  alamat: text('alamat'),
  telepon: text('telepon'),
  pesanFooter: text('pesan_footer'),
  printerName: text('printer_name'),
  receiptWidth: text('receipt_width', { enum: ['58mm', '80mm'] }).notNull().default('58mm'),
  ...timestamps(),
})
```

- [ ] **Step 2: Generate the migration**

Run: `cd desktop-node && npm run db:generate`
Expected: a new file appears under `drizzle/` (e.g. `0001_<name>.sql`) containing `ALTER TABLE store_settings ADD ... printer_name` and `... receipt_width ... DEFAULT '58mm'`, and `drizzle/meta/_journal.json`/a new `drizzle/meta/0001_snapshot.json` are updated. Inspect the generated SQL file to confirm both columns are present with the correct types/default.

- [ ] **Step 3: Update the failing tests**

In `desktop-node/src/main/kasir.test.ts`, find the entire `describe('updateStoreSettings', ...)` block:

```typescript
describe('updateStoreSettings', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  it('inserts a new row when none exists yet', () => {
    const db = createDb(':memory:', migrationsFolder)

    updateStoreSettings(db, { namaToko: 'Toko Baru', alamat: 'Jl. Baru', telepon: '021', pesanFooter: 'Terima kasih' })

    const setting = db.select().from(storeSettings).get()
    expect(setting).toMatchObject({
      namaToko: 'Toko Baru',
      alamat: 'Jl. Baru',
      telepon: '021',
      pesanFooter: 'Terima kasih',
    })
  })

  it('updates the existing row instead of inserting a second one', () => {
    const db = createDb(':memory:', migrationsFolder)
    updateStoreSettings(db, { namaToko: 'Toko A', alamat: null, telepon: null, pesanFooter: null })

    updateStoreSettings(db, { namaToko: 'Toko B', alamat: 'Jl. B', telepon: '022', pesanFooter: 'Footer B' })

    const rows = db.select().from(storeSettings).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ namaToko: 'Toko B', alamat: 'Jl. B', telepon: '022', pesanFooter: 'Footer B' })
  })

  it('allows null alamat/telepon/pesanFooter', () => {
    const db = createDb(':memory:', migrationsFolder)

    updateStoreSettings(db, { namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null })

    const setting = db.select().from(storeSettings).get()
    expect(setting).toMatchObject({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null })
  })

  it('throws when namaToko is empty', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() => updateStoreSettings(db, { namaToko: '', alamat: null, telepon: null, pesanFooter: null })).toThrow(
      'Nama toko wajib diisi.',
    )
  })

  it('throws when namaToko is only whitespace', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() => updateStoreSettings(db, { namaToko: '   ', alamat: null, telepon: null, pesanFooter: null })).toThrow(
      'Nama toko wajib diisi.',
    )
  })

  it('throws when namaToko exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() => updateStoreSettings(db, { namaToko: tooLong, alamat: null, telepon: null, pesanFooter: null })).toThrow(
      'Nama toko maksimal 255 karakter.',
    )
  })

  it('allows namaToko of exactly 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const exactly255 = 'a'.repeat(255)
    expect(() =>
      updateStoreSettings(db, { namaToko: exactly255, alamat: null, telepon: null, pesanFooter: null }),
    ).not.toThrow()
  })

  it('throws when alamat exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() => updateStoreSettings(db, { namaToko: 'Toko', alamat: tooLong, telepon: null, pesanFooter: null })).toThrow(
      'Alamat maksimal 255 karakter.',
    )
  })

  it('throws when telepon exceeds 50 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = '1'.repeat(51)
    expect(() => updateStoreSettings(db, { namaToko: 'Toko', alamat: null, telepon: tooLong, pesanFooter: null })).toThrow(
      'Telepon maksimal 50 karakter.',
    )
  })

  it('throws when pesanFooter exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() =>
      updateStoreSettings(db, { namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: tooLong }),
    ).toThrow('Pesan footer maksimal 255 karakter.')
  })
})
```

Replace with (every existing call site gains `printerName: null, receiptWidth: '58mm'`, plus four new tests for the two new fields):

```typescript
describe('updateStoreSettings', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  it('inserts a new row when none exists yet', () => {
    const db = createDb(':memory:', migrationsFolder)

    updateStoreSettings(db, {
      namaToko: 'Toko Baru',
      alamat: 'Jl. Baru',
      telepon: '021',
      pesanFooter: 'Terima kasih',
      printerName: null,
      receiptWidth: '58mm',
    })

    const setting = db.select().from(storeSettings).get()
    expect(setting).toMatchObject({
      namaToko: 'Toko Baru',
      alamat: 'Jl. Baru',
      telepon: '021',
      pesanFooter: 'Terima kasih',
      printerName: null,
      receiptWidth: '58mm',
    })
  })

  it('updates the existing row instead of inserting a second one', () => {
    const db = createDb(':memory:', migrationsFolder)
    updateStoreSettings(db, {
      namaToko: 'Toko A',
      alamat: null,
      telepon: null,
      pesanFooter: null,
      printerName: null,
      receiptWidth: '58mm',
    })

    updateStoreSettings(db, {
      namaToko: 'Toko B',
      alamat: 'Jl. B',
      telepon: '022',
      pesanFooter: 'Footer B',
      printerName: 'EPPOS EP58M',
      receiptWidth: '80mm',
    })

    const rows = db.select().from(storeSettings).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      namaToko: 'Toko B',
      alamat: 'Jl. B',
      telepon: '022',
      pesanFooter: 'Footer B',
      printerName: 'EPPOS EP58M',
      receiptWidth: '80mm',
    })
  })

  it('allows null alamat/telepon/pesanFooter', () => {
    const db = createDb(':memory:', migrationsFolder)

    updateStoreSettings(db, {
      namaToko: 'Toko',
      alamat: null,
      telepon: null,
      pesanFooter: null,
      printerName: null,
      receiptWidth: '58mm',
    })

    const setting = db.select().from(storeSettings).get()
    expect(setting).toMatchObject({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null })
  })

  it('throws when namaToko is empty', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() =>
      updateStoreSettings(db, { namaToko: '', alamat: null, telepon: null, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Nama toko wajib diisi.')
  })

  it('throws when namaToko is only whitespace', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() =>
      updateStoreSettings(db, { namaToko: '   ', alamat: null, telepon: null, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Nama toko wajib diisi.')
  })

  it('throws when namaToko exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() =>
      updateStoreSettings(db, { namaToko: tooLong, alamat: null, telepon: null, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Nama toko maksimal 255 karakter.')
  })

  it('allows namaToko of exactly 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const exactly255 = 'a'.repeat(255)
    expect(() =>
      updateStoreSettings(db, {
        namaToko: exactly255,
        alamat: null,
        telepon: null,
        pesanFooter: null,
        printerName: null,
        receiptWidth: '58mm',
      }),
    ).not.toThrow()
  })

  it('throws when alamat exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() =>
      updateStoreSettings(db, { namaToko: 'Toko', alamat: tooLong, telepon: null, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Alamat maksimal 255 karakter.')
  })

  it('throws when telepon exceeds 50 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = '1'.repeat(51)
    expect(() =>
      updateStoreSettings(db, { namaToko: 'Toko', alamat: null, telepon: tooLong, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Telepon maksimal 50 karakter.')
  })

  it('throws when pesanFooter exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() =>
      updateStoreSettings(db, { namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: tooLong, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Pesan footer maksimal 255 karakter.')
  })

  it('allows a non-null printerName', () => {
    const db = createDb(':memory:', migrationsFolder)
    updateStoreSettings(db, {
      namaToko: 'Toko',
      alamat: null,
      telepon: null,
      pesanFooter: null,
      printerName: '80mm Series Printer',
      receiptWidth: '58mm',
    })
    const setting = db.select().from(storeSettings).get()
    expect(setting?.printerName).toBe('80mm Series Printer')
  })

  it('allows receiptWidth of 80mm', () => {
    const db = createDb(':memory:', migrationsFolder)
    updateStoreSettings(db, {
      namaToko: 'Toko',
      alamat: null,
      telepon: null,
      pesanFooter: null,
      printerName: null,
      receiptWidth: '80mm',
    })
    const setting = db.select().from(storeSettings).get()
    expect(setting?.receiptWidth).toBe('80mm')
  })

  it('throws when receiptWidth is not 58mm or 80mm', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() =>
      updateStoreSettings(db, {
        namaToko: 'Toko',
        alamat: null,
        telepon: null,
        pesanFooter: null,
        printerName: null,
        // @ts-expect-error - deliberately invalid for this test
        receiptWidth: '100mm',
      }),
    ).toThrow('Lebar kertas tidak valid.')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run kasir.test.ts`
Expected: FAIL — TypeScript errors on the missing `printerName`/`receiptWidth` fields in `updateStoreSettings`'s parameter type, and `'Lebar kertas tidak valid.'` never thrown.

- [ ] **Step 5: Extend `updateStoreSettings`**

In `desktop-node/src/main/kasir.ts`, find:

```typescript
export function updateStoreSettings(
  db: BetterSQLite3Database<typeof schema>,
  input: { namaToko: string; alamat: string | null; telepon: string | null; pesanFooter: string | null },
): void {
  if (!input.namaToko.trim()) {
    throw new Error('Nama toko wajib diisi.')
  }

  if (input.namaToko.length > 255) {
    throw new Error('Nama toko maksimal 255 karakter.')
  }

  if (input.alamat && input.alamat.length > 255) {
    throw new Error('Alamat maksimal 255 karakter.')
  }

  if (input.telepon && input.telepon.length > 50) {
    throw new Error('Telepon maksimal 50 karakter.')
  }

  if (input.pesanFooter && input.pesanFooter.length > 255) {
    throw new Error('Pesan footer maksimal 255 karakter.')
  }

  const now = new Date()
  const existing = db.select().from(storeSettings).get()

  if (existing) {
    db.update(storeSettings)
      .set({
        namaToko: input.namaToko,
        alamat: input.alamat,
        telepon: input.telepon,
        pesanFooter: input.pesanFooter,
      })
      .where(eq(storeSettings.id, existing.id))
      .run()
  } else {
    db.insert(storeSettings)
      .values({
        namaToko: input.namaToko,
        alamat: input.alamat,
        telepon: input.telepon,
        pesanFooter: input.pesanFooter,
        createdAt: now,
        updatedAt: now,
      })
      .run()
```

Replace with:

```typescript
export function updateStoreSettings(
  db: BetterSQLite3Database<typeof schema>,
  input: {
    namaToko: string
    alamat: string | null
    telepon: string | null
    pesanFooter: string | null
    printerName: string | null
    receiptWidth: '58mm' | '80mm'
  },
): void {
  if (!input.namaToko.trim()) {
    throw new Error('Nama toko wajib diisi.')
  }

  if (input.namaToko.length > 255) {
    throw new Error('Nama toko maksimal 255 karakter.')
  }

  if (input.alamat && input.alamat.length > 255) {
    throw new Error('Alamat maksimal 255 karakter.')
  }

  if (input.telepon && input.telepon.length > 50) {
    throw new Error('Telepon maksimal 50 karakter.')
  }

  if (input.pesanFooter && input.pesanFooter.length > 255) {
    throw new Error('Pesan footer maksimal 255 karakter.')
  }

  if (input.receiptWidth !== '58mm' && input.receiptWidth !== '80mm') {
    throw new Error('Lebar kertas tidak valid.')
  }

  const now = new Date()
  const existing = db.select().from(storeSettings).get()

  if (existing) {
    db.update(storeSettings)
      .set({
        namaToko: input.namaToko,
        alamat: input.alamat,
        telepon: input.telepon,
        pesanFooter: input.pesanFooter,
        printerName: input.printerName,
        receiptWidth: input.receiptWidth,
      })
      .where(eq(storeSettings.id, existing.id))
      .run()
  } else {
    db.insert(storeSettings)
      .values({
        namaToko: input.namaToko,
        alamat: input.alamat,
        telepon: input.telepon,
        pesanFooter: input.pesanFooter,
        printerName: input.printerName,
        receiptWidth: input.receiptWidth,
        createdAt: now,
        updatedAt: now,
      })
      .run()
```

(The function's closing `}` after this block is unchanged — only the parameter type and the two `.set()`/`.values()` object literals gain the two new fields.)

- [ ] **Step 6: Update `kasir:getStoreSettings` and `kasir:updateStoreSettings` IPC handlers**

In `desktop-node/src/main/ipc/kasir.ts`, find:

```typescript
  ipcMain.handle('kasir:getStoreSettings', () => {
    const setting = db.select().from(storeSettings).get()

    return {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
    }
  })
```

Replace with:

```typescript
  ipcMain.handle('kasir:getStoreSettings', () => {
    const setting = db.select().from(storeSettings).get()

    return {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
      printerName: setting?.printerName ?? null,
      receiptWidth: setting?.receiptWidth ?? '58mm',
    }
  })
```

Find:

```typescript
  ipcMain.handle(
    'kasir:updateStoreSettings',
    (_event, input: { namaToko: string; alamat: string | null; telepon: string | null; pesanFooter: string | null }) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      updateStoreSettings(db, input)
    },
  )
```

Replace with:

```typescript
  ipcMain.handle(
    'kasir:updateStoreSettings',
    (
      _event,
      input: {
        namaToko: string
        alamat: string | null
        telepon: string | null
        pesanFooter: string | null
        printerName: string | null
        receiptWidth: '58mm' | '80mm'
      },
    ) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      updateStoreSettings(db, input)
    },
  )
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run kasir.test.ts`
Expected: PASS — all tests in `kasir.test.ts` green, including the 12 `updateStoreSettings` tests (9 updated, 3 new).

- [ ] **Step 8: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors. (`ipc/kasir.ts`'s `getReceiptForSale` and old `printReceipt` handlers are untouched by this task and still typecheck — they're removed/rewritten in Task 4.)

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/main/db/schema.ts src/main/kasir.ts src/main/kasir.test.ts src/main/ipc/kasir.ts drizzle/
git commit -m "Add printerName/receiptWidth columns and extend store settings"
```

---

### Task 2: ESC/POS receipt builder

**Files:**
- Create: `desktop-node/src/main/escpos.ts`
- Test: `desktop-node/src/main/escpos.test.ts`

**Interfaces:**
- Produces: `export type PaperWidth = '58mm' | '80mm'`; `export interface EscPosReceiptItem {namaItem: string; qty: number; satuan: string | null; hargaJual: number; subtotal: number}`; `export interface EscPosReceiptSale {saleId: number; total: number; dibayar: number; metodePembayaran: 'tunai' | 'bon'; namaPelanggan: string | null; createdAt: string; kasirName: string | null; items: EscPosReceiptItem[]}`; `export interface EscPosStoreSettings {namaToko: string; alamat: string | null; telepon: string | null; pesanFooter: string | null}`; `export function padLine(left: string, right: string, width: number): string`; `export function centerLine(text: string, width: number): string`; `export function buildReceiptEscPos(sale: EscPosReceiptSale, storeSettings: EscPosStoreSettings, paperWidth: PaperWidth): Buffer`; `export const SAMPLE_RECEIPT: EscPosReceiptSale` — Task 4 imports all of these. Note `EscPosReceiptSale`'s shape matches `ipc/kasir.ts`'s existing `getReceipt()` helper's return shape field-for-field, so Task 4 can pass that return value straight through with no transformation.

- [ ] **Step 1: Write the failing tests**

Create `desktop-node/src/main/escpos.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildReceiptEscPos, centerLine, padLine, SAMPLE_RECEIPT, type EscPosReceiptSale, type EscPosStoreSettings } from './escpos'

describe('padLine', () => {
  it('pads with spaces to fill the width', () => {
    expect(padLine('Total', 'Rp 65.000', 32)).toBe('Total' + ' '.repeat(32 - 5 - 9) + 'Rp 65.000')
  })

  it('produces exactly `width` characters', () => {
    expect(padLine('Tunai', 'Rp 100.000', 32)).toHaveLength(32)
    expect(padLine('Kembali', 'Rp 35.000', 48)).toHaveLength(48)
  })

  it('truncates the left side when there is no room, keeping the right side intact', () => {
    const result = padLine('A very very very long product name that will not fit', 'Rp 65.000', 32)
    expect(result).toHaveLength(32)
    expect(result.endsWith('Rp 65.000')).toBe(true)
  })
})

describe('centerLine', () => {
  it('centers text with even padding', () => {
    expect(centerLine('AB', 6)).toBe('  AB')
  })

  it('returns the text unchanged when it does not fit', () => {
    const long = 'a'.repeat(40)
    expect(centerLine(long, 32)).toBe(long)
  })
})

describe('buildReceiptEscPos', () => {
  const storeSettings: EscPosStoreSettings = {
    namaToko: 'Toko Sekawan',
    alamat: 'Jl. Contoh No. 1',
    telepon: '021-1234567',
    pesanFooter: 'Terima kasih telah berbelanja',
  }

  const tunaiSale: EscPosReceiptSale = {
    saleId: 8,
    total: 65000,
    dibayar: 100000,
    metodePembayaran: 'tunai',
    namaPelanggan: null,
    createdAt: '2026-08-07T04:03:06.000Z',
    kasirName: 'Admin',
    items: [{ namaItem: 'Beras 5kg', qty: 1, satuan: 'PCS', hargaJual: 65000, subtotal: 65000 }],
  }

  it('starts with the ESC @ initialize sequence', () => {
    const bytes = buildReceiptEscPos(tunaiSale, storeSettings, '58mm')
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
  })

  it('ends with a feed and full cut sequence', () => {
    const bytes = buildReceiptEscPos(tunaiSale, storeSettings, '58mm')
    // GS V 0 = full cut, preceded by ESC d 3 (feed 3 lines)
    const tail = Array.from(bytes.subarray(bytes.length - 6))
    expect(tail).toEqual([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x00])
  })

  it('includes store info, item lines, and tunai payment lines as readable text', () => {
    const text = buildReceiptEscPos(tunaiSale, storeSettings, '58mm').toString('ascii')
    expect(text).toContain('Toko Sekawan')
    expect(text).toContain('Jl. Contoh No. 1')
    expect(text).toContain('021-1234567')
    expect(text).toContain('Struk #8')
    expect(text).toContain('Admin')
    expect(text).toContain('Beras 5kg')
    expect(text).toContain('TOTAL')
    expect(text).toContain('Tunai')
    expect(text).toContain('Kembali')
    expect(text).toContain('Terima kasih telah berbelanja')
    expect(text).not.toContain('Bon')
  })

  it('includes a Bon line with the customer name for bon sales, no Tunai/Kembali', () => {
    const bonSale: EscPosReceiptSale = { ...tunaiSale, metodePembayaran: 'bon', namaPelanggan: 'Bu Siti', dibayar: 0 }
    const text = buildReceiptEscPos(bonSale, storeSettings, '58mm').toString('ascii')
    expect(text).toContain('Bon')
    expect(text).toContain('Bu Siti')
    expect(text).not.toContain('Tunai')
    expect(text).not.toContain('Kembali')
  })

  it('omits alamat/telepon/pesanFooter lines when null', () => {
    const bareSettings: EscPosStoreSettings = { namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }
    const text = buildReceiptEscPos(tunaiSale, bareSettings, '58mm').toString('ascii')
    expect(text).toContain('Toko')
    expect(text.split('\n').filter((line) => line.trim().length > 0).length).toBeLessThan(15)
  })

  it('produces wider padded lines for 80mm than 58mm', () => {
    const text58 = buildReceiptEscPos(tunaiSale, storeSettings, '58mm').toString('ascii')
    const text80 = buildReceiptEscPos(tunaiSale, storeSettings, '80mm').toString('ascii')
    const totalLine58 = text58.split('\n').find((line) => line.startsWith('TOTAL'))
    const totalLine80 = text80.split('\n').find((line) => line.startsWith('TOTAL'))
    expect(totalLine58).toHaveLength(32)
    expect(totalLine80).toHaveLength(48)
  })

  it('clamps a negative kembalian to 0 rather than printing a negative amount', () => {
    const underpaid: EscPosReceiptSale = { ...tunaiSale, dibayar: 50000 }
    const text = buildReceiptEscPos(underpaid, storeSettings, '58mm').toString('ascii')
    const kembaliLine = text.split('\n').find((line) => line.startsWith('Kembali'))
    expect(kembaliLine).not.toContain('-')
  })
})

describe('SAMPLE_RECEIPT', () => {
  it('is a valid EscPosReceiptSale that builds without throwing', () => {
    const storeSettings: EscPosStoreSettings = { namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }
    expect(() => buildReceiptEscPos(SAMPLE_RECEIPT, storeSettings, '58mm')).not.toThrow()
  })

  it('totals match its own item subtotals (internally consistent sample data)', () => {
    const sum = SAMPLE_RECEIPT.items.reduce((acc, item) => acc + item.subtotal, 0)
    expect(sum).toBe(SAMPLE_RECEIPT.total)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run escpos.test.ts`
Expected: FAIL — `Cannot find module './escpos'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `escpos.ts`**

Create `desktop-node/src/main/escpos.ts`:

```typescript
export type PaperWidth = '58mm' | '80mm'

export interface EscPosReceiptItem {
  namaItem: string
  qty: number
  satuan: string | null
  hargaJual: number
  subtotal: number
}

export interface EscPosReceiptSale {
  saleId: number
  total: number
  dibayar: number
  metodePembayaran: 'tunai' | 'bon'
  namaPelanggan: string | null
  createdAt: string
  kasirName: string | null
  items: EscPosReceiptItem[]
}

export interface EscPosStoreSettings {
  namaToko: string
  alamat: string | null
  telepon: string | null
  pesanFooter: string | null
}

const CHAR_WIDTH: Record<PaperWidth, number> = {
  '58mm': 32,
  '80mm': 48,
}

const ESC = 0x1b
const GS = 0x1d

function initPrinter(): number[] {
  return [ESC, 0x40]
}

function setAlign(mode: 0 | 1 | 2): number[] {
  return [ESC, 0x61, mode]
}

function setBold(on: boolean): number[] {
  return [ESC, 0x45, on ? 1 : 0]
}

function feed(lines: number): number[] {
  return [ESC, 0x64, lines]
}

function cutPaper(): number[] {
  return [GS, 0x56, 0x00]
}

function textLine(s: string): number[] {
  return Array.from(Buffer.from(`${s}\n`, 'ascii'))
}

/** Right-pads/truncates so `left` and `right` sit at opposite ends of a `width`-character line. */
export function padLine(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length

  if (gap < 1) {
    const maxLeft = Math.max(0, width - right.length - 1)
    return `${left.slice(0, maxLeft)} ${right}`
  }

  return `${left}${' '.repeat(gap)}${right}`
}

/** Centers `text` within a `width`-character line. Returns it unchanged if it doesn't fit. */
export function centerLine(text: string, width: number): string {
  if (text.length >= width) {
    return text
  }

  const padLeft = Math.floor((width - text.length) / 2)
  return `${' '.repeat(padLeft)}${text}`
}

function formatRupiah(value: number): string {
  const formatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value)
  return formatted.replace(String.fromCharCode(160), ' ')
}

export function buildReceiptEscPos(sale: EscPosReceiptSale, storeSettings: EscPosStoreSettings, paperWidth: PaperWidth): Buffer {
  const width = CHAR_WIDTH[paperWidth]
  const dashLine = '-'.repeat(width)
  const out: number[] = []

  out.push(...initPrinter())

  out.push(...setAlign(1))
  out.push(...setBold(true))
  out.push(...textLine(centerLine(storeSettings.namaToko, width)))
  out.push(...setBold(false))

  if (storeSettings.alamat) {
    out.push(...textLine(centerLine(storeSettings.alamat, width)))
  }

  if (storeSettings.telepon) {
    out.push(...textLine(centerLine(storeSettings.telepon, width)))
  }

  out.push(...setAlign(0))
  out.push(...textLine(dashLine))

  const createdAtLabel = new Date(sale.createdAt).toLocaleString('id-ID')
  out.push(...textLine(padLine(`Struk #${sale.saleId}`, createdAtLabel, width)))

  if (sale.kasirName) {
    out.push(...textLine(padLine('Kasir', sale.kasirName, width)))
  }

  out.push(...textLine(dashLine))

  for (const item of sale.items) {
    out.push(...textLine(item.namaItem))
    const qtyLabel = `${item.qty} ${item.satuan ?? ''} x ${formatRupiah(item.hargaJual)}`.replace(/\s+/g, ' ').trim()
    out.push(...textLine(padLine(qtyLabel, formatRupiah(item.subtotal), width)))
  }

  out.push(...textLine(dashLine))

  out.push(...setBold(true))
  out.push(...textLine(padLine('TOTAL', formatRupiah(sale.total), width)))
  out.push(...setBold(false))

  if (sale.metodePembayaran === 'tunai') {
    out.push(...textLine(padLine('Tunai', formatRupiah(sale.dibayar), width)))
    const kembalian = sale.dibayar - sale.total
    out.push(...textLine(padLine('Kembali', formatRupiah(Math.max(kembalian, 0)), width)))
  } else {
    out.push(...textLine(padLine('Bon', sale.namaPelanggan ?? '', width)))
  }

  if (storeSettings.pesanFooter) {
    out.push(...textLine(dashLine))
    out.push(...setAlign(1))
    out.push(...textLine(centerLine(storeSettings.pesanFooter, width)))
  }

  out.push(...feed(3))
  out.push(...cutPaper())

  return Buffer.from(out)
}

/** Fixed sample receipt for the Settings page's Test Print tool — matches the web app's dummySale() precedent. */
export const SAMPLE_RECEIPT: EscPosReceiptSale = {
  saleId: 0,
  total: 25000,
  dibayar: 30000,
  metodePembayaran: 'tunai',
  namaPelanggan: null,
  createdAt: new Date().toISOString(),
  kasirName: 'Test',
  items: [
    { namaItem: 'Contoh Produk A', qty: 2, satuan: 'PCS', hargaJual: 10000, subtotal: 20000 },
    { namaItem: 'Contoh Produk B', qty: 1, satuan: 'PCS', hargaJual: 5000, subtotal: 5000 },
  ],
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run escpos.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd desktop-node
git add src/main/escpos.ts src/main/escpos.test.ts
git commit -m "Add ESC/POS receipt byte builder"
```

---

### Task 3: Windows raw-print transport

**Files:**
- Create: `desktop-node/src/main/print-windows.ts`

**Interfaces:**
- Produces: `export function printRaw(printerName: string, data: Buffer): Promise<void>` — Task 4 imports this.

Not unit-tested (spawns a real process against a real printer) — verified manually in Task 5.

- [ ] **Step 1: Create `print-windows.ts`**

Create `desktop-node/src/main/print-windows.ts`:

```typescript
import { execFile } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Standard Microsoft-documented "RawPrinterHelper" technique (KB322091):
// P/Invoke winspool.drv directly so the byte buffer reaches the printer
// as-is, datatype "RAW" - no driver-side re-rendering, which is exactly
// what made Electron's webContents.print({silent:true}) unreliable here.
const RAW_PRINT_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$DataPath
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static void SendBytesToPrinter(string szPrinterName, byte[] pBytes)
    {
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        int dwWritten;
        bool bSuccess = false;

        di.pDocName = "POS Receipt";
        di.pDataType = "RAW";

        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero))
        {
            if (StartDocPrinter(hPrinter, 1, di))
            {
                if (StartPagePrinter(hPrinter))
                {
                    bSuccess = WritePrinter(hPrinter, pBytes, pBytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }

        if (!bSuccess)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($DataPath)
[RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
`

export async function printRaw(printerName: string, data: Buffer): Promise<void> {
  const id = Date.now()
  const dataPath = join(tmpdir(), `pos-print-${id}.bin`)
  const scriptPath = join(tmpdir(), `pos-print-${id}.ps1`)

  writeFileSync(dataPath, data)
  writeFileSync(scriptPath, RAW_PRINT_SCRIPT)

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-PrinterName',
      printerName,
      '-DataPath',
      dataPath,
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Gagal mencetak: ${message}`)
  } finally {
    try {
      unlinkSync(dataPath)
    } catch {
      // best-effort cleanup
    }
    try {
      unlinkSync(scriptPath)
    } catch {
      // best-effort cleanup
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as before this task plus Task 2's new `escpos.test.ts` tests (this task adds no new automated tests of its own).

- [ ] **Step 4: Commit**

```bash
cd desktop-node
git add src/main/print-windows.ts
git commit -m "Add Windows raw-print transport (winspool.drv via PowerShell)"
```

---

### Task 4: IPC rewiring + renderer wiring + dead code removal

This task is deliberately one unit, not two: rewiring the IPC layer to the new `printReceipt(saleId)` contract necessarily breaks `Kasir.tsx`/`KasirHistory.tsx` (they still call the old no-arg signature) until they're updated in the same commit — splitting this into "IPC" then "renderer" tasks would leave an intermediate commit that fails `tsc --noEmit`, which every other task in this plan (and every prior plan in this project) avoids.

**Files:**
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx`
- Modify: `desktop-node/src/renderer/pages/KasirHistory.tsx`
- Delete: `desktop-node/src/renderer/pages/kasir/Receipt.tsx`
- Modify: `desktop-node/src/renderer/assets/main.css`

**Interfaces:**
- Consumes: `buildReceiptEscPos`, `SAMPLE_RECEIPT`, `type PaperWidth` from Task 2's `escpos.ts`; `printRaw` from Task 3's `print-windows.ts`; `getReceipt` (existing module-level helper, already in this file).
- Produces: `kasir:printReceipt(saleId: number): Promise<void>`, `kasir:listPrinters(): Promise<{name: string; displayName: string; isDefault: boolean}[]>`, `kasir:testPrint(): Promise<void>` — `window.api.kasir.printReceipt(saleId)`, `.listPrinters()`, `.testPrint()`. Task 5's `Settings.tsx` calls `listPrinters`/`testPrint`. `kasir:getReceiptForSale` and `window.api.kasir.getReceiptForSale` are removed entirely.

- [ ] **Step 1: Add the new imports**

In `desktop-node/src/main/ipc/kasir.ts`, find:

```typescript
import { checkout, cancelSale, recordBonPayment, updateStoreSettings, purgeSalesBefore, type CheckoutInput } from '../kasir'
import { getCurrentUser } from './auth'
import { getMainWindow } from '../index'
```

Replace with:

```typescript
import { checkout, cancelSale, recordBonPayment, updateStoreSettings, purgeSalesBefore, type CheckoutInput } from '../kasir'
import { buildReceiptEscPos, SAMPLE_RECEIPT, type PaperWidth } from '../escpos'
import { printRaw } from '../print-windows'
import { getCurrentUser } from './auth'
import { getMainWindow } from '../index'
```

- [ ] **Step 2: Add a `resolvePrinterName` helper**

Add this function after the existing module-level `getReceipt` helper (before `export function registerKasirIpc`):

```typescript
async function resolvePrinterName(savedName: string | null): Promise<string> {
  if (savedName) {
    return savedName
  }

  const window = getMainWindow()

  if (!window) {
    throw new Error('Jendela aplikasi tidak ditemukan.')
  }

  const printers = await window.webContents.getPrintersAsync()
  const defaultPrinter = printers.find((printer) => printer.isDefault)

  if (!defaultPrinter) {
    throw new Error('Tidak ada printer default. Pilih printer di Pengaturan.')
  }

  return defaultPrinter.name
}
```

- [ ] **Step 3: Replace `kasir:printReceipt`, remove `kasir:getReceiptForSale`**

Find:

```typescript
  ipcMain.handle('kasir:printReceipt', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const window = getMainWindow()

    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    return new Promise<void>((resolve, reject) => {
      window.webContents.print(
        {
          silent: false,
          pageSize: { width: 80_000, height: 297_000 },
          dpi: { horizontal: 203, vertical: 203 },
        },
        (success, errorType) => {
          if (success) {
            resolve()
          } else {
            reject(new Error(errorType || 'Gagal mencetak struk.'))
          }
        },
      )
    })
  })

  ipcMain.handle('kasir:getReceiptForSale', (_event, saleId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    if (!sale) {
      throw new Error('Transaksi tidak ditemukan.')
    }

    const kasir = sale.userId ? db.select().from(users).where(eq(users.id, sale.userId)).get() : null

    return getReceipt(db, saleId, kasir?.name ?? null)
  })
```

Replace with:

```typescript
  ipcMain.handle('kasir:printReceipt', async (_event, saleId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    if (!sale) {
      throw new Error('Transaksi tidak ditemukan.')
    }

    const kasir = sale.userId ? db.select().from(users).where(eq(users.id, sale.userId)).get() : null
    const receipt = getReceipt(db, saleId, kasir?.name ?? null)

    const setting = db.select().from(storeSettings).get()
    const storeInfo = {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
    }
    const paperWidth: PaperWidth = setting?.receiptWidth ?? '58mm'

    const bytes = buildReceiptEscPos(receipt, storeInfo, paperWidth)
    const printerName = await resolvePrinterName(setting?.printerName ?? null)
    await printRaw(printerName, bytes)
  })

  ipcMain.handle('kasir:listPrinters', async () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const window = getMainWindow()

    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    const printers = await window.webContents.getPrintersAsync()
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName, isDefault: printer.isDefault }))
  })

  ipcMain.handle('kasir:testPrint', async () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const setting = db.select().from(storeSettings).get()
    const storeInfo = {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
    }
    const paperWidth: PaperWidth = setting?.receiptWidth ?? '58mm'

    const bytes = buildReceiptEscPos(SAMPLE_RECEIPT, storeInfo, paperWidth)
    const printerName = await resolvePrinterName(setting?.printerName ?? null)
    await printRaw(printerName, bytes)
  })
```

- [ ] **Step 4: Update preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
    printReceipt: () => invoke('kasir:printReceipt'),
    getReceiptForSale: (saleId: number) => invoke('kasir:getReceiptForSale', saleId),
```

Replace with:

```typescript
    printReceipt: (saleId: number) => invoke('kasir:printReceipt', saleId),
    listPrinters: () => invoke('kasir:listPrinters'),
    testPrint: () => invoke('kasir:testPrint'),
```

Find:

```typescript
    updateStoreSettings: (input: {
      namaToko: string
      alamat: string | null
      telepon: string | null
      pesanFooter: string | null
    }) => invoke('kasir:updateStoreSettings', input),
```

Replace with:

```typescript
    updateStoreSettings: (input: {
      namaToko: string
      alamat: string | null
      telepon: string | null
      pesanFooter: string | null
      printerName: string | null
      receiptWidth: '58mm' | '80mm'
    }) => invoke('kasir:updateStoreSettings', input),
```

- [ ] **Step 5: Update `env.d.ts`**

In `desktop-node/src/renderer/env.d.ts`, find:

```typescript
        getStoreSettings: () => Promise<{
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
        }>
        printReceipt: () => Promise<void>
        getReceiptForSale: (saleId: number) => Promise<{
          saleId: number
          total: number
          dibayar: number
          metodePembayaran: 'tunai' | 'bon'
          namaPelanggan: string | null
          createdAt: string
          kasirName: string | null
          items: { namaItem: string; qty: number; satuan: string | null; hargaJual: number; subtotal: number }[]
        }>
```

Replace with:

```typescript
        getStoreSettings: () => Promise<{
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
          printerName: string | null
          receiptWidth: '58mm' | '80mm'
        }>
        printReceipt: (saleId: number) => Promise<void>
        listPrinters: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>
        testPrint: () => Promise<void>
```

Find:

```typescript
        updateStoreSettings: (input: {
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
        }) => Promise<void>
```

Replace with:

```typescript
        updateStoreSettings: (input: {
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
          printerName: string | null
          receiptWidth: '58mm' | '80mm'
        }) => Promise<void>
```

Continue directly with the renderer-side changes below — do not stop to typecheck or commit yet, since `Kasir.tsx`/`KasirHistory.tsx` still reference the old API at this point and the build is intentionally mid-edit.

- [ ] **Step 6: Delete `Receipt.tsx`**

Delete `desktop-node/src/renderer/pages/kasir/Receipt.tsx`.

- [ ] **Step 7: Remove the print CSS block**

In `desktop-node/src/renderer/assets/main.css`, find:

```css
/* Struk Kasir: hidden on screen, only the receipt shows when printing. */
/* Sized for an 80mm thermal receipt printer - "auto" height lets the
   printer's continuous roll driver cut wherever the content ends
   instead of forcing a fixed page length. */
@page {
  size: 80mm auto;
  margin: 0;
}

@media print {
  body * {
    visibility: hidden;
  }

  .receipt-print,
  .receipt-print * {
    visibility: visible;
  }

  .receipt-print {
    display: block !important;
    position: absolute;
    top: 0;
    left: 0;
    width: 80mm;
    padding: 2mm;
  }
}
```

Delete this entire block (nothing replaces it — the file's `@layer base { ... }` block above it becomes the new end of the file).

- [ ] **Step 8: Rewrite `Kasir.tsx`'s print flow**

Find:

```typescript
import { addLine, applyQty, changeUnit, lineKey, unitPrice, type CartLine, type Product } from './kasir/cart-logic'
import { Receipt, type ReceiptSale, type StoreSettingsDto } from './kasir/Receipt'
```

Replace with:

```typescript
import { addLine, applyQty, changeUnit, lineKey, unitPrice, type CartLine, type Product } from './kasir/cart-logic'
```

Find:

```typescript
  const [message, setMessage] = useState<string | null>(null)
  const [receiptSale, setReceiptSale] = useState<ReceiptSale | null>(null)
  const [storeSettings, setStoreSettings] = useState<StoreSettingsDto | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
```

Replace with:

```typescript
  const [message, setMessage] = useState<string | null>(null)
  const [printingSaleId, setPrintingSaleId] = useState<number | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
```

Find:

```typescript
  useEffect(() => {
    refreshProducts()
    refreshSalesToday()
    window.api.kasir
      .getStoreSettings()
      .then(setStoreSettings)
      .catch(() => setStoreSettings({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

Replace with:

```typescript
  useEffect(() => {
    refreshProducts()
    refreshSalesToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

Find:

```typescript
      if (shouldPrint) {
        // Keep the dialog open (showing this sale's totals) until printing
        // actually finishes - it resets and closes from the print effect
        // below instead.
        setReceiptSale(sale)
        return
      }
```

Replace with:

```typescript
      if (shouldPrint) {
        // Keep the dialog open (showing this sale's totals) until printing
        // actually finishes - it resets and closes from the print effect
        // below instead.
        setPrintingSaleId(sale.saleId)
        return
      }
```

Find:

```typescript
  // The Receipt component (rendered hidden below, shown via .receipt-print
  // in assets/main.css) needs to actually be in the DOM before printReceipt
  // captures the window's content - this effect runs after React commits
  // the render triggered by setReceiptSale, so it's already there by now.
  useEffect(() => {
    if (!receiptSale) {
      return
    }

    let cancelled = false

    window.api.kasir
      .printReceipt()
      .then(() => {
        if (cancelled) {
          return
        }

        setMessage('Transaksi disimpan.')
      })
      .catch((err) => {
        if (cancelled) {
          return
        }

        setError(err instanceof Error ? err.message : 'Gagal mencetak struk')
      })
      .finally(() => {
        if (cancelled) {
          return
        }

        setReceiptSale(null)
        resetAfterCheckout()
        refreshProducts()
        refreshSalesToday()
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptSale])
```

Replace with:

```typescript
  useEffect(() => {
    if (!printingSaleId) {
      return
    }

    let cancelled = false

    window.api.kasir
      .printReceipt(printingSaleId)
      .then(() => {
        if (cancelled) {
          return
        }

        setMessage('Transaksi disimpan.')
      })
      .catch((err) => {
        if (cancelled) {
          return
        }

        setError(err instanceof Error ? err.message : 'Gagal mencetak struk')
      })
      .finally(() => {
        if (cancelled) {
          return
        }

        setPrintingSaleId(null)
        resetAfterCheckout()
        refreshProducts()
        refreshSalesToday()
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printingSaleId])
```

Find:

```typescript
        processing={processing}
        printing={receiptSale !== null}
        error={checkoutError}
```

Replace with:

```typescript
        processing={processing}
        printing={printingSaleId !== null}
        error={checkoutError}
```

Find the end of the file:

```typescript
      </section>
      </div>
      </AppShell>

      {receiptSale && storeSettings && <Receipt sale={receiptSale} storeSettings={storeSettings} />}
    </>
  )
}
```

Replace with:

```typescript
      </section>
      </div>
      </AppShell>
    </>
  )
}
```

- [ ] **Step 9: Rewrite `KasirHistory.tsx`'s print flow**

Find:

```typescript
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
import { Receipt, type ReceiptSale, type StoreSettingsDto } from './kasir/Receipt'
```

Replace with:

```typescript
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
```

Find:

```typescript
  const [rows, setRows] = useState<SaleHistoryRow[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const [receiptSale, setReceiptSale] = useState<ReceiptSale | null>(null)
  const [storeSettings, setStoreSettings] = useState<StoreSettingsDto | null>(null)

  useEffect(() => {
    window.api.kasir
      .getStoreSettings()
      .then(setStoreSettings)
      .catch(() => setStoreSettings({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }))
  }, [])

  function loadPage(page: number) {
```

Replace with:

```typescript
  const [rows, setRows] = useState<SaleHistoryRow[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  function loadPage(page: number) {
```

Find:

```typescript
  async function printSale(saleId: number) {
    setError(null)

    try {
      const sale = await window.api.kasir.getReceiptForSale(saleId)
      setReceiptSale(sale)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat struk')
    }
  }

  useEffect(() => {
    if (!receiptSale) {
      return
    }

    let cancelled = false

    window.api.kasir
      .printReceipt()
      .catch((err) => {
        if (cancelled) {
          return
        }
        setError(err instanceof Error ? err.message : 'Gagal mencetak struk')
      })
      .finally(() => {
        if (cancelled) {
          return
        }
        setReceiptSale(null)
      })

    return () => {
      cancelled = true
    }
  }, [receiptSale])
```

Replace with:

```typescript
  async function printSale(saleId: number) {
    setError(null)

    try {
      await window.api.kasir.printReceipt(saleId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencetak struk')
    }
  }
```

Find the end of the file:

```typescript
      </div>
      </AppShell>

      {receiptSale && storeSettings && <Receipt sale={receiptSale} storeSettings={storeSettings} />}
    </>
  )
}
```

Replace with:

```typescript
      </div>
      </AppShell>
    </>
  )
}
```

- [ ] **Step 10: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors — this is the first typecheck since Step 1, covering all seven files this task touched together.

- [ ] **Step 11: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as after Task 3 (this task adds no new automated tests — `printRaw`/`buildReceiptEscPos` are already covered by Tasks 2-3; the IPC glue and renderer wiring are verified manually in Task 5).

- [ ] **Step 12: Commit**

```bash
cd desktop-node
git add src/main/ipc/kasir.ts src/preload/index.ts src/renderer/env.d.ts src/renderer/pages/Kasir.tsx src/renderer/pages/KasirHistory.tsx src/renderer/assets/main.css
git rm src/renderer/pages/kasir/Receipt.tsx
git commit -m "Rewire printing to ESC/POS end-to-end, delete dead Receipt.tsx and print CSS"
```

---

### Task 5: Settings UI — printer/paper-width fields, Test Print; verification

**Files:**
- Modify: `desktop-node/src/renderer/pages/Settings.tsx`

**Interfaces:**
- Consumes: `window.api.kasir.listPrinters()`, `.testPrint()` (Task 4); `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` (existing, already used by `KasirHistory.tsx`'s filters).

- [ ] **Step 1: Add printer/width fields to the store form, and a Test Print section**

In `desktop-node/src/renderer/pages/Settings.tsx`, find:

```typescript
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Heading } from '@/components/heading'
import { useConfirm } from '@/hooks/use-confirm'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
```

Replace with:

```typescript
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Printer, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Heading } from '@/components/heading'
import { useConfirm } from '@/hooks/use-confirm'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
```

Find the end of `TestScan`'s definition and the start of `PurgeHistory`:

```typescript
      <ScanLine className="size-5 shrink-0 text-muted-foreground" />
    </div>
  )
}

function PurgeHistory() {
```

Replace with (adds a `TestPrint` component after `TestScan`):

```typescript
      <ScanLine className="size-5 shrink-0 text-muted-foreground" />
    </div>
  )
}

function TestPrint() {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function runTestPrint() {
    setProcessing(true)
    setError(null)
    setMessage(null)

    try {
      await window.api.kasir.testPrint()
      setMessage('Struk uji dicetak.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencetak')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Test Print</p>
        <p className="text-sm text-muted-foreground">
          Cetak struk contoh menggunakan printer dan lebar kertas yang sudah disimpan, untuk memastikan pengaturan sudah benar.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
      <Button type="button" variant="outline" onClick={runTestPrint} disabled={processing}>
        <Printer className="size-4" />
        Test Print
      </Button>
    </div>
  )
}

function PurgeHistory() {
```

- [ ] **Step 2: Extend `Settings()`'s state and load/submit logic**

Find:

```typescript
export function Settings() {
  const [namaToko, setNamaToko] = useState('')
  const [alamat, setAlamat] = useState('')
  const [telepon, setTelepon] = useState('')
  const [pesanFooter, setPesanFooter] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.kasir
      .getStoreSettings()
      .then((settings) => {
        setNamaToko(settings.namaToko)
        setAlamat(settings.alamat ?? '')
        setTelepon(settings.telepon ?? '')
        setPesanFooter(settings.pesanFooter ?? '')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan toko.'))
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    setProcessing(true)
    setError(null)
    setMessage(null)

    window.api.kasir
      .updateStoreSettings({
        namaToko,
        alamat: alamat || null,
        telepon: telepon || null,
        pesanFooter: pesanFooter || null,
      })
      .then(() => setMessage('Pengaturan toko diperbarui.'))
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }
```

Replace with:

```typescript
export function Settings() {
  const [namaToko, setNamaToko] = useState('')
  const [alamat, setAlamat] = useState('')
  const [telepon, setTelepon] = useState('')
  const [pesanFooter, setPesanFooter] = useState('')
  const [printerName, setPrinterName] = useState<string | null>(null)
  const [receiptWidth, setReceiptWidth] = useState<'58mm' | '80mm'>('58mm')
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.kasir
      .getStoreSettings()
      .then((settings) => {
        setNamaToko(settings.namaToko)
        setAlamat(settings.alamat ?? '')
        setTelepon(settings.telepon ?? '')
        setPesanFooter(settings.pesanFooter ?? '')
        setPrinterName(settings.printerName)
        setReceiptWidth(settings.receiptWidth)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan toko.'))

    window.api.kasir
      .listPrinters()
      .then(setPrinters)
      .catch(() => setPrinters([]))
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    setProcessing(true)
    setError(null)
    setMessage(null)

    window.api.kasir
      .updateStoreSettings({
        namaToko,
        alamat: alamat || null,
        telepon: telepon || null,
        pesanFooter: pesanFooter || null,
        printerName,
        receiptWidth,
      })
      .then(() => setMessage('Pengaturan toko diperbarui.'))
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }
```

- [ ] **Step 3: Add the printer/width fields to the form, and the Test Print section to the page**

Find:

```typescript
            <div className="grid gap-2">
              <Label htmlFor="pesan_footer">Pesan Footer Struk</Label>
              <Input id="pesan_footer" value={pesanFooter} onChange={(e) => setPesanFooter(e.target.value)} />
            </div>

            <Button type="submit" disabled={processing}>
              Simpan
            </Button>
          </form>
        </div>

        <div className="space-y-6">
          <Heading variant="small" title="Perangkat" description="Uji scanner barcode yang terhubung" />
          <TestScan />
        </div>
```

Replace with:

```typescript
            <div className="grid gap-2">
              <Label htmlFor="pesan_footer">Pesan Footer Struk</Label>
              <Input id="pesan_footer" value={pesanFooter} onChange={(e) => setPesanFooter(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="printer_name">Printer</Label>
              <Select value={printerName ?? '__default__'} onValueChange={(v) => setPrinterName(v === '__default__' ? null : v)}>
                <SelectTrigger id="printer_name" className="w-full">
                  <SelectValue placeholder="Printer default sistem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Printer default sistem</SelectItem>
                  {printers.map((printer) => (
                    <SelectItem key={printer.name} value={printer.name}>
                      {printer.displayName}
                      {printer.isDefault ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="receipt_width">Lebar Kertas Struk</Label>
              <Select value={receiptWidth} onValueChange={(v) => setReceiptWidth(v as '58mm' | '80mm')}>
                <SelectTrigger id="receipt_width" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="58mm">58mm</SelectItem>
                  <SelectItem value="80mm">80mm</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" disabled={processing}>
              Simpan
            </Button>
          </form>
        </div>

        <div className="space-y-6">
          <Heading variant="small" title="Perangkat" description="Uji scanner barcode dan printer struk yang terhubung" />
          <TestScan />
          <TestPrint />
        </div>
```

(`Select`'s value must be a non-empty string — `'__default__'` is a sentinel meaning "no printer explicitly chosen," translated to/from `null` at the boundary, since Radix `Select` cannot use an empty string as an item value.)

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as after Task 4 (this task is pure UI, no new automated tests — verified manually in Step 7).

- [ ] **Step 6: Rebuild better-sqlite3 for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

(Run in background. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 7: Manual end-to-end verification via CDP — and a real printed receipt**

Using the established CDP pattern (query `http://127.0.0.1:9222/json` for the page target's `webSocketDebuggerUrl`, `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`; capture at least one `Page.captureScreenshot` for visual confirmation, not just `innerText`):

1. Log in, navigate to Pengaturan (via the sidebar's user dropdown). Confirm the Printer dropdown lists at least one real system printer (matching what `Get-CimInstance -ClassName Win32_Printer` shows on this machine, e.g. "80mm Series Printer"), and the "(default)" suffix appears on the correct one.
2. Select this machine's real printer explicitly (not "Printer default sistem"), set Lebar Kertas Struk to `80mm` (matching this dev machine's confirmed hardware), and Simpan. Confirm the success message appears; reload/navigate away and back, confirm both selections persisted.
3. Click Test Print. Confirm no error appears in the UI, and **physically check the printer** — a real receipt should print immediately with no dialog, showing "Toko Sekawan" / two sample items ("Contoh Produk A" x2, "Contoh Produk B" x1) / TOTAL Rp 25.000 / Tunai Rp 30.000 / Kembali Rp 5.000, correctly sized for the paper (not blank, not tiny, not a random other size).
4. Go to Kasir, add a real product to the cart, and complete a "Bayar & Cetak" checkout. Confirm no dialog appears and a correctly-printed receipt comes out for the real sale (matching the sale's actual item/total/payment data), and the UI shows "Transaksi disimpan." with the cart reset.
5. Go to Riwayat Transaksi, click "Cetak" on an older (non-latest) sale. Confirm it reprints correctly with that sale's original data, no dialog.
6. Deliberately break printing to confirm error handling: in Pengaturan, set Printer to a name that doesn't exist by temporarily editing `store_settings.printer_name` directly via `node -e "..."` against `dev.sqlite` (bypассing the UI's dropdown, which only offers valid names) to some bogus string, then attempt a Test Print. Confirm a user-facing error message appears (not a silent failure or an unhandled crash) — this is `printRaw`'s `OpenPrinter` failure path. Restore the correct printer name afterward (via the UI, Simpan) before moving on.
7. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 8: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/pages/Settings.tsx
git commit -m "Add printer/paper-width settings and Test Print"
```

---

## Plan Self-Review

**Spec coverage:** §1 (reject node-thermal-printer) → documented in Global Constraints, no task needed (it's a decision record, not code). §2 (architecture: escpos.ts + print-windows.ts) → Task 2 + Task 3. §3 (store settings: printer + width columns/validation/IPC) → Task 1. §4 (ESC/POS receipt layout, character widths, encoding) → Task 2. §5 (printReceipt signature change, server-side re-derivation) → Task 4. §6 (dead code removal: Receipt.tsx, print CSS, getReceiptForSale, page state simplification) → Task 4 (IPC removal and renderer/CSS removal are one commit, deliberately — see Task 4's opening note on why it isn't split further). §7 (Test Print) → Task 4 (`kasir:testPrint`/`SAMPLE_RECEIPT`) + Task 5 (UI). Out-of-scope items (barcode/QR/image printing, cross-platform, auto-detect paper width, trimming `checkout`'s return payload, print queue) — untouched by every task.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code, including the full PowerShell/C# RawPrinterHelper script.

**Type consistency:** `EscPosReceiptSale`/`EscPosStoreSettings`/`PaperWidth` (Task 2) are consumed identically in Task 4's `kasir:printReceipt`/`kasir:testPrint` handlers — `getReceipt()`'s existing return shape (`saleId`, `total`, `dibayar`, `metodePembayaran`, `namaPelanggan`, `createdAt`, `kasirName`, `items[{namaItem,qty,satuan,hargaJual,subtotal}]`) matches `EscPosReceiptSale` field-for-field, confirmed against the actual `getReceipt` implementation in `ipc/kasir.ts`. `printRaw(printerName, data)`'s signature (Task 3) matches its two call sites in Task 4 exactly. `updateStoreSettings`'s extended input type (Task 1) matches the IPC handler's parameter type and `preload`/`env.d.ts`'s `updateStoreSettings` signatures (Task 1 + Task 4) field-for-field. `window.api.kasir.printReceipt(saleId)`'s signature is identical across preload, env.d.ts, and both `Kasir.tsx`/`KasirHistory.tsx` call sites — all four in Task 4's own single commit, which is exactly why Task 4 could not be split without leaving an intermediate broken build.

**Task-boundary check (added on self-review):** the original draft split IPC rewiring (old Task 4) from renderer wiring (old Task 5) into separate tasks. Since `Kasir.tsx`/`KasirHistory.tsx` call `window.api.kasir.printReceipt`, changing that function's signature and the renderer call sites are not independently acceptable — a reviewer could not approve one without the other, and the old Task 4 alone would leave `tsc --noEmit` failing at its own commit, breaking the pattern every other task (and every prior plan in this project) follows of a clean, independently-verifiable commit per task. Merged into one Task 4; renumbered old Task 6 (Settings UI) to Task 5 throughout.
