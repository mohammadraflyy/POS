import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { ReportTable } from '@/components/report-table'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputError } from '@/components/input-error'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useConfirm } from '@/hooks/use-confirm'
import { formatQty, formatRupiah, parseQty } from '@/lib/utils'
import { useDraftState } from '@/hooks/use-sticky-state'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SupplierOption {
  id: number
  nama: string
}

interface SearchResult {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaPokok: number
  units: { id: number; satuan: string; konversi: number; hargaPokok: number }[]
}

interface PurchaseRow {
  id: number
  tanggal: string
  total: number
  dibayar: number
  sisa: number
  catatan: string | null
  supplierName: string | null
  itemSummary: string
}

interface DraftItem {
  key: string
  productId: number
  namaItem: string
  kodeItem: string
  baseSatuan: string
  // the base unit's own cost, restored to hargaBeli when the satuan is switched back to it
  baseHargaPokok: number
  units: { id: number; satuan: string; konversi: number; hargaPokok: number }[]
  productUnitId: number | null
  qty: string
  hargaBeli: string
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Pembelian', href: '/purchase' }]

function todayIso(): string {
  const now = new Date()

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function Purchase() {
  const [supplierList, setSupplierList] = useState<SupplierOption[]>([])

  // the invoice being corrected, or null while entering a new one. Declared above the
  // fields below because it decides whether they may be written to storage at all: the
  // edit form reuses these same fields, and storing a loaded invoice would reopen the
  // next blank purchase pre-filled from someone else's.
  const [editingId, setEditingId] = useState<number | null>(null)
  const drafting = editingId === null

  const [supplierId, setSupplierId, clearSupplierId] = useDraftState<number | null>(
    'purchase.supplierId',
    null,
    drafting,
  )
  const [supplierPaletteOpen, setSupplierPaletteOpen] = useState(false)
  const selectedSupplier = supplierList.find((s) => s.id === supplierId)

  // tanggal stays out of the draft, as in the Kasir draft: a date restored from
  // yesterday would file today's goods on the wrong day
  const [tanggal, setTanggal] = useState(todayIso)
  const [catatan, setCatatan, clearCatatan] = useDraftState('purchase.catatan', '', drafting)
  // empty means "paid in full"; anything lower leaves the remainder as supplier debt (BON)
  const [dibayar, setDibayar, clearDibayar] = useDraftState('purchase.dibayar', '', drafting)
  const [items, setItems, clearItems] = useDraftState<DraftItem[]>('purchase.items', [], drafting)
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [scanError, setScanError] = useState('')
  // instalments already paid against the edited invoice - an edit cannot take them back,
  // so they cap how low its new total is allowed to go
  const [cicilan, setCicilan] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<SearchResult[]>([])
  // cmdk's own highlighted row, mirrored here now that Enter is handled by hand
  // instead of cmdk's native (synchronous) Enter handler.
  const [paletteHighlighted, setPaletteHighlighted] = useState('')

  const [newSupplierOpen, setNewSupplierOpen] = useState(false)
  const [newSupplierNama, setNewSupplierNama] = useState('')
  const [newSupplierTelepon, setNewSupplierTelepon] = useState('')
  const [newSupplierAlamat, setNewSupplierAlamat] = useState('')
  const [newSupplierKeterangan, setNewSupplierKeterangan] = useState('')
  const [newSupplierProcessing, setNewSupplierProcessing] = useState(false)
  const [newSupplierError, setNewSupplierError] = useState<string | null>(null)

  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalKeseluruhan, setTotalKeseluruhan] = useState(0)

  // what the table below actually reflects right now - only moves when a load
  // lands, mirroring Rekap's appliedFrom/appliedTo so the filter inputs can be
  // edited without the table jumping ahead of a pending "Terapkan" click
  const [historyDari, setHistoryDari] = useState('')
  const [historySampai, setHistorySampai] = useState('')
  const [appliedHistoryDari, setAppliedHistoryDari] = useState('')
  const [appliedHistorySampai, setAppliedHistorySampai] = useState('')

  const { confirm, ConfirmDialog } = useConfirm()

  // A restored draft can name a supplier that has since been deleted. Drop it rather
  // than leaving the picker blank while the form still holds the id - the same choice
  // restoreCart makes for products that vanished from the catalogue.
  useEffect(() => {
    if (supplierId !== null && supplierList.length > 0 && !supplierList.some((s) => s.id === supplierId)) {
      setSupplierId(null)
    }
  }, [supplierId, supplierList, setSupplierId])

  function loadSuppliers() {
    window.api.supplier.listSuppliers({ page: 1, pageSize: 100 }).then((result) => {
      setSupplierList(result.data.map((s) => ({ id: s.id, nama: s.nama })))
    })
  }

  // Pagination and post-save/-delete reloads keep whatever filter is currently
  // applied; only an explicit "Terapkan" click (submitHistoryFilter) should pick up
  // live, not-yet-applied edits to the date inputs.
  function loadPurchases(page: number, dari = appliedHistoryDari, sampai = appliedHistorySampai) {
    window.api.purchase.listPurchases({ page, dari: dari || undefined, sampai: sampai || undefined }).then((result) => {
      setPurchases(result.data)
      setCurrentPage(result.currentPage)
      setLastPage(result.lastPage)
      setTotal(result.total)
      setTotalKeseluruhan(result.totalKeseluruhan)
      setAppliedHistoryDari(dari)
      setAppliedHistorySampai(sampai)
    })
  }

  function submitHistoryFilter(e: FormEvent) {
    e.preventDefault()
    loadPurchases(1, historyDari, historySampai)
  }

  function resetHistoryFilter() {
    setHistoryDari('')
    setHistorySampai('')
    loadPurchases(1, '', '')
  }

  useEffect(() => {
    loadSuppliers()
    loadPurchases(1)
  }, [])

  useEffect(() => {
    if (!paletteOpen) {
      return
    }

    let cancelled = false

    window.api.purchase.searchProducts(paletteQuery).then((results) => {
      if (!cancelled) {
        setPaletteResults(results)
      }
    })

    return () => {
      cancelled = true
    }
  }, [paletteOpen, paletteQuery])

  function addItem(product: SearchResult) {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.productUnitId === null)

      if (existing) {
        return prev.map((i) =>
          i.key === existing.key ? { ...i, qty: formatQty((parseQty(i.qty) || 0) + 1) } : i,
        )
      }

      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          productId: product.id,
          namaItem: product.namaItem,
          kodeItem: product.kodeItem,
          baseSatuan: product.satuan,
          baseHargaPokok: product.hargaPokok,
          units: product.units,
          productUnitId: null,
          qty: '1',
          hargaBeli: String(product.hargaPokok),
        },
      ]
    })
    setPaletteOpen(false)
    setPaletteQuery('')
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  function updateItem(key: string, field: 'qty' | 'hargaBeli' | 'productUnitId', value: string) {
    setItems((prev) =>
      prev.map((i) => {
        if (i.key !== key) {
          return i
        }
        if (field === 'productUnitId') {
          if (value === 'base') {
            return { ...i, productUnitId: null, hargaBeli: String(i.baseHargaPokok) }
          }

          const unit = i.units.find((u) => u.id === Number(value))

          return { ...i, productUnitId: Number(value), hargaBeli: String(unit?.hargaPokok ?? i.hargaBeli) }
        }
        return { ...i, [field]: value }
      }),
    )
  }

  function resetForm() {
    // the clears drop the stored draft as well as the field, so a saved purchase does
    // not come back as a ghost draft on the next visit
    clearItems()
    clearCatatan()
    clearDibayar()
    clearSupplierId()
    setTanggal(todayIso())
    setEditingId(null)
    setCicilan(0)
    setFormError(null)
  }

  function startEdit(purchaseId: number) {
    window.api.purchase
      .getPurchaseDetail(purchaseId)
      .then((detail) => {
        setEditingId(detail.id)
        setCicilan(detail.cicilan)
        setSupplierId(detail.supplierId)
        setTanggal(detail.tanggal)
        setCatatan(detail.catatan ?? '')
        setDibayar(String(detail.uangMuka))
        setItems(
          detail.items.map((item) => ({
            key: crypto.randomUUID(),
            productId: item.productId,
            namaItem: item.namaItem,
            kodeItem: item.kodeItem,
            baseSatuan: item.baseSatuan,
            baseHargaPokok: item.baseHargaPokok,
            units: item.units,
            productUnitId: item.productUnitId,
            qty: formatQty(item.qty),
            hargaBeli: String(item.hargaBeli),
          })),
        )
        setFormError(null)
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal memuat pembelian')
      })
  }

  async function removePurchase(row: PurchaseRow) {
    const sudahDibayar = row.dibayar > 0
    const ok = await confirm({
      title: 'Hapus Pembelian',
      description: sudahDibayar
        ? `Hapus pembelian ${row.tanggal} senilai ${formatRupiah(row.total)}? Stok dan harga pokok dikembalikan, dan pembayaran ${formatRupiah(row.dibayar)} atas pembelian ini ikut terhapus.`
        : `Hapus pembelian ${row.tanggal} senilai ${formatRupiah(row.total)}? Stok dan harga pokok akan dikembalikan.`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    window.api.purchase
      .deletePurchase(row.id)
      .then(() => {
        if (editingId === row.id) {
          resetForm()
        }

        loadPurchases(currentPage)
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal menghapus pembelian')
      })
  }

  const grandTotal = items.reduce(
    (sum, i) => sum + Math.round((parseQty(i.qty) || 0) * Number(i.hargaBeli || 0)),
    0,
  )
  // the down payment can only cover what the instalments have not already settled
  const maksUangMuka = grandTotal - cicilan
  const dibayarNum = dibayar.trim() === '' ? maksUangMuka : Number(dibayar)
  const sisaHutang = Math.max(0, maksUangMuka - (Number.isFinite(dibayarNum) ? dibayarNum : 0))

  function submitNewSupplier(e: FormEvent) {
    e.preventDefault()

    if (!newSupplierNama.trim()) {
      setNewSupplierError('Nama wajib diisi.')
      return
    }

    setNewSupplierProcessing(true)
    setNewSupplierError(null)

    window.api.supplier
      .createSupplier({
        nama: newSupplierNama,
        telepon: newSupplierTelepon || null,
        alamat: newSupplierAlamat || null,
        keterangan: newSupplierKeterangan || null,
      })
      .then((id) => {
        setSupplierList((prev) => [...prev, { id, nama: newSupplierNama }])
        setSupplierId(id)
        setNewSupplierNama('')
        setNewSupplierTelepon('')
        setNewSupplierAlamat('')
        setNewSupplierKeterangan('')
        setNewSupplierOpen(false)
      })
      .catch((err) => {
        setNewSupplierError(err instanceof Error ? err.message : 'Gagal menyimpan supplier')
      })
      .finally(() => setNewSupplierProcessing(false))
  }

  function submit(e: FormEvent) {
    e.preventDefault()

    if (items.length === 0) {
      setFormError('Item pembelian tidak boleh kosong.')
      return
    }

    for (const item of items) {
      // qty may be fractional (5,5 KG), so only zero and negatives are rejected
      const qtyNum = parseQty(item.qty)
      const hargaNum = Number(item.hargaBeli)

      if (item.qty.trim() === '' || !Number.isFinite(qtyNum) || qtyNum <= 0) {
        setFormError(`Qty untuk "${item.namaItem}" harus lebih dari 0.`)
        return
      }

      if (item.hargaBeli.trim() === '' || !Number.isFinite(hargaNum)) {
        setFormError(`Harga beli untuk "${item.namaItem}" wajib diisi.`)
        return
      }
    }

    if (dibayar.trim() !== '' && (!Number.isFinite(dibayarNum) || dibayarNum < 0)) {
      setFormError('Dibayar tidak boleh negatif.')
      return
    }

    if (cicilan > grandTotal) {
      setFormError(`Total pembelian tidak boleh lebih kecil dari cicilan yang sudah dibayar (${formatRupiah(cicilan)}).`)
      return
    }

    if (dibayarNum > maksUangMuka) {
      setFormError('Dibayar tidak boleh melebihi total pembelian.')
      return
    }

    setProcessing(true)
    setFormError(null)

    const payload = {
      supplierId,
      tanggal,
      catatan: catatan || null,
      items: items.map((item) => ({
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: parseQty(item.qty),
        hargaBeli: Number(item.hargaBeli),
      })),
      dibayar: dibayar.trim() === '' ? null : dibayarNum,
    }

    const saved: Promise<unknown> =
      editingId === null
        ? window.api.purchase.recordPurchase(payload)
        : window.api.purchase.updatePurchase(editingId, payload)
    const pageAfterSave = editingId === null ? 1 : currentPage

    saved
      .then(() => {
        resetForm()
        loadPurchases(pageAfterSave)
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pembelian')
      })
      .finally(() => setProcessing(false))
  }

  // The palette's search runs in a useEffect, so a scanner's trailing Enter lands
  // before the results do. cmdk's own Enter handler runs synchronously on the same
  // bubble, so a late preventDefault() (after the await) is already too late - cmdk
  // has selected the highlighted row by then. Own Enter completely instead: block
  // cmdk synchronously, then decide ourselves whether it was a barcode scan (exact
  // match - add that product, and leave the palette open so consecutive scans stack
  // up) or a human search (no exact barcode match - fall back to whatever row cmdk
  // has highlighted, same as its native behaviour would have added).
  async function handlePaletteKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    const typed = paletteQuery.trim()

    if (typed === '') {
      return
    }

    let scanned: Awaited<ReturnType<typeof window.api.purchase.findProductByBarcode>>

    try {
      scanned = await window.api.purchase.findProductByBarcode(typed)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal mencari barcode.')

      return
    }

    if (scanned) {
      addItem(scanned)
      setPaletteOpen(true)
      setPaletteQuery('')
      return
    }

    const highlighted = paletteResults.find((p) => p.id.toString() === paletteHighlighted)

    if (highlighted) {
      addItem(highlighted)
    }
  }

  // Hardware scanners type a barcode + Enter almost instantly (unlike a human typing).
  // Buffer keystrokes globally and treat a fast burst ending in Enter as a scan, so an
  // item lands in the list the moment it is scanned - the cashier should not have to
  // open "Cari Produk" first. Mirrors the same buffer in Kasir. Only runs while no
  // input/textarea/dialog already owns the keystrokes, so it never fights with typing
  // in the form fields or the palettes above.
  const scanBuffer = useRef('')
  const scanLastKeyAt = useRef(0)

  useEffect(() => {
    function isEditableFocused() {
      const el = document.activeElement

      return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }

    function handleKeydown(e: globalThis.KeyboardEvent) {
      if (isEditableFocused() || paletteOpen || supplierPaletteOpen || newSupplierOpen) {
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

        window.api.purchase
          .findProductByBarcode(code)
          .then((product) => {
            if (product) {
              setScanError('')
              addItem(product)
            } else {
              setScanError(`Barcode "${code}" tidak ditemukan.`)
            }
          })
          .catch((err) => setScanError(err instanceof Error ? err.message : 'Gagal mencari barcode.'))

        return
      }

      if (e.key.length === 1) {
        scanBuffer.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeydown)

    return () => window.removeEventListener('keydown', handleKeydown)
  }, [paletteOpen, supplierPaletteOpen, newSupplierOpen])

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Pembelian" />

        {scanError && (
          <p role="alert" className="text-sm text-destructive">
            {scanError}
          </p>
        )}

        <form ref={formRef} onSubmit={submit} className="space-y-4 rounded-xl border p-4">
          {editingId !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm">
              <span>
                Mengubah pembelian <strong>#{editingId}</strong>
                {cicilan > 0 && <> &middot; cicilan terbayar {formatRupiah(cicilan)} tidak ikut berubah</>}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                Batal Edit
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label>Supplier</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 justify-start font-normal"
                  onClick={() => setSupplierPaletteOpen(true)}
                >
                  <Search className="size-4" />
                  {selectedSupplier?.nama ?? 'Tanpa supplier'}
                </Button>
                <Button type="button" variant="outline" size="icon" title="Supplier Baru" onClick={() => setNewSupplierOpen(true)}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Tanggal</Label>
              <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Catatan (opsional)</Label>
              <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} />
            </div>
          </div>

          <Button type="button" variant="outline" onClick={() => setPaletteOpen(true)}>
            <Search className="size-4" />
            Cari Produk
          </Button>

          {items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">Produk</th>
                    <th className="w-32 p-2">Satuan</th>
                    <th className="w-24 p-2">Qty</th>
                    <th className="w-40 p-2">Harga Beli</th>
                    <th className="w-32 p-2 text-right">Subtotal</th>
                    <th className="w-10 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key} className="border-t">
                      <td className="p-2">
                        {item.namaItem} <span className="text-muted-foreground">&middot; {item.kodeItem}</span>
                      </td>
                      <td className="p-2">
                        <Select
                          value={item.productUnitId === null ? 'base' : String(item.productUnitId)}
                          onValueChange={(v) => updateItem(item.key, 'productUnitId', v)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="base">{item.baseSatuan}</SelectItem>
                            {item.units.map((unit) => (
                              <SelectItem key={unit.id} value={String(unit.id)}>
                                {unit.satuan}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          title="Boleh pecahan, misalnya 5,5"
                          value={item.qty}
                          onChange={(e) => updateItem(item.key, 'qty', e.target.value)}
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={item.hargaBeli}
                          onChange={(e) => updateItem(item.key, 'hargaBeli', e.target.value)}
                        />
                      </td>
                      <td className="p-2 text-right">
                        {formatRupiah(Math.round((parseQty(item.qty) || 0) * Number(item.hargaBeli || 0)))}
                      </td>
                      <td className="p-2">
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(item.key)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <InputError message={formError ?? undefined} />

          <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label>{cicilan > 0 ? 'Uang Muka (kosong = lunas)' : 'Dibayar (kosong = lunas)'}</Label>
              <Input type="number" min={0} value={dibayar} onChange={(e) => setDibayar(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <span className="text-sm text-muted-foreground">Sisa Hutang</span>
              <span className="text-lg font-semibold">{formatRupiah(sisaHutang)}</span>
            </div>
            <div className="grid gap-1 sm:text-right">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-semibold">{formatRupiah(grandTotal)}</span>
            </div>
          </div>

          <Button type="submit" disabled={processing || items.length === 0}>
            {editingId === null ? 'Simpan Pembelian' : 'Simpan Perubahan'}
          </Button>
        </form>

        <div className="grid gap-1 rounded-lg border p-3 sm:w-64">
          <span className="text-sm text-muted-foreground">
            Total Keseluruhan {(appliedHistoryDari || appliedHistorySampai) && <span className="font-normal">(sesuai filter)</span>}
          </span>
          <span className="text-lg font-semibold">{formatRupiah(totalKeseluruhan)}</span>
        </div>

        <form onSubmit={submitHistoryFilter} className="flex flex-wrap items-end gap-2 rounded-lg border p-4">
          <div className="grid gap-1">
            <Label className="text-xs">Dari</Label>
            <Input type="date" value={historyDari} onChange={(e) => setHistoryDari(e.target.value)} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Sampai</Label>
            <Input type="date" value={historySampai} onChange={(e) => setHistorySampai(e.target.value)} className="w-40" />
          </div>
          <Button type="submit" variant="secondary">
            Terapkan
          </Button>
          {(historyDari || historySampai || appliedHistoryDari || appliedHistorySampai) && (
            <Button type="button" variant="outline" onClick={resetHistoryFilter}>
              Reset
            </Button>
          )}
        </form>

        <ReportTable<PurchaseRow>
          title="Riwayat Pembelian"
          rows={purchases}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada pembelian."
          columns={[
            { key: 'tanggal', name: 'Tanggal', width: 130 },
            { key: 'supplierName', name: 'Supplier', width: 180, renderCell: ({ row }) => row.supplierName ?? '-' },
            { key: 'itemSummary', name: 'Item' },
            { key: 'catatan', name: 'Catatan', width: 180, renderCell: ({ row }) => row.catatan ?? '-' },
            {
              key: 'total',
              name: 'Total',
              width: 140,
              renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.total)}</span>,
            },
            {
              key: 'sisa',
              name: 'Sisa Hutang',
              width: 140,
              renderCell: ({ row }) => (
                <span className={`w-full text-right ${row.sisa > 0 ? 'text-destructive' : ''}`}>
                  {row.sisa > 0 ? formatRupiah(row.sisa) : '-'}
                </span>
              ),
            },
            {
              key: 'aksi',
              name: 'Aksi',
              width: 90,
              renderCell: ({ row }) => (
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon" title="Ubah" onClick={() => startEdit(row.id)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" title="Hapus" onClick={() => removePurchase(row)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ),
            },
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => loadPurchases(currentPage - 1)}>
              Sebelumnya
            </Button>
            <span className="text-sm text-muted-foreground">
              Halaman {currentPage} / {lastPage}
            </span>
            <Button variant="outline" size="sm" disabled={currentPage >= lastPage} onClick={() => loadPurchases(currentPage + 1)}>
              Berikutnya
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">dari {total} pembelian</span>
        </div>
      </Page>

      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="Cari Produk"
        description="Cari produk untuk ditambahkan ke pembelian"
        shouldFilter={false}
        value={paletteHighlighted}
        onValueChange={setPaletteHighlighted}
      >
        <CommandInput
          value={paletteQuery}
          onValueChange={setPaletteQuery}
          onKeyDown={handlePaletteKeyDown}
          placeholder="Cari nama / kode / barcode, atau scan barcode..."
        />
        <CommandList>
          <CommandEmpty>{paletteQuery.trim() === '' ? 'Ketik untuk mencari produk.' : 'Produk tidak ditemukan.'}</CommandEmpty>
          {paletteResults.length > 0 && (
            <CommandGroup heading="Produk">
              {paletteResults.map((product) => (
                <CommandItem key={product.id} value={product.id.toString()} onSelect={() => addItem(product)}>
                  {product.namaItem} <span className="text-muted-foreground">&middot; {product.kodeItem}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>

      <CommandDialog open={supplierPaletteOpen} onOpenChange={setSupplierPaletteOpen} title="Pilih Supplier" description="Cari supplier untuk pembelian ini">
        <CommandInput placeholder="Cari supplier..." />
        <CommandList>
          <CommandEmpty>Supplier tidak ditemukan.</CommandEmpty>
          <CommandGroup>
            <CommandItem
              value="Tanpa supplier"
              onSelect={() => {
                setSupplierId(null)
                setSupplierPaletteOpen(false)
              }}
            >
              Tanpa supplier
            </CommandItem>
            {supplierList.map((s) => (
              <CommandItem
                key={s.id}
                value={s.nama}
                onSelect={() => {
                  setSupplierId(s.id)
                  setSupplierPaletteOpen(false)
                }}
              >
                {s.nama}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <Dialog open={newSupplierOpen} onOpenChange={setNewSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supplier Baru</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitNewSupplier} className="space-y-3">
            <div className="grid gap-1">
              <Label>Nama</Label>
              <Input value={newSupplierNama} onChange={(e) => setNewSupplierNama(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Telepon (opsional)</Label>
              <Input value={newSupplierTelepon} onChange={(e) => setNewSupplierTelepon(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Alamat (opsional)</Label>
              <Input value={newSupplierAlamat} onChange={(e) => setNewSupplierAlamat(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Keterangan (opsional)</Label>
              <Input value={newSupplierKeterangan} onChange={(e) => setNewSupplierKeterangan(e.target.value)} />
            </div>
            <InputError message={newSupplierError ?? undefined} />
            <DialogFooter>
              <Button type="submit" disabled={newSupplierProcessing}>
                Tambahkan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {ConfirmDialog}
    </AppShell>
  )
}
