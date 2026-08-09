import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputError } from '@/components/input-error'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/hooks/use-confirm'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SatuanRow {
  id: number
  code: string
  name: string
  symbol: string
  isActive: boolean
}

interface EditDraft {
  code: string
  name: string
  symbol: string
  isActive: boolean
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Master Satuan', href: '/master-satuan' }]

export function MasterSatuan() {
  const [rows, setRows] = useState<SatuanRow[]>([])

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const [toggleError, setToggleError] = useState<string | null>(null)

  const { confirm, ConfirmDialog } = useConfirm()

  function loadRows() {
    window.api.masterSatuan.list().then(setRows)
  }

  useEffect(() => {
    loadRows()
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()

    if (!code.trim() || !name.trim() || !symbol.trim()) {
      setFormError('Kode, nama, dan simbol wajib diisi.')
      return
    }

    setProcessing(true)
    setFormError(null)

    window.api.masterSatuan
      .create({ code, name, symbol })
      .then(() => {
        setCode('')
        setName('')
        setSymbol('')
        loadRows()
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal menyimpan satuan')
      })
      .finally(() => setProcessing(false))
  }

  function startEdit(row: SatuanRow) {
    setEditingId(row.id)
    setEditDraft({ code: row.code, name: row.name, symbol: row.symbol, isActive: row.isActive })
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
    setEditError(null)
  }

  function saveEdit(id: number) {
    if (!editDraft) {
      return
    }

    if (!editDraft.code.trim() || !editDraft.name.trim() || !editDraft.symbol.trim()) {
      setEditError('Kode, nama, dan simbol wajib diisi.')
      return
    }

    window.api.masterSatuan
      .update(id, editDraft)
      .then(() => {
        cancelEdit()
        loadRows()
      })
      .catch((err) => {
        setEditError(err instanceof Error ? err.message : 'Gagal menyimpan satuan')
      })
  }

  async function toggleActive(row: SatuanRow) {
    setToggleError(null)

    if (row.isActive) {
      const ok = await confirm({
        title: 'Nonaktifkan Satuan',
        description: `Nonaktifkan satuan "${row.name}"?`,
        confirmLabel: 'Nonaktifkan',
        destructive: true,
      })

      if (!ok) {
        return
      }

      try {
        await window.api.masterSatuan.deactivate(row.id)
        loadRows()
      } catch (err) {
        setToggleError(err instanceof Error ? err.message : 'Gagal menonaktifkan satuan')
      }
      return
    }

    try {
      await window.api.masterSatuan.update(row.id, { code: row.code, name: row.name, symbol: row.symbol, isActive: true })
      loadRows()
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Gagal mengaktifkan satuan')
    }
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Master Satuan</h1>

        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-xl border p-4">
          <div className="grid gap-1">
            <Label>Kode</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="w-32" />
          </div>
          <div className="grid gap-1">
            <Label>Nama</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-48" />
          </div>
          <div className="grid gap-1">
            <Label>Simbol</Label>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-32" />
          </div>
          <Button type="submit" disabled={processing}>
            Tambah
          </Button>
          <InputError message={formError ?? undefined} />
        </form>

        {toggleError && <InputError message={toggleError} />}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">Kode</th>
                <th className="p-2">Nama</th>
                <th className="p-2">Simbol</th>
                <th className="p-2">Status</th>
                <th className="w-40 p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Belum ada satuan.
                  </td>
                </tr>
              )}
              {rows.map((row) =>
                editingId === row.id && editDraft ? (
                  <tr key={row.id} className="border-t">
                    <td className="p-2">
                      <Input
                        value={editDraft.code}
                        onChange={(e) => setEditDraft({ ...editDraft, code: e.target.value })}
                        className="w-28"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        value={editDraft.name}
                        onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        className="w-44"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        value={editDraft.symbol}
                        onChange={(e) => setEditDraft({ ...editDraft, symbol: e.target.value })}
                        className="w-28"
                      />
                    </td>
                    <td className="p-2">
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={editDraft.isActive}
                          onChange={(e) => setEditDraft({ ...editDraft, isActive: e.target.checked })}
                        />
                        {editDraft.isActive ? 'Aktif' : 'Nonaktif'}
                      </label>
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" onClick={() => saveEdit(row.id)}>
                          Simpan
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                          Batal
                        </Button>
                      </div>
                      <InputError message={editError ?? undefined} />
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id} className="border-t">
                    <td className="p-2">{row.code}</td>
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{row.symbol}</td>
                    <td className="p-2">
                      <Badge variant={row.isActive ? 'secondary' : 'outline'}>{row.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => startEdit(row)}>
                          Edit
                        </button>
                        <button type="button" className="text-xs text-destructive hover:underline" onClick={() => toggleActive(row)}>
                          {row.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>

      {ConfirmDialog}
    </AppShell>
  )
}
