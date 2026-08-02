import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { DataGrid } from 'react-data-grid';
import type { Column } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import BonPaymentController from '@/actions/App/Http/Controllers/BonPaymentController';
import SaleController from '@/actions/App/Http/Controllers/SaleController';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAppearance } from '@/hooks/use-appearance';
import { useAvailableHeight } from '@/hooks/use-available-height';
import { useElementWidth } from '@/hooks/use-element-width';
import { formatRupiah } from '@/lib/utils';
import { Receipt } from '@/pages/kasir/shared';
import type { Sale } from '@/pages/kasir/shared';
import { kasir } from '@/routes';
import type { Paginated } from '@/types';

type Filters = {
    dari?: string;
    sampai?: string;
    status?: string;
    metode_pembayaran?: string;
    search?: string;
};

const OTHER_COLUMNS_WIDTH = 60 + 180 + 120 + 140 + 120 + 220;
const MIN_ITEM_WIDTH = 200;

export default function KasirHistory({
    sales,
    filters,
}: {
    sales: Paginated<Sale>;
    filters: Filters;
}) {
    const { resolvedAppearance } = useAppearance();
    const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>();
    const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(56);
    const [search, setSearch] = useState(filters.search ?? '');
    const [dari, setDari] = useState(filters.dari ?? '');
    const [sampai, setSampai] = useState(filters.sampai ?? '');
    const [status, setStatus] = useState(filters.status ?? '');
    const [metode, setMetode] = useState(filters.metode_pembayaran ?? '');
    const [receiptSale, setReceiptSale] = useState<Sale | null>(null);

    function submitFilters(e: FormEvent) {
        e.preventDefault();
        router.get(
            SaleController.history.url(),
            {
                search: search || undefined,
                dari: dari || undefined,
                sampai: sampai || undefined,
                status: status || undefined,
                metode_pembayaran: metode || undefined,
            },
            { preserveState: true },
        );
    }

    function cancelSale(sale: Sale) {
        if (!confirm('Batalkan transaksi ini? Stok akan dikembalikan.')) {
            return;
        }

        router.post(SaleController.cancel.url(sale.id));
    }

    // Print via the browser's own print dialog/spooler - see kasir.tsx for why.
    useEffect(() => {
        if (!receiptSale) {
            return;
        }

        window.print();

        function clearAfterPrint() {
            setReceiptSale(null);
        }

        window.addEventListener('afterprint', clearAfterPrint, {
            once: true,
        });

        return () => window.removeEventListener('afterprint', clearAfterPrint);
    }, [receiptSale]);

    const itemWidth = Math.max(
        MIN_ITEM_WIDTH,
        gridWidth - OTHER_COLUMNS_WIDTH - 2,
    );

    const columns: Column<Sale>[] = [
        {
            key: 'id',
            name: '#',
            width: 60,
            renderCell: ({ row }) => row.id,
        },
        {
            key: 'created_at',
            name: 'Tanggal',
            width: 180,
            renderCell: ({ row }) =>
                new Date(row.created_at).toLocaleString('id-ID'),
        },
        {
            key: 'items',
            name: 'Item',
            width: itemWidth,
            renderCell: ({ row }) =>
                row.items
                    .map((i) => `${i.product.nama_item} x${i.qty}`)
                    .join(', '),
        },
        {
            key: 'metode_pembayaran',
            name: 'Metode',
            width: 120,
            renderCell: ({ row }) =>
                row.metode_pembayaran === 'bon'
                    ? `Bon (${row.nama_pelanggan})`
                    : 'Tunai',
        },
        {
            key: 'status',
            name: 'Status',
            width: 140,
            renderCell: ({ row }) => {
                const sisaPiutang = Number(row.total) - Number(row.dibayar);

                if (row.status === 'dibatalkan') {
                    return (
                        <span className="text-destructive">Dibatalkan</span>
                    );
                }

                if (row.metode_pembayaran === 'bon' && sisaPiutang > 0) {
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
        {
            key: 'aksi',
            name: '',
            width: 220,
            renderCell: ({ row }) => {
                const sisaPiutang = Number(row.total) - Number(row.dibayar);

                return (
                    <div className="flex items-center gap-2">
                        {row.status === 'selesai' && (
                            <>
                                {row.metode_pembayaran === 'bon' &&
                                    sisaPiutang > 0 && (
                                        <Button
                                            asChild
                                            variant="outline"
                                            size="sm"
                                        >
                                            <Link
                                                href={BonPaymentController.show(
                                                    row.id,
                                                )}
                                            >
                                                Bayar Bon
                                            </Link>
                                        </Button>
                                    )}
                                {Number(row.dibayar) === 0 && (
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => cancelSale(row)}
                                    >
                                        Batalkan
                                    </Button>
                                )}
                            </>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setReceiptSale(row)}
                        >
                            Cetak Struk
                        </Button>
                    </div>
                );
            },
        },
    ];

    return (
        <>
            <Head title="Riwayat Transaksi" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <h1 className="text-xl font-semibold">Riwayat Transaksi</h1>

                <form
                    onSubmit={submitFilters}
                    className="flex flex-wrap items-end gap-2"
                >
                    <div className="grid gap-1">
                        <Label className="text-xs">Cari</Label>
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Nama pelanggan / item..."
                            className="w-56"
                        />
                    </div>
                    <div className="grid gap-1">
                        <Label className="text-xs">Dari</Label>
                        <Input
                            type="date"
                            value={dari}
                            onChange={(e) => setDari(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-1">
                        <Label className="text-xs">Sampai</Label>
                        <Input
                            type="date"
                            value={sampai}
                            onChange={(e) => setSampai(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-1">
                        <Label className="text-xs">Status</Label>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="Semua" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="selesai">Selesai</SelectItem>
                                <SelectItem value="dibatalkan">
                                    Dibatalkan
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-1">
                        <Label className="text-xs">Metode</Label>
                        <Select value={metode} onValueChange={setMetode}>
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="Semua" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="tunai">Tunai</SelectItem>
                                <SelectItem value="bon">Bon</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button type="submit" variant="secondary">
                        Filter
                    </Button>
                    <Button type="button" variant="outline" asChild>
                        <a href={kasir().url}>Ke Kasir</a>
                    </Button>
                </form>

                <div
                    ref={(node) => {
                        widthRef(node);
                        heightRef(node);
                    }}
                >
                    {gridWidth > 0 && (
                        <DataGrid
                            className={
                                resolvedAppearance === 'dark'
                                    ? 'rdg-dark'
                                    : 'rdg-light'
                            }
                            columns={columns}
                            rows={sales.data}
                            rowKeyGetter={(row) => row.id}
                            renderers={{
                                noRowsFallback: (
                                    <div className="col-span-full p-6 text-center text-sm text-muted-foreground">
                                        Tidak ada transaksi.
                                    </div>
                                ),
                            }}
                            style={{
                                blockSize: gridHeight,
                                minHeight: 300,
                            }}
                        />
                    )}
                </div>

                <div className="flex flex-wrap gap-1">
                    {sales.links.map((link, index) => (
                        <Button
                            key={index}
                            variant={link.active ? 'default' : 'outline'}
                            size="sm"
                            disabled={!link.url}
                            onClick={() => link.url && router.get(link.url)}
                            dangerouslySetInnerHTML={{ __html: link.label }}
                        />
                    ))}
                </div>
            </div>

            {receiptSale && <Receipt sale={receiptSale} />}
        </>
    );
}

KasirHistory.layout = {
    breadcrumbs: [
        { title: 'Kasir', href: kasir() },
        { title: 'Riwayat Transaksi', href: SaleController.history() },
    ],
};
