import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatQty, formatRupiah } from '@/lib/utils'
import type { CostCorrectionHistory, CostCorrectionPreview, CostCorrectionRequest } from '../../../shared/cost-correction'

const RESTART_MESSAGE = 'Fitur Koreksi HPP belum dimuat oleh aplikasi. Tutup aplikasi dan jalankan ulang agar pembaruan aktif.'

function costCorrectionAvailable(): boolean {
  return typeof window.api?.rekap?.previewCostCorrection === 'function'
    && typeof window.api?.rekap?.applyCostCorrection === 'function'
    && typeof window.api?.rekap?.listCostCorrections === 'function'
}

export interface CorrectionTarget {
  saleItemId: number
  saleId: number
  namaItem: string
  satuan: string
  hargaPokok: number
}

export function CostCorrectionDialog({ target, from, to, onClose, onSaved }: {
  target: CorrectionTarget
  from: string
  to: string
  onClose: () => void
  onSaved: (count: number) => void
}) {
  const [scope, setScope] = useState<CostCorrectionRequest['scope']>('item')
  const [rangeFrom, setRangeFrom] = useState(from)
  const [rangeTo, setRangeTo] = useState(to)
  const [cost, setCost] = useState(String(target.hargaPokok))
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<CostCorrectionPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setPreview(null); setError(null) }, [scope, rangeFrom, rangeTo, cost])

  function request(): CostCorrectionRequest {
    return { saleItemId: target.saleItemId, scope, from: rangeFrom, to: rangeTo, hargaPokok: Number(cost) }
  }

  async function showPreview() {
    setError(null)
    setPreview(null)
    if (!costCorrectionAvailable()) {
      setError(RESTART_MESSAGE)
      return
    }
    if (!cost.trim() || !Number.isFinite(Number(cost)) || Number(cost) < 0) {
      setError('Masukkan HPP yang benar dalam rupiah.')
      return
    }
    setBusy(true)
    try {
      setPreview(await window.api.rekap.previewCostCorrection(request()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghitung koreksi.')
    } finally { setBusy(false) }
  }

  async function save() {
    if (!preview || busy || !reason.trim()) return
    if (!costCorrectionAvailable()) {
      setError(RESTART_MESSAGE)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.rekap.applyCostCorrection({ ...request(), token: preview.token, alasan: reason.trim() })
      onSaved(result.count)
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : 'Koreksi gagal disimpan.')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Koreksi HPP transaksi</DialogTitle>
          <DialogDescription>{target.namaItem} ({target.satuan}) · nota #{target.saleId}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Masukkan modal sebenarnya per satuan yang terjual. Koreksi ini menghitung ulang laba transaksi; harga katalog, stok, dan pembayaran tetap. Perubahan beserta alasan dan nama admin dicatat.</p>
        <fieldset disabled={busy} className="space-y-3">
          <div className="grid gap-1">
            <Label htmlFor="cost-scope">Cakupan koreksi</Label>
            <select id="cost-scope" className="h-9 rounded-md border bg-background px-3 text-sm" value={scope} onChange={(event) => setScope(event.target.value as CostCorrectionRequest['scope'])}>
              <option value="item">Hanya baris pada nota #{target.saleId}</option>
              <option value="period">Produk dan satuan yang sama pada rentang tanggal</option>
            </select>
          </div>
          {scope === 'period' && <>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1"><Label htmlFor="cost-from">Dari tanggal transaksi</Label><Input id="cost-from" type="date" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="cost-to">Sampai tanggal transaksi</Label><Input id="cost-to" type="date" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Mencakup seluruh transaksi selesai dengan produk, satuan, dan konversi yang sama, termasuk bon belum lunas. Tanggal ini adalah tanggal transaksi, bukan tanggal pelunasan bon.</p>
          </>}
          <div className="grid gap-1"><Label htmlFor="cost-value">HPP yang benar per {target.satuan} (Rp)</Label><Input id="cost-value" type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor="cost-reason">Alasan koreksi</Label><Input id="cost-reason" maxLength={1000} placeholder="Contoh: HPP salah input, sesuai faktur supplier Rp9.000" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
          <Button type="button" variant="outline" onClick={showPreview}>Tampilkan pratinjau</Button>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {preview && <div className="space-y-3">
          <p className="text-sm font-medium">{preview.rows.length} baris akan dikoreksi ke {formatRupiah(preview.hargaPokok)} per {preview.satuan}.</p>
          <p className="text-sm">Laba baris terpilih: {formatRupiah(preview.labaLama)} → <span className={preview.labaBaru < 0 ? 'text-destructive' : 'text-green-700 dark:text-green-400'}>{formatRupiah(preview.labaBaru)}</span></p>
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left"><th className="p-2">Nota / tanggal</th><th className="p-2">Qty</th><th className="p-2">HPP lama</th><th className="p-2">Laba lama</th><th className="p-2">Laba baru</th></tr></thead>
              <tbody>{preview.rows.map((row) => <tr key={row.saleItemId} className="border-b last:border-0">
                <td className="p-2">#{row.saleId}<span className="block text-xs text-muted-foreground">{new Date(row.tanggal).toLocaleDateString('id-ID')}</span></td>
                <td className="p-2">{formatQty(row.qty)}</td><td className="p-2">{formatRupiah(row.hargaPokokLama)}</td><td className="p-2">{formatRupiah(row.labaLama)}</td><td className="p-2">{formatRupiah(row.labaBaru)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Laba sudah memperhitungkan diskon item dan bagian diskon nota. Bon memengaruhi Rekap pada periode pelunasannya. Kerugian yang masih ada setelah koreksi tetap ditampilkan.</p>
        </div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Batal</Button>
          <Button type="button" disabled={busy || !preview || !reason.trim()} onClick={save}>{busy ? 'Memproses...' : 'Simpan koreksi HPP'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CostCorrectionHistoryDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<CostCorrectionHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!costCorrectionAvailable()) {
      setError(RESTART_MESSAGE)
      setLoading(false)
      return
    }
    let active = true
    window.api.rekap.listCostCorrections().then((result) => { if (active) setRows(result) })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Gagal memuat riwayat.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>Riwayat koreksi HPP</DialogTitle><DialogDescription>200 baris koreksi terbaru, termasuk transaksi di luar periode Rekap.</DialogDescription></DialogHeader>
      {loading && <p className="text-sm">Memuat...</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="text-sm text-muted-foreground">Belum ada koreksi HPP.</p>}
      {rows.map((row) => <div key={row.id} className="space-y-1 border-b pb-3 text-sm">
        <p className="font-medium">Nota #{row.saleId} · {row.namaItem} ({row.satuan}) · {formatQty(row.qty)}</p>
        <p>HPP {formatRupiah(row.hargaPokokLama)} → {formatRupiah(row.hargaPokokBaru)}</p>
        <p className="whitespace-pre-wrap">{row.alasan}</p>
        <p className="text-xs text-muted-foreground">{row.adminName} · {new Date(row.createdAt).toLocaleString('id-ID')}</p>
      </div>)}
    </DialogContent>
  </Dialog>
}
