import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
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

interface ExpenseRow {
  id: number
  tanggal: string
  kategori: string
  jumlah: number
  keterangan: string | null
  userName: string | null
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Pengeluaran', href: '/pengeluaran' }]

/** the recurring rows from the owner's own cash book, offered as shortcuts only */
const KATEGORI_UMUM = ['DPAM', 'KARYAWAN', 'BENSIN', 'LISTRIK', 'SEWA', 'LAIN-LAIN']

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function firstOfMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

export function Pengeluaran() {
  const [tanggal, setTanggal] = useState(today)
  const [kategori, setKategori] = useState('')
  const [jumlah, setJumlah] = useState('')
  const [keterangan, setKeterangan] = useState('')
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [totalJumlah, setTotalJumlah] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)

  function loadExpenses(page: number) {
    window.api.expense.listExpenses({ from, to, page }).then((result) => {
      setExpenses(result.data)
      setTotalJumlah(result.totalJumlah)
      setCurrentPage(result.currentPage)
      setLastPage(result.lastPage)
      setTotal(result.total)
    })
  }

  useEffect(() => {
    window.api.auth
      .me()
      .then((user) => setIsAdmin(user?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])

  useEffect(() => {
    loadExpenses(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  function submit(e: FormEvent) {
    e.preventDefault()

    const jumlahNum = Number(jumlah)

    if (!kategori.trim()) {
      setFormError('Kategori wajib diisi.')
      return
    }

    if (jumlah.trim() === '' || !Number.isFinite(jumlahNum) || jumlahNum <= 0) {
      setFormError('Jumlah harus lebih dari 0.')
      return
    }

    setProcessing(true)
    setFormError(null)

    window.api.expense
      .recordExpense({ tanggal, kategori, jumlah: jumlahNum, keterangan: keterangan || null })
      .then(() => {
        setKategori('')
        setJumlah('')
        setKeterangan('')
        loadExpenses(1)
      })
      .catch((err) => setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pengeluaran'))
      .finally(() => setProcessing(false))
  }

  function remove(id: number) {
    window.api.expense
      .deleteExpense(id)
      .then(() => loadExpenses(currentPage))
      .catch((err) => setFormError(err instanceof Error ? err.message : 'Gagal menghapus pengeluaran'))
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <Page>
        <PageHeader title="Pengeluaran" description="Kas keluar selain belanja barang: DPAM, karyawan, dan sejenisnya." />

        <form onSubmit={submit} className="space-y-4 rounded-xl border p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="grid gap-1">
              <Label htmlFor="tanggal">Tanggal</Label>
              <Input id="tanggal" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="kategori">Kategori</Label>
              <Input
                id="kategori"
                list="kategori-umum"
                maxLength={50}
                value={kategori}
                onChange={(e) => setKategori(e.target.value)}
              />
              <datalist id="kategori-umum">
                {KATEGORI_UMUM.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="jumlah">Jumlah</Label>
              <Input id="jumlah" type="number" min={0} value={jumlah} onChange={(e) => setJumlah(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="keterangan">Keterangan (opsional)</Label>
              <Input id="keterangan" maxLength={500} value={keterangan} onChange={(e) => setKeterangan(e.target.value)} />
            </div>
          </div>

          <InputError role="alert" message={formError ?? undefined} />

          <Button type="submit" disabled={processing}>
            Simpan Pengeluaran
          </Button>
        </form>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="from">Dari</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="to">Sampai</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Card>
            <CardHeader>
              <CardDescription>Total Pengeluaran</CardDescription>
              <CardTitle className="text-2xl">{formatRupiah(totalJumlah)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <ReportTable<ExpenseRow>
          title="Riwayat Pengeluaran"
          rows={expenses}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada pengeluaran pada periode ini."
          columns={[
            { key: 'tanggal', name: 'Tanggal', width: 130 },
            { key: 'kategori', name: 'Kategori', width: 160 },
            {
              key: 'jumlah',
              name: 'Jumlah',
              width: 150,
              renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.jumlah)}</span>,
            },
            { key: 'keterangan', name: 'Keterangan', renderCell: ({ row }) => row.keterangan ?? '-' },
            { key: 'userName', name: 'Dicatat oleh', width: 140, renderCell: ({ row }) => row.userName ?? '-' },
            ...(isAdmin
              ? [
                  {
                    key: 'id',
                    name: '',
                    width: 60,
                    renderCell: ({ row }: { row: ExpenseRow }) => (
                      <Button variant="ghost" size="icon" title="Hapus" onClick={() => remove(row.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => loadExpenses(currentPage - 1)}>
              Sebelumnya
            </Button>
            <span className="text-sm text-muted-foreground">
              Halaman {currentPage} / {lastPage}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= lastPage}
              onClick={() => loadExpenses(currentPage + 1)}
            >
              Berikutnya
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">dari {total} pengeluaran</span>
        </div>
      </Page>
    </AppShell>
  )
}
