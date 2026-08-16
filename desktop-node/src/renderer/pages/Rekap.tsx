import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column } from 'react-data-grid'
import { ReportTable } from '@/components/report-table'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { METODE_LABEL } from '@/lib/metode'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface RekapSummary {
  omzetTunai: number
  omzetNonTunai: number
  piutangBeredar: number
  jumlahTransaksi: number
  labaKotor: number
}

interface LabaPerKategoriRow {
  categoryName: string
  omzet: number
  laba: number
}

interface LabaPerHariRow {
  tanggal: string
  omzet: number
  laba: number
}

interface LabaPerSatuanRow {
  satuan: string
  qtyTerjual: number
  omzet: number
  laba: number
  marginPersen: number
}

interface ProdukTerlarisRow {
  namaItem: string
  qtyTerjual: number
  totalPenjualan: number
}

interface PembelianPerSupplierRow {
  supplierName: string
  totalPembelian: number
}

interface StockValueRow {
  namaItem: string
  kodeItem: string
  satuan: string
  stok: number
  hargaPokok: number
  nilai: number
}

interface SalesHistoryRow {
  id: number
  createdAt: string
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}

function firstOfMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Rekap', href: '/rekap' }]

export function Rekap() {
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  const [summary, setSummary] = useState<RekapSummary | null>(null)
  const [labaPerKategori, setLabaPerKategori] = useState<LabaPerKategoriRow[]>([])
  const [labaPerHari, setLabaPerHari] = useState<LabaPerHariRow[]>([])
  const [labaPerSatuan, setLabaPerSatuan] = useState<LabaPerSatuanRow[]>([])
  const [produkTerlaris, setProdukTerlaris] = useState<ProdukTerlarisRow[]>([])
  const [pembelianPerSupplier, setPembelianPerSupplier] = useState<PembelianPerSupplierRow[]>([])
  const [stockValue, setStockValue] = useState<{ totalNilai: number; produk: StockValueRow[] } | null>(null)
  const [salesHistory, setSalesHistory] = useState<SalesHistoryRow[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  function load(rangeFrom: string, rangeTo: string) {
    window.api.rekap.getRekap({ from: rangeFrom, to: rangeTo }).then((result) => {
      setSummary(result.summary)
      setLabaPerKategori(result.labaPerKategori)
      setLabaPerHari(result.labaPerHari)
      setLabaPerSatuan(result.labaPerSatuan)
      setProdukTerlaris(result.produkTerlaris)
      setPembelianPerSupplier(result.pembelianPerSupplier)
      setStockValue(result.stockValue)
      setSalesHistory(result.salesHistory)
    })
  }

  useEffect(() => {
    load(from, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitFilter(e: FormEvent) {
    e.preventDefault()
    load(from, to)
  }

  function exportExcel() {
    setExporting(true)
    setExportError(null)
    setExportMessage(null)

    window.api.rekap
      .exportExcel({ from, to })
      .then((path) => {
        if (path) {
          setExportMessage(`Tersimpan ke ${path}`)
        }
      })
      .catch((err) => setExportError(err instanceof Error ? err.message : 'Gagal mengekspor'))
      .finally(() => setExporting(false))
  }

  const labaPerKategoriColumns: Column<LabaPerKategoriRow>[] = [
    { key: 'categoryName', name: 'Kategori', width: 180 },
    {
      key: 'omzet',
      name: 'Omzet',
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.omzet)}</span>,
    },
    {
      key: 'laba',
      name: 'Laba',
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.laba)}</span>,
    },
  ]

  const labaPerHariColumns: Column<LabaPerHariRow>[] = [
    {
      key: 'tanggal',
      name: 'Tanggal',
      width: 130,
      renderCell: ({ row }) => new Date(row.tanggal).toLocaleDateString('id-ID'),
    },
    {
      key: 'omzet',
      name: 'Omzet',
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.omzet)}</span>,
    },
    {
      key: 'laba',
      name: 'Laba',
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.laba)}</span>,
    },
  ]

  const labaPerSatuanColumns: Column<LabaPerSatuanRow>[] = [
    { key: 'satuan', name: 'Satuan', width: 110 },
    {
      key: 'qtyTerjual',
      name: 'Qty Terjual',
      renderCell: ({ row }) => <span className="w-full text-right">{row.qtyTerjual}</span>,
    },
    {
      key: 'omzet',
      name: 'Omzet',
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.omzet)}</span>,
    },
    {
      key: 'laba',
      name: 'Laba',
      renderCell: ({ row }) => (
        <span className={`w-full text-right${row.laba < 0 ? ' text-destructive' : ''}`}>{formatRupiah(row.laba)}</span>
      ),
    },
    {
      key: 'marginPersen',
      name: 'Margin',
      renderCell: ({ row }) => (
        <span className={`w-full text-right${row.laba < 0 ? ' text-destructive' : ''}`}>
          {row.marginPersen.toFixed(1)}%
        </span>
      ),
    },
  ]

  const produkTerlarisColumns: Column<ProdukTerlarisRow>[] = [
    { key: 'namaItem', name: 'Produk' },
    { key: 'qtyTerjual', name: 'Qty Terjual', width: 110 },
    {
      key: 'totalPenjualan',
      name: 'Total Penjualan',
      width: 150,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.totalPenjualan)}</span>,
    },
  ]

  const pembelianPerSupplierColumns: Column<PembelianPerSupplierRow>[] = [
    { key: 'supplierName', name: 'Supplier' },
    {
      key: 'totalPembelian',
      name: 'Total Pembelian',
      width: 150,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.totalPembelian)}</span>,
    },
  ]

  const stockValueColumns: Column<StockValueRow>[] = [
    { key: 'kodeItem', name: 'Kode', width: 100 },
    { key: 'namaItem', name: 'Produk' },
    { key: 'stok', name: 'Stok', width: 90 },
    { key: 'satuan', name: 'Satuan', width: 90 },
    {
      key: 'hargaPokok',
      name: 'Harga Pokok',
      width: 130,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.hargaPokok)}</span>,
    },
    {
      key: 'nilai',
      name: 'Nilai',
      width: 150,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.nilai)}</span>,
    },
  ]

  const salesHistoryColumns: Column<SalesHistoryRow>[] = [
    {
      key: 'createdAt',
      name: 'Tanggal',
      width: 160,
      renderCell: ({ row }) => new Date(row.createdAt).toLocaleString('id-ID'),
    },
    { key: 'namaPelanggan', name: 'Pelanggan', renderCell: ({ row }) => row.namaPelanggan ?? '-' },
    {
      key: 'metodePembayaran',
      name: 'Metode',
      width: 100,
      renderCell: ({ row }) => METODE_LABEL[row.metodePembayaran],
    },
    {
      key: 'status',
      name: 'Status',
      width: 110,
      renderCell: ({ row }) => (row.status === 'dibatalkan' ? 'Dibatalkan' : 'Selesai'),
    },
    {
      key: 'total',
      name: 'Total',
      width: 120,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.total)}</span>,
    },
    {
      key: 'dibayar',
      name: 'Dibayar',
      width: 120,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.dibayar)}</span>,
    },
  ]

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Rekap" />

        <form onSubmit={submitFilter} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Dari</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Sampai</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </div>
          <Button type="submit" variant="secondary">
            Terapkan
          </Button>
          <Button type="button" variant="outline" onClick={exportExcel} disabled={exporting}>
            Export Excel
          </Button>
        </form>

        {exportError && (
          <p role="alert" className="text-sm text-destructive">
            {exportError}
          </p>
        )}
        {exportMessage && <p className="text-sm text-muted-foreground">{exportMessage}</p>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Card>
            <CardHeader>
              <CardDescription>Omzet Tunai</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.omzetTunai ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>QRIS / Transfer</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.omzetNonTunai ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Piutang Bon Beredar</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.piutangBeredar ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Jumlah Transaksi</CardDescription>
              <CardTitle className="text-2xl">{summary?.jumlahTransaksi ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Laba Kotor</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.labaKotor ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Total Nilai Stock</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(stockValue?.totalNilai ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <ReportTable<SalesHistoryRow>
          title="Riwayat Transaksi"
          columns={salesHistoryColumns}
          rows={salesHistory}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada transaksi pada rentang ini."
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <ReportTable<ProdukTerlarisRow>
            title="Produk Terlaris"
            columns={produkTerlarisColumns}
            rows={produkTerlaris}
            rowKey={(row) => row.namaItem}
            emptyMessage="Belum ada penjualan."
          />
          <ReportTable<PembelianPerSupplierRow>
            title="Pembelian per Supplier"
            columns={pembelianPerSupplierColumns}
            rows={pembelianPerSupplier}
            rowKey={(row) => row.supplierName}
            emptyMessage="Belum ada pembelian."
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ReportTable<LabaPerKategoriRow>
            title="Laba per Kategori"
            columns={labaPerKategoriColumns}
            rows={labaPerKategori}
            rowKey={(row) => row.categoryName}
            emptyMessage="Belum ada penjualan."
          />
          <ReportTable<LabaPerHariRow>
            title="Laba per Hari"
            columns={labaPerHariColumns}
            rows={labaPerHari}
            rowKey={(row) => row.tanggal}
            emptyMessage="Belum ada penjualan."
          />
          <ReportTable<LabaPerSatuanRow>
            title="Laba per Satuan"
            columns={labaPerSatuanColumns}
            rows={labaPerSatuan}
            rowKey={(row) => row.satuan}
            emptyMessage="Belum ada penjualan."
          />
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Nilai stock selalu berdasarkan data terkini, tidak mengikuti filter tanggal di atas.</p>
          <ReportTable<StockValueRow>
            title="Nilai Stock"
            columns={stockValueColumns}
            rows={stockValue?.produk ?? []}
            rowKey={(row) => row.kodeItem}
            emptyMessage="Belum ada produk dengan stok."
          />
        </div>
      </Page>
    </AppShell>
  )
}
