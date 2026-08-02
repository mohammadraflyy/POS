import { Head, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { DataGrid, renderTextEditor } from 'react-data-grid';
import type { Column } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import ProductController from '@/actions/App/Http/Controllers/ProductController';
import InputError from '@/components/input-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useAppearance } from '@/hooks/use-appearance';
import { useAvailableHeight } from '@/hooks/use-available-height';
import { useElementWidth } from '@/hooks/use-element-width';
import {
    ProductPriceTiersManager,
    ProductUnitsManager,
} from '@/pages/inventory/shared';
import type { Product } from '@/pages/inventory/shared';
import { inventory } from '@/routes';

type DraftRow = {
    key: string;
    id: number | null;
    kode_item: string;
    barcode: string;
    nama_item: string;
    kategori: string;
    satuan: string;
    harga_pokok: string;
    harga_jual: string;
    stok: string;
};

function emptyRow(): DraftRow {
    return {
        key: crypto.randomUUID(),
        id: null,
        kode_item: '',
        barcode: '',
        nama_item: '',
        kategori: '',
        satuan: '',
        harga_pokok: '',
        harga_jual: '',
        stok: '0',
    };
}

function rowFromProduct(product: Product): DraftRow {
    return {
        key: `product-${product.id}`,
        id: product.id,
        kode_item: product.kode_item,
        barcode: product.barcode ?? '',
        nama_item: product.nama_item,
        kategori: product.category?.nama ?? '',
        satuan: product.satuan,
        harga_pokok: product.harga_pokok,
        harga_jual: product.harga_jual,
        stok: product.stok.toString(),
    };
}

/** Maps `rows.<index>.<field>` server error keys back onto draft row keys. */
function parseRowErrors(
    errors: Record<string, string>,
    indexToKey: string[],
): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};

    for (const [path, message] of Object.entries(errors)) {
        const match = path.match(/^rows\.(\d+)\.(.+)$/);

        if (!match) {
            continue;
        }

        const rowKey = indexToKey[Number(match[1])];

        if (!rowKey) {
            continue;
        }

        result[rowKey] = { ...(result[rowKey] ?? {}), [match[2]]: message };
    }

    return result;
}

function validateRows(
    rows: DraftRow[],
): Record<string, Record<string, string>> {
    const errors: Record<string, Record<string, string>> = {};
    const seenKode = new Map<string, string>();

    for (const row of rows) {
        const rowError: Record<string, string> = {};

        if (!row.kode_item.trim()) {
            rowError.kode_item = 'Wajib diisi.';
        }

        if (!row.nama_item.trim()) {
            rowError.nama_item = 'Wajib diisi.';
        }

        if (!row.satuan.trim()) {
            rowError.satuan = 'Wajib diisi.';
        }

        if (row.harga_pokok === '' || Number.isNaN(Number(row.harga_pokok))) {
            rowError.harga_pokok = 'Harus angka.';
        }

        if (row.harga_jual === '' || Number.isNaN(Number(row.harga_jual))) {
            rowError.harga_jual = 'Harus angka.';
        }

        if (row.kode_item.trim()) {
            const dupeKey = seenKode.get(row.kode_item);

            if (dupeKey) {
                rowError.kode_item = 'Kode item duplikat pada baris ini.';
                errors[dupeKey] = {
                    ...(errors[dupeKey] ?? {}),
                    kode_item: 'Kode item duplikat pada baris ini.',
                };
            } else {
                seenKode.set(row.kode_item, row.key);
            }
        }

        if (Object.keys(rowError).length > 0) {
            errors[row.key] = { ...(errors[row.key] ?? {}), ...rowError };
        }
    }

    return errors;
}

function textColumn(
    key: keyof DraftRow,
    name: string,
    rowErrors: Record<string, Record<string, string>>,
    width?: number,
): Column<DraftRow> {
    return {
        key,
        name,
        width,
        editable: true,
        renderEditCell: renderTextEditor,
        cellClass: (row) =>
            rowErrors[row.key]?.[key]
                ? 'bg-red-100 dark:bg-red-950'
                : undefined,
    };
}

const OTHER_COLUMNS_WIDTH = 110 + 130 + 130 + 90 + 110 + 110 + 90 + 170 + 60;
const MIN_NAMA_WIDTH = 220;

