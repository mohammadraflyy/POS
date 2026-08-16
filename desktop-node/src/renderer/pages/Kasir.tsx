import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellKeyboardEvent, CellKeyDownArgs, DataGridHandle, RowsChangeData } from 'react-data-grid'
import { ShoppingCart, Trash2, UserRound } from 'lucide-react'
import { Page, PageHeader } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppearance } from '@/hooks/use-appearance'
import { useConfirm } from '@/hooks/use-confirm'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
import { CartGrid } from './kasir/CartGrid'
import { PaymentDialog } from './kasir/PaymentDialog'
import { CommandPalette } from './kasir/CommandPalette'
import { CustomerPicker, DEFAULT_PELANGGAN } from './kasir/CustomerPicker'
import {
  addLine,
  applyHarga,
  applyQty,
  changeUnit,
  expandUnitResults,
  restoreCart,
  toStoredCart,
  unitPrice,
  type CartLine,
  type Product,
  type StoredCartLine,
  type UnitResult,
} from './kasir/cart-logic'

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Penjualan', href: '/kasir' }]

const DRAFT_STORAGE_KEY = 'kasir:draft'

/** the whole in-progress sale, kept across navigation and app restarts */
interface KasirDraft {
  cart: StoredCartLine[]
  metode: 'tunai' | 'bon' | 'qris' | 'transfer'
  namaPelanggan: string
  dibayar: string
  jumlah: string
}

const EMPTY_DRAFT: KasirDraft = {
  cart: [],
  metode: 'tunai',
  namaPelanggan: DEFAULT_PELANGGAN,
  dibayar: '',
  jumlah: '1.00',
}

/** current local time in the `YYYY-MM-DDTHH:mm` shape a datetime-local input wants */
function nowForInput(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function readStoredDraft(): KasirDraft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)

    if (!raw) {
      return EMPTY_DRAFT
    }

    const parsed = JSON.parse(raw) as Partial<KasirDraft>

    return {
      cart: Array.isArray(parsed.cart) ? parsed.cart : [],
      metode: parsed.metode === 'bon' ? 'bon' : 'tunai',
      namaPelanggan: typeof parsed.namaPelanggan === 'string' ? parsed.namaPelanggan : DEFAULT_PELANGGAN,
      dibayar: typeof parsed.dibayar === 'string' ? parsed.dibayar : '',
      jumlah: typeof parsed.jumlah === 'string' ? parsed.jumlah : EMPTY_DRAFT.jumlah,
    }
  } catch {
    return EMPTY_DRAFT
  }
}

