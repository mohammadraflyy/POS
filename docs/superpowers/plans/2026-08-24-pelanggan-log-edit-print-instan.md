# Master Pelanggan, Log Edit, Print Instan, dan Pintasan Keyboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a customer master with full CRUD, make every sale edit carry a logged reason, cut receipt printing from ~500 ms to near-instant, and move the checkout keyboard flow onto `PageUp`/`PageDown`/`End` with a print confirmation after the sale is saved.

**Architecture:** All business logic lives in pure functions under `src/main/*.ts` that take a Drizzle database handle; `src/main/ipc/*.ts` wraps them with access guards and unit conversion; the React renderer talks to them only through `window.api`. Printing drops its child process and calls `winspool.drv` in-process through `koffi`. Keyboard shortcut selection is extracted from `Kasir.tsx` into a pure, testable module.

**Tech Stack:** Electron, React 19, TypeScript, Drizzle ORM on better-sqlite3, react-data-grid, vitest, koffi (new).

## Global Constraints

- Scope is `desktop-node/` only. Run every command from `C:\Work\POS\desktop-node`.
- **Close the running Electron app before running `npm test` or any rebuild.** A running app locks the native binaries and produces ABI errors that look like code bugs.
- **Money is stored in whole cents** in the main process. The IPC layer converts with `toCents()` / `toRupiah()` at the boundary (`src/main/ipc/kasir.ts:24-30`). Never mix the two units inside one function.
- The renderer never names the user account it acts as. Handlers take the account from `requireUser()` / `requireAdmin()`, which both return the `AuthUser` (`src/main/ipc/auth.ts:13-19`).
- `src/renderer/env.d.ts` is a hand-written mirror of the IPC surface. `tsc` does **not** cross-check it against the real handlers, so `preload/index.ts`, `env.d.ts`, and the handler must be edited together in the same task.
- All user-facing copy is Indonesian.
- Run `npm test` and `npm run build` before every commit. Both must pass.
- Every task commits on its own.

---

### Task 1: Print instan via koffi

**Files:**
- Modify: `desktop-node/package.json` (add dependency)
- Rewrite: `desktop-node/src/main/print-windows.ts`
- Test: `desktop-node/src/main/print-windows.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `printRaw(printerName: string, data: Buffer): Promise<void>` — same signature the current module exports, so `src/main/ipc/kasir.ts:333,363` need no change.

- [ ] **Step 1: Install koffi**

```bash
npm install koffi
```

- [ ] **Step 2: Verify koffi loads inside the Electron main process, not just in Node**

This is the one risk the spec flags. Do it before writing any code.

```bash
npm run build && npm run dev
```

With the app running, open the Settings page and press **Test Print**. If the print succeeds, koffi loads in Electron and the rest of this task is safe. If it throws a module-load error, **stop and report it** — the fallback is compiling a small C# console exe once and running it via `execFile`, which is a different task shape.

Note: the app must be closed again before Step 5 runs the test suite.

- [ ] **Step 3: Write the failing test**

Create `desktop-node/src/main/print-windows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { printRaw } from './print-windows'

