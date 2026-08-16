import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { DataGrid } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { MoreHorizontal } from 'lucide-react'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppearance } from '@/hooks/use-appearance'
import { useConfirm } from '@/hooks/use-confirm'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useElementWidth } from '@/hooks/use-element-width'
import { METODE_LABEL } from '@/lib/metode'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SaleHistoryItem {
  namaItem: string
  qty: number
}

interface SaleHistoryRow {
  id: number
  createdAt: string
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  items: SaleHistoryItem[]
}

const OTHER_COLUMNS_WIDTH = 60 + 180 + 200 + 120 + 140 + 120 + 60
const MIN_ITEM_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Penjualan', href: '/kasir' },
  { title: 'Riwayat Transaksi', href: '/history' },
]

export function KasirHistory() {
  const navigate = useNavigate()
  const { resolvedAppearance } = useAppearance()
  const { confirm, ConfirmDialog } = useConfirm()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(64)

  const [search, setSearch] = useState('')
  const [dari, setDari] = useState('')
  const [sampai, setSampai] = useState('')
  const [status, setStatus] = useState('')
  const [metode, setMetode] = useState('')

  const [rows, setRows] = useState<SaleHistoryRow[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    // the main process enforces requireAdmin anyway; this only hides a menu item
    // the cashier would always be refused
    window.api.auth
      .me()
      .then((user) => setIsAdmin(user?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])

  // dialog-opening dropdown items defer via this ref; cleared on unmount so a
  // pending callback can't fire setState after the component is gone
  const pendingActionRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (pendingActionRef.current !== null) {
        clearTimeout(pendingActionRef.current)
      }
    }
  }, [])

  function deferAction(fn: () => void) {
    pendingActionRef.current = setTimeout(fn, 0)
  }

  function loadPage(page: number) {
    window.api.kasir
      .listSalesHistory({
        search: search || undefined,
        dari: dari || undefined,
        sampai: sampai || undefined,
        status: (status || undefined) as 'selesai' | 'dibatalkan' | undefined,
        metodePembayaran: (metode || undefined) as 'tunai' | 'bon' | 'qris' | 'transfer' | undefined,
        page,
      })
      .then((result) => {
        setRows(result.data)
        setCurrentPage(result.currentPage)
        setLastPage(result.lastPage)
      })
      .catch(() => setError('Gagal memuat riwayat transaksi.'))
  }

  useEffect(() => {
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitFilters(e: FormEvent) {
    e.preventDefault()
    loadPage(1)
  }

  async function cancelSale(sale: SaleHistoryRow) {
    const confirmed = await confirm({
      title: 'Batalkan transaksi?',
      description: `Transaksi #${sale.id} akan ditandai dibatalkan dan stoknya dikembalikan.`,
      confirmLabel: 'Batalkan',
      destructive: true,
    })

    if (!confirmed) {
      return
    }

    setError(null)

    try {
      await window.api.kasir.cancelSale(sale.id)
      loadPage(currentPage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan')
    }
  }

  async function deleteSale(sale: SaleHistoryRow) {
    const confirmed = await confirm({
      title: 'Hapus transaksi?',
      description:
        sale.status === 'dibatalkan'
          ? `Transaksi #${sale.id} dihapus permanen dan datanya tidak bisa dikembalikan.`
          : `Transaksi #${sale.id} dihapus permanen, stoknya dikembalikan, dan datanya tidak bisa dikembalikan.`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!confirmed) {
      return
    }

    setError(null)

    try {
      await window.api.kasir.deleteSale(sale.id)
      loadPage(currentPage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus')
    }
  }

  async function printSale(saleId: number) {
    const confirmed = await confirm({
      title: 'Cetak struk?',
      description: `Struk transaksi #${saleId} akan dicetak ulang ke printer.`,
      confirmLabel: 'Cetak',
    })

    if (!confirmed) {
      return
    }

    setError(null)

    try {
      await window.api.kasir.printReceipt(saleId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencetak struk')
    }
  }

  const itemWidth = Math.max(MIN_ITEM_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  const columns: Column<SaleHistoryRow>[] = [
    {
      key: 'id',
      name: '#',
      width: 60,
      renderCell: ({ row }) => row.id,
    },
    {
      key: 'createdAt',
      name: 'Tanggal',
      width: 180,
      renderCell: ({ row }) => new Date(row.createdAt).toLocaleString('id-ID'),
    },
    {
      key: 'items',
      name: 'Item',
      width: itemWidth,
      renderCell: ({ row }) => row.items.map((i) => `${i.namaItem} x${i.qty}`).join(', '),
    },
    {
      key: 'namaPelanggan',
      name: 'Pelanggan',
      width: 200,
      renderCell: ({ row }) => row.namaPelanggan ?? 'UMUM',
    },
    {
      key: 'metodePembayaran',
      name: 'Metode',
      width: 120,
      // the old ternary here predated qris and transfer and rendered both as "Tunai"
      renderCell: ({ row }) => METODE_LABEL[row.metodePembayaran],
    },
    {
      key: 'status',
      name: 'Status',
      width: 140,
      renderCell: ({ row }) => {
        const sisaPiutang = row.total - row.dibayar

        if (row.status === 'dibatalkan') {
          return <span className="text-destructive">Dibatalkan</span>
        }

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
    {
      key: 'aksi',
      name: '',
      width: 60,
      renderCell: ({ row }) => {
        const sisaPiutang = row.total - row.dibayar
        const bonBelumLunas = row.metodePembayaran === 'bon' && row.status === 'selesai' && sisaPiutang > 0

        // Opening a Dialog from a DropdownMenuItem's onSelect races Radix's own
        // focus-return/dismiss handling for the closing menu, which can close the
        // dialog it just opened. preventDefault() stops the menu's synchronous
        // focus-return, and deferAction() waits a tick before opening the dialog.
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`Aksi transaksi ${row.id}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/sale/${row.id}`)}>Detail</DropdownMenuItem>
              {bonBelumLunas && (
                <DropdownMenuItem onSelect={() => navigate(`/sale/${row.id}`)}>Tambah Item</DropdownMenuItem>
              )}
              {bonBelumLunas && (
                <DropdownMenuItem onSelect={() => navigate(`/bon-payment/${row.id}`)}>Bayar Bon</DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  deferAction(() => printSale(row.id))
                }}
              >
                Cetak Struk
              </DropdownMenuItem>
              {isAdmin && row.status === 'selesai' && (
                <DropdownMenuItem onSelect={() => navigate(`/kasir?edit=${row.id}`)}>Edit Transaksi</DropdownMenuItem>
              )}
              {row.status === 'selesai' && row.dibayar === 0 && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault()
                    deferAction(() => cancelSale(row))
                  }}
                >
                  Batalkan
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault()
                  deferAction(() => deleteSale(row))
                }}
              >
                Hapus
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  return (
    <>
      <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Riwayat Transaksi" />

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <form onSubmit={submitFilters} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Cari</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nama pelanggan / item..."
              className="w-56"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Dari</Label>
            <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Sampai</Label>
            <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Semua" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selesai">Selesai</SelectItem>
                <SelectItem value="dibatalkan">Dibatalkan</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Metode</Label>
            <Select value={metode} onValueChange={setMetode}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Semua" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tunai">Tunai</SelectItem>
                <SelectItem value="bon">Bon</SelectItem>
                <SelectItem value="qris">QRIS</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/kasir')}>
            Ke Kasir
          </Button>
        </form>

        <div
          ref={(node) => {
            widthRef(node)
            heightRef(node)
          }}
        >
          {gridWidth > 0 && (
            <DataGrid
              className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
              columns={columns}
              rows={rows}
              rowKeyGetter={(row) => row.id}
              onCellClick={({ row, column }) => {
                if (column.key !== 'aksi') {
                  navigate(`/sale/${row.id}`)
                }
              }}
              renderers={{
                noRowsFallback: (
                  <div className="col-span-full p-6 text-center text-sm text-muted-foreground">Tidak ada transaksi.</div>
                ),
              }}
              style={{ blockSize: gridHeight, minHeight: 300 }}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
      </Page>
      </AppShell>
      {ConfirmDialog}
    </>
  )
}