export function Kasir() {
  // read once, before any effect can overwrite the stored draft
  const [initialDraft] = useState(readStoredDraft)
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<string[]>([])
  const [customerOpen, setCustomerOpen] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [scanError, setScanError] = useState('')
  const [metode, setMetode] = useState<'tunai' | 'bon' | 'qris' | 'transfer'>(initialDraft.metode)
  const [namaPelanggan, setNamaPelanggan] = useState(initialDraft.namaPelanggan)
  const [dibayar, setDibayar] = useState(initialDraft.dibayar)
  const [tanggal, setTanggal] = useState(nowForInput())
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [jumlah, setJumlah] = useState(initialDraft.jumlah)
  const { resolvedAppearance } = useAppearance()
  const { confirm, ConfirmDialog } = useConfirm()
  const [cartWidthRef, cartGridWidth] = useElementWidth<HTMLDivElement>()
  const cartGridRef = useRef<DataGridHandle>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // the cart can only be rebuilt once the catalog is loaded, so it waits here
  // while the rest of the draft is restored straight into state above
  const pendingRestoreRef = useRef<StoredCartLine[]>(initialDraft.cart)

  useEffect(() => {
    refreshProducts()
    refreshCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // tanggal is seeded once at mount, so without this a sale would carry
  // whatever time the page happened to load (or the previous checkout) -
  // refresh it every time the payment dialog opens so it reflects now
  useEffect(() => {
    if (paymentOpen) {
      setTanggal(nowForInput())
    }
  }, [paymentOpen])

  useEffect(() => {
    const draft: KasirDraft = { cart: toStoredCart(cart), metode, namaPelanggan, dibayar, jumlah }

    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  }, [cart, metode, namaPelanggan, dibayar, jumlah])

  function refreshProducts() {
    window.api.kasir
      .listProducts()
      .then((list) => {
        setProducts(list)

        if (pendingRestoreRef.current.length > 0) {
          setCart(restoreCart(pendingRestoreRef.current, list))
          pendingRestoreRef.current = []
        }
      })
      .catch(() => setError('Gagal memuat data.'))
  }

  function refreshCustomers() {
    window.api.kasir
      .listCustomers()
      .then(setCustomers)
      .catch(() => setError('Gagal memuat data.'))
  }

  const total = useMemo(() => cart.reduce((sum, line) => sum + line.qty * unitPrice(line), 0), [cart])
  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + line.qty, 0), [cart])

  // the walk-in name is always offered, even on a fresh database where no sale
  // has ever carried it; so is a name picked but not yet checked out
  const customerOptions = useMemo(() => {
    const names = [DEFAULT_PELANGGAN, namaPelanggan.trim(), ...customers].filter((nama) => nama !== '')

    return [...new Set(names)]
  }, [customers, namaPelanggan])

  const paletteResults = useMemo(() => expandUnitResults(products, paletteQuery, 50), [products, paletteQuery])

  function addProductToCart(product: Product, qty = 1, productUnitId: number | null = null) {
    setCart((prev) => addLine(prev, product, qty, productUnitId))
  }

  function changeLineUnit(line: CartLine, productUnitId: number | null) {
    setCart((prev) => changeUnit(prev, line, productUnitId))
  }

  // Hardware scanners type a barcode + Enter almost instantly (unlike a
  // human). We buffer keystrokes globally and treat a fast burst ending in
  // Enter as a scan - only while no input/textarea is focused, so it never
  // fights with normal typing in the search box, payment fields, etc.
  const scanBuffer = useRef('')
  const scanLastKeyAt = useRef(0)

  useEffect(() => {
    function isEditableFocused() {
      const el = document.activeElement

      return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }

    function handleKeydown(e: globalThis.KeyboardEvent) {
      if (isEditableFocused()) {
        return
      }

      if (e.key === '/' && scanBuffer.current === '') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()

        return
      }

      if (e.altKey && e.key.toLowerCase() === 'k' && !paymentOpen) {
        e.preventDefault()
        clearCart()

        return
      }

      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setCustomerOpen(true)

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
          // Not a fast scan burst - treat a lone Enter as the "Bayar"
          // shortcut so checkout can be fully keyboard driven. Only when
          // nothing else is focused, so it doesn't double-fire alongside a
          // button's own native Enter-activates click.
          if (
            cart.length > 0 &&
            !paymentOpen &&
            (document.activeElement === document.body || document.activeElement === null)
          ) {
            e.preventDefault()
            setPaymentOpen(true)
          }

          return
        }

        e.preventDefault()
        const product = products.find((p) => p.barcode === code)

        if (!product) {
          setScanError(`Barcode "${code}" tidak ditemukan.`)
        } else {
          setScanError('')
          addProductToCart(product)
        }

        return
      }

      if (e.key.length === 1) {
        scanBuffer.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeydown)

    return () => window.removeEventListener('keydown', handleKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, cart.length, paymentOpen])

  function applyResolvedQty(key: string, rawQty: number) {
    setCart((prev) => applyQty(prev, key, rawQty))
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((i) => i.key !== key))
  }

  async function clearCart() {
    if (cart.length === 0) {
      return
    }

    const confirmed = await confirm({
      title: 'Kosongkan keranjang?',
      description: `${cart.length} baris di keranjang akan dibuang.`,
      confirmLabel: 'Kosongkan',
      destructive: true,
    })

    if (confirmed) {
      setCart([])
    }
  }

  function handleCartRowsChange(newRows: CartLine[], { indexes, column }: RowsChangeData<CartLine>) {
    const editedRow = newRows[indexes[0]]

    if (column.key === 'harga') {
      setCart((prev) => applyHarga(prev, editedRow.key, editedRow.hargaOverride ?? 0))

      return
    }

    applyResolvedQty(editedRow.key, editedRow.qty)
  }

  // A cell being selected (not yet in edit mode) still counts as "nothing
  // to type" - Enter there should behave like the global lone-Enter
  // shortcut and jump to Bayar, not start editing the cell.
  function handleCartCellKeyDown(args: CellKeyDownArgs<CartLine>, event: CellKeyboardEvent) {
    if (args.mode !== 'ACTIVE') {
      return
    }

    if (event.key === 'Enter' && cart.length > 0 && !paymentOpen) {
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

  function resetAfterCheckout() {
    setPaymentOpen(false)
    setCart([])
    setNamaPelanggan(DEFAULT_PELANGGAN)
    setDibayar('')
    setTanggal(nowForInput())
  }

  async function handleCheckout(shouldPrint: boolean) {
    setProcessing(true)
    setCheckoutError(null)
    setMessage(null)

    try {
      const sale = await window.api.kasir.checkout({
        metodePembayaran: metode,
        // tunai falls back to the walk-in name so the struk is never nameless;
        // bon must not, or an unnamed debt would silently be filed under it and
        // the main process could never reject it
        namaPelanggan: metode === 'bon' ? namaPelanggan.trim() || null : namaPelanggan.trim() || DEFAULT_PELANGGAN,
        dibayar: metode === 'tunai' ? Number(dibayar || 0) : null,
        tanggal,
        items: cart.map((line) => ({
          productId: line.product.id,
          productUnitId: line.productUnitId,
          qty: line.qty,
        })),
      })

      if (shouldPrint) {
        // The sale is already committed. Printing reaches hardware and can stall,
        // so it runs in the background rather than holding the till hostage - a
        // failure surfaces as an error naming the sale, which can be reprinted
        // from Riwayat.
        window.api.kasir.printReceipt(sale.saleId).catch((err) => {
          const reason = err instanceof Error ? err.message : 'kesalahan tidak diketahui'
          setError(`Transaksi #${sale.saleId} tersimpan, tetapi struk gagal dicetak: ${reason}. Cetak ulang dari Riwayat.`)
        })
      }

      setMessage('Transaksi disimpan.')
      setCheckoutError(null)
      resetAfterCheckout()
      refreshProducts()
      refreshCustomers()
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Gagal checkout')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <>
      <AppShell breadcrumbs={BREADCRUMBS}>
      <Page className="print:hidden">
      <PageHeader
        title="Penjualan"
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <label htmlFor="kasir-jumlah" className="text-xs text-muted-foreground">
                Jumlah
              </label>
              <Input
                id="kasir-jumlah"
                type="text"
                inputMode="decimal"
                value={jumlah}
                onChange={(e) => setJumlah(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    setPaletteOpen(true)
                  }
                }}
                className="w-16 text-center tabular-nums"
              />
            </div>
            <div className="relative w-72">
              <Input
                ref={searchInputRef}
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') {
                    return
                  }

                  e.preventDefault()
                  const code = paletteQuery.trim()
                  // A scanner types the barcode then Enter. Resolving it here means a
                  // scan never has to travel through the palette at all, and repeated
                  // scans work without touching the mouse.
                  const scanned = code === '' ? undefined : products.find((p) => p.barcode === code)

                  if (scanned) {
                    addProductToCart(scanned, Number(jumlah) || 1)
                    setPaletteQuery('')
                    setJumlah('1.00')
                    setScanError('')

                    return
                  }

                  setPaletteOpen(true)
                }}
                placeholder="Cari nama / kode produk..."
                className="pr-8"
              />
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                /
              </kbd>
            </div>
          </>
        }
      />

      {scanError && (
        <p role="alert" className="text-sm text-destructive">
          {scanError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="grid flex-1 items-start gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setCustomerOpen(true)}
              className="flex items-center justify-between gap-2 rounded-xl border p-4 text-left hover:bg-muted/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <UserRound className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">Pelanggan</span>
                  <span className="block truncate font-medium">{namaPelanggan.trim() || DEFAULT_PELANGGAN}</span>
                </span>
              </span>
              <kbd className="shrink-0 rounded border px-1.5 py-0.5 text-xs text-muted-foreground">Alt+P</kbd>
            </button>

            <div className="rounded-xl border p-5">
              <span className="text-sm text-muted-foreground">Total</span>
              <p className="mt-1 text-3xl font-bold tabular-nums">{formatRupiah(total)}</p>
              <Button
                type="button"
                size="lg"
                className="mt-4 h-14 w-full text-lg"
                disabled={cart.length === 0}
                onClick={() => setPaymentOpen(true)}
              >
                Bayar
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShoppingCart className="size-4" />
              Keranjang
              {cartItemCount > 0 && <Badge variant="secondary">{cartItemCount}</Badge>}
            </h2>
            {cart.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={clearCart}
              >
                <Trash2 className="size-3.5" />
                Kosongkan
                <kbd className="ml-1 rounded border px-1.5 py-0.5 text-xs">Alt+K</kbd>
              </Button>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
                <ShoppingCart className="size-8 opacity-40" />
                Keranjang kosong. Scan barcode atau cari produk untuk mulai.
              </div>
            ) : (
              <div ref={cartWidthRef}>
                {cartGridWidth > 0 && (
                  <CartGrid
                    cart={cart}
                    width={cartGridWidth}
                    resolvedAppearance={resolvedAppearance}
                    editMode={false}
                    gridRef={cartGridRef}
                    onRowsChange={handleCartRowsChange}
                    onCellKeyDown={handleCartCellKeyDown}
                    onChangeUnit={changeLineUnit}
                    onRemoveLine={removeFromCart}
                  />
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">/</kbd>
              Cari Produk
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">Enter</kbd>
              Bayar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">Alt+K</kbd>
              Kosongkan
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">F2</kbd>
              Edit Qty / Satuan
            </span>
          </div>
        </div>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={total}
        metode={metode}
        setMetode={setMetode}
        namaPelanggan={namaPelanggan}
        onEditCustomer={() => {
          setPaymentOpen(false)
          setCustomerOpen(true)
        }}
        dibayar={dibayar}
        setDibayar={setDibayar}
        tanggal={tanggal}
        setTanggal={setTanggal}
        processing={processing}
        error={checkoutError}
        onSubmit={handleCheckout}
      />

      <CustomerPicker
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        value={namaPelanggan.trim() || DEFAULT_PELANGGAN}
        customers={customerOptions}
        onSelect={setNamaPelanggan}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        results={paletteResults}
        products={products}
        jumlah={jumlah}
        onSelect={(result: UnitResult) => {
          addProductToCart(result.product, Number(jumlah) || 1, result.productUnitId)
          setPaletteQuery('')
          setJumlah('1.00')
          setPaletteOpen(false)
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        }}
      />

      </Page>
      </AppShell>
      {ConfirmDialog}
    </>
  )
}
