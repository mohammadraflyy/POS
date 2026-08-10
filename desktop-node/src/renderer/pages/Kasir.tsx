import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellKeyboardEvent, CellKeyDownArgs, DataGridHandle, RowsChangeData } from 'react-data-grid'
import { ShoppingCart, Trash2 } from 'lucide-react'
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
import {
  addLine,
  applyQty,
  changeUnit,
  restoreCart,
  toStoredCart,
  unitPrice,
  type CartLine,
  type Product,
  type StoredCartLine,
} from './kasir/cart-logic'

interface SaleDto {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Penjualan', href: '/kasir' }]

const DRAFT_STORAGE_KEY = 'kasir:draft'

/** the whole in-progress sale, kept across navigation and app restarts */
interface KasirDraft {
  cart: StoredCartLine[]
  metode: 'tunai' | 'bon'
  namaPelanggan: string
  dibayar: string
  jumlah: string
}

/** walk-in customer - stands in whenever the cashier does not type a name */
const DEFAULT_PELANGGAN = 'UMUM'

const EMPTY_DRAFT: KasirDraft = {
  cart: [],
  metode: 'tunai',
  namaPelanggan: DEFAULT_PELANGGAN,
  dibayar: '',
  jumlah: '1.00',
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
  const [salesToday, setSalesToday] = useState<SaleDto[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [scanError, setScanError] = useState('')
  const [metode, setMetode] = useState<'tunai' | 'bon'>(initialDraft.metode)
  const [namaPelanggan, setNamaPelanggan] = useState(initialDraft.namaPelanggan)
  const [dibayar, setDibayar] = useState(initialDraft.dibayar)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [printingSaleId, setPrintingSaleId] = useState<number | null>(null)
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
    refreshSalesToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function refreshSalesToday() {
    window.api.kasir
      .listSalesToday()
      .then(setSalesToday)
      .catch(() => setError('Gagal memuat data.'))
  }

  const total = useMemo(() => cart.reduce((sum, line) => sum + line.qty * unitPrice(line), 0), [cart])
  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + line.qty, 0), [cart])

  const paletteResults = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase()

    if (!q) {
      return []
    }

    return products
      .filter((p) => p.namaItem.toLowerCase().includes(q) || p.kodeItem.toLowerCase().includes(q))
      .slice(0, 50)
  }, [products, paletteQuery])

  function addProductToCart(product: Product, qty = 1) {
    setCart((prev) => addLine(prev, product, qty))
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

  function handleCartRowsChange(newRows: CartLine[], { indexes }: RowsChangeData<CartLine>) {
    const editedRow = newRows[indexes[0]]
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

  // Bon debt is collected per person, so it must not be filed under the
  // walk-in name. Switching to bon clears the default (but never a name the
  // cashier actually typed); switching back to tunai restores it.
  function changeMetode(next: 'tunai' | 'bon') {
    setMetode(next)

    if (next === 'bon' && namaPelanggan.trim() === DEFAULT_PELANGGAN) {
      setNamaPelanggan('')
    } else if (next === 'tunai' && !namaPelanggan.trim()) {
      setNamaPelanggan(DEFAULT_PELANGGAN)
    }
  }

  function resetAfterCheckout() {
    setPaymentOpen(false)
    setCart([])
    setNamaPelanggan(DEFAULT_PELANGGAN)
    setDibayar('')
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
        setPrintingSaleId(sale.saleId)
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

  async function handleCancel(saleId: number) {
    const confirmed = await confirm({
      title: 'Batalkan transaksi?',
      description: `Transaksi #${saleId} akan ditandai dibatalkan dan stoknya dikembalikan.`,
      confirmLabel: 'Batalkan',
      destructive: true,
    })

    if (!confirmed) {
      return
    }

    setError(null)
    setMessage(null)

    try {
      await window.api.kasir.cancelSale(saleId)
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan')
    }
  }

  return (
    <>
      <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex-1 space-y-4 p-4 sm:p-6 print:hidden">
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

      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShoppingCart className="size-4" />
          Keranjang
          {cartItemCount > 0 && <Badge variant="secondary">{cartItemCount}</Badge>}
        </h2>
        <div className="flex items-center gap-2">
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
              className="w-16 text-center"
            />
          </div>
          <div className="relative w-64">
            <Input
              ref={searchInputRef}
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  setPaletteOpen(true)
                }
              }}
              placeholder="Cari nama / kode produk..."
              className="pr-8"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              /
            </kbd>
          </div>
        </div>
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

      <div className="flex items-center justify-between rounded-xl border p-4">
        <span className="text-muted-foreground">Total</span>
        <span className="text-3xl font-bold tabular-nums">{formatRupiah(total)}</span>
        <Button
          type="button"
          size="lg"
          className="h-14 px-10 text-lg"
          disabled={cart.length === 0}
          onClick={() => setPaymentOpen(true)}
        >
          Bayar
        </Button>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={total}
        metode={metode}
        setMetode={changeMetode}
        namaPelanggan={namaPelanggan}
        setNamaPelanggan={setNamaPelanggan}
        dibayar={dibayar}
        setDibayar={setDibayar}
        processing={processing}
        printing={printingSaleId !== null}
        error={checkoutError}
        onSubmit={handleCheckout}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        results={paletteResults}
        products={products}
        jumlah={jumlah}
        onSelect={(product) => {
          addProductToCart(product, Number(jumlah) || 1)
          setPaletteQuery('')
          setJumlah('1.00')
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        }}
      />

      <section className="space-y-2">
        <h2 className="font-semibold">Transaksi Hari Ini</h2>
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <tbody>
              {salesToday.map((sale) => (
                <tr key={sale.id} className="border-b last:border-0">
                  <td className="p-2">#{sale.id}</td>
                  <td className="p-2 capitalize">{sale.metodePembayaran}</td>
                  <td className="p-2">
                    <Badge variant={sale.status === 'selesai' ? 'secondary' : 'outline'}>{sale.status}</Badge>
                  </td>
                  <td className="p-2 text-right font-medium">{formatRupiah(sale.total)}</td>
                  <td className="p-2 text-right">
                    {sale.status === 'selesai' && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleCancel(sale.id)}>
                        Batal
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </div>
      </AppShell>
      {ConfirmDialog}
    </>
  )
}
