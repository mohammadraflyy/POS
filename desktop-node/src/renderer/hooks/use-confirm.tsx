import React, { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ConfirmOptions = {
  title?: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

/**
 * In-app replacement for window.confirm(): await confirm(...) resolves to
 * true/false instead of blocking the page. Render the returned dialog once.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<(value: boolean) => void>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    setOptions(typeof opts === 'string' ? { description: opts } : opts)

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  function settle(result: boolean) {
    setOptions(null)
    resolveRef.current?.(result)
  }

  /**
   * The till is driven by PageUp/PageDown elsewhere, so the same keys hop between
   * the two actions here. With only two buttons either key moves to the other one,
   * and Enter fires whatever is focused.
   */
  function hopAction(event: React.KeyboardEvent) {
    if (event.key !== 'PageUp' && event.key !== 'PageDown') {
      return
    }

    event.preventDefault()
    const target = document.activeElement === confirmRef.current ? cancelRef : confirmRef
    target.current?.focus()
  }

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="sm:max-w-sm" onKeyDown={hopAction}>
        <DialogHeader>
          <DialogTitle>{options?.title ?? 'Konfirmasi'}</DialogTitle>
          <DialogDescription>{options?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancelRef} variant="outline" onClick={() => settle(false)}>
            {options?.cancelLabel ?? 'Batal'}
          </Button>
          <Button
            ref={confirmRef}
            autoFocus
            variant={options?.destructive ? 'destructive' : 'default'}
            onClick={() => settle(true)}
          >
            {options?.confirmLabel ?? 'Ya'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, ConfirmDialog: dialog }
}
