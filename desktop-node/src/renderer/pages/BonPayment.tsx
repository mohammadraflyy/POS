import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InputError } from '@/components/input-error'
import { ReportTable } from '@/components/report-table'
import { cn, formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SaleDetail {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  createdAt: string
  items: { id: number; qty: number; satuan: string | null; namaItem: string }[]
  bonPayments: { id: number; jumlah: number; tanggal: string; keterangan: string | null }[]
}

interface BonPaymentRow {
  id: number
  jumlah: number
  tanggal: string
  keterangan: string | null
}

const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/' },
  { title: 'Riwayat Transaksi', href: '/history' },
]

export function BonPayment() {
  const navigate = useNavigate()
  const { saleId } = useParams<{ saleId: string }>()
  const [sale, setSale] = useState<SaleDetail | null>(null)
  const [jumlah, setJumlah] = useState('')
  const [keterangan, setKeterangan] = useState('')
  const [processing, setProcessing] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  function loadSale() {
    window.api.kasir
      .getSaleDetail(Number(saleId))
      .then((s) => {
        setSale(s)
        setLoadError(null)
      })
      .catch(() => setLoadError('Gagal memuat transaksi.'))
  }

  useEffect(() => {
    loadSale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    setProcessing(true)
    setFieldError(null)

    window.api.kasir
      .recordBonPayment({ saleId: Number(saleId), jumlah: Number(jumlah), keterangan: keterangan || null })
      .then(() => {
        setJumlah('')
        setKeterangan('')
        loadSale()
      })
      .catch((err) => setFieldError(err instanceof Error ? err.message : 'Gagal mencatat pembayaran'))
      .finally(() => setProcessing(false))
  }

  if (!sale) {
    return (
      <AppShell breadcrumbs={BREADCRUMBS}>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <p>{loadError ?? 'Memuat...'}</p>
            {loadError && (
              <Button variant="outline" size="sm" onClick={() => navigate('/history')}>
                Kembali
              </Button>
            )}
          </div>
        </div>
      </AppShell>
    )
  }

  const sisaPiutang = sale.total - sale.dibayar
  const isLunas = sisaPiutang <= 0
  const canPay = sale.status === 'selesai' && !isLunas

  const columns: Column<BonPaymentRow>[] = [
    {
      key: 'tanggal',
      name: 'Tanggal',
      width: 140,
      renderCell: ({ row }) => new Date(row.tanggal).toLocaleDateString('id-ID'),
    },
    {
      key: 'jumlah',
      name: 'Jumlah',
      width: 150,
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.jumlah)}</span>,
    },
    {
      key: 'keterangan',
      name: 'Keterangan',
      renderCell: ({ row }) => row.keterangan ?? '-',
    },
  ]

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            Pending Payment &mdash; {sale.namaPelanggan ?? `Struk #${sale.id}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {sale.items.map((i) => `${i.namaItem} x${i.qty}`).join(', ')} &middot;{' '}
            {new Date(sale.createdAt).toLocaleString('id-ID')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/history')}>
          Kembali
        </Button>
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total Transaksi</CardDescription>
            <CardTitle className="text-2xl">{formatRupiah(sale.total)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sudah Dibayar</CardDescription>
            <CardTitle className="text-2xl">{formatRupiah(sale.dibayar)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sisa Piutang</CardDescription>
            <CardTitle
              className={cn('text-2xl', isLunas ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400')}
            >
              {formatRupiah(Math.max(sisaPiutang, 0))}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {canPay && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/30 p-4">
          <div className="grid gap-1">
            <Label htmlFor="jumlah">Jumlah Bayar</Label>
            <Input
              id="jumlah"
              type="number"
              autoFocus
              value={jumlah}
              onChange={(e) => setJumlah(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="keterangan">Keterangan (opsional)</Label>
            <Input id="keterangan" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className="w-64" />
          </div>
          <Button type="submit" disabled={processing}>
            Simpan Pembayaran
          </Button>
          <InputError role="alert" message={fieldError ?? undefined} />
        </form>
      )}

      {!canPay && sale.status === 'selesai' && (
        <p className="text-sm font-medium text-green-600 dark:text-green-400">Pending payment ini sudah lunas.</p>
      )}

      <ReportTable<BonPaymentRow>
        title="Riwayat Pembayaran"
        rows={sale.bonPayments}
        rowKey={(row) => row.id}
        emptyMessage="Belum ada pembayaran."
        columns={columns}
      />
    </div>
    </AppShell>
  )
}
