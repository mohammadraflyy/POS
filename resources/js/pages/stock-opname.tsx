import { Head, router } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, renderTextEditor } from 'react-data-grid';
import type { Column, RowsChangeData } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import StockAdjustmentController from '@/actions/App/Http/Controllers/StockAdjustmentController';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppearance } from '@/hooks/use-appearance';
import { useAvailableHeight } from '@/hooks/use-available-height';
import { useElementWidth } from '@/hooks/use-element-width';
import { stockOpname } from '@/routes';

type OpnameProduct = {
    id: number;
    kode_item: string;
    barcode: string | null;
    nama_item: string;
    category: { id: number; nama: string } | null;
    satuan: string;
    stok: number;
};

type OpnameRow = {
    key: string;
    id: number;
    kode_item: string;
    nama_item: string;
    kategori: string;
    satuan: string;
    stokSistem: number;
    stokFisik: string;
    keterangan: string;
};

const FIXED_COLUMN_WIDTHS = {
    kode_item: 110,
    kategori: 130,
    satuan: 90,
    stokSistem: 110,
    stokFisik: 110,
    selisih: 90,
    keterangan: 220,
    aksi: 110,
} as const;
const MIN_NAMA_WIDTH = 220;

function rowFromProduct(product: OpnameProduct): OpnameRow {
    return {
        key: product.id.toString(),
        id: product.id,
        kode_item: product.kode_item,
        nama_item: product.nama_item,
        kategori: product.category?.nama ?? '-',
        satuan: product.satuan,
        stokSistem: product.stok,
        stokFisik: product.stok.toString(),
        keterangan: '',
    };
}

