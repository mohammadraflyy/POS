# Settings Page (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Settings page in `desktop-node` — store info editing, purge-history, and a test-scanner tool — reachable from a new dropdown on the sidebar's user row.

**Architecture:** Same three-layer pattern as every prior slice — pure business-logic functions in `main/kasir.ts` (unit-tested), thin IPC handlers in `ipc/kasir.ts` doing Rupiah↔cents conversion, a renderer page assembled from ported shadcn primitives and a new confirm-dialog hook.

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, `@radix-ui/react-dropdown-menu` (new dependency), Vitest.

## Global Constraints

- `store_settings` is not seeded anywhere in `desktop-node` — `updateStoreSettings` must upsert (insert if no row exists, update otherwise), not assume a row is already there.
- Validation matches the web app's `StoreSettingUpdateRequest` exactly: `namaToko` required, max 255 chars; `alamat` nullable, max 255; `telepon` nullable, max 50; `pesanFooter` nullable, max 255.
- Purge cutoff is **local midnight** on the given date (`new Date(\`${beforeDate}T00:00:00\`)`), matching `listSalesHistory`'s existing `dari`/`sampai` filter convention in `ipc/kasir.ts` — not UTC. `purgeSalesBefore` itself rejects a future date (matching `PurgeSalesRequest`'s `before_or_equal:today`) — this validation lives in the business-logic function, not the IPC handler, matching the established pattern where `checkout`/`cancelSale`/`recordBonPayment` all own their own validation and are independently unit-testable for it.
- `purgeSalesBefore` deletes `sales` rows only — `sale_items`/`bon_payments` cascade automatically via the existing `onDelete: 'cascade'` foreign keys already in the schema (`src/main/db/schema.ts`). No manual cleanup needed.
- NavUser's "Keluar" button stays a direct, always-visible `Button` — only the user-info row (name/initials) becomes a dropdown trigger, with "Pengaturan" as its one menu item.
- All new UI components use named exports (this codebase's established convention — no default exports anywhere in `desktop-node/src/renderer/components/`).
- Settings page breadcrumb is `[{title: 'Pengaturan'}]` — a single crumb, no `href` (not nested under Penjualan).

---

### Task 1: `updateStoreSettings` and `purgeSalesBefore` business logic

**Files:**
- Modify: `desktop-node/src/main/kasir.ts`
- Test: `desktop-node/src/main/kasir.test.ts`

**Interfaces:**
- Consumes: `storeSettings`, `sales` from `./db/schema` (schema import needs `storeSettings` added — not currently imported in `kasir.ts`).
- Produces: `export function updateStoreSettings(db: BetterSQLite3Database<typeof schema>, input: {namaToko: string; alamat: string | null; telepon: string | null; pesanFooter: string | null}): void` and `export function purgeSalesBefore(db: BetterSQLite3Database<typeof schema>, beforeDate: Date): number` — Task 2's IPC handlers call these exact signatures.

- [ ] **Step 1: Write the failing tests**

Update the top-of-file import in `desktop-node/src/main/kasir.ts` — find:

```typescript
import { eq, inArray, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems, bonPayments } from './db/schema'
```

Replace with:

```typescript
import { eq, inArray, lt, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems, bonPayments, storeSettings } from './db/schema'
```

Update the top-of-file import in `desktop-node/src/main/kasir.test.ts` — find:

```typescript
import { users, products, productUnits, productPriceTiers, sales, saleItems, bonPayments } from './db/schema'
import { checkout, type CheckoutInput, cancelSale, recordBonPayment } from './kasir'
```

Replace with:

```typescript
import { users, products, productUnits, productPriceTiers, sales, saleItems, bonPayments, storeSettings } from './db/schema'
import { checkout, type CheckoutInput, cancelSale, recordBonPayment, updateStoreSettings, purgeSalesBefore } from './kasir'
```

Add this new `describe` block at the end of `desktop-node/src/main/kasir.test.ts` (after the existing `describe('recordBonPayment', ...)` block's closing `})`):

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

describe('purgeSalesBefore', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedThreeSales() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        satuan: 'PCS',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 100,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const oldSale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })
    db.update(sales).set({ createdAt: new Date('2020-01-01T10:00:00') }).where(eq(sales.id, oldSale.saleId)).run()

    const bonSale = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })
    db.update(sales).set({ createdAt: new Date('2020-01-02T10:00:00') }).where(eq(sales.id, bonSale.saleId)).run()

    const recentSale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    return { db, oldSaleId: oldSale.saleId, bonSaleId: bonSale.saleId, recentSaleId: recentSale.saleId }
  }

  it('deletes only sales created before the given date, returns the count deleted', () => {
    const { db, oldSaleId, bonSaleId, recentSaleId } = seedThreeSales()

    const deleted = purgeSalesBefore(db, new Date('2020-01-03T00:00:00'))

    expect(deleted).toBe(2)
    expect(db.select().from(sales).where(eq(sales.id, oldSaleId)).get()).toBeUndefined()
    expect(db.select().from(sales).where(eq(sales.id, bonSaleId)).get()).toBeUndefined()
    expect(db.select().from(sales).where(eq(sales.id, recentSaleId)).get()).toBeDefined()
  })

  it('cascades to sale_items and bon_payments', () => {
    const { db, bonSaleId } = seedThreeSales()
    const now = new Date()
    db.insert(bonPayments)
      .values({ saleId: bonSaleId, jumlah: 10000_00, tanggal: '2020-01-02', createdAt: now, updatedAt: now })
      .run()

    purgeSalesBefore(db, new Date('2020-01-03T00:00:00'))

    expect(db.select().from(saleItems).where(eq(saleItems.saleId, bonSaleId)).all()).toHaveLength(0)
    expect(db.select().from(bonPayments).where(eq(bonPayments.saleId, bonSaleId)).all()).toHaveLength(0)
  })

  it('returns 0 and deletes nothing when no sales are before the cutoff', () => {
    const { db, oldSaleId, bonSaleId, recentSaleId } = seedThreeSales()

    const deleted = purgeSalesBefore(db, new Date('2019-01-01T00:00:00'))

    expect(deleted).toBe(0)
    expect(db.select().from(sales).where(eq(sales.id, oldSaleId)).get()).toBeDefined()
    expect(db.select().from(sales).where(eq(sales.id, bonSaleId)).get()).toBeDefined()
    expect(db.select().from(sales).where(eq(sales.id, recentSaleId)).get()).toBeDefined()
  })

  it('throws when the cutoff date is in the future', () => {
    const { db } = seedThreeSales()
    expect(() => purgeSalesBefore(db, new Date('2099-01-01T00:00:00'))).toThrow('Tanggal tidak boleh di masa depan.')
  })

  it('allows a cutoff of exactly today (does not throw)', () => {
    const { db } = seedThreeSales()
    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)
    expect(() => purgeSalesBefore(db, todayMidnight)).not.toThrow()
  })

  it('does not delete anything when a future date is rejected', () => {
    const { db, oldSaleId } = seedThreeSales()

    expect(() => purgeSalesBefore(db, new Date('2099-01-01T00:00:00'))).toThrow()

    expect(db.select().from(sales).where(eq(sales.id, oldSaleId)).get()).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run kasir.test.ts`
Expected: FAIL — `updateStoreSettings is not a function` / `purgeSalesBefore is not a function` (or a TypeScript compile error naming the missing exports).

- [ ] **Step 3: Implement `updateStoreSettings` and `purgeSalesBefore`**

Add these two functions to `desktop-node/src/main/kasir.ts`, after `recordBonPayment` (end of file):

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
  }
}

export function purgeSalesBefore(db: BetterSQLite3Database<typeof schema>, beforeDate: Date): number {
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  if (beforeDate > endOfToday) {
    throw new Error('Tanggal tidak boleh di masa depan.')
  }

  const result = db.delete(sales).where(lt(sales.createdAt, beforeDate)).run()
  return result.changes
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run kasir.test.ts`
Expected: PASS — all tests in `kasir.test.ts` green, including the 9 new `updateStoreSettings` tests and 6 new `purgeSalesBefore` tests.

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd desktop-node
git add src/main/kasir.ts src/main/kasir.test.ts
git commit -m "Add updateStoreSettings and purgeSalesBefore business logic"
```

---

### Task 2: IPC handlers, preload, and renderer types

**Files:**
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `updateStoreSettings(db, input)` and `purgeSalesBefore(db, beforeDate)` from Task 1; existing `getCurrentUser` from `./auth`.
- Produces: IPC channels `kasir:updateStoreSettings` (returns `void`) and `kasir:purgeSalesBefore` (returns `{deleted: number}`); `window.api.kasir.updateStoreSettings(input)` and `window.api.kasir.purgeSalesBefore(before)` (`before` is a `YYYY-MM-DD` string) — Task 5's page calls these exact names.

- [ ] **Step 1: Add the import**

In `desktop-node/src/main/ipc/kasir.ts`, find:

```typescript
import { checkout, cancelSale, recordBonPayment, type CheckoutInput } from '../kasir'
```

Replace with:

```typescript
import { checkout, cancelSale, recordBonPayment, updateStoreSettings, purgeSalesBefore, type CheckoutInput } from '../kasir'
```

- [ ] **Step 2: Add the two IPC handlers**

Add these two handlers inside `registerKasirIpc`, after the existing `kasir:recordBonPayment` handler (before the function's closing `}`):

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

  ipcMain.handle('kasir:purgeSalesBefore', (_event, before: string) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const deleted = purgeSalesBefore(db, new Date(`${before}T00:00:00`))
    return { deleted }
  })
```

- [ ] **Step 3: Expose the new channels in preload**

In `desktop-node/src/preload/index.ts`, add these two entries to the `kasir` object, after `recordBonPayment`:

```typescript
    updateStoreSettings: (input: {
      namaToko: string
      alamat: string | null
      telepon: string | null
      pesanFooter: string | null
    }) => invoke('kasir:updateStoreSettings', input),
    purgeSalesBefore: (before: string) => invoke('kasir:purgeSalesBefore', before),
```

- [ ] **Step 4: Add matching renderer types**

In `desktop-node/src/renderer/env.d.ts`, add these two entries to the `kasir` interface, after `recordBonPayment`:

```typescript
        updateStoreSettings: (input: {
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
        }) => Promise<void>
        purgeSalesBefore: (before: string) => Promise<{ deleted: number }>
```

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions (this task adds no new automated tests; the business logic is already covered by Task 1).

- [ ] **Step 7: Commit**

```bash
cd desktop-node
git add src/main/ipc/kasir.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "Add kasir:updateStoreSettings and kasir:purgeSalesBefore IPC handlers"
```

---

### Task 3: Install dropdown-menu dependency, port dropdown-menu, heading, use-confirm

**Files:**
- Modify: `desktop-node/package.json` (new dependency)
- Create: `desktop-node/src/renderer/components/ui/dropdown-menu.tsx`
- Create: `desktop-node/src/renderer/components/heading.tsx`
- Create: `desktop-node/src/renderer/hooks/use-confirm.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`; `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription` from `@/components/ui/dialog` (all already exist); `Button` from `@/components/ui/button` (exists).
- Produces: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, and the rest of the family (named exports, `components/ui/dropdown-menu.tsx`) — Task 4 imports `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem`. `Heading({title, description?, variant?})` (named export, `components/heading.tsx`) — Task 5 imports this. `useConfirm()` returning `{confirm: (opts) => Promise<boolean>, ConfirmDialog: ReactNode}` (named export, `hooks/use-confirm.tsx`) — Task 5 imports this.

- [ ] **Step 1: Install the new dependency**

Run: `cd desktop-node && npm install @radix-ui/react-dropdown-menu@^2.1.24`

- [ ] **Step 2: Port `dropdown-menu.tsx`**

Create `desktop-node/src/renderer/components/ui/dropdown-menu.tsx` — verbatim port of `resources/js/components/ui/dropdown-menu.tsx`, only the import path changes to match desktop-node's alias:

```typescript
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-md',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive-foreground data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/40 data-[variant=destructive]:focus:text-destructive-foreground data-[variant=destructive]:*:[svg]:!text-destructive-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({ className, inset, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('px-2 py-1.5 text-sm font-medium data-[inset]:pl-8', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn('bg-border -mx-1 my-1 h-px', className)} {...props} />
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="dropdown-menu-shortcut" className={cn('text-muted-foreground ml-auto text-xs tracking-widest', className)} {...props} />
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        'focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-lg',
        className,
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
```

- [ ] **Step 3: Port `heading.tsx`**

Create `desktop-node/src/renderer/components/heading.tsx` — adapted to a named export (this codebase's convention, the web source uses `export default`):

```typescript
export function Heading({
  title,
  description,
  variant = 'default',
}: {
  title: string
  description?: string
  variant?: 'default' | 'small'
}) {
  return (
    <header className={variant === 'small' ? '' : 'mb-8 space-y-0.5'}>
      <h2 className={variant === 'small' ? 'mb-0.5 text-base font-medium' : 'text-xl font-semibold tracking-tight'}>{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </header>
  )
}
```

- [ ] **Step 4: Port `use-confirm.tsx`**

Create `desktop-node/src/renderer/hooks/use-confirm.tsx` — verbatim port of `resources/js/hooks/use-confirm.tsx`:

```typescript
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ConfirmOptions = {
  title?: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

/**
 * In-app replacement for window.confirm(): await confirm(...) resolves to
 * true/false instead of blocking the page. Render the returned dialog once.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<(value: boolean) => void>(null)

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    setOptions(typeof opts === 'string' ? { description: opts } : opts)

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  function settle(result: boolean) {
    setOptions(null)
    resolveRef.current?.(result)
  }

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{options?.title ?? 'Konfirmasi'}</DialogTitle>
          <DialogDescription>{options?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            {options?.cancelLabel ?? 'Batal'}
          </Button>
          <Button autoFocus variant={options?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
            {options?.confirmLabel ?? 'Ya'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, ConfirmDialog: dialog }
}
```

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors (these files aren't imported anywhere yet, so this only checks they compile standalone).

- [ ] **Step 6: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as before this task.

- [ ] **Step 7: Commit**

```bash
cd desktop-node
git add package.json package-lock.json src/renderer/components/ui/dropdown-menu.tsx src/renderer/components/heading.tsx src/renderer/hooks/use-confirm.tsx
git commit -m "Add dropdown-menu, Heading, useConfirm"
```

---

### Task 4: Wire the "Pengaturan" dropdown into NavUser

**Files:**
- Modify: `desktop-node/src/renderer/components/nav-user.tsx`

**Interfaces:**
- Consumes: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` from Task 3.
- Produces: nothing new consumed by later tasks — Task 5's route (`/settings`) is what this dropdown navigates to.

- [ ] **Step 1: Add the dropdown**

Replace the entire contents of `desktop-node/src/renderer/components/nav-user.tsx` with:

```typescript
import { Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import type { AuthUser } from '../types'

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function NavUser({ user }: { user: AuthUser }) {
  const navigate = useNavigate()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="bg-sidebar-accent flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                {initials(user.name)}
              </div>
              <span className="truncate">{user.name}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="size-4" />
              Pengaturan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={async () => {
            await window.api.auth.logout()
            navigate('/login')
          }}
        >
          Keluar
        </Button>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors (`/settings` route doesn't exist yet — that's fine, `navigate('/settings')` is just a string, TypeScript doesn't validate route existence).

- [ ] **Step 3: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS, same count as before this task.

- [ ] **Step 4: Commit**

```bash
cd desktop-node
git add src/renderer/components/nav-user.tsx
git commit -m "Add Pengaturan dropdown to NavUser"
```

---

### Task 5: Settings page, routing, and verification

**Files:**
- Create: `desktop-node/src/renderer/pages/Settings.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`

**Interfaces:**
- Consumes: `window.api.kasir.getStoreSettings`/`updateStoreSettings`/`purgeSalesBefore` (Tasks 1-2); `Heading` (Task 3); `useConfirm` (Task 3); `AppShell` (existing, from the Login+Sidebar plan).

- [ ] **Step 1: Create `Settings.tsx`**

Create `desktop-node/src/renderer/pages/Settings.tsx`:

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

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Pengaturan' }]

function TestScan() {
  const [lastScan, setLastScan] = useState<{ code: string; at: string } | null>(null)
  const scanBuffer = useRef('')
  const scanLastKeyAt = useRef(0)

  useEffect(() => {
    function isEditableFocused() {
      const el = document.activeElement
      return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }

    function handleKeydown(e: KeyboardEvent) {
      if (isEditableFocused()) {
        return
      }

      const now = Date.now()

      if (now - scanLastKeyAt.current > 100) {
        scanBuffer.current = ''
      }

      scanLastKeyAt.current = now

      if (e.key === 'Enter') {
        const code = scanBuffer.current
        scanBuffer.current = ''

        if (code.length < 4) {
          return
        }

        e.preventDefault()
        setLastScan({ code, at: new Date().toLocaleTimeString('id-ID') })

        return
      }

      if (e.key.length === 1) {
        scanBuffer.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Test Scanner</p>
        <p className="text-sm text-muted-foreground">Klik di halaman ini lalu scan barcode apapun - kode yang terbaca akan muncul di sini.</p>
        {lastScan && (
          <p className="text-sm">
            Terakhir dibaca: <code className="rounded bg-muted px-1.5 py-0.5">{lastScan.code}</code>{' '}
            <span className="text-muted-foreground">({lastScan.at})</span>
          </p>
        )}
      </div>
      <ScanLine className="size-5 shrink-0 text-muted-foreground" />
    </div>
  )
}

function PurgeHistory() {
  const [before, setBefore] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  async function purge() {
    if (!before) {
      return
    }

    const ok = await confirm({
      title: 'Hapus Riwayat Transaksi',
      description: `Semua transaksi sebelum ${new Date(before).toLocaleDateString('id-ID')} akan dihapus permanen, termasuk transaksi Bon yang belum lunas - piutang yang tercatat akan ikut hilang. Tindakan ini tidak bisa dibatalkan.`,
      confirmLabel: 'Hapus Permanen',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setProcessing(true)
    setError(null)
    setMessage(null)

    try {
      const result = await window.api.kasir.purgeSalesBefore(before)
      setMessage(`${result.deleted} transaksi dihapus.`)
      setBefore('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus riwayat')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/50 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Hapus Riwayat Transaksi</p>
        <p className="text-sm text-muted-foreground">
          Hapus permanen semua transaksi sebelum tanggal tertentu, termasuk transaksi Bon yang belum lunas. Tidak bisa dibatalkan - pastikan sudah
          tidak dibutuhkan lagi.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <div className="flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="purge_before" className="text-xs">
            Sebelum tanggal
          </Label>
          <Input
            id="purge_before"
            type="date"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            disabled={processing}
            className="w-48"
          />
        </div>
        <Button type="button" variant="destructive" disabled={!before || processing} onClick={purge}>
          Hapus Riwayat
        </Button>
      </div>
      {ConfirmDialog}
    </div>
  )
}

export function Settings() {
  const [namaToko, setNamaToko] = useState('')
  const [alamat, setAlamat] = useState('')
  const [telepon, setTelepon] = useState('')
  const [pesanFooter, setPesanFooter] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.kasir.getStoreSettings().then((settings) => {
      setNamaToko(settings.namaToko)
      setAlamat(settings.alamat ?? '')
      setTelepon(settings.telepon ?? '')
      setPesanFooter(settings.pesanFooter ?? '')
    })
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

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-8 p-4">
        <h1 className="text-xl font-semibold">Pengaturan</h1>

        <div className="space-y-6">
          <Heading variant="small" title="Toko" description="Nama, alamat, dan pesan yang tampil di struk serta sidebar aplikasi" />

          <form onSubmit={submit} className="max-w-lg space-y-4">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {message && <p className="text-sm text-muted-foreground">{message}</p>}

            <div className="grid gap-2">
              <Label htmlFor="nama_toko">Nama Toko</Label>
              <Input id="nama_toko" value={namaToko} onChange={(e) => setNamaToko(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="alamat">Alamat</Label>
              <Input id="alamat" value={alamat} onChange={(e) => setAlamat(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="telepon">Telepon</Label>
              <Input id="telepon" value={telepon} onChange={(e) => setTelepon(e.target.value)} />
            </div>
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

        <div className="space-y-6">
          <Heading variant="small" title="Zona Berbahaya" description="Tindakan permanen yang tidak bisa dibatalkan" />
          <PurgeHistory />
        </div>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 2: Add the route**

In `desktop-node/src/renderer/App.tsx`, add the import and route:

```typescript
import { Settings } from './pages/Settings'
```

```typescript
        <Route path="/settings" element={<Settings />} />
```

(Add the import alongside the existing `BonPayment` import, and the route alongside the existing `/bon-payment/:saleId` route.)

- [ ] **Step 3: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — all tests green (no new automated tests in this task; the page is verified manually in Step 6).

- [ ] **Step 5: Rebuild better-sqlite3 for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

(Run in background. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 6: Manual end-to-end verification via CDP**

Using the established CDP pattern (query `http://127.0.0.1:9222/json` for the page target's `webSocketDebuggerUrl`, then `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`; consider also capturing a `Page.captureScreenshot` at least once, since a prior slice's review found that text-only checks miss visual/styling issues):

1. Log in, confirm the sidebar's user row is now clickable (a dropdown, not the previous plain non-interactive button) and shows "Pengaturan" on click.
2. Click "Pengaturan" → confirm navigation to `/settings`, breadcrumb reads "Pengaturan" (single crumb), sidebar is present and functional.
3. Confirm the store info form is pre-filled with the current `getStoreSettings` values (whatever is currently seeded/default).
4. Change a field (e.g. Alamat) and submit → confirm the success message appears, then reload the page (or navigate away and back) and confirm the new value persisted.
5. Submit with Nama Toko cleared → confirm the `Nama toko wajib diisi.` error appears via the `role="alert"` paragraph, and the form does not silently "succeed."
6. Click into the page body (not a text field) and simulate typing a barcode-like burst followed by Enter (e.g. dispatch `keydown` events for "1234567890123" then `Enter`) → confirm "Terakhir dibaca" shows the code and a timestamp.
7. Enter a future date in "Sebelum tanggal" and click "Hapus Riwayat" → confirm the confirm dialog appears; confirm the action → confirm an error surfaces (`Tanggal tidak boleh di masa depan.`) rather than silently deleting nothing.
8. Enter a past date that covers at least one existing seeded sale, click "Hapus Riwayat" → confirm the destructive confirm dialog appears with the correct wording; cancel it → confirm nothing is deleted (check History still shows the sale). Then repeat and confirm → confirm the success message reports the correct count, and the deleted sale(s) no longer appear in History.
9. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 7: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 8: Commit**

```bash
cd desktop-node
git add src/renderer/pages/Settings.tsx src/renderer/App.tsx
git commit -m "Add Settings page: store info, test scanner, purge history"
```

---

## Plan Self-Review

**Spec coverage:** §1 (routing + NavUser dropdown) → Task 4 + Task 5 Step 2. §2 (store info form + validation + upsert) → Task 1 (`updateStoreSettings`) + Task 2 (IPC) + Task 5 (form). §3 (test scanner) → Task 5 (`TestScan` component). §4 (purge history + local-midnight cutoff + future-date rejection + cascade) → Task 1 (`purgeSalesBefore`) + Task 2 (IPC, future-date check) + Task 5 (`PurgeHistory` component + `useConfirm`). §5 (component ports) → Task 3. Out-of-scope items (ESC/POS, other web settings pages, retrofitting existing `window.confirm()` calls) — untouched by every task.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code.

**Type consistency:** `updateStoreSettings(db, input)` and `purgeSalesBefore(db, beforeDate)` signatures are identical across Task 1 (definition), Task 2 (IPC handler call sites). `kasir:updateStoreSettings`'s input shape (`namaToko`/`alamat`/`telepon`/`pesanFooter`) matches across the IPC handler, preload, `env.d.ts`, and Task 5's `Settings.tsx` submit call. `purgeSalesBefore`'s IPC return shape (`{deleted: number}`) matches between the handler, preload, `env.d.ts`, and `PurgeHistory`'s `result.deleted` usage.
