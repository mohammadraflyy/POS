import { Head, Link, router } from '@inertiajs/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import BonPaymentController from '@/actions/App/Http/Controllers/BonPaymentController';
import SaleController from '@/actions/App/Http/Controllers/SaleController';
import InputError from '@/components/input-error';
import { ReportTable } from '@/components/report-table';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatRupiah } from '@/lib/utils';
import { kasir } from '@/routes';

type BonPaymentRow = {
    id: number;
    jumlah: string;
    tanggal: string;
    keterangan: string | null;
};

type SaleDetail = {
    id: number;
    nama_pelanggan: string | null;
    metode_pembayaran: 'tunai' | 'bon';
    status: 'selesai' | 'dibatalkan';
    total: string;
    dibayar: string;
    created_at: string;
    items: {
        id: number;
        qty: number;
        satuan: string;
        product: { nama_item: string };
    }[];
    bon_payments: BonPaymentRow[];
};

export default function BonPayment({ sale }: { sale: SaleDetail }) {
    const [jumlah, setJumlah] = useState('');
    const [keterangan, setKeterangan] = useState('');
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const sisaPiutang = Number(sale.total) - Number(sale.dibayar);
    const isLunas = sisaPiutang <= 0;
    const canPay = sale.status === 'selesai' && !isLunas;

    function submit(e: FormEvent) {
        e.preventDefault();
        setProcessing(true);
        router.post(
            BonPaymentController.store.url(sale.id),
            { jumlah, keterangan: keterangan || null },
            {
                onSuccess: () => {
                    setJumlah('');
                    setKeterangan('');
                },
                onError: (e) => setErrors(e as Record<string, string>),
                onFinish: () => setProcessing(false),
            },
        );
    }

    return (
        <>
            <Head title={`Bayar Bon #${sale.id}`} />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h1 className="text-xl font-semibold">
                            Bayar Bon &mdash;{' '}
                            {sale.nama_pelanggan ?? `Struk #${sale.id}`}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {sale.items
                                .map(
                                    (i) =>
                                        `${i.product.nama_item} x${i.qty}`,
                                )
                                .join(', ')}{' '}
                            &middot;{' '}
                            {new Date(sale.created_at).toLocaleString(
                                'id-ID',
                            )}
                        </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                        <Link href={SaleController.history()}>Kembali</Link>
                    </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                    <Card>
                        <CardHeader>
                            <CardDescription>Total Transaksi</CardDescription>
                            <CardTitle className="text-2xl">
                                {formatRupiah(sale.total)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardDescription>Sudah Dibayar</CardDescription>
                            <CardTitle className="text-2xl">
                                {formatRupiah(sale.dibayar)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardDescription>Sisa Piutang</CardDescription>
                            <CardTitle
                                className={cn(
                                    'text-2xl',
                                    isLunas
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-amber-600 dark:text-amber-400',
                                )}
                            >
                                {formatRupiah(Math.max(sisaPiutang, 0))}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                </div>

                {canPay && (
                    <form
                        onSubmit={submit}
                        className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/30 p-4"
                    >
                        <div className="grid gap-1">
                            <Label htmlFor="jumlah">Jumlah Bayar</Label>
                            <Input
                                id="jumlah"
                                type="number"
                                autoFocus
                                value={jumlah}
                                onChange={(e) => setJumlah(e.target.value)}
                                className="w-40"
                            />
                            <InputError message={errors.jumlah} />
                        </div>
                        <div className="grid gap-1">
                            <Label htmlFor="keterangan">
                                Keterangan (opsional)
                            </Label>
                            <Input
                                id="keterangan"
                                value={keterangan}
                                onChange={(e) =>
                                    setKeterangan(e.target.value)
                                }
                                className="w-64"
                            />
                            <InputError message={errors.keterangan} />
                        </div>
                        <Button type="submit" disabled={processing}>
                            Simpan Pembayaran
                        </Button>
                    </form>
                )}

                {!canPay && sale.status === 'selesai' && (
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">
                        Bon ini sudah lunas.
                    </p>
                )}

                <ReportTable<BonPaymentRow>
                    title="Riwayat Pembayaran"
                    rows={sale.bon_payments}
                    rowKey={(row) => row.id}
                    emptyMessage="Belum ada pembayaran."
                    columns={[
                        {
                            key: 'tanggal',
                            name: 'Tanggal',
                            width: 140,
                            renderCell: ({ row }) =>
                                new Date(row.tanggal).toLocaleDateString(
                                    'id-ID',
                                ),
                        },
                        {
                            key: 'jumlah',
                            name: 'Jumlah',
                            width: 150,
                            renderCell: ({ row }) => (
                                <span className="w-full text-right">
                                    {formatRupiah(row.jumlah)}
                                </span>
                            ),
                        },
                        {
                            key: 'keterangan',
                            name: 'Keterangan',
                            renderCell: ({ row }) => row.keterangan ?? '-',
                        },
                    ]}
                />
            </div>
        </>
    );
}

BonPayment.layout = {
    breadcrumbs: [
        { title: 'Kasir', href: kasir() },
        { title: 'Riwayat Transaksi', href: SaleController.history() },
    ],
};
