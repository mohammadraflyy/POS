import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Page rhythm lives here rather than in each page. Every screen used to
 * hand-copy `flex flex-1 flex-col gap-4 p-4` and its own `<h1>`, which is why
 * no two pages agreed on their spacing.
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-1 flex-col gap-6 p-6', className)}>{children}</div>
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** the filter/action row most list pages carry above their table */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-end gap-2', className)}>{children}</div>
}
