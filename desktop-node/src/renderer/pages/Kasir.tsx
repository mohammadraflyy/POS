import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CellKeyboardEvent, CellKeyDownArgs, DataGridHandle, RowsChangeData } from 'react-data-grid'
import { Search, ShoppingCart, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppearance } from '@/hooks/use-appearance'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatRupiah } from '@/lib/utils'
import type { AuthUser } from '../types'
import { CartGrid, QTY_COLUMN_IDX } from './kasir/CartGrid'
import { PaymentDialog } from './kasir/PaymentDialog'
import { CommandPalette } from './kasir/CommandPalette'
import { lineKey, resolveLineQty, unitPrice, type CartLine, type Product } from './kasir/cart-logic'

interface SaleDto {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}

export function Kasir() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [salesToday, setSalesToday] = useState<SaleDto[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [scanError, setScanError] = useState('')
  const [metode, setMetode] = useState<'tunai' | 'bon'>('tunai')
  const [namaPelanggan, setNamaPelanggan] = useState('')
  const [dibayar, setDibayar] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const { resolvedAppearance } = useAppearance()
  const [cartWidthRef, cartGridWidth] = useElementWidth<HTMLDivElement>()
  const cartGridRef = useRef<DataGridHandle>(null)
  const lastTouchedKeyRef = useRef<string | null>(null)

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
    refreshProducts()
    refreshSalesToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function refreshProducts() {
    window.api.kasir
      .listProducts()
      .then(setProducts)
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

  function addProductToCart(product: Product) {
    const key = lineKey(product.id, null)
    lastTouchedKeyRef.current = key

    setCart((prev) => {
      const existing = prev.find((i) => i.key === key)

      if (existing) {
        return prev.map((i) => (i.key === key ? { ...i, qty: i.qty + 1 } : i))
      }

      return [...prev, { key, product, productUnitId: null, satuan: product.satuan, qty: 1 }]
    })
  }

  function changeLineUnit(line: CartLine, productUnitId: number | null) {
    const newKey = lineKey(line.product.id, productUnitId)

    if (newKey === line.key) {
      return
    }

    setCart((prev) => {
      if (prev.some((i) => i.key === newKey)) {
        return prev
          .filter((i) => i.key !== line.key)
          .map((i) => (i.key === newKey ? { ...i, qty: i.qty + line.qty } : i))
      }

      const unit = line.product.productUnits.find((u) => u.id === productUnitId)

      return prev.map((i) =>
        i.key === line.key
          ? { ...i, key: newKey, productUnitId, satuan: unit?.satuan ?? line.product.satuan }
          : i,
      )
    })
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
        setPaletteQuery('')
        setPaletteOpen(true)

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

  /** resolves rawQty to the cleanest satuan and merges into an existing line for that satuan if one exists */
  function applyResolvedQty(key: string, rawQty: number) {
    setCart((prev) => {
      const line = prev.find((i) => i.key === key)

      if (!line) {
        return prev
      }

      const resolved = resolveLineQty(line, rawQty > 0 ? rawQty : 1)
      const newKey = lineKey(line.product.id, resolved.productUnitId)

      if (prev.some((i) => i.key === newKey && i.key !== line.key)) {
        return prev
          .filter((i) => i.key !== line.key)
          .map((i) => (i.key === newKey ? { ...i, qty: i.qty + resolved.qty } : i))
      }

      return prev.map((i) =>
        i.key === line.key
          ? { ...i, key: newKey, productUnitId: resolved.productUnitId, satuan: resolved.satuan, qty: resolved.qty }
          : i,
      )
    })
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((i) => i.key !== key))
  }

  function clearCart() {
    if (cart.length === 0) {
      return
    }

    if (!confirm('Kosongkan keranjang?')) {
      return
    }

    setCart([])
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

  function focusCartQty(key: string | null) {
    if (!key) {
      return
    }

    const rowIdx = cart.findIndex((line) => line.key === key)

    if (rowIdx === -1) {
      return
    }

    cartGridRef.current?.setActivePosition({ rowIdx, idx: QTY_COLUMN_IDX }, { shouldFocus: true })
  }

  function resetAfterCheckout() {
    setPaymentOpen(false)
    setCart([])
    setNamaPelanggan('')
    setDibayar('')
  }

  async function handleCheckout() {
    setProcessing(true)
    setError(null)
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
      resetAfterCheckout()
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal checkout')
    } finally {
      setProcessing(false)
    }
  }

  async function handleCancel(saleId: number) {
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

  if (!user) {
    return <p>Memuat...</p>
  }

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-6">
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
          <Button
            type="button"
            onClick={() => {
              setPaletteQuery('')
              setPaletteOpen(true)
            }}
          >
            <Search className="size-4" />
            Cari / Tambah Produk
            <kbd className="ml-1 rounded border border-primary-foreground/30 px-1.5 py-0.5 text-xs">/</kbd>
          </Button>
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
        <span>Klik pill satuan untuk ganti satuan</span>
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
        <span className="text-2xl font-bold">{formatRupiah(total)}</span>
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
        setMetode={setMetode}
        namaPelanggan={namaPelanggan}
        setNamaPelanggan={setNamaPelanggan}
        dibayar={dibayar}
        setDibayar={setDibayar}
        processing={processing}
        error={error}
        onSubmit={handleCheckout}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        results={paletteResults}
        onSelect={(product) => {
          addProductToCart(product)
          setPaletteQuery('')
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          focusCartQty(lastTouchedKeyRef.current)
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
  )
}