export default function MassInput({
    initialProducts,
}: {
    initialProducts: Product[];
}) {
    const { resolvedAppearance } = useAppearance();
    const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>();
    const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(72);
    const [rows, setRows] = useState<DraftRow[]>(() =>
        initialProducts.length > 0
            ? initialProducts.map(rowFromProduct)
            : [emptyRow(), emptyRow(), emptyRow()],
    );
    const [rowErrors, setRowErrors] = useState<
        Record<string, Record<string, string>>
    >({});
    const [formError, setFormError] = useState<string>();
    const [processing, setProcessing] = useState(false);
    const [unitsRowKey, setUnitsRowKey] = useState<string | null>(null);

    function addRow() {
        setRows((prev) => [...prev, emptyRow()]);
    }

    function submit() {
        const clientErrors = validateRows(rows);

        if (Object.keys(clientErrors).length > 0) {
            setRowErrors(clientErrors);
            setFormError('Periksa kembali baris yang bertanda merah.');

            return;
        }

        const indexToKey = rows.map((row) => row.key);
        setProcessing(true);
        setFormError(undefined);
        router.post(
            ProductController.bulkSave.url(),
            {
                rows: rows.map((row) => ({
                    id: row.id,
                    kode_item: row.kode_item,
                    barcode: row.barcode || null,
                    nama_item: row.nama_item,
                    kategori: row.kategori || null,
                    satuan: row.satuan,
                    harga_pokok: row.harga_pokok,
                    harga_jual: row.harga_jual,
                    stok: row.stok,
                })),
            },
            {
                onError: (errors) => {
                    setRowErrors(
                        parseRowErrors(
                            errors as Record<string, string>,
                            indexToKey,
                        ),
                    );
                    setFormError(
                        'Beberapa baris gagal disimpan, periksa kembali.',
                    );
                },
                onFinish: () => setProcessing(false),
            },
        );
    }

    const activeUnitsProduct = initialProducts.find(
        (p) => `product-${p.id}` === unitsRowKey,
    );

    const namaWidth = Math.max(
        MIN_NAMA_WIDTH,
        gridWidth - OTHER_COLUMNS_WIDTH - 2,
    );

    const columns = useMemo<Column<DraftRow>[]>(
        () => [
            textColumn('kode_item', 'Kode Item', rowErrors, 110),
            textColumn('barcode', 'Barcode', rowErrors, 130),
            textColumn('nama_item', 'Nama Item', rowErrors, namaWidth),
            textColumn('kategori', 'Kategori', rowErrors, 130),
            textColumn('satuan', 'Satuan', rowErrors, 90),
            textColumn('harga_pokok', 'Harga Pokok', rowErrors, 110),
            textColumn('harga_jual', 'Harga Jual', rowErrors, 110),
            {
                key: 'stok',
                name: 'Stok',
                width: 90,
                editable: (row) => row.id === null,
                renderEditCell: renderTextEditor,
                renderCell: ({ row }) =>
                    row.id === null ? (
                        row.stok
                    ) : (
                        <span className="text-muted-foreground">
                            {row.stok}
                        </span>
                    ),
            },
            {
                key: 'units',
                name: 'Satuan/Harga Bertingkat',
                width: 170,
                renderCell: ({ row }) => {
                    const live = initialProducts.find((p) => p.id === row.id);

                    if (!row.id || !live) {
                        return (
                            <span className="text-xs text-muted-foreground">
                                Simpan baris dulu
                            </span>
                        );
                    }

                    return (
                        <button
                            type="button"
                            className="flex h-full items-center gap-1"
                            onClick={() => setUnitsRowKey(row.key)}
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
                key: 'remove',
                name: '',
                width: 60,
                renderCell: ({ rowIdx }) => (
                    <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() =>
                            setRows((prev) =>
                                prev.filter((_, i) => i !== rowIdx),
                            )
                        }
                    >
                        Hapus
                    </button>
                ),
            },
        ],
        [rowErrors, initialProducts, namaWidth],
    );

    const errorSummary = rows.flatMap((row, index) =>
        Object.values(rowErrors[row.key] ?? {}).map(
            (message) => `Baris ${index + 1}: ${message}`,
        ),
    );

    return (
        <>
            <Head title="Input Massal Produk" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-semibold">
                        Input Massal Produk
                    </h1>
                    <Button variant="outline" size="sm" onClick={addRow}>
                        + Tambah Baris
                    </Button>
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
                            rowKeyGetter={(row) => row.key}
                            onRowsChange={setRows}
                            style={{
                                blockSize: gridHeight,
                                minHeight: 300,
                            }}
                        />
                    )}
                </div>

                {errorSummary.length > 0 && (
                    <div className="space-y-1 text-sm text-destructive">
                        {errorSummary.map((message, i) => (
                            <p key={i}>{message}</p>
                        ))}
                    </div>
                )}
                <InputError message={formError} />

                <div className="flex gap-2">
                    <Button onClick={submit} disabled={processing}>
                        Simpan Semua
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => router.get(inventory().url)}
                    >
                        Batal
                    </Button>
                </div>
            </div>

            <Dialog
                open={unitsRowKey !== null}
                onOpenChange={(open) => !open && setUnitsRowKey(null)}
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
        </>
    );
}

MassInput.layout = {
    breadcrumbs: [
        { title: 'Katalog Produk', href: inventory() },
        { title: 'Input Massal', href: ProductController.massInput() },
    ],
};
