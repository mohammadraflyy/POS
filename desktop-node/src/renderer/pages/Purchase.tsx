import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { ReportTable } from '@/components/report-table'
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
import { formatRupiah } from '@/lib/utils'
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
  units: { id: number; level: number; satuan: string; konversi: number }[]
}

interface PurchaseRow {
  id: number
  tanggal: string
  total: number
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

export function Purchase() {
  const [supplierList, setSupplierList] = useState<SupplierOption[]>([])
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierPaletteOpen, setSupplierPaletteOpen] = useState(false)
  const selectedSupplier = supplierList.find((s) => s.id === supplierId)

  const [tanggal, setTanggal] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [catatan, setCatatan] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<SearchResult[]>([])

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
        return prev.map((i) => (i.key === existing.key ? { ...i, qty: String(Number(i.qty || 0) + 1) } : i))
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

  const grandTotal = items.reduce((sum, i) => sum + Number(i.qty || 0) * Number(i.hargaBeli || 0), 0)

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
      const qtyNum = Number(item.qty)
      const hargaNum = Number(item.hargaBeli)

      if (item.qty.trim() === '' || !Number.isFinite(qtyNum) || qtyNum < 1) {
        setFormError(`Qty untuk "${item.namaItem}" harus diisi minimal 1.`)
        return
      }

      if (item.hargaBeli.trim() === '' || !Number.isFinite(hargaNum)) {
        setFormError(`Harga beli untuk "${item.namaItem}" wajib diisi.`)
        return
      }
    }

    setProcessing(true)
    setFormError(null)

    window.api.purchase
      .recordPurchase({
        supplierId,
        tanggal,
        catatan: catatan || null,
        items: items.map((item) => ({
          productId: item.productId,
          productUnitId: item.productUnitId,
          qty: Number(item.qty),
          hargaBeli: Number(item.hargaBeli),
        })),
      })
      .then(() => {
        setItems([])
        setCatatan('')
        setSupplierId(null)
        loadPurchases(1)
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pembelian')
      })
      .finally(() => setProcessing(false))
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Pembelian</h1>

        <form onSubmit={submit} className="space-y-4 rounded-xl border p-4">
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
                          type="number"
                          min={1}
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
                      <td className="p-2 text-right">{formatRupiah(Number(item.qty || 0) * Number(item.hargaBeli || 0))}</td>
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

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-lg font-semibold">{formatRupiah(grandTotal)}</span>
          </div>

          <Button type="submit" disabled={processing || items.length === 0}>
            Simpan Pembelian
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
      </div>

      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="Cari Produk"
        description="Cari produk untuk ditambahkan ke pembelian"
        shouldFilter={false}
      >
        <CommandInput value={paletteQuery} onValueChange={setPaletteQuery} placeholder="Cari nama / kode / barcode..." />
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
    </AppShell>
  )
}
