import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputError } from '@/components/input-error'
import { Label } from '@/components/ui/label'
import { ReportTable } from '@/components/report-table'
import { useConfirm } from '@/hooks/use-confirm'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface DebtRow {
  purchaseId: number
  supplierId: number | null
  supplierName: string | null
  tanggal: string
  total: number
  dibayar: number
  sisa: number
}

interface PaymentRow {
  id: number
  purchaseId: number
  jumlah: number
  tanggal: string
  keterangan: string | null
}

interface SupplierGroup {
  supplierId: number
  supplierName: string
  sisa: number
  invoices: DebtRow[]
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Hutang Supplier', href: '/hutang-supplier' }]

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function HutangSupplier() {
  const navigate = useNavigate()
  const { confirm, ConfirmDialog } = useConfirm()
  const [debts, setDebts] = useState<DebtRow[]>([])
  // the name is kept alongside the id so the panel stays open - with its payment history
  // still editable - after a correction settles the supplier's last invoice
  const [selectedSupplier, setSelectedSupplier] = useState<{ id: number; name: string } | null>(null)
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [jumlah, setJumlah] = useState('')
  const [tanggal, setTanggal] = useState(today)
  const [keterangan, setKeterangan] = useState('')
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editingPayment, setEditingPayment] = useState<PaymentRow | null>(null)
  const [editJumlah, setEditJumlah] = useState('')
  const [editTanggal, setEditTanggal] = useState('')
  const [editKeterangan, setEditKeterangan] = useState('')

  const [editingInvoice, setEditingInvoice] = useState<DebtRow | null>(null)
  const [editSisa, setEditSisa] = useState('')

  const [dialogProcessing, setDialogProcessing] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  function loadDebts() {
    window.api.purchase
      .listSupplierDebts()
      .then((rows) => {
        setDebts(rows)
        setLoadError(null)
      })
      .catch(() => setLoadError('Gagal memuat hutang supplier.'))
  }

  function loadPayments(supplierId: number) {
    window.api.purchase
      .listSupplierPayments(supplierId)
      .then(setPayments)
      .catch(() => setPayments([]))
  }

  function reload() {
    loadDebts()

    if (selectedSupplier) {
      loadPayments(selectedSupplier.id)
    }
  }

  useEffect(() => {
    loadDebts()
  }, [])

  useEffect(() => {
    if (selectedSupplier !== null) {
      loadPayments(selectedSupplier.id)
    }
  }, [selectedSupplier])

  // a purchase with no supplier has nobody to pay, so it is counted but never selectable
  const groups: SupplierGroup[] = []
  for (const debt of debts) {
    if (debt.supplierId === null) {
      continue
    }

    const existing = groups.find((g) => g.supplierId === debt.supplierId)

    if (existing) {
      existing.sisa += debt.sisa
      existing.invoices.push(debt)
    } else {
      groups.push({
        supplierId: debt.supplierId,
        supplierName: debt.supplierName ?? `Supplier #${debt.supplierId}`,
        sisa: debt.sisa,
        invoices: [debt],
      })
    }
  }

  const totalHutang = groups.reduce((sum, g) => sum + g.sisa, 0)
  const selected: SupplierGroup | null = selectedSupplier
    ? (groups.find((g) => g.supplierId === selectedSupplier.id) ?? {
        supplierId: selectedSupplier.id,
        supplierName: selectedSupplier.name,
        sisa: 0,
        invoices: [],
      })
    : null

  function submit(e: FormEvent) {
    e.preventDefault()

    if (!selected) {
      return
    }

    const jumlahNum = Number(jumlah)

    if (jumlah.trim() === '' || !Number.isFinite(jumlahNum) || jumlahNum <= 0) {
      setFormError('Jumlah bayar harus lebih dari 0.')
      return
    }

    if (jumlahNum > selected.sisa) {
      setFormError('Jumlah bayar melebihi sisa hutang supplier.')
      return
    }

    setProcessing(true)
    setFormError(null)

    window.api.purchase
      .recordSupplierPayment({
        supplierId: selected.supplierId,
        jumlah: jumlahNum,
        tanggal,
        keterangan: keterangan || null,
      })
      .then(() => {
        setJumlah('')
        setKeterangan('')
        reload()
      })
      .catch((err) => setFormError(err instanceof Error ? err.message : 'Gagal mencatat pembayaran'))
      .finally(() => setProcessing(false))
  }

