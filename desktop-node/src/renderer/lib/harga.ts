/**
 * Selling-price advice, so a price is never typed under what the goods cost.
 *
 * Margin here is always measured *against the selling price* (`(jual - pokok) / jual`), the same
 * way rekap reports it, not as a markup on cost. The two read very differently on a thin margin:
 * 10% of the price is 11.1% on top of the cost.
 */

/** recommended prices land on a round figure; nobody prices a DUS at Rp 205.667 */
const PEMBULATAN = 100

/** the highest margin worth recommending from - above this the arithmetic explodes */
const MARGIN_MAKS = 90

/**
 * The lowest selling price that still leaves `marginPersen` of the price as profit, rounded up
 * to the nearest hundred rupiah. Returns 0 when there is no cost to work from - an item with no
 * recorded cost has nothing to recommend.
 */
export function hargaJualRekomendasi(hargaPokok: number, marginPersen: number, pembulatan = PEMBULATAN): number {
  if (!Number.isFinite(hargaPokok) || hargaPokok <= 0) {
    return 0
  }

  const margin = Math.min(Math.max(Number.isFinite(marginPersen) ? marginPersen : 0, 0), MARGIN_MAKS)
  const kasar = hargaPokok / (1 - margin / 100)

  return Math.ceil(kasar / pembulatan) * pembulatan
}

/** margin as a percentage of the selling price, or null when there is no price to divide by */
export function marginDariHargaJual(hargaJual: number, hargaPokok: number): number | null {
  if (!Number.isFinite(hargaJual) || hargaJual <= 0) {
    return null
  }

  return ((hargaJual - hargaPokok) / hargaJual) * 100
}

/**
 * Whether this price falls short of the shop's minimum margin. A line with no cost recorded is
 * never flagged: its margin is unknown, not bad.
 */
export function diBawahMarginMinimal(hargaJual: number, hargaPokok: number, marginMinimalPersen: number): boolean {
  if (hargaPokok <= 0) {
    return false
  }

  return hargaJual < hargaJualRekomendasi(hargaPokok, marginMinimalPersen)
}

/** whether this price sells at a loss outright - the harder failure, worth its own wording */
export function diBawahModal(hargaJual: number, hargaPokok: number): boolean {
  return hargaPokok > 0 && hargaJual < hargaPokok
}
