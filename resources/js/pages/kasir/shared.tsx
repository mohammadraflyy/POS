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
};

/** Only visible when printing (see the .receipt-print rule in app.css). */
export function Receipt({ sale }: { sale: Sale }) {
    const kembalian = Number(sale.dibayar) - Number(sale.total);

    return (
        <div className="receipt-print hidden">
            <p className="text-center font-bold">TOKO</p>
            <p className="text-center text-xs">
                {new Date(sale.created_at).toLocaleString('id-ID')}
            </p>
            <p className="text-xs">Struk #{sale.id}</p>
            <hr className="my-1 border-dashed" />
            {sale.items.map((item) => (
                <div key={item.id} className="flex justify-between text-xs">
                    <span>
                        {item.product.nama_item} {item.qty}
                        {item.satuan} x {formatRupiah(item.harga_jual)}
                    </span>
                    <span>{formatRupiah(item.subtotal)}</span>
                </div>
            ))}
            <hr className="my-1 border-dashed" />
            <div className="flex justify-between text-sm font-bold">
                <span>Total</span>
                <span>{formatRupiah(sale.total)}</span>
            </div>
            {sale.metode_pembayaran === 'tunai' ? (
                <>
                    <div className="flex justify-between text-xs">
                        <span>Bayar</span>
                        <span>{formatRupiah(sale.dibayar)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span>Kembali</span>
                        <span>{formatRupiah(Math.max(kembalian, 0))}</span>
                    </div>
                </>
            ) : (
                <p className="text-xs">Bon - {sale.nama_pelanggan}</p>
            )}
            <p className="mt-2 text-center text-xs">Terima kasih</p>
        </div>
    );
}
