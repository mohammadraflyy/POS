import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InputError } from '@/components/input-error'
import { Label } from '@/components/ui/label'
import { ReportTable } from '@/components/report-table'
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
  const [debts, setDebts] = useState<DebtRow[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null)
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [jumlah, setJumlah] = useState('')
  const [tanggal, setTanggal] = useState(today)
  const [keterangan, setKeterangan] = useState('')
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  useEffect(() => {
    loadDebts()
  }, [])

  useEffect(() => {
    if (selectedSupplierId !== null) {
      loadPayments(selectedSupplierId)
    }
  }, [selectedSupplierId])

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
  const selected = groups.find((g) => g.supplierId === selectedSupplierId) ?? null

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
        loadDebts()
        loadPayments(selected.supplierId)
      })
      .catch((err) => setFormError(err instanceof Error ? err.message : 'Gagal mencatat pembayaran'))
      .finally(() => setProcessing(false))
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
                <Button variant="outline" size="sm" onClick={() => setSelectedSupplierId(row.supplierId)}>
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
              <Button variant="ghost" size="sm" onClick={() => setSelectedSupplierId(null)}>
                Tutup
              </Button>
            </div>

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
                <Input id="tanggal" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className="w-40" />
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

            <ReportTable<DebtRow>
              title="Faktur Belum Lunas"
              rows={selected.invoices}
              rowKey={(row) => row.purchaseId}
              emptyMessage="Semua faktur lunas."
              columns={[
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
              ]}
            />
          </div>
        )}
      </Page>
    </AppShell>
  )
}
