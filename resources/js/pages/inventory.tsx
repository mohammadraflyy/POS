import { Head, router } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { DataGrid, renderTextEditor, SelectColumn } from 'react-data-grid';
import type { Column, RowsChangeData } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import ProductController from '@/actions/App/Http/Controllers/ProductController';
import InputError from '@/components/input-error';
import { Badge } from '@/components/ui/badge';
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
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAppearance } from '@/hooks/use-appearance';
import { useAvailableHeight } from '@/hooks/use-available-height';
import { useConfirm } from '@/hooks/use-confirm';
import { useElementWidth } from '@/hooks/use-element-width';
import {
    ProductPriceTiersManager,
    ProductUnitsManager,
} from '@/pages/inventory/shared';
import type { Product } from '@/pages/inventory/shared';
import { inventory } from '@/routes';
import type { Paginated } from '@/types';

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

type DraftRow = {
    id: number;
    kode_item: string;
    barcode: string;
    nama_item: string;
    kategori: string;
    satuan: string;
    harga_pokok: string;
    harga_jual: string;
    stok: number;
    is_active: boolean;
};

function toDraftRow(product: Product): DraftRow {
    return {
        id: product.id,
        kode_item: product.kode_item,
        barcode: product.barcode ?? '',
        nama_item: product.nama_item,
        kategori: product.category?.nama ?? '',
        satuan: product.satuan,
        harga_pokok: product.harga_pokok,
        harga_jual: product.harga_jual,
        stok: product.stok,
        is_active: product.is_active,
    };
}

function textColumn(
    key: keyof DraftRow,
    name: string,
    rowErrors: Record<number, Record<string, string>>,
    width?: number,
): Column<DraftRow> {
    return {
        key,
        name,
        width,
        editable: true,
        renderEditCell: renderTextEditor,
        cellClass: (row) =>
            rowErrors[row.id]?.[key] ? 'bg-red-100 dark:bg-red-950' : undefined,
    };
}

const OTHER_COLUMNS_WIDTH =
    50 + 110 + 130 + 130 + 90 + 110 + 110 + 90 + 90 + 170 + 70;
const MIN_NAMA_WIDTH = 200;

