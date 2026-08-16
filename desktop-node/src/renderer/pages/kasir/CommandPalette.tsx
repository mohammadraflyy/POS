import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { formatRupiah } from '@/lib/utils'
import { lineKey, type Product, type UnitResult } from './cart-logic'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (query: string) => void
  results: UnitResult[]
  products: Product[]
  jumlah: string
  onSelect: (result: UnitResult) => void
  onCloseAutoFocus: (event: Event) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  products,
  jumlah,
  onSelect,
  onCloseAutoFocus,
}: CommandPaletteProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title="Cari Produk"
      description={`Pilih produk untuk menambahkan ${jumlah || 1} ke keranjang`}
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={onQueryChange}
        onKeyDown={(e) => {
          if (e.key === 'PageDown' || e.key === 'PageUp') {
            e.preventDefault()
            e.currentTarget.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: e.key === 'PageDown' ? 'ArrowDown' : 'ArrowUp',
                bubbles: true,
              }),
            )

            return
          }

          if (e.key !== 'Enter') {
            return
          }

          const code = query.trim()
          const product = products.find((p) => p.barcode === code)

          if (!product) {
            return
          }

          e.preventDefault()
          // a scanned barcode always means the base unit
          onSelect({
            key: lineKey(product.id, null),
            product,
            productUnitId: null,
            satuan: product.satuan,
            hargaJual: product.hargaJual,
          })
        }}
        placeholder="Cari nama / kode produk..."
      />
      <CommandList>
        <CommandEmpty>{query.trim() === '' ? 'Ketik untuk mencari produk.' : 'Produk tidak ditemukan.'}</CommandEmpty>
        {results.length > 0 && (
          <CommandGroup heading="Produk">
            {results.map((result) => (
              <CommandItem
                key={result.key}
                value={result.key}
                disabled={result.product.stok <= 0}
                onSelect={() => onSelect(result)}
                className="flex items-center justify-between"
              >
                <span>
                  <span className="font-medium">{result.product.namaItem}</span>
                  <span className="text-muted-foreground"> &middot; {result.product.kodeItem}</span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {formatRupiah(result.hargaJual)} / {result.satuan}
                  {result.product.stok <= 0 && <span className="text-destructive">Habis</span>}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">&uarr;&darr;</kbd>
          <kbd className="rounded border bg-muted px-1.5 py-0.5">PgUp/PgDn</kbd>
          pilih
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">&crarr;</kbd>
          tambah
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">esc</kbd>
          tutup
        </span>
      </div>
    </CommandDialog>
  )
}