export default function StockOpname() {
    const { resolvedAppearance } = useAppearance();
    const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>();
    const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(16);
    const [query, setQuery] = useState('');
    const [rows, setRows] = useState<OpnameRow[]>([]);
    const [searching, setSearching] = useState(false);
    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
    const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
    const searchInputRef = useRef<HTMLInputElement>(null);

    // "/" refocuses search when the grid has stolen focus - skip while
    // typing in a field.
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
                searchInputRef.current?.focus();
            }
        }

        window.addEventListener('keydown', handleKeyDown);

        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    async function search(q: string) {
        setQuery(q);

        if (q.trim() === '') {
            setRows([]);

            return;
        }

        setSearching(true);
        const response = await fetch(
            StockAdjustmentController.search.url({ query: { q } }),
        );
        const products = (await response.json()) as OpnameProduct[];
        setRows(products.map(rowFromProduct));
        setSearching(false);
    }

    function saveRow(row: OpnameRow) {
        setSaving((prev) => new Set(prev).add(row.key));
        setRowErrors((prev) => {
            const next = { ...prev };
            delete next[row.key];

            return next;
        });
        setSavedKeys((prev) => {
            const next = new Set(prev);
            next.delete(row.key);

            return next;
        });

        router.post(
            StockAdjustmentController.store.url(row.id),
            { stok_sesudah: row.stokFisik, alasan: row.keterangan },
            {
                onSuccess: () => {
                    setRows((prev) =>
                        prev.map((r) =>
                            r.key === row.key
                                ? { ...r, stokSistem: Number(r.stokFisik) }
                                : r,
                        ),
                    );
                    setSavedKeys((prev) => new Set(prev).add(row.key));
                },
                onError: (errors) => {
                    const message = Object.values(errors)[0] as
                        | string
                        | undefined;
                    setRowErrors((prev) => ({
                        ...prev,
                        [row.key]: message ?? 'Gagal disimpan.',
                    }));
                },
                onFinish: () =>
                    setSaving((prev) => {
                        const next = new Set(prev);
                        next.delete(row.key);

                        return next;
                    }),
            },
        );
    }

    function handleRowsChange(
        newRows: OpnameRow[],
        data: RowsChangeData<OpnameRow>,
    ) {
        setRows(newRows);

        if (data.column.key !== 'stokFisik') {
            return;
        }

        const row = newRows[data.indexes[0]];

        if (row.stokFisik !== '' && row.stokFisik !== row.stokSistem.toString()) {
            saveRow(row);
        }
    }

    const namaWidth = Math.max(
        MIN_NAMA_WIDTH,
        gridWidth -
            Object.values(FIXED_COLUMN_WIDTHS).reduce((a, b) => a + b, 0) -
            2,
    );

    const columns = useMemo<Column<OpnameRow>[]>(
        () => [
            {
                key: 'kode_item',
                name: 'Kode Item',
                width: FIXED_COLUMN_WIDTHS.kode_item,
            },
            { key: 'nama_item', name: 'Nama Item', width: namaWidth },
            {
                key: 'kategori',
                name: 'Kategori',
                width: FIXED_COLUMN_WIDTHS.kategori,
            },
            {
                key: 'satuan',
                name: 'Satuan',
                width: FIXED_COLUMN_WIDTHS.satuan,
            },
            {
                key: 'stokSistem',
                name: 'Stok Sistem',
                width: FIXED_COLUMN_WIDTHS.stokSistem,
                renderCell: ({ row }) => (
                    <span className="text-muted-foreground">
                        {row.stokSistem}
                    </span>
                ),
            },
            {
                key: 'stokFisik',
                name: 'Stok Fisik',
                width: FIXED_COLUMN_WIDTHS.stokFisik,
                editable: true,
                renderEditCell: renderTextEditor,
                cellClass: (row) =>
                    rowErrors[row.key] ? 'bg-red-100 dark:bg-red-950' : undefined,
            },
            {
                key: 'selisih',
                name: 'Selisih',
                width: FIXED_COLUMN_WIDTHS.selisih,
                renderCell: ({ row }) => {
                    const selisih =
                        (Number(row.stokFisik) || 0) - row.stokSistem;

                    return (
                        <span
                            className={
                                selisih < 0
                                    ? 'font-semibold text-destructive'
                                    : selisih > 0
                                      ? 'font-semibold text-green-600 dark:text-green-400'
                                      : 'text-muted-foreground'
                            }
                        >
                            {selisih > 0 ? '+' : ''}
                            {selisih}
                        </span>
                    );
                },
            },
            {
                key: 'keterangan',
                name: 'Keterangan',
                width: FIXED_COLUMN_WIDTHS.keterangan,
                editable: true,
                renderEditCell: renderTextEditor,
            },
            {
                key: 'aksi',
                name: '',
                width: FIXED_COLUMN_WIDTHS.aksi,
                renderCell: ({ row }) => {
                    if (saving.has(row.key)) {
                        return (
                            <span className="text-xs text-muted-foreground">
                                Menyimpan...
                            </span>
                        );
                    }

                    if (savedKeys.has(row.key)) {
                        return (
                            <span className="text-xs text-green-600 dark:text-green-400">
                                Tersimpan
                            </span>
                        );
                    }

                    return (
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={row.stokFisik === ''}
                            onClick={() => saveRow(row)}
                        >
                            Simpan
                        </Button>
                    );
                },
            },
        ],
        [rowErrors, saving, savedKeys, namaWidth],
    );

    const idle = query.trim() === '' && rows.length === 0;

    if (idle) {
        return (
            <>
                <Head title="Stock Opname" />
                <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
                    <div className="relative w-full max-w-2xl">
                        <Input
                            ref={searchInputRef}
                            autoFocus
                            value={query}
                            onChange={(e) => search(e.target.value)}
                            placeholder="Cari kode / nama / kategori / barcode..."
                            className="h-14 pr-10 text-lg"
                        />
                        <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            /
                        </kbd>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Head title="Stock Opname" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <h1 className="text-xl font-semibold">Stock Opname</h1>

                <div className="relative max-w-md">
                    <Input
                        ref={searchInputRef}
                        autoFocus
                        value={query}
                        onChange={(e) => search(e.target.value)}
                        placeholder="Cari kode / nama / kategori / barcode..."
                        className="pr-8"
                    />
                    <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        /
                    </kbd>
                </div>

                {searching && (
                    <p className="text-sm text-muted-foreground">Mencari...</p>
                )}
                {!searching && query.trim() !== '' && rows.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        Produk tidak ditemukan.
                    </p>
                )}

                <div
                    ref={(node) => {
                        widthRef(node);
                        heightRef(node);
                    }}
                >
                    {rows.length > 0 && gridWidth > 0 && (
                        <DataGrid
                            className={
                                resolvedAppearance === 'dark'
                                    ? 'rdg-dark'
                                    : 'rdg-light'
                            }
                            columns={columns}
                            rows={rows}
                            rowKeyGetter={(row) => row.key}
                            onRowsChange={handleRowsChange}
                            style={{
                                blockSize: gridHeight,
                                minHeight: 300,
                            }}
                        />
                    )}
                </div>
            </div>
        </>
    );
}

StockOpname.layout = {
    breadcrumbs: [{ title: 'Stock Opname', href: stockOpname() }],
};
