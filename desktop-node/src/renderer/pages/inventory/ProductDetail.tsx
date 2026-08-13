import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, History, Layers, TrendingUp } from 'lucide-react'
import { Page, PageHeader } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InputError } from '@/components/input-error'
import { useConfirm } from '@/hooks/use-confirm'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../../layouts/AppShell'
import type { BreadcrumbItem } from '../../types'

interface UnitRow {
  id: number
  unitId: number
  satuan: string
  /** the smaller unit this one is measured in; null means the base unit */
  parentUnitId: number | null
  jumlahKemasan: number
  konversi: number
  hargaJual: number
  hargaPokok: number
  isBaseUnit: boolean
}

/** margin as a percentage of cost, or null when there is no cost to compare against */
function marginPersen(hargaJual: number, hargaPokok: number): number | null {
  return hargaPokok > 0 ? ((hargaJual - hargaPokok) / hargaPokok) * 100 : null
}

/** the selling price badge plus the modal it has to beat, flagged red when it does not */
function PriceWithMargin({ hargaJual, hargaPokok }: { hargaJual: number; hargaPokok: number }) {
  const margin = marginPersen(hargaJual, hargaPokok)
  const rugi = hargaPokok > 0 && hargaJual < hargaPokok

  return (
    <div className="flex flex-col items-end">
      <Badge variant={rugi ? 'destructive' : 'secondary'}>{formatRupiah(hargaJual)}</Badge>
      <span className={`text-[10px] ${rugi ? 'text-destructive' : 'text-muted-foreground'}`}>
        modal {formatRupiah(hargaPokok)}
        {margin !== null && ` · ${margin.toFixed(1)}%`}
        {rugi && ' · di bawah modal'}
      </span>
    </div>
  )
}

interface MasterUnit {
  id: number
  code: string
  name: string
  symbol: string
  isActive: boolean
}

interface PriceTierRow {
  id: number
  productUnitId: number
  minQty: number
  maxQty: number | null
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
  namaItem: string
  kodeItem: string
  units: UnitRow[]
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}

export function ProductDetail() {
  const navigate = useNavigate()
  const params = useParams()
  const productId = Number(params.productId)
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [masterUnits, setMasterUnits] = useState<MasterUnit[]>([])
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
    // a hand-typed or stale URL must not fire an IPC call with NaN
    if (!Number.isInteger(productId) || productId < 1) {
      setDetail(null)
      setError('Produk tidak ditemukan.')
      return
    }
    reload(productId)
    window.api.masterSatuan
      .list()
      .then((rows) => setMasterUnits(rows.filter((row) => row.isActive)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat master satuan'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  function refresh() {
    reload(productId)
  }

  const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Katalog Produk', href: '/inventory' },
    { title: detail?.namaItem ?? 'Produk', href: `/inventory/${productId}` },
  ]

  return (
    <AppShell breadcrumbs={breadcrumbs}>
      <Page>
        <PageHeader
          title={detail?.namaItem ?? 'Memuat...'}
          description={detail ? `${detail.kodeItem} — satuan, harga bertingkat & riwayat harga` : undefined}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => navigate('/inventory')}>
              <ArrowLeft className="size-4" />
              Kembali
            </Button>
          }
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        {detail && (
          <div className="max-w-3xl space-y-2">
            <UnitChainManager
              productId={productId}
              baseSatuan={detail.units.find((unit) => unit.isBaseUnit)?.satuan ?? ''}
              units={detail.units}
              masterUnits={masterUnits}
              onChanged={refresh}
            />
            <PriceTiersManager productId={productId} units={detail.units} tiers={detail.priceTiers} onChanged={refresh} />
            <PriceHistoryList history={detail.priceHistory} />
          </div>
        )}
      </Page>
    </AppShell>
  )
}

