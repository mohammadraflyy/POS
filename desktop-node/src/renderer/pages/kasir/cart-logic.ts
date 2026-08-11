export interface ProductUnitOption {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
}

export interface PriceTier {
  /** the product_units row this tier prices - base rows included */
  productUnitId: number
  minQty: number
  /** null means the range runs open-ended above minQty */
  maxQty: number | null
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
  /** the base unit's product_units.id - a cart line's null productUnitId resolves to this */
  baseProductUnitId: number
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

// Mirrors main/kasir.ts's findTierForQty/priceForQty — duplicated (not
// imported) because main/kasir.ts also pulls in drizzle-orm/better-sqlite3,
// which must not end up in the renderer bundle. Keep the two in step: this is
// what the cashier sees, that is what the sale is charged at.
export function findTierForQty(priceTiers: PriceTier[], qty: number): PriceTier | undefined {
  return [...priceTiers]
    .sort((a, b) => b.minQty - a.minQty)
    .find((tier) => qty >= tier.minQty && (tier.maxQty === null || qty <= tier.maxQty))
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  return findTierForQty(priceTiers, qty)?.hargaJual ?? hargaJualDasar
}

/**
 * A cart line still says "base unit" as productUnitId: null - a renderer-side
 * convenience - while every tier names a real product_units row.
 */
function resolvedProductUnitId(line: CartLine): number {
  return line.productUnitId ?? line.product.baseProductUnitId
}

function tiersForLine(line: CartLine): PriceTier[] {
  const unitId = resolvedProductUnitId(line)

  return line.product.priceTiers.filter((tier) => tier.productUnitId === unitId)
}

/** the tier currently pricing this line, or null when it sits outside every range */
export function activeTier(line: CartLine): PriceTier | null {
  return findTierForQty(tiersForLine(line), line.qty) ?? null
}

/** resolve the price for a cart line - tiered by qty, scoped to the line's own unit */
export function unitPrice(line: CartLine): number {
  const normalPrice =
    line.productUnitId === null
      ? line.product.hargaJual
      : (line.product.productUnits.find((u) => u.id === line.productUnitId)?.hargaJual ?? line.product.hargaJual)

  return priceForQty(tiersForLine(line), normalPrice, line.qty)
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

/** adds one base-unit qty for product, merging into the existing base-unit line if present */
export function addLine(cart: CartLine[], product: Product): CartLine[] {
  const key = lineKey(product.id, null)
  const existing = cart.find((i) => i.key === key)

  if (existing) {
    return cart.map((i) => (i.key === key ? { ...i, qty: i.qty + 1 } : i))
  }

  return [...cart, { key, product, productUnitId: null, satuan: product.satuan, qty: 1 }]
}

/** moves line onto productUnitId, merging into an existing line for that unit if one exists */
export function changeUnit(cart: CartLine[], line: CartLine, productUnitId: number | null): CartLine[] {
  const newKey = lineKey(line.product.id, productUnitId)

  if (newKey === line.key) {
    return cart
  }

  if (cart.some((i) => i.key === newKey)) {
    return cart
      .filter((i) => i.key !== line.key)
      .map((i) => (i.key === newKey ? { ...i, qty: i.qty + line.qty } : i))
  }

  const unit = line.product.productUnits.find((u) => u.id === productUnitId)

  return cart.map((i) =>
    i.key === line.key
      ? { ...i, key: newKey, productUnitId, satuan: unit?.satuan ?? line.product.satuan }
      : i,
  )
}

/** resolves rawQty to the cleanest satuan and merges into an existing line for that satuan if one exists */
export function applyQty(cart: CartLine[], key: string, rawQty: number): CartLine[] {
  const line = cart.find((i) => i.key === key)

  if (!line) {
    return cart
  }

  const resolved = resolveLineQty(line, rawQty > 0 ? rawQty : 1)
  const newKey = lineKey(line.product.id, resolved.productUnitId)

  if (cart.some((i) => i.key === newKey && i.key !== line.key)) {
    return cart
      .filter((i) => i.key !== line.key)
      .map((i) => (i.key === newKey ? { ...i, qty: i.qty + resolved.qty } : i))
  }

  return cart.map((i) =>
    i.key === line.key
      ? { ...i, key: newKey, productUnitId: resolved.productUnitId, satuan: resolved.satuan, qty: resolved.qty }
      : i,
  )
}
