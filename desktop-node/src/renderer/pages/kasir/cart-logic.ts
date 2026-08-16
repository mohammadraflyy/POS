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
  /**
   * Set only while editing a saved sale, where the cashier may correct a price
   * that was charged. Optional rather than always-null so the dozens of existing
   * call sites that build a CartLine keep compiling.
   */
  hargaOverride?: number | null
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

/** resolve the price for a cart line - a manual override first, then tiered by qty, scoped to the line's own unit */
export function unitPrice(line: CartLine): number {
  if (line.hargaOverride != null) {
    return line.hargaOverride
  }

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

/**
 * Adds `qty` of `product` at `productUnitId` (null = base unit), merging into an
 * existing line for that same unit. New lines go to the top; see Task 1's note.
 */
export function addLine(
  cart: CartLine[],
  product: Product,
  qty = 1,
  productUnitId: number | null = null,
): CartLine[] {
  const key = lineKey(product.id, productUnitId)
  const existing = cart.find((i) => i.key === key)
  const addedQty = qty > 0 ? roundQty(qty) : 1

  if (existing) {
    return cart.map((i) => (i.key === key ? { ...i, qty: roundQty(i.qty + addedQty) } : i))
  }

  const unit = productUnitId === null ? null : product.productUnits.find((u) => u.id === productUnitId)

  return [
    { key, product, productUnitId, satuan: unit?.satuan ?? product.satuan, qty: addedQty },
    ...cart,
  ]
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

/** sets a manual price (in whole rupiah) on one line, overriding master and tier alike */
export function applyHarga(cart: CartLine[], key: string, rawHarga: number): CartLine[] {
  const harga = rawHarga > 0 ? Math.round(rawHarga) : 0

  return cart.map((i) => (i.key === key ? { ...i, hargaOverride: harga } : i))
}

/** one selectable row in the product palette: a product *at one of its units* */
export interface UnitResult {
  /** same shape as a cart line's key, so React keys stay unique across units */
  key: string
  product: Product
  /** null means the base unit, matching CartLine */
  productUnitId: number | null
  satuan: string
  hargaJual: number
}

/** one line of a saved sale, as `kasir:getSaleForEdit` hands it over */
export interface EditSaleItem {
  productId: number
  productUnitId: number | null
  qty: number
  hargaJual: number
  priceSource: 'normal' | 'price_tier' | 'manual'
}

/**
 * Rebuilds a cart from a saved sale.
 *
 * `sale_items` always stores a real `product_units.id`, including for the base unit,
 * while the cart says "base unit" as `productUnitId: null` - so the base row's id has
 * to be translated back on the way in, or the base line would look like a derived one
 * that no longer exists.
 *
 * Only a line that was priced by hand comes back as an override. A `price_tier` or
 * `normal` line is left to be recomputed, so correcting its qty re-prices it the way
 * the till would have.
 *
 * A line whose derived unit has since been deleted from the catalog is dropped
 * rather than kept with a dangling productUnitId - updateSale would reject it on
 * every save with no indication on screen of which line was at fault.
 *
 * addItemsToSale (main process) plain-inserts a sale_items row rather than merging,
 * so a bon topped up with a product already on it can carry two rows for the same
 * product+unit. Those collapse into one CartLine here (qty summed, last non-null
 * hargaOverride wins) - applyQty/applyHarga key by lineKey and would otherwise edit
 * both rows at once, and React would see duplicate grid keys.
 */
export function cartFromSale(items: EditSaleItem[], products: Product[]): CartLine[] {
  const cart = new Map<string, CartLine>()

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId)

    if (!product) {
      continue
    }

    const isBase = item.productUnitId === null || item.productUnitId === product.baseProductUnitId
    const productUnitId = isBase ? null : item.productUnitId
    const unit = productUnitId === null ? null : product.productUnits.find((u) => u.id === productUnitId)

    if (productUnitId !== null && !unit) {
      continue
    }

    const key = lineKey(product.id, productUnitId)
    const hargaOverride = item.priceSource === 'manual' ? item.hargaJual : null
    const existing = cart.get(key)

    if (existing) {
      existing.qty = roundQty(existing.qty + item.qty)

      if (hargaOverride != null) {
        existing.hargaOverride = hargaOverride
      }

      continue
    }

    cart.set(key, {
      key,
      product,
      productUnitId,
      satuan: unit?.satuan ?? product.satuan,
      qty: item.qty,
      hargaOverride,
    })
  }

  return [...cart.values()]
}

/**
 * Expands matching products into one row per satuan, so the cashier can pick DUS
 * without adding PCS first and converting. Matches barcode as well as name and
 * kode - a scanner types the barcode straight into the search box, and leaving
 * barcode out of this filter is what made scanning look broken.
 */
export function expandUnitResults(products: Product[], query: string, limit: number): UnitResult[] {
  const q = query.trim().toLowerCase()

  if (!q) {
    return []
  }

  const results: UnitResult[] = []

  for (const product of products) {
    const matches =
      product.namaItem.toLowerCase().includes(q) ||
      product.kodeItem.toLowerCase().includes(q) ||
      (product.barcode ?? '').toLowerCase().includes(q)

    if (!matches) {
      continue
    }

    results.push({
      key: lineKey(product.id, null),
      product,
      productUnitId: null,
      satuan: product.satuan,
      hargaJual: product.hargaJual,
    })

    for (const unit of product.productUnits) {
      results.push({
        key: lineKey(product.id, unit.id),
        product,
        productUnitId: unit.id,
        satuan: unit.satuan,
        hargaJual: unit.hargaJual,
      })
    }

    if (results.length >= limit) {
      break
    }
  }

  return results.slice(0, limit)
}
