# Fase 2 Slice 2, Plan C — Cetak Struk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add silent receipt printing to the Kasir page in `desktop-node/` — `webContents.print({silent:true})` triggered from the "Simpan + Cetak" action in the payment dialog, printing a 58mm thermal-receipt-formatted `Receipt` component via the same CSS-hide-everything-except-`.receipt-print` trick the Laravel app uses.

**Architecture:** Main process gains a `getMainWindow()` accessor (mirroring the existing `getCurrentUser()` pattern) so the IPC layer can reach the window without new coupling. `checkout`'s IPC response is widened (in `ipc/kasir.ts` only — the already-tested `checkout()` function in `main/kasir.ts` is untouched) to include everything the receipt needs. `PaymentDialog` regains its third action (`cetak`) that Plan B deliberately stripped, restoring exactly what the design spec's Plan B section predicted would be a low-friction re-add.

**Tech Stack:** Electron's `webContents.print` API (no new dependencies).

## Global Constraints

- New/modified code lives entirely under `desktop-node/`. Do not touch `app/`, `routes/`, `resources/`, `nativephp/`, or any other Laravel file.
- `main/kasir.ts`'s `checkout()` function (fully tested, 27 tests covering it) is **not modified** — the extra receipt data (item product names, kasir name, `createdAt`, `dibayar`) is assembled in `ipc/kasir.ts` with a follow-up query after `checkout()` returns, exactly as the design spec specifies.
- This app is Electron-only (no browser fallback anywhere in `desktop-node/`) — unlike the web app's `kasir.tsx`, which branches on a `native` flag between NativePHP's silent print and `window.print()`, this port always takes the silent-print path. Do not add a `window.print()` fallback branch — it would never execute and is dead code here.
- Money stays Rupiah in the renderer (unchanged contract from earlier plans).
- `Printer`, `Spinner` (from Plan A's shadcn/ui port) are already available; no new npm dependencies are needed anywhere in this plan.

---

## Task 1: `getMainWindow`, `kasir:printReceipt`, `kasir:getStoreSettings`

**Files:**
- Modify: `desktop-node/src/main/index.ts`
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getMainWindow(): BrowserWindow | null` (exported from `main/index.ts`); IPC channels `kasir:printReceipt` and `kasir:getStoreSettings`; `window.api.kasir.printReceipt(): Promise<void>` and `window.api.kasir.getStoreSettings(): Promise<StoreSettingsDto>` — consumed by Task 5 (`Kasir.tsx`) and Task 3 (`Receipt.tsx`, via the type only).

- [ ] **Step 1: Export `getMainWindow` from the main process**

`desktop-node/src/main/index.ts` currently has `let mainWindow: BrowserWindow | null` as a module-private variable with no way for `ipc/kasir.ts` to reach it. Add an exported accessor right after the variable declaration:

```typescript
let mainWindow: BrowserWindow | null
let db: ReturnType<typeof createDb> | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
```

(Keep everything else in the file — `getDbPath`, `getMigrationsFolder`, `createWindow`, the `app.on(...)` handlers, `app.whenReady().then(...)` — exactly as it is. This is a pure addition, no other lines change.)

- [ ] **Step 2: Add `kasir:printReceipt` and `kasir:getStoreSettings` IPC handlers**

`desktop-node/src/main/ipc/kasir.ts` currently imports `products, productUnits, productPriceTiers, sales, saleItems` from `'../db/schema'` and ends with the `kasir:cancelSale` handler. Add `storeSettings` to that import line, add an import for `getMainWindow` from `'../index'`, and add two new handlers inside `registerKasirIpc` (after the existing `kasir:cancelSale` handler, still inside the function body, before its closing brace):

```typescript
import { products, productUnits, productPriceTiers, sales, saleItems, storeSettings } from '../db/schema'
```

```typescript
import { getMainWindow } from '../index'
```

```typescript
  ipcMain.handle('kasir:getStoreSettings', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const setting = db.select().from(storeSettings).get()

    return {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
    }
  })

  ipcMain.handle('kasir:printReceipt', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const window = getMainWindow()

    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    return new Promise<void>((resolve, reject) => {
      window.webContents.print({ silent: true }, (success, errorType) => {
        if (success) {
          resolve()
        } else {
          reject(new Error(errorType || 'Gagal mencetak struk.'))
        }
      })
    })
  })
