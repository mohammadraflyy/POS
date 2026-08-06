import { formatRupiah } from '@/lib/utils'

export interface ReceiptItem {
  namaItem: string
  qty: number
  satuan: string | null
  hargaJual: number
  subtotal: number
}

export interface ReceiptSale {
  saleId: number
  total: number
  dibayar: number
  metodePembayaran: 'tunai' | 'bon'
  namaPelanggan: string | null
  createdAt: string
  kasirName: string | null
  items: ReceiptItem[]
}

export interface StoreSettingsDto {
  namaToko: string
  alamat: string | null
  telepon: string | null
  pesanFooter: string | null
}

/** Only visible when printing (see the .receipt-print rule in assets/main.css). */
export function Receipt({ sale, storeSettings }: { sale: ReceiptSale; storeSettings: StoreSettingsDto }) {
  const kembalian = sale.dibayar - sale.total

  return (
    <div className="receipt-print hidden font-mono text-xs leading-relaxed text-black">
      <div className="text-center">
        <p className="text-sm font-bold uppercase">{storeSettings.namaToko}</p>
        {storeSettings.alamat && <p>{storeSettings.alamat}</p>}
        {storeSettings.telepon && <p>{storeSettings.telepon}</p>}
      </div>

      <div className="my-1.5 border-t border-dashed border-black" />

      <div className="flex justify-between">
        <span>Struk #{sale.saleId}</span>
        <span>{new Date(sale.createdAt).toLocaleString('id-ID')}</span>
      </div>
      {sale.kasirName && (
        <div className="flex justify-between">
          <span>Kasir</span>
          <span>{sale.kasirName}</span>
        </div>
      )}

      <div className="my-1.5 border-t border-dashed border-black" />

      {sale.items.map((item, index) => (
        <div key={index} className="mb-1">
          <p>{item.namaItem}</p>
          <div className="flex justify-between">
            <span>
              {item.qty} {item.satuan} x {formatRupiah(item.hargaJual)}
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

      {sale.metodePembayaran === 'tunai' ? (
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
          <span>{sale.namaPelanggan}</span>
        </div>
      )}

      {storeSettings.pesanFooter && (
        <>
          <div className="my-1.5 border-t border-dashed border-black" />
          <p className="text-center">{storeSettings.pesanFooter}</p>
        </>
      )}
    </div>
  )
}
