import { Head, router, useHttp } from '@inertiajs/react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import ProductController from '@/actions/App/Http/Controllers/ProductController';
import PurchaseController from '@/actions/App/Http/Controllers/PurchaseController';
import SupplierController from '@/actions/App/Http/Controllers/SupplierController';
import InputError from '@/components/input-error';
import { ReportTable } from '@/components/report-table';
import { Button } from '@/components/ui/button';
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
import { purchase } from '@/routes';

type Category = { id: number; nama: string };
type Supplier = { id: number; nama: string };

type SearchResult = {
    id: number;
    kode_item: string;
    barcode: string | null;
    nama_item: string;
    category: { id: number; nama: string } | null;
    satuan: string;
    harga_jual: string;
    is_active: boolean;
};

type NewProductResponse = {
    id: number;
    kode_item: string;
    nama_item: string;
    satuan: string;
    harga_pokok: string;
};

type NewSupplierResponse = {
    id: number;
    nama: string;
};

type PurchaseRow = {
    id: number;
    tanggal: string;
    total: string;
    catatan: string | null;
    supplier: { id: number; nama: string } | null;
    items: { id: number; qty: number; product: { nama_item: string } | null }[];
};

type DraftItem = {
    key: string;
    productId: number;
    namaItem: string;
    kodeItem: string;
    satuan: string;
    qty: string;
    hargaBeli: string;
};

let draftKeySeq = 0;

