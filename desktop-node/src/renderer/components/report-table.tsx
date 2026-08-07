import type { Key, ReactNode } from 'react'
import { DataGrid } from 'react-data-grid'
import type { Column } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { useAppearance } from '@/hooks/use-appearance'
import { useElementWidth } from '@/hooks/use-element-width'

export function ReportTable<T>({
  title,
  action,
  columns,
  rows,
  rowKey,
  emptyMessage,
}: {
  title: string
  action?: ReactNode
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => Key
  emptyMessage: string
}) {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, width] = useElementWidth<HTMLDivElement>()
  const height = Math.min(320, Math.max(120, 42 + rows.length * 35))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div ref={widthRef}>
        {width > 0 && (
          <DataGrid
            className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
            columns={columns}
            rows={rows}
            rowKeyGetter={rowKey}
            renderers={{
              noRowsFallback: (
                <div className="col-span-full p-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>
              ),
            }}
            style={{ blockSize: height }}
          />
        )}
      </div>
    </div>
  )
}
