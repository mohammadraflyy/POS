import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppSidebar } from '@/components/app-sidebar'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { TITLE_BAR_HEIGHT, TitleBar } from '@/components/title-bar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import type { AuthUser, BreadcrumbItem } from '../types'

export function AppShell({ breadcrumbs, children }: { breadcrumbs: BreadcrumbItem[]; children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [storeName, setStoreName] = useState('POS')

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
      .catch(() => navigate('/login'))
  }, [navigate])

  useEffect(() => {
    if (!user) {
      return
    }
    window.api.kasir
      .getStoreSettings()
      .then((settings) => setStoreName(settings.namaToko))
      .catch(() => {})
  }, [user])

  if (!user) {
    return <p>Memuat...</p>
  }

  return (
    // pt-9 leaves room for the fixed title bar (TITLE_BAR_HEIGHT); the shell
    // keeps its own scrolling, so the height budget shrinks by the same amount.
    <div className="pt-9 print:hidden">
      <TitleBar />
      <SidebarProvider style={{ minHeight: `calc(100svh - ${TITLE_BAR_HEIGHT}px)` }}>
        <AppSidebar storeName={storeName} user={user} />
        <SidebarInset style={{ minHeight: `calc(100svh - ${TITLE_BAR_HEIGHT}px)` }}>
          <header className="border-sidebar-border/50 group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-16 shrink-0 items-center gap-2 border-b px-6 transition-[width,height] ease-linear md:px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Breadcrumbs breadcrumbs={breadcrumbs} />
            </div>
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
