import { Head, Link, router } from '@inertiajs/react';
import {
    Banknote,
    HandCoins,
    Minus,
    Plus,
    Printer,
    Search,
    ShoppingCart,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
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

export default function Kasir({
    products,
}: {
    products: Product[];
}) {
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

    function clearCart() {
        if (cart.length === 0) {
            return;
        }

        if (!confirm('Kosongkan keranjang?')) {
            return;
        }

        setCart([]);
    }

    function setLineQty(key: string, qty: number) {
        setCart((prev) =>
            prev.map((i) =>
                i.key === key ? { ...i, qty: Math.max(1, qty || 1) } : i,
            ),
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

        window.print();

        function clearAfterPrint() {
            setReceiptSale(null);
            resetAfterCheckout();
        }

        window.addEventListener('afterprint', clearAfterPrint, {
            once: true,
        });

        return () => window.removeEventListener('afterprint', clearAfterPrint);
    }, [receiptSale]);

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
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-left">
                                    <tr>
                                        <th className="p-3">Produk</th>
                                        <th className="w-40 p-3">Satuan</th>
                                        <th className="w-36 p-3">Qty</th>
                                        <th className="w-32 p-3 text-right">
                                            Subtotal
                                        </th>
                                        <th className="w-10 p-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-sidebar-border/70 dark:divide-sidebar-border">
                                    {cart.map((line) => (
                                        <tr key={line.key}>
                                            <td className="p-3 font-medium">
                                                {line.product.nama_item}
                                            </td>
                                            <td className="p-3">
                                                {line.product.product_units
                                                    .length > 0 ? (
                                                    <Select
                                                        value={(
                                                            line.productUnitId ??
                                                            0
                                                        ).toString()}
                                                        onValueChange={(
                                                            value,
                                                        ) =>
                                                            changeLineUnit(
                                                                line,
                                                                value === '0'
                                                                    ? null
                                                                    : Number(
                                                                          value,
                                                                      ),
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger className="h-8 w-full gap-1 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="0">
                                                                {formatRupiah(
                                                                    line.product
                                                                        .harga_jual,
                                                                )}{' '}
                                                                /{' '}
                                                                {
                                                                    line.product
                                                                        .satuan
                                                                }
                                                            </SelectItem>
                                                            {line.product.product_units.map(
                                                                (unit) => (
                                                                    <SelectItem
                                                                        key={
                                                                            unit.id
                                                                        }
                                                                        value={unit.id.toString()}
                                                                    >
                                                                        {formatRupiah(
                                                                            unit.harga_jual,
                                                                        )}{' '}
                                                                        /{' '}
                                                                        {
                                                                            unit.satuan
                                                                        }
                                                                    </SelectItem>
                                                                ),
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatRupiah(
                                                            unitPrice(line),
                                                        )}{' '}
                                                        / {line.satuan}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3">
                                                <div className="flex items-center gap-1">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        className="size-8"
                                                        onClick={() =>
                                                            changeQty(
                                                                line.key,
                                                                -1,
                                                            )
                                                        }
                                                    >
                                                        <Minus className="size-3.5" />
                                                    </Button>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={line.qty}
                                                        onChange={(e) =>
                                                            setLineQty(
                                                                line.key,
                                                                Number(
                                                                    e.target
                                                                        .value,
                                                                ),
                                                            )
                                                        }
                                                        className="h-8 w-14 px-1 text-center text-base font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        className="size-8"
                                                        onClick={() =>
                                                            changeQty(
                                                                line.key,
                                                                1,
                                                            )
                                                        }
                                                    >
                                                        <Plus className="size-3.5" />
                                                    </Button>
                                                </div>
                                            </td>
                                            <td className="p-3 text-right font-semibold">
                                                {formatRupiah(
                                                    line.qty * unitPrice(line),
                                                )}
                                            </td>
                                            <td className="p-3">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-muted-foreground hover:text-destructive"
                                                    onClick={() =>
                                                        removeFromCart(
                                                            line.key,
                                                        )
                                                    }
                                                >
                                                    <X className="size-4" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
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
                    title="Cari Produk"
                    description="Cari produk untuk ditambahkan ke keranjang"
                    shouldFilter={false}
                >
                    <CommandInput
                        value={paletteQuery}
                        onValueChange={setPaletteQuery}
                        onKeyDown={(e) => {
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
                                            {formatRupiah(
                                                product.harga_jual,
                                            )}
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Pembayaran</DialogTitle>
                </DialogHeader>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSubmit(true);
                    }}
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
                        </Button>
                        <Button
                            type="button"
                            variant={metode === 'bon' ? 'default' : 'outline'}
                            disabled={disabled}
                            onClick={() => setMetode('bon')}
                        >
                            <HandCoins className="size-4" />
                            Bon
                        </Button>
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
                                className="h-12 text-lg"
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
                                className="h-12 text-lg"
                            />
                            <InputError message={errors.nama_pelanggan} />
                        </div>
                    )}

                    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                                Total Tagihan
                            </span>
                            <span className="text-2xl font-bold">
                                {formatRupiah(total)}
                            </span>
                        </div>

                        <Separator />

                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                                {metode === 'tunai' ? 'Dibayar' : 'Bon'}
                            </span>
                            <span className="text-base font-semibold">
                                {formatRupiah(totalBayar)}
                            </span>
                        </div>

                        <div className="flex items-center justify-between">
                            <span
                                className={cn(
                                    'text-sm font-medium',
                                    isLunas
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-orange-600 dark:text-orange-400',
                                )}
                            >
                                {isLunas ? 'Kembalian' : 'Kekurangan'}
                            </span>
                            <span
                                className={cn(
                                    'text-lg font-bold',
                                    isLunas
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-orange-600 dark:text-orange-400',
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
                                className="w-full"
                            >
                                <Printer className="size-4" />
                                Simpan + Cetak
                            </Button>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={disabled}
                                    onClick={() => onSubmit(false)}
                                >
                                    Simpan
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={disabled}
                                    onClick={() => onOpenChange(false)}
                                >
                                    Batal
                                </Button>
                            </div>
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
