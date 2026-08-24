import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeftRight, Banknote, CornerDownLeft, HandCoins, Pencil, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, formatRupiah } from '@/lib/utils'
import { DEFAULT_PELANGGAN } from './CustomerPicker'

// One list for both modes now. Printing is no longer decided here - it is asked after the
// sale is saved, where the cashier can see the change first.
const actions = ['simpan', 'batal'] as const
type Action = (typeof actions)[number]

export interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  /** what the goods came to before any discount */
  subtotal: number
  /** the sum of the per-line discounts, in whole rupiah */
  diskonItem: number
  /** the bill-wide discount, already resolved from any percentage the cashier typed */
  diskonNota: number
  metode: 'tunai' | 'bon' | 'qris' | 'transfer'
  setMetode: (metode: 'tunai' | 'bon' | 'qris' | 'transfer') => void
  namaPelanggan: string
  /** hands the cashier back to the customer picker on the kasir page */
  onEditCustomer: () => void
  dibayar: string
  setDibayar: (value: string) => void
  /** local `YYYY-MM-DDTHH:mm` the sale will be filed under */
  tanggal: string
  processing: boolean
  error: string | null
  onSubmit: () => void
  /** editing a saved sale: there is nothing to print, only changes to save */
  editMode: boolean
  /**
   * Only meaningful in edit mode: false while the sale is still loading, or when
   * it cannot be safely rewritten from what is displayed (a dropped line, or a
   * non-selesai status). Ignored outside edit mode - a new sale is always ready.
   */
  editReady: boolean
  /** only used in edit mode: why this sale is being changed */
  keterangan: string
  setKeterangan: (value: string) => void
}

export function PaymentDialog({
  open,
  onOpenChange,
  total,
  subtotal,
  diskonItem,
  diskonNota,
  metode,
  setMetode,
  namaPelanggan,
  onEditCustomer,
  dibayar,
  setDibayar,
  tanggal,
  processing,
  error,
  onSubmit,
  editMode,
  editReady,
  keterangan,
  setKeterangan,
}: PaymentDialogProps) {
  // qris/transfer land on the exact total; only cash can overpay and only bon can
  // underpay. A bon's dibayar is only ever hand-set in edit mode (see the amount
  // field below) - a new bon is always forced to 0 by the main process.
  const totalBayar =
    metode === 'tunai' || (editMode && metode === 'bon') ? Number(dibayar || 0) : metode === 'bon' ? 0 : total
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
  const availableActions: readonly Action[] = actions
  const [selectedAction, setSelectedAction] = useState<Action>('simpan')
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)

    if (open) {
      setSelectedAction('simpan')
    }
  }

  function runAction(action: Action) {
    if (action === 'simpan' && editMode && !editReady) {
      return
    }

    if (action === 'simpan' && editMode && !keterangan.trim()) {
      return
    }

    if (action !== 'batal' && bonNeedsCustomer) {
      onEditCustomer()

      return
    }

    if (action === 'simpan') {
      onSubmit()
    } else {
      onOpenChange(false)
    }
  }

  function handleShortcut(e: ReactKeyboardEvent) {
    if (processing) {
      return
    }

    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      const index = availableActions.indexOf(selectedAction)
      const delta = e.key === 'PageDown' ? 1 : -1
      setSelectedAction(availableActions[(index + delta + availableActions.length) % availableActions.length])

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>Pembayaran</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            runAction('simpan')
          }}
          onKeyDown={handleShortcut}
          className="space-y-5"
        >
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={metode === 'tunai' ? 'default' : 'outline'}
              disabled={processing}
              onClick={() => setMetode('tunai')}
            >
              <Banknote className="size-4" />
              Tunai
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+T</kbd>
            </Button>
            <Button
              type="button"
              variant={metode === 'bon' ? 'default' : 'outline'}
              disabled={processing}
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
              disabled={processing}
              onClick={() => setMetode('qris')}
            >
              <QrCode className="size-4" />
              QRIS
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+Q</kbd>
            </Button>
            <Button
              type="button"
              variant={metode === 'transfer' ? 'default' : 'outline'}
              disabled={processing}
              onClick={() => setMetode('transfer')}
            >
              <ArrowLeftRight className="size-4" />
              Transfer
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">Alt+R</kbd>
            </Button>
          </div>

          {/* Read-only: the discount is set on the Penjualan page, where the cart it
              applies to is visible. Shown here so a mistyped discount cannot slip past
              at the one point where the money is actually committed. */}
          {(diskonItem > 0 || diskonNota > 0) && (
            <div className="space-y-1 rounded-xl border px-5 py-3 text-sm tabular-nums">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatRupiah(subtotal)}</span>
              </div>
              {diskonItem > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Diskon item</span>
                  <span className="font-semibold text-destructive">-{formatRupiah(diskonItem)}</span>
                </div>
              )}
              {diskonNota > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Diskon nota</span>
                  <span className="font-semibold text-destructive">-{formatRupiah(diskonNota)}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl bg-foreground px-5 py-4">
            <span className="text-sm text-background/60">Total Tagihan</span>
            <span className="text-4xl font-bold text-background tabular-nums">{formatRupiah(total)}</span>
          </div>

          {(metode === 'tunai' || (editMode && metode === 'bon')) && (
            <div className="grid gap-2">
              <Label htmlFor="dibayar">{metode === 'tunai' ? 'Uang Tunai' : 'Sudah Dibayar'}</Label>
              <Input
                id="dibayar"
                autoFocus
                inputMode="numeric"
                placeholder="0"
                value={dibayar}
                disabled={processing}
                onChange={(e) => setDibayar(e.target.value)}
                className="h-16 text-right text-2xl font-semibold tabular-nums"
              />
            </div>
          )}

          {/* the name is picked on the kasir page - shown here only so the
              cashier can see (and fix) who the sale is filed under */}
          <button
            type="button"
            disabled={processing}
            onClick={onEditCustomer}
            className="flex w-full items-center justify-between rounded-xl border px-5 py-3.5 text-left hover:bg-muted/50 disabled:opacity-50"
          >
            <span className="text-sm text-muted-foreground">Pelanggan</span>
            <span className="flex items-center gap-2 text-lg font-semibold">
              {namaPelanggan.trim() || <span className="text-destructive">Belum dipilih</span>}
              <Pencil className="size-3.5 text-muted-foreground" />
            </span>
          </button>

          {/* The time is set on the Penjualan page, not here - one field, one
              place. It is still shown at the commit point so a mistyped date
              cannot slip past unnoticed. */}
          <div className="flex items-center justify-between rounded-xl border px-5 py-3.5">
            <span className="text-sm text-muted-foreground">Tanggal &amp; Jam</span>
            <span className="font-medium tabular-nums">{new Date(tanggal).toLocaleString('id-ID')}</span>
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

          {editMode && (
            <div className="grid gap-2">
              <Label htmlFor="keterangan-edit">Keterangan perubahan</Label>
              <textarea
                id="keterangan-edit"
                value={keterangan}
                disabled={processing}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Contoh: salah input qty, pelanggan tukar barang"
                rows={2}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <p className="text-xs text-muted-foreground">
                Wajib diisi. Tersimpan permanen di riwayat transaksi.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="submit"
                disabled={processing || bonNeedsCustomer || (editMode && (!editReady || !keterangan.trim()))}
                className={cn(
                  selectedAction === 'simpan' && 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                )}
              >
                {selectedAction === 'simpan' && <CornerDownLeft className="size-3.5" />}
                {editMode ? 'Simpan Perubahan' : 'Simpan'}
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
        </form>
      </DialogContent>
    </Dialog>
  )
}
