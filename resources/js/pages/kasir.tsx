import { Head, Link, router } from '@inertiajs/react';
import {
    Banknote,
    CornerDownLeft,
    HandCoins,
    Printer,
    Search,
    ShoppingCart,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DataGrid } from 'react-data-grid';
import type {
    Column,
    DataGridHandle,
    RenderEditCellProps,
    RowsChangeData,
} from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import SaleController from '@/actions/App/Http/Controllers/SaleController';
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
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useAppearance } from '@/hooks/use-appearance';
import { useElementWidth } from '@/hooks/use-element-width';
import { cn, formatRupiah } from '@/lib/utils';
import { Receipt } from '@/pages/kasir/shared';
import type { Sale } from '@/pages/kasir/shared';
import { kasir } from '@/routes';

type ProductUnitOption = {
    id: number;
    satuan: string;
    konversi: number;
    harga_jual: string;
};

type PriceTier = {
    id: number;
    min_qty: number;
    harga_jual: string;
};

type Product = {
    id: number;
    kode_item: string;
    barcode: string | null;
    nama_item: string;
    satuan: string;
    harga_jual: string;
    stok: number;
    product_units: ProductUnitOption[];
    price_tiers: PriceTier[];
};

/** the base unit is represented as productUnitId: null */
type CartLine = {
    key: string;
    product: Product;
    productUnitId: number | null;
    satuan: string;
    qty: number;
};

/** resolve the price for a cart line - fixed for a derived unit, tiered by qty for the base unit */
function unitPrice(line: CartLine): number {
    if (line.productUnitId !== null) {
        const unit = line.product.product_units.find(
            (u) => u.id === line.productUnitId,
        );

        return Number(unit?.harga_jual ?? line.product.harga_jual);
    }

    const tier = [...line.product.price_tiers]
        .filter((t) => line.qty >= t.min_qty)
        .sort((a, b) => b.min_qty - a.min_qty)[0];

    return Number(tier?.harga_jual ?? line.product.harga_jual);
}

function lineKey(productId: number, productUnitId: number | null): string {
    return `${productId}:${productUnitId ?? 'base'}`;
}

function unitKonversi(line: CartLine): number {
    if (line.productUnitId === null) {
        return 1;
    }

    return (
        line.product.product_units.find((u) => u.id === line.productUnitId)
            ?.konversi ?? 1
    );
}

const QTY_EPSILON = 1e-6;

/** index of the 'qty' column within cartColumns (produk, satuan, harga, qty, subtotal, aksi) */
const QTY_COLUMN_IDX = 3;

/**
 * Picks the cleanest satuan for a quantity expressed in the product's base
 * unit: the one with the largest konversi that still divides evenly, so
 * typing e.g. 0.1 DUS (= 1 RNTNG at the base) resolves to "1 RNTNG" rather
 * than staying "0.1 DUS", and typing 10 RNTNG while on the base unit
 * resolves up to "1 DUS". Falls back to rounding at the base unit when
 * nothing divides evenly (a true fractional amount with no matching unit).
 */
function pickUnitForBaseQty(
    product: Product,
    baseQty: number,
): { productUnitId: number | null; qty: number; satuan: string } {
    const candidates = [
        { id: null as number | null, satuan: product.satuan, konversi: 1 },
        ...product.product_units.map((u) => ({
            id: u.id as number | null,
            satuan: u.satuan,
            konversi: u.konversi,
        })),
    ];

    const exact = candidates
        .filter((c) => {
            const q = baseQty / c.konversi;

            return Math.abs(q - Math.round(q)) < QTY_EPSILON;
        })
        .sort((a, b) => b.konversi - a.konversi);

    const best = exact[0] ?? candidates[0];
    const resolvedBaseQty = exact[0]
        ? baseQty
        : Math.max(1, Math.round(baseQty));

    return {
        productUnitId: best.id,
        qty: Math.max(1, Math.round(resolvedBaseQty / best.konversi)),
        satuan: best.satuan,
    };
}

/** typedQty is in whatever satuan the line currently has selected */
function resolveLineQty(line: CartLine, typedQty: number) {
    const baseQty = typedQty * unitKonversi(line);

    return pickUnitForBaseQty(line.product, baseQty);
}

function focusAndSelectQtyInput(input: HTMLInputElement | null) {
    input?.focus();
    input?.select();
}

