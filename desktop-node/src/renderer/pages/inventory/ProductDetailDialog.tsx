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
  units: UnitRow[]
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
  const [error, setError] = useState<string | null>(null)

  function reload(id: number) {
    window.api.inventory
      .getProductDetail(id)
      .then((result) => {
        setDetail(result)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat data produk'))
  }

  useEffect(() => {
    setError(null)
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        {productId !== null && detail && (
          <>
            <UnitChainManager productId={productId} baseSatuan={baseSatuan} units={detail.units} onChanged={refresh} />
            <PriceTiersManager productId={productId} baseSatuan={baseSatuan} tiers={detail.priceTiers} onChanged={refresh} />
            <PriceHistoryList history={detail.priceHistory} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function UnitChainManager({
  productId,
  baseSatuan,
  units,
  onChanged,
}: {
  productId: number
  baseSatuan: string
  units: UnitRow[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)

  const largest = units.length > 0 ? units[units.length - 1] : null

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Satuan Turunan</Label>
        <span className="text-xs text-muted-foreground">mis. 1 Renteng = 12 {baseSatuan}, 1 Dus = 10 Renteng</span>
      </div>

      {units.length > 0 ? (
        <div className="space-y-1.5">
          {units.map((unit, idx) => (
            <UnitChainRow
              key={unit.id}
              productId={productId}
              unit={unit}
              relativeToLabel={idx === 0 ? baseSatuan : units[idx - 1].satuan}
              baseSatuan={baseSatuan}
              unitsAbove={units.slice(idx + 1)}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada satuan turunan.</p>
      )}

      {adding ? (
        <UnitChainAddForm
          productId={productId}
          relativeToLabel={largest?.satuan ?? baseSatuan}
          onDone={() => setAdding(false)}
          onChanged={onChanged}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          + Tambah Satuan
        </Button>
      )}
    </div>
  )
}

function UnitChainRow({
  productId,
  unit,
  relativeToLabel,
  baseSatuan,
  unitsAbove,
  onChanged,
}: {
  productId: number
  unit: UnitRow
  relativeToLabel: string
  baseSatuan: string
  unitsAbove: UnitRow[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [satuan, setSatuan] = useState(unit.satuan)
  const [jumlahKemasan, setJumlahKemasan] = useState(String(unit.jumlahKemasan))
  const [hargaJual, setHargaJual] = useState(String(unit.hargaJual))
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  function startEdit() {
    setSatuan(unit.satuan)
    setJumlahKemasan(String(unit.jumlahKemasan))
    setHargaJual(String(unit.hargaJual))
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
      .updateProductUnit(productId, unit.id, { satuan, jumlahKemasan: jumlahNum, hargaJual: hargaNum })
      .then(() => {
        setEditing(false)
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  async function remove() {
    const ok = await confirm({
      title: 'Hapus Satuan',
      description:
        unitsAbove.length > 0
          ? `Hapus satuan "${unit.satuan}"? Ini juga akan menghapus ${unitsAbove.map((u) => `"${u.satuan}"`).join(', ')}.`
          : `Hapus satuan "${unit.satuan}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    window.api.inventory
      .deleteProductUnit(productId, unit.id)
      .then(onChanged)
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menghapus'))
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1">
            <Label className="text-xs">Satuan</Label>
            <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} />
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

  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50">
      <span className="text-sm font-medium">
        1 {unit.satuan} = {unit.jumlahKemasan} {relativeToLabel}{' '}
        <span className="font-normal text-muted-foreground">
          (= {unit.konversi} {baseSatuan})
        </span>
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      {ConfirmDialog}
    </div>
  )
}

function UnitChainAddForm({
  productId,
  relativeToLabel,
  onDone,
  onChanged,
}: {
  productId: number
  relativeToLabel: string
  onDone: () => void
  onChanged: () => void
}) {
  const [satuan, setSatuan] = useState('')
  const [jumlahKemasan, setJumlahKemasan] = useState('')
  const [hargaJual, setHargaJual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

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
      .addProductUnit(productId, { satuan, jumlahKemasan: jumlahNum, hargaJual: hargaNum })
      .then(() => {
        onDone()
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1">
          <Label className="text-xs">Satuan</Label>
          <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} placeholder="Dus" autoFocus />
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
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
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

    window.api.inventory
      .deletePriceTier(productId, tier.id)
      .then(() => {
        setError(null)
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menghapus'))
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
