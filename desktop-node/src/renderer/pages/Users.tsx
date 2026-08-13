import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputError } from '@/components/input-error'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/hooks/use-confirm'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem, UserRole } from '../types'

interface UserRow {
  id: number
  username: string
  name: string
  role: UserRole
  createdAt: string
}

interface EditDraft {
  name: string
  role: UserRole
  /** empty means "leave the password alone" */
  password: string
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Pengguna', href: '/users' }]

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

function roleLabel(role: UserRole): string {
  return role === 'admin' ? 'Admin' : 'Kasir'
}

export function Users() {
  const [rows, setRows] = useState<UserRow[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('kasir')
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { confirm, ConfirmDialog } = useConfirm()

  function loadRows() {
    window.api.users.list().then(setRows)
  }

  useEffect(() => {
    loadRows()
    window.api.auth.me().then((user) => setCurrentUserId(user?.id ?? null))
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()

    if (!username.trim() || !name.trim() || !password) {
      setFormError('Username, nama, dan password wajib diisi.')
      return
    }

    setProcessing(true)
    setFormError(null)

    window.api.users
      .create({ username, name, password, role })
      .then(() => {
        setUsername('')
        setName('')
        setPassword('')
        setRole('kasir')
        loadRows()
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pengguna')
      })
      .finally(() => setProcessing(false))
  }

  function startEdit(row: UserRow) {
    setEditingId(row.id)
    setEditDraft({ name: row.name, role: row.role, password: '' })
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

    if (!editDraft.name.trim()) {
      setEditError('Nama wajib diisi.')
      return
    }

    window.api.users
      .update(id, {
        name: editDraft.name,
        role: editDraft.role,
        password: editDraft.password ? editDraft.password : null,
      })
      .then(() => {
        cancelEdit()
        loadRows()
      })
      .catch((err) => {
        setEditError(err instanceof Error ? err.message : 'Gagal menyimpan pengguna')
      })
  }

  async function removeUser(row: UserRow) {
    setDeleteError(null)

    const ok = await confirm({
      title: 'Hapus Pengguna',
      description: `Hapus akun "${row.username}"? Transaksi yang pernah dibuatnya tetap tersimpan, tanpa nama.`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    try {
      await window.api.users.delete(row.id)
      loadRows()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus pengguna')
    }
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Pengguna</h1>
        <p className="text-sm text-muted-foreground">
          Kasir bisa menjual, menerima barang, dan mencatat opname. Hanya admin yang boleh mengubah harga, menghapus data,
          membatalkan transaksi, dan membuka Rekap.
        </p>

        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-xl border p-4">
          <div className="grid gap-1">
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} className="w-40" autoComplete="off" />
          </div>
          <div className="grid gap-1">
            <Label>Nama</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-48" />
          </div>
          <div className="grid gap-1">
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-40"
              autoComplete="new-password"
            />
          </div>
          <div className="grid gap-1">
            <Label>Hak Akses</Label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={SELECT_CLASS}>
              <option value="kasir">Kasir</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button type="submit" disabled={processing}>
            Tambah
          </Button>
          <InputError message={formError ?? undefined} />
        </form>

        {deleteError && <InputError message={deleteError} />}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">Username</th>
                <th className="p-2">Nama</th>
                <th className="p-2">Hak Akses</th>
                <th className="p-2">Password</th>
                <th className="w-40 p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Belum ada pengguna.
                  </td>
                </tr>
              )}
              {rows.map((row) =>
                editingId === row.id && editDraft ? (
                  <tr key={row.id} className="border-t">
                    <td className="p-2 text-muted-foreground">{row.username}</td>
                    <td className="p-2">
                      <Input
                        value={editDraft.name}
                        onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        className="w-44"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={editDraft.role}
                        onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value as UserRole })}
                        className={SELECT_CLASS}
                      >
                        <option value="kasir">Kasir</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <Input
                        type="password"
                        value={editDraft.password}
                        onChange={(e) => setEditDraft({ ...editDraft, password: e.target.value })}
                        placeholder="Biarkan kosong"
                        className="w-40"
                        autoComplete="new-password"
                      />
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
                    <td className="p-2">{row.username}</td>
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">
                      <Badge variant={row.role === 'admin' ? 'secondary' : 'outline'}>{roleLabel(row.role)}</Badge>
                    </td>
                    <td className="p-2 text-muted-foreground">••••</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => startEdit(row)}>
                          Edit
                        </button>
                        {row.id !== currentUserId && (
                          <button
                            type="button"
                            className="text-xs text-destructive hover:underline"
                            onClick={() => removeUser(row)}
                          >
                            Hapus
                          </button>
                        )}
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
