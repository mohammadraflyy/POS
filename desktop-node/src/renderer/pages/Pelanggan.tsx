import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column, RowsChangeData } from 'react-data-grid'
import { DataGrid, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useConfirm } from '@/hooks/use-confirm'
import { useElementWidth } from '@/hooks/use-element-width'
import { useStickyState } from '@/hooks/use-sticky-state'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface CustomerRow {
  id: number
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
  saleCount: number
}

interface DraftRow {
  key: string
  id: number | null
  nama: string
  telepon: string
  alamat: string
  keterangan: string
  saleCount: number
}

function toDraftRow(customer: CustomerRow): DraftRow {
  return {
    key: `customer-${customer.id}`,
    id: customer.id,
    nama: customer.nama,
    telepon: customer.telepon ?? '',
    alamat: customer.alamat ?? '',
    keterangan: customer.keterangan ?? '',
    saleCount: customer.saleCount,
  }
}

function emptyRow(): DraftRow {
  return {
    key: crypto.randomUUID(),
    id: null,
    nama: '',
    telepon: '',
    alamat: '',
    keterangan: '',
    saleCount: 0,
  }
}

const OTHER_COLUMNS_WIDTH = 150 + 150 + 150 + 130 + 70
const MIN_NAMA_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Pelanggan', href: '/pelanggan' }]

export function Pelanggan() {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(80)

  const [search, setSearch] = useStickyState('pelanggan.search', '')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useStickyState('pelanggan.pageSize', '25')

  const { confirm, ConfirmDialog } = useConfirm()

  function loadPage(page: number, opts?: { search?: string; pageSize?: string }) {
    const term = opts?.search ?? search
    const size = opts?.pageSize ?? pageSize

    window.api.customer
      .listCustomers({ search: term || undefined, page, pageSize: Number(size) })
      .then((result) => {
        setRows(result.data.map(toDraftRow))
        setCurrentPage(result.currentPage)
        setLastPage(result.lastPage)
        setTotal(result.total)
      })
  }

  useEffect(() => {
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    loadPage(1)
  }

  function changePageSize(value: string) {
    setPageSize(value)
  }

  useEffect(() => {
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize])

  function addRow() {
    setRows((prev) => [emptyRow(), ...prev])
  }

  function saveRow(row: DraftRow) {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.key]
      return next
    })

    if (!row.nama.trim()) {
      setRowErrors((prev) => ({ ...prev, [row.key]: 'Nama wajib diisi.' }))
      return
    }

    const input = {
      nama: row.nama,
      telepon: row.telepon || null,
      alamat: row.alamat || null,
      keterangan: row.keterangan || null,
    }

    const request = row.id === null ? window.api.customer.createCustomer(input) : window.api.customer.updateCustomer(row.id, input)

    request
      .then(() => loadPage(currentPage))
      .catch((err) => {
        setRowErrors((prev) => ({ ...prev, [row.key]: err instanceof Error ? err.message : 'Gagal menyimpan' }))
      })
  }

  function handleRowsChange(newRows: DraftRow[], data: RowsChangeData<DraftRow>) {
    setRows(newRows)
    saveRow(newRows[data.indexes[0]])
  }

  async function deleteRow(row: DraftRow) {
    if (row.id === null) {
      setRows((prev) => prev.filter((r) => r.key !== row.key))
      setRowErrors((prev) => {
        const next = { ...prev }
        delete next[row.key]
        return next
      })
      return
    }

    const ok = await confirm({
      title: 'Hapus Pelanggan',
      // the sale keeps its nama_pelanggan snapshot, so past receipts still read the same
      description:
        row.saleCount > 0
          ? `Hapus pelanggan "${row.nama}"? ${row.saleCount} transaksi lamanya tetap tersimpan atas nama ini.`
          : `Hapus pelanggan "${row.nama}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setDeleteError(null)

    try {
      await window.api.customer.deleteCustomer(row.id)
      loadPage(currentPage)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus pelanggan')
    }
  }

  const namaWidth = Math.max(MIN_NAMA_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  function textColumn(key: keyof DraftRow, name: string, width?: number): Column<DraftRow> {
    return {
      key,
      name,
      width,
      editable: true,
      renderEditCell: renderTextEditor,
      cellClass: (row) => (rowErrors[row.key] ? 'bg-red-100 dark:bg-red-950' : undefined),
    }
  }

  const columns: Column<DraftRow>[] = [
    textColumn('nama', 'Nama', namaWidth),
    textColumn('telepon', 'Telepon', 150),
    textColumn('alamat', 'Alamat', 150),
    textColumn('keterangan', 'Keterangan', 150),
    {
      key: 'saleCount',
      name: 'Jumlah Transaksi',
      width: 130,
      renderCell: ({ row }) => <span className="text-muted-foreground">{row.id === null ? '-' : row.saleCount}</span>,
    },
    {
      key: 'aksi',
      name: '',
      width: 70,
      renderCell: ({ row }) => (
        <button type="button" className="text-xs text-destructive hover:underline" onClick={() => deleteRow(row)}>
          Hapus
        </button>
      ),
    },
  ]

  const errorSummary = Object.entries(rowErrors).map(([key, message]) => {
    const row = rows.find((r) => r.key === key)
    return `${row?.nama || 'Baris baru'}: ${message}`
  })

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Pelanggan" />
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
        {errorSummary.length > 0 && (
          <div className="space-y-1 text-sm text-destructive">
            {errorSummary.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <form onSubmit={submitSearch} className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama pelanggan..."
              className="w-64"
            />
            <Button type="submit" variant="secondary">
              Cari
            </Button>
          </form>
          <Button type="button" onClick={addRow}>
            + Tambah Pelanggan
          </Button>
        </div>

        <div
          ref={(node) => {
            widthRef(node)
            heightRef(node)
          }}
          className="overflow-x-auto"
        >
          {gridWidth > 0 && (
            <DataGrid
              className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
              columns={columns}
              rows={rows}
              rowKeyGetter={(row) => row.key}
              onRowsChange={handleRowsChange}
              renderers={{
                noRowsFallback: (
                  <div className="col-span-full p-6 text-center text-sm text-muted-foreground">Belum ada pelanggan.</div>
                ),
              }}
              style={{ blockSize: gridHeight, minHeight: 300 }}
            />
          )}
        </div>

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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Tampilkan</span>
            <Select value={pageSize} onValueChange={changePageSize}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((option) => (
                  <SelectItem key={option} value={option.toString()}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>dari {total} pelanggan</span>
          </div>
        </div>
      </Page>

      {ConfirmDialog}
    </AppShell>
  )
}