export default function Purchase({
    suppliers,
    categories,
    purchases,
}: {
    suppliers: Supplier[];
    categories: Category[];
    purchases: PurchaseRow[];
}) {
    const [supplierList, setSupplierList] = useState(suppliers);
    const [supplierId, setSupplierId] = useState('');
    const [supplierPaletteOpen, setSupplierPaletteOpen] = useState(false);
    const selectedSupplier = supplierList.find(
        (s) => String(s.id) === supplierId,
    );
    const [tanggal, setTanggal] = useState(() =>
        new Date().toISOString().slice(0, 10),
    );
    const [catatan, setCatatan] = useState('');
    const [items, setItems] = useState<DraftItem[]>([]);
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [paletteResults, setPaletteResults] = useState<SearchResult[]>([]);

    const [newProductOpen, setNewProductOpen] = useState(false);
    const newProduct = useHttp<
        {
            kode_item: string;
            barcode: string;
            nama_item: string;
            category_id: string;
            satuan: string;
            harga_pokok: string;
            harga_jual: string;
            stok: number;
        },
        NewProductResponse
    >({
        kode_item: '',
        barcode: '',
        nama_item: '',
        category_id: '',
        satuan: '',
        harga_pokok: '',
        harga_jual: '',
        stok: 0,
    });

    const [newSupplierOpen, setNewSupplierOpen] = useState(false);
    const newSupplier = useHttp<
        {
            nama: string;
            telepon: string;
            alamat: string;
            keterangan: string;
        },
        NewSupplierResponse
    >({
        nama: '',
        telepon: '',
        alamat: '',
        keterangan: '',
    });

    function submitNewSupplier(e: FormEvent) {
        e.preventDefault();
        newSupplier.post(SupplierController.store.url(), {
            onSuccess: (created) => {
                setSupplierList((prev) => [...prev, created]);
                setSupplierId(String(created.id));
                newSupplier.reset();
                setNewSupplierOpen(false);
            },
        });
    }

    useEffect(() => {
        if (!paletteOpen) {
            return;
        }

        let cancelled = false;

        fetch(ProductController.search.url({ query: { q: paletteQuery } }))
            .then((response) => response.json())
            .then((results: SearchResult[]) => {
                if (!cancelled) {
                    setPaletteResults(results);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [paletteOpen, paletteQuery]);

    function addItem(
        product: {
            id: number;
            kode_item: string;
            nama_item: string;
            satuan: string;
        },
        hargaBeli = '',
    ) {
        setItems((prev) => {
            const existing = prev.find((i) => i.productId === product.id);

            if (existing) {
                return prev.map((i) =>
                    i.productId === product.id
                        ? { ...i, qty: String(Number(i.qty || 0) + 1) }
                        : i,
                );
            }

            return [
                ...prev,
                {
                    key: `draft-${draftKeySeq++}`,
                    productId: product.id,
                    namaItem: product.nama_item,
                    kodeItem: product.kode_item,
                    satuan: product.satuan,
                    qty: '1',
                    hargaBeli,
                },
            ];
        });
    }

    function removeItem(key: string) {
        setItems((prev) => prev.filter((i) => i.key !== key));
    }

    function updateItem(key: string, field: 'qty' | 'hargaBeli', value: string) {
        setItems((prev) =>
            prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)),
        );
    }

    const total = items.reduce(
        (sum, i) => sum + Number(i.qty || 0) * Number(i.hargaBeli || 0),
        0,
    );

    function submitNewProduct(e: FormEvent) {
        e.preventDefault();
        newProduct.post(ProductController.store.url(), {
            onSuccess: (product) => {
                addItem(product, product.harga_pokok);
                newProduct.reset();
                setNewProductOpen(false);
            },
        });
    }

    function submit(e: FormEvent) {
        e.preventDefault();
        setProcessing(true);
        setErrors({});
        router.post(
            PurchaseController.store.url(),
            {
                supplier_id: supplierId || null,
                tanggal,
                catatan: catatan || null,
                items: items.map((i) => ({
                    product_id: i.productId,
                    qty: Number(i.qty || 0),
                    harga_beli: Number(i.hargaBeli || 0),
                })),
            },
            {
                onSuccess: () => {
                    setItems([]);
                    setCatatan('');
                    setSupplierId('');
                },
                onError: (e) => setErrors(e as Record<string, string>),
                onFinish: () => setProcessing(false),
            },
        );
    }

    return (
        <>
            <Head title="Pembelian" />
            <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
                <h1 className="text-xl font-semibold">Pembelian</h1>

                <form
                    onSubmit={submit}
                    className="space-y-4 rounded-xl border p-4"
                >
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="grid gap-1">
                            <Label>Supplier</Label>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1 justify-start font-normal"
                                    onClick={() => setSupplierPaletteOpen(true)}
                                >
                                    <Search className="size-4" />
                                    {selectedSupplier?.nama ?? 'Tanpa supplier'}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    title="Supplier Baru"
                                    onClick={() => setNewSupplierOpen(true)}
                                >
                                    <Plus className="size-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="grid gap-1">
                            <Label>Tanggal</Label>
                            <Input
                                type="date"
                                value={tanggal}
                                onChange={(e) => setTanggal(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-1">
                            <Label>Catatan (opsional)</Label>
                            <Input
                                value={catatan}
                                onChange={(e) => setCatatan(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setPaletteOpen(true)}
                        >
                            <Search className="size-4" />
                            Cari Produk
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setNewProductOpen(true)}
                        >
                            <Plus className="size-4" />
                            Produk Baru
                        </Button>
                    </div>

                    {items.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-left">
                                    <tr>
                                        <th className="p-2">Produk</th>
                                        <th className="w-28 p-2">Qty</th>
                                        <th className="w-40 p-2">Harga Beli</th>
                                        <th className="w-32 p-2 text-right">
                                            Subtotal
                                        </th>
                                        <th className="w-10 p-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item) => (
                                        <tr key={item.key} className="border-t">
                                            <td className="p-2">
                                                {item.namaItem}{' '}
                                                <span className="text-muted-foreground">
                                                    &middot; {item.kodeItem} (
                                                    {item.satuan})
                                                </span>
                                            </td>
                                            <td className="p-2">
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={item.qty}
                                                    onChange={(e) =>
                                                        updateItem(
                                                            item.key,
                                                            'qty',
                                                            e.target.value,
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td className="p-2">
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    value={item.hargaBeli}
                                                    onChange={(e) =>
                                                        updateItem(
                                                            item.key,
                                                            'hargaBeli',
                                                            e.target.value,
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td className="p-2 text-right">
                                                {formatRupiah(
                                                    Number(item.qty || 0) *
                                                        Number(item.hargaBeli || 0),
                                                )}
                                            </td>
                                            <td className="p-2">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() =>
                                                        removeItem(item.key)
                                                    }
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <InputError message={errors.items} />

                    <div className="flex items-center justify-between border-t pt-3">
                        <span className="text-sm text-muted-foreground">Total</span>
                        <span className="text-lg font-semibold">
                            {formatRupiah(total)}
                        </span>
                    </div>

                    <Button type="submit" disabled={processing || items.length === 0}>
                        Simpan Pembelian
                    </Button>
                </form>

                <ReportTable<PurchaseRow>
                    title="Riwayat Pembelian"
                    rows={purchases}
                    rowKey={(row) => row.id}
                    emptyMessage="Belum ada pembelian."
                    columns={[
                        {
                            key: 'tanggal',
                            name: 'Tanggal',
                            width: 130,
                            renderCell: ({ row }) =>
                                new Date(row.tanggal).toLocaleDateString('id-ID'),
                        },
                        {
                            key: 'supplier',
                            name: 'Supplier',
                            width: 180,
                            renderCell: ({ row }) => row.supplier?.nama ?? '-',
                        },
                        {
                            key: 'items',
                            name: 'Item',
                            renderCell: ({ row }) =>
                                row.items
                                    .map(
                                        (i) =>
                                            `${i.product?.nama_item ?? '-'} x${i.qty}`,
                                    )
                                    .join(', '),
                        },
                        {
                            key: 'total',
                            name: 'Total',
                            width: 140,
                            renderCell: ({ row }) => (
                                <span className="w-full text-right">
                                    {formatRupiah(row.total)}
                                </span>
                            ),
                        },
                    ]}
                />
            </div>

            <CommandDialog
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                title="Cari Produk"
                description="Cari produk untuk ditambahkan ke pembelian"
                shouldFilter={false}
            >
                <CommandInput
                    value={paletteQuery}
                    onValueChange={setPaletteQuery}
                    placeholder="Cari nama / kode / barcode..."
                />
                <CommandList>
                    <CommandEmpty>
                        {paletteQuery.trim() === ''
                            ? 'Ketik untuk mencari produk.'
                            : 'Produk tidak ditemukan.'}
                    </CommandEmpty>
                    {paletteResults.length > 0 && (
                        <CommandGroup heading="Produk">
                            {paletteResults.map((product) => (
                                <CommandItem
                                    key={product.id}
                                    value={product.id.toString()}
                                    onSelect={() => {
                                        addItem(product, product.harga_jual);
                                        setPaletteQuery('');
                                    }}
                                >
                                    {product.nama_item}{' '}
                                    <span className="text-muted-foreground">
                                        &middot; {product.kode_item}
                                    </span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}
                </CommandList>
            </CommandDialog>

            <CommandDialog
                open={supplierPaletteOpen}
                onOpenChange={setSupplierPaletteOpen}
                title="Pilih Supplier"
                description="Cari supplier untuk pembelian ini"
            >
                <CommandInput placeholder="Cari supplier..." />
                <CommandList>
                    <CommandEmpty>Supplier tidak ditemukan.</CommandEmpty>
                    <CommandGroup>
                        <CommandItem
                            value="Tanpa supplier"
                            onSelect={() => {
                                setSupplierId('');
                                setSupplierPaletteOpen(false);
                            }}
                        >
                            Tanpa supplier
                        </CommandItem>
                        {supplierList.map((s) => (
                            <CommandItem
                                key={s.id}
                                value={s.nama}
                                onSelect={() => {
                                    setSupplierId(String(s.id));
                                    setSupplierPaletteOpen(false);
                                }}
                            >
                                {s.nama}
                            </CommandItem>
                        ))}
                    </CommandGroup>
                </CommandList>
            </CommandDialog>

            <Dialog open={newProductOpen} onOpenChange={setNewProductOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Produk Baru</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submitNewProduct} className="space-y-3">
                        <div className="grid gap-1">
                            <Label>Kode Item</Label>
                            <Input
                                value={newProduct.data.kode_item}
                                onChange={(e) =>
                                    newProduct.setData('kode_item', e.target.value)
                                }
                            />
                            <InputError message={newProduct.errors.kode_item} />
                        </div>
                        <div className="grid gap-1">
                            <Label>Barcode (opsional)</Label>
                            <Input
                                value={newProduct.data.barcode}
                                onChange={(e) =>
                                    newProduct.setData('barcode', e.target.value)
                                }
                            />
                            <InputError message={newProduct.errors.barcode} />
                        </div>
                        <div className="grid gap-1">
                            <Label>Nama Item</Label>
                            <Input
                                value={newProduct.data.nama_item}
                                onChange={(e) =>
                                    newProduct.setData('nama_item', e.target.value)
                                }
                            />
                            <InputError message={newProduct.errors.nama_item} />
                        </div>
                        <div className="grid gap-1">
                            <Label>Kategori (opsional)</Label>
                            <Select
                                value={newProduct.data.category_id}
                                onValueChange={(v) =>
                                    newProduct.setData('category_id', v)
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Tanpa kategori" />
                                </SelectTrigger>
                                <SelectContent>
                                    {categories.map((c) => (
                                        <SelectItem key={c.id} value={String(c.id)}>
                                            {c.nama}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="grid gap-1">
                                <Label>Satuan</Label>
                                <Input
                                    value={newProduct.data.satuan}
                                    onChange={(e) =>
                                        newProduct.setData('satuan', e.target.value)
                                    }
                                />
                                <InputError message={newProduct.errors.satuan} />
                            </div>
                            <div className="grid gap-1">
                                <Label>Harga Pokok</Label>
                                <Input
                                    type="number"
                                    value={newProduct.data.harga_pokok}
                                    onChange={(e) =>
                                        newProduct.setData(
                                            'harga_pokok',
                                            e.target.value,
                                        )
                                    }
                                />
                                <InputError message={newProduct.errors.harga_pokok} />
                            </div>
                            <div className="grid gap-1">
                                <Label>Harga Jual</Label>
                                <Input
                                    type="number"
                                    value={newProduct.data.harga_jual}
                                    onChange={(e) =>
                                        newProduct.setData(
                                            'harga_jual',
                                            e.target.value,
                                        )
                                    }
                                />
                                <InputError message={newProduct.errors.harga_jual} />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={newProduct.processing}>
                                Tambahkan
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={newSupplierOpen} onOpenChange={setNewSupplierOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Supplier Baru</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submitNewSupplier} className="space-y-3">
                        <div className="grid gap-1">
                            <Label>Nama</Label>
                            <Input
                                value={newSupplier.data.nama}
                                onChange={(e) =>
                                    newSupplier.setData('nama', e.target.value)
                                }
                            />
                            <InputError message={newSupplier.errors.nama} />
                        </div>
                        <div className="grid gap-1">
                            <Label>Telepon (opsional)</Label>
                            <Input
                                value={newSupplier.data.telepon}
                                onChange={(e) =>
                                    newSupplier.setData('telepon', e.target.value)
                                }
                            />
                            <InputError message={newSupplier.errors.telepon} />
                        </div>
                        <div className="grid gap-1">
                            <Label>Alamat (opsional)</Label>
                            <Input
                                value={newSupplier.data.alamat}
                                onChange={(e) =>
                                    newSupplier.setData('alamat', e.target.value)
                                }
                            />
                            <InputError message={newSupplier.errors.alamat} />
                        </div>
                        <div className="grid gap-1">
                            <Label>Keterangan (opsional)</Label>
                            <Input
                                value={newSupplier.data.keterangan}
                                onChange={(e) =>
                                    newSupplier.setData('keterangan', e.target.value)
                                }
                            />
                            <InputError message={newSupplier.errors.keterangan} />
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={newSupplier.processing}>
                                Tambahkan
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}

Purchase.layout = {
    breadcrumbs: [{ title: 'Pembelian', href: purchase() }],
};
