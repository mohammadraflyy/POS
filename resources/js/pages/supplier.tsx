import { Head, router, useForm } from '@inertiajs/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import SupplierController from '@/actions/App/Http/Controllers/SupplierController';
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
import { supplier as supplierRoute } from '@/routes';
import type { Paginated } from '@/types';

type Supplier = {
    id: number;
    nama: string;
    telepon: string | null;
    alamat: string | null;
    keterangan: string | null;
    purchases_count: number;
};

export default function Supplier({
    suppliers,
    filters,
}: {
    suppliers: Paginated<Supplier>;
    filters: { search?: string };
}) {
    const [search, setSearch] = useState(filters.search ?? '');

    function submitSearch(e: FormEvent) {
        e.preventDefault();
        router.get(supplierRoute().url, { search }, { preserveState: true });
    }

    function destroy(supplier: Supplier) {
        if (!confirm(`Hapus supplier "${supplier.nama}"?`)) {
            return;
        }

        router.delete(SupplierController.destroy.url(supplier.id));
    }

    return (
        <>
            <Head title="Supplier" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <form onSubmit={submitSearch} className="flex gap-2">
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Cari nama supplier..."
                            className="w-64"
                        />
                        <Button type="submit" variant="secondary">
                            Cari
                        </Button>
                    </form>
                    <div className="flex gap-2">
                        <SupplierFormDialog />
                    </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left">
                            <tr>
                                <th className="p-3">Nama</th>
                                <th className="p-3">Telepon</th>
                                <th className="p-3">Alamat</th>
                                <th className="p-3 text-right">
                                    Jumlah Pembelian
                                </th>
                                <th className="p-3">Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {suppliers.data.map((supplier) => (
                                <tr
                                    key={supplier.id}
                                    className="border-t border-sidebar-border/70 dark:border-sidebar-border"
                                >
                                    <td className="p-3">{supplier.nama}</td>
                                    <td className="p-3">
                                        {supplier.telepon ?? '-'}
                                    </td>
                                    <td className="p-3">
                                        {supplier.alamat ?? '-'}
                                    </td>
                                    <td className="p-3 text-right">
                                        {supplier.purchases_count}
                                    </td>
                                    <td className="p-3">
                                        <div className="flex gap-2">
                                            <SupplierFormDialog
                                                supplier={supplier}
                                            />
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() =>
                                                    destroy(supplier)
                                                }
                                            >
                                                Hapus
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {suppliers.data.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="p-6 text-center text-muted-foreground"
                                    >
                                        Belum ada supplier.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-wrap gap-1">
                    {suppliers.links.map((link, index) => (
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
        </>
    );
}

function SupplierFormDialog({ supplier }: { supplier?: Supplier }) {
    const [open, setOpen] = useState(false);
    const isEdit = !!supplier;
    const { data, setData, post, put, processing, errors, reset } = useForm({
        nama: supplier?.nama ?? '',
        telepon: supplier?.telepon ?? '',
        alamat: supplier?.alamat ?? '',
        keterangan: supplier?.keterangan ?? '',
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        const options = {
            onSuccess: () => {
                setOpen(false);
                reset();
            },
        };

        if (isEdit) {
            put(SupplierController.update.url(supplier.id), options);
        } else {
            post(SupplierController.store.url(), options);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant={isEdit ? 'outline' : 'default'} size="sm">
                    {isEdit ? 'Edit' : 'Tambah Supplier'}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? 'Edit Supplier' : 'Tambah Supplier'}
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="nama">Nama</Label>
                        <Input
                            id="nama"
                            value={data.nama}
                            onChange={(e) => setData('nama', e.target.value)}
                        />
                        <InputError message={errors.nama} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="telepon">Telepon</Label>
                        <Input
                            id="telepon"
                            value={data.telepon}
                            onChange={(e) => setData('telepon', e.target.value)}
                        />
                        <InputError message={errors.telepon} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="alamat">Alamat</Label>
                        <Input
                            id="alamat"
                            value={data.alamat}
                            onChange={(e) => setData('alamat', e.target.value)}
                        />
                        <InputError message={errors.alamat} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="keterangan">Keterangan</Label>
                        <Input
                            id="keterangan"
                            value={data.keterangan}
                            onChange={(e) =>
                                setData('keterangan', e.target.value)
                            }
                        />
                        <InputError message={errors.keterangan} />
                    </div>
                    <Button type="submit" disabled={processing}>
                        Simpan
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}

Supplier.layout = {
    breadcrumbs: [{ title: 'Supplier', href: supplierRoute() }],
};
