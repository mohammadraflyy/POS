import type { RefObject } from 'react'
import type {
  CellKeyboardEvent,
  CellKeyDownArgs,
  Column,
  DataGridHandle,
  RenderEditCellProps,
  RowsChangeData,
} from 'react-data-grid'
import { DataGrid } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatQty, formatRupiah, parseQty } from '@/lib/utils'
import {
  activeTier,
  isBelowHargaPokok,
  lineGross,
  lineSubtotal,
  parseDiskon,
  unitHargaPokok,
  unitPrice,
  type CartLine,
} from './cart-logic'

/**
 * Column order, single-sourced so a keyboard shortcut can aim at a column by name.
 * Keep it in step with `columns` below - the grid is built from these keys in order.
 */
const COLUMN_KEYS = ['no', 'produk', 'satuan', 'harga', 'diskon', 'qty', 'subtotal', 'aksi'] as const

export const QTY_COLUMN_IDX = COLUMN_KEYS.indexOf('qty')

function focusAndSelectQtyInput(input: HTMLInputElement | null) {
  input?.focus()
  input?.select()
}

function focusSelect(select: HTMLSelectElement | null) {
  select?.focus()
}

function renderHargaEditCell({ row, onRowChange, onClose }: RenderEditCellProps<CartLine>) {
  return (
    <input
      type="text"
      inputMode="numeric"
      ref={focusAndSelectQtyInput}
      // uncontrolled for the same reason as qty: re-syncing a parsed number on
      // every keystroke fights the cashier mid-edit
      defaultValue={unitPrice(row)}
      title="Harga khusus untuk baris ini - mengabaikan harga master dan harga bertingkat"
      className="h-full w-full bg-background px-2 text-right text-sm outline-none"
      onChange={(e) =>
        onRowChange({ ...row, hargaOverride: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 })
      }
      onBlur={() => onClose(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onClose(true, false)
        } else if (e.key === 'Escape') {
          onClose(false)
        }
      }}
    />
  )
}

function renderDiskonEditCell({ row, onRowChange, onClose }: RenderEditCellProps<CartLine>) {
  // resolved against the line as it stands, so "10%" means 10% of what this line costs now
  const base = lineGross(row)

  return (
    <input
      type="text"
      ref={focusAndSelectQtyInput}
      // uncontrolled like qty and harga: "10%" has to survive being typed one key at a
      // time, and a value re-synced from the parsed number would eat the "%"
      defaultValue={row.diskon ? String(row.diskon) : ''}
      title="Isi nominal rupiah (5000) atau persen (10%) - dihitung dari subtotal baris ini"
      placeholder="0 atau 10%"
      className="h-full w-full bg-background px-2 text-right text-sm outline-none"
      onChange={(e) => onRowChange({ ...row, diskon: parseDiskon(e.target.value, base) })}
      onBlur={() => onClose(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onClose(true, false)
        } else if (e.key === 'Escape') {
          onClose(false)
        }
      }}
    />
  )
}

function renderQtyEditCell({ row, onRowChange, onClose }: RenderEditCellProps<CartLine>) {
  return (
    <input
      type="text"
      inputMode="decimal"
      ref={focusAndSelectQtyInput}
      // uncontrolled: a controlled `value` re-synced from the parsed number
      // on every keystroke wipes out a trailing "." before the fractional
      // digits are typed, so "0.25" degrades into "025"
      defaultValue={formatQty(row.qty)}
      title="Boleh diisi pecahan, misalnya 0,25 - diambil persis sesuai satuan yang dipilih"
      className="h-full w-full bg-background px-2 text-center text-sm font-semibold outline-none"
      onChange={(e) => onRowChange({ ...row, qty: parseQty(e.target.value) || 0 })}
      onBlur={() => onClose(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onClose(true, false)
        } else if (e.key === 'Escape') {
          onClose(false)
        }
      }}
    />
  )
}

export interface CartGridProps {
  cart: CartLine[]
  width: number
  resolvedAppearance: 'light' | 'dark'
  /** editing a saved sale - only then may a price be overridden by hand */
  editMode: boolean
  gridRef: RefObject<DataGridHandle | null>
  onRowsChange: (rows: CartLine[], data: RowsChangeData<CartLine>) => void
  onCellKeyDown: (args: CellKeyDownArgs<CartLine>, event: CellKeyboardEvent) => void
  onChangeUnit: (line: CartLine, productUnitId: number | null) => void
  onRemoveLine: (key: string) => void
}

