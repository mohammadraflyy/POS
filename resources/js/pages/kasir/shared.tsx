import { usePage } from '@inertiajs/react';
import { formatRupiah } from '@/lib/utils';

export type SaleItem = {
    id: number;
    qty: number;
    satuan: string;
    harga_jual: string;
    subtotal: string;
    product: { id: number; nama_item: string };
};

export type Sale = {
    id: number;
    nama_pelanggan: string | null;
    metode_pembayaran: 'tunai' | 'bon';
    status: 'selesai' | 'dibatalkan';
    total: string;
    dibayar: string;
    created_at: string;
    items: SaleItem[];
    user?: { name: string } | null;
};

/** Only visible when printing (see the .receipt-print rule in app.css). */
export function Receipt({ sale }: { sale: Sale }) {
    const { storeSettings } = usePage().props;
    const kembalian = Number(sale.dibayar) - Number(sale.total);

    return (
        <div className="receipt-print hidden font-mono text-xs leading-relaxed text-black">
            <div className="text-center">
                <p className="text-sm font-bold uppercase">
                    {storeSettings.nama_toko}
                </p>
                {storeSettings.alamat && <p>{storeSettings.alamat}</p>}
                {storeSettings.telepon && <p>{storeSettings.telepon}</p>}
            </div>

            <div className="my-1.5 border-t border-dashed border-black" />

            <div className="flex justify-between">
                <span>Struk #{sale.id}</span>
                <span>{new Date(sale.created_at).toLocaleString('id-ID')}</span>
            </div>
            {sale.user && (
                <div className="flex justify-between">
                    <span>Kasir</span>
                    <span>{sale.user.name}</span>
                </div>
            )}

            <div className="my-1.5 border-t border-dashed border-black" />

            {sale.items.map((item) => (
                <div key={item.id} className="mb-1">
                    <p>{item.product.nama_item}</p>
                    <div className="flex justify-between">
                        <span>
                            {item.qty} {item.satuan} x{' '}
                            {formatRupiah(item.harga_jual)}
                        </span>
                        <span>{formatRupiah(item.subtotal)}</span>
                    </div>
                </div>
            ))}

            <div className="my-1.5 border-t border-dashed border-black" />

            <div className="flex justify-between text-sm font-bold">
                <span>TOTAL</span>
                <span>{formatRupiah(sale.total)}</span>
            </div>

            {sale.metode_pembayaran === 'tunai' ? (
                <>
                    <div className="flex justify-between">
                        <span>Tunai</span>
                        <span>{formatRupiah(sale.dibayar)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Kembali</span>
                        <span>{formatRupiah(Math.max(kembalian, 0))}</span>
                    </div>
                </>
            ) : (
                <div className="flex justify-between">
                    <span>Bon</span>
                    <span>{sale.nama_pelanggan}</span>
                </div>
            )}

            {storeSettings.pesan_footer && (
                <>
                    <div className="my-1.5 border-t border-dashed border-black" />
                    <p className="text-center">{storeSettings.pesan_footer}</p>
                </>
            )}
        </div>
    );
}
