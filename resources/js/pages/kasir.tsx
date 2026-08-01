import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import SaleController from '@/actions/App/Http/Controllers/SaleController';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatRupiah } from '@/lib/utils';
import { Receipt } from '@/pages/kasir/shared';
import type { Sale } from '@/pages/kasir/shared';
import { kasir } from '@/routes';

type Category = { id: number; nama: string };

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
    category_id: number | null;
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

/** numpad target: the cash field, a cart line's qty, or nothing selected */
type NumpadTarget = 'dibayar' | { key: string } | null;

function lineKey(productId: number, productUnitId: number | null): string {
    return `${productId}:${productUnitId ?? 'base'}`;
}

export default function Kasir({
    products,
    categories,
}: {
    products: Product[];
    categories: Category[];
}) {
    const [cart, setCart] = useState<CartLine[]>([]);
    const [categoryId, setCategoryId] = useState<number | null>(null);
    const [productSearch, setProductSearch] = useState('');
    const [scanError, setScanError] = useState('');
    const [metode, setMetode] = useState<'tunai' | 'bon'>('tunai');
    const [namaPelanggan, setNamaPelanggan] = useState('');
    const [dibayar, setDibayar] = useState('');
    const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>('dibayar');
    const [numpadFresh, setNumpadFresh] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
    const [paymentOpen, setPaymentOpen] = useState(false);

    const total = useMemo(
        () => cart.reduce((sum, line) => sum + line.qty * unitPrice(line), 0),
        [cart],
    );

    // ponytail: no virtualization yet, fine up to a few hundred products per category - revisit if a category grows past ~1-2k items
    const visibleProducts = useMemo(() => {
        const q = productSearch.trim().toLowerCase();

        return products.filter((p) => {
            if (categoryId !== null && p.category_id !== categoryId) {
                return false;
            }

            if (!q) {
                return true;
            }

            return (
                p.nama_item.toLowerCase().includes(q) ||
                p.kode_item.toLowerCase().includes(q)
            );
        });
    }, [products, categoryId, productSearch]);

    function addProductToCart(product: Product) {
        const key = lineKey(product.id, null);

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
    // fights with normal typing in the search box, numpad fields, etc.
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

            const now = Date.now();

            if (now - scanLastKeyAt.current > 100) {
                scanBuffer.current = '';
            }

            scanLastKeyAt.current = now;

            if (e.key === 'Enter') {
                const code = scanBuffer.current;
                scanBuffer.current = '';

                if (code.length < 4) {
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
    }, [products]);

    function changeQty(key: string, delta: number) {
        setCart((prev) =>
            prev
                .map((i) => (i.key === key ? { ...i, qty: i.qty + delta } : i))
                .filter((i) => i.qty > 0),
        );
    }

    function removeFromCart(key: string) {
        setCart((prev) => prev.filter((i) => i.key !== key));
    }

    function selectNumpadTarget(target: NumpadTarget) {
        setNumpadTarget(target);
        setNumpadFresh(true);
    }

    function pressDigit(digit: string) {
        if (numpadTarget === 'dibayar') {
            setDibayar((prev) => (numpadFresh ? digit : prev + digit));
        } else if (numpadTarget) {
            const { key } = numpadTarget;
            setCart((prev) =>
                prev.map((i) =>
                    i.key === key
                        ? {
                              ...i,
                              qty:
                                  Number(
                                      (numpadFresh ? '' : i.qty.toString()) +
                                          digit,
                                  ) || 1,
                          }
                        : i,
                ),
            );
        }

        setNumpadFresh(false);
    }

    function pressBackspace() {
        if (numpadTarget === 'dibayar') {
            setDibayar((prev) => prev.slice(0, -1));
        } else if (numpadTarget) {
            const { key } = numpadTarget;
            setCart((prev) =>
                prev.map((i) =>
                    i.key === key
                        ? { ...i, qty: Math.floor(i.qty / 10) || 1 }
                        : i,
                ),
            );
        }

        setNumpadFresh(false);
    }

    function pressClear() {
        if (numpadTarget === 'dibayar') {
            setDibayar('');
        } else if (numpadTarget) {
            const { key } = numpadTarget;
            setCart((prev) =>
                prev.map((i) => (i.key === key ? { ...i, qty: 1 } : i)),
            );
        }

        setNumpadFresh(true);
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
                onSuccess: (page) => {
                    if (shouldPrint) {
                        const freshSales = (
                            page.props as unknown as { sales: Sale[] }
                        ).sales;

                        if (freshSales?.[0]) {
                            setReceiptSale(freshSales[0]);
                        }
                    }

                    setPaymentOpen(false);
                    setCart([]);
                    setNamaPelanggan('');
                    setDibayar('');
                    selectNumpadTarget('dibayar');
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

        window.print();

        function clearAfterPrint() {
            setReceiptSale(null);
        }

        window.addEventListener('afterprint', clearAfterPrint, {
            once: true,
        });

        return () => window.removeEventListener('afterprint', clearAfterPrint);
    }, [receiptSale]);

    return (
        <>
            <Head title="Kasir" />
            <div className="flex-1 space-y-6 p-4 sm:p-6">
                <div className="flex justify-end">
                    <Button asChild variant="outline" size="sm">
                        <Link href={SaleController.history()}>
                            Riwayat Transaksi
                        </Link>
                    </Button>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
                    <div className="space-y-4">
                        {scanError && <InputError message={scanError} />}

                        <Input
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            placeholder="Cari nama / kode produk..."
                            className="h-12 text-base"
                        />
                        <p className="text-xs text-muted-foreground">
                            Scan barcode kapan saja (asal tidak sedang mengetik
                            di kolom lain) - otomatis masuk keranjang.
                        </p>

                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={
                                    categoryId === null ? 'default' : 'outline'
                                }
                                onClick={() => setCategoryId(null)}
                            >
                                Semua
                            </Button>
                            {categories.map((category) => (
                                <Button
                                    key={category.id}
                                    type="button"
                                    size="sm"
                                    variant={
                                        categoryId === category.id
                                            ? 'default'
                                            : 'outline'
                                    }
                                    onClick={() => setCategoryId(category.id)}
                                >
                                    {category.nama}
                                </Button>
                            ))}
                        </div>

                        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
                            {visibleProducts.map((product) => (
                                <button
                                    key={product.id}
                                    type="button"
                                    disabled={product.stok <= 0}
                                    onClick={() => addProductToCart(product)}
                                    className="flex flex-col items-start gap-1 rounded-xl border border-sidebar-border/70 p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-sidebar-border"
                                >
                                    <span className="line-clamp-2 text-sm font-medium">
                                        {product.nama_item}
                                    </span>
                                    <span className="text-base font-semibold">
                                        {formatRupiah(product.harga_jual)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        Stok {product.stok}
                                    </span>
                                </button>
                            ))}
                            {visibleProducts.length === 0 && (
                                <p className="col-span-full p-8 text-center text-muted-foreground">
                                    Produk tidak ditemukan.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-4">
                        <div className="max-h-64 overflow-y-auto rounded-xl border border-sidebar-border/70 dark:border-sidebar-border">
                            {cart.length === 0 ? (
                                <p className="p-6 text-center text-sm text-muted-foreground">
                                    Keranjang kosong.
                                </p>
                            ) : (
                                <div className="divide-y divide-sidebar-border/70 dark:divide-sidebar-border">
                                    {cart.map((line) => (
                                        <div
                                            key={line.key}
                                            className="flex items-center gap-2 p-3"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">
                                                    {line.product.nama_item}
                                                </p>
                                                {line.product.product_units
                                                    .length > 0 ? (
                                                    <select
                                                        value={
                                                            line.productUnitId ??
                                                            ''
                                                        }
                                                        onChange={(e) =>
                                                            changeLineUnit(
                                                                line,
                                                                e.target.value
                                                                    ? Number(
                                                                          e
                                                                              .target
                                                                              .value,
                                                                      )
                                                                    : null,
                                                            )
                                                        }
                                                        className="rounded border-none bg-transparent text-xs text-muted-foreground"
                                                    >
                                                        <option value="">
                                                            {formatRupiah(
                                                                line.product
                                                                    .harga_jual,
                                                            )}{' '}
                                                            /{' '}
                                                            {
                                                                line.product
                                                                    .satuan
                                                            }
                                                        </option>
                                                        {line.product.product_units.map(
                                                            (unit) => (
                                                                <option
                                                                    key={
                                                                        unit.id
                                                                    }
                                                                    value={
                                                                        unit.id
                                                                    }
                                                                >
                                                                    {formatRupiah(
                                                                        unit.harga_jual,
                                                                    )}{' '}
                                                                    /{' '}
                                                                    {
                                                                        unit.satuan
                                                                    }
                                                                </option>
                                                            ),
                                                        )}
                                                    </select>
                                                ) : (
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatRupiah(
                                                            unitPrice(line),
                                                        )}{' '}
                                                        / {line.satuan}
                                                    </p>
                                                )}
                                            </div>

                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                className="size-8"
                                                onClick={() =>
                                                    changeQty(line.key, -1)
                                                }
                                            >
                                                −
                                            </Button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    selectNumpadTarget({
                                                        key: line.key,
                                                    })
                                                }
                                                className={cn(
                                                    'w-8 rounded-md text-center text-base font-semibold',
                                                    typeof numpadTarget ===
                                                        'object' &&
                                                        numpadTarget?.key ===
                                                            line.key &&
                                                        'bg-accent',
                                                )}
                                            >
                                                {line.qty}
                                            </button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                className="size-8"
                                                onClick={() =>
                                                    changeQty(line.key, 1)
                                                }
                                            >
                                                +
                                            </Button>

                                            <p className="w-24 text-right text-sm font-semibold">
                                                {formatRupiah(
                                                    line.qty * unitPrice(line),
                                                )}
                                            </p>

                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                    removeFromCart(line.key)
                                                }
                                            >
                                                ✕
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-4 rounded-xl border border-sidebar-border/70 p-4 dark:border-sidebar-border">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">
                                    Total
                                </span>
                                <span className="text-2xl font-bold">
                                    {formatRupiah(total)}
                                </span>
                            </div>

                            <Button
                                type="button"
                                size="lg"
                                className="h-14 w-full text-lg"
                                disabled={cart.length === 0}
                                onClick={() => setPaymentOpen(true)}
                            >
                                Bayar
                            </Button>
                        </div>
                    </div>
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
                    numpadTarget={numpadTarget}
                    selectNumpadTarget={selectNumpadTarget}
                    pressDigit={pressDigit}
                    pressBackspace={pressBackspace}
                    pressClear={pressClear}
                    processing={processing}
                    errors={errors}
                    onSubmit={checkout}
                />
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
    numpadTarget,
    selectNumpadTarget,
    pressDigit,
    pressBackspace,
    pressClear,
    processing,
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
    numpadTarget: NumpadTarget;
    selectNumpadTarget: (target: NumpadTarget) => void;
    pressDigit: (digit: string) => void;
    pressBackspace: () => void;
    pressClear: () => void;
    processing: boolean;
    errors: Record<string, string>;
    onSubmit: (shouldPrint: boolean) => void;
}) {
    const totalBayar = metode === 'tunai' ? Number(dibayar || 0) : 0;
    const selisih = total - totalBayar;
    const isLunas = metode === 'tunai' && selisih <= 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Pembayaran</DialogTitle>
                </DialogHeader>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSubmit(true);
                    }}
                    className="space-y-4"
                >
                    <div className="rounded-lg bg-yellow-300 p-4 dark:bg-yellow-500/30">
                        <p className="text-sm font-medium text-yellow-950 dark:text-yellow-100">
                            Total
                        </p>
                        <p className="text-3xl font-bold text-yellow-950 dark:text-yellow-50">
                            {formatRupiah(total)}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            type="button"
                            variant={metode === 'tunai' ? 'default' : 'outline'}
                            onClick={() => {
                                setMetode('tunai');
                                selectNumpadTarget('dibayar');
                            }}
                        >
                            Tunai
                        </Button>
                        <Button
                            type="button"
                            variant={metode === 'bon' ? 'default' : 'outline'}
                            onClick={() => {
                                setMetode('bon');
                                selectNumpadTarget(null);
                            }}
                        >
                            Bon
                        </Button>
                    </div>

                    {metode === 'tunai' ? (
                        <div className="grid gap-2">
                            <Label htmlFor="dibayar">Tunai</Label>
                            <Input
                                id="dibayar"
                                inputMode="numeric"
                                value={dibayar}
                                onFocus={() => selectNumpadTarget('dibayar')}
                                onChange={(e) => setDibayar(e.target.value)}
                                className={cn(
                                    'h-12 text-lg',
                                    numpadTarget === 'dibayar' &&
                                        'ring-2 ring-ring',
                                )}
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
                                value={namaPelanggan}
                                onChange={(e) =>
                                    setNamaPelanggan(e.target.value)
                                }
                                className="h-12 text-lg"
                            />
                            <InputError message={errors.nama_pelanggan} />
                        </div>
                    )}

                    <Numpad
                        target={numpadTarget}
                        onDigit={pressDigit}
                        onBackspace={pressBackspace}
                        onClear={pressClear}
                    />

                    <div className="rounded-lg bg-green-300 p-3 dark:bg-green-500/30">
                        <div className="flex items-center justify-between">
                            <span className="font-medium text-green-950 dark:text-green-100">
                                Total Bayar
                            </span>
                            <span className="text-xl font-bold text-green-950 dark:text-green-50">
                                {formatRupiah(totalBayar)}
                            </span>
                        </div>
                    </div>

                    <div
                        className={cn(
                            'rounded-lg p-3',
                            isLunas
                                ? 'bg-green-300 dark:bg-green-500/30'
                                : 'bg-orange-300 dark:bg-orange-500/30',
                        )}
                    >
                        <div className="flex items-center justify-between">
                            <span
                                className={cn(
                                    'font-medium',
                                    isLunas
                                        ? 'text-green-950 dark:text-green-100'
                                        : 'text-orange-950 dark:text-orange-100',
                                )}
                            >
                                {isLunas ? 'Kembalian' : 'Kekurangan'}
                            </span>
                            <span
                                className={cn(
                                    'text-xl font-bold',
                                    isLunas
                                        ? 'text-green-950 dark:text-green-50'
                                        : 'text-orange-950 dark:text-orange-50',
                                )}
                            >
                                {formatRupiah(Math.abs(selisih))}
                            </span>
                        </div>
                    </div>

                    <InputError message={errors.items} />

                    <div className="grid grid-cols-3 gap-2">
                        <Button
                            type="submit"
                            disabled={processing}
                            className="col-span-1"
                        >
                            Simpan + Cetak
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={processing}
                            onClick={() => onSubmit(false)}
                        >
                            Simpan
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Batal
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function Numpad({
    target,
    onDigit,
    onBackspace,
    onClear,
}: {
    target: NumpadTarget;
    onDigit: (digit: string) => void;
    onBackspace: () => void;
    onClear: () => void;
}) {
    const disabled = target === null;

    return (
        <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <Button
                    key={digit}
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    className="h-12 text-lg"
                    onClick={() => onDigit(digit)}
                >
                    {digit}
                </Button>
            ))}
            <Button
                type="button"
                variant="secondary"
                disabled={disabled}
                className="h-12 text-sm"
                onClick={onClear}
            >
                Clear
            </Button>
            <Button
                type="button"
                variant="outline"
                disabled={disabled}
                className="h-12 text-lg"
                onClick={() => onDigit('0')}
            >
                0
            </Button>
            <Button
                type="button"
                variant="secondary"
                disabled={disabled}
                className="h-12 text-sm"
                onClick={onBackspace}
            >
                ⌫
            </Button>
        </div>
    );
}

Kasir.layout = {
    breadcrumbs: [{ title: 'Kasir', href: kasir() }],
};