  function openEditPayment(row: PaymentRow) {
    setEditingPayment(row)
    setEditJumlah(String(row.jumlah))
    setEditTanggal(row.tanggal)
    setEditKeterangan(row.keterangan ?? '')
    setDialogError(null)
  }

  function submitEditPayment(e: FormEvent) {
    e.preventDefault()

    if (!editingPayment) {
      return
    }

    const jumlahNum = Number(editJumlah)

    if (editJumlah.trim() === '' || !Number.isFinite(jumlahNum) || jumlahNum <= 0) {
      setDialogError('Jumlah bayar harus lebih dari 0.')
      return
    }

    setDialogProcessing(true)
    setDialogError(null)

    window.api.purchase
      .updateSupplierPayment(editingPayment.id, {
        jumlah: jumlahNum,
        tanggal: editTanggal,
        keterangan: editKeterangan || null,
      })
      .then(() => {
        setEditingPayment(null)
        reload()
      })
      .catch((err) => setDialogError(err instanceof Error ? err.message : 'Gagal mengubah pembayaran'))
      .finally(() => setDialogProcessing(false))
  }

  async function removePayment(row: PaymentRow) {
    const ok = await confirm({
      title: 'Hapus Pembayaran',
      description: `Hapus pembayaran ${formatRupiah(row.jumlah)} tanggal ${row.tanggal} untuk faktur #${row.purchaseId}? Jumlahnya akan kembali menjadi hutang.`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    window.api.purchase
      .deleteSupplierPayment(row.id)
      .then(reload)
      .catch((err) => setFormError(err instanceof Error ? err.message : 'Gagal menghapus pembayaran'))
  }

  function openEditInvoice(row: DebtRow) {
    setEditingInvoice(row)
    setEditSisa(String(row.sisa))
    setDialogError(null)
  }

  function submitEditInvoice(e: FormEvent) {
    e.preventDefault()

    if (!editingInvoice) {
      return
    }

    const sisaNum = Number(editSisa)

    if (editSisa.trim() === '' || !Number.isFinite(sisaNum) || sisaNum < 0) {
      setDialogError('Sisa hutang harus berupa angka, minimal 0.')
      return
    }

    if (sisaNum > editingInvoice.total) {
      setDialogError('Sisa hutang tidak boleh melebihi total faktur.')
      return
    }

    setDialogProcessing(true)
    setDialogError(null)

    window.api.purchase
      .updatePurchaseSisaHutang(editingInvoice.purchaseId, sisaNum)
      .then(() => {
        setEditingInvoice(null)
        reload()
      })
      .catch((err) => setDialogError(err instanceof Error ? err.message : 'Gagal mengubah sisa hutang'))
      .finally(() => setDialogProcessing(false))
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Hutang Supplier" description="Pembayaran dialokasikan ke faktur terlama lebih dulu." />

        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Total Hutang</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(totalHutang)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Faktur Belum Lunas</CardDescription>
              <CardTitle className="text-2xl">{debts.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <ReportTable<SupplierGroup>
          title="Hutang per Supplier"
          rows={groups}
          rowKey={(row) => row.supplierId}
          emptyMessage="Tidak ada hutang supplier."
          columns={[
            { key: 'supplierName', name: 'Supplier' },
            {
              key: 'invoices',
              name: 'Faktur',
              width: 100,
              renderCell: ({ row }) => <span className="w-full text-right">{row.invoices.length}</span>,
            },
            {
              key: 'sisa',
              name: 'Sisa Hutang',
              width: 160,
              renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.sisa)}</span>,
            },
            {
              key: 'supplierId',
              name: '',
              width: 100,
              renderCell: ({ row }) => (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedSupplier({ id: row.supplierId, name: row.supplierName })}
                >
                  Bayar
                </Button>
              ),
            },
          ]}
        />

        {selected && (
          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                {selected.supplierName} — sisa {formatRupiah(selected.sisa)}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setSelectedSupplier(null)}>
                Tutup
              </Button>
            </div>

            {selected.sisa > 0 ? (
              <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="jumlah">Jumlah Bayar</Label>
                  <Input
                    id="jumlah"
                    type="number"
                    min={0}
                    autoFocus
                    value={jumlah}
                    onChange={(e) => setJumlah(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="tanggal">Tanggal</Label>
                  <Input
                    id="tanggal"
                    type="date"
                    value={tanggal}
                    onChange={(e) => setTanggal(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="keterangan">Keterangan (opsional)</Label>
                  <Input id="keterangan" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className="w-64" />
                </div>
                <Button type="submit" disabled={processing}>
                  Simpan Pembayaran
                </Button>
                <InputError role="alert" message={formError ?? undefined} />
              </form>
            ) : (
              <>
                <p className="text-sm font-medium text-green-600 dark:text-green-400">Hutang supplier ini sudah lunas.</p>
                <InputError role="alert" message={formError ?? undefined} />
              </>
            )}

            <ReportTable<DebtRow>
              title="Faktur Belum Lunas"
              rows={selected.invoices}
              rowKey={(row) => row.purchaseId}
              emptyMessage="Semua faktur lunas."
              columns={[
                { key: 'purchaseId', name: 'Faktur', width: 90, renderCell: ({ row }) => `#${row.purchaseId}` },
                { key: 'tanggal', name: 'Tanggal', width: 130 },
                {
                  key: 'total',
                  name: 'Total',
                  width: 150,
                  renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.total)}</span>,
                },
                {
                  key: 'dibayar',
                  name: 'Dibayar',
                  width: 150,
                  renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.dibayar)}</span>,
                },
                {
                  key: 'sisa',
                  name: 'Sisa',
                  width: 150,
                  renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.sisa)}</span>,
                },
                {
                  key: 'aksi',
                  name: 'Aksi',
                  width: 230,
                  renderCell: ({ row }) => (
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEditInvoice(row)}>
                        Ubah Sisa
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/purchase?edit=${row.purchaseId}`)}>
                        Edit Faktur
                      </Button>
                    </div>
                  ),
                },
              ]}
            />

            <ReportTable<PaymentRow>
              title="Riwayat Pembayaran"
              rows={payments}
              rowKey={(row) => row.id}
              emptyMessage="Belum ada pembayaran."
              columns={[
                { key: 'tanggal', name: 'Tanggal', width: 130 },
                { key: 'purchaseId', name: 'Faktur', width: 100, renderCell: ({ row }) => `#${row.purchaseId}` },
                {
                  key: 'jumlah',
                  name: 'Jumlah',
                  width: 150,
                  renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.jumlah)}</span>,
                },
                { key: 'keterangan', name: 'Keterangan', renderCell: ({ row }) => row.keterangan ?? '-' },
                {
                  key: 'aksi',
                  name: 'Aksi',
                  width: 90,
                  renderCell: ({ row }) => (
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon" title="Ubah" onClick={() => openEditPayment(row)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" title="Hapus" onClick={() => removePayment(row)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Page>

      <Dialog open={editingPayment !== null} onOpenChange={(open) => !open && setEditingPayment(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Pembayaran</DialogTitle>
            <DialogDescription>
              Faktur #{editingPayment?.purchaseId}. Sisa hutang faktur ikut menyesuaikan.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEditPayment} className="space-y-3">
            <div className="grid gap-1">
              <Label htmlFor="edit-jumlah">Jumlah Bayar</Label>
              <Input
                id="edit-jumlah"
                type="number"
                min={0}
                autoFocus
                value={editJumlah}
                onChange={(e) => setEditJumlah(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="edit-tanggal">Tanggal</Label>
              <Input id="edit-tanggal" type="date" value={editTanggal} onChange={(e) => setEditTanggal(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="edit-keterangan">Keterangan (opsional)</Label>
              <Input id="edit-keterangan" value={editKeterangan} onChange={(e) => setEditKeterangan(e.target.value)} />
            </div>
            <InputError role="alert" message={dialogError ?? undefined} />
            <DialogFooter>
              <Button type="submit" disabled={dialogProcessing}>
                Simpan Perubahan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editingInvoice !== null} onOpenChange={(open) => !open && setEditingInvoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Sisa Hutang</DialogTitle>
            <DialogDescription>
              Faktur #{editingInvoice?.purchaseId} · {editingInvoice?.tanggal} · total{' '}
              {formatRupiah(editingInvoice?.total ?? 0)}. Riwayat cicilan tidak berubah; yang disesuaikan adalah
              uang muka faktur. Untuk mengubah total, pakai Edit Faktur.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEditInvoice} className="space-y-3">
            <div className="grid gap-1">
              <Label htmlFor="edit-sisa">Sisa Hutang</Label>
              <Input
                id="edit-sisa"
                type="number"
                min={0}
                autoFocus
                value={editSisa}
                onChange={(e) => setEditSisa(e.target.value)}
              />
            </div>
            <InputError role="alert" message={dialogError ?? undefined} />
            <DialogFooter>
              <Button type="submit" disabled={dialogProcessing}>
                Simpan Perubahan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {ConfirmDialog}
    </AppShell>
  )
}
