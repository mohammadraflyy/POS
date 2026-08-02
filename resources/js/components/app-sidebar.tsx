import { Link } from '@inertiajs/react';
import { BookOpen, Boxes, ClipboardCheck, ClipboardList, FolderGit2, History, LayoutGrid, PackagePlus, ShoppingCart } from 'lucide-react';
import SaleController from '@/actions/App/Http/Controllers/SaleController';
import AppLogo from '@/components/app-logo';
import { NavFooter } from '@/components/nav-footer';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { dashboard, inventory, kasir, purchase, rekap, stockOpname } from '@/routes';
import type { NavItem } from '@/types';

const overviewNavItems: NavItem[] = [
    {
        title: 'Dashboard',
        href: dashboard(),
        icon: LayoutGrid,
    },
];

const penjualanNavItems: NavItem[] = [
    {
        title: 'Penjualan',
        href: kasir(),
        icon: ShoppingCart,
    },
    {
        title: 'Riwayat Transaksi',
        href: SaleController.history(),
        icon: History,
    },
];

const pembelianNavItems: NavItem[] = [
    {
        title: 'Pembelian',
        href: purchase(),
        icon: PackagePlus,
    },
    {
        title: 'Katalog Produk',
        href: inventory(),
        icon: Boxes,
    },
    {
        title: 'Stock Opname',
        href: stockOpname(),
        icon: ClipboardCheck,
    },
];

const laporanNavItems: NavItem[] = [
    {
        title: 'Rekap',
        href: rekap(),
        icon: ClipboardList,
    },
];

const footerNavItems: NavItem[] = [
    {
        title: 'Repository',
        href: 'https://github.com/laravel/react-starter-kit',
        icon: FolderGit2,
    },
    {
        title: 'Documentation',
        href: 'https://laravel.com/docs/starter-kits#react',
        icon: BookOpen,
    },
];

export function AppSidebar() {
    return (
        <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href={dashboard()} prefetch>
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <NavMain items={overviewNavItems} label="Ringkasan" />
                <NavMain items={penjualanNavItems} label="Penjualan" />
                <NavMain items={pembelianNavItems} label="Pembelian & Stok" />
                <NavMain items={laporanNavItems} label="Laporan" />
            </SidebarContent>

            <SidebarFooter>
                <NavFooter items={footerNavItems} className="mt-auto" />
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
