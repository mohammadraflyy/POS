import { eq, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, productPriceHistories, productPriceTiers, productUnits, storeSettings, units } from './db/schema'

/** prices land on a round figure; money is stored in sen, so Rp 100 is 100_00 */
const PEMBULATAN = 100_00

/** the highest margin worth computing from - above this the arithmetic explodes */
const MARGIN_MAKS = 90

/**
 * A price this far under the recommendation is not a pricing mistake but a broken master row -
 * a conversion typed wrong, or a cost belonging to a different packaging. Raising it would swap
 * a visible error for a hidden one, so those are reported instead of changed.
 */
const BATAS_MENCURIGAKAN = 1.5

/**
 * Lowest price that still leaves `marginPersen` of the price as profit, rounded up.
 *
 * Mirrors `renderer/lib/harga.ts` - duplicated rather than imported, the same way
 * `renderer/pages/kasir/cart-logic.ts` mirrors `kasir.ts`, because the renderer bundle must not
 * pull in drizzle. Keep the two in step: that one advises, this one applies.
 */
export function hargaJualRekomendasi(hargaPokok: number, marginPersen: number): number {
  if (!Number.isFinite(hargaPokok) || hargaPokok <= 0) {
    return 0
  }

  const margin = Math.min(Math.max(Number.isFinite(marginPersen) ? marginPersen : 0, 0), MARGIN_MAKS)

  return Math.ceil(hargaPokok / (1 - margin / 100) / PEMBULATAN) * PEMBULATAN
}

/**
 * Which rows are even candidates. `rugi` only touches what is sold below cost - the safe sweep,
 * and the one the Rekap advice points at. `margin` lifts everything under the shop's minimum
 * margin, which on a thin catalog can be most of it. `semua` is every priced row, for a
 * deliberate across-the-board raise.
 */
export type CakupanEfisiensi = 'rugi' | 'margin' | 'semua'

/**
 * How the new price is worked out. `margin_minimal` derives it from the cost, so it needs one;
 * the other two work off the current price and are what a plain "raise prices" ask means.
 */
export type MetodeEfisiensi = 'margin_minimal' | 'persen' | 'nominal'

export interface FilterEfisiensi {
  cakupan: CakupanEfisiensi
  metode: MetodeEfisiensi
  /** percent for `persen`, rupiah in sen for `nominal`; ignored by `margin_minimal` */
  nilai?: number
  /** limit to one category; null means every category, including uncategorised products */
  categoryId?: number | null
}

/** the rows the owner ticked; null means "everything in the plan" */
export interface PilihanEfisiensi {
  satuanIds: number[]
  tierIds: number[]
}

export interface BarisEfisiensi {
  jenis: 'satuan' | 'tier'
  /** product_units.id for a satuan row, product_price_tiers.id for a tier */
  id: number
  productId: number
  namaItem: string
  satuan: string
  /** the tier's minimum qty; null for a plain satuan row */
  minQty: number | null
  hargaPokok: number
  hargaLama: number
  hargaBaru: number
}

export interface BarisDilewati {
  namaItem: string
  satuan: string
  hargaPokok: number
  hargaLama: number
  hargaBaru: number
}

export interface RencanaEfisiensi {
  filter: FilterEfisiensi
  marginMinimalPersen: number
  baris: BarisEfisiensi[]
  /** rows whose master data looks broken - listed, never changed */
  dilewati: BarisDilewati[]
}

type Db = BetterSQLite3Database<typeof schema>

function assertFilter(filter: FilterEfisiensi): void {
  if (filter.metode === 'margin_minimal') {
    return
  }

  if (filter.nilai === undefined || !Number.isFinite(filter.nilai) || filter.nilai <= 0) {
    throw new Error('Besar kenaikan wajib diisi dan harus lebih dari 0.')
  }

  // a raise beyond this is a typo, not a price list
  if (filter.metode === 'persen' && filter.nilai > 500) {
    throw new Error('Kenaikan persen terlalu besar.')
  }
}