export default function Inventory({
    products,
    filters,
    perPageOptions,
}: {
    products: Paginated<Product>;
    filters: { search?: string; per_page?: string };
    perPageOptions: number[];
}) {
    const { resolvedAppearance } = useAppearance();
    const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>();
    const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(72);
    const [search, setSearch] = useState(filters.search ?? '');
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [rows, setRows] = useState<DraftRow[]>(() =>
        products.data.map(toDraftRow),
    );
    const [syncedProductsData, setSyncedProductsData] = useState(
        products.data,
    );
    const [rowErrors, setRowErrors] = useState<
        Record<number, Record<string, string>>
    >({});
    const [deleteError, setDeleteError] = useState<string>();
    const [unitsProductId, setUnitsProductId] = useState<number | null>(null);
    const [searchModalOpen, setSearchModalOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [paletteResults, setPaletteResults] = useState<SearchResult[]>([]);
    const perPage = filters.per_page ?? '25';
    const { confirm, ConfirmDialog } = useConfirm();

    if (products.data !== syncedProductsData) {
        setSyncedProductsData(products.data);
        setRows(products.data.map(toDraftRow));
    }

    function submitSearch(e: FormEvent) {
        e.preventDefault();
        setSearchModalOpen(false);
        router.get(
            inventory().url,
            { search, per_page: perPage },
            { preserveState: true },
        );
    }

    function changePerPage(value: string) {
        router.get(
            inventory().url,
            { search, per_page: value },
            { preserveState: true },
        );
    }

    useEffect(() => {
        if (!searchModalOpen) {
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
    }, [searchModalOpen, paletteQuery]);

    function searchAll(term: string) {
        setSearch(term);
        setSearchModalOpen(false);
        router.get(
            inventory().url,
            { search: term, per_page: perPage },
            { preserveState: true },
        );
    }

    function jumpToProduct(product: SearchResult) {
        setSearch(product.kode_item);
        setSearchModalOpen(false);
        router.get(
            inventory().url,
            { search: product.kode_item, per_page: perPage },
            { preserveState: true },
        );
    }

    function saveRow(row: DraftRow) {
        setRowErrors((prev) => {
            const next = { ...prev };
            delete next[row.id];

            return next;
        });

        router.put(
            ProductController.update.url(row.id),
            {
                kode_item: row.kode_item,
                barcode: row.barcode || null,
                nama_item: row.nama_item,
                kategori: row.kategori || null,
                satuan: row.satuan,
                harga_pokok: row.harga_pokok,
                harga_jual: row.harga_jual,
                is_active: row.is_active,
            },
            {
                onError: (errors) =>
                    setRowErrors((prev) => ({
                        ...prev,
                        [row.id]: errors as Record<string, string>,
                    })),
            },
        );
    }

    function handleRowsChange(
        newRows: DraftRow[],
        data: RowsChangeData<DraftRow>,
    ) {
        setRows(newRows);
        saveRow(newRows[data.indexes[0]]);
    }

    function toggleActive(row: DraftRow) {
        const updatedRow = { ...row, is_active: !row.is_active };
        setRows((prev) =>
            prev.map((r) => (r.id === row.id ? updatedRow : r)),
        );
        saveRow(updatedRow);
    }

    async function deleteProduct(product: Product) {
        const ok = await confirm({
            title: 'Hapus Produk',
            description: `Hapus produk "${product.nama_item}"?`,
            confirmLabel: 'Hapus',
            destructive: true,
        });

        if (!ok) {
            return;
        }

        setDeleteError(undefined);
        router.delete(ProductController.destroy.url(product.id), {
            onError: (errors) => setDeleteError(errors.product),
            onSuccess: () =>
                setSelectedIds((prev) => {
                    const next = new Set(prev);
                    next.delete(product.id);

                    return next;
                }),
        });
    }

    async function deleteSelected(ids: Set<number>) {
        if (ids.size === 0) {
            return;
        }

        if (ids.size === 1) {
            const product = products.data.find((p) => ids.has(p.id));

            if (product) {
                await deleteProduct(product);
            }

            return;
        }

        const ok = await confirm({
            title: 'Hapus Produk',
            description: `Hapus ${ids.size} produk terpilih?`,
            confirmLabel: 'Hapus',
            destructive: true,
        });

        if (!ok) {
            return;
        }

        setDeleteError(undefined);
        router.delete(ProductController.bulkDestroy.url(), {
            data: { ids: [...ids] },
            onError: (errors) => setDeleteError(errors.product),
            onSuccess: () => setSelectedIds(new Set()),
        });
    }

    // "/" focuses search; Delete/Backspace removes the selected product(s) -
    // both skip while typing in a field.
    useEffect(() => {
        function isEditableTarget(target: EventTarget | null): boolean {
            if (!(target instanceof HTMLElement)) {
                return false;
            }

            return (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT' ||
                target.isContentEditable
            );
        }

        function handleKeyDown(e: KeyboardEvent) {
            if (isEditableTarget(e.target)) {
                return;
            }

            if (e.key === '/') {
                e.preventDefault();
                setPaletteQuery('');
                setSearchModalOpen(true);

                return;
            }

            if (
                (e.key === 'Delete' || e.key === 'Backspace') &&
                selectedIds.size > 0
            ) {
                deleteSelected(selectedIds);
            }
        }

        window.addEventListener('keydown', handleKeyDown);

        return () => window.removeEventListener('keydown', handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIds, products.data]);

    const activeUnitsProduct = products.data.find(
        (p) => p.id === unitsProductId,
    );

    const namaWidth = Math.max(
        MIN_NAMA_WIDTH,
        gridWidth - OTHER_COLUMNS_WIDTH - 2,
    );

    const columns: Column<DraftRow>[] = [
            SelectColumn,
            textColumn('kode_item', 'Kode Item', rowErrors, 110),
            textColumn('barcode', 'Barcode', rowErrors, 130),
            textColumn('nama_item', 'Nama', rowErrors, namaWidth),
            textColumn('kategori', 'Kategori', rowErrors, 130),
            textColumn('satuan', 'Satuan', rowErrors, 90),
            textColumn('harga_pokok', 'Harga Pokok', rowErrors, 110),
            textColumn('harga_jual', 'Harga Jual', rowErrors, 110),
            {
                key: 'stok',
                name: 'Stok',
                width: 90,
                renderCell: ({ row }) => (
                    <span className="text-muted-foreground">{row.stok}</span>
                ),
            },
            {
                key: 'is_active',
                name: 'Status',
                width: 90,
                renderCell: ({ row }) => (
                    <label className="flex h-full items-center gap-1.5 text-xs">
                        <input
                            type="checkbox"
                            checked={row.is_active}
                            onChange={() => toggleActive(row)}
                        />
                        <span
                            className={
                                row.is_active
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-muted-foreground'
                            }
                        >
                            {row.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                    </label>
                ),
            },
            {
                key: 'units',
                name: 'Satuan/Harga Bertingkat',
                width: 170,
                renderCell: ({ row }) => {
                    const live = products.data.find((p) => p.id === row.id);

                    if (!live) {
                        return null;
                    }

                    return (
                        <button
                            type="button"
                            className="flex h-full items-center gap-1"
                            onClick={() => setUnitsProductId(row.id)}
                        >
                            <Badge
                                variant={
                                    live.product_units.length > 0
                                        ? 'secondary'
                                        : 'outline'
                                }
                                className="text-[10px]"
                            >
                                {live.product_units.length} unit
                            </Badge>
                            <Badge
                                variant={
                                    live.price_tiers.length > 0
                                        ? 'secondary'
                                        : 'outline'
                                }
                                className="text-[10px]"
                            >
                                {live.price_tiers.length} tingkat
                            </Badge>
                        </button>
                    );
                },
            },
            {
                key: 'aksi',
                name: '',
                width: 70,
                renderCell: ({ row }) => {
                    const product = products.data.find(
                        (p) => p.id === row.id,
                    );

                    return (
                        <button
                            type="button"
                            className="text-xs text-destructive hover:underline"
                            onClick={() =>
                                product && deleteProduct(product)
                            }
                        >
                            Hapus
                        </button>
                    );
                },
            },
    ];

    const errorSummary = Object.entries(rowErrors).flatMap(
        ([productId, fields]) => {
            const product = products.data.find(
                (p) => p.id === Number(productId),
            );

            return Object.values(fields).map(
                (message) =>
                    `${product?.nama_item ?? `Produk #${productId}`}: ${message}`,
            );
        },
    );

    return (
        <>
            <Head title="Inventory" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <InputError message={deleteError} />
                {errorSummary.length > 0 && (
                    <div className="space-y-1 text-sm text-destructive">
                        {errorSummary.map((message, i) => (
                            <p key={i}>{message}</p>
                        ))}
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                    <form onSubmit={submitSearch} className="flex gap-2">
                        <div className="relative w-64">
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Cari kode / nama / barcode produk..."
                                className="pr-8"
                            />
                            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                /
                            </kbd>
                        </div>
                        <Button type="submit" variant="secondary">
                            Cari
                        </Button>
                    </form>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={selectedIds.size === 0}
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
                            Edit Massal ({selectedIds.size})
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={selectedIds.size === 0}
                            onClick={() => deleteSelected(selectedIds)}
                        >
                            Hapus Terpilih ({selectedIds.size})
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
                            rows={rows}
                            rowKeyGetter={(row) => row.id}
                            onRowsChange={handleRowsChange}
                            selectedRows={selectedIds}
                            onSelectedRowsChange={setSelectedIds}
                            style={{
                                blockSize: gridHeight,
                                minHeight: 300,
                            }}
                        />
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                        {products.links.map((link, index) => (
                            <Button
                                key={index}
                                variant={link.active ? 'default' : 'outline'}
                                size="sm"
                                disabled={!link.url}
                                onClick={() =>
                                    link.url && router.get(link.url)
                                }
                                dangerouslySetInnerHTML={{
                                    __html: link.label,
                                }}
                            />
                        ))}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>Tampilkan</span>
                        <Select value={perPage} onValueChange={changePerPage}>
                            <SelectTrigger className="w-20">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {perPageOptions.map((option) => (
                                    <SelectItem
                                        key={option}
                                        value={option.toString()}
                                    >
                                        {option}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span>dari {products.total} produk</span>
                    </div>
                </div>
            </div>

            <Dialog
                open={unitsProductId !== null}
                onOpenChange={(open) => !open && setUnitsProductId(null)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {activeUnitsProduct?.nama_item} &mdash; Satuan &
                            Harga Bertingkat
                        </DialogTitle>
                    </DialogHeader>
                    {activeUnitsProduct && (
                        <>
                            <ProductUnitsManager product={activeUnitsProduct} />
                            <ProductPriceTiersManager
                                product={activeUnitsProduct}
                            />
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <CommandDialog
                open={searchModalOpen}
                onOpenChange={setSearchModalOpen}
                title="Cari Produk"
                description="Cari kode, nama, atau barcode produk"
                shouldFilter={false}
            >
                <CommandInput
                    value={paletteQuery}
                    onValueChange={setPaletteQuery}
                    placeholder="Cari kode / nama / barcode produk..."
                />
                <CommandList>
                    <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>
                    {paletteQuery.trim() !== '' && (
                        <CommandGroup heading="Aksi">
                            <CommandItem
                                value={`cari-semua-${paletteQuery}`}
                                onSelect={() => searchAll(paletteQuery)}
                            >
                                Cari semua untuk &ldquo;{paletteQuery}&rdquo;
                            </CommandItem>
                        </CommandGroup>
                    )}
                    {paletteResults.length > 0 && (
                        <CommandGroup heading="Produk">
                            {paletteResults.map((product) => (
                                <CommandItem
                                    key={product.id}
                                    value={product.id.toString()}
                                    onSelect={() => jumpToProduct(product)}
                                    className="flex items-center justify-between"
                                >
                                    <span>
                                        <span className="font-medium">
                                            {product.nama_item}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {' '}
                                            &middot; {product.kode_item}
                                            {product.category &&
                                                ` · ${product.category.nama}`}
                                        </span>
                                    </span>
                                    {!product.is_active && (
                                        <span className="text-xs text-muted-foreground">
                                            Nonaktif
                                        </span>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}
                </CommandList>
                <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <kbd className="rounded border bg-muted px-1.5 py-0.5">
                            &uarr;&darr;
                        </kbd>
                        pilih
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="rounded border bg-muted px-1.5 py-0.5">
                            &crarr;
                        </kbd>
                        buka
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="rounded border bg-muted px-1.5 py-0.5">
                            esc
                        </kbd>
                        tutup
                    </span>
                </div>
            </CommandDialog>

            {ConfirmDialog}
        </>
    );
}

Inventory.layout = {
    breadcrumbs: [{ title: 'Inventory', href: inventory() }],
};
