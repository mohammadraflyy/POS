import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { numberCell, ReportTable } from '@/components/report-table';
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
                    <ReportTable<ProdukTerlaris>
                        title="Produk Terlaris"
                        rows={produkTerlaris}
                        rowKey={(row) => row.nama_item}
                        emptyMessage="Belum ada penjualan."
                        columns={[
                            { key: 'nama_item', name: 'Produk' },
                            {
                                key: 'qty_terjual',
                                name: 'Qty Terjual',
                                width: 110,
                                renderCell: numberCell,
                            },
                            {
                                key: 'total_penjualan',
                                name: 'Total Penjualan',
                                width: 150,
                                renderCell: ({ row }) => (
                                    <span className="w-full text-right">
                                        {formatRupiah(row.total_penjualan)}
                                    </span>
                                ),
                            },
                        ]}
                    />

                    <ReportTable<PembelianPerSupplier>
                        title="Pembelian per Supplier"
                        rows={pembelianPerSupplier}
                        rowKey={(row) => row.nama}
                        emptyMessage="Belum ada pembelian."
                        columns={[
                            { key: 'nama', name: 'Supplier' },
                            {
                                key: 'total_pembelian',
                                name: 'Total Pembelian',
                                width: 150,
                                renderCell: ({ row }) => (
                                    <span className="w-full text-right">
                                        {formatRupiah(row.total_pembelian)}
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                    <ReportTable<LabaPerKategori>
                        title="Laba per Kategori"
                        rows={labaPerKategori}
                        rowKey={(row) => row.nama}
                        emptyMessage="Belum ada penjualan."
                        columns={[
                            { key: 'nama', name: 'Kategori' },
                            {
                                key: 'omzet',
                                name: 'Omzet',
                                width: 130,
                                renderCell: ({ row }) => (
                                    <span className="w-full text-right">
                                        {formatRupiah(row.omzet)}
                                    </span>
                                ),
                            },
                            {
                                key: 'laba',
                                name: 'Laba',
                                width: 130,
                                renderCell: ({ row }) => (
                                    <span className="w-full text-right">
                                        {formatRupiah(row.laba)}
                                    </span>
                                ),
                            },
                        ]}
                    />

                    <ReportTable<LabaPerHari>
                        title="Laba per Hari"
                        rows={labaPerHari}
                        rowKey={(row) => row.tanggal}
                        emptyMessage="Belum ada penjualan."
                        columns={[
                            {
                                key: 'tanggal',
                                name: 'Tanggal',
                                renderCell: ({ row }) =>
                                    new Date(row.tanggal).toLocaleDateString(
                                        'id-ID',
                                    ),
                            },
                            {
                                key: 'omzet',
                                name: 'Omzet',
                                width: 130,
                                renderCell: ({ row }) => (
                                    <span className="w-full text-right">
                                        {formatRupiah(row.omzet)}
                                    </span>
                                ),
                            },
                            {
                                key: 'laba',
                                name: 'Laba',
                                width: 130,
                                renderCell: ({ row }) => (
                                    <span className="w-full text-right">
                                        {formatRupiah(row.laba)}
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>
        </>
    );
}

Rekap.layout = {
    breadcrumbs: [{ title: 'Rekap', href: rekap() }],
};
