import {
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutGrid,
  PackagePlus,
  Ruler,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import { AppLogo } from './app-logo'
import { NavMain } from './nav-main'
import { NavUser } from './nav-user'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar'
import type { AuthUser, NavItem } from '../types'

const overviewNavItems: NavItem[] = [{ title: 'Dashboard', href: '/', icon: LayoutGrid }]

const penjualanNavItems: NavItem[] = [
  { title: 'Penjualan', href: '/kasir', icon: ShoppingCart },
  { title: 'Riwayat Transaksi', href: '/history', icon: History },
]

const pembelianNavItems: NavItem[] = [
  { title: 'Pembelian', href: '/purchase', icon: PackagePlus },
  { title: 'Supplier', href: '/supplier', icon: Building2 },
  { title: 'Katalog Produk', href: '/inventory', icon: Boxes },
  { title: 'Master Satuan', href: '/master-satuan', icon: Ruler },
  { title: 'Stock Opname', href: '/stock-opname', icon: ClipboardCheck },
]

const laporanNavItems: NavItem[] = [{ title: 'Rekap', href: '/rekap', icon: ClipboardList }]

const lainnyaNavItems: NavItem[] = [{ title: 'Pengaturan', href: '/settings', icon: Settings }]

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
        <NavMain items={lainnyaNavItems} label="Lainnya" />
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
