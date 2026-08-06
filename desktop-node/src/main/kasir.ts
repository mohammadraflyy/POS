export interface PriceTier {
  minQty: number
  hargaJual: number
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  const applicable = priceTiers
    .filter((tier) => qty >= tier.minQty)
    .sort((a, b) => b.minQty - a.minQty)

  return applicable[0]?.hargaJual ?? hargaJualDasar
}

export interface ProductRow {
  id: number
  namaItem: string
  satuan: string
  hargaJual: number
  hargaPokok: number
  stok: number
}

export interface ProductUnitRow {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
}

export interface ResolvedItem {
  productId: number
  productUnitId: number | null
  satuan: string
  konversi: number
  hargaJual: number
  hargaPokok: number
  qty: number
  qtyDasar: number
}

export function resolveCartItem(
  product: ProductRow,
  productUnit: ProductUnitRow | null,
  priceTiers: PriceTier[],
  qty: number,
): ResolvedItem {
  let satuan: string
  let konversi: number
  let hargaJual: number
  let productUnitId: number | null

  if (productUnit) {
    satuan = productUnit.satuan
    konversi = productUnit.konversi
    hargaJual = productUnit.hargaJual
    productUnitId = productUnit.id
  } else {
    satuan = product.satuan
    konversi = 1
    hargaJual = priceForQty(priceTiers, product.hargaJual, qty)
    productUnitId = null
  }

  const qtyDasar = qty * konversi

  if (product.stok < qtyDasar) {
    throw new Error(`Stok ${product.namaItem} tidak cukup.`)
  }

  return {
    productId: product.id,
    productUnitId,
    satuan,
    konversi,
    hargaJual,
    hargaPokok: product.hargaPokok,
    qty,
    qtyDasar,
  }
}