describe('printRaw', () => {
  it('rejects an unknown printer with a message a cashier can read', async () => {
    await expect(printRaw('Printer Yang Tidak Ada 12345', Buffer.from('x'))).rejects.toThrow(/Gagal mencetak/)
  })

  it('serialises concurrent prints instead of interleaving them', async () => {
    const order: string[] = []

    const first = printRaw('Printer Yang Tidak Ada 12345', Buffer.from('a')).catch(() => order.push('a'))
    const second = printRaw('Printer Yang Tidak Ada 12345', Buffer.from('b')).catch(() => order.push('b'))

    await Promise.all([first, second])

    expect(order).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- print-windows`
Expected: FAIL. The current implementation spawns PowerShell, so the first test is slow and the second may resolve out of order.

- [ ] **Step 5: Replace the implementation**

Replace the entire contents of `desktop-node/src/main/print-windows.ts`:

```ts
import koffi from 'koffi'

/**
 * Raw ESC/POS output straight to the Windows spooler.
 *
 * This used to spawn `powershell.exe` once per receipt to P/Invoke the same functions.
 * Caching the compiled helper DLL removed the C# compile, but PowerShell's own process
 * startup still cost ~300-600 ms on every single struk - that was the whole of the
 * "print lemot" complaint. Calling winspool.drv in-process removes the process entirely.
 */
const winspool = koffi.load('winspool.drv')

const DOC_INFO_1 = koffi.struct('DOC_INFO_1', {
  pDocName: 'str',
  pOutputFile: 'str',
  pDatatype: 'str',
})

const OpenPrinter = winspool.func('__stdcall', 'OpenPrinterA', 'bool', ['str', 'void **', 'void *'])
const ClosePrinter = winspool.func('__stdcall', 'ClosePrinter', 'bool', ['void *'])
const StartDocPrinter = winspool.func('__stdcall', 'StartDocPrinterA', 'int32', ['void *', 'uint32', koffi.pointer(DOC_INFO_1)])
const EndDocPrinter = winspool.func('__stdcall', 'EndDocPrinter', 'bool', ['void *'])
const StartPagePrinter = winspool.func('__stdcall', 'StartPagePrinter', 'bool', ['void *'])
const EndPagePrinter = winspool.func('__stdcall', 'EndPagePrinter', 'bool', ['void *'])
const WritePrinter = winspool.func('__stdcall', 'WritePrinter', 'bool', ['void *', 'void *', 'uint32', 'uint32 *'])

function sendToPrinter(printerName: string, data: Buffer): void {
  const handleOut = [null] as unknown[]

  if (!OpenPrinter(printerName, handleOut, null)) {
    throw new Error(`printer "${printerName}" tidak bisa dibuka`)
  }

  const handle = handleOut[0]

  try {
    const docInfo = { pDocName: 'POS Receipt', pOutputFile: null, pDatatype: 'RAW' }

    if (StartDocPrinter(handle, 1, docInfo) === 0) {
      throw new Error('spooler menolak dokumen baru')
    }

    try {
      if (!StartPagePrinter(handle)) {
        throw new Error('spooler menolak halaman baru')
      }

      try {
        const written = [0]

        if (!WritePrinter(handle, data, data.length, written)) {
          throw new Error('data gagal dikirim ke printer')
        }
      } finally {
        EndPagePrinter(handle)
      }
    } finally {
      EndDocPrinter(handle)
    }
  } finally {
    ClosePrinter(handle)
  }
}

async function runPrint(printerName: string, data: Buffer): Promise<void> {
  try {
    sendToPrinter(printerName, data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Gagal mencetak: ${message}`)
  }
}

// One receipt at a time. The renderer fires prints without awaiting them, so two receipts
// really can overlap - this is not a theoretical race.
let printQueue: Promise<unknown> = Promise.resolve()

export function printRaw(printerName: string, data: Buffer): Promise<void> {
  const run = () => runPrint(printerName, data)
  const next = printQueue.then(run, run)

  printQueue = next.catch(() => undefined)

  return next
}
```

If any koffi type string above is rejected at load time, read the error, fix the signature against koffi's docs, and keep the surrounding structure — do not fall back to spawning a process without reporting it first.

- [ ] **Step 6: Run the tests**

Run: `npm test -- print-windows escpos`
Expected: PASS. `escpos.test.ts` must stay green untouched — `buildReceiptEscPos` was not modified.

- [ ] **Step 7: Measure the improvement**

Temporarily wrap the call in `src/main/ipc/kasir.ts:333` with a timer:

```ts
const startedAt = Date.now()
await printRaw(printerName, bytes)
console.log(`printRaw ${Date.now() - startedAt}ms`)
```

Run `npm run dev`, print one receipt from the Penjualan page, and read the number from the terminal. Record it in the commit message. Then **remove the timer lines again** before committing.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/main/print-windows.ts src/main/print-windows.test.ts
git commit -m "perf(print): call winspool.drv in-process instead of spawning PowerShell

The cached-DLL comment claimed the compile was the delay. It was not: PowerShell's
own startup cost ~300-600ms and was paid on every single receipt. koffi calls the
same winspool functions from the main process, so no child process is involved.

Measured: <before>ms -> <after>ms per receipt."
```

---

### Task 2: Pure shortcut resolver

**Files:**
- Create: `desktop-node/src/renderer/pages/kasir/shortcuts.ts`
- Test: `desktop-node/src/renderer/pages/kasir/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveShortcut(event: ShortcutEvent, state: KasirShortcutState): KasirShortcut | null`, plus the exported types `ShortcutEvent`, `KasirShortcutState`, and `KasirShortcut`. Task 3 wires these into `Kasir.tsx`.

Nothing in `Kasir.tsx` is currently reachable from vitest, and this change moves the key that takes money. The resolver is extracted first so the rules have tests before the component is touched.

- [ ] **Step 1: Write the failing test**

Create `desktop-node/src/renderer/pages/kasir/shortcuts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveShortcut, type KasirShortcutState } from './shortcuts'

function state(overrides: Partial<KasirShortcutState> = {}): KasirShortcutState {
  return {
    cartCount: 1,
    anyDialogOpen: false,
    editableFocused: false,
    bayarEnabled: true,
    ...overrides,
  }
}

describe('resolveShortcut', () => {
  it('opens the payment dialog on End', () => {
    expect(resolveShortcut({ key: 'End', altKey: false }, state())).toEqual({ type: 'openBayar' })
  })

  it('no longer pays on a lone Enter', () => {
    expect(resolveShortcut({ key: 'Enter', altKey: false }, state())).toBeNull()
  })

  it('refuses End on an empty cart', () => {
    expect(resolveShortcut({ key: 'End', altKey: false }, state({ cartCount: 0 }))).toBeNull()
  })

  it('refuses End while an edited sale is not ready to be saved', () => {
    expect(resolveShortcut({ key: 'End', altKey: false }, state({ bayarEnabled: false }))).toBeNull()
  })

  it('sends PageUp to the Jumlah field and PageDown to the Cari box', () => {
    expect(resolveShortcut({ key: 'PageUp', altKey: false }, state())).toEqual({ type: 'focusJumlah' })
    expect(resolveShortcut({ key: 'PageDown', altKey: false }, state())).toEqual({ type: 'focusCari' })
  })

  it('keeps PageUp and PageDown working while an input is focused, so the two fields can be hopped between', () => {
    expect(resolveShortcut({ key: 'PageUp', altKey: false }, state({ editableFocused: true }))).toEqual({
      type: 'focusJumlah',
    })
    expect(resolveShortcut({ key: 'PageDown', altKey: false }, state({ editableFocused: true }))).toEqual({
      type: 'focusCari',
    })
  })

  it('yields every key to an open dialog, because PaymentDialog owns PageUp and PageDown itself', () => {
    const open = state({ anyDialogOpen: true })

    expect(resolveShortcut({ key: 'PageUp', altKey: false }, open)).toBeNull()
    expect(resolveShortcut({ key: 'PageDown', altKey: false }, open)).toBeNull()
    expect(resolveShortcut({ key: 'End', altKey: false }, open)).toBeNull()
    expect(resolveShortcut({ key: 'F3', altKey: false }, open)).toBeNull()
  })

  it('keeps the existing shortcuts', () => {
    expect(resolveShortcut({ key: 'F3', altKey: false }, state())).toEqual({ type: 'editTopQty' })
    expect(resolveShortcut({ key: '/', altKey: false }, state())).toEqual({ type: 'focusCari' })
    expect(resolveShortcut({ key: 'k', altKey: true }, state())).toEqual({ type: 'clearCart' })
    expect(resolveShortcut({ key: 'p', altKey: true }, state())).toEqual({ type: 'openCustomer' })
  })

  it('does not steal a typed slash or Alt shortcut from a focused input', () => {
    const typing = state({ editableFocused: true })

    expect(resolveShortcut({ key: '/', altKey: false }, typing)).toBeNull()
    expect(resolveShortcut({ key: 'k', altKey: true }, typing)).toBeNull()
  })

  it('refuses F3 on an empty cart', () => {
    expect(resolveShortcut({ key: 'F3', altKey: false }, state({ cartCount: 0 }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- shortcuts`
Expected: FAIL with a module-not-found error for `./shortcuts`.

- [ ] **Step 3: Write the implementation**

Create `desktop-node/src/renderer/pages/kasir/shortcuts.ts`:

```ts
/**
 * Which key does what on the Penjualan page, as a pure function.
 *
 * Ownership of these keys is split across Kasir.tsx and three dialogs, and the same key
 * means different things depending on what is open - PaymentDialog already uses PageUp
 * and PageDown to cycle its own actions. Keeping the rules here means they can be tested
 * without a DOM, which matters because End is the key that opens the till.
 */
export type KasirShortcut =
  | { type: 'editTopQty' }
  | { type: 'focusJumlah' }
  | { type: 'focusCari' }
  | { type: 'clearCart' }
  | { type: 'openCustomer' }
  | { type: 'openBayar' }

export interface ShortcutEvent {
  key: string
  altKey: boolean
}

export interface KasirShortcutState {
  /** number of lines in the cart */
  cartCount: number
  /** payment dialog, product palette, or customer picker is showing */
  anyDialogOpen: boolean
  /** focus is in an input, textarea, or contenteditable */
  editableFocused: boolean
  /** false while an edited sale is still loading or cannot be safely rewritten */
  bayarEnabled: boolean
}

export function resolveShortcut(event: ShortcutEvent, state: KasirShortcutState): KasirShortcut | null {
  // A dialog always wins. PaymentDialog binds PageUp/PageDown to its action selector, and
  // cmdk dialogs own the arrows and Enter while they are open.
  if (state.anyDialogOpen) {
    return null
  }

  // Checked ahead of the focus guard: these three type nothing, so they are safe to fire
  // out of a focused input - and hopping between Jumlah and Cari is the entire point of
  // PageUp/PageDown, which means they must work while one of them is focused.
  if (event.key === 'F3') {
    return state.cartCount > 0 ? { type: 'editTopQty' } : null
  }

  if (event.key === 'PageUp') {
    return { type: 'focusJumlah' }
  }

  if (event.key === 'PageDown') {
    return { type: 'focusCari' }
  }

  if (state.editableFocused) {
    return null
  }

  if (event.key === '/') {
    return { type: 'focusCari' }
  }

  if (event.altKey && event.key.toLowerCase() === 'k') {
    return { type: 'clearCart' }
  }

  if (event.altKey && event.key.toLowerCase() === 'p') {
    return { type: 'openCustomer' }
  }

  // Enter used to do this. It was handed to End so that Enter falls back to the grid's own
  // "start editing this cell", and so the scanner's Enter has one less meaning to compete with.
  if (event.key === 'End') {
    return state.cartCount > 0 && state.bayarEnabled ? { type: 'openBayar' } : null
  }

  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- shortcuts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/kasir/shortcuts.ts src/renderer/pages/kasir/shortcuts.test.ts
git commit -m "refactor(kasir): extract keyboard shortcut rules into a pure module

Nothing in Kasir.tsx was reachable from vitest. The rules move out first so the
next commit, which changes the key that opens the till, has tests behind it."
```

---

### Task 3: Wire the new shortcuts into Kasir.tsx

**Files:**
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx:308-406` (global keydown), `:456-474` (`handleCartCellKeyDown`), `:585-602` (Jumlah input), `:824-845` (hint bar)

**Interfaces:**
- Consumes: `resolveShortcut`, `KasirShortcut`, `KasirShortcutState` from Task 2.
- Produces: a `jumlahInputRef` on the Jumlah `<Input>`; no exported API change.

- [ ] **Step 1: Add the import and a ref for the Jumlah field**

In `Kasir.tsx`, add to the imports near the other `./kasir/*` imports:

```ts
import { resolveShortcut, type KasirShortcut } from './kasir/shortcuts'
```

Next to `searchInputRef` (around line 148), add:

```ts
const jumlahInputRef = useRef<HTMLInputElement>(null)
```

Attach it to the Jumlah input (around line 588), keeping every existing prop:

```tsx
<Input
  id="kasir-jumlah"
  ref={jumlahInputRef}
  type="text"
  inputMode="decimal"
  ...
```

- [ ] **Step 2: Replace the shortcut half of the global keydown handler**

Inside the `useEffect` at line 308, replace everything from the `if (e.key === 'F3' ...)` block down to and including the `if (e.altKey && e.key.toLowerCase() === 'p')` block with:

```ts
      const shortcut = resolveShortcut(e, {
        cartCount: cart.length,
        anyDialogOpen: paymentOpen || paletteOpen || customerOpen,
        editableFocused: isEditableFocused(),
        bayarEnabled: editSaleId === null || editReady,
      })

      if (shortcut) {
        e.preventDefault()
        applyShortcut(shortcut)

        return
      }

      if (isEditableFocused()) {
        return
      }
```

Add `applyShortcut` as a function inside the same `useEffect`, above `handleKeydown`:

```ts
    function applyShortcut(shortcut: KasirShortcut) {
      switch (shortcut.type) {
        case 'editTopQty':
          blurActiveElement()
          cartGridRef.current?.setActivePosition({ idx: QTY_COLUMN_IDX, rowIdx: 0 }, { enableEditor: true })
          break
        case 'focusJumlah':
          jumlahInputRef.current?.focus()
          jumlahInputRef.current?.select()
          break
        case 'focusCari':
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
          break
        case 'clearCart':
          clearCart()
          break
        case 'openCustomer':
          setCustomerOpen(true)
          break
        case 'openBayar':
          setPaymentOpen(true)
          break
      }
    }
```

- [ ] **Step 3: Remove the lone-Enter payment branch, keeping the scanner intact**

Still inside `handleKeydown`, the scanner block at line 362 currently pays on a short Enter burst. Replace that whole `if (code.length < 4) { ... return }` body with just:

```ts
        if (code.length < 4) {
          // not a scan burst, and Enter no longer pays - End does
          return
        }
```

Everything else in the scanner path — the 100 ms gap reset, the barcode lookup, the buffer append — is untouched.

- [ ] **Step 4: Update the effect's dependency array**

The effect at line 402 currently ends with `}, [products, cart.length, paymentOpen])`. It now reads more state, so:

```ts
  }, [products, cart.length, paymentOpen, paletteOpen, customerOpen, editSaleId, editReady])
```

- [ ] **Step 5: Take Enter out of the cart grid handler**

Replace `handleCartCellKeyDown` (line 456) with:

```tsx
  // Alt+K still has to be caught here: while a grid cell is active the grid swallows the
  // keydown before it reaches the window listener. Enter is deliberately left alone now,
  // so it falls through to the grid's own "start editing this cell".
  function handleCartCellKeyDown(args: CellKeyDownArgs<CartLine>, event: CellKeyboardEvent) {
    if (args.mode !== 'ACTIVE') {
      return
    }

    if (event.key === 'End' && cart.length > 0 && !paymentOpen && (editSaleId === null || editReady)) {
      event.preventGridDefault()
      event.preventDefault()
      setPaymentOpen(true)

      return
    }

    if (event.altKey && event.key.toLowerCase() === 'k' && !paymentOpen) {
      event.preventGridDefault()
      event.preventDefault()
      clearCart()
    }
  }
```

- [ ] **Step 6: Update the hint bar**

In the hint row starting at line 824, change the `Enter` / `Bayar` entry to `End` / `Bayar`, and add two entries after it:

```tsx
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">End</kbd>
              Bayar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">PgUp</kbd>
              Isi Jumlah
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">PgDn</kbd>
              Cari Produk
            </span>
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run build`
Expected: PASS and a clean build.

Then `npm run dev` and check by hand, because none of this is covered by a DOM test:
1. `PageUp` from anywhere lands in Jumlah with the text selected; `PageDown` lands in Cari.
2. `End` opens the payment dialog; `Enter` on the page no longer does.
3. Inside the payment dialog, `PageUp`/`PageDown` still cycle Simpan/Batal — the page's own handler must stay silent.
4. A barcode scan still adds a product.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/pages/Kasir.tsx
git commit -m "feat(kasir): PgUp/PgDn hop between Jumlah and Cari, End opens Bayar

Enter no longer pays, which hands it back to the grid as 'edit this cell' and
leaves the scanner's Enter one less meaning to compete with. The page-level
handler goes quiet whenever a dialog is open, because PaymentDialog binds
PgUp/PgDn to its own action selector."
```

---

### Task 4: Confirm printing after the sale is saved

**Files:**
- Modify: `desktop-node/src/renderer/pages/kasir/PaymentDialog.tsx:11-13,84-114,171-178,338-352`
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx:488-532,868`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PaymentDialogProps.onSubmit` narrows from `(shouldPrint: boolean) => void` to `() => void`.

The confirmation reuses the existing `useConfirm()` hook, already imported in `Kasir.tsx` and already used by `clearCart`. Its confirm button carries `autoFocus`, so `Enter` accepts and `Esc` dismisses without any new component.

- [ ] **Step 1: Drop the cetak action from PaymentDialog**

Replace lines 11-13:

```ts
// One list for both modes now. Printing is no longer decided here - it is asked after the
// sale is saved, where the cashier can see the change first.
const actions = ['simpan', 'batal'] as const
type Action = (typeof actions)[number]
```

In the component body, replace the `availableActions` and `selectedAction` setup (lines 84-94) with:

```ts
  const availableActions: readonly Action[] = actions
  const [selectedAction, setSelectedAction] = useState<Action>('simpan')
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)

    if (open) {
      setSelectedAction('simpan')
    }
  }
```

Replace `runAction` (line 96) with:

```ts
  function runAction(action: Action) {
    if (action === 'simpan' && editMode && !editReady) {
      return
    }

    if (action !== 'batal' && bonNeedsCustomer) {
      onEditCustomer()

      return
    }

    if (action === 'simpan') {
      onSubmit()
    } else {
      onOpenChange(false)
    }
  }
```

Change the form's submit handler (line 174) from `runAction(editMode ? 'simpan' : 'cetak')` to `runAction('simpan')`.

Change the prop type (line 36) from `onSubmit: (shouldPrint: boolean) => void` to `onSubmit: () => void`.

- [ ] **Step 2: Replace the Print/Cetak button with a primary Simpan**

Delete the whole `{!editMode && (<Button type="submit" ...>Print/Cetak</Button>)}` block (lines 339-352). Change the Simpan button in the grid below it from `type="button"` / `variant="secondary"` / `onClick={() => onSubmit(false)}` to:

```tsx
              <Button
                type="submit"
                disabled={processing || bonNeedsCustomer || (editMode && !editReady)}
                className={cn(
                  selectedAction === 'simpan' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                )}
              >
                {selectedAction === 'simpan' && <CornerDownLeft className="size-3.5" />}
                {editMode ? 'Simpan Perubahan' : 'Simpan'}
                <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+S</kbd>
              </Button>
```

Remove the now-unused `Printer` import from line 3.

- [ ] **Step 3: Ask about printing after checkout succeeds**

In `Kasir.tsx`, replace `handleCheckout` (line 488) with:

```tsx
  async function handleCheckout() {
    setProcessing(true)
    setCheckoutError(null)
    setMessage(null)

    // Captured before resetAfterCheckout wipes them - the confirmation below still has to
    // be able to say what the change was.
    const totalTersimpan = total
    const kembalian = metode === 'tunai' ? Number(dibayar || 0) - total : 0
    const metodeTersimpan = metode

    try {
      const sale = await window.api.kasir.checkout({
        metodePembayaran: metode,
        namaPelanggan: metode === 'bon' ? namaPelanggan.trim() || null : namaPelanggan.trim() || DEFAULT_PELANGGAN,
        dibayar: metode === 'tunai' ? Number(dibayar || 0) : null,
        tanggal,
        diskon: diskonNotaValue,
        items: cart.map((line) => ({
          productId: line.product.id,
          productUnitId: line.productUnitId,
          qty: line.qty,
          diskon: line.diskon ?? 0,
        })),
      })

      setMessage('Transaksi disimpan.')
      setCheckoutError(null)
      resetAfterCheckout()
      refreshProducts()
      refreshCustomers()

      const cetak = await confirm({
        title: `Cetak struk #${sale.saleId}?`,
        description:
          metodeTersimpan === 'tunai'
            ? `Kembalian ${formatRupiah(Math.max(kembalian, 0))}.`
            : `Total ${formatRupiah(totalTersimpan)}.`,
        confirmLabel: 'Cetak',
        cancelLabel: 'Lewati',
      })

      if (cetak) {
        // The sale is already committed. Printing reaches hardware and can stall, so it runs
        // in the background rather than holding the till hostage - a failure surfaces as an
        // error naming the sale, which can be reprinted from Riwayat.
        window.api.kasir
          .printReceipt(sale.saleId)
          .then(() => setMessage(`Struk #${sale.saleId} dicetak.`))
          .catch((err) => {
            const reason = err instanceof Error ? err.message : 'kesalahan tidak diketahui'
            setError(
              `Transaksi #${sale.saleId} tersimpan, tetapi struk gagal dicetak: ${reason}. Cetak ulang dari Riwayat.`,
            )
          })
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Gagal checkout')
    } finally {
      setProcessing(false)
    }
  }
```

- [ ] **Step 4: Update the PaymentDialog call site**

At line 868, change `onSubmit={editSaleId === null ? handleCheckout : () => handleSaveEdit()}` to:

```tsx
        onSubmit={editSaleId === null ? handleCheckout : handleSaveEdit}
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run build`
Expected: PASS and a clean build.

Then `npm run dev` and walk it by hand: add a line, `End`, type cash, `Enter` — the sale saves, the "Cetak struk #N?" dialog appears showing the change, `Enter` prints, `Esc` skips. Confirm the payment dialog no longer shows a Print/Cetak button and that `PageUp`/`PageDown` there now cycle only Simpan and Batal.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/Kasir.tsx src/renderer/pages/kasir/PaymentDialog.tsx
git commit -m "feat(kasir): ask about printing after the sale is saved, not before

The print choice was baked into the payment button, so the cashier committed to
paper before seeing the change. It is now a confirmation after the sale lands,
which costs one extra Enter and buys the change being visible first."
```

---

### Task 5: Log every sale edit with a reason

**Files:**
- Modify: `desktop-node/src/main/db/schema.ts` (append `saleEdits`)
- Create: `desktop-node/drizzle/00NN_*.sql` (generated)
- Modify: `desktop-node/src/main/kasir.ts:437-447,462-595`
- Modify: `desktop-node/src/main/ipc/kasir.ts:256-292`
- Modify: `desktop-node/src/main/db/migrate.test.ts:45`
- Test: `desktop-node/src/main/kasir.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: table `saleEdits`; `UpdateSaleInput` gains `keterangan: string` and `userId: number`. Task 6 reads these rows.

- [ ] **Step 1: Write the failing test**

Append to `desktop-node/src/main/kasir.test.ts`. Reuse whatever seed helper that file already uses for `updateSale` tests — read the existing `describe('updateSale')` block and follow it exactly rather than inventing a new fixture.

```ts
describe('updateSale keterangan', () => {
  it('refuses to save an edit without a reason', () => {
    const { db, saleId, items } = seedSaleForEdit()

    expect(() =>
      updateSale(db, saleId, {
        metodePembayaran: 'tunai',
        namaPelanggan: 'UMUM',
        dibayar: 200000,
        tanggal: '2026-08-24T10:00',
        keterangan: '   ',
        userId: 1,
        items,
      }),
    ).toThrow('Keterangan wajib diisi saat mengedit transaksi.')
  })

  it('writes one log row per save, with the totals on both sides of the change', () => {
    const { db, saleId, items } = seedSaleForEdit()
    const totalSebelum = db.select().from(sales).where(eq(sales.id, saleId)).get()!.total

    const hasil = updateSale(db, saleId, {
      metodePembayaran: 'tunai',
      namaPelanggan: 'UMUM',
      dibayar: 500000,
      tanggal: '2026-08-24T10:00',
      keterangan: 'salah input qty',
      userId: 1,
      items: [{ ...items[0], qty: items[0].qty + 1 }],
    })

    const logs = db.select().from(saleEdits).where(eq(saleEdits.saleId, saleId)).all()

    expect(logs).toHaveLength(1)
    expect(logs[0].keterangan).toBe('salah input qty')
    expect(logs[0].userId).toBe(1)
    expect(logs[0].totalSebelum).toBe(totalSebelum)
    expect(logs[0].totalSesudah).toBe(hasil.total)
  })

  it('keeps the reason from the first edit when a second edit is saved', () => {
    const { db, saleId, items } = seedSaleForEdit()
    const base = {
      metodePembayaran: 'tunai' as const,
      namaPelanggan: 'UMUM',
      dibayar: 500000,
      tanggal: '2026-08-24T10:00',
      userId: 1,
      items,
    }

    updateSale(db, saleId, { ...base, keterangan: 'alasan pertama' })
    updateSale(db, saleId, { ...base, keterangan: 'alasan kedua' })

    const logs = db.select().from(saleEdits).where(eq(saleEdits.saleId, saleId)).orderBy(saleEdits.id).all()

    expect(logs.map((row) => row.keterangan)).toEqual(['alasan pertama', 'alasan kedua'])
  })

  it('writes no log row when the rewrite itself fails', () => {
    const { db, saleId, items } = seedSaleForEdit()

    expect(() =>
      updateSale(db, saleId, {
        metodePembayaran: 'tunai',
        namaPelanggan: 'UMUM',
        // deliberately below the line total, which updateSale rejects inside the transaction
        dibayar: 1,
        tanggal: '2026-08-24T10:00',
        keterangan: 'ini tidak boleh tercatat',
        userId: 1,
        items,
      }),
    ).toThrow()

    expect(db.select().from(saleEdits).where(eq(saleEdits.saleId, saleId)).all()).toHaveLength(0)
  })
})
```

Add `saleEdits` to the schema import at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- kasir`
Expected: FAIL — `saleEdits` is not exported from the schema.

- [ ] **Step 3: Add the table to the schema**

In `desktop-node/src/main/db/schema.ts`, after the `saleItems` definition (line 186):

```ts
/**
 * One row per saved edit of a sale, never overwritten.
 *
 * A single `keterangan` column on `sales` would have been cheaper, but the second edit
 * would erase the first edit's reason - and it is exactly that sequence the owner wants
 * to be able to follow. The two totals are stored so the log can be read without
 * reconstructing the sale.
 */
export const saleEdits = sqliteTable('sale_edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  keterangan: text('keterangan').notNull(),
  /** whole cents, as `sales.total` is */
  totalSebelum: integer('total_sebelum').notNull(),
  totalSesudah: integer('total_sesudah').notNull(),
  ...timestamps(),
})
```

- [ ] **Step 4: Generate the migration**

```bash
npm run db:generate
```

Note the generated tag (it will be `0017_<random words>`). Open the generated `.sql` and confirm it only creates `sale_edits` and touches nothing else.

- [ ] **Step 5: Update the table-count test**

`src/main/db/migrate.test.ts:45` asserts the exact set of tables. Change the name to `creates all 19 business tables` and add `'sale_edits'` to the sorted array — keep the array alphabetical.

- [ ] **Step 6: Require the reason in updateSale**

In `src/main/kasir.ts`, extend `UpdateSaleInput` (line 437):

```ts
export interface UpdateSaleInput {
  metodePembayaran: MetodePembayaran
  namaPelanggan: string | null
  /** whole cents; ignored for qris and transfer, which always settle in full */
  dibayar: number | null
  /** local `YYYY-MM-DDTHH:mm` */
  tanggal: string
  /** whole cents off the whole bill, applied after every line's own discount */
  diskon?: number | null
  /** why this sale was edited; required, and kept forever in `sale_edits` */
  keterangan: string
  /** the account doing the editing, taken from the session by the IPC layer */
  userId: number
  items: CartItemInput[]
}
```

Add the guard beside the other up-front guards in `updateSale`, right after the empty-cart check (line 465):

```ts
  if (!input.keterangan.trim()) {
    throw new Error('Keterangan wajib diisi saat mengedit transaksi.')
  }
```

Inside the transaction, capture the old total before anything is rewritten. Right after `const oldItems = ...` (line 498), add:

```ts
    const totalSebelum = sale.total
```

Then, immediately before `return { total }` (line 593) and after the `tx.update(sales)` call, add:

```ts
    // Inside the same transaction as the rewrite on purpose: a log describing a change
    // that never happened would be worse than no log.
    tx.insert(saleEdits)
      .values({
        saleId,
        userId: input.userId,
        keterangan: input.keterangan.trim(),
        totalSebelum,
        totalSesudah: total,
        createdAt: now,
        updatedAt: now,
      })
      .run()
```

Add `saleEdits` to the schema import at the top of `kasir.ts`.

- [ ] **Step 7: Pass the reason and the account through IPC**

In `src/main/ipc/kasir.ts`, the `kasir:updateSale` handler (line 256): add `keterangan: string` to the input type after `diskon`, capture the admin, and forward both:

```ts
      const admin = requireAdmin()

      const result = updateSale(db, input.saleId, {
        metodePembayaran: input.metodePembayaran,
        namaPelanggan: input.namaPelanggan,
        dibayar: input.dibayar === null ? null : toCents(input.dibayar),
        tanggal: input.tanggal,
        diskon: input.diskon == null ? null : toCents(input.diskon),
        keterangan: input.keterangan,
        userId: admin.id,
        items: input.items.map((item) => ({
```

Replace the bare `requireAdmin()` call on line 276 with the `const admin = requireAdmin()` above — do not call it twice.

- [ ] **Step 8: Mirror the new field in preload and env.d.ts**

Add `keterangan: string` to the `updateSale` input type in both `src/preload/index.ts` and `src/renderer/env.d.ts`. Neither is checked against the handler by `tsc`, so both must be edited now.

- [ ] **Step 9: Run the tests**

Run: `npm test`
Expected: PASS. `Kasir.tsx` will now fail the build because `updateSale` is called without `keterangan` — that is fixed in Task 6.

- [ ] **Step 10: Commit**

```bash
git add src/main/db/schema.ts src/main/kasir.ts src/main/ipc/kasir.ts src/main/kasir.test.ts src/main/db/migrate.test.ts src/preload/index.ts src/renderer/env.d.ts drizzle/
git commit -m "feat(kasir): require and record a reason for every sale edit

A rewritten sale shifts the rekap and the cash book on two days at once and left
no trace of why. Each save now writes a sale_edits row inside the same transaction
as the rewrite, so a log can never describe a change that did not happen."
```

---

### Task 6: Reason field in the dialog, edit history on the sale

**Files:**
- Modify: `desktop-node/src/renderer/pages/kasir/PaymentDialog.tsx`
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx:534-569`
- Modify: `desktop-node/src/main/ipc/kasir.ts` (the `kasir:getSaleDetail` handler)
- Modify: `desktop-node/src/renderer/pages/SaleDetail.tsx`
- Modify: `desktop-node/src/preload/index.ts`, `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `saleEdits` table and the `keterangan` / `userId` fields on `UpdateSaleInput` from Task 5.
- Produces: `SaleDetailData.edits: { id: number; keterangan: string; kasirName: string | null; totalSebelum: number; totalSesudah: number; createdAt: string }[]` — totals in rupiah, converted at the IPC boundary.

- [ ] **Step 1: Add the reason field to PaymentDialog**

Add two props to `PaymentDialogProps`:

```ts
  /** only used in edit mode: why this sale is being changed */
  keterangan: string
  setKeterangan: (value: string) => void
```

Destructure them in the component signature. In `runAction`, before the `onSubmit()` call, refuse an empty reason:

```ts
    if (action === 'simpan' && editMode && !keterangan.trim()) {
      return
    }
```

Render the field in edit mode only, directly above the error paragraph (the `{error && ...}` block):

```tsx
          {editMode && (
            <div className="grid gap-2">
              <Label htmlFor="keterangan-edit">Keterangan perubahan</Label>
              <textarea
                id="keterangan-edit"
                value={keterangan}
                disabled={processing}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Contoh: salah input qty, pelanggan tukar barang"
                rows={2}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <p className="text-xs text-muted-foreground">
                Wajib diisi. Tersimpan permanen di riwayat transaksi.
              </p>
            </div>
          )}
```

Add `keterangan.trim() === ''` to the Simpan button's `disabled` expression when `editMode` is true:

```tsx
                disabled={processing || bonNeedsCustomer || (editMode && (!editReady || !keterangan.trim()))}
```

- [ ] **Step 2: Hold the reason in Kasir.tsx and send it**

Add state next to the other payment state (near line 124):

```ts
  // edit mode only, and deliberately never persisted to the draft - a reason belongs to
  // the one save it explains
  const [keteranganEdit, setKeteranganEdit] = useState('')
```

In `handleSaveEdit` (line 543), add the field to the `updateSale` call, right after `diskon`:

```ts
        diskon: diskonNotaValue,
        keterangan: keteranganEdit,
```

Pass the two new props at the `PaymentDialog` call site:

```tsx
        keterangan={keteranganEdit}
        setKeterangan={setKeteranganEdit}
```

- [ ] **Step 3: Return the edit history from the sale detail handler**

In `src/main/ipc/kasir.ts`, find the `kasir:getSaleDetail` handler and add, alongside the existing `bonPayments` lookup:

```ts
    const editRows = db
      .select({
        id: saleEdits.id,
        keterangan: saleEdits.keterangan,
        totalSebelum: saleEdits.totalSebelum,
        totalSesudah: saleEdits.totalSesudah,
        createdAt: saleEdits.createdAt,
        kasirName: users.name,
      })
      .from(saleEdits)
      .leftJoin(users, eq(saleEdits.userId, users.id))
      .where(eq(saleEdits.saleId, saleId))
      .orderBy(desc(saleEdits.id))
      .all()
```

Add to the returned object:

```ts
      edits: editRows.map((row) => ({
        id: row.id,
        keterangan: row.keterangan,
        kasirName: row.kasirName,
        totalSebelum: toRupiah(row.totalSebelum),
        totalSesudah: toRupiah(row.totalSesudah),
        createdAt: row.createdAt.toISOString(),
      })),
```

Add `saleEdits` to the schema import at the top of the file.

- [ ] **Step 4: Mirror the shape in preload and env.d.ts**

Add the same `edits` array shape to the `getSaleDetail` return type in `src/preload/index.ts` and `src/renderer/env.d.ts`.

- [ ] **Step 5: Show the history on SaleDetail**

Add to the `SaleDetailData` interface:

```ts
  edits: {
    id: number
    keterangan: string
    kasirName: string | null
    totalSebelum: number
    totalSesudah: number
    createdAt: string
  }[]
```

Render a panel below the bon payments section, styled like the surrounding cards:

```tsx
      {sale.edits.length > 0 && (
        <div className="rounded-xl border p-5">
          <h2 className="text-sm font-medium text-muted-foreground">Riwayat Edit</h2>
          <ul className="mt-3 space-y-3">
            {sale.edits.map((edit) => (
              <li key={edit.id} className="border-b pb-3 text-sm last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{edit.keterangan}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {new Date(edit.createdAt).toLocaleString('id-ID')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {edit.kasirName ?? 'Pengguna dihapus'} &middot; {formatRupiah(edit.totalSebelum)} &rarr;{' '}
                  {formatRupiah(edit.totalSesudah)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: PASS and a clean build — the `keterangan` argument added in Task 5 is now supplied.

Then `npm run dev`: open Riwayat, edit a sale, confirm Simpan Perubahan stays disabled until the reason is typed, save, and check the reason appears under Riwayat Edit on the sale's detail page with the totals on both sides.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/kasir/PaymentDialog.tsx src/renderer/pages/Kasir.tsx src/renderer/pages/SaleDetail.tsx src/main/ipc/kasir.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(kasir): ask for the edit reason and show the edit history

The reason is required in the payment dialog's edit mode and rendered back on the
sale detail page, newest first, with the total on both sides of each change."
```

---

### Task 7: customers table and backfill

**Files:**
- Modify: `desktop-node/src/main/db/schema.ts`
- Create: `desktop-node/drizzle/00NN_*.sql` (generated, then hand-edited)
- Modify: `desktop-node/src/main/db/migrate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `customers` (`id`, `nama` unique, `telepon`, `alamat`, `keterangan`, timestamps) and column `sales.customer_id`. Tasks 8-10 depend on both.

- [ ] **Step 1: Add the table and the column to the schema**

In `src/main/db/schema.ts`, before the `sales` definition:

```ts
/**
 * Customer master. Walk-in trade is deliberately NOT a row here: a sale to UMUM carries
 * `customer_id = NULL`, which means the walk-in name cannot be renamed or deleted by
 * anyone editing this table.
 */
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nama: text('nama').notNull().unique(),
  telepon: text('telepon'),
  alamat: text('alamat'),
  keterangan: text('keterangan'),
  ...timestamps(),
})
```

Add to the `sales` table, after `namaPelanggan`:

```ts
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
```

Extend the comment on `namaPelanggan` to say why both exist:

```ts
  /**
   * The customer's name as it stood when the sale was made. Kept alongside `customerId`
   * on purpose: renaming someone in the master must not change what an already-printed
   * struk says, and every existing reader (struk, Riwayat, Dashboard, BonPayment) keeps
   * working untouched.
   */
  namaPelanggan: text('nama_pelanggan'),
```

- [ ] **Step 2: Generate the migration**

```bash
npm run db:generate
```

Note the tag (`0018_<random words>`).

- [ ] **Step 3: Append the backfill to the generated SQL**

Open the generated file and append:

```sql
--> statement-breakpoint
INSERT INTO customers (nama, telepon, alamat, keterangan, created_at, updated_at)
SELECT DISTINCT TRIM(nama_pelanggan), NULL, NULL, NULL, unixepoch(), unixepoch()
FROM sales
WHERE nama_pelanggan IS NOT NULL
  AND TRIM(nama_pelanggan) <> ''
  AND UPPER(TRIM(nama_pelanggan)) <> 'UMUM';
--> statement-breakpoint
UPDATE sales
SET customer_id = (SELECT id FROM customers WHERE customers.nama = TRIM(sales.nama_pelanggan))
WHERE nama_pelanggan IS NOT NULL
  AND TRIM(nama_pelanggan) <> ''
  AND UPPER(TRIM(nama_pelanggan)) <> 'UMUM';
```

`DISTINCT TRIM(...)` matters: two sales written as `Bu Sri` and `Bu Sri ` would otherwise violate the unique index.

- [ ] **Step 4: Write the failing migration test**

Add to `src/main/db/migrate.test.ts`, using the existing `partialMigrationsBefore` helper. Substitute the real tag from Step 2 for `0018_TAG`:

```ts
  it('backfills customers from past sale names and leaves UMUM unlinked', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0018_TAG')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO sales (id, nama_pelanggan, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (1, 'Bu Sri', 'bon', 'selesai', 100000, 0, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sales (id, nama_pelanggan, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (2, 'Bu Sri', 'tunai', 'selesai', 50000, 50000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sales (id, nama_pelanggan, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (3, 'UMUM', 'tunai', 'selesai', 25000, 25000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sales (id, nama_pelanggan, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (4, NULL, 'tunai', 'selesai', 10000, 10000, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const db = createDb(dbFile, migrationsFolder)

    const customerRows = db.all<{ id: number; nama: string }>(sql`SELECT id, nama FROM customers ORDER BY nama`)
    expect(customerRows.map((row) => row.nama)).toEqual(['Bu Sri'])

    const saleRows = db.all<{ id: number; customer_id: number | null }>(
      sql`SELECT id, customer_id FROM sales ORDER BY id`,
    )
    expect(saleRows[0].customer_id).toBe(customerRows[0].id)
    expect(saleRows[1].customer_id).toBe(customerRows[0].id)
    expect(saleRows[2].customer_id).toBeNull()
    expect(saleRows[3].customer_id).toBeNull()

    db.$client.close()
    cleanup()
  })
```

`db.$client.close()` before `cleanup()` is not optional — without it Windows throws `EPERM` on the directory removal.

- [ ] **Step 5: Update the table-count test**

Change `creates all 19 business tables` to `creates all 20 business tables` and add `'customers'` to the sorted array.

- [ ] **Step 6: Run the tests**

Run: `npm test -- migrate`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/db/schema.ts src/main/db/migrate.test.ts drizzle/
git commit -m "feat(db): add customers master and link sales to it

nama_pelanggan stays as the name snapshot the struk was printed with, so every
existing reader is untouched and renaming a customer cannot rewrite history.
Walk-in trade keeps customer_id NULL, which puts UMUM out of reach of the master."
```

---

### Task 8: Customer module and IPC

**Files:**
- Create: `desktop-node/src/main/customer.ts`
- Create: `desktop-node/src/main/ipc/customer.ts`
- Test: `desktop-node/src/main/customer.test.ts`
- Modify: `desktop-node/src/main/index.ts` (register the IPC module)
- Modify: `desktop-node/src/preload/index.ts`, `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: the `customers` table from Task 7.
- Produces:
  - `listCustomers(db, { search?: string; page: number; pageSize?: number }): { data: CustomerListItem[]; currentPage: number; lastPage: number; total: number }`
  - `listCustomerOptions(db): CustomerOption[]`
  - `createCustomer(db, input: CustomerInput): number`
  - `updateCustomer(db, id: number, input: CustomerInput): void`
  - `deleteCustomer(db, id: number): void`
  - `interface CustomerListItem { id: number; nama: string; telepon: string | null; alamat: string | null; keterangan: string | null; saleCount: number }`
  - `interface CustomerOption { id: number; nama: string; telepon: string | null }`
  - `interface CustomerInput { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null }`
  - IPC channels `customer:listCustomers`, `customer:listOptions`, `customer:createCustomer`, `customer:updateCustomer`, `customer:deleteCustomer`, reachable as `window.api.customer.*`.

- [ ] **Step 1: Write the failing test**

Create `desktop-node/src/main/customer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { customers, sales } from './db/schema'
import {
  listCustomers,
  listCustomerOptions,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from './customer'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(customers)
    .values([
      { id: 1, nama: 'Bu Sri', telepon: '08123456789', alamat: 'Jl. Melati 3', keterangan: null, createdAt: now, updatedAt: now },
      { id: 2, nama: 'Pak Budi', telepon: null, alamat: null, keterangan: 'Langganan rokok', createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(sales)
    .values({
      id: 1,
      customerId: 1,
      namaPelanggan: 'Bu Sri',
      metodePembayaran: 'bon',
      status: 'selesai',
      diskon: 0,
      total: 100000,
      dibayar: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
}

describe('listCustomers', () => {
  it('counts the sales filed under each customer', () => {
    const hasil = listCustomers(seedDb(), { page: 1 })

    expect(hasil.total).toBe(2)
    expect(hasil.data.find((row) => row.nama === 'Bu Sri')?.saleCount).toBe(1)
    expect(hasil.data.find((row) => row.nama === 'Pak Budi')?.saleCount).toBe(0)
  })

  it('filters by name', () => {
    expect(listCustomers(seedDb(), { search: 'budi', page: 1 }).data.map((row) => row.nama)).toEqual(['Pak Budi'])
  })
})

describe('listCustomerOptions', () => {
  it('returns every customer with their phone, sorted by name', () => {
    expect(listCustomerOptions(seedDb())).toEqual([
      { id: 1, nama: 'Bu Sri', telepon: '08123456789' },
      { id: 2, nama: 'Pak Budi', telepon: null },
    ])
  })
})

describe('createCustomer', () => {
  it('rejects an empty name', () => {
    expect(() =>
      createCustomer(seedDb(), { nama: '  ', telepon: null, alamat: null, keterangan: null }),
    ).toThrow('Nama wajib diisi.')
  })

  it('rejects a name that already exists, naming it', () => {
    expect(() =>
      createCustomer(seedDb(), { nama: 'Bu Sri', telepon: null, alamat: null, keterangan: null }),
    ).toThrow('Pelanggan "Bu Sri" sudah ada.')
  })

  it('returns the new id', () => {
    const db = seedDb()
    const id = createCustomer(db, { nama: 'Bu Tini', telepon: '0812', alamat: null, keterangan: null })

    expect(db.select().from(customers).where(eq(customers.id, id)).get()?.nama).toBe('Bu Tini')
  })
})

describe('updateCustomer', () => {
  it('rejects renaming onto another customer', () => {
    expect(() =>
      updateCustomer(seedDb(), 2, { nama: 'Bu Sri', telepon: null, alamat: null, keterangan: null }),
    ).toThrow('Pelanggan "Bu Sri" sudah ada.')
  })

  it('allows saving a customer under its own unchanged name', () => {
    const db = seedDb()

    expect(() =>
      updateCustomer(db, 1, { nama: 'Bu Sri', telepon: '0899', alamat: null, keterangan: null }),
    ).not.toThrow()
    expect(db.select().from(customers).where(eq(customers.id, 1)).get()?.telepon).toBe('0899')
  })
})

describe('deleteCustomer', () => {
  it('refuses to delete a customer that has any transaction', () => {
    expect(() => deleteCustomer(seedDb(), 1)).toThrow(
      'Pelanggan "Bu Sri" punya 1 transaksi dan tidak bisa dihapus.',
    )
  })

  it('deletes a customer with no transactions', () => {
    const db = seedDb()
    deleteCustomer(db, 2)

    expect(db.select().from(customers).where(eq(customers.id, 2)).get()).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- customer`
Expected: FAIL with a module-not-found error for `./customer`.

- [ ] **Step 3: Write the module**

Create `desktop-node/src/main/customer.ts`:

```ts
import { and, eq, like, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { customers } from './db/schema'

export interface CustomerListItem {
  id: number
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
  saleCount: number
}

export interface CustomerOption {
  id: number
  nama: string
  telepon: string | null
}

export interface CustomerInput {
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

function countSales(db: BetterSQLite3Database<typeof schema>, id: number): number {
  const row = db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM sales WHERE customer_id = ${id}`)

  return row?.count ?? 0
}

export function listCustomers(
  db: BetterSQLite3Database<typeof schema>,
  input: { search?: string; page: number; pageSize?: number },
): { data: CustomerListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)
  const whereClause = input.search ? like(customers.nama, `%${input.search}%`) : undefined

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(customers).where(whereClause).get()
  const total = totalRow?.count ?? 0

  const rows = db
    .select({
      id: customers.id,
      nama: customers.nama,
      telepon: customers.telepon,
      alamat: customers.alamat,
      keterangan: customers.keterangan,
      // Raw SQL identifiers, deliberately - see the long note in supplier.ts. This query is
      // join-less, so `${customers.id}` would interpolate as a bare "id" that SQLite resolves
      // against the subquery's own FROM table (sales), silently counting nothing sensible.
      saleCount: sql<number>`(SELECT COUNT(*) FROM sales WHERE sales.customer_id = customers.id)`,
    })
    .from(customers)
    .where(whereClause)
    .orderBy(customers.nama)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { data: rows, currentPage: page, lastPage: Math.max(1, Math.ceil(total / pageSize)), total }
}

/** the flat list the cashier's customer picker searches - no paging, names only */
export function listCustomerOptions(db: BetterSQLite3Database<typeof schema>): CustomerOption[] {
  return db
    .select({ id: customers.id, nama: customers.nama, telepon: customers.telepon })
    .from(customers)
    .orderBy(customers.nama)
    .all()
}

function validateCustomerInput(input: CustomerInput): void {
  if (!input.nama.trim()) {
    throw new Error('Nama wajib diisi.')
  }

  if (input.nama.length > 255) {
    throw new Error('Nama maksimal 255 karakter.')
  }
}

/**
 * Rejects a duplicate name by hand rather than letting the unique index raise, so the
 * cashier reads which name collided instead of a SQLite constraint string.
 */
function assertNamaBelumDipakai(
  db: BetterSQLite3Database<typeof schema>,
  nama: string,
  exceptId: number | null,
): void {
  const clash = db
    .select({ id: customers.id })
    .from(customers)
    .where(exceptId === null ? eq(customers.nama, nama) : and(eq(customers.nama, nama), ne(customers.id, exceptId)))
    .get()

  if (clash) {
    throw new Error(`Pelanggan "${nama}" sudah ada.`)
  }
}

export function createCustomer(db: BetterSQLite3Database<typeof schema>, input: CustomerInput): number {
  validateCustomerInput(input)

  const nama = input.nama.trim()
  assertNamaBelumDipakai(db, nama, null)

  const now = new Date()
  const created = db
    .insert(customers)
    .values({
      nama,
      telepon: input.telepon,
      alamat: input.alamat,
      keterangan: input.keterangan,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  return created.id
}

export function updateCustomer(
  db: BetterSQLite3Database<typeof schema>,
  id: number,
  input: CustomerInput,
): void {
  validateCustomerInput(input)

  const nama = input.nama.trim()
  assertNamaBelumDipakai(db, nama, id)

  db.update(customers)
    .set({ nama, telepon: input.telepon, alamat: input.alamat, keterangan: input.keterangan, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .run()
}

/**
 * Once a customer has been used on a sale they can only be edited, never deleted. The
 * foreign key is `restrict` as a second line of defence, but the count is done here so the
 * cashier gets a sentence instead of a constraint error.
 */
export function deleteCustomer(db: BetterSQLite3Database<typeof schema>, id: number): void {
  const customer = db.select().from(customers).where(eq(customers.id, id)).get()

  if (!customer) {
    throw new Error('Pelanggan tidak ditemukan.')
  }

  const saleCount = countSales(db, id)

  if (saleCount > 0) {
    throw new Error(`Pelanggan "${customer.nama}" punya ${saleCount} transaksi dan tidak bisa dihapus.`)
  }

  db.delete(customers).where(eq(customers.id, id)).run()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- customer`
Expected: PASS.

- [ ] **Step 5: Register the IPC handlers**

Create `desktop-node/src/main/ipc/customer.ts`:

```ts
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import {
  listCustomers,
  listCustomerOptions,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type CustomerInput,
} from '../customer'
import { requireAdmin, requireUser } from './auth'

export function registerCustomerIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('customer:listCustomers', (_event, input: { search?: string; page: number; pageSize?: number }) => {
    requireUser()

    return listCustomers(db, input)
  })

  ipcMain.handle('customer:listOptions', () => {
    requireUser()

    return listCustomerOptions(db)
  })

  ipcMain.handle('customer:createCustomer', (_event, input: CustomerInput) => {
    requireUser()

    return createCustomer(db, input)
  })

  ipcMain.handle('customer:updateCustomer', (_event, id: number, input: CustomerInput) => {
    requireUser()

    updateCustomer(db, id, input)
  })

  ipcMain.handle('customer:deleteCustomer', (_event, id: number) => {
    requireAdmin()

    deleteCustomer(db, id)
  })
}
```

In `src/main/index.ts`, import `registerCustomerIpc` and call it beside `registerSupplierIpc`, passing the same `db`.

- [ ] **Step 6: Expose it through preload and env.d.ts**

In `src/preload/index.ts`, add a `customer` group beside the existing `supplier` group, following that group's exact `ipcRenderer.invoke` style:

```ts
    customer: {
      listCustomers: (input: { search?: string; page: number; pageSize?: number }) =>
        ipcRenderer.invoke('customer:listCustomers', input),
      listOptions: () => ipcRenderer.invoke('customer:listOptions'),
      createCustomer: (input: CustomerInput) => ipcRenderer.invoke('customer:createCustomer', input),
      updateCustomer: (id: number, input: CustomerInput) => ipcRenderer.invoke('customer:updateCustomer', id, input),
      deleteCustomer: (id: number) => ipcRenderer.invoke('customer:deleteCustomer', id),
    },
```

Declare the matching types in `src/renderer/env.d.ts`, mirroring the `supplier` block:

```ts
        customer: {
          listCustomers: (input: { search?: string; page: number; pageSize?: number }) => Promise<{
            data: {
              id: number
              nama: string
              telepon: string | null
              alamat: string | null
              keterangan: string | null
              saleCount: number
            }[]
            currentPage: number
            lastPage: number
            total: number
          }>
          listOptions: () => Promise<{ id: number; nama: string; telepon: string | null }[]>
          createCustomer: (input: {
            nama: string
            telepon: string | null
            alamat: string | null
            keterangan: string | null
          }) => Promise<number>
          updateCustomer: (
            id: number,
            input: { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null },
          ) => Promise<void>
          deleteCustomer: (id: number) => Promise<void>
        }
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run build`
Expected: PASS and a clean build.

- [ ] **Step 8: Commit**

```bash
git add src/main/customer.ts src/main/customer.test.ts src/main/ipc/customer.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(pelanggan): add the customer module and its IPC surface

Deleting a customer that has any transaction is refused in the main process with a
sentence naming the count, with the restrict foreign key behind it as a backstop."
```

---

### Task 9: Pelanggan page, route, and menu entry

**Files:**
- Create: `desktop-node/src/renderer/pages/Pelanggan.tsx`
- Modify: `desktop-node/src/renderer/App.tsx:38-55`
- Modify: `desktop-node/src/renderer/components/app-sidebar.tsx:26-28`

**Interfaces:**
- Consumes: `window.api.customer.*` from Task 8.
- Produces: route `/pelanggan` and the exported component `Pelanggan`.

- [ ] **Step 1: Build the page from the Supplier pattern**

Read `src/renderer/pages/Supplier.tsx` end to end first, then create `src/renderer/pages/Pelanggan.tsx` as the same page with these differences and nothing else:

- `SupplierRow` / `DraftRow` become `CustomerRow` / `DraftRow` with `saleCount` in place of `purchaseCount`.
- `BREADCRUMBS` is `[{ title: 'Pelanggan', href: '/pelanggan' }]`.
- The heading and empty-state copy say Pelanggan instead of Supplier.
- Every `window.api.supplier.*` call becomes the `window.api.customer.*` equivalent.
- The grid's last column header reads `Transaksi` and renders `saleCount`.
- The delete confirmation reads:
  `Hapus pelanggan "<nama>"? Pelanggan yang sudah punya transaksi tidak bisa dihapus.`
- The component is exported as `export function Pelanggan()`.

Do not invent new layout, new hooks, or a new grid configuration. If `Supplier.tsx` does something that looks odd, copy it — matching the sibling page is the point.

- [ ] **Step 2: Register the route**

In `src/renderer/App.tsx`, import `Pelanggan` alongside the other page imports and add the route next to `/supplier`:

```tsx
        <Route path="/pelanggan" element={<Pelanggan />} />
```

- [ ] **Step 3: Add the menu entry**

In `src/renderer/components/app-sidebar.tsx`, add to the nav group that already holds Penjualan and Riwayat Transaksi, reusing an icon already imported from `lucide-react` where possible — `Users` or `Contact`:

```ts
  { title: 'Pelanggan', href: '/pelanggan', icon: Users },
```

Add the icon to the existing `lucide-react` import if it is not already there.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: clean build.

Then `npm run dev`: open Pelanggan from the sidebar, add a customer, edit their phone in the grid, and try to delete a customer that has a transaction — the error must name the count.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/Pelanggan.tsx src/renderer/App.tsx src/renderer/components/app-sidebar.tsx
git commit -m "feat(pelanggan): add the Pelanggan master page

Same editable-grid pattern as Supplier, with a transaction count and a delete that
is refused once the customer has been used on a sale."
```

---

### Task 10: Link the till to the customer master

**Files:**
- Modify: `desktop-node/src/renderer/pages/kasir/CustomerPicker.tsx`
- Modify: `desktop-node/src/renderer/pages/Kasir.tsx:42-160,215-262,476-569,849-880`
- Modify: `desktop-node/src/main/kasir.ts:125-136,187-197,278-330,437-447,580-591`
- Modify: `desktop-node/src/main/ipc/kasir.ts`
- Modify: `desktop-node/src/preload/index.ts`, `desktop-node/src/renderer/env.d.ts`
- Test: `desktop-node/src/main/kasir.test.ts`

**Interfaces:**
- Consumes: `listCustomerOptions` and `createCustomer` from Task 8; the `customers` table and `sales.customerId` from Task 7.
- Produces: `CheckoutInput.customerId: number | null` and `UpdateSaleInput.customerId: number | null`; `CustomerPickerProps.onSelect(customer: { id: number | null; nama: string })`.

- [ ] **Step 1: Write the failing test**

Add to `src/main/kasir.test.ts`:

```ts
describe('checkout customerId', () => {
  it('stores both the link and the name snapshot', () => {
    const db = seedCheckoutDb()
    const customerId = createCustomer(db, { nama: 'Bu Sri', telepon: null, alamat: null, keterangan: null })

    const { saleId } = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Sri',
      customerId,
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    expect(sale?.customerId).toBe(customerId)
    expect(sale?.namaPelanggan).toBe('Bu Sri')
  })

  it('leaves walk-in trade unlinked', () => {
    const db = seedCheckoutDb()

    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: 'UMUM',
      customerId: null,
      dibayar: 500000,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    expect(sale?.customerId).toBeNull()
    expect(sale?.namaPelanggan).toBe('UMUM')
  })
})
```

Reuse whatever seed helper the existing `describe('checkout')` block uses; `seedCheckoutDb` above is a stand-in for that helper's real name. Import `createCustomer` from `./customer`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- kasir`
Expected: FAIL — `customerId` is not a property of `CheckoutInput`.

- [ ] **Step 3: Thread customerId through the main process**

In `src/main/kasir.ts`:

Delete the whole `listCustomers` function (lines 125-136). It read distinct names off past sales, and the master replaces it.

Add to `CheckoutInput`, after `namaPelanggan`:

```ts
  /** the master row this sale belongs to; null for walk-in trade */
  customerId: number | null
```

Add the identical field to `UpdateSaleInput`.

In `checkout`, add `customerId: input.customerId` to the `tx.insert(sales).values({...})` call. In `updateSale`, add `customerId: input.customerId` to the `tx.update(sales).set({...})` call at line 580.

- [ ] **Step 4: Update the IPC layer**

In `src/main/ipc/kasir.ts`:

- Delete the `kasir:listCustomers` handler and drop `listCustomers` from the `../kasir` import.
- Add `customerId: number | null` to the `kasir:checkout` and `kasir:updateSale` input types, and forward it in both calls.
- In the `kasir:getSaleForEdit` handler, add `customerId: sale.customerId` to the returned object so the edit screen can restore the link.

Mirror all three changes in `src/preload/index.ts` and `src/renderer/env.d.ts`, and remove `listCustomers` from both.

- [ ] **Step 5: Make the picker read the master**

Replace `src/renderer/pages/kasir/CustomerPicker.tsx`. Keep the dialog, the footer hints, and the "type a new name and press Enter" behaviour; change where the list comes from and what `onSelect` hands back:

```tsx
import { useState } from 'react'
import { Check, UserPlus } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/** walk-in customer - every sale starts filed under this name, and it is never a master row */
export const DEFAULT_PELANGGAN = 'UMUM'

export interface CustomerOption {
  id: number
  nama: string
  telepon: string | null
}

export interface CustomerPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** the name currently attached to the sale */
  value: string
  /** rows from the customer master */
  customers: CustomerOption[]
  /** id is null only for the walk-in name, which has no master row */
  onSelect: (customer: { id: number | null; nama: string }) => void
  /** creates a master row for a name that was typed here, and resolves to its id */
  onCreate: (nama: string) => Promise<number>
}

export function CustomerPicker({ open, onOpenChange, value, customers, onSelect, onCreate }: CustomerPickerProps) {
  const [query, setQuery] = useState('')
  const [prevOpen, setPrevOpen] = useState(open)
  const [saving, setSaving] = useState(false)

  if (open !== prevOpen) {
    setPrevOpen(open)

    if (open) {
      setQuery('')
    }
  }

  const typed = query.trim()
  const results = customers.filter((customer) => customer.nama.toLowerCase().includes(typed.toLowerCase()))
  const matchesWalkIn = DEFAULT_PELANGGAN.toLowerCase().includes(typed.toLowerCase())
  // A name nobody has used yet is typed here and becomes a master row, so the picker still
  // doubles as "tambah baru" - the cashier never has to leave the till to file a new customer.
  const isNew =
    typed !== '' &&
    typed.toUpperCase() !== DEFAULT_PELANGGAN &&
    !customers.some((customer) => customer.nama.toLowerCase() === typed.toLowerCase())

  function pick(customer: { id: number | null; nama: string }) {
    onSelect(customer)
    onOpenChange(false)
  }

  async function pickNew(nama: string) {
    if (saving) {
      return
    }

    setSaving(true)

    try {
      pick({ id: await onCreate(nama), nama })
    } finally {
      setSaving(false)
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pelanggan"
      description="Pilih pelanggan atau ketik nama baru"
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isNew && results.length === 0) {
            e.preventDefault()
            void pickNew(typed)
          }
        }}
        placeholder="Cari atau ketik nama pelanggan baru..."
      />
      <CommandList>
        <CommandEmpty>Ketik nama untuk menambah pelanggan baru.</CommandEmpty>
        {isNew && (
          <CommandGroup heading="Baru">
            <CommandItem value={`__new__${typed}`} onSelect={() => void pickNew(typed)}>
              <UserPlus className="size-4" />
              Tambah &ldquo;{typed}&rdquo;
            </CommandItem>
          </CommandGroup>
        )}
        {matchesWalkIn && (
          <CommandGroup heading="Umum">
            <CommandItem value={DEFAULT_PELANGGAN} onSelect={() => pick({ id: null, nama: DEFAULT_PELANGGAN })}>
              <Check className={value === DEFAULT_PELANGGAN ? 'size-4' : 'size-4 opacity-0'} />
              {DEFAULT_PELANGGAN}
            </CommandItem>
          </CommandGroup>
        )}
        {results.length > 0 && (
          <CommandGroup heading="Pelanggan">
            {results.map((customer) => (
              <CommandItem
                key={customer.id}
                value={String(customer.id)}
                onSelect={() => pick({ id: customer.id, nama: customer.nama })}
              >
                <Check className={customer.nama === value ? 'size-4' : 'size-4 opacity-0'} />
                <span className="flex-1">{customer.nama}</span>
                {customer.telepon && <span className="text-xs text-muted-foreground">{customer.telepon}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">&uarr;&darr;</kbd>
          pilih
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">&crarr;</kbd>
          pakai
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">esc</kbd>
          tutup
        </span>
      </div>
    </CommandDialog>
  )
}
```

- [ ] **Step 6: Carry customerId through Kasir.tsx**

Add `customerId: number | null` to the `KasirDraft` interface and set it to `null` in `EMPTY_DRAFT`. In `readStoredDraft`, parse it the way the other fields are parsed:

```ts
      customerId: typeof parsed.customerId === 'number' ? parsed.customerId : null,
```

Add the state beside `namaPelanggan`:

```ts
  const [customerId, setCustomerId] = useState<number | null>(initialDraft.customerId)
```

Change `customers` state to `useState<CustomerOption[]>([])` and point `refreshCustomers` at the new channel:

```ts
  function refreshCustomers() {
    window.api.customer
      .listOptions()
      .then(setCustomers)
      .catch(() => setError('Gagal memuat data.'))
  }
```

Delete the `customerOptions` memo at line 276 — the master already includes everyone, and the walk-in entry is rendered by the picker itself.

Add `customerId` to the draft object written in the persistence effect and to that effect's dependency array.

In the sale-loading effect, restore the link and fall back safely:

```ts
        setNamaPelanggan(sale.namaPelanggan ?? DEFAULT_PELANGGAN)
        setCustomerId(sale.customerId)
```

After the catalog and customer list have both loaded, drop a stale draft link. Add this effect below `refreshCustomers`:

```ts
  // A draft can outlive the customer it names - the master row may have been deleted while
  // the cart sat there. The cart is not money yet, so falling back to the walk-in name and
  // making the cashier pick again is enough.
  useEffect(() => {
    if (customerId === null || customers.length === 0) {
      return
    }

    if (!customers.some((customer) => customer.id === customerId)) {
      setCustomerId(null)
      setNamaPelanggan(DEFAULT_PELANGGAN)
    }
  }, [customers, customerId])
```

Send `customerId` in both `handleCheckout` and `handleSaveEdit`, next to `namaPelanggan`:

```ts
        customerId,
```

Reset it in `resetAfterCheckout`:

```ts
    setCustomerId(null)
```

Update the picker's call site:

```tsx
      <CustomerPicker
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        value={namaPelanggan.trim() || DEFAULT_PELANGGAN}
        customers={customers}
        onSelect={(customer) => {
          setCustomerId(customer.id)
          setNamaPelanggan(customer.nama)
        }}
        onCreate={async (nama) => {
          const id = await window.api.customer.createCustomer({
            nama,
            telepon: null,
            alamat: null,
            keterangan: null,
          })
          refreshCustomers()

          return id
        }}
      />
```

Import `type CustomerOption` from `./kasir/CustomerPicker`.

- [ ] **Step 7: Run the tests**

Run: `npm test && npm run build`
Expected: PASS and a clean build.

- [ ] **Step 8: Check it by hand**

`npm run dev`, then:
1. `Alt+P` shows the master list with phone numbers, plus UMUM.
2. Typing a brand new name and pressing `Enter` files them and attaches them to the sale in one step; the name then appears on the Pelanggan page.
3. A bon to that customer saves, and the Pelanggan page shows their transaction count as 1.
4. Deleting that customer from the Pelanggan page is refused.
5. A walk-in cash sale still saves with the name UMUM.

- [ ] **Step 9: Commit**

```bash
git add src/main/kasir.ts src/main/ipc/kasir.ts src/main/kasir.test.ts src/renderer/pages/Kasir.tsx src/renderer/pages/kasir/CustomerPicker.tsx src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(kasir): file sales against the customer master

The picker reads the master instead of scraping names off past sales, and a name
typed at the till still becomes a customer in one keystroke. Sales store both the
link and the name snapshot; walk-in trade stays unlinked."
```

---

## Self-Review Notes

Checked against the spec, section by section:

- Spec §1 (log edit) → Tasks 5 and 6. Cancellation is explicitly out of scope in both.
- Spec §2 (master pelanggan) → Tasks 7, 8, 9, 10, including the UMUM-stays-NULL rule, the delete guard, and the draft `customerId` fallback.
- Spec §3 (print instan) → Task 1, with the koffi load verified before any code is written.
- Spec §4 (pintasan) → Tasks 2 and 3, including the scanner path being left alone.
- Spec §5 (konfirmasi cetak) → Task 4.

Names used consistently across tasks: `resolveShortcut`, `KasirShortcutState`, `listCustomerOptions`, `CustomerOption`, `CustomerInput`, `saleEdits`, `customerId`, `keterangan`.

Two migrations are generated in this plan (Task 5 and Task 7). Their tags are assigned by `drizzle-kit` at generation time, so both tasks record the real tag before writing the test that references it.
