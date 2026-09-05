import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { Column, RowsChangeData } from 'react-data-grid'
import { DataGrid, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { useAppearance } from '@/hooks/use-appearance'
import { useStickyState } from '@/hooks/use-sticky-state'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatQty, parseQty } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface ProductOpnameRowDTO {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string
  stok: number
}

interface DraftRow {
  key: string
  productId: number
  kodeItem: string
  namaItem: string
  categoryName: string
  satuan: string
  stokSistem: number
  stokFisik: string
  alasan: string
}

function toDraftRow(p: ProductOpnameRowDTO): DraftRow {
  return {
    key: `product-${p.id}`,
    productId: p.id,
    kodeItem: p.kodeItem,
    namaItem: p.namaItem,
    categoryName: p.categoryName ?? '-',
    satuan: p.satuan,
    stokSistem: p.stok,
    stokFisik: formatQty(p.stok),
    alasan: '',
  }
}

const OTHER_COLUMNS_WIDTH = 110 + 130 + 80 + 100 + 100 + 90 + 200
const MIN_NAMA_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Stock Opname', href: '/stock-opname' }]

export function StockOpname() {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(80)
  const gridContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      widthRef(node)
      heightRef(node)
    },
    [widthRef, heightRef],
  )

  // sticky so leaving the page and coming back keeps the filter
  const [search, setSearch] = useStickyState('opname.search', '')
  const [categories, setCategories] = useState<{ id: number; nama: string }[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useStickyState<number[]>('opname.categoryIds', [])
  const [rows, setRows] = useState<DraftRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.stockOpname.listCategories().then(setCategories)
  }, [])

  // a filter restored from a previous visit has to refetch its rows
  useEffect(() => {
    runSearch(search, selectedCategoryIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function runSearch(q: string, categoryIds: number[]) {
    setRowErrors({})

    if (q.trim() === '' && categoryIds.length === 0) {
      setRows([])
      setHasSearched(false)
      return
    }

    setHasSearched(true)
    window.api.stockOpname.searchProducts({ q, categoryIds }).then((results) => {
      setRows(results.map(toDraftRow))
    })
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    runSearch(search, selectedCategoryIds)
  }

  function toggleCategory(id: number) {
    const next = selectedCategoryIds.includes(id)
      ? selectedCategoryIds.filter((c) => c !== id)
      : [...selectedCategoryIds, id]
    setSelectedCategoryIds(next)
    runSearch(search, next)
  }

  function clearCategories() {
    setSelectedCategoryIds([])
    setCategoryPickerOpen(false)
    runSearch(search, [])
  }

  // named while there is room for names, counted once the button would overflow
  const selectedNames = categories.filter((c) => selectedCategoryIds.includes(c.id)).map((c) => c.nama)
  const selectedCategoryLabel =
    selectedNames.length === 0
      ? 'Semua Kategori'
      : selectedNames.length <= 2
        ? selectedNames.join(', ')
        : `${selectedNames.length} kategori`

  function saveRow(row: DraftRow) {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.key]
      return next
    })

    // a counted stock level may be fractional - "5,5" and "5.5" both mean 5,5 KG
    const stokFisikNum = parseQty(row.stokFisik)

    if (row.stokFisik.trim() === '' || !Number.isFinite(stokFisikNum) || stokFisikNum < 0) {
      setRowErrors((prev) => ({ ...prev, [row.key]: 'Stok fisik harus berupa angka, minimal 0.' }))
      return
    }

    window.api.stockOpname
      .recordAdjustment({ productId: row.productId, stokSesudah: stokFisikNum, alasan: row.alasan || null })
      .then(() => {
        setRows((prev) =>
          prev.map((r) =>
            r.key === row.key ? { ...r, stokSistem: Math.round(stokFisikNum * 1000) / 1000 } : r,
          ),
        )
        setSavedKeys((prev) => new Set(prev).add(row.key))
        setTimeout(() => {
          setSavedKeys((prev) => {
            const next = new Set(prev)
            next.delete(row.key)
            return next
          })
        }, 2000)
      })
      .catch((err) => {
        setRowErrors((prev) => ({ ...prev, [row.key]: err instanceof Error ? err.message : 'Gagal menyimpan' }))
      })
  }

  function handleRowsChange(newRows: DraftRow[], data: RowsChangeData<DraftRow>) {
    setRows(newRows)
    if (data.column.key !== 'stokFisik') {
      return
    }
    const row = newRows[data.indexes[0]]
    // compared as numbers: "5,5" and "5.5" are the same count, only a real change saves
    if (parseQty(row.stokFisik) !== row.stokSistem) {
      saveRow(row)
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
    { key: 'kodeItem', name: 'Kode', width: 110 },
    { key: 'namaItem', name: 'Nama', width: namaWidth },
    { key: 'categoryName', name: 'Kategori', width: 130 },
    { key: 'satuan', name: 'Satuan', width: 80 },
    {
      key: 'stokSistem',
      name: 'Stok Sistem',
      width: 100,
      renderCell: ({ row }) => <span className="text-muted-foreground">{formatQty(row.stokSistem)}</span>,
    },
    textColumn('stokFisik', 'Stok Fisik', 100),
    {
      key: 'selisih',
      name: 'Selisih',
      width: 90,
      renderCell: ({ row }) => {
        const stokFisikNum = parseQty(row.stokFisik)
        if (row.stokFisik.trim() === '' || !Number.isFinite(stokFisikNum)) {
          return <span className="text-muted-foreground">-</span>
        }
        const selisih = Math.round((stokFisikNum - row.stokSistem) * 1000) / 1000
        const colorClass = selisih > 0 ? 'text-green-600' : selisih < 0 ? 'text-destructive' : 'text-muted-foreground'
        return (
          <span className={colorClass}>
            {selisih > 0 ? `+${formatQty(selisih)}` : formatQty(selisih)}
            {savedKeys.has(row.key) && <span className="text-xs text-muted-foreground"> · Tersimpan</span>}
          </span>
        )
      },
    },
    textColumn('alasan', 'Alasan', 200),
  ]

  const errorSummary = Object.entries(rowErrors).map(([key, message]) => {
    const row = rows.find((r) => r.key === key)
    return `${row?.namaItem ?? 'Baris'}: ${message}`
  })

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Stok Opname" />

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={submitSearch} className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kode / nama / barcode..."
              className="w-64"
            />
            <Button type="submit" variant="secondary">
              Cari
            </Button>
          </form>

          <Button type="button" variant="outline" onClick={() => setCategoryPickerOpen(true)}>
            {selectedCategoryLabel}
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </div>

        {errorSummary.length > 0 && (
          <div className="space-y-1 text-sm text-destructive">
            {errorSummary.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}

        {!hasSearched && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Cari produk atau pilih kategori untuk mulai stok opname.
          </div>
        )}

        {hasSearched && (
          <div ref={gridContainerRef} className="overflow-x-auto">
            {gridWidth > 0 && (
              <DataGrid
                className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
                columns={columns}
                rows={rows}
                rowKeyGetter={(row) => row.key}
                onRowsChange={handleRowsChange}
                renderers={{
                  noRowsFallback: (
                    <div className="col-span-full p-6 text-center text-sm text-muted-foreground">
                      Produk tidak ditemukan.
                    </div>
                  ),
                }}
                style={{ blockSize: gridHeight, minHeight: 300 }}
              />
            )}
          </div>
        )}
      </Page>

      <CommandDialog
        open={categoryPickerOpen}
        onOpenChange={setCategoryPickerOpen}
        title="Kategori"
        description="Pilih satu atau beberapa kategori"
      >
        <CommandInput placeholder="Cari kategori..." />
        <CommandList>
          <CommandEmpty>Kategori tidak ditemukan.</CommandEmpty>
          {selectedCategoryIds.length > 0 && (
            <CommandGroup>
              <CommandItem value="__semua__" onSelect={clearCategories}>
                <Check className="size-4 opacity-0" />
                Semua kategori
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading="Kategori">
            {categories.map((c) => (
              // stays open on select: picking categories is a multiple choice
              <CommandItem key={c.id} value={c.nama} onSelect={() => toggleCategory(c.id)}>
                <Check className={selectedCategoryIds.includes(c.id) ? 'size-4' : 'size-4 opacity-0'} />
                {c.nama}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1.5 py-0.5">&uarr;&darr;</kbd>
            pilih
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1.5 py-0.5">&crarr;</kbd>
            centang
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1.5 py-0.5">esc</kbd>
            tutup
          </span>
        </div>
      </CommandDialog>
    </AppShell>
  )
}
