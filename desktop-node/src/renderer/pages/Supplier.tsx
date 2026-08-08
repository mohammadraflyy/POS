import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column, RowsChangeData } from 'react-data-grid'
import { DataGrid, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useConfirm } from '@/hooks/use-confirm'
import { useElementWidth } from '@/hooks/use-element-width'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SupplierRow {
  id: number
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
  purchaseCount: number
}

interface DraftRow {
  key: string
  id: number | null
  nama: string
  telepon: string
  alamat: string
  keterangan: string
  purchaseCount: number
}

function toDraftRow(supplier: SupplierRow): DraftRow {
  return {
    key: `supplier-${supplier.id}`,
    id: supplier.id,
    nama: supplier.nama,
    telepon: supplier.telepon ?? '',
    alamat: supplier.alamat ?? '',
    keterangan: supplier.keterangan ?? '',
    purchaseCount: supplier.purchaseCount,
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
    purchaseCount: 0,
  }
}

const OTHER_COLUMNS_WIDTH = 150 + 150 + 150 + 130 + 70
const MIN_NAMA_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Supplier', href: '/supplier' }]

export function Supplier() {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(72)

  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState('25')

  const { confirm, ConfirmDialog } = useConfirm()

  function loadPage(page: number, opts?: { search?: string; pageSize?: string }) {
    const term = opts?.search ?? search
    const size = opts?.pageSize ?? pageSize

    window.api.supplier
      .listSuppliers({ search: term || undefined, page, pageSize: Number(size) })
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

    const request = row.id === null ? window.api.supplier.createSupplier(input) : window.api.supplier.updateSupplier(row.id, input)

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
      return
    }

    const ok = await confirm({
      title: 'Hapus Supplier',
      description: `Hapus supplier "${row.nama}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setDeleteError(null)

    try {
      await window.api.supplier.deleteSupplier(row.id)
      loadPage(currentPage)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus supplier')
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
      key: 'purchaseCount',
      name: 'Jumlah Pembelian',
      width: 130,
      renderCell: ({ row }) => <span className="text-muted-foreground">{row.id === null ? '-' : row.purchaseCount}</span>,
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
      <div className="flex flex-1 flex-col gap-4 p-4">
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
              placeholder="Cari nama supplier..."
              className="w-64"
            />
            <Button type="submit" variant="secondary">
              Cari
            </Button>
          </form>
          <Button type="button" onClick={addRow}>
            + Tambah Supplier
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
                  <div className="col-span-full p-6 text-center text-sm text-muted-foreground">Belum ada supplier.</div>
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
            <span>dari {total} supplier</span>
          </div>
        </div>
      </div>

      {ConfirmDialog}
    </AppShell>
  )
}
