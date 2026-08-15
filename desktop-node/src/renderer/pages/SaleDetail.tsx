import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { ReportTable } from '@/components/report-table'
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

const METODE_LABEL: Record<SaleDetailData['metodePembayaran'], string> = {
  tunai: 'Tunai',
  bon: 'Bon',
  qris: 'QRIS',
  transfer: 'Transfer',
}

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
          </>
        )}
      </Page>
    </AppShell>
  )
}
