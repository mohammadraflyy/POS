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
  /**
   * Whole rupiah taken off this line by hand. Stored as a plain amount even when the
   * cashier typed a percentage: the percentage is resolved the moment it is entered, so
   * changing qty afterwards leaves the discount where the cashier put it rather than
   * silently growing it.
   *
   * ponytail: frozen nominal, not a live percentage. If "10% off, whatever the qty ends
   * up being" is ever wanted, store the raw entry alongside this and re-resolve on qty change.
   */
  diskon?: number
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

/** what the line is worth before its own discount */
export function lineGross(line: CartLine): number {
  return Math.round(line.qty * unitPrice(line))
}

/** what the line contributes to the bill; a discount can zero a line but never invert it */
export function lineSubtotal(line: CartLine): number {
  return Math.max(0, lineGross(line) - (line.diskon ?? 0))
}

/**
 * Reads a discount the cashier typed. `10%` is resolved against `base` there and then;
 * anything else is read as whole rupiah. Junk and negatives read as no discount, and the
 * result never exceeds `base` - main/kasir.ts rejects an over-large discount outright, so
 * clamping here keeps the till from ever sending one.
 */
export function parseDiskon(raw: string, base: number): number {
  const trimmed = raw.trim()

  if (trimmed === '') {
    return 0
  }

  const isPersen = trimmed.endsWith('%')
  const digits = Number(trimmed.replace(/[^0-9.]/g, ''))

  if (!Number.isFinite(digits) || digits <= 0) {
    return 0
  }

  const nominal = isPersen ? Math.round((base * digits) / 100) : Math.round(digits)

  return Math.min(Math.max(0, nominal), Math.max(0, base))
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
  diskon?: number
}

export function toStoredCart(cart: CartLine[]): StoredCartLine[] {
  return cart.map((line) => ({
    productId: line.product.id,
    productUnitId: line.productUnitId,
    qty: line.qty,
    diskon: line.diskon ?? 0,
  }))
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
      diskon: line.diskon ?? 0,
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

/**
 * Sets a manual discount on one line from what the cashier typed (`5000` or `10%`).
 * Resolved against that line's own gross, so the percentage means what it looks like.
 */
export function applyDiskon(cart: CartLine[], key: string, raw: string): CartLine[] {
  return cart.map((i) => (i.key === key ? { ...i, diskon: parseDiskon(raw, lineGross(i)) } : i))
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
  /** stock expressed in this row's own satuan, so a DUS row reads in DUS and not in PCS */
  stok: number
}

/** one line of a saved sale, as `kasir:getSaleForEdit` hands it over */
export interface EditSaleItem {
  productId: number
  productUnitId: number | null
  qty: number
  hargaJual: number
  /** whole rupiah taken off this line when the sale was saved; absent on pre-discount sales */
  diskon?: number
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
 * every save with no indication on screen of which line was at fault. Likewise for
 * a line whose product itself is gone (deleted or deactivated). `dropped` counts
 * both cases so the caller can refuse to let the sale be saved from an incomplete
 * cart instead of silently deleting the missing line's stock and total on save.
 *
 * addItemsToSale (main process) plain-inserts a sale_items row rather than merging,
 * so a bon topped up with a product already on it can carry two rows for the same
 * product+unit. Those collapse into one CartLine here (qty summed, last non-null
 * hargaOverride wins) - applyQty/applyHarga key by lineKey and would otherwise edit
 * both rows at once, and React would see duplicate grid keys. Coalescing is not a
 * drop: both rows are represented, just merged into one line.
 */
export interface CartFromSaleResult {
  cart: CartLine[]
  /** count of items skipped for a missing product or a missing derived unit */
  dropped: number
}

export function cartFromSale(items: EditSaleItem[], products: Product[]): CartFromSaleResult {
  const cart = new Map<string, CartLine>()
  let dropped = 0

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId)

    if (!product) {
      dropped++
      continue
    }

    const isBase = item.productUnitId === null || item.productUnitId === product.baseProductUnitId
    const productUnitId = isBase ? null : item.productUnitId
    const unit = productUnitId === null ? null : product.productUnits.find((u) => u.id === productUnitId)

    if (productUnitId !== null && !unit) {
      dropped++
      continue
    }

    const key = lineKey(product.id, productUnitId)
    const hargaOverride = item.priceSource === 'manual' ? item.hargaJual : null
    const existing = cart.get(key)

    if (existing) {
      existing.qty = roundQty(existing.qty + item.qty)
      // both rows' discounts were really given, so the merged line carries their sum
      existing.diskon = (existing.diskon ?? 0) + (item.diskon ?? 0)

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
      diskon: item.diskon ?? 0,
    })
  }

  return { cart: [...cart.values()], dropped }
}

/**
 * How well a product answers the query: 0 the query *is* one of its fields, 1 a
 * field starts with it, 2 a field only contains it, -1 no match at all. Matches
 * barcode as well as name and kode - a scanner types the barcode straight into
 * the search box, and leaving barcode out of this filter is what made scanning
 * look broken.
 */
function matchRank(product: Product, q: string): number {
  const fields = [product.namaItem, product.kodeItem, product.barcode ?? ''].map((field) => field.toLowerCase())

  if (fields.some((field) => field === q)) {
    return 0
  }

  if (fields.some((field) => field.startsWith(q))) {
    return 1
  }

  return fields.some((field) => field.includes(q)) ? 2 : -1
}

/**
 * Every product the query matches, best match first. The palette can only show
 * so many rows, so this ordering decides which products a cashier ever sees:
 * plain catalog order meant a short query filled the list with products whose
 * name starts in A, and anything later in the alphabet never appeared at all.
 */
export function matchingProducts(products: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase()

  if (!q) {
    return []
  }

  return products
    .map((product) => ({ product, rank: matchRank(product, q) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.product.namaItem.localeCompare(b.product.namaItem))
    .map((entry) => entry.product)
}

/**
 * Expands matching products into one row per satuan, so the cashier can pick DUS
 * without adding PCS first and converting. `limit` counts rows, not products - a
 * product with three satuan eats four slots - so pair it with `matchingProducts`
 * to tell the cashier how many products the cap left out.
 */
export function expandUnitResults(products: Product[], query: string, limit: number): UnitResult[] {
  const results: UnitResult[] = []

  for (const product of matchingProducts(products, query)) {
    results.push({
      key: lineKey(product.id, null),
      product,
      productUnitId: null,
      satuan: product.satuan,
      hargaJual: product.hargaJual,
      stok: product.stok,
    })

    for (const unit of product.productUnits) {
      results.push({
        key: lineKey(product.id, unit.id),
        product,
        productUnitId: unit.id,
        satuan: unit.satuan,
        hargaJual: unit.hargaJual,
        // konversi 0 would be a broken catalog row; guard so the row shows 0 rather than Infinity
        stok: unit.konversi > 0 ? roundQty(product.stok / unit.konversi) : 0,
      })
    }

    if (results.length >= limit) {
      break
    }
  }

  return results.slice(0, limit)
}
