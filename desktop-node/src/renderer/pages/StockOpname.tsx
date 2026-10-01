import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { Column } from 'react-data-grid'
import { DataGrid } from 'react-data-grid'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/hooks/use-confirm'
import { useAppearance } from '@/hooks/use-appearance'
import { useDraftState, useStickyState } from '@/hooks/use-sticky-state'
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
  stockRevision: number
  stok: number
}

interface DraftRow {
  key: string
  productId: number
  kodeItem: string
  namaItem: string
  categoryName: string
  satuan: string
  stockRevision: number
  stokSistem: number
  stokFisik: string
  alasan: string
}

/** one product's typed count, kept between visits until the row is saved */
interface CountDraft {
  expectedStock?: number
  expectedRevision?: number
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
    stockRevision: p.stockRevision,
    stokSistem: p.stok,
    stokFisik: '',
    alasan: '',
  }
}

const OTHER_COLUMNS_WIDTH = 110 + 130 + 80 + 130 + 120 + 150
const MIN_NAMA_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Stok Barang', href: '/stock-opname' }]

export function StockOpname() {
  const { confirm, ConfirmDialog } = useConfirm()
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [correctionId, setCorrectionId] = useState<number | null>(null)
  const requestId = useRef(0)
  const editingCell = useRef(false)
  const activeFilter = useRef({ q: '', categoryIds: [] as number[] })
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
  // Only entered counts are persisted; their original stock version survives refreshes.
  const [counts, setCounts] = useDraftState<Record<string, CountDraft>>('opname.counts', {})
  const countsRef = useRef(counts)
  countsRef.current = counts

  function updateCounts(next: Record<string, CountDraft>) {
    countsRef.current = next
    setCounts(next)
  }

  useEffect(() => {
    window.api.stockOpname.listCategories().then(setCategories).catch(() => setLoadError('Gagal memuat kategori.'))
    runSearch(search, selectedCategoryIds)
    const refresh = () => {
      if (document.visibilityState !== 'hidden' && !editingCell.current) {
        const { q, categoryIds } = activeFilter.current
        runSearch(q, categoryIds)
      }
    }
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      ++requestId.current
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  async function runSearch(q: string, categoryIds: number[]) {
    activeFilter.current = { q, categoryIds }
    const id = ++requestId.current
    if (q.trim() === '' && categoryIds.length === 0) {
      setRows([])
      setHasSearched(false)
      setRefreshing(false)
      setLastUpdated(null)
      return
    }
    setHasSearched(true)
    setRefreshing(true)
    try {
      const results = await window.api.stockOpname.searchProducts({ q, categoryIds })
      // Replacing a row closes react-data-grid's editor, losing uncommitted input.
      if (id !== requestId.current || editingCell.current) return
      setRows(results.map((p) => {
        const row = toDraftRow(p)
        const typed = countsRef.current[String(p.id)]
        return typed ? { ...row, stokFisik: typed.stokFisik, alasan: typed.alasan } : row
      }))
      setLastUpdated(new Date())
      setLoadError(null)
    } catch (err) {
      if (id === requestId.current) setLoadError(err instanceof Error ? err.message : 'Gagal memperbarui stok.')
    } finally {
      if (id === requestId.current) setRefreshing(false)
    }
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

  async function saveRow(row: DraftRow) {
    const draft = countsRef.current[String(row.productId)]
    if (!draft || saving) return
    const qty = parseQty(draft.stokFisik)
    if (!draft.stokFisik.trim() || !Number.isFinite(qty) || qty < 0) {
      setRowErrors((prev) => ({ ...prev, [row.key]: 'Masukkan jumlah barang dengan angka, minimal 0.' }))
      return
    }
    if (draft.expectedStock !== row.stokSistem || draft.expectedRevision !== row.stockRevision) {
      setRowErrors((prev) => ({ ...prev, [row.key]: 'Stok berubah atau draf lama belum memiliki acuan. Masukkan jumlah terbaru sebelum menyimpan.' }))
      return
    }
    setSaving(true)
    try {
      if (!await confirm({ title: 'Simpan koreksi stok?', description: row.namaItem + ': stok saat ini ' + formatQty(row.stokSistem) + ', jumlah sebenarnya ' + formatQty(qty) + '. Stok saat ini akan diubah menjadi ' + formatQty(qty) + ' sesuai hasil hitungan Anda.', confirmLabel: 'Simpan' })) return
      ++requestId.current
      await window.api.stockOpname.recordAdjustment({ productId: row.productId, stokSesudah: qty, alasan: draft.alasan || null, expectedStock: draft.expectedStock, expectedRevision: draft.expectedRevision })
      const next = { ...countsRef.current }
      delete next[String(row.productId)]
      updateCounts(next)
      setRowErrors((prev) => { const next = { ...prev }; delete next[row.key]; return next })
      setSavedKeys(new Set([row.key]))
      setCorrectionId(null)
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [row.key]: err instanceof Error ? err.message : 'Gagal menyimpan' }))
    } finally {
      setSaving(false)
      const { q, categoryIds } = activeFilter.current
      void runSearch(q, categoryIds)
    }
  }

  function editCorrection(row: DraftRow, field: 'stokFisik' | 'alasan', value: string) {
    const existing = countsRef.current[String(row.productId)]
    updateCounts({ ...countsRef.current, [String(row.productId)]: {
      ...(existing ?? {
        expectedStock: row.stokSistem, expectedRevision: row.stockRevision,
        stokFisik: '', alasan: '',
      }),
      [field]: value,
    } })
  }

  function recount(row: DraftRow) {
    const next = { ...countsRef.current }
    next[String(row.productId)] = {
      stokFisik: '', alasan: '',
      expectedStock: row.stokSistem, expectedRevision: row.stockRevision,
    }
    updateCounts(next)
    setRows((prev) => prev.map((r) => r.key === row.key ? { ...r, stokFisik: '', alasan: '' } : r))
    setRowErrors((prev) => { const next = { ...prev }; delete next[row.key]; return next })
  }

  const namaWidth = Math.max(MIN_NAMA_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  const columns: Column<DraftRow>[] = [
    { key: 'kodeItem', name: 'Kode', width: 110 },
    { key: 'namaItem', name: 'Nama', width: namaWidth },
    { key: 'categoryName', name: 'Kategori', width: 130 },
    { key: 'satuan', name: 'Satuan', width: 80 },
    {
      key: 'stokSistem',
      name: 'Stok Saat Ini',
      width: 130,
      renderCell: ({ row }) => <span className="text-muted-foreground">{formatQty(row.stokSistem)}</span>,
    },
    {
      key: 'status', name: 'Status', width: 120,
      renderCell: ({ row }) => <span className={row.stokSistem <= 0 ? 'text-destructive font-medium' : 'text-green-600'}>{row.stokSistem <= 0 ? 'Habis' : 'Tersedia'}</span>,
    },
    {
      key: 'actions', name: '', width: 150,
      renderCell: ({ row }) => <Button size="sm" variant="outline" onClick={() => setCorrectionId(row.productId)}>Koreksi stok</Button>,
    },
  ]

  const correction = rows.find((row) => row.productId === correctionId)
  const draft = correction ? counts[String(correction.productId)] : undefined
  const stale = !!correction && !!draft && (draft.expectedStock !== correction.stokSistem || draft.expectedRevision !== correction.stockRevision)
  const correctedQty = parseQty(draft?.stokFisik ?? '')
  const validCorrection = !!draft?.stokFisik.trim() && Number.isFinite(correctedQty) && correctedQty >= 0

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Stok Barang" />
        <p className="text-sm text-muted-foreground">Stok otomatis mengikuti penjualan dan pembelian. Koreksi hanya jika jumlah barang sebenarnya berbeda.</p>

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

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Button variant="outline" disabled={refreshing || saving || !hasSearched} onClick={() => void runSearch(activeFilter.current.q, activeFilter.current.categoryIds)}>Refresh</Button>
          <span>{refreshing ? 'Memperbarui stok...' : lastUpdated ? 'Terakhir diperbarui: ' + lastUpdated.toLocaleTimeString('id-ID') : ''} / Otomatis setiap 5 detik</span>
        </div>
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {savedKeys.size > 0 && <p role="status" className="text-sm text-green-600">Koreksi stok tersimpan. Transaksi berikutnya otomatis memperbarui stok.</p>}
        {hasSearched && <p className="text-xs text-muted-foreground">{rows.length} produk ditampilkan{selectedCategoryIds.length === 0 || search.trim() ? '. Maksimal 20 hasil, persempit pencarian atau pilih kategori untuk melihat lebih banyak.' : ''}</p>}

        {!hasSearched && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Cari nama / barcode atau pilih kategori untuk melihat stok terkini.
          </div>
        )}

        {hasSearched && (
          <div
            ref={gridContainerRef}
            className="overflow-x-auto"
            onFocusCapture={(event) => { editingCell.current = event.target instanceof HTMLInputElement }}
            onBlurCapture={() => { editingCell.current = false }}
          >
            {gridWidth > 0 && (
              <DataGrid
                className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
                columns={columns}
                rows={rows}
                rowKeyGetter={(row) => row.key}
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

      <Dialog open={correctionId !== null} onOpenChange={(open) => { if (!open && !saving) setCorrectionId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Koreksi stok</DialogTitle>
            <DialogDescription>Gunakan saat ada selisih barang. Penjualan dan pembelian sudah memperbarui stok secara otomatis.</DialogDescription>
          </DialogHeader>
          {correction && <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="font-medium">{correction.namaItem}</p>
              <p className="text-sm text-muted-foreground">{correction.kodeItem}</p>
              <p className="mt-2 text-2xl font-semibold">{formatQty(correction.stokSistem)} <span className="text-sm font-normal">{correction.satuan}</span></p>
              <p className="text-xs text-muted-foreground">Stok saat ini</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="corrected-stock" className="text-sm font-medium">Jumlah barang sebenarnya ({correction.satuan})</label>
              <Input id="corrected-stock" inputMode="decimal" placeholder="Masukkan jumlah terbaru" value={draft?.stokFisik ?? ''} disabled={saving} onChange={(event) => editCorrection(correction, 'stokFisik', event.target.value)} />
              <p className="text-xs text-muted-foreground">Isi jumlah akhir, bukan jumlah yang ditambah atau dikurangi. Isi 0 jika habis.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="correction-reason" className="text-sm font-medium">Catatan (opsional)</label>
              <Input id="correction-reason" maxLength={255} placeholder="Contoh: barang rusak atau selisih pencatatan" value={draft?.alasan ?? ''} disabled={saving} onChange={(event) => editCorrection(correction, 'alasan', event.target.value)} />
            </div>
            {validCorrection && <p className="text-sm">Perubahan: {formatQty(correction.stokSistem)} &rarr; {formatQty(correctedQty)} {correction.satuan}</p>}
            {stale && <div role="alert" className="space-y-2 text-sm text-destructive"><p>Ada perubahan stok sejak koreksi dimulai. Periksa jumlah terbaru sebelum menyimpan.</p><Button variant="outline" disabled={saving} onClick={() => recount(correction)}>Masukkan jumlah terbaru</Button></div>}
            {rowErrors[correction.key] && <p role="alert" className="text-sm text-destructive">{rowErrors[correction.key]}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={saving} onClick={() => setCorrectionId(null)}>Tutup</Button>
              <Button disabled={saving || stale || !validCorrection} onClick={() => void saveRow(correction)}>{saving ? 'Menyimpan...' : 'Simpan koreksi'}</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
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
