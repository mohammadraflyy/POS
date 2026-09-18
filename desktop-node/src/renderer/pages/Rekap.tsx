import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStickyState } from '@/hooks/use-sticky-state'
import type { FormEvent } from 'react'
import type { Column } from 'react-data-grid'
import { ReportTable } from '@/components/report-table'
import { Page, PageHeader } from '@/components/page'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { METODE_LABEL } from '@/lib/metode'
import { cn, formatQty, formatRupiah, formatTanggal } from '@/lib/utils'
import { EfisiensiHargaDialog } from './rekap/EfisiensiHargaDialog'
import { CostCorrectionDialog, CostCorrectionHistoryDialog, type CorrectionTarget } from './rekap/CostCorrectionDialog'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface RekapSummary {
  omzetTunai: number
  omzetNonTunai: number
  piutangBeredar: number
  jumlahTransaksi: number
  labaKotor: number
}

/** one line of the laba ladder: a label on the left, the amount on the right */
function BarisHitung({
  label,
  nilai,
  tanda = false,
  tebal = false,
  warnai = false,
}: {
  label: string
  nilai: number
  /** render as a subtraction (the caller passes a negative amount) */
  tanda?: boolean
  tebal?: boolean
  /** red when negative, green when positive - only the bottom line uses this */
  warnai?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={tebal ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span
        className={cn(
          tebal && 'font-semibold',
          warnai && (nilai < 0 ? 'text-destructive' : 'text-green-700 dark:text-green-400'),
        )}
      >
        {tanda ? `- ${formatRupiah(Math.abs(nilai))}` : formatRupiah(nilai)}
      </span>
    </div>
  )
}

interface BarisRugiRow {
  saleItemId: number
  productUnitId: number | null
  productId: number
  saleId: number
  tanggal: string
  namaItem: string
  satuan: string
  qty: number
  /** price of one of the unit sold, before any discount */
  hargaJual: number
  /** cost of one of the same unit */
  hargaPokok: number
  /** the line's own discount plus its share of the bill-wide one */
  diskon: number
  omzet: number
  modal: number
  laba: number
}

interface SaranLaba {
  status: 'aktif' | 'riwayat' | 'diperbaiki'
  kode: 'harga_di_bawah_modal' | 'diskon_memakan_margin' | 'satuan_margin_tipis' | 'katalog_di_bawah_margin'
  jumlah: number
  nilai: number
  persen: number
  contoh: string[]
  produk: { productId: number; namaItem: string; satuan: string }[]
  saleIds: number[]
}

/** the wording for each kind of advice; the numbers come from the report itself */
function isiSaran(saran: SaranLaba): { judul: string; detail: string } {
  switch (saran.kode) {
    case 'harga_di_bawah_modal':
      return {
        judul: saran.status === 'diperbaiki' ? 'Harga katalog sudah memenuhi margin minimal' : `Evaluasi harga jual ${saran.jumlah} barang`,
        detail: `Pada periode ini ada barang terjual dengan harga di bawah HPP tercatat. Total rugi baris terkait, termasuk diskon, ${formatRupiah(
          Math.abs(saran.nilai),
        )}. Contoh: ${saran.contoh.join(', ')}. ${saran.status === 'diperbaiki' ? 'Harga katalog saat ini sudah memenuhi target untuk transaksi berikutnya. Kerugian lama tetap menjadi riwayat.' : 'Periksa harga katalog dan kebenaran HPP transaksi. Jika modalnya salah input, gunakan Koreksi HPP pada baris rugi.'}`,
      }
    case 'diskon_memakan_margin':
      return {
        judul: `Batasi diskon di bawah ${saran.persen.toFixed(1)}%`,
        detail: `Diskon periode ini ${formatRupiah(
          saran.nilai,
        )} dan memakan lebih dari separuh margin. Barang yang terjual periode ini rata-rata hanya sanggup menanggung diskon ${saran.persen.toFixed(
          1,
        )}% sebelum mulai rugi.`,
      }
    case 'satuan_margin_tipis':
      return {
        judul: `Evaluasi margin historis satuan ${saran.contoh[0] ?? '-'}`,
        detail: `Margin transaksi satuan ini pada periode terpilih ${saran.persen.toFixed(1)}% dari ${formatQty(
          saran.jumlah,
        )} terjual. Kalau dibeli grosir, catat pembeliannya dalam satuan ${
          saran.contoh[0] ?? 'itu'
        } supaya harga pokoknya ikut turun - membeli dalam satuan eceran tidak pernah menurunkan modal satuan besar.`,
      }
    case 'katalog_di_bawah_margin':
      return {
        judul: `${saran.jumlah} satuan di katalog masih di bawah margin minimal ${saran.persen}%`,
        detail:
          'Harga katalog saat ini belum mencapai target laba. Periksa rekomendasi harga di halaman produk atau target margin di Pengaturan. Margin di bawah target belum tentu berarti rugi.',
      }
  }
}

interface PenjelasanLaba {
  penjualanKotor: number
  diskonItem: number
  diskonNota: number
  omzet: number
  modal: number
  labaKotor: number
  jumlahBarisRugi: number
  totalRugi: number
  barisRugi: BarisRugiRow[]
  saran: SaranLaba[]
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

interface PiutangPerPelangganRow {
  customerId: number | null
  namaPelanggan: string
  telepon: string | null
  totalPiutang: number
  jumlahBon: number
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

/**
 * Hides the bulk price-raise tool. The feature is complete and tested (main/harga-efisiensi.ts,
 * inventory:previewEfisiensiHarga / applyEfisiensiHarga) - it is only kept out of sight until the
 * owner wants it. Flip to true to bring the button back.
 */
const EFISIENSI_HARGA_AKTIF = false

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Rekap', href: '/rekap' }]

export function Rekap() {
  const [from, setFrom] = useStickyState('rekap:from', firstOfMonth())
  const [to, setTo] = useStickyState('rekap:to', today())
  // what the tables below actually reflect right now - only moves when a load lands,
  // so it never gets ahead of the date inputs while a "Terapkan" click is still pending
  const [appliedFrom, setAppliedFrom] = useState(from)
  const [appliedTo, setAppliedTo] = useState(to)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<RekapSummary | null>(null)
  const [penjelasanLaba, setPenjelasanLaba] = useState<PenjelasanLaba | null>(null)
  const [efisiensiOpen, setEfisiensiOpen] = useState(false)
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null)
  const [correctionHistoryOpen, setCorrectionHistoryOpen] = useState(false)
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [labaPerKategori, setLabaPerKategori] = useState<LabaPerKategoriRow[]>([])
  const [labaPerHari, setLabaPerHari] = useState<LabaPerHariRow[]>([])
  const [labaPerSatuan, setLabaPerSatuan] = useState<LabaPerSatuanRow[]>([])
  const [produkTerlaris, setProdukTerlaris] = useState<ProdukTerlarisRow[]>([])
  const [pembelianPerSupplier, setPembelianPerSupplier] = useState<PembelianPerSupplierRow[]>([])
  const [piutangPerPelanggan, setPiutangPerPelanggan] = useState<PiutangPerPelangganRow[]>([])
  const [stockValue, setStockValue] = useState<{ totalNilai: number; produk: StockValueRow[] } | null>(null)
  const [salesHistory, setSalesHistory] = useState<SalesHistoryRow[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  function load(rangeFrom: string, rangeTo: string) {
    setLoading(true)
    setLoadError(null)
    window.api.rekap
      .getRekap({ from: rangeFrom, to: rangeTo })
      .then((result) => {
        setSummary(result.summary)
        setPenjelasanLaba(result.penjelasanLaba)
        setLabaPerKategori(result.labaPerKategori)
        setLabaPerHari(result.labaPerHari)
        setLabaPerSatuan(result.labaPerSatuan)
        setProdukTerlaris(result.produkTerlaris)
        setPembelianPerSupplier(result.pembelianPerSupplier)
        setPiutangPerPelanggan(result.piutangPerPelanggan)
        setStockValue(result.stockValue)
        setSalesHistory(result.salesHistory)
        setAppliedFrom(rangeFrom)
        setAppliedTo(rangeTo)
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Gagal memuat Rekap.'))
      .finally(() => setLoading(false))
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
      renderCell: ({ row }) => formatTanggal(row.tanggal),
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

  const piutangPerPelangganColumns: Column<PiutangPerPelangganRow>[] = [
    { key: 'namaPelanggan', name: 'Pelanggan' },
    { key: 'telepon', name: 'Telepon', width: 140, renderCell: ({ row }) => row.telepon ?? '-' },
    {
      key: 'jumlahBon',
      name: 'Bon Belum Lunas',
      width: 130,
      renderCell: ({ row }) => <span className="w-full text-right">{row.jumlahBon}</span>,
    },
    {
      key: 'totalPiutang',
      name: 'Total Piutang',
      width: 150,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.totalPiutang)}</span>,
    },
  ]

  const stockValueColumns: Column<StockValueRow>[] = [
    { key: 'kodeItem', name: 'Kode', width: 100 },
    { key: 'namaItem', name: 'Produk' },
    {
      key: 'stok',
      name: 'Stok',
      width: 90,
      renderCell: ({ row }) => <span className="w-full text-right">{formatQty(row.stok)}</span>,
    },
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

  const periodeLabel = `${formatTanggal(appliedFrom)} – ${formatTanggal(appliedTo)}`
  // total pendapatan = semua uang yang benar-benar lunas pada periode ini, tunai maupun
  // non-tunai - laba kotor dihitung dari transaksi yang sama, jadi margin-nya harus dibagi
  // terhadap angka ini, bukan terhadap omzetTunai saja
  const totalPendapatan = (summary?.omzetTunai ?? 0) + (summary?.omzetNonTunai ?? 0)
  const marginKotorPersen = summary && totalPendapatan > 0 ? (summary.labaKotor / totalPendapatan) * 100 : 0

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Rekap" description="Ringkasan penjualan, laba, dan stok toko." />

        <form onSubmit={submitFilter} className="flex flex-wrap items-end gap-2 rounded-lg border p-4">
          <div className="grid gap-1">
            <Label className="text-xs">Dari</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Sampai</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </div>
          <Button type="submit" variant="secondary" disabled={loading}>
            {loading ? 'Memuat...' : 'Terapkan'}
          </Button>
          <Button type="button" variant="outline" onClick={exportExcel} disabled={exporting}>
            {exporting ? 'Mengekspor...' : 'Export Excel'}
          </Button>
          <Button type="button" variant="outline" onClick={() => setCorrectionHistoryOpen(true)}>Riwayat koreksi HPP</Button>
        </form>
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        {correctionMessage && <p role="status" className="text-sm text-muted-foreground">{correctionMessage}</p>}

        {exportError && (
          <p role="alert" className="text-sm text-destructive">
            {exportError}
          </p>
        )}
        {exportMessage && <p className="text-sm text-muted-foreground">{exportMessage}</p>}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Ringkasan periode <span className="text-foreground">{periodeLabel}</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="gap-3 border-primary/30 bg-primary/5 pb-0">
              <CardHeader>
                <CardDescription>Total Pendapatan</CardDescription>
                <CardTitle className="text-2xl">{formatRupiah(totalPendapatan)}</CardTitle>
                <p className="text-xs leading-snug text-muted-foreground">
                  Semua metode bayar digabung, sebelum dikurangi harga pokok.
                </p>
              </CardHeader>
              <Accordion type="single" collapsible>
                <AccordionItem value="rincian" className="border-b-0">
                  <AccordionTrigger className="px-6 py-2 text-xs font-normal text-muted-foreground hover:no-underline">
                    Lihat rincian per metode bayar
                  </AccordionTrigger>
                  <AccordionContent className="px-6">
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="flex items-center gap-2 text-muted-foreground">
                          <span className="size-2 rounded-full bg-primary" aria-hidden />
                          Tunai
                        </dt>
                        <dd className="font-medium">{formatRupiah(summary?.omzetTunai ?? 0)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="flex items-center gap-2 text-muted-foreground">
                          <span className="size-2 rounded-full bg-primary/40" aria-hidden />
                          QRIS / Transfer
                        </dt>
                        <dd className="font-medium">{formatRupiah(summary?.omzetNonTunai ?? 0)}</dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-xs leading-snug text-muted-foreground">
                      Tunai: penjualan tunai + bon yang baru lunas pada periode ini. QRIS/Transfer: uang nyata, tapi
                      tidak masuk laci kas.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Jumlah Transaksi</CardDescription>
                <CardTitle className="text-2xl">{summary?.jumlahTransaksi ?? 0}</CardTitle>
                <p className="text-xs leading-snug text-muted-foreground">
                  Transaksi tunai/QRIS/Transfer + bon yang lunas pada periode ini. Bon yang belum lunas belum
                  dihitung sebagai transaksi.
                </p>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Laba Kotor</CardDescription>
                <CardTitle className="text-2xl">{formatRupiah(summary?.labaKotor ?? 0)}</CardTitle>
                <p className="text-xs leading-snug text-muted-foreground">
                  {summary && summary.jumlahTransaksi > 0
                    ? `≈ ${marginKotorPersen.toFixed(1)}% dari Total Pendapatan - sisanya adalah harga pokok barang yang terjual. Belum dikurangi pengeluaran kas.`
                    : 'Total Pendapatan dikurangi harga pokok barang yang terjual pada periode ini.'}
                </p>
              </CardHeader>
            </Card>
          </div>

          {penjelasanLaba && (
            <Card>
              <CardHeader>
                <CardDescription>Penjelasan Laba</CardDescription>
                <CardTitle className="text-base">
                  Dari harga jual sampai laba &mdash; {periodeLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="max-w-md space-y-1 text-sm tabular-nums">
                  <BarisHitung label="Penjualan kotor (harga jual x qty)" nilai={penjelasanLaba.penjualanKotor} />
                  <BarisHitung label="Diskon item" nilai={-penjelasanLaba.diskonItem} tanda />
                  <BarisHitung label="Diskon nota" nilai={-penjelasanLaba.diskonNota} tanda />
                  <div className="border-t pt-1">
                    <BarisHitung label="Omzet (yang benar-benar diterima)" nilai={penjelasanLaba.omzet} tebal />
                  </div>
                  <BarisHitung label="Modal / harga pokok barang terjual" nilai={-penjelasanLaba.modal} tanda />
                  <div className="border-t pt-1">
                    <BarisHitung label="Laba kotor" nilai={penjelasanLaba.labaKotor} tebal warnai />
                  </div>
                </div>

                {penjelasanLaba.barisRugi.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      <span className="font-semibold text-destructive">
                        {penjelasanLaba.jumlahBarisRugi} baris
                      </span>{' '}
                      terjual di bawah modal, menarik laba turun {formatRupiah(Math.abs(penjelasanLaba.totalRugi))}.
                      {penjelasanLaba.barisRugi.length < penjelasanLaba.jumlahBarisRugi &&
                        ` ${penjelasanLaba.barisRugi.length} terbesar:`}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[40rem] text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="py-1 pr-3 font-medium">Item</th>
                            <th className="py-1 pr-3 font-medium">Perhitungan</th>
                            <th className="py-1 text-right font-medium">Laba</th>
                            <th className="py-1 pl-3 font-medium">Perbaiki</th>
                          </tr>
                        </thead>
                        <tbody>
                          {penjelasanLaba.barisRugi.map((row) => (
                            <tr key={row.saleItemId} className="border-b last:border-0">
                              <td className="py-1.5 pr-3">
                                {row.namaItem}{' '}
                                <span className="text-muted-foreground">
                                  ({row.satuan}) &middot; nota #{row.saleId}
                                </span>
                              </td>
                              <td className="py-1.5 pr-3 text-xs tabular-nums text-muted-foreground">
                                {formatQty(row.qty)} x ({formatRupiah(row.hargaJual)} jual &minus;{' '}
                                {formatRupiah(row.hargaPokok)} modal)
                                {row.diskon > 0 && <> &minus; diskon {formatRupiah(row.diskon)}</>}
                              </td>
                              <td className="py-1.5 text-right font-medium text-destructive tabular-nums">
                                {formatRupiah(row.laba)}
                              </td>
                              <td className="py-1.5 pl-3">
                                <div className="flex gap-2">
                                  <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => setCorrectionTarget(row)}>Koreksi HPP</Button>
                                  <Button asChild variant="outline" size="sm"><Link to={`/inventory/mass-input?ids=${row.productId}`}>Edit produk</Link></Button>
                                  <Button asChild variant="outline" size="sm"><Link to={`/kasir?edit=${row.saleId}`}>Edit nota</Link></Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Tidak ada barang yang terjual di bawah modal pada periode ini.
                  </p>
                )}

                {penjelasanLaba.saran.length > 0 && (
                  <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Rekomendasi dan evaluasi laba</p>
                      {EFISIENSI_HARGA_AKTIF && (
                        <Button type="button" size="sm" variant="outline" onClick={() => setEfisiensiOpen(true)}>
                          Naikkan Harga
                        </Button>
                      )}
                    </div>
                    <ol className="space-y-2">
                      {penjelasanLaba.saran.map((saran, index) => {
                        const { judul, detail } = isiSaran(saran)

                        return (
                          <li key={saran.kode} className="flex gap-2 text-sm">
                            <span className="font-semibold tabular-nums text-muted-foreground">{index + 1}.</span>
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="font-medium">{judul}</span>
                                <Badge variant="outline" className={saran.status === 'diperbaiki' ? 'border-green-600 text-green-700 dark:text-green-400' : saran.status === 'aktif' ? 'border-amber-500 text-amber-700 dark:text-amber-400' : undefined}>
                                  {saran.status === 'diperbaiki' ? 'Katalog sudah sesuai' : saran.status === 'riwayat' ? 'Evaluasi riwayat' : 'Perlu ditinjau'}
                                </Badge>
                              </div>
                              <span className="block text-xs leading-relaxed text-muted-foreground">{detail}</span>
                              <div className="mt-2"><AksiSaran saran={saran} /></div>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                    {EFISIENSI_HARGA_AKTIF && (
                      <p className="text-xs text-muted-foreground">
                        Tombol di atas hanya menaikkan harga jual. Diskon dan harga beli tetap keputusan Anda.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            Kondisi saat ini
            <Badge variant="outline">Tidak mengikuti filter tanggal</Badge>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription>Piutang Bon Beredar</CardDescription>
                <CardTitle className="text-2xl">{formatRupiah(summary?.piutangBeredar ?? 0)}</CardTitle>
                <p className="text-xs leading-snug text-muted-foreground">
                  Total sisa tagihan bon yang belum lunas dari semua pelanggan, sepanjang waktu - bukan hanya dari
                  periode {periodeLabel}.
                </p>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Total Nilai Stock</CardDescription>
                <CardTitle className="text-2xl">{formatRupiah(stockValue?.totalNilai ?? 0)}</CardTitle>
                <p className="text-xs leading-snug text-muted-foreground">
                  Stok yang ada sekarang dikali harga pokoknya masing-masing - kondisi gudang saat ini, bukan
                  periode {periodeLabel}.
                </p>
              </CardHeader>
            </Card>
          </div>
          <ReportTable<PiutangPerPelangganRow>
            title="Piutang per Pelanggan"
            columns={piutangPerPelangganColumns}
            rows={piutangPerPelanggan}
            rowKey={(row) => row.customerId ?? row.namaPelanggan}
            emptyMessage="Tidak ada piutang bon yang beredar."
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Riwayat transaksi <span className="text-foreground">{periodeLabel}</span>
          </h2>
          <ReportTable<SalesHistoryRow>
            title="Riwayat Transaksi"
            columns={salesHistoryColumns}
            rows={salesHistory}
            rowKey={(row) => row.id}
            emptyMessage="Belum ada transaksi pada rentang ini."
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Produk &amp; supplier <span className="text-foreground">{periodeLabel}</span>
          </h2>
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
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Rincian laba <span className="text-foreground">{periodeLabel}</span>
          </h2>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            Nilai stock
            <Badge variant="outline">Tidak mengikuti filter tanggal</Badge>
          </h2>
          <ReportTable<StockValueRow>
            title="Nilai Stock"
            columns={stockValueColumns}
            rows={stockValue?.produk ?? []}
            rowKey={(row) => row.kodeItem}
            emptyMessage="Belum ada produk dengan stok."
          />
        </section>
      </Page>

      {correctionTarget && <CostCorrectionDialog
        target={correctionTarget} from={appliedFrom} to={appliedTo}
        onClose={() => setCorrectionTarget(null)}
        onSaved={(count) => {
          setCorrectionTarget(null)
          setCorrectionMessage(`HPP ${count} baris transaksi telah dikoreksi. Rekap dihitung ulang.`)
          load(appliedFrom, appliedTo)
        }}
      />}
      {correctionHistoryOpen && <CostCorrectionHistoryDialog onClose={() => setCorrectionHistoryOpen(false)} />}
      {EFISIENSI_HARGA_AKTIF && (
        <EfisiensiHargaDialog
          open={efisiensiOpen}
          onOpenChange={setEfisiensiOpen}
          // the margins on this page were computed from the old prices
          onSelesai={() => load(appliedFrom, appliedTo)}
        />
      )}
    </AppShell>
  )
}

function AksiSaran({ saran }: { saran: SaranLaba }) {
  return (
    <div className="space-y-2">
      {(saran.produk.length > 0 || saran.saleIds.length > 0) && (
        <details className="rounded-md border bg-background p-2">
          <summary className="cursor-pointer font-medium">Lihat item dan edit ({saran.produk.length + saran.saleIds.length})</summary>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {saran.produk.map((produk) => (
              <div key={`${produk.productId}:${produk.satuan}`} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <span>{produk.namaItem} ({produk.satuan})</span>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline"><Link to={`/inventory/mass-input?ids=${produk.productId}`}>Edit produk</Link></Button>
                  <Button asChild size="sm" variant="outline"><Link to={`/inventory/${produk.productId}`}>Harga satuan</Link></Button>
                </div>
              </div>
            ))}
            {saran.saleIds.map((id) => (
              <div key={id} className="flex items-center justify-between gap-2 border-t pt-2">
                <span>Nota #{id}</span>
                <Button asChild size="sm" variant="outline"><Link to={`/kasir?edit=${id}`}>Edit nota / diskon</Link></Button>
              </div>
            ))}
          </div>
        </details>
      )}
      {saran.kode === 'satuan_margin_tipis' && <Button asChild size="sm" variant="outline"><Link to="/purchase">Buka pembelian</Link></Button>}
      {saran.kode === 'katalog_di_bawah_margin' && <Button asChild size="sm" variant="outline"><Link to="/settings">Atur margin minimal</Link></Button>}
      <p className="text-xs text-muted-foreground">Edit produk memperbarui harga katalog. Salah harga jual atau diskon pada transaksi: gunakan Edit nota. Salah modal: gunakan Koreksi HPP pada baris rugi.</p>
    </div>
  )
}
