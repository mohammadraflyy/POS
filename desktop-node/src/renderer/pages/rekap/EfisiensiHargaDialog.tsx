import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useConfirm } from '@/hooks/use-confirm'
import { formatRupiah } from '@/lib/utils'

type Cakupan = 'rugi' | 'margin' | 'semua'
type Metode = 'margin_minimal' | 'persen' | 'nominal'

type Rencana = Awaited<ReturnType<typeof window.api.inventory.previewEfisiensiHarga>>
type BarisRencana = Rencana['baris'][number]

/** how many rows the preview lists; the rest are counted and still applied */
const BATAS_TAMPIL = 50

/** a row's key has to survive a refetch, and ids only repeat across the two kinds */
function kunci(row: Pick<BarisRencana, 'jenis' | 'id'>): string {
  return `${row.jenis}-${row.id}`
}

export function EfisiensiHargaDialog({
  open,
  onOpenChange,
  onSelesai,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** prices moved - the caller reloads whatever it was showing */
  onSelesai: () => void
}) {
  const [cakupan, setCakupan] = useState<Cakupan>('rugi')
  const [metode, setMetode] = useState<Metode>('margin_minimal')
  const [nilai, setNilai] = useState('5')
  const [categoryId, setCategoryId] = useState<string>('semua')
  const [kategori, setKategori] = useState<{ id: number; nama: string }[]>([])
  const [rencana, setRencana] = useState<Rencana | null>(null)
  const [dipilih, setDipilih] = useState<Set<string>>(new Set())
  const [memuat, setMemuat] = useState(false)
  const [memproses, setMemproses] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasil, setHasil] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  const filter = useMemo(
    () => ({
      cakupan,
      metode,
      nilai: metode === 'margin_minimal' ? undefined : Number(nilai),
      categoryId: categoryId === 'semua' ? null : Number(categoryId),
    }),
    [cakupan, metode, nilai, categoryId],
  )

  useEffect(() => {
    if (!open) {
      return
    }

    window.api.stockOpname
      .listCategories()
      .then(setKategori)
      .catch(() => setKategori([]))
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    let aktif = true
    setError(null)
    setHasil(null)

    // debounced: the raise amount is typed digit by digit, and each keystroke would otherwise
    // sweep the whole catalogue
    const timer = setTimeout(() => {
      setMemuat(true)

      window.api.inventory
        .previewEfisiensiHarga(filter)
        .then((result) => {
          if (!aktif) {
            return
          }

          setRencana(result)
          // everything starts ticked, hidden rows included - unticking is the deliberate act
          setDipilih(new Set(result.baris.map(kunci)))
        })
        .catch((err) => {
          if (aktif) {
            setRencana(null)
            setError(err instanceof Error ? err.message : 'Gagal menghitung rencana harga.')
          }
        })
        .finally(() => {
          if (aktif) {
            setMemuat(false)
          }
        })
    }, 350)

    return () => {
      aktif = false
      clearTimeout(timer)
    }
  }, [open, filter])

  function toggle(row: BarisRencana) {
    setDipilih((sebelum) => {
      const sesudah = new Set(sebelum)

      if (!sesudah.delete(kunci(row))) {
        sesudah.add(kunci(row))
      }

      return sesudah
    })
  }

  const barisTampil = rencana?.baris.slice(0, BATAS_TAMPIL) ?? []
  const semuaTampilDipilih = barisTampil.length > 0 && barisTampil.every((row) => dipilih.has(kunci(row)))
  const tersembunyi = rencana ? Math.max(0, rencana.baris.length - BATAS_TAMPIL) : 0
  const jumlahDipilih = rencana ? rencana.baris.filter((row) => dipilih.has(kunci(row))).length : 0

  function toggleSemuaTampil() {
    setDipilih((sebelum) => {
      const sesudah = new Set(sebelum)

      for (const row of barisTampil) {
        if (semuaTampilDipilih) {
          sesudah.delete(kunci(row))
        } else {
          sesudah.add(kunci(row))
        }
      }

      return sesudah
    })
  }

  async function terapkan() {
    if (!rencana || jumlahDipilih === 0) {
      return
    }

    const ok = await confirm({
      title: 'Terapkan harga baru',
      description: `${jumlahDipilih} harga akan dinaikkan dan tercatat di Riwayat Perubahan Harga tiap produk. Harga lama tidak bisa dikembalikan otomatis.`,
      confirmLabel: 'Terapkan',
      destructive: true,
    })

    if (!ok) {
      return
    }

    const terpilih = rencana.baris.filter((row) => dipilih.has(kunci(row)))

    setMemproses(true)
    setError(null)

    window.api.inventory
      .applyEfisiensiHarga({
        filter,
        pilihan: {
          satuanIds: terpilih.filter((row) => row.jenis === 'satuan').map((row) => row.id),
          tierIds: terpilih.filter((row) => row.jenis === 'tier').map((row) => row.id),
        },
      })
      .then((result) => {
        setHasil(
          `${result.satuanDiubah} harga satuan dan ${result.tierDiubah} harga bertingkat diperbarui. ${result.dilewati} dilewati.`,
        )
        setRencana(null)
        setDipilih(new Set())
        onSelesai()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menerapkan harga.'))
      .finally(() => setMemproses(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-3 overflow-hidden p-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Naikkan Harga</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Yang dihitung</Label>
            <Select value={cakupan} onValueChange={(v) => setCakupan(v as Cakupan)} disabled={memproses}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rugi">Hanya yang dijual di bawah modal</SelectItem>
                <SelectItem value="margin">Yang di bawah margin minimal</SelectItem>
                <SelectItem value="semua">Semua barang</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Kategori</Label>
            <Select value={categoryId} onValueChange={setCategoryId} disabled={memproses}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="semua">Semua kategori</SelectItem>
                {kategori.map((row) => (
                  <SelectItem key={row.id} value={String(row.id)}>
                    {row.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Cara menaikkan</Label>
            <Select value={metode} onValueChange={(v) => setMetode(v as Metode)} disabled={memproses}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="margin_minimal">Sampai margin minimal</SelectItem>
                <SelectItem value="persen">Naik sekian persen</SelectItem>
                <SelectItem value="nominal">Naik sekian rupiah</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {metode !== 'margin_minimal' && (
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor="nilai-kenaikan">
                {metode === 'persen' ? 'Kenaikan (%)' : 'Kenaikan (Rp)'}
              </Label>
              <Input
                id="nilai-kenaikan"
                type="number"
                min={0}
                value={nilai}
                disabled={memproses}
                onChange={(e) => setNilai(e.target.value)}
              />
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {metode === 'margin_minimal'
            ? `Harga baru dihitung dari harga beli supaya menyisakan margin ${rencana?.marginMinimalPersen ?? 10}% dari harga jual.`
            : 'Harga baru dihitung dari harga jual sekarang, bukan dari harga beli - barang yang modalnya di atas harga jual bisa tetap rugi.'}{' '}
          Semua dibulatkan ke atas ke Rp 100 terdekat.
          {cakupan === 'semua' && ' Cakupan "semua barang" bisa mengubah sangat banyak harga sekaligus.'}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {memuat && <p className="py-6 text-center text-sm text-muted-foreground">Menghitung...</p>}

          {!memuat && rencana && rencana.baris.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Tidak ada harga yang perlu dinaikkan untuk pilihan ini.
            </p>
          )}

          {!memuat && rencana && rencana.baris.length > 0 && (
            <div className="space-y-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-8 py-1">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua yang tampil"
                        checked={semuaTampilDipilih}
                        onChange={toggleSemuaTampil}
                        className="size-4 align-middle accent-primary"
                      />
                    </th>
                    <th className="py-1 pr-3 font-medium">Item</th>
                    <th className="py-1 pr-3 text-right font-medium">Modal</th>
                    <th className="py-1 pr-3 text-right font-medium">Harga Lama</th>
                    <th className="py-1 text-right font-medium">Harga Baru</th>
                  </tr>
                </thead>
                <tbody>
                  {barisTampil.map((row) => (
                    <tr key={kunci(row)} className="border-b last:border-0">
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${row.namaItem} ${row.satuan}`}
                          checked={dipilih.has(kunci(row))}
                          onChange={() => toggle(row)}
                          className="size-4 align-middle accent-primary"
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        {row.namaItem}{' '}
                        <span className="text-muted-foreground">
                          ({row.satuan}){row.jenis === 'tier' && ` - bertingkat min ${row.minQty}`}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {row.hargaPokok > 0 ? formatRupiah(row.hargaPokok) : '-'}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatRupiah(row.hargaLama)}
                      </td>
                      <td className="py-1.5 text-right font-medium tabular-nums text-green-700 dark:text-green-400">
                        {formatRupiah(row.hargaBaru)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tersembunyi > 0 && (
                <p className="text-xs text-muted-foreground">
                  {tersembunyi} baris lain tidak muat ditampilkan. Semuanya ikut tercentang dan akan ikut diterapkan -
                  persempit lewat kategori kalau ingin memilih satu per satu.
                </p>
              )}

              {rencana.dilewati.length > 0 && (
                <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 dark:bg-amber-500/15">
                  <p className="text-sm font-medium">
                    {rencana.dilewati.length} baris sengaja dilewati - datanya kelihatan rusak
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Harga barunya lebih dari 1,5x harga sekarang, biasanya karena konversi atau harga beli salah
                    ketik. Menaikkannya hanya akan menyembunyikan kesalahannya. Perbaiki manual di halaman produk.
                  </p>
                  <ul className="space-y-0.5 pt-1 text-xs tabular-nums">
                    {rencana.dilewati.slice(0, 10).map((row) => (
                      <li key={`${row.namaItem}-${row.satuan}`}>
                        {row.namaItem} ({row.satuan}): jual {formatRupiah(row.hargaLama)} vs modal{' '}
                        {formatRupiah(row.hargaPokok)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {hasil && <p className="py-6 text-center text-sm font-medium text-green-700 dark:text-green-400">{hasil}</p>}
          {error && (
            <p role="alert" className="pt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {rencana && rencana.baris.length > 0
              ? `${jumlahDipilih} dari ${rencana.baris.length} harga dipilih`
              : ' '}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={memproses} onClick={() => onOpenChange(false)}>
              Tutup
            </Button>
            <Button type="button" disabled={memproses || memuat || jumlahDipilih === 0} onClick={terapkan}>
              Terapkan
            </Button>
          </div>
        </div>
        {ConfirmDialog}
      </DialogContent>
    </Dialog>
  )
}
