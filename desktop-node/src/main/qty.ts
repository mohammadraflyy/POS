/**
 * Stock and quantities are fractional: 5,5 KG is a real stock level, not a typo.
 * Everything is kept to {@link QTY_DECIMALS} places so a long chain of additions
 * and subtractions never drifts into 5.500000000000001.
 */
export const QTY_DECIMALS = 3

const QTY_FACTOR = 10 ** QTY_DECIMALS

/** Rounds a quantity to {@link QTY_DECIMALS} places. */
export function bulatkanQty(value: number): number {
  return Math.round(value * QTY_FACTOR) / QTY_FACTOR
}

/** A usable quantity: a finite, non-negative number. Fractions are allowed. */
export function isQtyValid(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}
