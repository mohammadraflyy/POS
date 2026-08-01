import { Head, router } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import BonPaymentController from '@/actions/App/Http/Controllers/BonPaymentController';
import SaleController from '@/actions/App/Http/Controllers/SaleController';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
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

export default function KasirHistory({
    sales,
    filters,
}: {
    sales: Paginated<Sale>;
    filters: Filters;
}) {
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

                <div className="overflow-x-auto rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left">
                            <tr>
                                <th className="p-3">#</th>
                                <th className="p-3">Tanggal</th>
                                <th className="p-3">Item</th>
                                <th className="p-3">Metode</th>
                                <th className="p-3">Status</th>
                                <th className="p-3 text-right">Total</th>
                                <th className="p-3">Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sales.data.map((sale) => {
                                const sisaPiutang =
                                    Number(sale.total) - Number(sale.dibayar);

                                return (
                                    <tr
                                        key={sale.id}
                                        className="border-t border-sidebar-border/70 dark:border-sidebar-border"
                                    >
                                        <td className="p-3">{sale.id}</td>
                                        <td className="p-3">
                                            {new Date(
                                                sale.created_at,
                                            ).toLocaleString('id-ID')}
                                        </td>
                                        <td className="p-3">
                                            {sale.items
                                                .map(
                                                    (i) =>
                                                        `${i.product.nama_item} x${i.qty}`,
                                                )
                                                .join(', ')}
                                        </td>
                                        <td className="p-3">
                                            {sale.metode_pembayaran === 'bon'
                                                ? `Bon (${sale.nama_pelanggan})`
                                                : 'Tunai'}
                                        </td>
                                        <td className="p-3">
                                            {sale.status === 'dibatalkan' ? (
                                                <span className="text-destructive">
                                                    Dibatalkan
                                                </span>
                                            ) : sale.metode_pembayaran ===
                                                  'bon' && sisaPiutang > 0 ? (
                                                <span className="text-amber-600 dark:text-amber-400">
                                                    Sisa{' '}
                                                    {formatRupiah(sisaPiutang)}
                                                </span>
                                            ) : (
                                                <span className="text-green-600 dark:text-green-400">
                                                    Lunas
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 text-right">
                                            {formatRupiah(sale.total)}
                                        </td>
                                        <td className="p-3">
                                            <div className="flex gap-2">
                                                {sale.status === 'selesai' && (
                                                    <>
                                                        {sale.metode_pembayaran ===
                                                            'bon' &&
                                                            sisaPiutang > 0 && (
                                                                <BonPaymentDialog
                                                                    sale={sale}
                                                                    sisaPiutang={
                                                                        sisaPiutang
                                                                    }
                                                                />
                                                            )}
                                                        {Number(
                                                            sale.dibayar,
                                                        ) === 0 && (
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                                onClick={() =>
                                                                    cancelSale(
                                                                        sale,
                                                                    )
                                                                }
                                                            >
                                                                Batalkan
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        setReceiptSale(sale)
                                                    }
                                                >
                                                    Cetak Struk
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {sales.data.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="p-6 text-center text-muted-foreground"
                                    >
                                        Tidak ada transaksi.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
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

function BonPaymentDialog({
    sale,
    sisaPiutang,
}: {
    sale: Sale;
    sisaPiutang: number;
}) {
    const [open, setOpen] = useState(false);
    const [jumlah, setJumlah] = useState('');
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    function submit(e: FormEvent) {
        e.preventDefault();
        setProcessing(true);
        router.post(
            BonPaymentController.store.url(sale.id),
            { jumlah },
            {
                onSuccess: () => {
                    setOpen(false);
                    setJumlah('');
                },
                onError: (e) => setErrors(e as Record<string, string>),
                onFinish: () => setProcessing(false),
            },
        );
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    Bayar Bon
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Bayar Bon - Sisa {formatRupiah(sisaPiutang)}
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="jumlah">Jumlah Bayar</Label>
                        <Input
                            id="jumlah"
                            type="number"
                            value={jumlah}
                            onChange={(e) => setJumlah(e.target.value)}
                        />
                        <InputError message={errors.jumlah} />
                    </div>
                    <Button type="submit" disabled={processing}>
                        Simpan
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}

KasirHistory.layout = {
    breadcrumbs: [
        { title: 'Kasir', href: kasir() },
        { title: 'Riwayat Transaksi', href: SaleController.history() },
    ],
};
