import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { DataGrid, renderTextEditor } from 'react-data-grid';
import type { Column, RowsChangeData } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import SupplierController from '@/actions/App/Http/Controllers/SupplierController';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppearance } from '@/hooks/use-appearance';
import { useAvailableHeight } from '@/hooks/use-available-height';
import { useConfirm } from '@/hooks/use-confirm';
import { useElementWidth } from '@/hooks/use-element-width';
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

type DraftRow = {
    key: string;
    id: number | null;
    nama: string;
    telepon: string;
    alamat: string;
    keterangan: string;
    purchases_count: number;
};

function toDraftRow(supplier: Supplier): DraftRow {
    return {
        key: supplier.id.toString(),
        id: supplier.id,
        nama: supplier.nama,
        telepon: supplier.telepon ?? '',
        alamat: supplier.alamat ?? '',
        keterangan: supplier.keterangan ?? '',
        purchases_count: supplier.purchases_count,
    };
}

function emptyRow(): DraftRow {
    return {
        key: crypto.randomUUID(),
        id: null,
        nama: '',
        telepon: '',
        alamat: '',
        keterangan: '',
        purchases_count: 0,
    };
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
            rowErrors[row.key]?.[key] ? 'bg-red-100 dark:bg-red-950' : undefined,
    };
}

const OTHER_COLUMNS_WIDTH = 140 + 200 + 150 + 90;
const MIN_NAMA_WIDTH = 180;

export default function Supplier({
    suppliers,
    filters,
}: {
    suppliers: Paginated<Supplier>;
    filters: { search?: string };
}) {
    const { resolvedAppearance } = useAppearance();
    const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>();
    const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(56);
    const [search, setSearch] = useState(filters.search ?? '');
    const [rows, setRows] = useState<DraftRow[]>(() =>
        suppliers.data.map(toDraftRow),
    );
    const [syncedData, setSyncedData] = useState(suppliers.data);
    const [rowErrors, setRowErrors] = useState<
        Record<string, Record<string, string>>
    >({});
    const { confirm, ConfirmDialog } = useConfirm();

    if (suppliers.data !== syncedData) {
        setSyncedData(suppliers.data);
        setRows(suppliers.data.map(toDraftRow));
    }

    function submitSearch(e: FormEvent) {
        e.preventDefault();
        router.get(supplierRoute().url, { search }, { preserveState: true });
    }

    function saveRow(row: DraftRow) {
        if (row.nama.trim() === '') {
            return;
        }

        setRowErrors((prev) => {
            const next = { ...prev };
            delete next[row.key];

            return next;
        });

        const payload = {
            nama: row.nama,
            telepon: row.telepon || null,
            alamat: row.alamat || null,
            keterangan: row.keterangan || null,
        };
        const options = {
            preserveState: true,
            onError: (errors: Record<string, string>) =>
                setRowErrors((prev) => ({ ...prev, [row.key]: errors })),
        };

        if (row.id === null) {
            router.post(SupplierController.store.url(), payload, options);
        } else {
            router.put(
                SupplierController.update.url(row.id),
                payload,
                options,
            );
        }
    }

    function handleRowsChange(
        newRows: DraftRow[],
        data: RowsChangeData<DraftRow>,
    ) {
        setRows(newRows);
        saveRow(newRows[data.indexes[0]]);
    }

    async function deleteSupplier(row: DraftRow) {
        if (row.id === null) {
            setRows((prev) => prev.filter((r) => r.key !== row.key));

            return;
        }

        const ok = await confirm({
            title: 'Hapus Supplier',
            description: `Hapus supplier "${row.nama}"?`,
            confirmLabel: 'Hapus',
            destructive: true,
        });

        if (!ok) {
            return;
        }

        router.delete(SupplierController.destroy.url(row.id), {
            preserveState: true,
        });
    }

    const namaWidth = Math.max(
        MIN_NAMA_WIDTH,
        gridWidth - OTHER_COLUMNS_WIDTH - 2,
    );

    const columns: Column<DraftRow>[] = [
        textColumn('nama', 'Nama', rowErrors, namaWidth),
        textColumn('telepon', 'Telepon', rowErrors, 140),
        textColumn('alamat', 'Alamat', rowErrors, 200),
        textColumn('keterangan', 'Keterangan', rowErrors, 150),
        {
            key: 'purchases_count',
            name: 'Jumlah Pembelian',
            width: 130,
            renderCell: ({ row }) => (
                <span className="text-muted-foreground">
                    {row.purchases_count}
                </span>
            ),
        },
        {
            key: 'aksi',
            name: '',
            width: 90,
            renderCell: ({ row }) => (
                <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => deleteSupplier(row)}
                >
                    Hapus
                </button>
            ),
        },
    ];

    const errorSummary = Object.entries(rowErrors).flatMap(
        ([key, fields]) => {
            const row = rows.find((r) => r.key === key);

            return Object.values(fields).map(
                (message) => `${row?.nama || 'Baris baru'}: ${message}`,
            );
        },
    );

    return (
        <>
            <Head title="Supplier" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                {errorSummary.length > 0 && (
                    <div className="space-y-1 text-sm text-destructive">
                        {errorSummary.map((message, i) => (
                            <p key={i}>{message}</p>
                        ))}
                    </div>
                )}

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
                    <Button
                        type="button"
                        onClick={() => setRows((prev) => [...prev, emptyRow()])}
                    >
                        Tambah Supplier
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
                            onRowsChange={handleRowsChange}
                            style={{
                                blockSize: gridHeight,
                                minHeight: 300,
                            }}
                        />
                    )}
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

            {ConfirmDialog}
        </>
    );
}

Supplier.layout = {
    breadcrumbs: [{ title: 'Supplier', href: supplierRoute() }],
};
