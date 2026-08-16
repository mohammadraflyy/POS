import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ReportTable } from '@/components/report-table'
import { METODE_LABEL } from '@/lib/metode'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SaleDetailItem {
  id: number
  productId: number
  productUnitId: number | null
  qty: number
  satuan: string | null
  namaItem: string
  hargaJual: number
  subtotal: number
  priceSource: 'normal' | 'price_tier' | 'manual'
}

interface BonPaymentRow {
  id: number
  jumlah: number
  tanggal: string
  keterangan: string | null
}

interface KasirProduct {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  satuan: string
  hargaJual: number
  stok: number
  baseProductUnitId: number
  productUnits: { id: number; satuan: string; konversi: number; hargaJual: number }[]
}

interface SaleDetailData {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  createdAt: string
  kasirName: string | null
  items: SaleDetailItem[]
  bonPayments: BonPaymentRow[]
}

// Accepts a plain decimal, with either dot or comma as separator (Indonesian
// input uses comma). Rejects scientific notation, signs, and anything else
// `Number()` would otherwise accept unsanitised.
const QTY_PATTERN = /^\d+([.,]\d+)?$/

const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/kasir' },
  { title: 'Riwayat Transaksi', href: '/history' },
]

const ITEM_COLUMNS: Column<SaleDetailItem>[] = [
  { key: 'namaItem', name: 'Item', width: 320 },
  {
    key: 'qty',
    name: 'Qty',
    width: 100,
    renderCell: ({ row }) => <span className="w-full text-right">{row.qty}</span>,
  },
  { key: 'satuan', name: 'Satuan', width: 100, renderCell: ({ row }) => row.satuan ?? '-' },
  {
    key: 'hargaJual',
    name: 'Harga',
    width: 140,
    renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.hargaJual)}</span>,
  },
  {
    key: 'subtotal',
    name: 'Subtotal',
    width: 140,
    renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.subtotal)}</span>,
  },
]

const PAYMENT_COLUMNS: Column<BonPaymentRow>[] = [
  { key: 'tanggal', name: 'Tanggal', width: 160 },
  {
    key: 'jumlah',
    name: 'Jumlah',
    width: 160,
    renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.jumlah)}</span>,
  },
  { key: 'keterangan', name: 'Keterangan', width: 320, renderCell: ({ row }) => row.keterangan ?? '-' },
]

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}

