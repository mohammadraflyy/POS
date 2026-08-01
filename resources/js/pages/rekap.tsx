import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRupiah } from '@/lib/utils';
import { rekap } from '@/routes';

type Summary = {
    omzet_tunai: number;
    piutang_beredar: number;
    jumlah_transaksi: number;
    laba_kotor: number;
};

type ProdukTerlaris = {
    nama_item: string;
    qty_terjual: number;
    total_penjualan: string;
};

type PembelianPerSupplier = {
    nama: string;
    total_pembelian: string;
};

type LabaPerKategori = {
    nama: string;
    omzet: string;
    laba: string;
};

type LabaPerHari = {
    tanggal: string;
    omzet: string;
    laba: string;
};

export default function Rekap({
    filters,
    summary,
    produkTerlaris,
    pembelianPerSupplier,
    labaPerKategori,
    labaPerHari,
}: {
    filters: { from: string; to: string };
    summary: Summary;
    produkTerlaris: ProdukTerlaris[];
    pembelianPerSupplier: PembelianPerSupplier[];
    labaPerKategori: LabaPerKategori[];
    labaPerHari: LabaPerHari[];
}) {
    const [from, setFrom] = useState(filters.from);
    const [to, setTo] = useState(filters.to);

    function submitFilter(e: FormEvent) {
        e.preventDefault();
        router.get(rekap().url, { from, to }, { preserveState: true });
    }

    return (
        <>
            <Head title="Rekap" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <form
                    onSubmit={submitFilter}
                    className="flex flex-wrap items-end gap-2"
                >
                    <div className="grid gap-2">
                        <Label htmlFor="from">Dari</Label>
                        <Input
                            id="from"
                            type="date"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="to">Sampai</Label>
                        <Input
                            id="to"
                            type="date"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                        />
                    </div>
                    <Button type="submit">Terapkan</Button>
                </form>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader>
                            <CardDescription>Omzet Tunai</CardDescription>
                            <CardTitle className="text-2xl">
                                {formatRupiah(summary.omzet_tunai)}
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
                    <Card>
                        <CardHeader>
                            <CardDescription>Jumlah Transaksi</CardDescription>
                            <CardTitle className="text-2xl">
                                {summary.jumlah_transaksi}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardDescription>Laba Kotor</CardDescription>
                            <CardTitle className="text-2xl">
                                {formatRupiah(summary.laba_kotor)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                        <h2 className="font-semibold">Produk Terlaris</h2>
                        <div className="overflow-x-auto rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-left">
                                    <tr>
                                        <th className="p-3">Produk</th>
                                        <th className="p-3 text-right">
                                            Qty Terjual
                                        </th>
                                        <th className="p-3 text-right">
                                            Total Penjualan
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {produkTerlaris.map((row, index) => (
                                        <tr
                                            key={index}
                                            className="border-t border-sidebar-border/70 dark:border-sidebar-border"
                                        >
                                            <td className="p-3">
                                                {row.nama_item}
                                            </td>
                                            <td className="p-3 text-right">
                                                {row.qty_terjual}
                                            </td>
                                            <td className="p-3 text-right">
                                                {formatRupiah(
                                                    row.total_penjualan,
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {produkTerlaris.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={3}
                                                className="p-6 text-center text-muted-foreground"
                                            >
                                                Belum ada penjualan.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h2 className="font-semibold">
                            Pembelian per Supplier
                        </h2>
                        <div className="overflow-x-auto rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-left">
                                    <tr>
                                        <th className="p-3">Supplier</th>
                                        <th className="p-3 text-right">
                                            Total Pembelian
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pembelianPerSupplier.map((row, index) => (
                                        <tr
                                            key={index}
                                            className="border-t border-sidebar-border/70 dark:border-sidebar-border"
                                        >
                                            <td className="p-3">{row.nama}</td>
                                            <td className="p-3 text-right">
                                                {formatRupiah(
                                                    row.total_pembelian,
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {pembelianPerSupplier.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={2}
                                                className="p-6 text-center text-muted-foreground"
                                            >
                                                Belum ada pembelian.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                        <h2 className="font-semibold">Laba per Kategori</h2>
                        <div className="overflow-x-auto rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-left">
                                    <tr>
                                        <th className="p-3">Kategori</th>
                                        <th className="p-3 text-right">
                                            Omzet
                                        </th>
                                        <th className="p-3 text-right">Laba</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {labaPerKategori.map((row, index) => (
                                        <tr
                                            key={index}
                                            className="border-t border-sidebar-border/70 dark:border-sidebar-border"
                                        >
                                            <td className="p-3">{row.nama}</td>
                                            <td className="p-3 text-right">
                                                {formatRupiah(row.omzet)}
                                            </td>
                                            <td className="p-3 text-right">
                                                {formatRupiah(row.laba)}
                                            </td>
                                        </tr>
                                    ))}
                                    {labaPerKategori.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={3}
                                                className="p-6 text-center text-muted-foreground"
                                            >
                                                Belum ada penjualan.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h2 className="font-semibold">Laba per Hari</h2>
                        <div className="overflow-x-auto rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-left">
                                    <tr>
                                        <th className="p-3">Tanggal</th>
                                        <th className="p-3 text-right">
                                            Omzet
                                        </th>
                                        <th className="p-3 text-right">Laba</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {labaPerHari.map((row, index) => (
                                        <tr
                                            key={index}
                                            className="border-t border-sidebar-border/70 dark:border-sidebar-border"
                                        >
                                            <td className="p-3">
                                                {new Date(
                                                    row.tanggal,
                                                ).toLocaleDateString('id-ID')}
                                            </td>
                                            <td className="p-3 text-right">
                                                {formatRupiah(row.omzet)}
                                            </td>
                                            <td className="p-3 text-right">
                                                {formatRupiah(row.laba)}
                                            </td>
                                        </tr>
                                    ))}
                                    {labaPerHari.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={3}
                                                className="p-6 text-center text-muted-foreground"
                                            >
                                                Belum ada penjualan.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

Rekap.layout = {
    breadcrumbs: [{ title: 'Rekap', href: rekap() }],
};
