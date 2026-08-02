import { Head, Link } from '@inertiajs/react';
import { TriangleAlert } from 'lucide-react';
import SaleController from '@/actions/App/Http/Controllers/SaleController';
import { numberCell, ReportTable } from '@/components/report-table';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { formatRupiah } from '@/lib/utils';
import { dashboard, inventory, rekap } from '@/routes';

type Summary = {
    omzet_hari_ini: number;
    jumlah_transaksi_hari_ini: number;
    laba_hari_ini: number;
    piutang_beredar: number;
};

type StokMenipis = {
    id: number;
    kode_item: string;
    nama_item: string;
    satuan: string;
    stok: number;
};

type ProdukTerlaris = {
    nama_item: string;
    qty_terjual: number;
    total_penjualan: string;
};

type Transaksi = {
    id: number;
    nama_pelanggan: string | null;
    metode_pembayaran: 'tunai' | 'bon';
    status: 'selesai' | 'dibatalkan';
    total: string;
    dibayar: string;
    created_at: string;
    items: { qty: number; product: { nama_item: string } }[];
};

export default function Dashboard({
    summary,
    stokMenipis,
    produkTerlarisHariIni,
    transaksiTerbaru,
}: {
    summary: Summary;
    stokMenipis: StokMenipis[];
    produkTerlarisHariIni: ProdukTerlaris[];
    transaksiTerbaru: Transaksi[];
}) {
    return (
        <>
            <Head title="Dashboard" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h1 className="text-xl font-semibold">Dashboard</h1>
                    <Button asChild variant="outline" size="sm">
                        <Link href={rekap()}>Lihat Rekap Lengkap</Link>
                    </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader>
                            <CardDescription>Omzet Hari Ini</CardDescription>
                            <CardTitle className="text-2xl">
                                {formatRupiah(summary.omzet_hari_ini)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardDescription>
                                Transaksi Hari Ini
                            </CardDescription>
                            <CardTitle className="text-2xl">
                                {summary.jumlah_transaksi_hari_ini}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardDescription>Laba Hari Ini</CardDescription>
                            <CardTitle className="text-2xl">
                                {formatRupiah(summary.laba_hari_ini)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardDescription>
                                Piutang Bon Beredar
                            </CardDescription>
                            <CardTitle className="text-2xl">
                                {formatRupiah(summary.piutang_beredar)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                    <ReportTable<StokMenipis>
                        title="Stok Menipis"
                        rows={stokMenipis}
                        rowKey={(row) => row.id}
                        emptyMessage="Semua stok aman."
                        action={
                            <Link
                                href={inventory()}
                                className="text-xs text-muted-foreground hover:underline"
                            >
                                Lihat semua
                            </Link>
                        }
                        columns={[
                            { key: 'kode_item', name: 'Kode', width: 90 },
                            { key: 'nama_item', name: 'Produk' },
                            {
                                key: 'stok',
                                name: 'Stok',
                                width: 100,
                                renderCell: ({ row }) => (
                                    <span className="flex w-full items-center justify-end gap-1 text-right">
                                        {row.stok <= 0 && (
                                            <TriangleAlert className="size-3.5 text-destructive" />
                                        )}
                                        {row.stok} {row.satuan}
                                    </span>
                                ),
                            },
                        ]}
                    />

                    <ReportTable<ProdukTerlaris>
                        title="Produk Terlaris Hari Ini"
                        rows={produkTerlarisHariIni}
                        rowKey={(row) => row.nama_item}
                        emptyMessage="Belum ada penjualan hari ini."
                        columns={[
                            { key: 'nama_item', name: 'Produk' },
                            {
                                key: 'qty_terjual',
                                name: 'Qty',
                                width: 80,
                                renderCell: numberCell,
                            },
                            {
                                key: 'total_penjualan',
                                name: 'Total',
                                width: 130,
                                renderCell: ({ row }) => (
                                    <span className="w-full text-right">
                                        {formatRupiah(row.total_penjualan)}
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>

                <ReportTable<Transaksi>
                    title="Transaksi Terbaru"
                    rows={transaksiTerbaru}
                    rowKey={(row) => row.id}
                    emptyMessage="Belum ada transaksi."
                    action={
                        <Link
                            href={SaleController.history()}
                            className="text-xs text-muted-foreground hover:underline"
                        >
                            Lihat semua
                        </Link>
                    }
                    columns={[
                        {
                            key: 'created_at',
                            name: 'Waktu',
                            width: 160,
                            renderCell: ({ row }) =>
                                new Date(row.created_at).toLocaleString(
                                    'id-ID',
                                ),
                        },
                        {
                            key: 'items',
                            name: 'Item',
                            renderCell: ({ row }) =>
                                row.items
                                    .map(
                                        (i) =>
                                            `${i.product.nama_item} x${i.qty}`,
                                    )
                                    .join(', '),
                        },
                        {
                            key: 'metode_pembayaran',
                            name: 'Metode',
                            width: 110,
                            renderCell: ({ row }) =>
                                row.metode_pembayaran === 'bon'
                                    ? `Bon (${row.nama_pelanggan})`
                                    : 'Tunai',
                        },
                        {
                            key: 'status',
                            name: 'Status',
                            width: 130,
                            renderCell: ({ row }) => {
                                if (row.status === 'dibatalkan') {
                                    return (
                                        <span className="text-destructive">
                                            Dibatalkan
                                        </span>
                                    );
                                }

                                const sisaPiutang =
                                    Number(row.total) - Number(row.dibayar);

                                if (
                                    row.metode_pembayaran === 'bon' &&
                                    sisaPiutang > 0
                                ) {
                                    return (
                                        <span className="text-amber-600 dark:text-amber-400">
                                            Sisa {formatRupiah(sisaPiutang)}
                                        </span>
                                    );
                                }

                                return (
                                    <span className="text-green-600 dark:text-green-400">
                                        Lunas
                                    </span>
                                );
                            },
                        },
                        {
                            key: 'total',
                            name: 'Total',
                            width: 120,
                            renderCell: ({ row }) => (
                                <span className="w-full text-right">
                                    {formatRupiah(row.total)}
                                </span>
                            ),
                        },
                    ]}
                />
            </div>
        </>
    );
}

Dashboard.layout = {
    breadcrumbs: [
        {
            title: 'Dashboard',
            href: dashboard(),
        },
    ],
};
