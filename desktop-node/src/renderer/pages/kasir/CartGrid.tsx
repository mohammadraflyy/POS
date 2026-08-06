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
import { cn, formatRupiah } from '@/lib/utils'
import { unitPrice, type CartLine } from './cart-logic'

function focusAndSelectQtyInput(input: HTMLInputElement | null) {
  input?.focus()
  input?.select()
}

function renderQtyEditCell({ row, onRowChange, onClose }: RenderEditCellProps<CartLine>) {
  return (
    <input
      type="text"
      inputMode="decimal"
      ref={focusAndSelectQtyInput}
      value={row.qty}
      title="Boleh diisi pecahan, misalnya 0.5 - otomatis dibulatkan ke satuan yang pas"
      className="h-full w-full bg-background px-2 text-center text-sm font-semibold outline-none"
      onChange={(e) => onRowChange({ ...row, qty: Number(e.target.value) || 0 })}
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

/** index of the 'qty' column within the columns array (produk, satuan, harga, qty, subtotal, aksi) */
export const QTY_COLUMN_IDX = 3

export interface CartGridProps {
  cart: CartLine[]
  width: number
  resolvedAppearance: 'light' | 'dark'
  gridRef: RefObject<DataGridHandle>
  onRowsChange: (rows: CartLine[], data: RowsChangeData<CartLine>) => void
  onCellKeyDown: (args: CellKeyDownArgs<CartLine>, event: CellKeyboardEvent) => void
  onChangeUnit: (line: CartLine, productUnitId: number | null) => void
  onRemoveLine: (key: string) => void
}

export function CartGrid({
  cart,
  width,
  resolvedAppearance,
  gridRef,
  onRowsChange,
  onCellKeyDown,
  onChangeUnit,
  onRemoveLine,
}: CartGridProps) {
  const CART_OTHER_COLUMNS_WIDTH = 180 + 120 + 80 + 130 + 50
  const produkWidth = Math.max(160, width - CART_OTHER_COLUMNS_WIDTH - 2)

  const columns: Column<CartLine>[] = [
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
      renderCell: ({ row }) =>
        row.product.productUnits.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 py-1">
            <button
              type="button"
              onClick={() => onChangeUnit(row, null)}
              className={cn(
                'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                row.productUnitId === null
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background hover:bg-accent',
              )}
            >
              {row.product.satuan}
            </button>
            {row.product.productUnits.map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => onChangeUnit(row, unit.id)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                  row.productUnitId === unit.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent',
                )}
              >
                {unit.satuan}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{row.satuan}</span>
        ),
    },
    {
      key: 'harga',
      name: 'Harga',
      width: 120,
      renderCell: ({ row }) => <span className="text-xs text-muted-foreground">{formatRupiah(unitPrice(row))}</span>,
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
          title="Boleh diisi pecahan, misalnya 0.5 - otomatis dibulatkan ke satuan yang pas"
        >
          {row.qty}
        </span>
      ),
    },
    {
      key: 'subtotal',
      name: 'Subtotal',
      width: 130,
      renderCell: ({ row }) => (
        <span className="w-full text-right font-semibold">{formatRupiah(row.qty * unitPrice(row))}</span>
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
