import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { CartGrid, QTY_COLUMN_IDX } from './kasir/CartGrid'
import { PaymentDialog } from './kasir/PaymentDialog'
import { CommandPalette } from './kasir/CommandPalette'
import { CustomerPicker, DEFAULT_PELANGGAN } from './kasir/CustomerPicker'
import { resolveShortcut, type KasirShortcut } from './kasir/shortcuts'
import {
  addLine,
  applyDiskon,
  applyHarga,
  applyQty,
  cartFromSale,
  changeUnit,
  expandUnitResults,
  lineGross,
  lineSubtotal,
  matchingProducts,
  parseDiskon,
  restoreCart,
  toStoredCart,
  type CartLine,
  type EditSaleItem,
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
  /** kept as typed ("5000" or "10%") so the cashier sees back what they entered */
  diskonNota: string
}

const EMPTY_DRAFT: KasirDraft = {
  cart: [],
  metode: 'tunai',
  namaPelanggan: DEFAULT_PELANGGAN,
  dibayar: '',
  jumlah: '1.00',
  diskonNota: '',
}

/** current local time in the `YYYY-MM-DDTHH:mm` shape a datetime-local input wants */
/**
 * Drops focus back to the document body.
 *
 * The Bayar shortcut and the global barcode scanner both refuse to act while an
 * input is focused, so "focused nowhere" is a real state this page needs, not an
 * absence of one.
 */
function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}

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
      diskonNota: typeof parsed.diskonNota === 'string' ? parsed.diskonNota : '',
    }
  } catch {
    return EMPTY_DRAFT
  }
}