/**
 * Rounds up to the next Rp 100, so a computed price still looks like a price.
 *
 * The input is rounded to whole sen first: `900000 * 1.1` lands on `990000.0000000001`, and
 * ceiling that raw would push an exact Rp 9.900 up to Rp 10.000 for no reason anyone could see.
 */
function bulatkanNaik(sen: number): number {
  return Math.ceil(Math.round(sen) / PEMBULATAN) * PEMBULATAN
}

function hitungHargaBaru(hargaLama: number, hargaMinimal: number, filter: FilterEfisiensi): number {
  switch (filter.metode) {
    case 'margin_minimal':
      return hargaMinimal
    case 'persen':
      return bulatkanNaik(hargaLama * (1 + (filter.nilai ?? 0) / 100))
    case 'nominal':
      return bulatkanNaik(hargaLama + (filter.nilai ?? 0))
  }
}

/**
 * Works out which prices would move, without touching anything. The same routine backs the
 * preview and the apply, so what the owner confirms is what gets written.
 */
export function rencanakanEfisiensiHarga(db: Db, filter: FilterEfisiensi): RencanaEfisiensi {
  assertFilter(filter)

  const marginMinimalPersen = db.select().from(storeSettings).get()?.marginMinimalPersen ?? 10
  const baris: BarisEfisiensi[] = []
  const dilewati: BarisDilewati[] = []

  function pertimbangkan(row: Omit<BarisEfisiensi, 'hargaBaru'>): void {
    // an unpriced satuan has nothing to raise
    if (row.hargaLama <= 0) {
      return
    }

    // only the cost-derived method needs a cost; a flat raise works off the price alone
    if (row.hargaPokok <= 0 && (filter.metode === 'margin_minimal' || filter.cakupan !== 'semua')) {
      return
    }

    const hargaMinimal = hargaJualRekomendasi(row.hargaPokok, marginMinimalPersen)
    const perluNaik =
      filter.cakupan === 'rugi'
        ? row.hargaLama < row.hargaPokok
        : filter.cakupan === 'margin'
          ? row.hargaLama < hargaMinimal
          : true

    if (!perluNaik) {
      return
    }

    const hargaBaru = hitungHargaBaru(row.hargaLama, hargaMinimal, filter)

    if (hargaBaru <= row.hargaLama) {
      return
    }

    // Only the cost-derived price can run away like this, because only it trusts harga_pokok.
    // A percentage or a flat amount is the owner's own number - no second-guessing it.
    if (filter.metode === 'margin_minimal' && hargaBaru > row.hargaLama * BATAS_MENCURIGAKAN) {
      dilewati.push({
        namaItem: row.namaItem,
        satuan: row.satuan,
        hargaPokok: row.hargaPokok,
        hargaLama: row.hargaLama,
        hargaBaru,
      })

      return
    }

    baris.push({ ...row, hargaBaru })
  }

  // undefined means "no condition" to drizzle, which is exactly "every category"
  const filterKategori =
    filter.categoryId === null || filter.categoryId === undefined ? undefined : eq(products.categoryId, filter.categoryId)

  const unitRows = db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      namaItem: products.namaItem,
      satuan: units.code,
      hargaJual: productUnits.hargaJual,
      hargaPokok: productUnits.hargaPokok,
    })
    .from(productUnits)
    .innerJoin(products, eq(products.id, productUnits.productId))
    .innerJoin(units, eq(units.id, productUnits.unitId))
    .where(filterKategori)
    .all()

  for (const row of unitRows) {
    pertimbangkan({
      jenis: 'satuan',
      id: row.id,
      productId: row.productId,
      namaItem: row.namaItem,
      satuan: row.satuan,
      minQty: null,
      hargaPokok: row.hargaPokok,
      hargaLama: row.hargaJual,
    })
  }

  const tierRows = db
    .select({
      id: productPriceTiers.id,
      productId: productPriceTiers.productId,
      namaItem: products.namaItem,
      satuan: units.code,
      minQty: productPriceTiers.minQty,
      hargaJual: productPriceTiers.hargaJual,
      hargaPokok: productUnits.hargaPokok,
    })
    .from(productPriceTiers)
    .innerJoin(productUnits, eq(productUnits.id, productPriceTiers.productUnitId))
    .innerJoin(products, eq(products.id, productPriceTiers.productId))
    .innerJoin(units, eq(units.id, productUnits.unitId))
    .where(filterKategori)
    .all()

  for (const row of tierRows) {
    pertimbangkan({
      jenis: 'tier',
      id: row.id,
      productId: row.productId,
      namaItem: row.namaItem,
      satuan: row.satuan,
      minQty: row.minQty,
      hargaPokok: row.hargaPokok,
      hargaLama: row.hargaJual,
    })
  }

  // biggest correction first: that is the one the owner most needs to agree with
  baris.sort((a, b) => b.hargaBaru - b.hargaLama - (a.hargaBaru - a.hargaLama))

  return { filter, marginMinimalPersen, baris, dilewati }
}

