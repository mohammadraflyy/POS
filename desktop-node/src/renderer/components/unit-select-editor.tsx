import type { RenderEditCellProps } from 'react-data-grid'

export interface UnitOption {
  id: number
  code: string
}

/**
 * Cell editor that limits a satuan column to the codes registered in Master Satuan.
 *
 * Mirrors the satuan editor in `kasir/CartGrid.tsx`: grid cell navigation only ever
 * focuses the cell wrapper, so a <select> rendered in `renderCell` would be
 * mouse-only. `renderEditCell` is how react-data-grid hands real keyboard focus to
 * one - F2 or Enter opens it and the grid defers all keys to it.
 *
 * Memoise the returned component (see the callers) - creating a new component type
 * on every render would remount the editor mid-edit and steal focus.
 */
export function renderUnitSelectEditor<TRow>(
  units: UnitOption[],
  getSatuan: (row: TRow) => string,
  setSatuan: (row: TRow, satuan: string) => TRow,
) {
  return function UnitSelectEditor({ row, onRowChange, onClose }: RenderEditCellProps<TRow>) {
    const current = getSatuan(row)
    const known = units.some((unit) => unit.code === current)

    return (
      <select
        ref={(select) => select?.focus()}
        defaultValue={current}
        onChange={(e) => onRowChange(setSatuan(row, e.target.value), true)}
        onBlur={() => onClose(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose(false)
          }
        }}
        className="h-full w-full bg-background px-2 text-sm outline-none"
      >
        {current === '' && <option value="">Pilih satuan...</option>}
        {/* a product saved before its satuan was deactivated must still show its own */}
        {current !== '' && !known && <option value={current}>{current}</option>}
        {units.map((unit) => (
          <option key={unit.id} value={unit.code}>
            {unit.code}
          </option>
        ))}
      </select>
    )
  }
}