function renderQtyEditCell({
    row,
    onRowChange,
    onClose,
}: RenderEditCellProps<CartLine>) {
    return (
        <input
            type="text"
            inputMode="decimal"
            ref={focusAndSelectQtyInput}
            value={row.qty}
            title="Boleh diisi pecahan, misalnya 0.5 - otomatis dibulatkan ke satuan yang pas"
            className="h-full w-full bg-background px-2 text-center text-sm font-semibold outline-none"
            onChange={(e) =>
                onRowChange({ ...row, qty: Number(e.target.value) || 0 })
            }
            onBlur={() => onClose(true, false)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    onClose(true, false);
                } else if (e.key === 'Escape') {
                    onClose(false);
                }
            }}
        />
    );
}

export default function Kasir({ products }: { products: Product[] }) {
    const [cart, setCart] = useState<CartLine[]>([]);
    const [scanError, setScanError] = useState('');
    const [metode, setMetode] = useState<'tunai' | 'bon'>('tunai');
    const [namaPelanggan, setNamaPelanggan] = useState('');
    const [dibayar, setDibayar] = useState('');
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const { resolvedAppearance } = useAppearance();
    const [cartWidthRef, cartGridWidth] = useElementWidth<HTMLDivElement>();
    const cartGridRef = useRef<DataGridHandle>(null);
    const lastTouchedKeyRef = useRef<string | null>(null);

    const total = useMemo(
        () => cart.reduce((sum, line) => sum + line.qty * unitPrice(line), 0),
        [cart],
    );

    const cartItemCount = useMemo(
        () => cart.reduce((sum, line) => sum + line.qty, 0),
        [cart],
    );

    const paletteResults = useMemo(() => {
        const q = paletteQuery.trim().toLowerCase();

        if (!q) {
            return [];
        }

        return products
            .filter(
                (p) =>
                    p.nama_item.toLowerCase().includes(q) ||
                    p.kode_item.toLowerCase().includes(q),
            )
            .slice(0, 50);
    }, [products, paletteQuery]);

    function addProductToCart(product: Product) {
        const key = lineKey(product.id, null);
        lastTouchedKeyRef.current = key;

        setCart((prev) => {
            const existing = prev.find((i) => i.key === key);

            if (existing) {
                return prev.map((i) =>
                    i.key === key ? { ...i, qty: i.qty + 1 } : i,
                );
            }

            return [
                ...prev,
                {
                    key,
                    product,
                    productUnitId: null,
                    satuan: product.satuan,
                    qty: 1,
                },
            ];
        });
    }

    function changeLineUnit(line: CartLine, productUnitId: number | null) {
        const newKey = lineKey(line.product.id, productUnitId);

        if (newKey === line.key) {
            return;
        }

        setCart((prev) => {
            if (prev.some((i) => i.key === newKey)) {
                // merge into the existing line for that unit instead of duplicating
                return prev
                    .filter((i) => i.key !== line.key)
                    .map((i) =>
                        i.key === newKey ? { ...i, qty: i.qty + line.qty } : i,
                    );
            }

            const unit = line.product.product_units.find(
                (u) => u.id === productUnitId,
            );

            return prev.map((i) =>
                i.key === line.key
                    ? {
                          ...i,
                          key: newKey,
                          productUnitId,
                          satuan: unit?.satuan ?? line.product.satuan,
                      }
                    : i,
            );
        });
    }

    // Hardware scanners type a barcode + Enter almost instantly (unlike a
    // human). We buffer keystrokes globally and treat a fast burst ending in
    // Enter as a scan - only while no input/textarea is focused, so it never
    // fights with normal typing in the search box, payment fields, etc.
    const scanBuffer = useRef('');
    const scanLastKeyAt = useRef(0);

    useEffect(() => {
        function isEditableFocused() {
            const el = document.activeElement;

            return (
                el instanceof HTMLElement &&
                (el.tagName === 'INPUT' ||
                    el.tagName === 'TEXTAREA' ||
                    el.isContentEditable)
            );
        }

        function handleKeydown(e: globalThis.KeyboardEvent) {
            if (isEditableFocused()) {
                return;
            }

            if (e.key === '/' && scanBuffer.current === '') {
                e.preventDefault();
                setPaletteQuery('');
                setPaletteOpen(true);

                return;
            }

            const now = Date.now();

            if (now - scanLastKeyAt.current > 100) {
                scanBuffer.current = '';
            }

            scanLastKeyAt.current = now;

            if (e.key === 'Enter') {
                const code = scanBuffer.current;
                scanBuffer.current = '';

                if (code.length < 4) {
                    // Not a fast scan burst - treat a lone Enter as the
                    // "Bayar" shortcut so checkout can be fully keyboard
                    // driven (scan items, hit Enter, pay). Only when
                    // nothing else is focused, so it doesn't double-fire
                    // alongside a button's own native Enter-activates click.
                    if (
                        cart.length > 0 &&
                        !paymentOpen &&
                        (document.activeElement === document.body ||
                            document.activeElement === null)
                    ) {
                        e.preventDefault();
                        setPaymentOpen(true);
                    }

                    return;
                }

                e.preventDefault();
                const product = products.find((p) => p.barcode === code);

                if (!product) {
                    setScanError(`Barcode "${code}" tidak ditemukan.`);
                } else {
                    setScanError('');
                    addProductToCart(product);
                }

                return;
            }

            if (e.key.length === 1) {
                scanBuffer.current += e.key;
            }
        }

        window.addEventListener('keydown', handleKeydown);

        return () => window.removeEventListener('keydown', handleKeydown);
    }, [products, cart.length, paymentOpen]);

    /** resolves rawQty to the cleanest satuan and merges into an existing line for that satuan if one exists */
    function applyResolvedQty(key: string, rawQty: number) {
        setCart((prev) => {
            const line = prev.find((i) => i.key === key);

            if (!line) {
                return prev;
            }

            const resolved = resolveLineQty(line, rawQty > 0 ? rawQty : 1);
            const newKey = lineKey(line.product.id, resolved.productUnitId);

            if (prev.some((i) => i.key === newKey && i.key !== line.key)) {
                return prev
                    .filter((i) => i.key !== line.key)
                    .map((i) =>
                        i.key === newKey
                            ? { ...i, qty: i.qty + resolved.qty }
                            : i,
                    );
            }

            return prev.map((i) =>
                i.key === line.key
                    ? {
                          ...i,
                          key: newKey,
                          productUnitId: resolved.productUnitId,
                          satuan: resolved.satuan,
                          qty: resolved.qty,
                      }
                    : i,
            );
        });
    }

    function removeFromCart(key: string) {
        setCart((prev) => prev.filter((i) => i.key !== key));
    }

    function clearCart() {
        if (cart.length === 0) {
            return;
        }

        if (!confirm('Kosongkan keranjang?')) {
            return;
        }

        setCart([]);
    }

    function handleCartRowsChange(
        newRows: CartLine[],
        { indexes }: RowsChangeData<CartLine>,
    ) {
        const editedRow = newRows[indexes[0]];

        applyResolvedQty(editedRow.key, editedRow.qty);
    }

    function focusCartQty(key: string | null) {
        if (!key) {
            return;
        }

        const rowIdx = cart.findIndex((line) => line.key === key);

        if (rowIdx === -1) {
            return;
        }

        cartGridRef.current?.setActivePosition(
            { rowIdx, idx: QTY_COLUMN_IDX },
            { shouldFocus: true },
        );
    }

    function resetAfterCheckout() {
        setPaymentOpen(false);
        setCart([]);
        setNamaPelanggan('');
        setDibayar('');
    }

    function checkout(shouldPrint: boolean) {
        setProcessing(true);
        setErrors({});
        router.post(
            SaleController.store.url(),
            {
                metode_pembayaran: metode,
                nama_pelanggan: metode === 'bon' ? namaPelanggan : null,
                dibayar: metode === 'tunai' ? dibayar : null,
                items: cart.map((line) => ({
                    product_id: line.product.id,
                    product_unit_id: line.productUnitId,
                    qty: line.qty,
                })),
            },
            {
                // The redirect after checkout lands back on this same page -
                // without `only`, that reloads the entire product catalog
                // (1000+ rows) just to get the fresh sale for the receipt.
                only: ['sales'],
                onSuccess: (page) => {
                    if (shouldPrint) {
                        // Keep the dialog open (showing this sale's totals)
                        // until printing actually finishes - it resets and
                        // closes from the print effect below instead.
                        const freshSales = (
                            page.props as unknown as { sales: Sale[] }
                        ).sales;

                        if (freshSales?.[0]) {
                            setReceiptSale(freshSales[0]);
                        }

                        return;
                    }

                    resetAfterCheckout();
                },
                onError: (e) => setErrors(e as Record<string, string>),
                onFinish: () => setProcessing(false),
            },
        );
    }

    // Print via the browser's own print dialog/spooler rather than raw
    // ESC/POS - works with any printer already installed on the till PC
    // (including a thermal printer set up as a normal Windows/USB printer),
    // no extra dependency, and the OS print queue naturally serializes
    // struk one at a time if several are triggered in a row.
    useEffect(() => {
        if (!receiptSale) {
            return;
        }

        let finished = false;

        function finish() {
            if (finished) {
                return;
            }

            finished = true;
            setReceiptSale(null);
            resetAfterCheckout();
        }

        window.print();

        // Neither afterprint nor the window regaining focus fires reliably
        // in every browser/OS combination - a hard timeout guarantees the
        // UI never gets stuck showing "Mencetak struk..." forever even if
        // both of those signals fail to fire.
        window.addEventListener('afterprint', finish, { once: true });
        window.addEventListener('focus', finish, { once: true });
        const timeout = window.setTimeout(finish, 5000);

        return () => {
            window.removeEventListener('afterprint', finish);
            window.removeEventListener('focus', finish);
            window.clearTimeout(timeout);
        };
    }, [receiptSale]);

    const CART_OTHER_COLUMNS_WIDTH = 180 + 120 + 80 + 130 + 50;
    const produkWidth = Math.max(
        160,
        cartGridWidth - CART_OTHER_COLUMNS_WIDTH - 2,
    );

    const cartColumns: Column<CartLine>[] = [
        {
            key: 'produk',
            name: 'Produk',
            width: produkWidth,
            renderCell: ({ row }) => (
                <span className="font-medium">{row.product.nama_item}</span>
            ),
        },
        {
            key: 'satuan',
            name: 'Satuan',
            width: 180,
            renderCell: ({ row }) =>
                row.product.product_units.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1 py-1">
                        <button
                            type="button"
                            onClick={() => changeLineUnit(row, null)}
                            className={cn(
                                'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                                row.productUnitId === null
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-input bg-background hover:bg-accent',
                            )}
                        >
                            {row.product.satuan}
                        </button>
                        {row.product.product_units.map((unit) => (
                            <button
                                key={unit.id}
                                type="button"
                                onClick={() => changeLineUnit(row, unit.id)}
                                className={cn(
                                    'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                                    row.productUnitId === unit.id
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-input bg-background hover:bg-accent',
                                )}
                            >
                                {unit.satuan}
                            </button>
                        ))}
                    </div>
                ) : (
                    <span className="text-xs text-muted-foreground">
                        {row.satuan}
                    </span>
                ),
        },
        {
            key: 'harga',
            name: 'Harga',
            width: 120,
            renderCell: ({ row }) => (
                <span className="text-xs text-muted-foreground">
                    {formatRupiah(unitPrice(row))}
                </span>
            ),
        },
        {
            key: 'qty',
            name: 'Qty',
            width: 80,
            editable: true,
            renderEditCell: renderQtyEditCell,
            renderCell: ({ row }) => (
                <span
                    className="text-sm font-semibold"
                    title="Boleh diisi pecahan, misalnya 0.5 - otomatis dibulatkan ke satuan yang pas"
                >
                    {row.qty}
                </span>
            ),
        },
        {
            key: 'subtotal',
            name: 'Subtotal',
            width: 130,
            renderCell: ({ row }) => (
                <span className="font-semibold">
                    {formatRupiah(row.qty * unitPrice(row))}
                </span>
            ),
        },
        {
            key: 'aksi',
            name: '',
            width: 50,
            renderCell: ({ row }) => (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeFromCart(row.key)}
                >
                    <X className="size-4" />
                </Button>
            ),
        },
    ];

    return (
        <>
            <Head title="Penjualan" />
            <div className="flex-1 space-y-4 p-4 sm:p-6">
                <div className="flex justify-end">
                    <Button asChild variant="outline" size="sm">
                        <Link href={SaleController.history()}>
                            Riwayat Transaksi
                        </Link>
                    </Button>
                </div>

                {scanError && <InputError message={scanError} />}

                <div className="flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 font-semibold">
                        <ShoppingCart className="size-4" />
                        Keranjang
                        {cartItemCount > 0 && (
                            <Badge variant="secondary">{cartItemCount}</Badge>
                        )}
                    </h2>
                    <div className="flex items-center gap-2">
                        {cart.length > 0 && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={clearCart}
                            >
                                <Trash2 className="size-3.5" />
                                Kosongkan
                            </Button>
                        )}
                        <Button
                            type="button"
                            onClick={() => {
                                setPaletteQuery('');
                                setPaletteOpen(true);
                            }}
                        >
                            <Search className="size-4" />
                            Cari / Tambah Produk
                            <kbd className="ml-1 rounded border border-primary-foreground/30 px-1.5 py-0.5 text-xs">
                                /
                            </kbd>
                        </Button>
                    </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
                            <ShoppingCart className="size-8 opacity-40" />
                            Keranjang kosong. Scan barcode atau cari produk
                            untuk mulai.
                        </div>
                    ) : (
                        <div ref={cartWidthRef}>
                            {cartGridWidth > 0 && (
                                <DataGrid
                                    ref={cartGridRef}
                                    className={
                                        resolvedAppearance === 'dark'
                                            ? 'rdg-dark'
                                            : 'rdg-light'
                                    }
                                    columns={cartColumns}
                                    rows={cart}
                                    onRowsChange={handleCartRowsChange}
                                    rowKeyGetter={(row) => row.key}
                                    headerRowHeight={44}
                                    rowHeight={48}
                                    style={{
                                        blockSize: 44 + cart.length * 48 + 2,
                                    }}
                                />
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between rounded-xl border border-sidebar-border/70 p-4 dark:border-sidebar-border">
                    <span className="text-muted-foreground">Total</span>
                    <span className="text-2xl font-bold">
                        {formatRupiah(total)}
                    </span>
                    <Button
                        type="button"
                        size="lg"
                        className="h-14 px-10 text-lg"
                        disabled={cart.length === 0}
                        onClick={() => setPaymentOpen(true)}
                    >
                        Bayar
                    </Button>
                </div>

                <PaymentDialog
                    open={paymentOpen}
                    onOpenChange={setPaymentOpen}
                    total={total}
                    metode={metode}
                    setMetode={setMetode}
                    namaPelanggan={namaPelanggan}
                    setNamaPelanggan={setNamaPelanggan}
                    dibayar={dibayar}
                    setDibayar={setDibayar}
                    processing={processing}
                    printing={receiptSale !== null}
                    errors={errors}
                    onSubmit={checkout}
                />

                <CommandDialog
                    open={paletteOpen}
                    onOpenChange={setPaletteOpen}
                    onCloseAutoFocus={(e) => {
                        e.preventDefault();
                        focusCartQty(lastTouchedKeyRef.current);
                    }}
                    title="Cari Produk"
                    description="Cari produk untuk ditambahkan ke keranjang"
                    shouldFilter={false}
                >
                    <CommandInput
                        value={paletteQuery}
                        onValueChange={setPaletteQuery}
                        onKeyDown={(e) => {
                            if (e.key === 'PageDown' || e.key === 'PageUp') {
                                e.preventDefault();
                                e.currentTarget.dispatchEvent(
                                    new KeyboardEvent('keydown', {
                                        key:
                                            e.key === 'PageDown'
                                                ? 'ArrowDown'
                                                : 'ArrowUp',
                                        bubbles: true,
                                    }),
                                );

                                return;
                            }

                            if (e.key !== 'Enter') {
                                return;
                            }

                            const code = paletteQuery.trim();
                            const product = products.find(
                                (p) => p.barcode === code,
                            );

                            if (!product) {
                                return;
                            }

                            e.preventDefault();
                            addProductToCart(product);
                            setPaletteQuery('');
                        }}
                        placeholder="Cari nama / kode produk..."
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
                                        disabled={product.stok <= 0}
                                        onSelect={() => {
                                            addProductToCart(product);
                                            setPaletteQuery('');
                                        }}
                                        className="flex items-center justify-between"
                                    >
                                        <span>
                                            <span className="font-medium">
                                                {product.nama_item}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {' '}
                                                &middot; {product.kode_item}
                                            </span>
                                        </span>
                                        <span className="flex items-center gap-2 text-xs">
                                            {formatRupiah(product.harga_jual)} /{' '}
                                            {product.satuan}
                                            {product.stok <= 0 && (
                                                <span className="text-destructive">
                                                    Habis
                                                </span>
                                            )}
                                        </span>
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
                            <kbd className="rounded border bg-muted px-1.5 py-0.5">
                                PgUp/PgDn
                            </kbd>
                            pilih
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border bg-muted px-1.5 py-0.5">
                                &crarr;
                            </kbd>
                            tambah
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border bg-muted px-1.5 py-0.5">
                                esc
                            </kbd>
                            tutup
                        </span>
                    </div>
                </CommandDialog>
            </div>

            {receiptSale && <Receipt sale={receiptSale} />}
        </>
    );
}

function PaymentDialog({
    open,
    onOpenChange,
    total,
    metode,
    setMetode,
    namaPelanggan,
    setNamaPelanggan,
    dibayar,
    setDibayar,
    processing,
    printing,
    errors,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    total: number;
    metode: 'tunai' | 'bon';
    setMetode: (metode: 'tunai' | 'bon') => void;
    namaPelanggan: string;
    setNamaPelanggan: (value: string) => void;
    dibayar: string;
    setDibayar: (value: string) => void;
    processing: boolean;
    printing: boolean;
    errors: Record<string, string>;
    onSubmit: (shouldPrint: boolean) => void;
}) {
    const totalBayar = metode === 'tunai' ? Number(dibayar || 0) : 0;
    const selisih = total - totalBayar;
    const isLunas = metode === 'tunai' && selisih <= 0;
    const disabled = processing || printing;

    // PageUp/PageDown cycle which action Enter will fire, so the whole
    // dialog can be driven without a mouse: type the amount, PgDn/PgUp to
    // the action you want, Enter to run it. Alt+letter shortcuts don't type
    // into focused inputs, so those work regardless of what's focused too.
    const actions = ['cetak', 'simpan', 'batal'] as const;
    type Action = (typeof actions)[number];
    const [selectedAction, setSelectedAction] = useState<Action>('cetak');
    const [prevOpen, setPrevOpen] = useState(open);

    if (open !== prevOpen) {
        setPrevOpen(open);

        if (open) {
            setSelectedAction('cetak');
        }
    }

    function runAction(action: Action) {
        if (action === 'cetak') {
            onSubmit(true);
        } else if (action === 'simpan') {
            onSubmit(false);
        } else {
            onOpenChange(false);
        }
    }

    function handleShortcut(e: ReactKeyboardEvent) {
        if (disabled) {
            return;
        }

        if (e.key === 'PageDown' || e.key === 'PageUp') {
            e.preventDefault();
            const index = actions.indexOf(selectedAction);
            const delta = e.key === 'PageDown' ? 1 : -1;
            setSelectedAction(
                actions[(index + delta + actions.length) % actions.length],
            );

            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            runAction(selectedAction);

            return;
        }

        if (!e.altKey) {
            return;
        }

        switch (e.key.toLowerCase()) {
            case 't':
                e.preventDefault();
                setMetode('tunai');
                break;
            case 'b':
                e.preventDefault();
                setMetode('bon');
                break;
            case 's':
                e.preventDefault();
                onSubmit(false);
                break;
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[46rem]">
                <DialogHeader>
                    <DialogTitle>Pembayaran</DialogTitle>
                </DialogHeader>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSubmit(true);
                    }}
                    onKeyDown={handleShortcut}
                    className="space-y-5"
                >
                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            type="button"
                            variant={metode === 'tunai' ? 'default' : 'outline'}
                            disabled={disabled}
                            onClick={() => setMetode('tunai')}
                        >
                            <Banknote className="size-4" />
                            Tunai
                            <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">
                                Alt+T
                            </kbd>
                        </Button>
                        <Button
                            type="button"
                            variant={metode === 'bon' ? 'default' : 'outline'}
                            disabled={disabled}
                            onClick={() => setMetode('bon')}
                        >
                            <HandCoins className="size-4" />
                            Bon
                            <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">
                                Alt+B
                            </kbd>
                        </Button>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-foreground px-5 py-4">
                        <span className="text-sm text-background/60">
                            Total Tagihan
                        </span>
                        <span className="text-4xl font-bold text-background tabular-nums">
                            {formatRupiah(total)}
                        </span>
                    </div>

                    {metode === 'tunai' ? (
                        <div className="grid gap-2">
                            <Label htmlFor="dibayar">Uang Tunai</Label>
                            <Input
                                id="dibayar"
                                autoFocus
                                inputMode="numeric"
                                placeholder="0"
                                value={dibayar}
                                disabled={disabled}
                                onChange={(e) => setDibayar(e.target.value)}
                                className="h-16 text-right text-2xl font-semibold tabular-nums"
                            />
                            <InputError message={errors.dibayar} />
                        </div>
                    ) : (
                        <div className="grid gap-2">
                            <Label htmlFor="nama_pelanggan">
                                Nama Pelanggan
                            </Label>
                            <Input
                                id="nama_pelanggan"
                                autoFocus
                                value={namaPelanggan}
                                disabled={disabled}
                                onChange={(e) =>
                                    setNamaPelanggan(e.target.value)
                                }
                                className="h-16 text-xl"
                            />
                            <InputError message={errors.nama_pelanggan} />
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex items-center justify-between rounded-xl bg-green-500/15 px-5 py-3.5 dark:bg-green-500/20">
                            <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                                {metode === 'tunai' ? 'Dibayar' : 'Bon'}
                            </span>
                            <span className="text-2xl font-bold text-green-700 tabular-nums dark:text-green-400">
                                {formatRupiah(totalBayar)}
                            </span>
                        </div>

                        <div
                            className={cn(
                                'flex items-center justify-between rounded-xl px-5 py-3.5',
                                isLunas
                                    ? 'bg-green-500/15 dark:bg-green-500/20'
                                    : 'bg-orange-500/15 dark:bg-orange-500/20',
                            )}
                        >
                            <span
                                className={cn(
                                    'text-sm font-semibold',
                                    isLunas
                                        ? 'text-green-700 dark:text-green-400'
                                        : 'text-orange-700 dark:text-orange-400',
                                )}
                            >
                                {isLunas ? 'Kembalian' : 'Kekurangan'}
                            </span>
                            <span
                                className={cn(
                                    'text-2xl font-bold tabular-nums',
                                    isLunas
                                        ? 'text-green-700 dark:text-green-400'
                                        : 'text-orange-700 dark:text-orange-400',
                                )}
                            >
                                {formatRupiah(Math.abs(selisih))}
                            </span>
                        </div>
                    </div>

                    <InputError message={errors.items} />

                    {printing ? (
                        <div className="flex items-center justify-center gap-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                            <Spinner />
                            Mencetak struk...
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Button
                                type="submit"
                                disabled={disabled}
                                className={cn(
                                    'w-full',
                                    selectedAction === 'cetak' &&
                                        'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                                )}
                            >
                                {selectedAction === 'cetak' && (
                                    <CornerDownLeft className="size-4" />
                                )}
                                <Printer className="size-4" />
                                Simpan + Cetak
                            </Button>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={disabled}
                                    className={cn(
                                        selectedAction === 'simpan' &&
                                            'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                                    )}
                                    onClick={() => onSubmit(false)}
                                >
                                    {selectedAction === 'simpan' && (
                                        <CornerDownLeft className="size-3.5" />
                                    )}
                                    Simpan
                                    <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">
                                        Alt+S
                                    </kbd>
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={disabled}
                                    className={cn(
                                        selectedAction === 'batal' &&
                                            'ring-2 ring-yellow-500 ring-offset-2 ring-offset-background',
                                    )}
                                    onClick={() => onOpenChange(false)}
                                >
                                    {selectedAction === 'batal' && (
                                        <CornerDownLeft className="size-3.5" />
                                    )}
                                    Batal
                                    <kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-70">
                                        Esc
                                    </kbd>
                                </Button>
                            </div>
                            <p className="text-center text-xs text-muted-foreground">
                                <kbd className="rounded border bg-muted px-1.5 py-0.5">
                                    PgUp/PgDn
                                </kbd>{' '}
                                pilih aksi &middot;{' '}
                                <kbd className="rounded border bg-muted px-1.5 py-0.5">
                                    Enter
                                </kbd>{' '}
                                jalankan
                            </p>
                        </div>
                    )}
                </form>
            </DialogContent>
        </Dialog>
    );
}

Kasir.layout = {
    breadcrumbs: [{ title: 'Penjualan', href: kasir() }],
};
