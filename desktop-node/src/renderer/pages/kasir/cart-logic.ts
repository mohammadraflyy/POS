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

/**
 * The cart survives navigating away from the Kasir page, so lines are
 * persisted by id only - product name, price and stock are re-read from the
 * freshly loaded catalog on the way back instead of being cached.
 */
export interface StoredCartLine {
  productId: number
  productUnitId: number | null
  qty: number
}

export function toStoredCart(cart: CartLine[]): StoredCartLine[] {
  return cart.map((line) => ({ productId: line.product.id, productUnitId: line.productUnitId, qty: line.qty }))
}

/** rebuilds cart lines against the current catalog, dropping products or satuan that no longer exist */
export function restoreCart(stored: StoredCartLine[], products: Product[]): CartLine[] {
  const cart: CartLine[] = []

  for (const line of stored) {
    const product = products.find((p) => p.id === line.productId)

    if (!product || !(line.qty > 0)) {
      continue
    }

    const unit = line.productUnitId === null ? null : product.productUnits.find((u) => u.id === line.productUnitId)

    if (line.productUnitId !== null && !unit) {
      continue
    }

    cart.push({
      key: lineKey(product.id, line.productUnitId),
      product,
      productUnitId: line.productUnitId,
      satuan: unit?.satuan ?? product.satuan,
      qty: line.qty,
    })
  }

  return cart
}

/** avoids floating-point drift (e.g. 0.1 + 0.2) accumulating in displayed/stored qty */
function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000
}

/** adds `qty` base-unit qty for product (default 1), merging into the existing base-unit line if present */
export function addLine(cart: CartLine[], product: Product, qty = 1): CartLine[] {
  const key = lineKey(product.id, null)
  const existing = cart.find((i) => i.key === key)
  const addedQty = qty > 0 ? roundQty(qty) : 1

  if (existing) {
    return cart.map((i) => (i.key === key ? { ...i, qty: roundQty(i.qty + addedQty) } : i))
  }

  // newest first: the cashier watches the top of the list, so a just-scanned
  // item must land where they are already looking. A merged line stays put -
  // rows jumping around while the same barcode is scanned repeatedly is worse
  // than a slightly out-of-order list.
  return [{ key, product, productUnitId: null, satuan: product.satuan, qty: addedQty }, ...cart]
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
      .map((i) => (i.key === newKey ? { ...i, qty: roundQty(i.qty + line.qty) } : i))
  }

  const unit = line.product.productUnits.find((u) => u.id === productUnitId)

  return cart.map((i) =>
    i.key === line.key
      ? { ...i, key: newKey, productUnitId, satuan: unit?.satuan ?? line.product.satuan }
      : i,
  )
}

/** sets the qty for a line in its currently selected satuan, taken literally (decimals allowed) */
export function applyQty(cart: CartLine[], key: string, rawQty: number): CartLine[] {
  const qty = rawQty > 0 ? roundQty(rawQty) : 1

  return cart.map((i) => (i.key === key ? { ...i, qty } : i))
}
