import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column } from 'react-data-grid'
import { ReportTable } from '@/components/report-table'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatQty } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

type MovementType = 'sale' | 'sale_cancel' | 'purchase' | 'stock_adjustment'

interface MovementRow {
  id: number
  createdAt: string
  productId: number
  kodeItem: string
  namaItem: string
  satuan: string | null
  quantity: number
  baseQuantity: number
  baseUnit: string | null
  stockBefore: number
  stockAfter: number
  movementType: MovementType
  referenceId: number
}

const MOVEMENT_LABEL: Record<MovementType, string> = {
  sale: 'Penjualan',
  sale_cancel: 'Pembatalan Penjualan',
  purchase: 'Pembelian',
  stock_adjustment: 'Penyesuaian (Opname)',
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Kartu Stok', href: '/stock-movements' }]

export function StockMovements() {
  const [q, setQ] = useState('')
  const [movementType, setMovementType] = useState('')
  const [dari, setDari] = useState('')
  const [sampai, setSampai] = useState('')

  const [rows, setRows] = useState<MovementRow[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  function loadPage(page: number) {
    window.api.stockMovements
      .list({
        q: q || undefined,
        movementType: (movementType || undefined) as MovementType | undefined,
        dari: dari || undefined,
        sampai: sampai || undefined,
        page,
      })
      .then((result) => {
        setRows(result.data)
        setCurrentPage(result.currentPage)
        setLastPage(result.lastPage)
        setTotal(result.total)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat kartu stok.'))
  }

  useEffect(() => {
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitFilters(e: FormEvent) {
    e.preventDefault()
    if (dari && sampai && dari > sampai) {
      setError('Tanggal Dari tidak boleh melewati tanggal Sampai.')
      return
    }
    loadPage(1)
  }

  function resetFilters() {
    setQ('')
    setMovementType('')
    setDari('')
    setSampai('')
    window.api.stockMovements.list({ page: 1 }).then((result) => {
      setRows(result.data)
      setCurrentPage(result.currentPage)
      setLastPage(result.lastPage)
      setTotal(result.total)
      setError(null)
    }).catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat kartu stok.'))
  }

  const columns: Column<MovementRow>[] = [
    {
      key: 'createdAt',
      name: 'Tanggal',
      width: 160,
      renderCell: ({ row }) => new Date(row.createdAt).toLocaleString('id-ID'),
    },
    {
      key: 'produk',
      name: 'Produk',
      renderCell: ({ row }) => (
        <span>
          {row.namaItem} <span className="text-muted-foreground">&middot; {row.kodeItem}</span>
        </span>
      ),
    },
    { key: 'quantity', name: 'Qty Transaksi', width: 130, renderCell: ({ row }) => `${formatQty(row.quantity)} ${row.satuan ?? row.baseUnit ?? ''}` },
    {
      key: 'movementType',
      name: 'Tipe',
      width: 180,
      renderCell: ({ row }) => MOVEMENT_LABEL[row.movementType],
    },
    { key: 'baseUnit', name: 'Satuan Dasar', width: 110, renderCell: ({ row }) => row.baseUnit ?? '-' },
    { key: 'stockBefore', name: 'Saldo Sebelum', width: 125, renderCell: ({ row }) => formatQty(row.stockBefore) },
    {
      key: 'masuk', name: 'Masuk', width: 110,
      renderCell: ({ row }) => <span className="text-green-600 dark:text-green-400">{row.baseQuantity > 0 ? formatQty(row.baseQuantity) : '-'}</span>,
    },
    {
      key: 'keluar', name: 'Keluar', width: 110,
      renderCell: ({ row }) => <span className="text-destructive">{row.baseQuantity < 0 ? formatQty(-row.baseQuantity) : '-'}</span>,
    },
    { key: 'stockAfter', name: 'Saldo Sesudah', width: 125, renderCell: ({ row }) => formatQty(row.stockAfter) },
    {
      key: 'referensi',
      name: 'Referensi',
      width: 110,
      renderCell: ({ row }) => <span className="text-muted-foreground">#{row.referenceId}</span>,
    },
  ]

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Kartu Stok" description="Stok masuk dan keluar dari pembelian, penjualan, pembatalan, dan opname. Masuk, keluar, dan saldo ditampilkan dalam satuan dasar." />

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <form onSubmit={submitFilters} className="flex flex-wrap items-end gap-2 rounded-lg border p-4">
          <div className="grid gap-1">
            <Label className="text-xs">Cari Produk</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nama / kode item..." className="w-56" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Tipe</Label>
            <Select value={movementType} onValueChange={setMovementType}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Semua" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sale">Penjualan</SelectItem>
                <SelectItem value="sale_cancel">Pembatalan Penjualan</SelectItem>
                <SelectItem value="purchase">Pembelian</SelectItem>
                <SelectItem value="stock_adjustment">Penyesuaian (Opname)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Dari</Label>
            <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Sampai</Label>
            <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {(q || movementType || dari || sampai) && (
            <Button type="button" variant="outline" onClick={resetFilters}>
              Reset
            </Button>
          )}
        </form>

        <ReportTable<MovementRow>
          title="Kartu Stok"
          rows={rows}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada pergerakan stok."
          columns={columns}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => loadPage(currentPage - 1)}>
              Sebelumnya
            </Button>
            <span className="text-sm text-muted-foreground">
              Halaman {currentPage} / {lastPage}
            </span>
            <Button variant="outline" size="sm" disabled={currentPage >= lastPage} onClick={() => loadPage(currentPage + 1)}>
              Berikutnya
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">dari {total} pergerakan stok</span>
        </div>
      </Page>
    </AppShell>
  )
}
