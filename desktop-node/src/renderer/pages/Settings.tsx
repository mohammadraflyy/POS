import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import QRCode from 'qrcode'
import { Printer, QrCode, ScanLine } from 'lucide-react'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Heading } from '@/components/heading'
import { useConfirm } from '@/hooks/use-confirm'
import { useAppearance, type Appearance as AppearanceMode } from '@/hooks/use-appearance'
import { resetMarginMinimalCache } from '@/hooks/use-margin-minimal'
import { copyToClipboard } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Pengaturan' }]

function AppearanceSetting() {
  const { appearance, updateAppearance } = useAppearance()

  return (
    <div className="grid max-w-lg gap-2">
      <Label htmlFor="appearance">Tema</Label>
      <Select value={appearance} onValueChange={(v) => updateAppearance(v as AppearanceMode)}>
        <SelectTrigger id="appearance" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">Terang</SelectItem>
          <SelectItem value="dark">Gelap</SelectItem>
          <SelectItem value="system">Ikuti Sistem</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

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

function TestPrint() {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function runTestPrint() {
    setProcessing(true)
    setError(null)
    setMessage(null)

    try {
      await window.api.kasir.testPrint()
      setMessage('Struk uji dicetak.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencetak')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Test Print</p>
        <p className="text-sm text-muted-foreground">
          Cetak struk contoh menggunakan printer dan lebar kertas yang sudah disimpan, untuk memastikan pengaturan sudah benar.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
      <Button type="button" variant="outline" onClick={runTestPrint} disabled={processing}>
        <Printer className="size-4" />
        Test Print
      </Button>
    </div>
  )
}

function ServerStatus() {
  const [status, setStatus] = useState<{ running: boolean; address: string | null; port: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    function refresh() {
      window.api.device
        .getServerStatus()
        .then((s) => {
          if (!cancelled) {
            setStatus(s)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus(null)
          }
        })
    }

    refresh()
    const interval = setInterval(refresh, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const running = status?.running ?? false

  function statusText() {
    if (!running) {
      return 'Server belum berjalan.'
    }
    if (!status?.address) {
      return 'Berjalan, tapi tidak terhubung ke jaringan lokal - HP tidak akan bisa terhubung.'
    }
    return `Berjalan di ${status.address}:${status.port}`
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Status Server Mobile</p>
        <p className="text-sm text-muted-foreground">{statusText()}</p>
      </div>
      <Badge variant={running ? 'secondary' : 'outline'}>{running ? 'Aktif' : 'Nonaktif'}</Badge>
    </div>
  )
}

function PairingQr() {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; serverAddress: string | null } | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setProcessing(true)
    setError(null)
    setCopied(false)

    try {
      const result = await window.api.device.generatePairingCode()
      const dataUrl = await QRCode.toDataURL(JSON.stringify({ address: result.serverAddress, code: result.code }))

      setPairing(result)
      setQrDataUrl(dataUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat kode pairing.')
      setPairing(null)
      setQrDataUrl(null)
    } finally {
      setProcessing(false)
    }
  }

  async function copyCode() {
    if (!pairing) {
      return
    }

    await copyToClipboard(pairing.code)
    setCopied(true)
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium">Pasangkan Perangkat Baru</p>
        <p className="text-sm text-muted-foreground">
          Buat kode pairing, lalu pindai QR ini dari aplikasi mobile untuk menyambungkan HP ke toko ini. Kode berlaku 5 menit dan hanya bisa
          dipakai sekali.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {pairing && !error && (
          <div className="space-y-1 pt-1">
            <p className="text-sm">
              Kode: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-base tracking-widest">{pairing.code}</code>{' '}
              <button type="button" onClick={copyCode} className="text-xs text-primary hover:underline">
                {copied ? 'Tersalin' : 'Salin'}
              </button>
            </p>
            <p className="text-xs text-muted-foreground">Berlaku sampai {new Date(pairing.expiresAt).toLocaleTimeString('id-ID')}.</p>
            {!pairing.serverAddress && (
              <p className="text-xs text-destructive">Server tidak terhubung ke jaringan - HP tidak akan bisa memindai kode ini.</p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-2">
        {qrDataUrl && <img src={qrDataUrl} alt="QR kode pairing" className="size-32 rounded border bg-white p-1" />}
        <Button type="button" variant="outline" onClick={generate} disabled={processing}>
          <QrCode className="size-4" />
          {pairing ? 'Buat Kode Baru' : 'Buat Kode Pairing'}
        </Button>
      </div>
    </div>
  )
}

interface PairedDeviceRow {
  id: number
  namaPerangkat: string | null
  userName: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

function PairedDevices() {
  const [devices, setDevices] = useState<PairedDeviceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  function load() {
    window.api.device
      .listPairedDevices()
      .then(setDevices)
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat daftar perangkat.'))
  }

  useEffect(() => {
    load()
  }, [])

  async function revoke(device: PairedDeviceRow) {
    const ok = await confirm({
      title: 'Cabut Perangkat',
      description: `HP "${device.namaPerangkat ?? 'tanpa nama'}" milik ${device.userName} tidak akan bisa mengakses toko ini lagi sampai dipasangkan ulang.`,
      confirmLabel: 'Cabut',
      destructive: true,
    })

    if (!ok) {
      return
    }

    try {
      await window.api.device.revokeDevice(device.id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencabut perangkat.')
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Perangkat Terpasang</p>
        <p className="text-sm text-muted-foreground">HP yang sudah dipasangkan ke toko ini lewat kode pairing.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada perangkat yang dipasangkan.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-2 font-normal">Perangkat</th>
              <th className="py-2 pr-2 font-normal">Pengguna</th>
              <th className="py-2 pr-2 font-normal">Terakhir Aktif</th>
              <th className="py-2 pr-2 font-normal">Status</th>
              <th className="py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id} className="border-b last:border-0">
                <td className="py-2 pr-2">{device.namaPerangkat ?? '-'}</td>
                <td className="py-2 pr-2">{device.userName}</td>
                <td className="py-2 pr-2 text-muted-foreground">
                  {device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString('id-ID') : 'Belum pernah'}
                </td>
                <td className="py-2 pr-2">
                  <Badge variant={device.revokedAt ? 'outline' : 'secondary'}>{device.revokedAt ? 'Dicabut' : 'Aktif'}</Badge>
                </td>
                <td className="py-2 text-right">
                  {!device.revokedAt && (
                    <button type="button" onClick={() => revoke(device)} className="text-xs text-destructive hover:underline">
                      Cabut
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ConfirmDialog}
    </div>
  )
}

function PurgeToday() {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  async function purge() {
    setError(null)
    setMessage(null)

    let scope = 'Semua transaksi hari ini'
    try {
      const salesToday = await window.api.kasir.listSalesToday()
      scope = `${salesToday.length} transaksi hari ini`
    } catch {
      // Gagal mengambil jumlah transaksi - lanjutkan dengan teks generik.
    }

    const ok = await confirm({
      title: 'Hapus Transaksi Hari Ini',
      description: `${scope} akan dihapus permanen dan stok yang terjual dikembalikan, termasuk transaksi Bon yang belum ada pembayarannya. Transaksi Bon yang sudah ada pembayarannya akan dilewati. Tindakan ini tidak bisa dibatalkan.`,
      confirmLabel: 'Hapus Permanen',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setProcessing(true)

    try {
      const result = await window.api.kasir.purgeTodaySales()
      setMessage(
        result.skipped > 0
          ? `${result.deleted} transaksi dihapus, ${result.skipped} dilewati (sudah ada pembayaran bon).`
          : `${result.deleted} transaksi dihapus.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus transaksi')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/50 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Hapus Transaksi Hari Ini</p>
        <p className="text-sm text-muted-foreground">
          Hapus permanen semua transaksi hari ini dan kembalikan stoknya - cocok buat bersihkan transaksi tes atau salah
          input. Transaksi Bon yang sudah dibayar sebagian dilewati.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <Button type="button" variant="destructive" disabled={processing} onClick={purge}>
        Hapus Transaksi Hari Ini
      </Button>
      {ConfirmDialog}
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
  const [printerName, setPrinterName] = useState<string | null>(null)
  const [receiptWidth, setReceiptWidth] = useState<'58mm' | '80mm'>('58mm')
  const [marginMinimal, setMarginMinimal] = useState('10')
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.kasir
      .getStoreSettings()
      .then((settings) => {
        setNamaToko(settings.namaToko)
        setAlamat(settings.alamat ?? '')
        setTelepon(settings.telepon ?? '')
        setPesanFooter(settings.pesanFooter ?? '')
        setPrinterName(settings.printerName)
        setReceiptWidth(settings.receiptWidth)
        setMarginMinimal(String(settings.marginMinimalPersen))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan toko.'))

    window.api.kasir
      .listPrinters()
      .then(setPrinters)
      .catch(() => setPrinters([]))
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
        printerName,
        receiptWidth,
        marginMinimalPersen: Number(marginMinimal),
      })
      .then(() => {
        // the price forms cache this value for the session; drop it so they read the new one
        resetMarginMinimalCache()
        setMessage('Pengaturan toko diperbarui.')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page className="gap-8">
        <PageHeader title="Pengaturan" />

        <div className="space-y-6">
          <Heading variant="small" title="Tampilan" description="Pilih tema terang, gelap, atau ikuti pengaturan sistem" />
          <AppearanceSetting />
        </div>

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
            <div className="grid gap-2">
              <Label htmlFor="printer_name">Printer</Label>
              <Select value={printerName ?? '__default__'} onValueChange={(v) => setPrinterName(v === '__default__' ? null : v)}>
                <SelectTrigger id="printer_name" className="w-full">
                  <SelectValue placeholder="Printer default sistem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Printer default sistem</SelectItem>
                  {printers.map((printer) => (
                    <SelectItem key={printer.name} value={printer.name}>
                      {printer.displayName}
                      {printer.isDefault ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="margin_minimal">Margin Minimal (%)</Label>
              <Input
                id="margin_minimal"
                type="number"
                min={0}
                max={90}
                value={marginMinimal}
                onChange={(e) => setMarginMinimal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Dihitung dari harga jual. Dipakai untuk menyarankan harga jual di form satuan dan harga
                bertingkat &mdash; misal modal Rp 144.000 dengan margin 10% disarankan dijual Rp 160.000.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="receipt_width">Lebar Kertas Struk</Label>
              <Select value={receiptWidth} onValueChange={(v) => setReceiptWidth(v as '58mm' | '80mm')}>
                <SelectTrigger id="receipt_width" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="58mm">58mm</SelectItem>
                  <SelectItem value="80mm">80mm</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" disabled={processing}>
              Simpan
            </Button>
          </form>
        </div>

        <div className="space-y-6">
          <Heading variant="small" title="Perangkat" description="Uji scanner barcode dan printer struk yang terhubung" />
          <TestScan />
          <TestPrint />
        </div>

        <div className="space-y-6">
          <Heading variant="small" title="Perangkat Mobile" description="Sambungkan HP kasir tambahan ke toko ini lewat jaringan lokal" />
          <ServerStatus />
          <PairingQr />
          <PairedDevices />
        </div>

        <div className="space-y-6">
          <Heading variant="small" title="Zona Berbahaya" description="Tindakan permanen yang tidak bisa dibatalkan" />
          <PurgeToday />
          <PurgeHistory />
        </div>
      </Page>
    </AppShell>
  )
}
