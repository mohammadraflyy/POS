import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Heading } from '@/components/heading'
import { useConfirm } from '@/hooks/use-confirm'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Pengaturan' }]

function TestScan() {
  const [lastScan, setLastScan] = useState<{ code: string; at: string } | null>(null)
  const scanBuffer = useRef('')
  const scanLastKeyAt = useRef(0)

  useEffect(() => {
    function isEditableFocused() {
      const el = document.activeElement
      return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }

    function handleKeydown(e: KeyboardEvent) {
      if (isEditableFocused()) {
        return
      }

      const now = Date.now()

      if (now - scanLastKeyAt.current > 100) {
        scanBuffer.current = ''
      }

      scanLastKeyAt.current = now

      if (e.key === 'Enter') {
        const code = scanBuffer.current
        scanBuffer.current = ''

        if (code.length < 4) {
          return
        }

        e.preventDefault()
        setLastScan({ code, at: new Date().toLocaleTimeString('id-ID') })

        return
      }

      if (e.key.length === 1) {
        scanBuffer.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Test Scanner</p>
        <p className="text-sm text-muted-foreground">Klik di halaman ini lalu scan barcode apapun - kode yang terbaca akan muncul di sini.</p>
        {lastScan && (
          <p className="text-sm">
            Terakhir dibaca: <code className="rounded bg-muted px-1.5 py-0.5">{lastScan.code}</code>{' '}
            <span className="text-muted-foreground">({lastScan.at})</span>
          </p>
        )}
      </div>
      <ScanLine className="size-5 shrink-0 text-muted-foreground" />
    </div>
  )
}

function PurgeHistory() {
  const [before, setBefore] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  async function purge() {
    if (!before) {
      return
    }

    const ok = await confirm({
      title: 'Hapus Riwayat Transaksi',
      description: `Semua transaksi sebelum ${new Date(before).toLocaleDateString('id-ID')} akan dihapus permanen, termasuk transaksi Bon yang belum lunas - piutang yang tercatat akan ikut hilang. Tindakan ini tidak bisa dibatalkan.`,
      confirmLabel: 'Hapus Permanen',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setProcessing(true)
    setError(null)
    setMessage(null)

    try {
      const result = await window.api.kasir.purgeSalesBefore(before)
      setMessage(`${result.deleted} transaksi dihapus.`)
      setBefore('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus riwayat')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/50 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Hapus Riwayat Transaksi</p>
        <p className="text-sm text-muted-foreground">
          Hapus permanen semua transaksi sebelum tanggal tertentu, termasuk transaksi Bon yang belum lunas. Tidak bisa dibatalkan - pastikan sudah
          tidak dibutuhkan lagi.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <div className="flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="purge_before" className="text-xs">
            Sebelum tanggal
          </Label>
          <Input
            id="purge_before"
            type="date"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            disabled={processing}
            className="w-48"
          />
        </div>
        <Button type="button" variant="destructive" disabled={!before || processing} onClick={purge}>
          Hapus Riwayat
        </Button>
      </div>
      {ConfirmDialog}
    </div>
  )
}

export function Settings() {
  const [namaToko, setNamaToko] = useState('')
  const [alamat, setAlamat] = useState('')
  const [telepon, setTelepon] = useState('')
  const [pesanFooter, setPesanFooter] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.kasir.getStoreSettings().then((settings) => {
      setNamaToko(settings.namaToko)
      setAlamat(settings.alamat ?? '')
      setTelepon(settings.telepon ?? '')
      setPesanFooter(settings.pesanFooter ?? '')
    })
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    setProcessing(true)
    setError(null)
    setMessage(null)

    window.api.kasir
      .updateStoreSettings({
        namaToko,
        alamat: alamat || null,
        telepon: telepon || null,
        pesanFooter: pesanFooter || null,
      })
      .then(() => setMessage('Pengaturan toko diperbarui.'))
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-8 p-4">
        <h1 className="text-xl font-semibold">Pengaturan</h1>

        <div className="space-y-6">
          <Heading variant="small" title="Toko" description="Nama, alamat, dan pesan yang tampil di struk serta sidebar aplikasi" />

          <form onSubmit={submit} className="max-w-lg space-y-4">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {message && <p className="text-sm text-muted-foreground">{message}</p>}

            <div className="grid gap-2">
              <Label htmlFor="nama_toko">Nama Toko</Label>
              <Input id="nama_toko" value={namaToko} onChange={(e) => setNamaToko(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="alamat">Alamat</Label>
              <Input id="alamat" value={alamat} onChange={(e) => setAlamat(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="telepon">Telepon</Label>
              <Input id="telepon" value={telepon} onChange={(e) => setTelepon(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pesan_footer">Pesan Footer Struk</Label>
              <Input id="pesan_footer" value={pesanFooter} onChange={(e) => setPesanFooter(e.target.value)} />
            </div>

            <Button type="submit" disabled={processing}>
              Simpan
            </Button>
          </form>
        </div>

        <div className="space-y-6">
          <Heading variant="small" title="Perangkat" description="Uji scanner barcode yang terhubung" />
          <TestScan />
        </div>

        <div className="space-y-6">
          <Heading variant="small" title="Zona Berbahaya" description="Tindakan permanen yang tidak bisa dibatalkan" />
          <PurgeHistory />
        </div>
      </div>
    </AppShell>
  )
}
