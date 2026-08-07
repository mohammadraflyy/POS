import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column, RowsChangeData } from 'react-data-grid'
import { DataGrid, SelectColumn, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useConfirm } from '@/hooks/use-confirm'
import { useElementWidth } from '@/hooks/use-element-width'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface ProductRow {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string
  hargaPokok: number
  hargaJual: number
  stok: number
  isActive: boolean
}

interface DraftRow {
  id: number
  kodeItem: string
  barcode: string
  namaItem: string
  kategori: string
  satuan: string
  hargaPokok: string
  hargaJual: string
  stok: number
  isActive: boolean
}

function toDraftRow(product: ProductRow): DraftRow {
  return {
    id: product.id,
    kodeItem: product.kodeItem,
    barcode: product.barcode ?? '',
    namaItem: product.namaItem,
    kategori: product.categoryName ?? '',
    satuan: product.satuan,
    hargaPokok: String(product.hargaPokok),
    hargaJual: String(product.hargaJual),
    stok: product.stok,
    isActive: product.isActive,
  }
}

const OTHER_COLUMNS_WIDTH = 50 + 110 + 130 + 130 + 90 + 110 + 110 + 90 + 90 + 70
const MIN_NAMA_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Katalog Produk', href: '/inventory' }]

export function Inventory() {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(72)

  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [rawProducts, setRawProducts] = useState<ProductRow[]>([])
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState('25')

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<ProductRow[]>([])

  const { confirm, ConfirmDialog } = useConfirm()

  function loadPage(page: number, opts?: { search?: string; pageSize?: string }) {
    const term = opts?.search ?? search
    const size = opts?.pageSize ?? pageSize

    window.api.inventory
      .listProducts({ search: term || undefined, page, pageSize: Number(size) })
      .then((result) => {
        setRawProducts(result.data)
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

  function saveRow(row: DraftRow) {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })

    const hargaPokokNum = Number(row.hargaPokok)
    const hargaJualNum = Number(row.hargaJual)

    if (row.hargaPokok.trim() === '' || !Number.isFinite(hargaPokokNum)) {
      setRowErrors((prev) => ({ ...prev, [row.id]: 'Harga pokok wajib diisi.' }))
      return
    }

    if (row.hargaJual.trim() === '' || !Number.isFinite(hargaJualNum)) {
      setRowErrors((prev) => ({ ...prev, [row.id]: 'Harga jual wajib diisi.' }))
      return
    }

    window.api.inventory
      .updateProduct(row.id, {
        kodeItem: row.kodeItem,
        barcode: row.barcode || null,
        namaItem: row.namaItem,
        kategori: row.kategori || null,
        satuan: row.satuan,
        hargaPokok: hargaPokokNum,
        hargaJual: hargaJualNum,
        isActive: row.isActive,
      })
      .then(() => loadPage(currentPage))
      .catch((err) => {
        setRowErrors((prev) => ({ ...prev, [row.id]: err instanceof Error ? err.message : 'Gagal menyimpan' }))
      })
  }

  function handleRowsChange(newRows: DraftRow[], data: RowsChangeData<DraftRow>) {
    setRows(newRows)
    saveRow(newRows[data.indexes[0]])
  }

  function toggleActive(row: DraftRow) {
    const updated = { ...row, isActive: !row.isActive }
    setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)))
    saveRow(updated)
  }

  async function deleteProduct(product: ProductRow) {
    const ok = await confirm({
      title: 'Hapus Produk',
      description: `Hapus produk "${product.namaItem}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setDeleteError(null)

    try {
      await window.api.inventory.deleteProduct(product.id)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(product.id)
        return next
      })
      loadPage(currentPage)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus produk')
    }
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) {
      return
    }

    if (selectedIds.size === 1) {
      const product = rawProducts.find((p) => selectedIds.has(p.id))
      if (product) {
        await deleteProduct(product)
      }
      return
    }

    const ok = await confirm({
      title: 'Hapus Produk',
      description: `Hapus ${selectedIds.size} produk terpilih?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setDeleteError(null)

    try {
      const result = await window.api.inventory.bulkDeleteProducts([...selectedIds])
      setSelectedIds(new Set())
      loadPage(currentPage)

      if (result.blocked.length > 0) {
        setDeleteError(
          `${result.blocked.length} produk tidak bisa dihapus karena sudah punya riwayat transaksi: ${result.blocked.join(', ')}.`,
        )
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus produk')
    }
  }

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) {
        return false
      }
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) {
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        setPaletteQuery('')
        setPaletteOpen(true)
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        deleteSelected()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, rawProducts, currentPage])

  useEffect(() => {
    if (!paletteOpen) {
      return
    }

    let cancelled = false

    window.api.inventory.searchProducts(paletteQuery).then((results) => {
      if (!cancelled) {
        setPaletteResults(results)
      }
    })

    return () => {
      cancelled = true
    }
  }, [paletteOpen, paletteQuery])

  function searchAll(term: string) {
    setSearch(term)
    setPaletteOpen(false)
    loadPage(1, { search: term })
  }

  function jumpToProduct(product: ProductRow) {
    setSearch(product.kodeItem)
    setPaletteOpen(false)
    loadPage(1, { search: product.kodeItem })
  }

  const namaWidth = Math.max(MIN_NAMA_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  function textColumn(key: keyof DraftRow, name: string, width?: number): Column<DraftRow> {
    return {
      key,
      name,
      width,
      editable: true,
      renderEditCell: renderTextEditor,
      cellClass: (row) => (rowErrors[row.id] ? 'bg-red-100 dark:bg-red-950' : undefined),
    }
  }

  const columns: Column<DraftRow>[] = [
    SelectColumn,
    textColumn('kodeItem', 'Kode Item', 110),
    textColumn('barcode', 'Barcode', 130),
    textColumn('namaItem', 'Nama', namaWidth),
    textColumn('kategori', 'Kategori', 130),
    textColumn('satuan', 'Satuan', 90),
    textColumn('hargaPokok', 'Harga Pokok', 110),
    textColumn('hargaJual', 'Harga Jual', 110),
    {
      key: 'stok',
      name: 'Stok',
      width: 90,
      renderCell: ({ row }) => <span className="text-muted-foreground">{row.stok}</span>,
    },
    {
      key: 'isActive',
      name: 'Status',
      width: 90,
      renderCell: ({ row }) => (
        <label className="flex h-full items-center gap-1.5 text-xs">
          <input type="checkbox" checked={row.isActive} onChange={() => toggleActive(row)} />
          <span className={row.isActive ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
            {row.isActive ? 'Aktif' : 'Nonaktif'}
          </span>
        </label>
      ),
    },
    {
      key: 'aksi',
      name: '',
      width: 70,
      renderCell: ({ row }) => {
        const product = rawProducts.find((p) => p.id === row.id)
        return (
          <button
            type="button"
            className="text-xs text-destructive hover:underline"
            onClick={() => product && deleteProduct(product)}
          >
            Hapus
          </button>
        )
      },
    },
  ]

  const errorSummary = Object.entries(rowErrors).map(([id, message]) => {
    const product = rawProducts.find((p) => p.id === Number(id))
    return `${product?.namaItem ?? `Produk #${id}`}: ${message}`
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
            <div className="relative w-64">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kode / nama / barcode produk..."
                className="pr-8"
              />
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                /
              </kbd>
            </div>
            <Button type="submit" variant="secondary">
              Cari
            </Button>
          </form>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled title="Menunggu fitur Mass Input">
              Edit Massal ({selectedIds.size})
            </Button>
            <Button type="button" variant="destructive" disabled={selectedIds.size === 0} onClick={deleteSelected}>
              Hapus Terpilih ({selectedIds.size})
            </Button>
            <Button type="button" disabled title="Menunggu fitur Mass Input">
              Tambah Produk
            </Button>
          </div>
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
              rowKeyGetter={(row) => row.id}
              onRowsChange={handleRowsChange}
              selectedRows={selectedIds}
              onSelectedRowsChange={setSelectedIds}
              renderers={{
                noRowsFallback: (
                  <div className="col-span-full p-6 text-center text-sm text-muted-foreground">Tidak ada produk.</div>
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
            <span>dari {total} produk</span>
          </div>
        </div>
      </div>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Cari Produk" description="Cari kode, nama, atau barcode produk" shouldFilter={false}>
        <CommandInput value={paletteQuery} onValueChange={setPaletteQuery} placeholder="Cari kode / nama / barcode produk..." />
        <CommandList>
          <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>
          {paletteQuery.trim() !== '' && (
            <CommandGroup heading="Aksi">
              <CommandItem value={`cari-semua-${paletteQuery}`} onSelect={() => searchAll(paletteQuery)}>
                Cari semua untuk &ldquo;{paletteQuery}&rdquo;
              </CommandItem>
            </CommandGroup>
          )}
          {paletteResults.length > 0 && (
            <CommandGroup heading="Produk">
              {paletteResults.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.id.toString()}
                  onSelect={() => jumpToProduct(product)}
                  className="flex items-center justify-between"
                >
                  <span>
                    <span className="font-medium">{product.namaItem}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      &middot; {product.kodeItem}
                      {product.categoryName && ` · ${product.categoryName}`}
                    </span>
                  </span>
                  {!product.isActive && <span className="text-xs text-muted-foreground">Nonaktif</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>

      {ConfirmDialog}
    </AppShell>
  )
}