export interface HasilEfisiensi {
  satuanDiubah: number
  tierDiubah: number
  dilewati: number
}

/**
 * Applies the plan in one transaction. The plan is recomputed here rather than taken from the
 * caller: the preview may be minutes old, and a purchase in between would have moved the costs
 * it was based on.
 */
export function terapkanEfisiensiHarga(
  db: Db,
  input: { filter: FilterEfisiensi; pilihan: PilihanEfisiensi | null; userId: number | null },
): HasilEfisiensi {
  return db.transaction((tx) => {
    const rencana = rencanakanEfisiensiHarga(tx as unknown as Db, input.filter)
    const now = new Date()

    // The plan is recomputed from live costs, then narrowed to what was ticked. A row the owner
    // ticked that no longer needs raising is simply absent from the fresh plan, and stays untouched.
    const pilihanSatuan = input.pilihan ? new Set(input.pilihan.satuanIds) : null
    const pilihanTier = input.pilihan ? new Set(input.pilihan.tierIds) : null

    const satuanBaris = rencana.baris.filter((row) => row.jenis === 'satuan' && (!pilihanSatuan || pilihanSatuan.has(row.id)))
    const tierBaris = rencana.baris.filter((row) => row.jenis === 'tier' && (!pilihanTier || pilihanTier.has(row.id)))

    // products.hargaJual mirrors the base unit's price, so a changed base row has to update both
    const baseRows =
      satuanBaris.length === 0
        ? []
        : tx
            .select({ id: productUnits.id, isBaseUnit: productUnits.isBaseUnit })
            .from(productUnits)
            .where(
              inArray(
                productUnits.id,
                satuanBaris.map((row) => row.id),
              ),
            )
            .all()

    for (const row of satuanBaris) {
      tx.update(productUnits).set({ hargaJual: row.hargaBaru, updatedAt: now }).where(eq(productUnits.id, row.id)).run()

      if (baseRows.find((unit) => unit.id === row.id)?.isBaseUnit) {
        tx.update(products).set({ hargaJual: row.hargaBaru, updatedAt: now }).where(eq(products.id, row.productId)).run()
      }

      tx.insert(productPriceHistories)
        .values({
          productId: row.productId,
          userId: input.userId,
          // the cost did not move, only the price - recorded unchanged so the audit row still
          // reads as a complete before/after snapshot
          hargaPokokLama: row.hargaPokok,
          hargaPokokBaru: row.hargaPokok,
          hargaJualLama: row.hargaLama,
          hargaJualBaru: row.hargaBaru,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    for (const row of tierBaris) {
      tx.update(productPriceTiers)
        .set({ hargaJual: row.hargaBaru, updatedAt: now })
        .where(eq(productPriceTiers.id, row.id))
        .run()
    }

    return {
      satuanDiubah: satuanBaris.length,
      tierDiubah: tierBaris.length,
      dilewati: rencana.dilewati.length,
    }
  })
}