```

- [ ] **Step 3: Expose the two new channels in preload**

`desktop-node/src/preload/index.ts`'s `api.kasir` object currently ends with `cancelSale: (saleId: number) => invoke('kasir:cancelSale', saleId),`. Add two more entries right after it:

```typescript
    getStoreSettings: () => invoke('kasir:getStoreSettings'),
    printReceipt: () => invoke('kasir:printReceipt'),
```

- [ ] **Step 4: Add the two new methods' types to `env.d.ts`**

`desktop-node/src/renderer/env.d.ts`'s `kasir` interface currently ends with `cancelSale: (saleId: number) => Promise<void>`. Add two entries right after it:

```typescript
        getStoreSettings: () => Promise<{
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
        }>
        printReceipt: () => Promise<void>
```

- [ ] **Step 5: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
```

Expected: no type errors on either.

- [ ] **Step 6: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — this task adds no new test files (IPC wiring isn't unit-tested in this plan, matching the pattern from earlier plans — `checkout`/`cancelSale`'s actual logic already has full coverage in `main/kasir.test.ts`), confirms nothing broke.

- [ ] **Step 7: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/main/index.ts desktop-node/src/main/ipc/kasir.ts desktop-node/src/preload/index.ts desktop-node/src/renderer/env.d.ts
git commit -m "Add getMainWindow, kasir:printReceipt, kasir:getStoreSettings"
```

---

## Task 2: Widen `kasir:checkout`'s IPC response

**Files:**
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `checkout` (unchanged, from `main/kasir.ts`); `sales`, `saleItems`, `products` (schema, already imported in this file).
- Produces: `window.api.kasir.checkout(...)` now resolves to a full receipt payload (`ReceiptSaleDto`, defined in Task 3) instead of `{saleId, total}` — consumed by Task 5 (`Kasir.tsx`).

- [ ] **Step 1: Replace the `kasir:checkout` handler's return**

`desktop-node/src/main/ipc/kasir.ts`'s `kasir:checkout` handler currently ends with:

```typescript
    const result = checkout(db, checkoutInput)
    return { saleId: result.saleId, total: toRupiah(result.total) }
```

Replace those two lines with a follow-up query that assembles the full receipt payload after `checkout()` succeeds (it already committed the transaction — this is a plain read, not part of the transaction):

```typescript
    const result = checkout(db, checkoutInput)

    const sale = db.select().from(sales).where(eq(sales.id, result.saleId)).get()!
    const itemRows = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()
    const productIds = itemRows.map((item) => item.productId)
    const productRows = productIds.length > 0 ? db.select().from(products).where(inArray(products.id, productIds)).all() : []
    const productNameById = new Map(productRows.map((product) => [product.id, product.namaItem]))

    return {
      saleId: result.saleId,
      total: toRupiah(result.total),
      dibayar: toRupiah(sale.dibayar),
      metodePembayaran: sale.metodePembayaran,
      namaPelanggan: sale.namaPelanggan,
      createdAt: sale.createdAt.toISOString(),
      kasirName: user.name,
      items: itemRows.map((item) => ({
        namaItem: productNameById.get(item.productId) ?? '',
        qty: item.qty,
        satuan: item.satuan,
        hargaJual: toRupiah(item.hargaJual),
        subtotal: toRupiah(item.subtotal),
      })),
    }
```

(`eq` and `inArray` are already imported from `'drizzle-orm'` at the top of this file — no new imports needed. `user` is already in scope from the `const user = getCurrentUser()` earlier in this same handler.)

- [ ] **Step 2: Update `env.d.ts`'s `checkout` return type**

`desktop-node/src/renderer/env.d.ts`'s `checkout` entry currently reads:

```typescript
        checkout: (input: {
          metodePembayaran: 'tunai' | 'bon'
          namaPelanggan: string | null
          dibayar: number | null
          items: { productId: number; productUnitId: number | null; qty: number }[]
        }) => Promise<{ saleId: number; total: number }>
