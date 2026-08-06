export interface ProductUnitOption {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
}

export interface PriceTier {
  minQty: number
  hargaJual: number
}

export interface Product {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  satuan: string
  hargaJual: number
  stok: number
  productUnits: ProductUnitOption[]
  priceTiers: PriceTier[]
}

/** the base unit is represented as productUnitId: null */
export interface CartLine {
  key: string
  product: Product
  productUnitId: number | null
  satuan: string
  qty: number
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  const applicable = priceTiers.filter((tier) => qty >= tier.minQty).sort((a, b) => b.minQty - a.minQty)
  return applicable[0]?.hargaJual ?? hargaJualDasar
}

/** resolve the price for a cart line - fixed for a derived unit, tiered by qty for the base unit */
export function unitPrice(line: CartLine): number {
  if (line.productUnitId !== null) {
    const unit = line.product.productUnits.find((u) => u.id === line.productUnitId)
    return unit?.hargaJual ?? line.product.hargaJual
  }

  return priceForQty(line.product.priceTiers, line.product.hargaJual, line.qty)
}

export function lineKey(productId: number, productUnitId: number | null): string {
  return `${productId}:${productUnitId ?? 'base'}`
}

export function unitKonversi(line: CartLine): number {
  if (line.productUnitId === null) {
    return 1
  }

  return line.product.productUnits.find((u) => u.id === line.productUnitId)?.konversi ?? 1
}

export const QTY_EPSILON = 1e-6

/**
 * Picks the cleanest satuan for a quantity expressed in the product's base
 * unit: the one with the largest konversi that still divides evenly, so
 * typing e.g. 0.1 DUS (= 1 RNTNG at the base) resolves to "1 RNTNG" rather
 * than staying "0.1 DUS", and typing 10 RNTNG while on the base unit
 * resolves up to "1 DUS". Falls back to rounding at the base unit when
 * nothing divides evenly (a true fractional amount with no matching unit).
 */
export function pickUnitForBaseQty(
  product: Product,
  baseQty: number,
): { productUnitId: number | null; qty: number; satuan: string } {
  const candidates = [
    { id: null as number | null, satuan: product.satuan, konversi: 1 },
    ...product.productUnits.map((u) => ({ id: u.id as number | null, satuan: u.satuan, konversi: u.konversi })),
  ]

  const exact = candidates
    .filter((c) => {
      const q = baseQty / c.konversi
      return Math.abs(q - Math.round(q)) < QTY_EPSILON
    })
    .sort((a, b) => b.konversi - a.konversi)

  const best = exact[0] ?? candidates[0]
  const resolvedBaseQty = exact[0] ? baseQty : Math.max(1, Math.round(baseQty))

  return {
    productUnitId: best.id,
    qty: Math.max(1, Math.round(resolvedBaseQty / best.konversi)),
    satuan: best.satuan,
  }
}

/** typedQty is in whatever satuan the line currently has selected */
export function resolveLineQty(line: CartLine, typedQty: number) {
  const baseQty = typedQty * unitKonversi(line)
  return pickUnitForBaseQty(line.product, baseQty)
}
