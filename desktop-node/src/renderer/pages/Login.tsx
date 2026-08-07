import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, ClipboardList, LockKeyhole, ShoppingCart, Store, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const highlights = [
  { icon: ShoppingCart, text: 'Transaksi cepat dengan scan barcode' },
  { icon: Boxes, text: 'Kelola stok dan pembelian di satu tempat' },
  { icon: ClipboardList, text: 'Laporan penjualan yang selalu terbaru' },
]

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [storeName, setStoreName] = useState('POS')
  const navigate = useNavigate()

  useEffect(() => {
    window.api.kasir
      .getStoreSettings()
      .then((settings) => setStoreName(settings.namaToko))
      .catch(() => {})
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await window.api.auth.login(username, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal login')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative z-10 flex items-center gap-2 text-lg font-semibold">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/15">
            <Store className="size-5" />
          </div>
          {storeName}
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl leading-tight font-semibold text-balance">
            Satu aplikasi untuk seluruh operasional toko
          </h2>
          <ul className="space-y-4 text-sm text-indigo-100">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-indigo-200/70">&copy; {storeName}</p>
      </div>

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Store className="size-5" />
            </div>
            <span className="font-semibold">{storeName}</span>
          </div>

          <div className="mb-8 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Selamat datang kembali</h1>
            <p className="text-sm text-muted-foreground">Masuk untuk melanjutkan</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" />
                  <Input
                    id="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder="Username"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="Password"
                    className="pl-9"
                  />
                </div>
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" className="mt-1 w-full" disabled={isSubmitting}>
                Masuk
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
