import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AuthUser } from '../types'

export function Home() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    window.api.auth
      .me()
      .then((result) => {
        if (!result) {
          navigate('/login')
          return
        }
        setUser(result)
      })
      .catch(() => {
        navigate('/login')
      })
  }, [navigate])

  if (!user) {
    return <p>Memuat...</p>
  }

  return (
    <div>
      <h1>Halo, {user.name}</h1>
      <button
        onClick={async () => {
          await window.api.auth.logout()
          navigate('/login')
        }}
      >
        Keluar
      </button>
    </div>
  )
}
