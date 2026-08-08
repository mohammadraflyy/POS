import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column } from 'react-data-grid'
import { ReportTable } from '@/components/report-table'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface RekapSummary {
  omzetTunai: number
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

interface ProdukTerlarisRow {
  namaItem: string
  qtyTerjual: number
  totalPenjualan: number
}

interface PembelianPerSupplierRow {
  supplierName: string
  totalPembelian: number
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
  const [produkTerlaris, setProdukTerlaris] = useState<ProdukTerlarisRow[]>([])
  const [pembelianPerSupplier, setPembelianPerSupplier] = useState<PembelianPerSupplierRow[]>([])

  function load(rangeFrom: string, rangeTo: string) {
    window.api.rekap.getRekap({ from: rangeFrom, to: rangeTo }).then((result) => {
      setSummary(result.summary)
      setLabaPerKategori(result.labaPerKategori)
      setLabaPerHari(result.labaPerHari)
      setProdukTerlaris(result.produkTerlaris)
      setPembelianPerSupplier(result.pembelianPerSupplier)
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

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Rekap</h1>

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
        </form>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Omzet Tunai</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(summary?.omzetTunai ?? 0)}</CardTitle>
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
        </div>

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
        </div>
      </div>
    </AppShell>
  )
}
