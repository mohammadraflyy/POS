import {
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutGrid,
  PackagePlus,
  Receipt,
  Ruler,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
} from 'lucide-react'
import { AppLogo } from './app-logo'
import { NavMain } from './nav-main'
import { NavUser } from './nav-user'
import { TITLE_BAR_HEIGHT } from './title-bar'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar'
import type { AuthUser, NavItem } from '../types'

const overviewNavItems: NavItem[] = [{ title: 'Dashboard', href: '/', icon: LayoutGrid }]

const penjualanNavItems: NavItem[] = [
  { title: 'Penjualan', href: '/kasir', icon: ShoppingCart },
  { title: 'Riwayat Transaksi', href: '/history', icon: History },
]

const pembelianNavItems: NavItem[] = [
  { title: 'Pembelian', href: '/purchase', icon: PackagePlus },
  { title: 'Hutang Supplier', href: '/hutang-supplier', icon: Receipt },
  { title: 'Supplier', href: '/supplier', icon: Building2 },
  { title: 'Katalog Produk', href: '/inventory', icon: Boxes },
  { title: 'Master Satuan', href: '/master-satuan', icon: Ruler },
  { title: 'Stock Opname', href: '/stock-opname', icon: ClipboardCheck },
]

const laporanNavItems: NavItem[] = [{ title: 'Rekap', href: '/rekap', icon: ClipboardList }]

const kasNavItems: NavItem[] = [{ title: 'Pengeluaran', href: '/pengeluaran', icon: Wallet }]

const lainnyaNavItems: NavItem[] = [{ title: 'Pengaturan', href: '/settings', icon: Settings }]

const adminNavItems: NavItem[] = [{ title: 'Pengguna', href: '/users', icon: Users }]

export function AppSidebar({ storeName, user }: { storeName: string; user: AuthUser }) {
  return (
    // The sidebar is fixed to the viewport, so it has to be pushed below the
    // title bar row by hand instead of flowing after it.
    <Sidebar
      collapsible="icon"
      variant="inset"
      style={{ top: TITLE_BAR_HEIGHT, height: `calc(100svh - ${TITLE_BAR_HEIGHT}px)` }}
    >
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <AppLogo name={storeName} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={overviewNavItems} label="Ringkasan" />
        <NavMain items={penjualanNavItems} label="Penjualan" />
        <NavMain items={pembelianNavItems} label="Pembelian & Stok" />
        <NavMain items={kasNavItems} label="Kas" />
        {/* the rekap IPC handlers reject non-admins outright; hiding the link keeps
            a kasir from walking into a page that can only show an error */}
        {user.role === 'admin' && <NavMain items={laporanNavItems} label="Laporan" />}
        <NavMain items={lainnyaNavItems} label="Lainnya" />
        {user.role === 'admin' && <NavMain items={adminNavItems} label="Admin" />}
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
