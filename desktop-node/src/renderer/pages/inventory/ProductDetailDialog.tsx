import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { History, Layers, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InputError } from '@/components/input-error'
import { useConfirm } from '@/hooks/use-confirm'
import { formatRupiah } from '@/lib/utils'

interface UnitRow {
  id: number
  level: number
  satuan: string
  jumlahKemasan: number
  konversi: number
  hargaJual: number
}

interface PriceTierRow {
  id: number
  minQty: number
  hargaJual: number
}

interface PriceHistoryRow {
  id: number
  hargaPokokLama: number
  hargaPokokBaru: number
  hargaJualLama: number
  hargaJualBaru: number
  createdAt: string
  userName: string | null
}

interface ProductDetail {
  units: { level2: UnitRow | null; level3: UnitRow | null }
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}

interface ProductDetailDialogProps {
  productId: number | null
  productNama: string | null
  baseSatuan: string
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

export function ProductDetailDialog({ productId, productNama, baseSatuan, onOpenChange, onChanged }: ProductDetailDialogProps) {
  const [detail, setDetail] = useState<ProductDetail | null>(null)

  function reload(id: number) {
    window.api.inventory.getProductDetail(id).then(setDetail)
  }

  useEffect(() => {
    if (productId === null) {
      setDetail(null)
      return
    }
    reload(productId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  function refresh() {
    if (productId !== null) {
      reload(productId)
    }
    onChanged()
  }

  return (
    <Dialog open={productId !== null} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{productNama} &mdash; Satuan, Harga Bertingkat & Riwayat Harga</DialogTitle>
        </DialogHeader>
        {productId !== null && detail && (
          <>
            <UnitLevelsManager productId={productId} baseSatuan={baseSatuan} units={detail.units} onChanged={refresh} />
            <PriceTiersManager productId={productId} baseSatuan={baseSatuan} tiers={detail.priceTiers} onChanged={refresh} />
            <PriceHistoryList history={detail.priceHistory} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function UnitLevelsManager({
  productId,
  baseSatuan,
  units,
  onChanged,
}: {
  productId: number
  baseSatuan: string
  units: { level2: UnitRow | null; level3: UnitRow | null }
  onChanged: () => void
}) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Satuan Turunan</Label>
        <span className="text-xs text-muted-foreground">mis. 1 Renteng = 12 {baseSatuan}, 1 Dus = 10 Renteng</span>
      </div>
      <UnitLevelSlot
        productId={productId}
        level={2}
        relativeToLabel={baseSatuan}
        unit={units.level2}
        siblingLevel3={units.level3}
        disabled={false}
        onChanged={onChanged}
      />
      <UnitLevelSlot
        productId={productId}
        level={3}
        relativeToLabel={units.level2?.satuan ?? baseSatuan}
        unit={units.level3}
        siblingLevel3={null}
        disabled={units.level2 === null}
        onChanged={onChanged}
      />
    </div>
  )
}

function UnitLevelSlot({
  productId,
  level,
  relativeToLabel,
  unit,
  siblingLevel3,
  disabled,
  onChanged,
}: {
  productId: number
  level: 2 | 3
  relativeToLabel: string
  unit: UnitRow | null
  siblingLevel3: UnitRow | null
  disabled: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [satuan, setSatuan] = useState('')
  const [jumlahKemasan, setJumlahKemasan] = useState('')
  const [hargaJual, setHargaJual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  function startEdit() {
    setSatuan(unit?.satuan ?? '')
    setJumlahKemasan(unit ? String(unit.jumlahKemasan) : '')
    setHargaJual(unit ? String(unit.hargaJual) : '')
    setError(null)
    setEditing(true)
  }

  function submit(e: FormEvent) {
    e.preventDefault()

    if (!satuan.trim()) {
      setError('Satuan wajib diisi.')
      return
    }

    const jumlahNum = Number(jumlahKemasan)
    if (jumlahKemasan.trim() === '' || !Number.isFinite(jumlahNum)) {
      setError('Jumlah kemasan wajib diisi.')
      return
    }

    const hargaNum = Number(hargaJual)
    if (hargaJual.trim() === '' || !Number.isFinite(hargaNum)) {
      setError('Harga jual wajib diisi.')
      return
    }

    setProcessing(true)
    setError(null)

    window.api.inventory
      .setProductUnit(productId, level, { satuan, jumlahKemasan: jumlahNum, hargaJual: hargaNum })
      .then(() => {
        setEditing(false)
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  async function remove() {
    const ok = await confirm({
      title: `Hapus Level ${level}`,
      description:
        level === 2 && siblingLevel3
          ? `Hapus satuan "${unit?.satuan}"? Ini juga akan menghapus satuan Level 3 ("${siblingLevel3.satuan}").`
          : `Hapus satuan "${unit?.satuan}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    window.api.inventory.deleteProductUnit(productId, level).then(onChanged)
  }

  if (disabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Level {level}: isi Level {level - 1} dulu.
      </p>
    )
  }

  if (unit && !editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50">
        <span className="text-sm font-medium">
          1 {unit.satuan} = {unit.jumlahKemasan} {relativeToLabel}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{formatRupiah(unit.hargaJual)}</Badge>
          <Button type="button" variant="ghost" size="sm" onClick={startEdit}>
            Edit
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
            Hapus
          </Button>
        </div>
        {ConfirmDialog}
      </div>
    )
  }

  if (!unit && !editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2">
        <span className="text-sm text-muted-foreground">Level {level} belum diisi.</span>
        <Button type="button" size="sm" onClick={startEdit}>
          Tambah
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1">
          <Label className="text-xs">Satuan</Label>
          <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} placeholder={level === 2 ? 'Renteng' : 'Dus'} />
        </div>
        <div className="grid w-32 gap-1">
          <Label className="text-xs">= jumlah {relativeToLabel}</Label>
          <Input type="number" value={jumlahKemasan} onChange={(e) => setJumlahKemasan(e.target.value)} />
        </div>
        <div className="grid w-32 gap-1">
          <Label className="text-xs">Harga Jual</Label>
          <Input type="number" value={hargaJual} onChange={(e) => setHargaJual(e.target.value)} />
        </div>
        <Button type="submit" size="sm" disabled={processing}>
          Simpan
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
          Batal
        </Button>
      </div>
      <InputError message={error ?? undefined} />
    </form>
  )
}

function PriceTiersManager({
  productId,
  baseSatuan,
  tiers,
  onChanged,
}: {
  productId: number
  baseSatuan: string
  tiers: PriceTierRow[]
  onChanged: () => void
}) {
  const [minQty, setMinQty] = useState('')
  const [hargaJual, setHargaJual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  function addTier(e: FormEvent) {
    e.preventDefault()

    const minQtyNum = Number(minQty)
    if (minQty.trim() === '' || !Number.isFinite(minQtyNum)) {
      setError('Qty minimal wajib diisi.')
      return
    }

    const hargaNum = Number(hargaJual)
    if (hargaJual.trim() === '' || !Number.isFinite(hargaNum)) {
      setError('Harga jual wajib diisi.')
      return
    }

    setProcessing(true)
    setError(null)

    window.api.inventory
      .addPriceTier(productId, { minQty: minQtyNum, hargaJual: hargaNum })
      .then(() => {
        setMinQty('')
        setHargaJual('')
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  async function removeTier(tier: PriceTierRow) {
    const ok = await confirm({
      title: 'Hapus Harga Bertingkat',
      description: `Hapus harga bertingkat untuk pembelian ${tier.minQty}+ ${baseSatuan}?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    window.api.inventory.deletePriceTier(productId, tier.id).then(onChanged)
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Harga Bertingkat</Label>
        <span className="text-xs text-muted-foreground">berdasarkan jumlah beli, satuan {baseSatuan}</span>
      </div>
      {tiers.length > 0 ? (
        <div className="space-y-1.5">
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50"
            >
              <span className="text-sm font-medium">
                Beli {tier.minQty}+ {baseSatuan}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {formatRupiah(tier.hargaJual)} / {baseSatuan}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeTier(tier)}
                >
                  Hapus
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada harga bertingkat.</p>
      )}
      <form onSubmit={addTier} className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-end gap-2">
          <div className="grid w-32 gap-1">
            <Label className="text-xs">Min. Qty</Label>
            <Input type="number" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="6" />
          </div>
          <div className="grid w-40 gap-1">
            <Label className="text-xs">Harga Jual per {baseSatuan}</Label>
            <Input type="number" value={hargaJual} onChange={(e) => setHargaJual(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={processing}>
            Tambah
          </Button>
        </div>
        <InputError message={error ?? undefined} />
      </form>
      {ConfirmDialog}
    </div>
  )
}

function PriceHistoryList({ history }: { history: PriceHistoryRow[] }) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Riwayat Perubahan Harga</Label>
      </div>
      {history.length > 0 ? (
        <div className="space-y-1.5">
          {history.map((entry) => (
            <div key={entry.id} className="rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{new Date(entry.createdAt).toLocaleString('id-ID')}</span>
                <span>{entry.userName ?? 'Sistem'}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4">
                <span>
                  Harga Pokok: {formatRupiah(entry.hargaPokokLama)} &rarr;{' '}
                  <span className="font-medium">{formatRupiah(entry.hargaPokokBaru)}</span>
                </span>
                <span>
                  Harga Jual: {formatRupiah(entry.hargaJualLama)} &rarr;{' '}
                  <span className="font-medium">{formatRupiah(entry.hargaJualBaru)}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada perubahan harga.</p>
      )}
    </div>
  )
}