export function CartGrid({
  cart,
  width,
  resolvedAppearance,
  editMode,
  gridRef,
  onRowsChange,
  onCellKeyDown,
  onChangeUnit,
  onRemoveLine,
}: CartGridProps) {
  const CART_OTHER_COLUMNS_WIDTH = 50 + 180 + 120 + 110 + 80 + 130 + 50
  const produkWidth = Math.max(160, width - CART_OTHER_COLUMNS_WIDTH - 2)

  const columns: Column<CartLine>[] = [
    {
      key: 'no',
      name: 'No',
      width: 50,
      // the cart is never paginated, so the row number is just its position
      renderCell: ({ rowIdx }) => <span className="text-muted-foreground">{rowIdx + 1}</span>,
    },
    {
      key: 'produk',
      name: 'Produk',
      width: produkWidth,
      renderCell: ({ row }) => <span className="font-medium">{row.product.namaItem}</span>,
    },
    {
      key: 'satuan',
      name: 'Satuan',
      width: 180,
      // grid cell navigation (arrow keys/tab) only ever focuses the cell
      // wrapper div, not a descendant - a select rendered directly in
      // renderCell is mouse-only. Editable + renderEditCell is RDG's
      // supported way to hand real keyboard focus to a <select>: F2/Enter
      // opens the editor (autofocused below) and RDG defers all keys to it.
      editable: (row) => row.product.productUnits.length > 0,
      renderCell: ({ row }) => (
        <span className="text-xs font-medium">
          {row.productUnitId === null
            ? row.product.satuan
            : (row.product.productUnits.find((u) => u.id === row.productUnitId)?.satuan ?? row.satuan)}
        </span>
      ),
      renderEditCell: ({ row, onClose }) => (
        <select
          ref={focusSelect}
          defaultValue={row.productUnitId ?? 'base'}
          onChange={(e) => {
            onChangeUnit(row, e.target.value === 'base' ? null : Number(e.target.value))
            onClose(true, false)
          }}
          onBlur={() => onClose(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onClose(false)
            }
          }}
          className="h-full w-full bg-background px-2 text-xs font-medium outline-none"
        >
          <option value="base">{row.product.satuan}</option>
          {row.product.productUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.satuan}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'harga',
      name: 'Harga',
      width: 120,
      // a new sale always prices from master and tier; only a correction to a
      // saved sale may set a price by hand
      editable: () => editMode,
      renderEditCell: renderHargaEditCell,
      renderCell: ({ row }) => {
        const tier = activeTier(row)
        const rugi = isBelowHargaPokok(row)

        return (
          <span className={rugi ? 'text-xs font-semibold text-destructive' : 'text-xs text-muted-foreground'}>
            {formatRupiah(unitPrice(row))}
            {rugi && (
              <span
                className="block text-[10px] text-destructive"
                title={`Di bawah harga pokok ${formatRupiah(unitHargaPokok(row))} - simpan akan ditolak`}
              >
                &lt; pokok {formatRupiah(unitHargaPokok(row))}
              </span>
            )}
            {tier && (
              <span className="block text-[10px] text-muted-foreground">
                tier {tier.minQty}
                {tier.maxQty === null ? '+' : `-${tier.maxQty}`}
              </span>
            )}
          </span>
        )
      },
    },
    {
      // unlike Harga, this is editable on a brand new sale too: giving a discount at the
      // till is the whole point, where correcting a charged price is a repair job
      key: 'diskon',
      name: 'Diskon',
      width: 110,
      editable: true,
      renderEditCell: renderDiskonEditCell,
      renderCell: ({ row }) => {
        const diskon = row.diskon ?? 0
        const gross = lineGross(row)

        return (
          <span className="w-full text-right text-xs tabular-nums">
            {diskon > 0 ? (
              <>
                <span className="text-destructive">-{formatRupiah(diskon)}</span>
                {gross > 0 && (
                  <span className="block text-[10px] text-muted-foreground">
                    {Math.round((diskon / gross) * 100)}%
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </span>
        )
      },
    },
    {
      key: 'qty',
      name: 'Qty',
      width: 80,
      editable: true,
      renderEditCell: renderQtyEditCell,
      renderCell: ({ row }) => (
        <span
          className="text-sm font-semibold"
          title="Boleh diisi pecahan, misalnya 0,25 - diambil persis sesuai satuan yang dipilih"
        >
          {formatQty(row.qty)}
        </span>
      ),
    },
    {
      key: 'subtotal',
      name: 'Subtotal',
      width: 130,
      renderCell: ({ row }) => (
        <span className="w-full text-right font-semibold tabular-nums">
          {formatRupiah(lineSubtotal(row))}
          {(row.diskon ?? 0) > 0 && (
            <span className="block text-[10px] font-normal text-muted-foreground line-through">
              {formatRupiah(lineGross(row))}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'aksi',
      name: '',
      width: 50,
      renderCell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onRemoveLine(row.key)}
        >
          <X className="size-4" />
        </Button>
      ),
    },
  ]

  return (
    <DataGrid
      ref={gridRef}
      className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
      columns={columns}
      rows={cart}
      onRowsChange={onRowsChange}
      onCellKeyDown={onCellKeyDown}
      rowKeyGetter={(row) => row.key}
      headerRowHeight={44}
      rowHeight={48}
      style={{ blockSize: 44 + cart.length * 48 + 2 }}
    />
  )
}
