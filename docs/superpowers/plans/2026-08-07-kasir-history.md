# Fase 2 Slice 3 — History Transaksi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the web app's transaction history page (`kasir-history.tsx`) into `desktop-node/` — filterable, paginated list of all sales, reprint any past receipt, cancel a sale (only when nothing has been paid against it).

**Architecture:** The receipt-assembly logic currently inlined in `kasir:checkout`'s handler gets extracted into a reusable `getReceipt(db, saleId, kasirName)` function, so History's reprint button can fetch a receipt payload for any sale, not just a freshly-created one — exactly the extraction Plan C's final review recommended for "when the second caller appears." A new `kasir:listSalesHistory` IPC handles filtering/pagination server-side (SQLite `LIMIT`/`OFFSET`), returning a page-number-based shape instead of re-deriving Laravel's HTML pagination labels.

**Tech Stack:** `@radix-ui/react-select` (new dependency, for the filter form's Status/Metode dropdowns), `react-data-grid` (already installed).

## Global Constraints

- New/modified code lives entirely under `desktop-node/`. Do not touch `app/`, `routes/`, `resources/`, `nativephp/`, or any other Laravel file.
- Money in the renderer is always Rupiah (unchanged contract).
- The "Bayar Bon" button/link from the web source is **not ported** in this plan — its target page doesn't exist yet (a separate future slice). The Status column still shows "Sisa RpX" for an unpaid bon; there's just no action button for it yet.
- Cancel's visibility rule in this page is `dibayar === 0` (only cancel a sale nothing has been paid against yet) — **different** from the "Transaksi Hari Ini" section on the Kasir page (built in Slice 1, not part of the web app), which only checks `status === 'selesai'`. Do not change the Kasir page's existing rule; this plan only adds History's own, stricter rule.
- IPC read-layer handlers in this codebase are not unit-tested (established pattern since Slice 1/2 — the tested business logic lives in `main/kasir.ts`'s `checkout`/`cancelSale`, which this plan doesn't touch). This plan adds no new `.test.ts` files; verification is `tsc --noEmit` plus manual/CDP checks, consistent with every `ipc/kasir.ts` handler added in earlier plans.

---

## Task 1: Extract `getReceipt`, add `kasir:getReceiptForSale`

**Files:**
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `sales`, `saleItems`, `products`, `users` (schema — `users` is new to this file's imports).
- Produces: `getReceipt(db, saleId, kasirName): ReceiptPayload` (module-private helper in `ipc/kasir.ts`, not exported — only used within this file); IPC channel `kasir:getReceiptForSale`; `window.api.kasir.getReceiptForSale(saleId): Promise<ReceiptPayload>` — consumed by Task 4 (`KasirHistory.tsx`).

- [ ] **Step 1: Add the `users` import**

`desktop-node/src/main/ipc/kasir.ts`'s schema import currently reads:

```typescript
import { products, productUnits, productPriceTiers, sales, saleItems, storeSettings } from '../db/schema'
```

Add `users`:

```typescript
import { products, productUnits, productPriceTiers, sales, saleItems, storeSettings, users } from '../db/schema'
```

- [ ] **Step 2: Extract `getReceipt` as a module-level function**

`desktop-node/src/main/ipc/kasir.ts`'s `kasir:checkout` handler currently ends with (after `const result = checkout(db, checkoutInput)`):

```typescript
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
  })
```

Replace that block with a call to a new, extracted `getReceipt` function:

```typescript
    return getReceipt(db, result.saleId, user.name)
  })
```

Add the `getReceipt` function itself as a module-level function in this file (place it above `registerKasirIpc`, near the `toRupiah`/`toCents` helpers — it needs `db` passed in since it's called both from inside `registerKasirIpc`'s closure and, in Task 2's handler, with the same `db`):

```typescript
function getReceipt(db: BetterSQLite3Database<typeof schema>, saleId: number, kasirName: string | null) {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  const itemRows = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()
  const productIds = itemRows.map((item) => item.productId)
  const productRows = productIds.length > 0 ? db.select().from(products).where(inArray(products.id, productIds)).all() : []
  const productNameById = new Map(productRows.map((product) => [product.id, product.namaItem]))

  return {
    saleId: sale.id,
    total: toRupiah(sale.total),
    dibayar: toRupiah(sale.dibayar),
    metodePembayaran: sale.metodePembayaran,
    namaPelanggan: sale.namaPelanggan,
    createdAt: sale.createdAt.toISOString(),
    kasirName,
    items: itemRows.map((item) => ({
      namaItem: productNameById.get(item.productId) ?? '',
      qty: item.qty,
      satuan: item.satuan,
      hargaJual: toRupiah(item.hargaJual),
      subtotal: toRupiah(item.subtotal),
    })),
  }
}
```

- [ ] **Step 3: Add the `kasir:getReceiptForSale` handler**

Add this new handler inside `registerKasirIpc`, after the existing `kasir:printReceipt` handler (the last one in the function):

```typescript
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

- [ ] **Step 4: Expose it in preload**

`desktop-node/src/preload/index.ts`'s `api.kasir` object currently ends with `printReceipt: () => invoke('kasir:printReceipt'),`. Add one more entry after it:

```typescript
    getReceiptForSale: (saleId: number) => invoke('kasir:getReceiptForSale', saleId),
```

- [ ] **Step 5: Add the type to `env.d.ts`**

`desktop-node/src/renderer/env.d.ts`'s `kasir` interface currently ends with `printReceipt: () => Promise<void>`. Add a `ReceiptPayload`-shaped return type right after it — this exact shape matches what `getReceipt` (Step 2) and the existing `checkout` return already produce:

```typescript
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

- [ ] **Step 6: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
```

Expected: no type errors on either.

- [ ] **Step 7: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — all 55 existing tests, confirming the `checkout` handler's behavior is unchanged by the extraction (nothing in `main/kasir.test.ts` touches `ipc/kasir.ts`, but this confirms no accidental breakage elsewhere).

- [ ] **Step 8: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/main/ipc/kasir.ts desktop-node/src/preload/index.ts desktop-node/src/renderer/env.d.ts
git commit -m "Extract getReceipt and add kasir:getReceiptForSale for History reprints"
```

---

## Task 2: `kasir:listSalesHistory`

**Files:**
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `sales`, `saleItems`, `products` (schema, already imported).
- Produces: IPC channel `kasir:listSalesHistory`; `window.api.kasir.listSalesHistory(filters): Promise<SalesHistoryPage>` — consumed by Task 4 (`KasirHistory.tsx`).

- [ ] **Step 1: Add the needed drizzle-orm imports**

`desktop-node/src/main/ipc/kasir.ts`'s drizzle-orm import currently reads:

```typescript
import { eq, gte, inArray } from 'drizzle-orm'
```

Replace it with (adds `and`, `lte`, `like`, `desc`, `sql`):

```typescript
import { and, desc, eq, gte, inArray, like, lte, sql } from 'drizzle-orm'
```

- [ ] **Step 2: Add the `kasir:listSalesHistory` handler**

Add this new handler inside `registerKasirIpc`, after `kasir:getReceiptForSale` (from Task 1):

```typescript
  ipcMain.handle(
    'kasir:listSalesHistory',
    (
      _event,
      input: {
        dari?: string
        sampai?: string
        status?: 'selesai' | 'dibatalkan'
        metodePembayaran?: 'tunai' | 'bon'
        search?: string
        page: number
      },
    ) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      const pageSize = 20
      const page = Math.max(1, input.page)

      const conditions = []

      if (input.dari) {
        conditions.push(gte(sales.createdAt, new Date(`${input.dari}T00:00:00`)))
      }

      if (input.sampai) {
        conditions.push(lte(sales.createdAt, new Date(`${input.sampai}T23:59:59`)))
      }

      if (input.status) {
        conditions.push(eq(sales.status, input.status))
      }

      if (input.metodePembayaran) {
        conditions.push(eq(sales.metodePembayaran, input.metodePembayaran))
      }

      if (input.search) {
        const q = `%${input.search}%`
        const byCustomer = db.select({ id: sales.id }).from(sales).where(like(sales.namaPelanggan, q)).all()
        const byProduct = db
          .select({ id: saleItems.saleId })
          .from(saleItems)
          .innerJoin(products, eq(saleItems.productId, products.id))
          .where(like(products.namaItem, q))
          .all()
        const matchingIds = Array.from(new Set([...byCustomer.map((row) => row.id), ...byProduct.map((row) => row.id)]))
        conditions.push(matchingIds.length > 0 ? inArray(sales.id, matchingIds) : sql`0`)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const totalRow = db.select({ count: sql<number>`count(*)` }).from(sales).where(whereClause).get()
      const total = totalRow?.count ?? 0
      const lastPage = Math.max(1, Math.ceil(total / pageSize))

      const saleRows = db
        .select()
        .from(sales)
        .where(whereClause)
        .orderBy(desc(sales.createdAt), desc(sales.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all()

      const saleIds = saleRows.map((sale) => sale.id)
      const itemRows = saleIds.length > 0 ? db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds)).all() : []
      const productIds = itemRows.map((item) => item.productId)
      const productRows = productIds.length > 0 ? db.select().from(products).where(inArray(products.id, productIds)).all() : []
      const productNameById = new Map(productRows.map((product) => [product.id, product.namaItem]))

      return {
        data: saleRows.map((sale) => ({
          id: sale.id,
          createdAt: sale.createdAt.toISOString(),
          namaPelanggan: sale.namaPelanggan,
          metodePembayaran: sale.metodePembayaran,
          status: sale.status,
          total: toRupiah(sale.total),
          dibayar: toRupiah(sale.dibayar),
          items: itemRows
            .filter((item) => item.saleId === sale.id)
            .map((item) => ({ namaItem: productNameById.get(item.productId) ?? '', qty: item.qty })),
        })),
        currentPage: page,
        lastPage,
        total,
      }
    },
  )
```

- [ ] **Step 3: Expose it in preload**

`desktop-node/src/preload/index.ts`'s `api.kasir` object currently ends with `getReceiptForSale: (saleId: number) => invoke('kasir:getReceiptForSale', saleId),` (from Task 1). Add one more entry after it:

```typescript
    listSalesHistory: (filters: {
      dari?: string
      sampai?: string
      status?: 'selesai' | 'dibatalkan'
      metodePembayaran?: 'tunai' | 'bon'
      search?: string
      page: number
    }) => invoke('kasir:listSalesHistory', filters),
```

- [ ] **Step 4: Add the type to `env.d.ts`**

`desktop-node/src/renderer/env.d.ts`'s `kasir` interface currently ends with the `getReceiptForSale` entry (from Task 1). Add one more entry after it:

```typescript
        listSalesHistory: (filters: {
          dari?: string
          sampai?: string
          status?: 'selesai' | 'dibatalkan'
          metodePembayaran?: 'tunai' | 'bon'
          search?: string
          page: number
        }) => Promise<{
          data: {
            id: number
            createdAt: string
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
            items: { namaItem: string; qty: number }[]
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
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

Expected: PASS — all 55 existing tests.

- [ ] **Step 7: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/main/ipc/kasir.ts desktop-node/src/preload/index.ts desktop-node/src/renderer/env.d.ts
git commit -m "Add kasir:listSalesHistory IPC with filters and pagination"
```

---

## Task 3: `useAvailableHeight` hook and `Select` component

**Files:**
- Create: `desktop-node/src/renderer/hooks/use-available-height.ts`
- Create: `desktop-node/src/renderer/components/ui/select.tsx`

**Interfaces:**
- Consumes: `cn` (`lib/utils`, from an earlier plan).
- Produces: `useAvailableHeight<T>(bottomReserve?: number): [ref, height]`; `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue` (and the less-used `SelectGroup`/`SelectLabel`/`SelectSeparator`/`SelectScrollUpButton`/`SelectScrollDownButton`, exported for completeness matching the source file, even though this plan's Task 4 only uses the first five) — consumed by Task 4 (`KasirHistory.tsx`).

- [ ] **Step 1: Add the dependency**

```bash
cd desktop-node
npm install @radix-ui/react-select
```

- [ ] **Step 2: Port `useAvailableHeight`**

Create `desktop-node/src/renderer/hooks/use-available-height.ts` — verbatim port of `resources/js/hooks/use-available-height.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react'

/** Tracks how much viewport height remains below an element, for grids that should fill the screen without growing the whole page. */
export function useAvailableHeight<T extends HTMLElement>(bottomReserve = 0) {
  const [el, setEl] = useState<T | null>(null)
  const [height, setHeight] = useState(0)
  const ref = useCallback((node: T | null) => setEl(node), [])

  useEffect(() => {
    if (!el) {
      return
    }

    const node = el

    function measure() {
      const top = node.getBoundingClientRect().top
      setHeight(Math.max(200, window.innerHeight - top - bottomReserve))
    }

    measure()
    window.addEventListener('resize', measure)

    return () => window.removeEventListener('resize', measure)
  }, [el, bottomReserve])

  return [ref, height] as const
}
```

- [ ] **Step 3: Port `Select`**

Create `desktop-node/src/renderer/components/ui/select.tsx` — verbatim port of `resources/js/components/ui/select.tsx`:

```typescript
import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        side={side}
        sideOffset={sideOffset}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label data-slot="select-label" className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)} {...props} />
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span data-slot="select-item-indicator" className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={cn('bg-border pointer-events-none -mx-1 my-1 h-px', className)} {...props} />
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 5: Run the test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — no new test files, presentational/hook additions only.

- [ ] **Step 6: Commit**

```bash
cd C:\Work\POS
git add desktop-node/package.json desktop-node/package-lock.json desktop-node/src/renderer/hooks/use-available-height.ts desktop-node/src/renderer/components/ui/select.tsx
git commit -m "Add useAvailableHeight hook and Select shadcn/ui component"
```

---

## Task 4: `KasirHistory.tsx`, routing, manual verification

**Files:**
- Create: `desktop-node/src/renderer/pages/KasirHistory.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx`

**Interfaces:**
- Consumes: `window.api.kasir.listSalesHistory`/`getReceiptForSale`/`printReceipt`/`cancelSale` (Tasks 1-2, and Slice 2), `Receipt`/`ReceiptSale`/`StoreSettingsDto` (Slice 2, `pages/kasir/Receipt.tsx`), `useAvailableHeight` (Task 3), `useElementWidth` (Slice 2), `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue` (Task 3), `Button`/`Input`/`Label`/`Badge` (Plan A), `useAppearance` (Plan A/B), `AuthUser` (Fase 1).
- Produces: a working `/history` page reachable from the Kasir page.

- [ ] **Step 1: Write `KasirHistory.tsx`**

Create `desktop-node/src/renderer/pages/KasirHistory.tsx`. This is a port of `resources/js/pages/kasir-history.tsx`, adapted to: desktop-node's already-Rupiah-numeric data shapes, `window.api.kasir.*` IPC instead of Inertia's `router.get`, `useState`-driven pagination (`currentPage`/`lastPage`/`total` from the IPC response) instead of re-rendering Laravel's `links` HTML labels, and the reprint flow going through `getReceiptForSale` + the same `printReceipt`/`Receipt` machinery Slice 2 already built (no separate `window.print()` fallback — this app is Electron-only, matching every earlier plan's constraint). The "Bayar Bon" button is omitted per this plan's Global Constraints.

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { DataGrid } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatRupiah } from '@/lib/utils'
import type { AuthUser } from '../types'
import { Receipt, type ReceiptSale, type StoreSettingsDto } from './kasir/Receipt'

interface SaleHistoryItem {
  namaItem: string
  qty: number
}

interface SaleHistoryRow {
  id: number
  createdAt: string
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  items: SaleHistoryItem[]
}

const OTHER_COLUMNS_WIDTH = 60 + 180 + 120 + 140 + 120 + 140
const MIN_ITEM_WIDTH = 200

export function KasirHistory() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(56)

  const [search, setSearch] = useState('')
  const [dari, setDari] = useState('')
  const [sampai, setSampai] = useState('')
  const [status, setStatus] = useState('')
  const [metode, setMetode] = useState('')

  const [rows, setRows] = useState<SaleHistoryRow[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const [receiptSale, setReceiptSale] = useState<ReceiptSale | null>(null)
  const [storeSettings, setStoreSettings] = useState<StoreSettingsDto | null>(null)

  useEffect(() => {
    window.api.auth
      .me()
      .then((result) => {
        if (!result) {
          navigate('/login')
          return
        }
        setUser(result)
      })
      .catch(() => navigate('/login'))
  }, [navigate])

  useEffect(() => {
    if (!user) {
      return
    }
    window.api.kasir
      .getStoreSettings()
      .then(setStoreSettings)
      .catch(() => setStoreSettings({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function loadPage(page: number) {
    window.api.kasir
      .listSalesHistory({
        search: search || undefined,
        dari: dari || undefined,
        sampai: sampai || undefined,
        status: (status || undefined) as 'selesai' | 'dibatalkan' | undefined,
        metodePembayaran: (metode || undefined) as 'tunai' | 'bon' | undefined,
        page,
      })
      .then((result) => {
        setRows(result.data)
        setCurrentPage(result.currentPage)
        setLastPage(result.lastPage)
      })
      .catch(() => setError('Gagal memuat riwayat transaksi.'))
  }

  useEffect(() => {
    if (!user) {
      return
    }
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function submitFilters(e: FormEvent) {
    e.preventDefault()
    loadPage(1)
  }

  async function cancelSale(sale: SaleHistoryRow) {
    if (!confirm('Batalkan transaksi ini? Stok akan dikembalikan.')) {
      return
    }

    setError(null)

    try {
      await window.api.kasir.cancelSale(sale.id)
      loadPage(currentPage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan')
    }
  }

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

  const itemWidth = Math.max(MIN_ITEM_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  const columns: Column<SaleHistoryRow>[] = [
    {
      key: 'id',
      name: '#',
      width: 60,
      renderCell: ({ row }) => row.id,
    },
    {
      key: 'createdAt',
      name: 'Tanggal',
      width: 180,
      renderCell: ({ row }) => new Date(row.createdAt).toLocaleString('id-ID'),
    },
    {
      key: 'items',
      name: 'Item',
      width: itemWidth,
      renderCell: ({ row }) => row.items.map((i) => `${i.namaItem} x${i.qty}`).join(', '),
    },
    {
      key: 'metodePembayaran',
      name: 'Metode',
      width: 120,
      renderCell: ({ row }) => (row.metodePembayaran === 'bon' ? `Bon (${row.namaPelanggan})` : 'Tunai'),
    },
    {
      key: 'status',
      name: 'Status',
      width: 140,
      renderCell: ({ row }) => {
        const sisaPiutang = row.total - row.dibayar

        if (row.status === 'dibatalkan') {
          return <span className="text-destructive">Dibatalkan</span>
        }

        if (row.metodePembayaran === 'bon' && sisaPiutang > 0) {
          return <span className="text-amber-600 dark:text-amber-400">Sisa {formatRupiah(sisaPiutang)}</span>
        }

        return <span className="text-green-600 dark:text-green-400">Lunas</span>
      },
    },
    {
      key: 'total',
      name: 'Total',
      width: 120,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.total)}</span>,
    },
    {
      key: 'aksi',
      name: '',
      width: 140,
      renderCell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.status === 'selesai' && row.dibayar === 0 && (
            <Button variant="destructive" size="sm" onClick={() => cancelSale(row)}>
              Batalkan
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => printSale(row.id)}>
            Cetak
          </Button>
        </div>
      ),
    },
  ]

  if (!user) {
    return <p>Memuat...</p>
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Riwayat Transaksi</h1>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <form onSubmit={submitFilters} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Cari</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nama pelanggan / item..."
              className="w-56"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Dari</Label>
            <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Sampai</Label>
            <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Semua" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selesai">Selesai</SelectItem>
                <SelectItem value="dibatalkan">Dibatalkan</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Metode</Label>
            <Select value={metode} onValueChange={setMetode}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Semua" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tunai">Tunai</SelectItem>
                <SelectItem value="bon">Bon</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/')}>
            Ke Kasir
          </Button>
        </form>

        <div
          ref={(node) => {
            widthRef(node)
            heightRef(node)
          }}
        >
          {gridWidth > 0 && (
            <DataGrid
              className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
              columns={columns}
              rows={rows}
              rowKeyGetter={(row) => row.id}
              renderers={{
                noRowsFallback: (
                  <div className="col-span-full p-6 text-center text-sm text-muted-foreground">Tidak ada transaksi.</div>
                ),
              }}
              style={{ blockSize: gridHeight, minHeight: 300 }}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => loadPage(currentPage - 1)}>
            Sebelumnya
          </Button>
          <span className="text-sm text-muted-foreground">
            Halaman {currentPage} / {lastPage}
          </span>
          <Button variant="outline" size="sm" disabled={currentPage >= lastPage} onClick={() => loadPage(currentPage + 1)}>
            Berikutnya
          </Button>
        </div>
      </div>

      {receiptSale && storeSettings && <Receipt sale={receiptSale} storeSettings={storeSettings} />}
    </>
  )
}
```

- [ ] **Step 2: Wire the route**

`desktop-node/src/renderer/App.tsx` currently reads:

```typescript
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Login } from './pages/Login'
import { Kasir } from './pages/Kasir'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Kasir />} />
      </Routes>
    </HashRouter>
  )
}

export default App
```

Add the `KasirHistory` import and route:

```typescript
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Login } from './pages/Login'
import { Kasir } from './pages/Kasir'
import { KasirHistory } from './pages/KasirHistory'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Kasir />} />
        <Route path="/history" element={<KasirHistory />} />
      </Routes>
    </HashRouter>
  )
}

export default App
```

- [ ] **Step 3: Add a nav link from the Kasir page**

`desktop-node/src/renderer/pages/Kasir.tsx`'s top section currently reads:

```tsx
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{user.name}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await window.api.auth.logout()
            navigate('/login')
          }}
        >
          Keluar
        </Button>
      </div>
```

Add a "Riwayat Transaksi" button before the "Keluar" button (both inside the same flex container, so they end up side by side):

```tsx
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{user.name}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/history')}>
            Riwayat Transaksi
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await window.api.auth.logout()
              navigate('/login')
            }}
          >
            Keluar
          </Button>
        </div>
      </div>
```

- [ ] **Step 4: Verify it compiles**

```bash
cd desktop-node
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
```

Expected: no type errors on either.

- [ ] **Step 5: Run the full test suite**

```bash
cd desktop-node
npm run test
```

Expected: PASS — all 55 tests from earlier plans, unaffected by this renderer-only addition.

- [ ] **Step 6: Seed a few more sales for manual verification and switch to the Electron ABI**

`dev.sqlite` likely only has 1-2 sales from earlier plans' manual verification — not enough to meaningfully exercise pagination/filters. From `desktop-node/`, write a temporary `.ts` script (following the `createDb` pattern from `src/main/db/seed.ts`, not committed — delete it after use) that checks out a few more sales directly against the DB (or, simpler: use the already-working `checkout` function from `main/kasir.ts` against the existing dev product) so there's more than one page/status/method to filter against. Then:

```bash
cd desktop-node
npm run rebuild:electron
```

- [ ] **Step 7: Manual end-to-end verification**

```bash
npm run dev
```

Since this sandbox likely has no display, use the CDP-driven approach from earlier plans (Node's built-in `WebSocket`, `--remote-debugging-port`, `Runtime.evaluate`). Verify and report exactly what you observed for each:

1. From the Kasir page, click "Riwayat Transaksi" — confirm it navigates to `/history` and the table loads with existing sales.
2. Use the Status/Metode `Select` dropdowns and the date/search inputs, click "Filter" — confirm the result set actually narrows (e.g. filter to `status=dibatalkan` and confirm only cancelled sales show, or to a specific `search` term and confirm only matching rows show).
3. If there are more than 20 sales (seed enough in Step 6 to exceed one page, or verify the "Sebelumnya"/"Berikutnya" buttons are correctly disabled at page 1 / last page if you have fewer), confirm pagination works — clicking "Berikutnya" loads the next page and updates "Halaman X / Y".
4. Click "Cetak" on an older sale (not the most recent one) — confirm `getReceiptForSale` returns the correct sale's data (right total, right items) and printing completes (dialog/spinner not applicable here since there's no payment dialog on this page — just confirm the print promise resolves without error and no stale receipt data leaks from a previous print).
5. Find (or create, via Step 6) a sale with `status: 'selesai'` and `dibayar: 0` (a bon sale with nothing paid yet) — confirm the "Batalkan" button appears for it. Confirm it does NOT appear for a sale where `dibayar > 0` (a tunai sale, or a bon sale with a partial payment) — this is the stricter cancel rule this page uses, different from the Kasir page's own "Transaksi Hari Ini" section.
6. Confirm the "Bayar Bon" button is absent everywhere (per this plan's scope).

Clean up any temporary seed scripts before your final commit. After verification, switch back to the plain-Node ABI:

```bash
npm run rebuild:node
```

- [ ] **Step 8: Commit**

```bash
cd C:\Work\POS
git add desktop-node/src/renderer/pages/KasirHistory.tsx desktop-node/src/renderer/App.tsx desktop-node/src/renderer/pages/Kasir.tsx
git commit -m "Add History transaksi page with filters, pagination, reprint, cancel"
```

---

## Self-Review Notes

- **Spec coverage:** `kasir:listSalesHistory` filter/pagination ✅ (Task 2), `getReceipt` extraction + `kasir:getReceiptForSale` for reprints ✅ (Task 1), `useAvailableHeight` + `Select` ✅ (Task 3), full `KasirHistory.tsx` page (filter form, grid, pagination, reprint, cancel with the `dibayar === 0` rule, "Bayar Bon" omitted) + routing ✅ (Task 4). Bon Payment page and permanent nav/sidebar layout remain explicitly out of scope per the spec.
- **No placeholders:** every step has complete, runnable code or exact commands.
- **Type consistency:** `getReceipt`'s return shape (Task 1) matches `ReceiptSale` (from Slice 2's `Receipt.tsx`, unchanged) exactly — `KasirHistory.tsx` (Task 4) assigns `getReceiptForSale`'s resolved value directly to `receiptSale` state typed as `ReceiptSale`, no adapter needed. `SalesHistoryRow`/`SaleHistoryItem` (Task 4) match exactly what `kasir:listSalesHistory`'s `env.d.ts` type (Task 2) declares.