```

Change the return type to the full receipt shape:

```typescript
        checkout: (input: {
          metodePembayaran: 'tunai' | 'bon'
          namaPelanggan: string | null
          dibayar: number | null
          items: { productId: number; productUnitId: number | null; qty: number }[]
        }) => Promise<{
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

- [ ] **Step 3: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
```

Expected: no type errors. (`Kasir.tsx`'s `handleCheckout` still discards the return value at this point in the plan — Task 5 is where it starts consuming it — so this widening is backward-compatible with the current call site.)

- [ ] **Step 4: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — no test files touched by this task.

- [ ] **Step 5: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/main/ipc/kasir.ts desktop-node/src/renderer/env.d.ts
git commit -m "Widen kasir:checkout's IPC response to a full receipt payload"
```

---

## Task 3: Print CSS and the `Receipt` component

**Files:**
- Modify: `desktop-node/src/renderer/assets/main.css`
- Create: `desktop-node/src/renderer/pages/kasir/Receipt.tsx`

**Interfaces:**
- Consumes: `formatRupiah` (Plan A `lib/utils`).
- Produces: `.receipt-print` CSS rule (screen: hidden: print: the only visible thing); `ReceiptItem`, `ReceiptSale`, `StoreSettingsDto` types; `Receipt` component (props: `sale: ReceiptSale`, `storeSettings: StoreSettingsDto`) — consumed by Task 5 (`Kasir.tsx`).

- [ ] **Step 1: Add the print CSS**

`desktop-node/src/renderer/assets/main.css` currently ends with the `@layer base { ... }` block (from Plan A). Append this print-specific CSS after it — a verbatim port of `resources/css/app.css`'s receipt print rules:

```css
/* Struk Kasir: hidden on screen, only the receipt shows when printing. */
/* Sized for a 58mm thermal receipt printer (e.g. EPPOS EP58M) - "auto"
   height lets the printer's continuous roll driver cut wherever the
   content ends instead of forcing a fixed page length. */
@page {
  size: 58mm auto;
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
    width: 58mm;
    padding: 2mm;
  }
}
```

- [ ] **Step 2: Write the `Receipt` component**

Create `desktop-node/src/renderer/pages/kasir/Receipt.tsx`. This is a port of `resources/js/pages/kasir/shared.tsx`'s `Receipt` component, adapted to take `storeSettings` as a prop (fetched via IPC in `Kasir.tsx`, Task 5) instead of Inertia's `usePage().props` (which doesn't exist in this Electron app), and to consume the already-Rupiah-numeric, already-joined-with-product-names shape the widened `kasir:checkout` (Task 2) now returns, instead of Laravel's nested `sale.items[].product.nama_item` decimal-string shape:

```typescript
import { formatRupiah } from '@/lib/utils'

export interface ReceiptItem {
  namaItem: string
  qty: number
  satuan: string | null
  hargaJual: number
  subtotal: number
}

export interface ReceiptSale {
  saleId: number
  total: number
  dibayar: number
  metodePembayaran: 'tunai' | 'bon'
  namaPelanggan: string | null
  createdAt: string
  kasirName: string | null
  items: ReceiptItem[]
}

export interface StoreSettingsDto {
  namaToko: string
  alamat: string | null
  telepon: string | null
  pesanFooter: string | null
}

/** Only visible when printing (see the .receipt-print rule in assets/main.css). */
export function Receipt({ sale, storeSettings }: { sale: ReceiptSale; storeSettings: StoreSettingsDto }) {
  const kembalian = sale.dibayar - sale.total

  return (
    <div className="receipt-print hidden font-mono text-xs leading-relaxed text-black">
      <div className="text-center">
        <p className="text-sm font-bold uppercase">{storeSettings.namaToko}</p>
        {storeSettings.alamat && <p>{storeSettings.alamat}</p>}
        {storeSettings.telepon && <p>{storeSettings.telepon}</p>}
      </div>

      <div className="my-1.5 border-t border-dashed border-black" />

      <div className="flex justify-between">
        <span>Struk #{sale.saleId}</span>
        <span>{new Date(sale.createdAt).toLocaleString('id-ID')}</span>
      </div>
      {sale.kasirName && (
        <div className="flex justify-between">
          <span>Kasir</span>
          <span>{sale.kasirName}</span>
        </div>
      )}

      <div className="my-1.5 border-t border-dashed border-black" />

      {sale.items.map((item, index) => (
        <div key={index} className="mb-1">
          <p>{item.namaItem}</p>
          <div className="flex justify-between">
            <span>
              {item.qty} {item.satuan} x {formatRupiah(item.hargaJual)}
            </span>
            <span>{formatRupiah(item.subtotal)}</span>
          </div>
        </div>
      ))}

      <div className="my-1.5 border-t border-dashed border-black" />

      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{formatRupiah(sale.total)}</span>
      </div>

      {sale.metodePembayaran === 'tunai' ? (
        <>
          <div className="flex justify-between">
            <span>Tunai</span>
            <span>{formatRupiah(sale.dibayar)}</span>
          </div>
          <div className="flex justify-between">
            <span>Kembali</span>
            <span>{formatRupiah(Math.max(kembalian, 0))}</span>
          </div>
        </>
      ) : (
        <div className="flex justify-between">
          <span>Bon</span>
          <span>{sale.namaPelanggan}</span>
        </div>
      )}

      {storeSettings.pesanFooter && (
        <>
          <div className="my-1.5 border-t border-dashed border-black" />
          <p className="text-center">{storeSettings.pesanFooter}</p>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 4: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — `Receipt` is presentational, no new test files.

- [ ] **Step 5: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/assets/main.css desktop-node/src/renderer/pages/kasir/Receipt.tsx
git commit -m "Add print CSS and Receipt component"
```

---

## Task 4: Restore `PaymentDialog`'s cetak action

**Files:**
- Modify: `desktop-node/src/renderer/pages/kasir/PaymentDialog.tsx`

**Interfaces:**
- Consumes: `Printer` (lucide-react, already a dependency), `Spinner` (Plan A `components/ui/spinner`).
- Produces: `PaymentDialogProps.onSubmit` changes from `() => void` to `(shouldPrint: boolean) => void`; new `printing: boolean` prop — consumed by Task 5 (`Kasir.tsx`).

- [ ] **Step 1: Replace `PaymentDialog.tsx`'s action set and props**

`desktop-node/src/renderer/pages/kasir/PaymentDialog.tsx` currently has (near the top):

```typescript
import { Banknote, CornerDownLeft, HandCoins } from 'lucide-react'
```
```typescript
const actions = ['simpan', 'batal'] as const
type Action = (typeof actions)[number]
```
```typescript
export interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  metode: 'tunai' | 'bon'
  setMetode: (metode: 'tunai' | 'bon') => void
  namaPelanggan: string
  setNamaPelanggan: (value: string) => void
  dibayar: string
  setDibayar: (value: string) => void
  processing: boolean
  error: string | null
  onSubmit: () => void
}
```

Replace all three with:

```typescript
import { Banknote, CornerDownLeft, HandCoins, Printer } from 'lucide-react'
```
```typescript
const actions = ['cetak', 'simpan', 'batal'] as const
type Action = (typeof actions)[number]
```
```typescript
export interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  metode: 'tunai' | 'bon'
  setMetode: (metode: 'tunai' | 'bon') => void
  namaPelanggan: string
  setNamaPelanggan: (value: string) => void
  dibayar: string
  setDibayar: (value: string) => void
  processing: boolean
  printing: boolean
  error: string | null
  onSubmit: (shouldPrint: boolean) => void
}
```

Also add `Spinner` to the shadcn/ui imports — the import block currently reads:

```typescript
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
```

Add `Spinner`:

```typescript
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
```

- [ ] **Step 2: Update the function signature and default selected action**

The function declaration and its destructured props currently read:

```typescript
export function PaymentDialog({
  open,
  onOpenChange,
  total,
  metode,
  setMetode,
  namaPelanggan,
  setNamaPelanggan,
  dibayar,
  setDibayar,
  processing,
  error,
  onSubmit,
}: PaymentDialogProps) {
```

Add `printing` to the destructured props:

```typescript
export function PaymentDialog({
  open,
  onOpenChange,
  total,
  metode,
  setMetode,
  namaPelanggan,
  setNamaPelanggan,
  dibayar,
  setDibayar,
  processing,
  printing,
  error,
  onSubmit,
}: PaymentDialogProps) {
```

The default-action state currently reads `useState<Action>('simpan')` in two places (the initial `useState` and the reset-on-open branch) — change both to `'cetak'` (matching the web source's default, since it's the primary "just finish the sale" action):

```typescript
  const [selectedAction, setSelectedAction] = useState<Action>('cetak')
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)

    if (open) {
      setSelectedAction('cetak')
    }
  }
```

- [ ] **Step 3: Update `runAction`, `handleShortcut`, and the `disabled` computation**

`runAction` currently reads:

```typescript
  function runAction(action: Action) {
    if (action === 'simpan') {
      onSubmit()
    } else {
      onOpenChange(false)
    }
  }
```

Replace with:

```typescript
  function runAction(action: Action) {
    if (action === 'cetak') {
      onSubmit(true)
    } else if (action === 'simpan') {
      onSubmit(false)
    } else {
      onOpenChange(false)
    }
  }
```

`handleShortcut`'s guard at the top currently reads `if (processing) { return }` — change it to also block while printing:

```typescript
  function handleShortcut(e: ReactKeyboardEvent) {
    if (processing || printing) {
      return
    }
```

Its `case 's':` (Alt+S) currently calls `onSubmit()` — update the call to pass `false` (save without print, matching the web source's Alt+S semantics exactly):

```typescript
      case 's':
        e.preventDefault()
        onSubmit(false)
        break
```

The form's `onSubmit` handler currently reads:

```typescript
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
          onKeyDown={handleShortcut}
          className="space-y-5"
        >
```

Change the inner call to pass `true` (submitting the form via Enter/click on the primary button means "cetak", matching the button's own `type="submit"` role below):

```typescript
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(true)
          }}
          onKeyDown={handleShortcut}
          className="space-y-5"
        >
```

Every `disabled={processing}` in the JSX (the Tunai/Bon buttons, the `Input` fields) needs to also respect `printing` — there are 4 occurrences (2 `Button`, 2 `Input`). Change each `disabled={processing}` to `disabled={processing || printing}`.

- [ ] **Step 4: Replace the action-buttons block with a printing-aware version**

The JSX currently ends with (after the `{error && (...)}` block):

```tsx
          <div className="space-y-2">
            <Button
              type="submit"
              disabled={processing}
              className={cn(
                'w-full',
                selectedAction === 'simpan' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
              )}
            >
              {selectedAction === 'simpan' && <CornerDownLeft className="size-4" />}
              Simpan
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={processing}
              className={cn(
                'w-full',
                selectedAction === 'batal' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
              )}
              onClick={() => onOpenChange(false)}
            >
              {selectedAction === 'batal' && <CornerDownLeft className="size-3.5" />}
              Batal
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Esc</kbd>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">PgUp/PgDn</kbd> pilih aksi &middot;{' '}
              <kbd className="rounded border bg-muted px-1.5 py-0.5">Enter</kbd> jalankan
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

Replace that whole block (from the opening `<div className="space-y-2">` through the end of the file) with a version that shows a spinner while printing, and restores the "Simpan + Cetak" primary button plus a secondary "Simpan" (no print) button:

```tsx
          {printing ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Spinner />
              Mencetak struk...
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                type="submit"
                disabled={processing}
                className={cn(
                  'w-full',
                  selectedAction === 'cetak' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                )}
              >
                {selectedAction === 'cetak' && <CornerDownLeft className="size-4" />}
                <Printer className="size-4" />
                Simpan + Cetak
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={processing}
                  className={cn(
                    selectedAction === 'simpan' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                  )}
                  onClick={() => onSubmit(false)}
                >
                  {selectedAction === 'simpan' && <CornerDownLeft className="size-3.5" />}
                  Simpan
                  <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+S</kbd>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={processing}
                  className={cn(
                    selectedAction === 'batal' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                  )}
                  onClick={() => onOpenChange(false)}
                >
                  {selectedAction === 'batal' && <CornerDownLeft className="size-3.5" />}
                  Batal
                  <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Esc</kbd>
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                <kbd className="rounded border bg-muted px-1.5 py-0.5">PgUp/PgDn</kbd> pilih aksi &middot;{' '}
                <kbd className="rounded border bg-muted px-1.5 py-0.5">Enter</kbd> jalankan
              </p>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: type errors ARE expected at this point — `Kasir.tsx` (Task 5, not yet done) still passes `onSubmit={handleCheckout}` where `handleCheckout` has the old `() => void` signature and doesn't pass `printing`. That mismatch is resolved in Task 5. For this task alone, verify there are no errors **inside `PaymentDialog.tsx` itself** by checking the compiler output only reports errors in `Kasir.tsx` (if any) — `PaymentDialog.tsx`'s own file should have zero errors attributable to it.

- [ ] **Step 6: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — no test files touched by this task, and Vitest doesn't typecheck.

- [ ] **Step 7: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/pages/kasir/PaymentDialog.tsx
git commit -m "Restore PaymentDialog's cetak action and printing state"
```

---

## Task 5: Wire printing into `Kasir.tsx`, manual verification

**Files:**
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx`

**Interfaces:**
- Consumes: `Receipt`, `ReceiptSale`, `StoreSettingsDto` (Task 3); `PaymentDialog`'s new `onSubmit`/`printing` props (Task 4); `window.api.kasir.checkout` (widened, Task 2), `window.api.kasir.getStoreSettings`, `window.api.kasir.printReceipt` (Task 1).
- Produces: a fully working "Simpan + Cetak" flow.

- [ ] **Step 1: Add the `Receipt` import and new state**

`desktop-node/src/renderer/pages/Kasir.tsx`'s import block currently ends with:

```typescript
import { addLine, applyQty, changeUnit, lineKey, unitPrice, type CartLine, type Product } from './kasir/cart-logic'
```

Add a `Receipt` import right after it:

```typescript
import { Receipt, type ReceiptSale, type StoreSettingsDto } from './kasir/Receipt'
```

The state declarations currently include `const [message, setMessage] = useState<string | null>(null)` — add two new pieces of state right after it:

```typescript
  const [message, setMessage] = useState<string | null>(null)
  const [receiptSale, setReceiptSale] = useState<ReceiptSale | null>(null)
  const [storeSettings, setStoreSettings] = useState<StoreSettingsDto | null>(null)
```

- [ ] **Step 2: Fetch store settings once on mount**

The `useEffect` that calls `refreshProducts()`/`refreshSalesToday()` when `user` becomes truthy currently reads:

```typescript
  useEffect(() => {
    if (!user) {
      return
    }
    refreshProducts()
    refreshSalesToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
```

Add a store-settings fetch alongside the other two (store settings rarely change mid-session, so one fetch on login is enough — no need for a `refreshStoreSettings` helper like the other two have, since nothing in this plan ever needs to refresh it after the initial load):

```typescript
  useEffect(() => {
    if (!user) {
      return
    }
    refreshProducts()
    refreshSalesToday()
    window.api.kasir.getStoreSettings().then(setStoreSettings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
```

- [ ] **Step 3: Change `handleCheckout` to accept `shouldPrint` and capture the full sale**

`handleCheckout` currently reads:

```typescript
  async function handleCheckout() {
    setProcessing(true)
    setCheckoutError(null)
    setMessage(null)

    try {
      await window.api.kasir.checkout({
        metodePembayaran: metode,
        namaPelanggan: metode === 'bon' ? namaPelanggan : null,
        dibayar: metode === 'tunai' ? Number(dibayar || 0) : null,
        items: cart.map((line) => ({
          productId: line.product.id,
          productUnitId: line.productUnitId,
          qty: line.qty,
        })),
      })
      setMessage('Transaksi disimpan.')
      setCheckoutError(null)
      resetAfterCheckout()
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Gagal checkout')
    } finally {
      setProcessing(false)
    }
  }
```

Replace it with a version that takes `shouldPrint: boolean`, captures the full sale from the widened IPC response, and — when printing — keeps the dialog open (showing the just-completed sale's totals) instead of resetting immediately, deferring the reset to the print-effect in Step 4 below:

```typescript
  async function handleCheckout(shouldPrint: boolean) {
    setProcessing(true)
    setCheckoutError(null)
    setMessage(null)

    try {
      const sale = await window.api.kasir.checkout({
        metodePembayaran: metode,
        namaPelanggan: metode === 'bon' ? namaPelanggan : null,
        dibayar: metode === 'tunai' ? Number(dibayar || 0) : null,
        items: cart.map((line) => ({
          productId: line.product.id,
          productUnitId: line.productUnitId,
          qty: line.qty,
        })),
      })

      if (shouldPrint) {
        // Keep the dialog open (showing this sale's totals) until printing
        // actually finishes - it resets and closes from the print effect
        // below instead.
        setReceiptSale(sale)
        return
      }

      setMessage('Transaksi disimpan.')
      setCheckoutError(null)
      resetAfterCheckout()
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Gagal checkout')
    } finally {
      setProcessing(false)
    }
  }
```

- [ ] **Step 4: Add the print effect**

Add this new `useEffect` right after `handleCheckout` (before `handleCancel`). Unlike the web app's equivalent effect (which branches between NativePHP's silent print and a `window.print()` browser fallback, since it runs in both contexts), this Electron-only app always takes the silent-print IPC path — there is no fallback branch to port:

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
      .catch((err) => {
        setCheckoutError(err instanceof Error ? err.message : 'Gagal mencetak struk')
      })
      .finally(() => {
        if (cancelled) {
          return
        }

        setReceiptSale(null)
        setMessage('Transaksi disimpan.')
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

- [ ] **Step 5: Wire the new props into `PaymentDialog` and render `Receipt`**

The `<PaymentDialog ... />` element currently reads:

```tsx
      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={total}
        metode={metode}
        setMetode={setMetode}
        namaPelanggan={namaPelanggan}
        setNamaPelanggan={setNamaPelanggan}
        dibayar={dibayar}
        setDibayar={setDibayar}
        processing={processing}
        error={checkoutError}
        onSubmit={handleCheckout}
      />
```

Add `printing={receiptSale !== null}` (matching the web source's `printing={receiptSale !== null}` pattern exactly):

```tsx
      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={total}
        metode={metode}
        setMetode={setMetode}
        namaPelanggan={namaPelanggan}
        setNamaPelanggan={setNamaPelanggan}
        dibayar={dibayar}
        setDibayar={setDibayar}
        processing={processing}
        printing={receiptSale !== null}
        error={checkoutError}
        onSubmit={handleCheckout}
      />
```

The component's top-level return currently reads:

```tsx
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-6">
      ...
    </div>
  )
}
```

Wrap it in a fragment and render `Receipt` as a sibling after the closing `</div>` (only once `storeSettings` has loaded — it's fetched asynchronously in Step 2, so a brief window after login could otherwise try to render `Receipt` with `storeSettings` still `null`; in practice `receiptSale` can't be set before a checkout happens, by which point `storeSettings` has long since loaded, but the `&&` guard costs nothing and removes any doubt):

```tsx
  return (
    <>
      <div className="flex-1 space-y-4 p-4 sm:p-6">
        ...
      </div>

      {receiptSale && storeSettings && <Receipt sale={receiptSale} storeSettings={storeSettings} />}
    </>
  )
}
```

(The `...` above stands for the entire existing body of the `<div>` — every line between the current `<div className="flex-1 space-y-4 p-4 sm:p-6">` and its matching closing `</div>` stays exactly as it is. Only the outer wrapper and the new `Receipt` line are new.)

- [ ] **Step 6: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
```

Expected: no type errors on either — this resolves the `handleCheckout`/`PaymentDialog` signature mismatch that Task 4 deliberately left in place.

- [ ] **Step 7: Run the full test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — every test from all earlier plans (55 total), unaffected by this renderer-only change.

- [ ] **Step 8: Switch to the Electron ABI and ensure store settings + a dev product exist**

```bash
cd desktop-node
npm run rebuild:electron
```

From `desktop-node/`, write a temporary `.ts` file (following the same `createDb` pattern `src/main/db/seed.ts` uses — don't commit it, delete it after use) that ensures a `store_settings` row exists (needed for the receipt header) and that at least one product with stock exists (reuse whatever `dev.sqlite` already has from earlier plans' manual verification if it's still there):

```typescript
// temporary, not committed
import path from 'node:path'
import { createDb } from './src/main/db/migrate'
import { storeSettings } from './src/main/db/schema'

const db = createDb(path.resolve('dev.sqlite'), path.resolve('drizzle'))
const existing = db.select().from(storeSettings).limit(1).all()

if (existing.length === 0) {
  const now = new Date()
  db.insert(storeSettings)
    .values({
      namaToko: 'Toko Sekawan',
      alamat: 'Jl. Contoh No. 1',
      telepon: '021-1234567',
      pesanFooter: 'Terima kasih telah berbelanja',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  console.log('Seeded store_settings')
} else {
  console.log('store_settings already has a row, skipping')
}
```

- [ ] **Step 9: Manual end-to-end verification**

```bash
npm run dev
```

Since this sandbox likely has no display, use the CDP-driven approach from earlier plans (Node's built-in `WebSocket`, `--remote-debugging-port`, `Runtime.evaluate`) to drive and verify, reporting exactly what you observed for each:

1. Log in, add a product to the cart, open the payment dialog. Confirm the primary button now reads "Simpan + Cetak" (not just "Simpan") and a secondary "Simpan" button with an "Alt+S" hint sits below it.
2. Fill in a sufficient `dibayar` amount, submit (Enter, or clicking "Simpan + Cetak"). Confirm the dialog switches to a "Mencetak struk..." spinner state (i.e. `printing` briefly becomes `true`) rather than closing immediately.
3. Confirm `window.api.kasir.printReceipt` actually gets invoked — the most reliable way to check this without a physical printer is to verify the dialog closes and the cart/sale-list resets shortly after (proving the print promise resolved and the `.finally()` ran), and that no error banner appears. If you have any way to intercept or log the IPC call itself (e.g. a temporary `console.log` in the main process, removed before committing), use it to confirm `webContents.print` was actually called with `{silent: true}`.
4. Click "Simpan" (the secondary button, not "Simpan + Cetak") on a second checkout — confirm it saves immediately without ever showing the printing spinner, and the new sale appears in "Transaksi Hari Ini" right away.
5. Inspect `dev.sqlite`'s `sales`/`sale_items` rows for both checkouts (read-only, via a temporary script or the same `better-sqlite3` pattern used elsewhere) — confirm both were recorded correctly (same as any other checkout — printing must not change what gets persisted).

Clean up any temporary scripts/console.log statements you added for verification before your final commit. After verification, switch back to the plain-Node ABI:

```bash
npm run rebuild:node
```

- [ ] **Step 10: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/pages/Kasir.tsx
git commit -m "Wire cetak struk into Kasir.tsx"
```

---

## Self-Review Notes

- **Spec coverage:** `checkout` IPC extended without touching the tested `checkout()` function ✅ (Task 2), `kasir:getStoreSettings` with sensible defaults ✅ (Task 1), `kasir:printReceipt` via `webContents.print({silent:true})` ✅ (Task 1), print CSS ported ✅ (Task 3), `Receipt` component ported (adapted for IPC-sourced `storeSettings` instead of Inertia props) ✅ (Task 3), `PaymentDialog`'s cetak action restored ✅ (Task 4), full wiring ✅ (Task 5). Dark-mode toggle UI, History page, bon payment UI, product management remain explicitly out of scope, per the design spec.
- **No placeholders:** every step has complete, runnable code or exact commands, including the one-off dev-seed script (marked not-committed, consistent with earlier plans).
- **Type consistency:** `ReceiptSale`/`ReceiptItem`/`StoreSettingsDto` (Task 3) match exactly what the widened `kasir:checkout`/`kasir:getStoreSettings` (Tasks 1-2) return, which match what `Kasir.tsx` (Task 5) receives and passes to `<Receipt />`. `PaymentDialogProps.onSubmit`'s new `(shouldPrint: boolean) => void` signature (Task 4) matches exactly how `Kasir.tsx` (Task 5) defines and passes `handleCheckout`. `printing` is passed and read consistently (`Kasir.tsx` computes `receiptSale !== null`, `PaymentDialog` consumes it for both the `disabled` computation and the spinner-vs-buttons branch).