function UnitChainManager({
  productId,
  baseSatuan,
  units,
  masterUnits,
  onChanged,
}: {
  productId: number
  baseSatuan: string
  units: UnitRow[]
  masterUnits: MasterUnit[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)

  // the base row lives in the same table now, but it is not part of the derived tree -
  // its unit and conversion are fixed, and its price is edited on the product form
  const derived = units.filter((unit) => !unit.isBaseUnit)
  const largest = derived.length > 0 ? derived[derived.length - 1] : null
  const usedUnitIds = units.map((unit) => unit.unitId)
  const flattened = flattenUnitTree(derived)

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Satuan Turunan</Label>
      </div>

      {flattened.length > 0 ? (
        <div className="space-y-1.5">
          {flattened.map(({ unit, depth }) => (
            <UnitChainRow
              key={unit.id}
              productId={productId}
              unit={unit}
              depth={depth}
              relativeToLabel={derived.find((row) => row.id === unit.parentUnitId)?.satuan ?? baseSatuan}
              baseSatuan={baseSatuan}
              containers={unitsContaining(derived, unit.id)}
              parentOptions={parentOptionsFor(derived, baseSatuan, unit.id)}
              unitOptions={masterUnits.filter((option) => option.id === unit.unitId || !usedUnitIds.includes(option.id))}
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
          defaultParentId={largest?.id ?? null}
          parentOptions={parentOptionsFor(derived, baseSatuan)}
          unitOptions={masterUnits.filter((option) => !usedUnitIds.includes(option.id))}
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

/** every unit measured in `unitRowId`, directly or through another one */
function unitsContaining(derived: UnitRow[], unitRowId: number): UnitRow[] {
  const found: UnitRow[] = []
  let frontier = [unitRowId]

  while (frontier.length > 0) {
    const children = derived.filter(
      (row) => row.parentUnitId !== null && frontier.includes(row.parentUnitId) && !found.some((seen) => seen.id === row.id),
    )
    if (children.length === 0) {
      break
    }
    found.push(...children)
    frontier = children.map((row) => row.id)
  }

  return found
}

/**
 * Depth-first order with an indent level, so siblings sit side by side under the unit
 * they are measured in instead of pretending to be one straight ladder.
 */
function flattenUnitTree(derived: UnitRow[]): { unit: UnitRow; depth: number }[] {
  const out: { unit: UnitRow; depth: number }[] = []

  function walk(parentId: number | null, depth: number) {
    for (const unit of derived.filter((row) => row.parentUnitId === parentId)) {
      out.push({ unit, depth })
      walk(unit.id, depth + 1)
    }
  }

  walk(null, 0)

  // a row whose parent went missing would vanish otherwise; show it flat rather than lose it
  for (const unit of derived) {
    if (!out.some((entry) => entry.unit.id === unit.id)) {
      out.push({ unit, depth: 0 })
    }
  }

  return out
}

/** what a unit may be measured in: the base unit, or anything that does not contain it */
function parentOptionsFor(derived: UnitRow[], baseSatuan: string, selfId?: number): { id: number | null; label: string }[] {
  const blocked = selfId === undefined ? [] : [selfId, ...unitsContaining(derived, selfId).map((row) => row.id)]

  return [
    { id: null, label: baseSatuan },
    ...derived.filter((row) => !blocked.includes(row.id)).map((row) => ({ id: row.id, label: row.satuan })),
  ]
}

function UnitChainRow({
  productId,
  unit,
  depth,
  relativeToLabel,
  baseSatuan,
  containers,
  parentOptions,
  unitOptions,
  onChanged,
}: {
  productId: number
  unit: UnitRow
  depth: number
  relativeToLabel: string
  baseSatuan: string
  containers: UnitRow[]
  parentOptions: { id: number | null; label: string }[]
  unitOptions: MasterUnit[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [unitId, setUnitId] = useState(String(unit.unitId))
  const [parentUnitId, setParentUnitId] = useState(unit.parentUnitId === null ? 'base' : String(unit.parentUnitId))
  const [jumlahKemasan, setJumlahKemasan] = useState(String(unit.jumlahKemasan))
  const [hargaJual, setHargaJual] = useState(String(unit.hargaJual))
  const [hargaPokok, setHargaPokok] = useState(String(unit.hargaPokok))
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  function startEdit() {
    setUnitId(String(unit.unitId))
    setParentUnitId(unit.parentUnitId === null ? 'base' : String(unit.parentUnitId))
    setJumlahKemasan(String(unit.jumlahKemasan))
    setHargaJual(String(unit.hargaJual))
    setHargaPokok(String(unit.hargaPokok))
    setError(null)
    setEditing(true)
  }

  function submit(e: FormEvent) {
    e.preventDefault()

    const unitIdNum = Number(unitId)
    if (!Number.isInteger(unitIdNum) || unitIdNum < 1) {
      setError('Satuan wajib dipilih.')
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

    const modalNum = Number(hargaPokok)
    if (hargaPokok.trim() === '' || !Number.isFinite(modalNum) || modalNum < 0) {
      setError('Harga beli wajib diisi dan tidak boleh negatif.')
      return
    }

    setProcessing(true)
    setError(null)

    window.api.inventory
      .updateProductUnit(productId, unit.id, {
        unitId: unitIdNum,
        jumlahKemasan: jumlahNum,
        hargaJual: hargaNum,
        hargaPokok: modalNum,
        parentUnitId: parentUnitId === 'base' ? null : Number(parentUnitId),
      })
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
        containers.length > 0
          ? `Hapus satuan "${unit.satuan}"? Ini juga akan menghapus ${containers.map((u) => `"${u.satuan}"`).join(', ')}.`
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
            <UnitSelect value={unitId} options={unitOptions} onChange={setUnitId} />
          </div>
          <div className="grid w-32 gap-1">
            <Label className="text-xs">Relatif ke</Label>
            <ParentSelect value={parentUnitId} options={parentOptions} onChange={setParentUnitId} />
          </div>
          <div className="grid w-24 gap-1">
            <Label className="text-xs">Jumlah</Label>
            <Input type="number" value={jumlahKemasan} onChange={(e) => setJumlahKemasan(e.target.value)} />
          </div>
          <div className="grid w-32 gap-1">
            <Label className="text-xs">Harga Beli</Label>
            <Input type="number" value={hargaPokok} onChange={(e) => setHargaPokok(e.target.value)} />
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
    <div
      // indent shows what is measured in what; siblings line up at the same depth
      style={{ marginInlineStart: depth * 20 }}
      className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50"
    >
      <span className="text-sm font-medium">
        1 {unit.satuan} = {unit.jumlahKemasan} {relativeToLabel}{' '}
        <span className="font-normal text-muted-foreground">
          (= {unit.konversi} {baseSatuan})
        </span>
      </span>
      <div className="flex items-center gap-2">
        <PriceWithMargin hargaJual={unit.hargaJual} hargaPokok={unit.hargaPokok} />
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

function UnitSelect({ value, options, onChange }: { value: string; options: MasterUnit[]; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Pilih satuan" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={String(option.id)}>
            {option.code} &mdash; {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** picks the smaller unit a packaging is counted in; "base" is the product's base unit */
function ParentSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: { id: number | null; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Pilih acuan" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id ?? 'base'} value={option.id === null ? 'base' : String(option.id)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function UnitChainAddForm({
  productId,
  defaultParentId,
  parentOptions,
  unitOptions,
  onDone,
  onChanged,
}: {
  productId: number
  defaultParentId: number | null
  parentOptions: { id: number | null; label: string }[]
  unitOptions: MasterUnit[]
  onDone: () => void
  onChanged: () => void
}) {
  const [unitId, setUnitId] = useState('')
  // defaults to the largest existing unit, which is what "add another packaging" usually means
  const [parentUnitId, setParentUnitId] = useState(defaultParentId === null ? 'base' : String(defaultParentId))
  const [jumlahKemasan, setJumlahKemasan] = useState('')
  const [hargaJual, setHargaJual] = useState('')
  const [hargaPokok, setHargaPokok] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()

    const unitIdNum = Number(unitId)
    if (!Number.isInteger(unitIdNum) || unitIdNum < 1) {
      setError('Satuan wajib dipilih.')
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

    // blank is meaningful here: it means "derive it from the product's harga pokok"
    const modalNum = hargaPokok.trim() === '' ? undefined : Number(hargaPokok)
    if (modalNum !== undefined && (!Number.isFinite(modalNum) || modalNum < 0)) {
      setError('Harga beli tidak boleh negatif.')
      return
    }

    setProcessing(true)
    setError(null)

    window.api.inventory
      .addProductUnit(productId, {
        unitId: unitIdNum,
        jumlahKemasan: jumlahNum,
        hargaJual: hargaNum,
        hargaPokok: modalNum,
        parentUnitId: parentUnitId === 'base' ? null : Number(parentUnitId),
      })
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
          <UnitSelect value={unitId} options={unitOptions} onChange={setUnitId} />
        </div>
        <div className="grid w-32 gap-1">
          <Label className="text-xs">Relatif ke</Label>
          <ParentSelect value={parentUnitId} options={parentOptions} onChange={setParentUnitId} />
        </div>
        <div className="grid w-24 gap-1">
          <Label className="text-xs">Jumlah</Label>
          <Input type="number" value={jumlahKemasan} onChange={(e) => setJumlahKemasan(e.target.value)} />
        </div>
        <div className="grid w-32 gap-1">
          <Label className="text-xs">Harga Beli</Label>
          <Input
            type="number"
            placeholder="otomatis"
            value={hargaPokok}
            onChange={(e) => setHargaPokok(e.target.value)}
          />
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
      <p className="text-xs text-muted-foreground">
        Harga beli boleh dikosongkan &mdash; nanti dihitung dari harga pokok produk, dan tiap pembelian akan
        memperbaruinya.
      </p>
      <InputError message={error ?? undefined} />
    </form>
  )
}

function PriceTiersManager({
  productId,
  units,
  tiers,
  onChanged,
}: {
  productId: number
  units: UnitRow[]
  tiers: PriceTierRow[]
  onChanged: () => void
}) {
  const baseUnit = units.find((unit) => unit.isBaseUnit) ?? units[0]
  const [selectedUnitId, setSelectedUnitId] = useState(String(baseUnit?.id ?? ''))
  const [minQty, setMinQty] = useState('')
  const [maxQty, setMaxQty] = useState('')
  const [hargaJual, setHargaJual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  const selectedUnit = units.find((unit) => String(unit.id) === selectedUnitId) ?? baseUnit
  const unitLabel = selectedUnit?.satuan ?? ''
  const visibleTiers = tiers.filter((tier) => tier.productUnitId === selectedUnit?.id)

  function tierRange(tier: PriceTierRow, satuan: string) {
    return tier.maxQty === null ? `${tier.minQty}+ ${satuan}` : `${tier.minQty} - ${tier.maxQty} ${satuan}`
  }

  function addTier(e: FormEvent) {
    e.preventDefault()

    if (!selectedUnit) {
      setError('Satuan belum tersedia.')
      return
    }

    const minQtyNum = Number(minQty)
    if (minQty.trim() === '' || !Number.isFinite(minQtyNum)) {
      setError('Qty minimal wajib diisi.')
      return
    }

    const maxQtyNum = maxQty.trim() === '' ? null : Number(maxQty)
    if (maxQtyNum !== null && !Number.isFinite(maxQtyNum)) {
      setError('Qty maksimal harus angka.')
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
      .addPriceTier(productId, { productUnitId: selectedUnit.id, minQty: minQtyNum, maxQty: maxQtyNum, hargaJual: hargaNum })
      .then(() => {
        setMinQty('')
        setMaxQty('')
        setHargaJual('')
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  async function removeTier(tier: PriceTierRow) {
    const ok = await confirm({
      title: 'Hapus Harga Bertingkat',
      description: `Hapus harga bertingkat untuk pembelian ${tierRange(tier, unitLabel)}?`,
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
        <span className="text-xs text-muted-foreground">berdasarkan jumlah beli, per satuan</span>
      </div>

      <div className="flex items-end gap-2">
        <div className="grid w-48 gap-1">
          <Label className="text-xs">Satuan</Label>
          <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih satuan" />
            </SelectTrigger>
            <SelectContent>
              {units.map((unit) => (
                <SelectItem key={unit.id} value={String(unit.id)}>
                  {unit.satuan}
                  {unit.isBaseUnit ? ' (dasar)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visibleTiers.length > 0 ? (
        <div className="space-y-1.5">
          {visibleTiers.map((tier) => (
            <div
              key={tier.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50"
            >
              <span className="text-sm font-medium">Beli {tierRange(tier, unitLabel)}</span>
              <div className="flex items-center gap-2">
                {/* a tier is priced per this unit, so it is the unit's own modal it has to beat */}
                <Badge variant={selectedUnit && tier.hargaJual < selectedUnit.hargaPokok ? 'destructive' : 'secondary'}>
                  {formatRupiah(tier.hargaJual)} / {unitLabel}
                  {selectedUnit && tier.hargaJual < selectedUnit.hargaPokok && ' · di bawah modal'}
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
            <Label className="text-xs">Maks. Qty</Label>
            <Input type="number" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} placeholder="kosong = tak terbatas" />
          </div>
          <div className="grid w-40 gap-1">
            <Label className="text-xs">Harga Jual per {unitLabel}</Label>
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