export function SaleDetail() {
  const navigate = useNavigate()
  const { saleId } = useParams<{ saleId: string }>()
  const [sale, setSale] = useState<SaleDetailData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  function loadSale() {
    window.api.kasir
      .getSaleDetail(Number(saleId))
      .then((data) => {
        setSale(data)
        setLoadError(null)
      })
      .catch(() => setLoadError('Gagal memuat transaksi.'))
  }

  useEffect(() => {
    loadSale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId])

  const sisa = sale ? sale.total - sale.dibayar : 0

  const [addOpen, setAddOpen] = useState(false)
  const [catalog, setCatalog] = useState<KasirProduct[]>([])
  const [pickedId, setPickedId] = useState('')
  const [pickedUnitId, setPickedUnitId] = useState('base')
  const [qty, setQty] = useState('1')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  // Mirrors `saving` but updates synchronously, so a second submit dispatched
  // before the disabled-button re-render commits still sees it in time.
  const savingRef = useRef(false)

  useEffect(() => {
    if (!addOpen || catalog.length > 0) {
      return
    }

    window.api.kasir
      .listProducts()
      .then(setCatalog)
      .catch(() => setAddError('Gagal memuat daftar produk.'))
  }, [addOpen, catalog.length])

  const picked = catalog.find((product) => product.id === Number(pickedId))

  async function submitAddItem(e: FormEvent) {
    e.preventDefault()

    // Guard against a second submit (e.g. Enter key) landing before the
    // disabled button re-renders; the IPC round trip is real stock movement.
    // A ref updates synchronously, unlike the `saving` state, so this closes
    // the window the state check alone would miss.
    if (savingRef.current) {
      return
    }

    const productId = Number(pickedId)

    if (!productId) {
      setAddError('Pilih produk dan isi qty lebih dari 0.')

      return
    }

    const normalizedQty = qty.trim().replace(',', '.')

    if (!QTY_PATTERN.test(normalizedQty)) {
      setAddError('Qty harus berupa angka desimal, contoh: 1.5 atau 1,5.')

      return
    }

    const jumlah = Number(normalizedQty)

    if (!(jumlah > 0)) {
      setAddError('Pilih produk dan isi qty lebih dari 0.')

      return
    }

    savingRef.current = true
    setSaving(true)
    setAddError(null)

    try {
      await window.api.kasir.addItemsToSale({
        saleId: Number(saleId),
        items: [{ productId, productUnitId: pickedUnitId === 'base' ? null : Number(pickedUnitId), qty: jumlah }],
      })

      setPickedId('')
      setPickedUnitId('base')
      setQty('1')
      setAddOpen(false)
      // Stock just moved; drop the cached catalog so reopening the panel
      // refetches fresh `stok` numbers instead of showing pre-append counts.
      setCatalog([])
      loadSale()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Gagal menambah item')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <AppShell breadcrumbs={[...BREADCRUMBS, { title: `Transaksi #${saleId}`, href: `/sale/${saleId}` }]}>
      <Page>
        <PageHeader
          title={`Transaksi #${saleId}`}
          actions={
            <Button variant="outline" onClick={() => navigate('/history')}>
              Kembali ke Riwayat
            </Button>
          }
        />

        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}

        {sale && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tanggal" value={new Date(sale.createdAt).toLocaleString('id-ID')} />
              <Field label="Pelanggan" value={sale.namaPelanggan ?? 'UMUM'} />
              <Field label="Metode" value={METODE_LABEL[sale.metodePembayaran]} />
              <Field label="Kasir" value={sale.kasirName ?? '-'} />
            </div>

            <ReportTable
              title="Item"
              columns={ITEM_COLUMNS}
              rows={sale.items}
              rowKey={(row) => row.id}
              emptyMessage="Transaksi ini tidak punya item."
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Total" value={formatRupiah(sale.total)} />
              <Field label="Dibayar" value={formatRupiah(sale.dibayar)} />
              <Field
                label={sale.status === 'dibatalkan' ? 'Status' : 'Sisa'}
                value={sale.status === 'dibatalkan' ? 'Dibatalkan' : formatRupiah(sisa)}
              />
            </div>

            {sale.bonPayments.length > 0 && (
              <ReportTable
                title="Riwayat Pembayaran Bon"
                columns={PAYMENT_COLUMNS}
                rows={sale.bonPayments}
                rowKey={(row) => row.id}
                emptyMessage="Belum ada pembayaran."
              />
            )}

            {sale.metodePembayaran === 'bon' && sale.status === 'selesai' && sisa > 0 && (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Tambah Item ke Bon</h2>
                  <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen((open) => !open)}>
                    {addOpen ? 'Tutup' : 'Tambah Item'}
                  </Button>
                </div>

                {addOpen && (
                  <form onSubmit={submitAddItem} className="flex flex-wrap items-end gap-2">
                    <div className="grid gap-1">
                      <Label className="text-xs">Produk</Label>
                      <select
                        value={pickedId}
                        onChange={(e) => {
                          setPickedId(e.target.value)
                          setPickedUnitId('base')
                        }}
                        className="h-9 w-72 rounded-md border bg-transparent px-3 text-sm"
                      >
                        <option value="">Pilih produk...</option>
                        {catalog.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.namaItem} (stok {product.stok})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-1">
                      <Label className="text-xs">Satuan</Label>
                      <select
                        value={pickedUnitId}
                        onChange={(e) => setPickedUnitId(e.target.value)}
                        className="h-9 w-40 rounded-md border bg-transparent px-3 text-sm"
                      >
                        <option value="base">{picked?.satuan ?? 'Satuan dasar'}</option>
                        {picked?.productUnits
                          .filter((unit) => unit.id !== picked.baseProductUnitId)
                          .map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.satuan}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="grid gap-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        value={qty}
                        inputMode="decimal"
                        onChange={(e) => setQty(e.target.value)}
                        className="w-28 text-right"
                      />
                    </div>

                    <Button type="submit" disabled={saving}>
                      {saving ? 'Menyimpan...' : 'Simpan'}
                    </Button>
                  </form>
                )}

                {addError && (
                  <p role="alert" className="text-sm text-destructive">
                    {addError}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Page>
    </AppShell>
  )
}
