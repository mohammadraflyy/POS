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
  units: { id: number; satuan: string; konversi: number }[]
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
  units: { id: number; satuan: string; konversi: number }[]
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
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierPaletteOpen, setSupplierPaletteOpen] = useState(false)
  const selectedSupplier = supplierList.find((s) => s.id === supplierId)

  const [tanggal, setTanggal] = useState(todayIso)
  const [catatan, setCatatan] = useState('')
  // empty means "paid in full"; anything lower leaves the remainder as supplier debt (BON)
  const [dibayar, setDibayar] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // the invoice being corrected, or null while entering a new one
  const [editingId, setEditingId] = useState<number | null>(null)
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

  const { confirm, ConfirmDialog } = useConfirm()

  function loadSuppliers() {
    window.api.supplier.listSuppliers({ page: 1, pageSize: 100 }).then((result) => {
      setSupplierList(result.data.map((s) => ({ id: s.id, nama: s.nama })))
    })
  }

  function loadPurchases(page: number) {
    window.api.purchase.listPurchases({ page }).then((result) => {
      setPurchases(result.data)
      setCurrentPage(result.currentPage)
      setLastPage(result.lastPage)
      setTotal(result.total)
    })
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
          return { ...i, productUnitId: value === 'base' ? null : Number(value) }
        }
        return { ...i, [field]: value }
      }),
    )
  }

  function resetForm() {
    setItems([])
    setCatatan('')
    setDibayar('')
    setSupplierId(null)
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

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Pembelian" />

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
