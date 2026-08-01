import { Head, router, useForm } from '@inertiajs/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import CategoryController from '@/actions/App/Http/Controllers/CategoryController';
import ProductController from '@/actions/App/Http/Controllers/ProductController';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
    ProductPriceTiersManager,
    ProductUnitsManager,
} from '@/pages/inventory/shared';
import type { Category, Product } from '@/pages/inventory/shared';
import { inventory } from '@/routes';
import type { Paginated } from '@/types';

export default function Inventory({
    products,
    filters,
    categories,
}: {
    products: Paginated<Product>;
    filters: { search?: string };
    categories: Category[];
}) {
    const [search, setSearch] = useState(filters.search ?? '');
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    function submitSearch(e: FormEvent) {
        e.preventDefault();
        router.get(inventory().url, { search }, { preserveState: true });
    }

    function toggleSelected(id: number, checked: boolean) {
        setSelectedIds((prev) => {
            const next = new Set(prev);

            if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }

            return next;
        });
    }

    const allSelected =
        products.data.length > 0 &&
        products.data.every((product) => selectedIds.has(product.id));
    const someSelected = products.data.some((product) =>
        selectedIds.has(product.id),
    );

    return (
        <>
            <Head title="Inventory" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <form onSubmit={submitSearch} className="flex gap-2">
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Cari kode / nama produk..."
                            className="w-64"
                        />
                        <Button type="submit" variant="secondary">
                            Cari
                        </Button>
                    </form>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!someSelected}
                            onClick={() =>
                                router.get(
                                    ProductController.massInput.url({
                                        query: {
                                            ids: [...selectedIds].join(','),
                                        },
                                    }),
                                )
                            }
                        >
                            Mass Edit ({selectedIds.size})
                        </Button>
                        <Button
                            type="button"
                            onClick={() =>
                                router.get(ProductController.massInput.url())
                            }
                        >
                            Tambah Produk
                        </Button>
                    </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left">
                            <tr>
                                <th className="w-10 p-3">
                                    <Checkbox
                                        checked={
                                            allSelected
                                                ? true
                                                : someSelected
                                                  ? 'indeterminate'
                                                  : false
                                        }
                                        onCheckedChange={(checked) =>
                                            setSelectedIds(
                                                checked
                                                    ? new Set(
                                                          products.data.map(
                                                              (p) => p.id,
                                                          ),
                                                      )
                                                    : new Set(),
                                            )
                                        }
                                        aria-label="Pilih semua"
                                    />
                                </th>
                                <th className="p-3">Kode</th>
                                <th className="p-3">Barcode</th>
                                <th className="p-3">Nama</th>
                                <th className="p-3">Kategori</th>
                                <th className="p-3">Satuan</th>
                                <th className="p-3 text-right">Harga Pokok</th>
                                <th className="p-3 text-right">Harga Jual</th>
                                <th className="p-3 text-right">Stok</th>
                                <th className="p-3">Status</th>
                                <th className="p-3">Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.data.map((product) => (
                                <tr
                                    key={product.id}
                                    className="border-t border-sidebar-border/70 dark:border-sidebar-border"
                                >
                                    <td className="p-3">
                                        <Checkbox
                                            checked={selectedIds.has(
                                                product.id,
                                            )}
                                            onCheckedChange={(checked) =>
                                                toggleSelected(
                                                    product.id,
                                                    checked === true,
                                                )
                                            }
                                            aria-label={`Pilih ${product.nama_item}`}
                                        />
                                    </td>
                                    <td className="p-3">{product.kode_item}</td>
                                    <td className="p-3">
                                        {product.barcode ?? '-'}
                                    </td>
                                    <td className="p-3">{product.nama_item}</td>
                                    <td className="p-3">
                                        {product.category?.nama ?? '-'}
                                    </td>
                                    <td className="p-3">{product.satuan}</td>
                                    <td className="p-3 text-right">
                                        {formatRupiah(product.harga_pokok)}
                                    </td>
                                    <td className="p-3 text-right">
                                        {formatRupiah(product.harga_jual)}
                                    </td>
                                    <td className="p-3 text-right">
                                        {product.stok}
                                    </td>
                                    <td className="p-3">
                                        {product.is_active ? (
                                            <span className="text-green-600 dark:text-green-400">
                                                Aktif
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">
                                                Nonaktif
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        <ProductFormDialog
                                            product={product}
                                            categories={categories}
                                        />
                                    </td>
                                </tr>
                            ))}
                            {products.data.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={11}
                                        className="p-6 text-center text-muted-foreground"
                                    >
                                        Belum ada produk.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-wrap gap-1">
                    {products.links.map((link, index) => (
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

function ProductFormDialog({
    product,
    categories,
}: {
    product: Product;
    categories: Category[];
}) {
    const [open, setOpen] = useState(false);
    const { data, setData, put, processing, errors, reset } = useForm({
        kode_item: product.kode_item,
        barcode: product.barcode ?? '',
        nama_item: product.nama_item,
        category_id: product.category?.id?.toString() ?? '',
        satuan: product.satuan,
        harga_pokok: product.harga_pokok,
        harga_jual: product.harga_jual,
        is_active: product.is_active,
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        put(ProductController.update.url(product.id), {
            onSuccess: () => {
                setOpen(false);
                reset();
            },
        });
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    Edit
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Produk</DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="kode_item">Kode Item</Label>
                            <Input
                                id="kode_item"
                                value={data.kode_item}
                                onChange={(e) =>
                                    setData('kode_item', e.target.value)
                                }
                            />
                            <InputError message={errors.kode_item} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="barcode">Barcode</Label>
                            <Input
                                id="barcode"
                                value={data.barcode}
                                onChange={(e) =>
                                    setData('barcode', e.target.value)
                                }
                                placeholder="Scan atau isi manual"
                            />
                            <InputError message={errors.barcode} />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="nama_item">Nama Item</Label>
                        <Input
                            id="nama_item"
                            value={data.nama_item}
                            onChange={(e) =>
                                setData('nama_item', e.target.value)
                            }
                        />
                        <InputError message={errors.nama_item} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label>Kategori</Label>
                            <CategorySelect
                                categories={categories}
                                value={data.category_id}
                                onChange={(value) =>
                                    setData('category_id', value)
                                }
                            />
                            <InputError message={errors.category_id} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="satuan">Satuan Dasar</Label>
                            <Input
                                id="satuan"
                                value={data.satuan}
                                onChange={(e) =>
                                    setData('satuan', e.target.value)
                                }
                                placeholder="PCS, DUS, ..."
                            />
                            <InputError message={errors.satuan} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="harga_pokok">Harga Pokok</Label>
                            <Input
                                id="harga_pokok"
                                type="number"
                                value={data.harga_pokok}
                                onChange={(e) =>
                                    setData('harga_pokok', e.target.value)
                                }
                            />
                            <InputError message={errors.harga_pokok} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="harga_jual">Harga Jual</Label>
                            <Input
                                id="harga_jual"
                                type="number"
                                value={data.harga_jual}
                                onChange={(e) =>
                                    setData('harga_jual', e.target.value)
                                }
                            />
                            <InputError message={errors.harga_jual} />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            id="is_active"
                            type="checkbox"
                            checked={data.is_active}
                            onChange={(e) =>
                                setData('is_active', e.target.checked)
                            }
                        />
                        <Label htmlFor="is_active">Produk aktif</Label>
                    </div>
                    <Button type="submit" disabled={processing}>
                        Simpan
                    </Button>
                </form>

                <ProductUnitsManager product={product} />
                <ProductPriceTiersManager product={product} />
            </DialogContent>
        </Dialog>
    );
}

function CategorySelect({
    categories,
    value,
    onChange,
}: {
    categories: Category[];
    value: string;
    onChange: (value: string) => void;
}) {
    const [adding, setAdding] = useState(false);
    const [nama, setNama] = useState('');
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState<string>();

    function addCategory(e: FormEvent) {
        e.preventDefault();
        setProcessing(true);
        router.post(
            CategoryController.store.url(),
            { nama },
            {
                preserveScroll: true,
                onSuccess: (page) => {
                    const created = (page.props.categories as Category[]).find(
                        (c) => c.nama === nama,
                    );

                    if (created) {
                        onChange(created.id.toString());
                    }

                    setAdding(false);
                    setNama('');
                },
                onError: (e) => setError(e.nama),
                onFinish: () => setProcessing(false),
            },
        );
    }

    if (adding) {
        return (
            <form onSubmit={addCategory} className="flex gap-2">
                <Input
                    autoFocus
                    value={nama}
                    onChange={(e) => setNama(e.target.value)}
                    placeholder="Nama kategori baru"
                />
                <Button type="submit" size="sm" disabled={processing}>
                    Simpan
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAdding(false)}
                >
                    Batal
                </Button>
                {error && <InputError message={error} />}
            </form>
        );
    }

    return (
        <div className="flex gap-2">
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                    {categories.map((category) => (
                        <SelectItem
                            key={category.id}
                            value={category.id.toString()}
                        >
                            {category.nama}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAdding(true)}
            >
                + Baru
            </Button>
        </div>
    );
}

Inventory.layout = {
    breadcrumbs: [{ title: 'Inventory', href: inventory() }],
};
