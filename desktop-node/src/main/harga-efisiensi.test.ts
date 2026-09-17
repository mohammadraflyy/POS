import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, productPriceHistories, productPriceTiers, productUnits, storeSettings, units } from './db/schema'
import {
  hargaJualRekomendasi,
  rencanakanEfisiensiHarga,
  terapkanEfisiensiHarga,
  type FilterEfisiensi,
} from './harga-efisiensi'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

/** the default sweep: only what sells under cost, priced up to the shop's minimum margin */
const RUGI: FilterEfisiensi = { cakupan: 'rugi', metode: 'margin_minimal' }

const PCS = 1
const DUS = 2

/**
 * Three products, each broken a different way:
 * 1 sells its base unit under cost, 2 sells a derived unit under cost, 3 is thin but profitable.
 */
function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(units)
    .values([
      { id: PCS, code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now },
      { id: DUS, code: 'DUS', name: 'Dus', symbol: 'dus', createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(products)
    .values([
      { id: 1, kodeItem: 'A', namaItem: 'Rugi Eceran', hargaJual: 9000_00, hargaPokok: 10000_00, stok: 5, createdAt: now, updatedAt: now },
      { id: 2, kodeItem: 'B', namaItem: 'Rugi Dus', hargaJual: 12000_00, hargaPokok: 10000_00, stok: 5, createdAt: now, updatedAt: now },
      { id: 3, kodeItem: 'C', namaItem: 'Tipis Tapi Untung', hargaJual: 10500_00, hargaPokok: 10000_00, stok: 5, createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(productUnits)
    .values([
      { id: 11, productId: 1, unitId: PCS, jumlahKemasan: 1, conversionFactor: 1, hargaJual: 9000_00, hargaPokok: 10000_00, isBaseUnit: true, createdAt: now, updatedAt: now },
      { id: 21, productId: 2, unitId: PCS, jumlahKemasan: 1, conversionFactor: 1, hargaJual: 12000_00, hargaPokok: 10000_00, isBaseUnit: true, createdAt: now, updatedAt: now },
      { id: 22, productId: 2, unitId: DUS, jumlahKemasan: 10, conversionFactor: 10, hargaJual: 99000_00, hargaPokok: 100000_00, isBaseUnit: false, createdAt: now, updatedAt: now },
      { id: 31, productId: 3, unitId: PCS, jumlahKemasan: 1, conversionFactor: 1, hargaJual: 10500_00, hargaPokok: 10000_00, isBaseUnit: true, createdAt: now, updatedAt: now },
    ])
    .run()

  return db
}

describe('hargaJualRekomendasi', () => {
  it('leaves the asked-for margin of the selling price, rounded up to Rp 100', () => {
    // 144.000 of cost at a 10% margin -> 160.000
    expect(hargaJualRekomendasi(144000_00, 10)).toBe(160000_00)
    // 185.100 / 0.9 = 205.666,67 -> the next hundred rupiah
    expect(hargaJualRekomendasi(185100_00, 10)).toBe(205700_00)
  })

  it('has nothing to recommend without a cost', () => {
    expect(hargaJualRekomendasi(0, 10)).toBe(0)
  })
})

describe('rencanakanEfisiensiHarga', () => {
  it('cakupan rugi only touches what sells under cost', () => {
    const rencana = rencanakanEfisiensiHarga(seedDb(), RUGI)

    expect(rencana.marginMinimalPersen).toBe(10)
    expect(rencana.baris.map((row) => row.id).sort()).toEqual([11, 22])
    // the thin-but-profitable row is left alone
    expect(rencana.baris.some((row) => row.id === 31)).toBe(false)
    expect(rencana.baris.find((row) => row.id === 11)?.hargaBaru).toBe(11200_00)
  })

  it('cakupan margin also lifts what is merely thin', () => {
    const rencana = rencanakanEfisiensiHarga(seedDb(), { cakupan: 'margin', metode: 'margin_minimal' })

    expect(rencana.baris.map((row) => row.id).sort()).toEqual([11, 22, 31])
    expect(rencana.baris.find((row) => row.id === 31)?.hargaBaru).toBe(11200_00)
  })

  it('skips a row whose recommendation is wildly above its price instead of raising it', () => {
    const db = seedDb()
    // a conversion typo: a PCS row carrying a whole DUS of cost
    db.update(productUnits).set({ hargaPokok: 200000_00 }).where(eq(productUnits.id, 11)).run()

    const rencana = rencanakanEfisiensiHarga(db, RUGI)

    expect(rencana.baris.some((row) => row.id === 11)).toBe(false)
    expect(rencana.dilewati).toHaveLength(1)
    expect(rencana.dilewati[0].hargaLama).toBe(9000_00)
  })

  it('follows the shop minimum margin setting', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(storeSettings)
      .values({ namaToko: 'Toko', receiptWidth: '58mm', marginMinimalPersen: 20, createdAt: now, updatedAt: now })
      .run()

    const rencana = rencanakanEfisiensiHarga(db, RUGI)

    expect(rencana.marginMinimalPersen).toBe(20)
    // 10.000 of cost at a 20% margin -> 12.500
    expect(rencana.baris.find((row) => row.id === 11)?.hargaBaru).toBe(12500_00)
  })

  it('leaves a satuan with no cost recorded alone', () => {
    const db = seedDb()
    db.update(productUnits).set({ hargaPokok: 0 }).where(eq(productUnits.id, 11)).run()

    expect(rencanakanEfisiensiHarga(db, RUGI).baris.some((row) => row.id === 11)).toBe(false)
  })
})

describe('rencanakanEfisiensiHarga dengan parameter kenaikan', () => {
  it('raises by a percentage of the current price, not from the cost', () => {
    const rencana = rencanakanEfisiensiHarga(seedDb(), { cakupan: 'semua', metode: 'persen', nilai: 10 })

    // every priced row is a candidate now, thin-but-profitable included
    expect(rencana.baris).toHaveLength(4)
    // 10.500 + 10% = 11.550, rounded up to the next hundred rupiah
    expect(rencana.baris.find((row) => row.id === 31)?.hargaBaru).toBe(11600_00)
  })

  it('raises by a flat amount', () => {
    const rencana = rencanakanEfisiensiHarga(seedDb(), { cakupan: 'semua', metode: 'nominal', nilai: 500_00 })

    expect(rencana.baris.find((row) => row.id === 31)?.hargaBaru).toBe(11000_00)
  })

  it('keeps the cakupan filter while raising by percentage', () => {
    const rencana = rencanakanEfisiensiHarga(seedDb(), { cakupan: 'rugi', metode: 'persen', nilai: 10 })

    // only the two loss-making rows, each merely 10% higher - which may still be under cost,
    // because a percentage is the owner's number and knows nothing about harga pokok
    expect(rencana.baris.map((row) => row.id).sort()).toEqual([11, 22])
    expect(rencana.baris.find((row) => row.id === 11)?.hargaBaru).toBe(9900_00)
  })

  it('never lets a percentage raise be skipped as suspicious', () => {
    const db = seedDb()
    db.update(productUnits).set({ hargaPokok: 200000_00 }).where(eq(productUnits.id, 11)).run()

    const rencana = rencanakanEfisiensiHarga(db, { cakupan: 'rugi', metode: 'persen', nilai: 10 })

    // the 1,5x guard exists to distrust harga_pokok; a percentage never touches it
    expect(rencana.dilewati).toHaveLength(0)
    expect(rencana.baris.some((row) => row.id === 11)).toBe(true)
  })

  it('refuses a raise with no amount', () => {
    expect(() => rencanakanEfisiensiHarga(seedDb(), { cakupan: 'semua', metode: 'persen' })).toThrow(
      'Besar kenaikan wajib diisi',
    )
    expect(() => rencanakanEfisiensiHarga(seedDb(), { cakupan: 'semua', metode: 'nominal', nilai: 0 })).toThrow(
      'Besar kenaikan wajib diisi',
    )
  })

  it('limits the sweep to one category', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(categories).values({ id: 7, nama: 'Sembako', createdAt: now, updatedAt: now }).run()
    db.update(products).set({ categoryId: 7 }).where(eq(products.id, 2)).run()

    const rencana = rencanakanEfisiensiHarga(db, { ...RUGI, categoryId: 7 })

    // product 1 loses money too, but it is in no category
    expect(rencana.baris.map((row) => row.id)).toEqual([22])
  })
})

describe('terapkanEfisiensiHarga', () => {
  it('writes the new prices, mirrors the base row onto the product, and logs the change', () => {
    const db = seedDb()

    const hasil = terapkanEfisiensiHarga(db, { filter: RUGI, pilihan: null, userId: null })

    expect(hasil).toEqual({ satuanDiubah: 2, tierDiubah: 0, dilewati: 0 })
    expect(db.select().from(productUnits).where(eq(productUnits.id, 11)).get()?.hargaJual).toBe(11200_00)
    // products.hargaJual mirrors the base unit, so it has to move with it
    expect(db.select().from(products).where(eq(products.id, 1)).get()?.hargaJual).toBe(11200_00)
    // a derived unit does not touch the product's own price
    expect(db.select().from(products).where(eq(products.id, 2)).get()?.hargaJual).toBe(12000_00)

    const riwayat = db.select().from(productPriceHistories).all()
    expect(riwayat).toHaveLength(2)
    expect(riwayat[0].hargaPokokLama).toBe(riwayat[0].hargaPokokBaru)

    // running it again finds nothing left to do
    expect(terapkanEfisiensiHarga(db, { filter: RUGI, pilihan: null, userId: null })).toEqual({
      satuanDiubah: 0,
      tierDiubah: 0,
      dilewati: 0,
    })
  })

  it('only writes the rows that were ticked', () => {
    const db = seedDb()

    const hasil = terapkanEfisiensiHarga(db, {
      filter: RUGI,
      pilihan: { satuanIds: [11], tierIds: [] },
      userId: null,
    })

    expect(hasil.satuanDiubah).toBe(1)
    expect(db.select().from(productUnits).where(eq(productUnits.id, 11)).get()?.hargaJual).toBe(11200_00)
    // the other loss-making row was left unticked, so it keeps its price
    expect(db.select().from(productUnits).where(eq(productUnits.id, 22)).get()?.hargaJual).toBe(99000_00)
  })

  it('raises a price tier that sits under the cost of its own satuan', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(productPriceTiers)
      .values({ id: 1, productId: 2, productUnitId: 22, minQty: 3, maxQty: null, hargaJual: 98000_00, createdAt: now, updatedAt: now })
      .run()

    const hasil = terapkanEfisiensiHarga(db, { filter: RUGI, pilihan: null, userId: null })

    expect(hasil.tierDiubah).toBe(1)
    // 100.000 of cost at a 10% margin -> 111.200 (rounded up to the next hundred)
    expect(db.select().from(productPriceTiers).where(eq(productPriceTiers.id, 1)).get()?.hargaJual).toBe(111200_00)
  })
})
