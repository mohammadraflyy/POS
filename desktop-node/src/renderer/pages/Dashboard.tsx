import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { TriangleAlert } from 'lucide-react'
import { Page, PageHeader } from '@/components/page'
import { ReportTable } from '@/components/report-table'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface DashboardSummary {
  omzetTunai: number
  piutangBeredar: number
  jumlahTransaksi: number
  labaKotor: number
}

interface StokMenipisRow {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  stok: number
}

interface ProdukTerlarisRow {
  namaItem: string
  qtyTerjual: number
  totalPenjualan: number
}

interface TransaksiTerbaruRow {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  createdAt: string
  itemSummary: string
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Dashboard', href: '/' }]

export function Dashboard() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [stokMenipis, setStokMenipis] = useState<StokMenipisRow[]>([])
  const [produkTerlarisHariIni, setProdukTerlarisHariIni] = useState<ProdukTerlarisRow[]>([])
  const [transaksiTerbaru, setTransaksiTerbaru] = useState<TransaksiTerbaruRow[]>([])

  useEffect(() => {
    window.api.dashboard.getDashboard().then((result) => {
      setSummary(result.summary)
      setStokMenipis(result.stokMenipis)
      setProdukTerlarisHariIni(result.produkTerlarisHariIni)
      setTransaksiTerbaru(result.transaksiTerbaru)
    })
  }, [])

  const stokMenipisColumns: Column<StokMenipisRow>[] = [
    { key: 'kodeItem', name: 'Kode', width: 90 },
    { key: 'namaItem', name: 'Produk' },
    {
      key: 'stok',
      name: 'Stok',
      width: 100,
      renderCell: ({ row }) => (
        <span className="flex w-full items-center justify-end gap-1 text-right">
          {row.stok <= 0 && <TriangleAlert className="size-3.5 text-destructive" />}
          {row.stok} {row.satuan}
        </span>
      ),
    },
  ]

  const produkTerlarisColumns: Column<ProdukTerlarisRow>[] = [
    { key: 'namaItem', name: 'Produk' },
    { key: 'qtyTerjual', name: 'Qty', width: 80 },
    {
      key: 'totalPenjualan',
      name: 'Total',
      width: 130,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.totalPenjualan)}</span>,
    },
  ]

  const transaksiColumns: Column<TransaksiTerbaruRow>[] = [
    {
      key: 'createdAt',
      name: 'Waktu',
      width: 160,
      renderCell: ({ row }) => new Date(row.createdAt).toLocaleString('id-ID'),
    },
    { key: 'itemSummary', name: 'Item' },
    {
      key: 'metodePembayaran',
      name: 'Metode',
      width: 110,
      renderCell: ({ row }) => (row.metodePembayaran === 'bon' ? `Bon (${row.namaPelanggan})` : 'Tunai'),
    },
    {
      key: 'status',
      name: 'Status',
      width: 130,
      renderCell: ({ row }) => {
        if (row.status === 'dibatalkan') {
          return <span className="text-destructive">Dibatalkan</span>
        }

        const sisaPiutang = row.total - row.dibayar

        if (row.metodePembayaran === 'bon' && sisaPiutang > 0) {
          return <span className="text-amber-600 dark:text-amber-400">Sisa {formatRupiah(sisaPiutang)}</span>
        }

        return <span className="text-green-600 dark:text-green-400">Lunas</span>
      },
    },
    {
      key: 'total',
      name: 'Total',
      width: 120,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.total)}</span>,
    },
  ]

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader
          title="Dashboard"
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate('/rekap')}>
              Lihat Rekap Lengkap
            </Button>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Omzet Hari Ini</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.omzetTunai ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Transaksi Hari Ini</CardDescription>
              <CardTitle className="text-2xl">{summary?.jumlahTransaksi ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Laba Hari Ini</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.labaKotor ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Piutang Bon Beredar</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.piutangBeredar ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ReportTable<StokMenipisRow>
            title="Stok Menipis"
            columns={stokMenipisColumns}
            rows={stokMenipis}
            rowKey={(row) => row.id}
            emptyMessage="Semua stok aman."
            action={
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => navigate('/inventory')}
              >
                Lihat semua
              </button>
            }
          />
          <ReportTable<ProdukTerlarisRow>
            title="Produk Terlaris Hari Ini"
            columns={produkTerlarisColumns}
            rows={produkTerlarisHariIni}
            rowKey={(row) => row.namaItem}
            emptyMessage="Belum ada penjualan hari ini."
          />
        </div>

        <ReportTable<TransaksiTerbaruRow>
          title="Transaksi Terbaru"
          columns={transaksiColumns}
          rows={transaksiTerbaru}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada transaksi."
          action={
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => navigate('/history')}
            >
              Lihat semua
            </button>
          }
        />
      </Page>
    </AppShell>
  )
}