export function Kasir() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editSaleId = Number(searchParams.get('edit')) || null

  // In edit mode the draft is left completely alone - the cart the cashier walked
  // away from has to be waiting for them when they come back.
  const [initialDraft] = useState(() => (editSaleId === null ? readStoredDraft() : EMPTY_DRAFT))
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<string[]>([])
  const [customerOpen, setCustomerOpen] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [scanError, setScanError] = useState('')
  const [metode, setMetode] = useState<'tunai' | 'bon' | 'qris' | 'transfer'>(initialDraft.metode)
  const [namaPelanggan, setNamaPelanggan] = useState(initialDraft.namaPelanggan)
  const [dibayar, setDibayar] = useState(initialDraft.dibayar)
  const [diskonNota, setDiskonNota] = useState(initialDraft.diskonNota)
  const [tanggal, setTanggal] = useState(nowForInput())
  // Set once the cashier types a time of their own, so the staleness refresh
  // below stops overwriting it. Without this the field cannot really be edited:
  // it sits on the page, but any deliberate time is replaced by "now" the next
  // time the payment dialog opens.
  const [tanggalDirty, setTanggalDirty] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [jumlah, setJumlah] = useState(initialDraft.jumlah)
  // Non-edit mode has nothing to gate - the cart is always what it says it is.
  // Edit mode starts unready and only becomes ready once cartFromSale has run
  // AND accounted for every line of the saved sale (see refreshProducts below).
  const [editReady, setEditReady] = useState(editSaleId === null)
  const [editBlockReason, setEditBlockReason] = useState<string | null>(null)
  const { resolvedAppearance } = useAppearance()
  const { confirm, ConfirmDialog } = useConfirm()
  const [cartWidthRef, cartGridWidth] = useElementWidth<HTMLDivElement>()
  const cartGridRef = useRef<DataGridHandle>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const jumlahInputRef = useRef<HTMLInputElement>(null)
  // the cart can only be rebuilt once the catalog is loaded, so it waits here
  // while the rest of the draft is restored straight into state above
  const pendingRestoreRef = useRef<StoredCartLine[]>(initialDraft.cart)
  // the sale's lines can only be rebuilt once the catalog has loaded, the same
  // dance the draft does
  const pendingEditRef = useRef<EditSaleItem[]>([])

  useEffect(() => {
    refreshProducts()
    refreshCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the sale being edited. Note the date formatting: sale.createdAt is an
  // ISO string in UTC, so slicing it would show the wrong wall-clock time for
  // a shop not on UTC - build the local YYYY-MM-DDTHH:mm by hand instead.
  useEffect(() => {
    if (editSaleId === null) {
      return
    }

    window.api.kasir
      .getSaleForEdit(editSaleId)
      .then((sale) => {
        // updateSale rejects a non-selesai sale outright - surface that up front
        // rather than letting the cart load and only failing on save.
        if (sale.status !== 'selesai') {
          setEditBlockReason(
            `Transaksi ini berstatus "${sale.status}" dan tidak bisa diedit. Hanya transaksi selesai yang bisa diedit.`,
          )

          return
        }

        const created = new Date(sale.createdAt)
        const pad = (n: number) => String(n).padStart(2, '0')

        setMetode(sale.metodePembayaran)
        setNamaPelanggan(sale.namaPelanggan ?? DEFAULT_PELANGGAN)
        setDibayar(String(sale.dibayar))
        // comes back as the nominal that was charged, not as the "10%" that produced it -
        // the percentage is not stored, and re-deriving it would change the sale's total
        setDiskonNota(sale.diskon > 0 ? String(sale.diskon) : '')
        setTanggal(
          `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}T${pad(created.getHours())}:${pad(created.getMinutes())}`,
        )
        // the sale's own date is never "stale" - nothing may refresh it to now
        setTanggalDirty(true)
        pendingEditRef.current = sale.items
        refreshProducts()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat transaksi.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSaleId])

  // tanggal is seeded once at mount, so without this a sale left open all
  // morning would be filed under whatever time the page happened to load.
  // Refreshing it when the payment dialog opens keeps that from happening -
  // but only while the cashier has not set a time themselves, and never in
  // edit mode, which carries the sale's own date.
  useEffect(() => {
    if (paymentOpen && editSaleId === null && !tanggalDirty) {
      setTanggal(nowForInput())
    }
  }, [paymentOpen, editSaleId, tanggalDirty])

  useEffect(() => {
    if (editSaleId !== null) {
      return
    }

    const draft: KasirDraft = { cart: toStoredCart(cart), metode, namaPelanggan, dibayar, jumlah, diskonNota }

    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  }, [cart, metode, namaPelanggan, dibayar, jumlah, diskonNota, editSaleId])

  function refreshProducts() {
    window.api.kasir
      .listProducts()
      .then((list) => {
        setProducts(list)

        if (pendingEditRef.current.length > 0) {
          const { cart: editCart, dropped } = cartFromSale(pendingEditRef.current, list)
          setCart(editCart)
          pendingEditRef.current = []

          if (dropped > 0) {
            setEditReady(false)
            setEditBlockReason(
              `Transaksi ini tidak bisa diedit: ${dropped} baris tidak bisa dimuat karena produk atau satuannya sudah dihapus/dinonaktifkan.`,
            )
          } else {
            setEditReady(true)
            setEditBlockReason(null)
          }

          return
        }

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

  // what the goods cost before anything was given away
  const subtotalKotor = useMemo(() => cart.reduce((sum, line) => sum + lineGross(line), 0), [cart])
  // what the lines come to once their own discounts are off - this is what a bill-wide
  // discount is measured against, both here and in main/kasir.ts
  const subtotalBarang = useMemo(() => cart.reduce((sum, line) => sum + lineSubtotal(line), 0), [cart])
  const diskonItem = subtotalKotor - subtotalBarang
  const diskonNotaValue = useMemo(() => parseDiskon(diskonNota, subtotalBarang), [diskonNota, subtotalBarang])
  const total = subtotalBarang - diskonNotaValue
  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + line.qty, 0), [cart])

  // the walk-in name is always offered, even on a fresh database where no sale
  // has ever carried it; so is a name picked but not yet checked out
  const customerOptions = useMemo(() => {
    const names = [DEFAULT_PELANGGAN, namaPelanggan.trim(), ...customers].filter((nama) => nama !== '')

    return [...new Set(names)]
  }, [customers, namaPelanggan])

  const paletteResults = useMemo(() => expandUnitResults(products, paletteQuery, 50), [products, paletteQuery])

  // The 50 caps rows, and every product brings one row per satuan, so a broad
  // query runs out of room long before it runs out of products. Cutting the rest
  // silently is what made items look like they had vanished from the catalog.
  const paletteHiddenCount = useMemo(() => {
    const shown = new Set(paletteResults.map((result) => result.product.id))

    return matchingProducts(products, paletteQuery).length - shown.size
  }, [products, paletteQuery, paletteResults])

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

    function handleKeydown(e: globalThis.KeyboardEvent) {
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

      const now = Date.now()

      if (now - scanLastKeyAt.current > 100) {
        scanBuffer.current = ''
      }

      scanLastKeyAt.current = now

      if (e.key === 'Enter') {
        const code = scanBuffer.current
        scanBuffer.current = ''

        if (code.length < 4) {
          // not a scan burst, and Enter no longer pays - End does
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
  }, [products, cart.length, paymentOpen, paletteOpen, customerOpen, editSaleId, editReady])

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

    if (column.key === 'diskon') {
      // the edit cell already resolved any "%", but it is re-run through the same parser
      // so clamping to the line's gross happens in exactly one place
      setCart((prev) => applyDiskon(prev, editedRow.key, String(editedRow.diskon ?? 0)))

      return
    }

    applyResolvedQty(editedRow.key, editedRow.qty)
  }

  // Alt+K still has to be caught here: while a grid cell is active the grid swallows the
  // keydown before it reaches the window listener. Enter is deliberately left alone now,
  // so it falls through to the grid's own "start editing this cell".
  function handleCartCellKeyDown(args: CellKeyDownArgs<CartLine>, event: CellKeyboardEvent) {
    if (args.mode !== 'ACTIVE') {
      return
    }

    if (
      event.key === 'End' &&
      cart.length > 0 &&
      !(paymentOpen || paletteOpen || customerOpen) &&
      (editSaleId === null || editReady)
    ) {
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
    // a discount belongs to the sale that earned it, never to the next customer
    setDiskonNota('')
    setTanggal(nowForInput())
    // the next sale starts on the clock again, not on the last one's time
    setTanggalDirty(false)
  }

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
        // tunai falls back to the walk-in name so the struk is never nameless;
        // bon must not, or an unnamed debt would silently be filed under it and
        // the main process could never reject it
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

  async function handleSaveEdit() {
    if (editSaleId === null) {
      return
    }

    setProcessing(true)
    setCheckoutError(null)

    try {
      await window.api.kasir.updateSale({
        saleId: editSaleId,
        metodePembayaran: metode,
        namaPelanggan: metode === 'bon' ? namaPelanggan.trim() || null : namaPelanggan.trim() || DEFAULT_PELANGGAN,
        // Unlike checkout, a bon must send its dibayar too: an edited bon may already
        // carry recorded payments, and sending null would read as 0 and trip
        // updateSale's "tidak boleh kurang dari pembayaran yang sudah tercatat" guard
        // on every single save. Only qris and transfer settle themselves.
        dibayar: metode === 'qris' || metode === 'transfer' ? null : Number(dibayar || 0),
        tanggal,
        diskon: diskonNotaValue,
        items: cart.map((line) => ({
          productId: line.product.id,
          productUnitId: line.productUnitId,
          qty: line.qty,
          hargaJual: line.hargaOverride ?? null,
          diskon: line.diskon ?? 0,
        })),
      })

      navigate('/history')
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <>
      <AppShell breadcrumbs={BREADCRUMBS}>
      <Page className="print:hidden">
      <PageHeader
        title={editSaleId === null ? 'Penjualan' : `Penjualan — Mode Edit #${editSaleId}`}
        actions={
          <>
            {editSaleId !== null && (
              <Button type="button" variant="outline" onClick={() => navigate('/history')}>
                Batal
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <label htmlFor="kasir-jumlah" className="text-xs text-muted-foreground">
                Jumlah
              </label>
              <Input
                id="kasir-jumlah"
                ref={jumlahInputRef}
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

                  // Empty box: step back out to the sale rather than opening a
                  // palette with nothing to show. Focus goes nowhere, so the
                  // next End reaches Bayar.
                  if (code === '') {
                    blurActiveElement()

                    return
                  }

                  // A scanner types the barcode then Enter. Resolving it here means a
                  // scan never has to travel through the palette at all, and repeated
                  // scans work without touching the mouse.
                  const scanned = products.find((p) => p.barcode === code)

                  if (scanned) {
                    addProductToCart(scanned, Number(jumlah) || 1)
                    setPaletteQuery('')
                    setJumlah('1.00')
                    setScanError('')
                    blurActiveElement()

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
      {editSaleId !== null && !editReady && editBlockReason && (
        <p role="alert" className="text-sm text-destructive">
          {editBlockReason}
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="grid flex-1 items-start gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-3">
            {/* Both are supporting details, not the main event - they share one
                compact row so the cart and the Total keep the vertical space. */}
            <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setCustomerOpen(true)}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left hover:bg-muted/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-[11px] leading-tight text-muted-foreground">Pelanggan</span>
                  <span className="block truncate text-sm font-medium">
                    {namaPelanggan.trim() || DEFAULT_PELANGGAN}
                  </span>
                </span>
              </span>
              <kbd className="shrink-0 rounded border px-1 py-0.5 text-[10px] text-muted-foreground">Alt+P</kbd>
            </button>

            {/* Backdating is normal here: yesterday's sale often gets entered the
                next morning, and an edited sale carries its own date. The field
                lives on the page rather than inside the payment dialog so the
                cashier can see and set the time before committing to anything.
                The main process rejects a future date. */}
            <div className="rounded-lg border px-3 py-2">
              <label htmlFor="tanggal-transaksi" className="block text-[11px] leading-tight text-muted-foreground">
                Tanggal &amp; Jam
              </label>
              <Input
                id="tanggal-transaksi"
                type="datetime-local"
                value={tanggal}
                disabled={processing}
                onChange={(e) => {
                  setTanggal(e.target.value)
                  setTanggalDirty(true)
                }}
                className="mt-0.5 h-8 border-0 px-0 text-sm shadow-none tabular-nums focus-visible:ring-0"
              />
            </div>
            </div>

            <div className="rounded-xl border p-5">
              <span className="text-sm text-muted-foreground">Total</span>
              <p className="mt-1 text-3xl font-bold tabular-nums">{formatRupiah(total)}</p>

              {/* only shown once something has actually been given away - an untouched
                  sale keeps the single big number it had before */}
              {(diskonItem > 0 || diskonNotaValue > 0) && (
                <div className="mt-2 space-y-0.5 text-xs tabular-nums text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatRupiah(subtotalKotor)}</span>
                  </div>
                  {diskonItem > 0 && (
                    <div className="flex justify-between">
                      <span>Diskon item</span>
                      <span className="text-destructive">-{formatRupiah(diskonItem)}</span>
                    </div>
                  )}
                  {diskonNotaValue > 0 && (
                    <div className="flex justify-between">
                      <span>Diskon nota</span>
                      <span className="text-destructive">-{formatRupiah(diskonNotaValue)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Lives here rather than in the payment dialog so the big Total above is
                  always the number the customer will be asked for. */}
              <div className="mt-3 flex items-center justify-between gap-2">
                <label htmlFor="diskon-nota" className="text-xs text-muted-foreground">
                  Diskon nota
                </label>
                <Input
                  id="diskon-nota"
                  type="text"
                  value={diskonNota}
                  disabled={processing}
                  onChange={(e) => setDiskonNota(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // hand focus back to nobody so the next End reaches Bayar
                      e.preventDefault()
                      blurActiveElement()
                    }
                  }}
                  placeholder="0 atau 10%"
                  title="Isi nominal rupiah (5000) atau persen (10%) - dihitung dari subtotal setelah diskon item"
                  className="h-8 w-28 text-right tabular-nums"
                />
              </div>
              <Button
                type="button"
                size="lg"
                className="mt-4 h-14 w-full text-lg"
                disabled={cart.length === 0 || (editSaleId !== null && !editReady)}
                onClick={() => setPaymentOpen(true)}
              >
                {editSaleId === null ? 'Bayar' : 'Simpan Perubahan'}
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
                    editMode={editSaleId !== null}
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
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">Alt+K</kbd>
              Kosongkan
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">F3</kbd>
              Ubah Qty Baris Teratas
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5">F2</kbd>
              Edit Qty / Satuan / Diskon
            </span>
          </div>
        </div>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={total}
        subtotal={subtotalKotor}
        diskonItem={diskonItem}
        diskonNota={diskonNotaValue}
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
        processing={processing}
        error={checkoutError}
        onSubmit={editSaleId === null ? handleCheckout : handleSaveEdit}
        editMode={editSaleId !== null}
        editReady={editReady}
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
        hiddenCount={paletteHiddenCount}
        products={products}
        jumlah={jumlah}
        onSelect={(result: UnitResult) => {
          addProductToCart(result.product, Number(jumlah) || 1, result.productUnitId)
          setPaletteQuery('')
          setJumlah('1.00')
          setPaletteOpen(false)
        }}
        onCloseAutoFocus={(e) => {
          // Deliberately focus nothing. Returning focus to the search box would make
          // Enter reopen this palette instead of letting End reach Bayar: while that
          // box is focused its own Enter handler owns the key, and the Bayar shortcut
          // only fires when nothing is focused. Leaving focus on the body also
          // hands the global barcode scanner back its keystrokes.
          e.preventDefault()
          blurActiveElement()
        }}
      />

      </Page>
      </AppShell>
      {ConfirmDialog}
    </>
  )
}
