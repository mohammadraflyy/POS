import { router } from '@inertiajs/react';
import { Layers, Plus, TrendingUp } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import ProductPriceTierController from '@/actions/App/Http/Controllers/ProductPriceTierController';
import ProductUnitController from '@/actions/App/Http/Controllers/ProductUnitController';
import InputError from '@/components/input-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/hooks/use-confirm';
import { formatRupiah } from '@/lib/utils';

export type Category = { id: number; nama: string };

export type ProductUnitRow = {
    id: number;
    satuan: string;
    konversi: number;
    harga_jual: string;
};

export type PriceTierRow = {
    id: number;
    min_qty: number;
    harga_jual: string;
};

export type Product = {
    id: number;
    kode_item: string;
    barcode: string | null;
    nama_item: string;
    category: Category | null;
    satuan: string;
    harga_pokok: string;
    harga_jual: string;
    stok: number;
    is_active: boolean;
    product_units: ProductUnitRow[];
    price_tiers: PriceTierRow[];
};

export type ProductOption = Pick<Product, 'id' | 'kode_item' | 'nama_item'>;

export type Supplier = { id: number; nama: string };

export function ProductUnitsManager({ product }: { product: Product }) {
    const [satuan, setSatuan] = useState('');
    const [konversi, setKonversi] = useState('');
    const [hargaJual, setHargaJual] = useState('');
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    function addUnit(e: FormEvent) {
        e.preventDefault();
        setProcessing(true);
        router.post(
            ProductUnitController.store.url(product.id),
            { satuan, konversi, harga_jual: hargaJual },
            {
                preserveScroll: true,
                onSuccess: () => {
                    setSatuan('');
                    setKonversi('');
                    setHargaJual('');
                },
                onError: (e) => setErrors(e as Record<string, string>),
                onFinish: () => setProcessing(false),
            },
        );
    }

    const { confirm, ConfirmDialog } = useConfirm();

    async function removeUnit(unit: ProductUnitRow) {
        const ok = await confirm({
            title: 'Hapus Satuan',
            description: `Hapus satuan "1 ${unit.satuan} = ${unit.konversi} ${product.satuan}"?`,
            confirmLabel: 'Hapus',
            destructive: true,
        });

        if (!ok) {
            return;
        }

        router.delete(
            ProductUnitController.destroy.url({
                product: product.id,
                productUnit: unit.id,
            }),
            { preserveScroll: true },
        );
    }

    return (
        <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
                <Layers className="size-4 text-muted-foreground" />
                <Label className="text-sm font-semibold">
                    Satuan Turunan
                </Label>
                <span className="text-xs text-muted-foreground">
                    mis. 1 DUS = 12 {product.satuan}
                </span>
            </div>
            {product.product_units.length > 0 ? (
                <div className="space-y-1.5">
                    {product.product_units.map((unit) => (
                        <div
                            key={unit.id}
                            className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50"
                        >
                            <span className="text-sm font-medium">
                                1 {unit.satuan} = {unit.konversi}{' '}
                                {product.satuan}
                            </span>
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary">
                                    {formatRupiah(unit.harga_jual)}
                                </Badge>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => removeUnit(unit)}
                                >
                                    Hapus
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Belum ada satuan turunan.
                </p>
            )}
            <form
                onSubmit={addUnit}
                className="flex items-end gap-2 rounded-lg border bg-muted/30 p-3"
            >
                <div className="grid flex-1 gap-1">
                    <Label className="text-xs">Satuan</Label>
                    <Input
                        value={satuan}
                        onChange={(e) => setSatuan(e.target.value)}
                        placeholder="DUS"
                    />
                    <InputError message={errors.satuan} />
                </div>
                <div className="grid w-28 gap-1">
                    <Label className="text-xs">= jumlah {product.satuan}</Label>
                    <Input
                        type="number"
                        value={konversi}
                        onChange={(e) => setKonversi(e.target.value)}
                    />
                    <InputError message={errors.konversi} />
                </div>
                <div className="grid w-32 gap-1">
                    <Label className="text-xs">Harga Jual</Label>
                    <Input
                        type="number"
                        value={hargaJual}
                        onChange={(e) => setHargaJual(e.target.value)}
                    />
                    <InputError message={errors.harga_jual} />
                </div>
                <Button type="submit" size="sm" disabled={processing}>
                    <Plus className="size-4" />
                    Tambah
                </Button>
            </form>
            {ConfirmDialog}
        </div>
    );
}

export function ProductPriceTiersManager({ product }: { product: Product }) {
    const [minQty, setMinQty] = useState('');
    const [hargaJual, setHargaJual] = useState('');
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    function addTier(e: FormEvent) {
        e.preventDefault();
        setProcessing(true);
        router.post(
            ProductPriceTierController.store.url(product.id),
            { min_qty: minQty, harga_jual: hargaJual },
            {
                preserveScroll: true,
                onSuccess: () => {
                    setMinQty('');
                    setHargaJual('');
                },
                onError: (e) => setErrors(e as Record<string, string>),
                onFinish: () => setProcessing(false),
            },
        );
    }

    const { confirm, ConfirmDialog } = useConfirm();

    async function removeTier(tier: PriceTierRow) {
        const ok = await confirm({
            title: 'Hapus Harga Bertingkat',
            description: `Hapus harga bertingkat untuk pembelian ${tier.min_qty}+ ${product.satuan}?`,
            confirmLabel: 'Hapus',
            destructive: true,
        });

        if (!ok) {
            return;
        }

        router.delete(
            ProductPriceTierController.destroy.url({
                product: product.id,
                priceTier: tier.id,
            }),
            { preserveScroll: true },
        );
    }

    return (
        <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-muted-foreground" />
                <Label className="text-sm font-semibold">
                    Harga Bertingkat
                </Label>
                <span className="text-xs text-muted-foreground">
                    berdasarkan jumlah beli, satuan {product.satuan}
                </span>
            </div>
            {product.price_tiers.length > 0 ? (
                <div className="space-y-1.5">
                    {[...product.price_tiers]
                        .sort((a, b) => a.min_qty - b.min_qty)
                        .map((tier) => (
                            <div
                                key={tier.id}
                                className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50"
                            >
                                <span className="text-sm font-medium">
                                    Beli {tier.min_qty}+ {product.satuan}
                                </span>
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary">
                                        {formatRupiah(tier.harga_jual)} /{' '}
                                        {product.satuan}
                                    </Badge>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => removeTier(tier)}
                                    >
                                        Hapus
                                    </Button>
                                </div>
                            </div>
                        ))}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Belum ada harga bertingkat.
                </p>
            )}
            <form
                onSubmit={addTier}
                className="flex items-end gap-2 rounded-lg border bg-muted/30 p-3"
            >
                <div className="grid w-32 gap-1">
                    <Label className="text-xs">Min. Qty</Label>
                    <Input
                        type="number"
                        value={minQty}
                        onChange={(e) => setMinQty(e.target.value)}
                        placeholder="6"
                    />
                    <InputError message={errors.min_qty} />
                </div>
                <div className="grid w-40 gap-1">
                    <Label className="text-xs">
                        Harga Jual per {product.satuan}
                    </Label>
                    <Input
                        type="number"
                        value={hargaJual}
                        onChange={(e) => setHargaJual(e.target.value)}
                    />
                    <InputError message={errors.harga_jual} />
                </div>
                <Button type="submit" size="sm" disabled={processing}>
                    <Plus className="size-4" />
                    Tambah
                </Button>
            </form>
            {ConfirmDialog}
        </div>
    );
}
