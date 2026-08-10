import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column, RowsChangeData } from 'react-data-grid'
import { DataGrid, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useElementWidth } from '@/hooks/use-element-width'
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
    stokFisik: String(p.stok),
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

  const [search, setSearch] = useState('')
  const [categories, setCategories] = useState<{ id: number; nama: string }[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([])
  const [rows, setRows] = useState<DraftRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [hasSearched, setHasSearched] = useState(false)
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.stockOpname.listCategories().then(setCategories)
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

  function saveRow(row: DraftRow) {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.key]
      return next
    })

    const stokFisikNum = Number(row.stokFisik)

    if (row.stokFisik.trim() === '' || !Number.isInteger(stokFisikNum) || stokFisikNum < 0) {
      setRowErrors((prev) => ({ ...prev, [row.key]: 'Stok fisik harus bilangan bulat, minimal 0.' }))
      return
    }

    window.api.stockOpname
      .recordAdjustment({ productId: row.productId, stokSesudah: stokFisikNum, alasan: row.alasan || null })
      .then(() => {
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, stokSistem: stokFisikNum } : r)),
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
    if (row.stokFisik !== String(row.stokSistem)) {
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
      renderCell: ({ row }) => <span className="text-muted-foreground">{row.stokSistem}</span>,
    },
    textColumn('stokFisik', 'Stok Fisik', 100),
    {
      key: 'selisih',
      name: 'Selisih',
      width: 90,
      renderCell: ({ row }) => {
        const stokFisikNum = Number(row.stokFisik)
        if (row.stokFisik.trim() === '' || !Number.isFinite(stokFisikNum)) {
          return <span className="text-muted-foreground">-</span>
        }
        const selisih = stokFisikNum - row.stokSistem
        const colorClass = selisih > 0 ? 'text-green-600' : selisih < 0 ? 'text-destructive' : 'text-muted-foreground'
        return (
          <span className={colorClass}>
            {selisih > 0 ? `+${selisih}` : selisih}
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                Kategori {selectedCategoryIds.length > 0 && `(${selectedCategoryIds.length})`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {categories.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={selectedCategoryIds.includes(c.id)}
                  onSelect={(e) => {
                    e.preventDefault()
                    toggleCategory(c.id)
                  }}
                >
                  {c.nama}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
    </AppShell>
  )
}
