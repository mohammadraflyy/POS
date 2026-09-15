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
  movementType: MovementType
  referenceId: number
}

const MOVEMENT_LABEL: Record<MovementType, string> = {
  sale: 'Penjualan',
  sale_cancel: 'Pembatalan Penjualan',
  purchase: 'Pembelian',
  stock_adjustment: 'Penyesuaian (Opname)',
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Riwayat Stok', href: '/stock-movements' }]

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
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat riwayat stok.'))
  }

  useEffect(() => {
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitFilters(e: FormEvent) {
    e.preventDefault()
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
    })
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
    { key: 'satuan', name: 'Satuan', width: 90, renderCell: ({ row }) => row.satuan ?? '-' },
    {
      key: 'movementType',
      name: 'Tipe',
      width: 180,
      renderCell: ({ row }) => MOVEMENT_LABEL[row.movementType],
    },
    {
      key: 'quantity',
      name: 'Qty',
      width: 130,
      renderCell: ({ row }) => {
        // negative = keluar dari stok, positive = masuk ke stok - same sign convention
        // stock_movements has always used, just made visible here
        const masuk = row.quantity > 0
        const keluar = row.quantity < 0

        return (
          <span
            className={`w-full text-right font-medium ${masuk ? 'text-green-600 dark:text-green-400' : keluar ? 'text-destructive' : ''}`}
          >
            {masuk ? '+' : ''}
            {formatQty(row.quantity)} {row.satuan ?? ''}
          </span>
        )
      },
    },
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
        <PageHeader title="Riwayat Stok" description="Semua pergantian stok - penjualan, pembelian, dan penyesuaian opname, dalam satu daftar." />

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
          title="Riwayat Stok"
          rows={rows}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada pergantian stok."
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
          <span className="text-sm text-muted-foreground">dari {total} pergantian stok</span>
        </div>
      </Page>
    </AppShell>
  )
}
