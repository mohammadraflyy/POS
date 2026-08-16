import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { DataGrid, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Page, PageHeader } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useConfirm } from '@/hooks/use-confirm'
import { useElementWidth } from '@/hooks/use-element-width'
import { AppShell } from '../../layouts/AppShell'
import type { BreadcrumbItem } from '../../types'

interface DraftRow {
  key: string
  id: number | null
  kodeItem: string
  barcode: string
  namaItem: string
  kategori: string
  satuan: string
  hargaPokok: string
  hargaJual: string
  stok: string
  unitsCount: number
  priceTiersCount: number
}

function emptyRow(): DraftRow {
  return {
    key: crypto.randomUUID(),
    id: null,
    kodeItem: '',
    barcode: '',
    namaItem: '',
    kategori: '',
    satuan: '',
    hargaPokok: '',
    hargaJual: '',
    stok: '0',
    unitsCount: 0,
    priceTiersCount: 0,
  }
}

const OTHER_COLUMNS_WIDTH = 110 + 130 + 130 + 90 + 110 + 110 + 90 + 170 + 60
const MIN_NAMA_WIDTH = 220

const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Katalog Produk', href: '/inventory' },
  { title: 'Input Massal', href: '/inventory/mass-input' },
]

export function MassInput() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(80)

  const [rows, setRows] = useState<DraftRow[]>([emptyRow()])
  const [rowErrors, setRowErrors] = useState<Record<string, Record<string, string>>>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [processing, setProcessing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  useEffect(() => {
    const idsParam = searchParams.get('ids')
    const barcodeParam = searchParams.get('barcode')

    if (!idsParam) {
      // arriving from a scan that matched nothing - start with the barcode already filled
      if (barcodeParam) {
        setRows([{ ...emptyRow(), barcode: barcodeParam }])
      }

      setLoaded(true)
      return
    }

    const ids = idsParam
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))

    if (ids.length === 0) {
      setLoaded(true)
      return
    }

    window.api.inventory
      .getProductsByIds(ids)
      .then((fetched) => {
        setRows(
          fetched.map((p) => ({
            key: `product-${p.id}`,
            id: p.id,
            kodeItem: p.kodeItem,
            barcode: p.barcode ?? '',
            namaItem: p.namaItem,
            kategori: p.categoryName ?? '',
            satuan: p.satuan,
            hargaPokok: String(p.hargaPokok),
            hargaJual: String(p.hargaJual),
            stok: String(p.stok),
            unitsCount: p.unitsCount,
            priceTiersCount: p.priceTiersCount,
          })),
        )
        setLoaded(true)
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal memuat produk')
        setLoaded(true)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key))
  }

  /**
   * The unit/tier editor is its own page now, so opening it leaves this grid - and any
   * row still waiting to be saved would go with it. Warn before that happens.
   */
  async function openProductDetail(productId: number) {
    const belumTersimpan = rows.filter((row) => row.id === null && (row.kodeItem.trim() || row.namaItem.trim())).length

    if (belumTersimpan > 0) {
      const lanjut = await confirm({
        title: 'Baris belum tersimpan',
        description: `Ada ${belumTersimpan} baris yang belum disimpan. Membuka pengaturan satuan akan meninggalkan halaman ini dan baris itu hilang. Lanjutkan?`,
        confirmLabel: 'Lanjut',
        destructive: true,
      })

      if (!lanjut) {
        return
      }
    }

    navigate(`/inventory/${productId}`)
  }

  function validateClientSide(): Record<string, Record<string, string>> {
    const errors: Record<string, Record<string, string>> = {}

    function addError(key: string, field: string, message: string) {
      errors[key] = { ...(errors[key] ?? {}), [field]: message }
    }

    for (const row of rows) {
      if (!row.kodeItem.trim()) {
        addError(row.key, 'kodeItem', 'Wajib diisi.')
      }
      if (!row.namaItem.trim()) {
        addError(row.key, 'namaItem', 'Wajib diisi.')
      }
      if (!row.satuan.trim()) {
        addError(row.key, 'satuan', 'Wajib diisi.')
      }
      if (row.hargaPokok.trim() === '' || !Number.isFinite(Number(row.hargaPokok))) {
        addError(row.key, 'hargaPokok', 'Harus angka.')
      }
      if (row.hargaJual.trim() === '' || !Number.isFinite(Number(row.hargaJual))) {
        addError(row.key, 'hargaJual', 'Harus angka.')
      }
    }

    const byKodeItem = new Map<string, string[]>()
    for (const row of rows) {
      const kode = row.kodeItem.trim()
      if (!kode) continue
      byKodeItem.set(kode, [...(byKodeItem.get(kode) ?? []), row.key])
    }
    for (const keys of byKodeItem.values()) {
      if (keys.length > 1) {
        for (const key of keys) {
          addError(key, 'kodeItem', 'Kode item duplikat pada baris ini.')
        }
      }
    }

    return errors
  }

  function submit() {
    const clientErrors = validateClientSide()

    if (Object.keys(clientErrors).length > 0) {
      setRowErrors(clientErrors)
      setFormError('Periksa kembali baris yang bertanda merah.')
      return
    }

    setProcessing(true)
    setFormError(undefined)

    window.api.inventory
      .bulkSaveProducts(
        rows.map((row) => ({
          key: row.key,
          id: row.id,
          kodeItem: row.kodeItem,
          barcode: row.barcode || null,
          namaItem: row.namaItem,
          kategori: row.kategori || null,
          satuan: row.satuan,
          hargaPokok: Number(row.hargaPokok),
          hargaJual: Number(row.hargaJual),
          stok: Number(row.stok) || 0,
        })),
      )
      .then((result) => {
        if (result.success) {
          navigate('/inventory')
          return
        }

        setRowErrors(result.rowErrors)
        setFormError('Beberapa baris gagal disimpan, periksa kembali.')
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal menyimpan')
      })
      .finally(() => setProcessing(false))
  }

  const namaWidth = Math.max(MIN_NAMA_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  function textColumn(key: keyof DraftRow, name: string, width?: number): Column<DraftRow> {
    return {
      key,
      name,
      width,
      editable: true,
      renderEditCell: renderTextEditor,
      cellClass: (row) => (rowErrors[row.key]?.[key] ? 'bg-red-100 dark:bg-red-950' : undefined),
    }
  }

  const columns: Column<DraftRow>[] = [
    textColumn('kodeItem', 'Kode Item', 110),
    textColumn('barcode', 'Barcode', 130),
    textColumn('namaItem', 'Nama Item', namaWidth),
    textColumn('kategori', 'Kategori', 130),
    textColumn('satuan', 'Satuan', 90),
    textColumn('hargaPokok', 'Harga Pokok', 110),
    textColumn('hargaJual', 'Harga Jual', 110),
    {
      key: 'stok',
      name: 'Stok',
      width: 90,
      editable: (row) => row.id === null,
      renderEditCell: renderTextEditor,
      renderCell: ({ row }) => (row.id === null ? row.stok : <span className="text-muted-foreground">{row.stok}</span>),
    },
    {
      key: 'units',
      name: 'Satuan/Harga Bertingkat',
      width: 170,
      renderCell: ({ row }) => {
        const productId = row.id
        if (productId === null) {
          return <span className="text-xs text-muted-foreground">Simpan baris dulu</span>
        }
        return (
          <button type="button" className="flex h-full items-center gap-1" onClick={() => openProductDetail(productId)}>
            <Badge variant={row.unitsCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
              {row.unitsCount} unit
            </Badge>
            <Badge variant={row.priceTiersCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
              {row.priceTiersCount} tingkat
            </Badge>
          </button>
        )
      },
    },
    {
      key: 'remove',
      name: '',
      width: 60,
      renderCell: ({ row }) => (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => removeRow(row.key)}
        >
          Hapus
        </button>
      ),
    },
  ]

  const errorSummary = rows.flatMap((row, index) =>
    Object.values(rowErrors[row.key] ?? {}).map((message) => `Baris ${index + 1}: ${message}`),
  )

  if (!loaded) {
    return (
      <AppShell breadcrumbs={BREADCRUMBS}>
        <div className="p-4 text-sm text-muted-foreground">Memuat...</div>
      </AppShell>
    )
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Input Massal Produk" />

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
              onRowsChange={setRows}
              style={{ blockSize: gridHeight, minHeight: 300 }}
            />
          )}
        </div>

        <div>
          <Button variant="outline" size="sm" onClick={addRow}>
            + Tambah Baris
          </Button>
        </div>

        {errorSummary.length > 0 && (
          <div className="space-y-1 text-sm text-destructive">
            {errorSummary.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={submit} disabled={processing}>
            Simpan Semua
          </Button>
          <Button variant="outline" onClick={() => navigate('/inventory')}>
            Batal
          </Button>
        </div>
      </Page>

      {ConfirmDialog}
    </AppShell>
  )
}
