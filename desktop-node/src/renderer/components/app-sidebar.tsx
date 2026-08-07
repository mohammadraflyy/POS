import { Boxes, ClipboardCheck, ClipboardList, History, LayoutGrid, PackagePlus, ShoppingCart } from 'lucide-react'
import { AppLogo } from './app-logo'
import { NavMain } from './nav-main'
import { NavUser } from './nav-user'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar'
import type { AuthUser, NavItem } from '../types'

const overviewNavItems: NavItem[] = [{ title: 'Dashboard', href: '/dashboard', icon: LayoutGrid, disabled: true }]

const penjualanNavItems: NavItem[] = [
  { title: 'Penjualan', href: '/', icon: ShoppingCart },
  { title: 'Riwayat Transaksi', href: '/history', icon: History },
]

const pembelianNavItems: NavItem[] = [
  { title: 'Pembelian', href: '/purchase', icon: PackagePlus, disabled: true },
  { title: 'Katalog Produk', href: '/inventory', icon: Boxes },
  { title: 'Stock Opname', href: '/stock-opname', icon: ClipboardCheck, disabled: true },
]

const laporanNavItems: NavItem[] = [{ title: 'Rekap', href: '/rekap', icon: ClipboardList, disabled: true }]

export function AppSidebar({ storeName, user }: { storeName: string; user: AuthUser }) {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <AppLogo name={storeName} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={overviewNavItems} label="Ringkasan" />
        <NavMain items={penjualanNavItems} label="Penjualan" />
        <NavMain items={pembelianNavItems} label="Pembelian & Stok" />
        <NavMain items={laporanNavItems} label="Laporan" />
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
