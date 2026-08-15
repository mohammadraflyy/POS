import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeftRight, Banknote, CornerDownLeft, HandCoins, Pencil, Printer, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useConfirm } from '@/hooks/use-confirm'
import { cn, formatRupiah } from '@/lib/utils'
import { DEFAULT_PELANGGAN } from './CustomerPicker'

const actions = ['cetak', 'simpan', 'batal'] as const
type Action = (typeof actions)[number]

export interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  metode: 'tunai' | 'bon' | 'qris' | 'transfer'
  setMetode: (metode: 'tunai' | 'bon' | 'qris' | 'transfer') => void
  namaPelanggan: string
  /** hands the cashier back to the customer picker on the kasir page */
  onEditCustomer: () => void
  dibayar: string
  setDibayar: (value: string) => void
  /** local `YYYY-MM-DDTHH:mm` the sale will be filed under */
  tanggal: string
  setTanggal: (value: string) => void
  processing: boolean
  printing: boolean
  error: string | null
  onSubmit: (shouldPrint: boolean) => void
}

export function PaymentDialog({
  open,
  onOpenChange,
  total,
  metode,
  setMetode,
  namaPelanggan,
  onEditCustomer,
  dibayar,
  setDibayar,
  tanggal,
  setTanggal,
  processing,
  printing,
  error,
  onSubmit,
}: PaymentDialogProps) {
  // qris/transfer land on the exact total; only cash can overpay and only bon can underpay
  const totalBayar = metode === 'tunai' ? Number(dibayar || 0) : metode === 'bon' ? 0 : total
  const selisih = total - totalBayar
  // qris and transfer arrive for the exact amount, so they are settled the moment they are chosen
  const isLunas = (metode === 'tunai' && selisih <= 0) || metode === 'qris' || metode === 'transfer'
  // Bon debt is collected per person, so it must never be filed under the
  // walk-in name - that debt would be uncollectable.
  const bonNeedsCustomer =
    metode === 'bon' && (namaPelanggan.trim() === '' || namaPelanggan.trim().toUpperCase() === DEFAULT_PELANGGAN)

  // PageUp/PageDown cycle which action Enter will fire, so the whole
  // dialog can be driven without a mouse: type the amount, PgDn/PgUp to
  // the action you want, Enter to run it. Alt+letter shortcuts don't type
  // into focused inputs, so those work regardless of what's focused too.
  const [selectedAction, setSelectedAction] = useState<Action>('cetak')
  const [prevOpen, setPrevOpen] = useState(open)
  const { confirm, ConfirmDialog } = useConfirm()

  if (open !== prevOpen) {
    setPrevOpen(open)

    if (open) {
      setSelectedAction('cetak')
    }
  }

  // Printing is the one action that reaches hardware and wastes paper when
  // fired by accident - and it sits on Enter, the fastest key to hit twice.
  async function submitWithPrint() {
    const confirmed = await confirm({
      title: 'Cetak struk?',
      description: `Transaksi ${formatRupiah(total)} akan disimpan dan struknya langsung dicetak.`,
      confirmLabel: 'Simpan + Cetak',
      cancelLabel: 'Batal',
    })

    if (confirmed) {
      onSubmit(true)
    }
  }

  function runAction(action: Action) {
    if (action !== 'batal' && bonNeedsCustomer) {
      onEditCustomer()

      return
    }

    if (action === 'cetak') {
      submitWithPrint()
    } else if (action === 'simpan') {
      onSubmit(false)
    } else {
      onOpenChange(false)
    }
  }

  function handleShortcut(e: ReactKeyboardEvent) {
    if (processing || printing) {
      return
    }

    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      const index = actions.indexOf(selectedAction)
      const delta = e.key === 'PageDown' ? 1 : -1
      setSelectedAction(actions[(index + delta + actions.length) % actions.length])

      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      runAction(selectedAction)

      return
    }

    if (!e.altKey) {
      return
    }

    switch (e.key.toLowerCase()) {
      case 't':
        e.preventDefault()
        setMetode('tunai')
        break
      case 'b':
        e.preventDefault()
        setMetode('bon')
        break
      case 'q':
        e.preventDefault()
        setMetode('qris')
        break
      case 'r':
        e.preventDefault()
        setMetode('transfer')
        break
      case 's':
        e.preventDefault()
        runAction('simpan')
        break
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>Pembayaran</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            runAction('cetak')
          }}
          onKeyDown={handleShortcut}
          className="space-y-5"
        >
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={metode === 'tunai' ? 'default' : 'outline'}
              disabled={processing || printing}
              onClick={() => setMetode('tunai')}
            >
              <Banknote className="size-4" />
              Tunai
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+T</kbd>
            </Button>
            <Button
              type="button"
              variant={metode === 'bon' ? 'default' : 'outline'}
              disabled={processing || printing}
              onClick={() => setMetode('bon')}
            >
              <HandCoins className="size-4" />
              Bon
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+B</kbd>
            </Button>
            {/* both settle the exact amount, so there is no cash field and no change */}
            <Button
              type="button"
              variant={metode === 'qris' ? 'default' : 'outline'}
              disabled={processing || printing}
              onClick={() => setMetode('qris')}
            >
              <QrCode className="size-4" />
              QRIS
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+Q</kbd>
            </Button>
            <Button
              type="button"
              variant={metode === 'transfer' ? 'default' : 'outline'}
              disabled={processing || printing}
              onClick={() => setMetode('transfer')}
            >
              <ArrowLeftRight className="size-4" />
              Transfer
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+R</kbd>
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-foreground px-5 py-4">
            <span className="text-sm text-background/60">Total Tagihan</span>
            <span className="text-4xl font-bold text-background tabular-nums">{formatRupiah(total)}</span>
          </div>

          {metode === 'tunai' && (
            <div className="grid gap-2">
              <Label htmlFor="dibayar">Uang Tunai</Label>
              <Input
                id="dibayar"
                autoFocus
                inputMode="numeric"
                placeholder="0"
                value={dibayar}
                disabled={processing || printing}
                onChange={(e) => setDibayar(e.target.value)}
                className="h-16 text-right text-2xl font-semibold tabular-nums"
              />
            </div>
          )}

          {/* the name is picked on the kasir page - shown here only so the
              cashier can see (and fix) who the sale is filed under */}
          <button
            type="button"
            disabled={processing || printing}
            onClick={onEditCustomer}
            className="flex w-full items-center justify-between rounded-xl border px-5 py-3.5 text-left hover:bg-muted/50 disabled:opacity-50"
          >
            <span className="text-sm text-muted-foreground">Pelanggan</span>
            <span className="flex items-center gap-2 text-lg font-semibold">
              {namaPelanggan.trim() || <span className="text-destructive">Belum dipilih</span>}
              <Pencil className="size-3.5 text-muted-foreground" />
            </span>
          </button>

          {/* backdating a sale is normal here: the cashier often enters yesterday's
              sale the next morning. The main process rejects future dates. */}
          <div className="grid gap-2">
            <Label htmlFor="tanggal-transaksi">Tanggal &amp; Jam Transaksi</Label>
            <Input
              id="tanggal-transaksi"
              type="datetime-local"
              value={tanggal}
              disabled={processing || printing}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </div>

          {bonNeedsCustomer && (
            <p role="alert" className="text-sm text-destructive">
              Transaksi bon harus atas nama pelanggan, bukan {DEFAULT_PELANGGAN}. Pilih pelanggan dulu.
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-green-500/15 px-5 py-3.5 dark:bg-green-500/20">
              <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                {metode === 'bon' ? 'Bon' : metode === 'qris' ? 'QRIS' : metode === 'transfer' ? 'Transfer' : 'Dibayar'}
              </span>
              <span className="text-2xl font-bold text-green-700 tabular-nums dark:text-green-400">
                {formatRupiah(totalBayar)}
              </span>
            </div>

            <div
              className={cn(
                'flex items-center justify-between rounded-xl px-5 py-3.5',
                isLunas ? 'bg-green-500/15 dark:bg-green-500/20' : 'bg-orange-500/15 dark:bg-orange-500/20',
              )}
            >
              <span
                className={cn(
                  'text-sm font-semibold',
                  isLunas ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400',
                )}
              >
                {isLunas ? 'Kembalian' : 'Kekurangan'}
              </span>
              <span
                className={cn(
                  'text-2xl font-bold tabular-nums',
                  isLunas ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400',
                )}
              >
                {formatRupiah(Math.abs(selisih))}
              </span>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {printing ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Spinner />
              Mencetak struk...
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                type="submit"
                disabled={processing || bonNeedsCustomer}
                className={cn(
                  'w-full',
                  selectedAction === 'cetak' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                )}
              >
                {selectedAction === 'cetak' && <CornerDownLeft className="size-4" />}
                <Printer className="size-4" />
                Simpan + Cetak
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={processing || bonNeedsCustomer}
                  className={cn(
                    selectedAction === 'simpan' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                  )}
                  onClick={() => onSubmit(false)}
                >
                  {selectedAction === 'simpan' && <CornerDownLeft className="size-3.5" />}
                  Simpan
                  <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+S</kbd>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={processing}
                  className={cn(
                    selectedAction === 'batal' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                  )}
                  onClick={() => onOpenChange(false)}
                >
                  {selectedAction === 'batal' && <CornerDownLeft className="size-3.5" />}
                  Batal
                  <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Esc</kbd>
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                <kbd className="rounded border bg-muted px-1.5 py-0.5">PgUp/PgDn</kbd> pilih aksi &middot;{' '}
                <kbd className="rounded border bg-muted px-1.5 py-0.5">Enter</kbd> jalankan
              </p>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
    {ConfirmDialog}
    </>
  )
}
