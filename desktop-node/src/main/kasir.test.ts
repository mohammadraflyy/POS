import { describe, expect, it } from 'vitest'
import { priceForQty, resolveCartItem, type ProductRow, type ProductUnitRow } from './kasir'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { users, products, productUnits, productPriceTiers, units, sales, saleItems, bonPayments, stockMovements, storeSettings } from './db/schema'
import {
  checkout,
  type CheckoutInput,
  addItemsToSale,
  cancelSale,
  deleteSale,
  listCustomers,
  recordBonPayment,
  updateStoreSettings,
  purgeSalesBefore,
  purgeTodaySales,
  updateSaleDate,
} from './kasir'

const PCS_UNIT_ID = 1
const DUS_UNIT_ID = 2

/**
 * Seeds the global `units` rows plus one base `product_units` row per entry.
 * Every product needs exactly one base unit row now (base is no longer implicit).
 */
function seedPcsBaseUnits(
  db: ReturnType<typeof createDb>,
  rows: { id: number; productId: number; hargaJual: number }[],
): void {
  const now = new Date()

  db.insert(units)
    .values([
      { id: PCS_UNIT_ID, code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now },
      { id: DUS_UNIT_ID, code: 'DUS', name: 'Dus', symbol: 'dus', createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(productUnits)
    .values(
      rows.map((row) => ({
        id: row.id,
        productId: row.productId,
        unitId: PCS_UNIT_ID,
        jumlahKemasan: 1,
        conversionFactor: 1,
        hargaJual: row.hargaJual,
        // a base row always mirrors products.hargaPokok, conversion factor being 1
        hargaPokok:
          db.select({ hargaPokok: products.hargaPokok }).from(products).where(eq(products.id, row.productId)).get()
            ?.hargaPokok ?? 0,
        isBaseUnit: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run()
}

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({
      id: 1,
      username: 'kasir1',
      passwordHash: 'hash',
      name: 'Kasir Satu',
      createdAt: now,
      updatedAt: now,
    })
    .run()

  db.insert(products)
    .values([
      {
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 10,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 2,
        kodeItem: 'MIE1',
        namaItem: 'Mie Instan',
        hargaJual: 3000_00,
        hargaPokok: 2500_00,
        stok: 100,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  seedPcsBaseUnits(db, [
    { id: 101, productId: 1, hargaJual: 65000_00 },
    { id: 102, productId: 2, hargaJual: 3000_00 },
  ])

  db.insert(productUnits)
    .values({
      id: 9,
      productId: 2,
      unitId: DUS_UNIT_ID,
      jumlahKemasan: 40,
      conversionFactor: 40,
      hargaJual: 110000_00,
      // product 2's base cost is 2.500, so a DUS of 40 costs 100.000
      hargaPokok: 100000_00,
      isBaseUnit: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  db.insert(productPriceTiers)
    .values({
      id: 1,
      productId: 1,
      productUnitId: 101,
      minQty: 5,
      maxQty: null,
      hargaJual: 62000_00,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
}

describe('priceForQty', () => {
  it('falls back to the normal price with an empty tier list', () => {
    expect(priceForQty([], 10000, 5)).toBe(10000)
  })

  it('matches a closed range', () => {
    const tiers = [
      { minQty: 1, maxQty: 9, hargaJual: 5000 },
      { minQty: 10, maxQty: 49, hargaJual: 4500 },
    ]
    expect(priceForQty(tiers, 6000, 5)).toBe(5000)
    expect(priceForQty(tiers, 6000, 10)).toBe(4500)
  })

  it('uses the exact lower boundary of a tier, not the tier below', () => {
    const tiers = [
      { minQty: 1, maxQty: 4, hargaJual: 45000 },
      { minQty: 5, maxQty: 9, hargaJual: 42000 },
    ]
    expect(priceForQty(tiers, 50000, 5)).toBe(42000)
    expect(priceForQty(tiers, 50000, 4)).toBe(45000)
  })

  it('uses the exact upper boundary of a tier, not the tier above', () => {
    const tiers = [
      { minQty: 1, maxQty: 9, hargaJual: 5000 },
      { minQty: 10, maxQty: 49, hargaJual: 4500 },
    ]
    expect(priceForQty(tiers, 6000, 9)).toBe(5000)
  })

  it('falls through to the unbounded tier above the last closed one', () => {
    const tiers = [
      { minQty: 1, maxQty: 4, hargaJual: 85000 },
      { minQty: 5, maxQty: null, hargaJual: 80000 },
    ]
    expect(priceForQty(tiers, 90000, 100)).toBe(80000)
  })

  it('falls back to the normal price when qty is below every tier', () => {
    expect(priceForQty([{ minQty: 10, maxQty: null, hargaJual: 4000 }], 5000, 1)).toBe(5000)
  })

  // The one case the old highest-minQty-wins logic got wrong: it never looked at
  // maxQty, so a qty past the top of a closed range kept that range's price
  // instead of falling back.
  it('falls back to the normal price when qty is above a closed range with nothing above it', () => {
    expect(priceForQty([{ minQty: 1, maxQty: 9, hargaJual: 5000 }], 6000, 50)).toBe(6000)
  })

  it('falls back to the normal price when qty lands in a gap between ranges', () => {
    const tiers = [
      { minQty: 1, maxQty: 9, hargaJual: 5000 },
      { minQty: 20, maxQty: 49, hargaJual: 4500 },
    ]
    expect(priceForQty(tiers, 6000, 12)).toBe(6000)
  })

  it('ignores tier order in the list', () => {
    const tiers = [
      { minQty: 10, maxQty: 49, hargaJual: 4500 },
      { minQty: 1, maxQty: 9, hargaJual: 5000 },
    ]
    expect(priceForQty(tiers, 6000, 3)).toBe(5000)
    expect(priceForQty(tiers, 6000, 30)).toBe(4500)
  })

  // Migration 0008 backfills every pre-existing tier with maxQty null, and the old
  // schema happily allowed 10+ and 50+ side by side on one product. Those overlap,
  // so a migrated database still carries pairs that today's write-time validation
  // would reject - the highest satisfied minQty has to keep winning for them.
  it('picks the highest satisfied minQty among overlapping legacy tiers', () => {
    const tiers = [
      { minQty: 10, maxQty: null, hargaJual: 9500 },
      { minQty: 50, maxQty: null, hargaJual: 9000 },
    ]
    expect(priceForQty(tiers, 10000, 60)).toBe(9000)
    expect(priceForQty(tiers, 10000, 20)).toBe(9500)
    expect(priceForQty(tiers, 10000, 5)).toBe(10000)
  })
})

describe('resolveCartItem', () => {
  const product: ProductRow = {
    id: 1,
    namaItem: 'Beras 5kg',
    hargaJual: 65000_00,
    hargaPokok: 60000_00,
    stok: 30,
  }

  const baseUnit: ProductUnitRow = { id: 1, unitId: 1, unitCode: 'PCS', conversionFactor: 1, hargaJual: 65000_00, hargaPokok: 60000_00 }
  // a DUS of 12 costs 12x the base cost, which is what a purchase in PCS would leave behind
  const dusUnit: ProductUnitRow = { id: 9, unitId: 2, unitCode: 'DUS', conversionFactor: 12, hargaJual: 700000_00, hargaPokok: 720000_00 }

  it('resolves the base unit with tier pricing', () => {
    const result = resolveCartItem(product, baseUnit, [{ minQty: 5, maxQty: null, hargaJual: 62000_00 }], 5)
    expect(result).toEqual({
      productId: 1,
      productUnitId: 1,
      satuan: 'PCS',
      konversi: 1,
      hargaJual: 62000_00,
      hargaPokok: 60000_00,
      qty: 5,
      qtyDasar: 5,
      priceSource: 'price_tier',
    })
  })

  it('falls back to the unit price when no tier range matches', () => {
    const result = resolveCartItem(product, baseUnit, [{ minQty: 5, maxQty: null, hargaJual: 62000_00 }], 4)
    expect(result).toMatchObject({ hargaJual: 65000_00, priceSource: 'normal' })
  })

  it('ignores a tier whose maxQty is below the qty', () => {
    const result = resolveCartItem(product, baseUnit, [{ minQty: 2, maxQty: 4, hargaJual: 62000_00 }], 5)
    expect(result).toMatchObject({ hargaJual: 65000_00, priceSource: 'normal' })
  })

  it('resolves a derived unit, taking its satuan/konversi/hargaJual', () => {
    const result = resolveCartItem(product, dusUnit, [], 2)
    expect(result).toEqual({
      productId: 1,
      productUnitId: 9,
      satuan: 'DUS',
      konversi: 12,
      hargaJual: 700000_00,
      // the DUS unit's own cost, not the base cost - that is the whole point of the snapshot
      hargaPokok: 720000_00,
      qty: 2,
      qtyDasar: 24,
      priceSource: 'normal',
    })
  })

  it('throws when base-unit stock is insufficient', () => {
    expect(() => resolveCartItem(product, baseUnit, [], 50)).toThrow('Stok Beras 5kg tidak cukup.')
  })

  it('throws when a product-unit purchase would exceed base-unit stock', () => {
    expect(() => resolveCartItem(product, dusUnit, [], 3)).toThrow('Stok Beras 5kg tidak cukup.')
  })
})

describe('checkout', () => {
  it('snapshots baseQuantity and priceSource on a tier-priced line', () => {
    const db = seedDb()

    // product 1 has a base-unit tier at qty>=5 (seeded), so 5 PCS takes it
    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 310000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    })

    const items = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()
    expect(items[0].priceSource).toBe('price_tier')
    expect(items[0].baseQuantity).toBe(5)
    expect(items[0].baseQuantity).toBe(items[0].qty * items[0].konversi)
  })

  it('settles a qris sale in full, so it leaves no piutang and needs no cash tendered', () => {
    const db = seedDb()

    const result = checkout(db, {
      metodePembayaran: 'qris',
      namaPelanggan: null,
      // no cash changes hands, so the caller has nothing to tender
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    const sale = db.select().from(sales).where(eq(sales.id, result.saleId)).get()
    expect(sale?.metodePembayaran).toBe('qris')
    expect(sale?.dibayar).toBe(result.total)
  })

  it('settles a transfer sale the same way', () => {
    const db = seedDb()

    const result = checkout(db, {
      metodePembayaran: 'transfer',
      namaPelanggan: null,
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    const sale = db.select().from(sales).where(eq(sales.id, result.saleId)).get()
    expect(sale?.dibayar).toBe(result.total)
  })

  it('snapshots the sold unit cost, not the base cost', () => {
    const db = seedDb()

    // product 2 costs 2.500 per PCS and its DUS of 40 costs 100.000
    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 110000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: 9, qty: 1 }],
    })

    const items = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()
    expect(items[0].konversi).toBe(40)
    expect(items[0].hargaPokok).toBe(100000_00)
  })

  it('records a signed sale stock movement per line, in both the sold unit and base units', () => {
    const db = seedDb()

    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 220000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: 9, qty: 2 }],
    })

    const movements = db.select().from(stockMovements).where(eq(stockMovements.referenceId, result.saleId)).all()
    expect(movements).toHaveLength(1)
    expect(movements[0].movementType).toBe('sale')
    expect(movements[0].productUnitId).toBe(9)
    expect(movements[0].quantity).toBe(-2)
    expect(movements[0].conversionFactor).toBe(40)
    expect(movements[0].baseQuantity).toBe(-80)
  })

  it("records priceSource 'normal' and converts baseQuantity for an untiered derived-unit line", () => {
    const db = seedDb()

    // 2 DUS of product 2 (konversi 40) with no DUS tier seeded
    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 220000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: 9, qty: 2 }],
    })

    const items = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()
    expect(items[0].priceSource).toBe('normal')
    expect(items[0].baseQuantity).toBe(80)
  })

  it('prices a derived-unit line against that unit own tiers, never the base unit tiers', () => {
    const db = seedDb()
    const now = new Date()

    // product 2 sells as PCS (base row 102) or DUS (row 9, konversi 40).
    // A base-unit tier at qty>=2 must not touch a 2 DUS line.
    db.insert(productPriceTiers)
      .values([
        { id: 2, productId: 2, productUnitId: 102, minQty: 2, maxQty: null, hargaJual: 2500_00, createdAt: now, updatedAt: now },
        { id: 3, productId: 2, productUnitId: 9, minQty: 2, maxQty: null, hargaJual: 100000_00, createdAt: now, updatedAt: now },
      ])
      .run()

    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 200000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: 9, qty: 2 }],
    })

    const items = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()
    expect(items[0].hargaJual).toBe(100000_00)
    expect(result.total).toBe(200000_00)
  })

  it('checks out a tunai sale with base-unit tier pricing, decrements stock, snapshots sale_items', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 310000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    }

    const result = checkout(db, input)

    expect(result.total).toBe(5 * 62000_00)

    const sale = db.select().from(sales).where(eq(sales.id, result.saleId)).get()
    expect(sale?.total).toBe(5 * 62000_00)
    expect(sale?.dibayar).toBe(310000_00)
    expect(sale?.status).toBe('selesai')

    const items = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      productId: 1,
      productUnitId: 101, // the base unit row, no longer a null sentinel
      qty: 5,
      konversi: 1,
      satuan: 'PCS',
      hargaJual: 62000_00,
      hargaPokok: 60000_00,
      subtotal: 5 * 62000_00,
    })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(5)
  })

  it('checks out a product-unit line, converting qty to base-unit stock', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 110000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: 9, qty: 1 }],
    }

    checkout(db, input)

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    expect(product?.stok).toBe(60) // 100 - (1 * 40)
  })

  it('creates a bon sale with dibayar = 0, no dibayar validation', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 3 }],
    }

    const result = checkout(db, input)

    const sale = db.select().from(sales).where(eq(sales.id, result.saleId)).get()
    expect(sale?.metodePembayaran).toBe('bon')
    expect(sale?.namaPelanggan).toBe('Bu Siti')
    expect(sale?.dibayar).toBe(0)
  })

  // This case throws during the pre-transaction resolve loop (proving the
  // pre-check, not db.transaction rollback) — the 'dibayar' rollback test
  // below is what actually exercises the transaction rollback path.
  it('rolls back everything when stock is insufficient', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 999999_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 999 }],
    }

    expect(() => checkout(db, input)).toThrow('Stok Beras 5kg tidak cukup.')

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(10)
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('rolls back the whole transaction when dibayar is less than the total', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 1000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    }

    expect(() => checkout(db, input)).toThrow('Uang bayar kurang dari total belanja.')

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(10)
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('throws when a product does not exist', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 100_00,
      userId: 1,
      items: [{ productId: 999, productUnitId: null, qty: 1 }],
    }

    expect(() => checkout(db, input)).toThrow('Produk tidak ditemukan.')
  })

  it('throws when the given product unit does not belong to the product', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 100_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: 9, qty: 1 }], // unit 9 belongs to product 2
    }

    expect(() => checkout(db, input)).toThrow('Satuan tidak valid untuk Beras 5kg.')
  })

  it('throws and creates no sale when the cart is empty', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 0,
      userId: 1,
      items: [],
    }

    expect(() => checkout(db, input)).toThrow('Keranjang tidak boleh kosong.')
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('throws when qty is negative', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 100_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: -1 }],
    }

    expect(() => checkout(db, input)).toThrow('Qty harus lebih dari 0.')
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('throws when qty is zero', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 100_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 0 }],
    }

    expect(() => checkout(db, input)).toThrow('Qty harus lebih dari 0.')
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('allows a fractional qty, deducting stock and rounding the subtotal to the nearest cent', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 2_000_000,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 0.25 }],
    }

    const result = checkout(db, input)
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    const items = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()

    expect(items[0].qty).toBe(0.25)
    expect(items[0].subtotal).toBe(Math.round(0.25 * items[0].hargaJual))
    expect(result.total).toBe(items[0].subtotal)
    expect(product?.stok).toBe(10 - 0.25)
  })

  it('files the whole sale under the given date when tanggal is passed', () => {
    const db = seedDb()
    const tanggal = '2026-08-01T09:30'

    checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      tanggal,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    const expected = new Date(tanggal).toISOString()
    expect(db.select().from(sales).get()?.createdAt.toISOString()).toBe(expected)
    expect(db.select().from(saleItems).get()?.createdAt.toISOString()).toBe(expected)
    expect(db.select().from(stockMovements).get()?.createdAt.toISOString()).toBe(expected)
  })

  it('rejects a sale dated in the future', () => {
    const db = seedDb()
    // 24h buffer keeps this in the future regardless of the machine's timezone offset
    const besok = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16)

    expect(() =>
      checkout(db, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 3000_00,
        userId: 1,
        tanggal: besok,
        items: [{ productId: 2, productUnitId: null, qty: 1 }],
      }),
    ).toThrow('Tanggal transaksi tidak boleh melewati waktu sekarang.')
    expect(db.select().from(sales).all()).toHaveLength(0)
    expect(db.select().from(saleItems).all()).toHaveLength(0)
    expect(db.select().from(stockMovements).all()).toHaveLength(0)
  })

  it('rejects a tanggal that is not a date at all', () => {
    const db = seedDb()

    expect(() =>
      checkout(db, {
        metodePembayaran: 'tunai',
        namaPelanggan: null,
        dibayar: 3000_00,
        userId: 1,
        tanggal: 'kemarin',
        items: [{ productId: 2, productUnitId: null, qty: 1 }],
      }),
    ).toThrow('Tanggal transaksi tidak valid.')
    expect(db.select().from(sales).all()).toHaveLength(0)
    expect(db.select().from(saleItems).all()).toHaveLength(0)
    expect(db.select().from(stockMovements).all()).toHaveLength(0)
  })

  it('uses the current time when tanggal is omitted', () => {
    const db = seedDb()
    const before = Date.now()

    checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    const createdAt = db.select().from(sales).get()?.createdAt.getTime() ?? 0
    expect(createdAt).toBeGreaterThanOrEqual(before - 1000)
    expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('throws when bon has an empty customer name', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'bon',
      namaPelanggan: '',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    }

    expect(() => checkout(db, input)).toThrow('Nama pelanggan wajib diisi untuk transaksi bon.')
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('throws when bon customer name is only whitespace', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'bon',
      namaPelanggan: '   ',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    }

    expect(() => checkout(db, input)).toThrow('Nama pelanggan wajib diisi untuk transaksi bon.')
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('succeeds for bon with a real customer name (regression guard)', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    }

    const result = checkout(db, input)
    const sale = db.select().from(sales).where(eq(sales.id, result.saleId)).get()
    expect(sale?.namaPelanggan).toBe('Bu Siti')
  })

  it('throws when the same product across two cart lines exceeds stock cumulatively', () => {
    const db = seedDb()

    // Product 2 (Mie Instan) has stok: 100 and a DUS unit with konversi 40.
    // Neither line alone exceeds stock (70 <= 100, 40 <= 100), but combined
    // qtyDasar is 70 + 40 = 110 > 100.
    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 999999_00,
      userId: 1,
      items: [
        { productId: 2, productUnitId: null, qty: 70 },
        { productId: 2, productUnitId: 9, qty: 1 },
      ],
    }

    expect(() => checkout(db, input)).toThrow('Stok Mie Instan tidak cukup.')
    expect(db.select().from(sales).all()).toHaveLength(0)

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    expect(product?.stok).toBe(100)
  })
})

describe('cancelSale', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedDbWithOneSale() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({
        id: 1,
        username: 'kasir1',
        passwordHash: 'hash',
        name: 'Kasir Satu',
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 5,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    seedPcsBaseUnits(db, [{ id: 101, productId: 1, hargaJual: 65000_00 }])

    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 400000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    })

    return { db, saleId: result.saleId }
  }

  it('restores stock and marks the sale as dibatalkan', () => {
    const { db, saleId } = seedDbWithOneSale()

    cancelSale(db, saleId)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(5)

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.status).toBe('dibatalkan')
  })

  it('throws when the sale is already cancelled', () => {
    const { db, saleId } = seedDbWithOneSale()
    cancelSale(db, saleId)

    expect(() => cancelSale(db, saleId)).toThrow('Transaksi sudah dibatalkan.')
  })

  it('records a reversing sale_cancel stock movement', () => {
    const { db, saleId } = seedDbWithOneSale()

    cancelSale(db, saleId)

    const movements = db.select().from(stockMovements).where(eq(stockMovements.referenceId, saleId)).all()
    const reversal = movements.filter((movement) => movement.movementType === 'sale_cancel')
    expect(reversal).toHaveLength(1)
    expect(reversal[0].quantity).toBe(5)
    expect(reversal[0].baseQuantity).toBe(5)
    // the ledger nets to zero once the sale is undone
    expect(movements.reduce((sum, movement) => sum + movement.baseQuantity, 0)).toBe(0)
  })

  it('restores stock multiplied by konversi when the sale line used a product unit', () => {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({
        id: 1,
        username: 'kasir1',
        passwordHash: 'hash',
        name: 'Kasir Satu',
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(products)
      .values({
        id: 2,
        kodeItem: 'MIE1',
        namaItem: 'Mie Instan',
        hargaJual: 3000_00,
        hargaPokok: 2500_00,
        stok: 100,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    seedPcsBaseUnits(db, [{ id: 102, productId: 2, hargaJual: 3000_00 }])

    db.insert(productUnits)
      .values({
        id: 9,
        productId: 2,
        unitId: DUS_UNIT_ID,
        jumlahKemasan: 40,
        conversionFactor: 40,
        hargaJual: 110000_00,
        // product 2's base cost is 2.500, so a DUS of 40 costs 100.000
        hargaPokok: 100000_00,
        isBaseUnit: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 220000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: 9, qty: 2 }],
    })

    const afterCheckout = db.select().from(products).where(eq(products.id, 2)).get()
    expect(afterCheckout?.stok).toBe(20) // 100 - (2 * 40)

    cancelSale(db, result.saleId)

    const afterCancel = db.select().from(products).where(eq(products.id, 2)).get()
    expect(afterCancel?.stok).toBe(100) // restored: 20 + (2 * 40)
  })

  it('throws when the sale has bon payments recorded', () => {
    const { db, saleId } = seedDbWithOneSale()
    const now = new Date()

    db.insert(bonPayments)
      .values({ saleId, jumlah: 10000_00, tanggal: '2026-08-06', createdAt: now, updatedAt: now })
      .run()

    expect(() => cancelSale(db, saleId)).toThrow('Tidak bisa membatalkan, bon sudah ada pembayaran.')
  })

  it('throws when the sale does not exist', () => {
    const { db } = seedDbWithOneSale()
    expect(() => cancelSale(db, 999)).toThrow('Transaksi tidak ditemukan.')
  })
})

describe('deleteSale', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedDbWithOneSale() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({
        id: 1,
        username: 'kasir1',
        passwordHash: 'hash',
        name: 'Kasir Satu',
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 5,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    seedPcsBaseUnits(db, [{ id: 101, productId: 1, hargaJual: 65000_00 }])

    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 400000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    })

    return { db, saleId: result.saleId }
  }

  it('restores stock and removes the sale with its items', () => {
    const { db, saleId } = seedDbWithOneSale()

    expect(db.select().from(products).where(eq(products.id, 1)).get()?.stok).toBe(0)

    deleteSale(db, saleId)

    expect(db.select().from(products).where(eq(products.id, 1)).get()?.stok).toBe(5)
    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()).toBeUndefined()
    expect(db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()).toHaveLength(0)
  })

  it('does not restore stock twice when the sale was already cancelled', () => {
    const { db, saleId } = seedDbWithOneSale()

    cancelSale(db, saleId)
    deleteSale(db, saleId)

    expect(db.select().from(products).where(eq(products.id, 1)).get()?.stok).toBe(5)
    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()).toBeUndefined()
  })

  it('throws when the sale has bon payments recorded', () => {
    const { db, saleId } = seedDbWithOneSale()
    const now = new Date()

    db.insert(bonPayments)
      .values({ saleId, jumlah: 10000_00, tanggal: '2026-08-06', createdAt: now, updatedAt: now })
      .run()

    expect(() => deleteSale(db, saleId)).toThrow('Tidak bisa menghapus, bon sudah ada pembayaran.')
    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()).toBeDefined()
  })

  it('throws when the sale does not exist', () => {
    const { db } = seedDbWithOneSale()
    expect(() => deleteSale(db, 999)).toThrow('Transaksi tidak ditemukan.')
  })
})

describe('recordBonPayment', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedDbWithOneBonSale() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({
        id: 1,
        username: 'kasir1',
        passwordHash: 'hash',
        name: 'Kasir Satu',
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 10,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    seedPcsBaseUnits(db, [{ id: 101, productId: 1, hargaJual: 65000_00 }])

    const result = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 3 }],
    })

    return { db, saleId: result.saleId, total: 3 * 65000_00 }
  }

  it('records a payment, increments dibayar, and inserts a bon_payments row dated today', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    const now = new Date()
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    recordBonPayment(db, saleId, 50000_00, 'Cicilan pertama')

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.dibayar).toBe(50000_00)

    const payments = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).all()
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({
      saleId,
      jumlah: 50000_00,
      tanggal: todayLocal,
      keterangan: 'Cicilan pertama',
    })
  })

  it('allows a payment with keterangan omitted (null)', () => {
    const { db, saleId } = seedDbWithOneBonSale()

    recordBonPayment(db, saleId, 10000_00, null)

    const payments = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).all()
    expect(payments[0].keterangan).toBeNull()
  })

  it('allows a payment that exactly clears sisaPiutang', () => {
    const { db, saleId, total } = seedDbWithOneBonSale()

    recordBonPayment(db, saleId, total, null)

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.dibayar).toBe(total)
  })

  it('accumulates dibayar across multiple payments', () => {
    const { db, saleId } = seedDbWithOneBonSale()

    recordBonPayment(db, saleId, 50000_00, null)
    recordBonPayment(db, saleId, 30000_00, null)

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.dibayar).toBe(80000_00)

    const payments = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).all()
    expect(payments).toHaveLength(2)
  })

  it('throws when the sale does not exist', () => {
    const { db } = seedDbWithOneBonSale()
    expect(() => recordBonPayment(db, 999, 1000_00, null)).toThrow('Transaksi tidak ditemukan.')
  })

  it('throws when the sale is not a bon sale', () => {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 10,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    seedPcsBaseUnits(db, [{ id: 101, productId: 1, hargaJual: 65000_00 }])

    const result = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    expect(() => recordBonPayment(db, result.saleId, 1000_00, null)).toThrow('Transaksi ini bukan bon aktif.')
  })

  it('throws when the sale has been cancelled', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    cancelSale(db, saleId)

    expect(() => recordBonPayment(db, saleId, 1000_00, null)).toThrow('Transaksi ini bukan bon aktif.')
  })

  it('throws when jumlah is zero or negative', () => {
    const { db, saleId } = seedDbWithOneBonSale()

    expect(() => recordBonPayment(db, saleId, 0, null)).toThrow('Jumlah bayar harus lebih dari 0.')
    expect(() => recordBonPayment(db, saleId, -1000_00, null)).toThrow('Jumlah bayar harus lebih dari 0.')
  })

  it('throws when jumlah is not an integer', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    expect(() => recordBonPayment(db, saleId, 1000.5, null)).toThrow('Jumlah bayar harus lebih dari 0.')
  })

  it('throws when jumlah exceeds sisaPiutang', () => {
    const { db, saleId, total } = seedDbWithOneBonSale()
    expect(() => recordBonPayment(db, saleId, total + 1, null)).toThrow('Jumlah bayar melebihi sisa piutang.')
  })

  it('throws when keterangan exceeds 500 characters', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    const tooLong = 'a'.repeat(501)
    expect(() => recordBonPayment(db, saleId, 1000_00, tooLong)).toThrow('Keterangan maksimal 500 karakter.')
  })

  it('allows keterangan of exactly 500 characters', () => {
    const { db, saleId } = seedDbWithOneBonSale()
    const exactly500 = 'a'.repeat(500)
    expect(() => recordBonPayment(db, saleId, 1000_00, exactly500)).not.toThrow()
  })

  it('does not mutate state when a validation error is thrown', () => {
    const { db, saleId, total } = seedDbWithOneBonSale()

    expect(() => recordBonPayment(db, saleId, total + 1, null)).toThrow()

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.dibayar).toBe(0)
    expect(db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).all()).toHaveLength(0)
  })
})

describe('addItemsToSale', () => {
  function seedWithBon() {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Sri',
      dibayar: null,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 2 }],
    })

    return { db, saleId }
  }

  it('appends the item, raises the total, and cuts stock', () => {
    const { db, saleId } = seedWithBon()
    const stokAwal = db.select().from(products).where(eq(products.id, 2)).get()?.stok ?? 0
    const totalAwal = db.select().from(sales).where(eq(sales.id, saleId)).get()?.total ?? 0

    const result = addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 3 }])

    expect(result.total).toBe(totalAwal + 3 * 3000_00)
    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()?.total).toBe(totalAwal + 3 * 3000_00)
    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()?.dibayar).toBe(0)
    expect(db.select().from(products).where(eq(products.id, 2)).get()?.stok).toBe(stokAwal - 3)
    expect(db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()).toHaveLength(2)
  })

  it('logs a stock movement for the added line', () => {
    const { db, saleId } = seedWithBon()

    addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 3 }])

    const movements = db.select().from(stockMovements).where(eq(stockMovements.referenceId, saleId)).all()
    expect(movements).toHaveLength(2)
    const addedMovement = movements.find((movement) => movement.movementType === 'sale' && movement.quantity === -3)
    expect(addedMovement?.movementType).toBe('sale')
    expect(addedMovement?.quantity).toBe(-3)
  })

  it('does not move the sale date, because the bon is still the old bon', () => {
    const { db, saleId } = seedWithBon()
    const before = db.select().from(sales).where(eq(sales.id, saleId)).get()?.createdAt.toISOString()

    addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 1 }])

    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()?.createdAt.toISOString()).toBe(before)
  })

  it('refuses a sale that is not a bon', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    expect(() => addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 1 }])).toThrow(
      'Hanya transaksi bon yang bisa ditambah item.',
    )
  })

  it('refuses a cancelled sale', () => {
    const { db, saleId } = seedWithBon()
    cancelSale(db, saleId)

    expect(() => addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 1 }])).toThrow(
      'Transaksi yang dibatalkan tidak bisa ditambah item.',
    )
  })

  it('refuses a bon that is already settled', () => {
    const { db, saleId } = seedWithBon()
    const total = db.select().from(sales).where(eq(sales.id, saleId)).get()?.total ?? 0
    recordBonPayment(db, saleId, total, null)

    expect(() => addItemsToSale(db, saleId, [{ productId: 2, productUnitId: null, qty: 1 }])).toThrow(
      'Bon sudah lunas, tidak bisa ditambah item.',
    )
  })

  it('refuses a sale that does not exist', () => {
    const db = seedDb()

    expect(() => addItemsToSale(db, 999, [{ productId: 2, productUnitId: null, qty: 1 }])).toThrow(
      'Transaksi tidak ditemukan.',
    )
  })

  it('refuses an empty item list', () => {
    const { db, saleId } = seedWithBon()

    expect(() => addItemsToSale(db, saleId, [])).toThrow('Tidak ada item yang ditambahkan.')
  })

  it('writes nothing when one line asks for more qty than there is stock', () => {
    const { db, saleId } = seedWithBon()
    const stokAwal = db.select().from(products).where(eq(products.id, 1)).get()?.stok ?? 0
    const itemsAwal = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all().length

    expect(() =>
      addItemsToSale(db, saleId, [
        { productId: 2, productUnitId: null, qty: 1 },
        { productId: 1, productUnitId: null, qty: 9999 },
      ]),
    ).toThrow('Stok Beras 5kg tidak cukup.')

    expect(db.select().from(products).where(eq(products.id, 1)).get()?.stok).toBe(stokAwal)
    expect(db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()).toHaveLength(itemsAwal)
  })
})

describe('updateStoreSettings', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  it('inserts a new row when none exists yet', () => {
    const db = createDb(':memory:', migrationsFolder)

    updateStoreSettings(db, {
      namaToko: 'Toko Baru',
      alamat: 'Jl. Baru',
      telepon: '021',
      pesanFooter: 'Terima kasih',
      printerName: null,
      receiptWidth: '58mm',
    })

    const setting = db.select().from(storeSettings).get()
    expect(setting).toMatchObject({
      namaToko: 'Toko Baru',
      alamat: 'Jl. Baru',
      telepon: '021',
      pesanFooter: 'Terima kasih',
      printerName: null,
      receiptWidth: '58mm',
    })
  })

  it('updates the existing row instead of inserting a second one', () => {
    const db = createDb(':memory:', migrationsFolder)
    updateStoreSettings(db, {
      namaToko: 'Toko A',
      alamat: null,
      telepon: null,
      pesanFooter: null,
      printerName: null,
      receiptWidth: '58mm',
    })

    updateStoreSettings(db, {
      namaToko: 'Toko B',
      alamat: 'Jl. B',
      telepon: '022',
      pesanFooter: 'Footer B',
      printerName: 'EPPOS EP58M',
      receiptWidth: '80mm',
    })

    const rows = db.select().from(storeSettings).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      namaToko: 'Toko B',
      alamat: 'Jl. B',
      telepon: '022',
      pesanFooter: 'Footer B',
      printerName: 'EPPOS EP58M',
      receiptWidth: '80mm',
    })
  })

  it('allows null alamat/telepon/pesanFooter', () => {
    const db = createDb(':memory:', migrationsFolder)

    updateStoreSettings(db, {
      namaToko: 'Toko',
      alamat: null,
      telepon: null,
      pesanFooter: null,
      printerName: null,
      receiptWidth: '58mm',
    })

    const setting = db.select().from(storeSettings).get()
    expect(setting).toMatchObject({ namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null })
  })

  it('throws when namaToko is empty', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() =>
      updateStoreSettings(db, { namaToko: '', alamat: null, telepon: null, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Nama toko wajib diisi.')
  })

  it('throws when namaToko is only whitespace', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() =>
      updateStoreSettings(db, { namaToko: '   ', alamat: null, telepon: null, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Nama toko wajib diisi.')
  })

  it('throws when namaToko exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() =>
      updateStoreSettings(db, { namaToko: tooLong, alamat: null, telepon: null, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Nama toko maksimal 255 karakter.')
  })

  it('allows namaToko of exactly 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const exactly255 = 'a'.repeat(255)
    expect(() =>
      updateStoreSettings(db, {
        namaToko: exactly255,
        alamat: null,
        telepon: null,
        pesanFooter: null,
        printerName: null,
        receiptWidth: '58mm',
      }),
    ).not.toThrow()
  })

  it('throws when alamat exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() =>
      updateStoreSettings(db, { namaToko: 'Toko', alamat: tooLong, telepon: null, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Alamat maksimal 255 karakter.')
  })

  it('throws when telepon exceeds 50 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = '1'.repeat(51)
    expect(() =>
      updateStoreSettings(db, { namaToko: 'Toko', alamat: null, telepon: tooLong, pesanFooter: null, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Telepon maksimal 50 karakter.')
  })

  it('throws when pesanFooter exceeds 255 characters', () => {
    const db = createDb(':memory:', migrationsFolder)
    const tooLong = 'a'.repeat(256)
    expect(() =>
      updateStoreSettings(db, { namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: tooLong, printerName: null, receiptWidth: '58mm' }),
    ).toThrow('Pesan footer maksimal 255 karakter.')
  })

  it('allows a non-null printerName', () => {
    const db = createDb(':memory:', migrationsFolder)
    updateStoreSettings(db, {
      namaToko: 'Toko',
      alamat: null,
      telepon: null,
      pesanFooter: null,
      printerName: '80mm Series Printer',
      receiptWidth: '58mm',
    })
    const setting = db.select().from(storeSettings).get()
    expect(setting?.printerName).toBe('80mm Series Printer')
  })

  it('allows receiptWidth of 80mm', () => {
    const db = createDb(':memory:', migrationsFolder)
    updateStoreSettings(db, {
      namaToko: 'Toko',
      alamat: null,
      telepon: null,
      pesanFooter: null,
      printerName: null,
      receiptWidth: '80mm',
    })
    const setting = db.select().from(storeSettings).get()
    expect(setting?.receiptWidth).toBe('80mm')
  })

  it('throws when receiptWidth is not 58mm or 80mm', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() =>
      updateStoreSettings(db, {
        namaToko: 'Toko',
        alamat: null,
        telepon: null,
        pesanFooter: null,
        printerName: null,
        // @ts-expect-error - deliberately invalid for this test
        receiptWidth: '100mm',
      }),
    ).toThrow('Lebar kertas tidak valid.')
  })
})

describe('purgeSalesBefore', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedThreeSales() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 100,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    seedPcsBaseUnits(db, [{ id: 101, productId: 1, hargaJual: 65000_00 }])

    const oldSale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })
    db.update(sales).set({ createdAt: new Date('2020-01-01T10:00:00') }).where(eq(sales.id, oldSale.saleId)).run()

    const bonSale = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })
    db.update(sales).set({ createdAt: new Date('2020-01-02T10:00:00') }).where(eq(sales.id, bonSale.saleId)).run()

    const recentSale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    return { db, oldSaleId: oldSale.saleId, bonSaleId: bonSale.saleId, recentSaleId: recentSale.saleId }
  }

  it('deletes only sales created before the given date, returns the count deleted', () => {
    const { db, oldSaleId, bonSaleId, recentSaleId } = seedThreeSales()

    const deleted = purgeSalesBefore(db, new Date('2020-01-03T00:00:00'))

    expect(deleted).toBe(2)
    expect(db.select().from(sales).where(eq(sales.id, oldSaleId)).get()).toBeUndefined()
    expect(db.select().from(sales).where(eq(sales.id, bonSaleId)).get()).toBeUndefined()
    expect(db.select().from(sales).where(eq(sales.id, recentSaleId)).get()).toBeDefined()
  })

  it('cascades to sale_items and bon_payments', () => {
    const { db, bonSaleId } = seedThreeSales()
    const now = new Date()
    db.insert(bonPayments)
      .values({ saleId: bonSaleId, jumlah: 10000_00, tanggal: '2020-01-02', createdAt: now, updatedAt: now })
      .run()

    purgeSalesBefore(db, new Date('2020-01-03T00:00:00'))

    expect(db.select().from(saleItems).where(eq(saleItems.saleId, bonSaleId)).all()).toHaveLength(0)
    expect(db.select().from(bonPayments).where(eq(bonPayments.saleId, bonSaleId)).all()).toHaveLength(0)
  })

  it('returns 0 and deletes nothing when no sales are before the cutoff', () => {
    const { db, oldSaleId, bonSaleId, recentSaleId } = seedThreeSales()

    const deleted = purgeSalesBefore(db, new Date('2019-01-01T00:00:00'))

    expect(deleted).toBe(0)
    expect(db.select().from(sales).where(eq(sales.id, oldSaleId)).get()).toBeDefined()
    expect(db.select().from(sales).where(eq(sales.id, bonSaleId)).get()).toBeDefined()
    expect(db.select().from(sales).where(eq(sales.id, recentSaleId)).get()).toBeDefined()
  })

  it('throws when the cutoff date is in the future', () => {
    const { db } = seedThreeSales()
    expect(() => purgeSalesBefore(db, new Date('2099-01-01T00:00:00'))).toThrow('Tanggal tidak boleh di masa depan.')
  })

  it('allows a cutoff of exactly today (does not throw)', () => {
    const { db } = seedThreeSales()
    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)
    expect(() => purgeSalesBefore(db, todayMidnight)).not.toThrow()
  })

  it('does not delete anything when a future date is rejected', () => {
    const { db, oldSaleId } = seedThreeSales()

    expect(() => purgeSalesBefore(db, new Date('2099-01-01T00:00:00'))).toThrow()

    expect(db.select().from(sales).where(eq(sales.id, oldSaleId)).get()).toBeDefined()
  })
})

describe('purgeTodaySales', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedProductAndUser(db: ReturnType<typeof createDb>) {
    const now = new Date()

    db.insert(users)
      .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 100,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    seedPcsBaseUnits(db, [{ id: 101, productId: 1, hargaJual: 65000_00 }])
  }

  function seedTodayAndYesterday() {
    const db = createDb(':memory:', migrationsFolder)
    seedProductAndUser(db)

    const todaySale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00 * 5,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    })

    const yesterdaySale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00 * 2,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 2 }],
    })
    db.update(sales).set({ createdAt: new Date('2020-01-01T10:00:00') }).where(eq(sales.id, yesterdaySale.saleId)).run()

    return { db, todaySaleId: todaySale.saleId, yesterdaySaleId: yesterdaySale.saleId }
  }

  it('deletes only sales created today, returns the count deleted, leaves older sales untouched', () => {
    const { db, todaySaleId, yesterdaySaleId } = seedTodayAndYesterday()

    const result = purgeTodaySales(db)

    expect(result).toEqual({ deleted: 1, skipped: 0 })
    expect(db.select().from(sales).where(eq(sales.id, todaySaleId)).get()).toBeUndefined()
    expect(db.select().from(sales).where(eq(sales.id, yesterdaySaleId)).get()).toBeDefined()
  })

  it('restores stock for deleted sales, leaves stock for untouched older sales alone', () => {
    const { db } = seedTodayAndYesterday()

    purgeTodaySales(db)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    // 100 - 5 (today) - 2 (yesterday) = 93, then +5 restored for today's deleted sale = 98
    expect(product?.stok).toBe(98)
  })

  it('cascades to sale_items for deleted sales', () => {
    const { db, todaySaleId } = seedTodayAndYesterday()

    purgeTodaySales(db)

    expect(db.select().from(saleItems).where(eq(saleItems.saleId, todaySaleId)).all()).toHaveLength(0)
  })

  it('does not double-restore stock for an already-dibatalkan sale', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedProductAndUser(db)

    const sale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00 * 5,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 5 }],
    })

    cancelSale(db, sale.saleId) // stok: 100 - 5 + 5 = 100

    const result = purgeTodaySales(db)

    expect(result).toEqual({ deleted: 1, skipped: 0 })
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(100) // not 105 - no double restore
  })

  it('skips a bon sale with existing payments, leaves it in the database, still deletes the rest', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedProductAndUser(db)
    const now = new Date()

    const bonSale = checkout(db, {
      metodePembayaran: 'bon',
      namaPelanggan: 'Bu Siti',
      dibayar: null,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 3 }],
    })

    db.insert(bonPayments)
      .values({ saleId: bonSale.saleId, jumlah: 10000_00, tanggal: '2026-01-01', createdAt: now, updatedAt: now })
      .run()

    const otherSale = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })

    const result = purgeTodaySales(db)

    expect(result).toEqual({ deleted: 1, skipped: 1 })
    expect(db.select().from(sales).where(eq(sales.id, bonSale.saleId)).get()).toBeDefined()
    expect(db.select().from(sales).where(eq(sales.id, otherSale.saleId)).get()).toBeUndefined()
  })

  it('returns zero deleted and skipped when there are no sales today', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedProductAndUser(db)

    const result = purgeTodaySales(db)

    expect(result).toEqual({ deleted: 0, skipped: 0 })
  })
})

describe('listCustomers', () => {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle')

  function seedDb() {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()

    db.insert(users)
      .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
      .run()

    db.insert(products)
      .values({
        id: 1,
        kodeItem: 'BRS5',
        namaItem: 'Beras 5kg',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 100,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    seedPcsBaseUnits(db, [{ id: 101, productId: 1, hargaJual: 65000_00 }])

    return db
  }

  function sell(db: ReturnType<typeof createDb>, namaPelanggan: string | null) {
    checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan,
      dibayar: 65000_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1 }],
    })
  }

  it('returns each name once, most recently used first', () => {
    const db = seedDb()
    sell(db, 'Bu Siti')
    sell(db, 'UMUM')
    sell(db, 'Pak Budi')
    sell(db, 'Bu Siti')

    expect(listCustomers(db)).toEqual(['Bu Siti', 'Pak Budi', 'UMUM'])
  })

  it('skips sales with no usable name', () => {
    const db = seedDb()
    sell(db, null)
    sell(db, '   ')
    sell(db, 'Bu Siti')

    expect(listCustomers(db)).toEqual(['Bu Siti'])
  })

  it('returns nothing on a database with no sales', () => {
    expect(listCustomers(seedDb())).toEqual([])
  })
})

describe('updateSaleDate', () => {
  it('moves the sale to the new date', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })

    updateSaleDate(db, saleId, '2026-07-04T14:05')

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
    expect(sale?.createdAt.toISOString()).toBe(new Date('2026-07-04T14:05').toISOString())
  })

  it('leaves stock movements where they are, because they record when the goods left', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })
    const before = db.select().from(stockMovements).get()?.createdAt.toISOString()

    updateSaleDate(db, saleId, '2026-07-04T14:05')

    expect(db.select().from(stockMovements).get()?.createdAt.toISOString()).toBe(before)
  })

  it('rejects a sale that does not exist', () => {
    const db = seedDb()

    expect(() => updateSaleDate(db, 999, '2026-07-04T14:05')).toThrow('Transaksi tidak ditemukan.')
  })

  it('rejects a future date', () => {
    const db = seedDb()
    const { saleId } = checkout(db, {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 3000_00,
      userId: 1,
      items: [{ productId: 2, productUnitId: null, qty: 1 }],
    })
    const besok = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16)

    expect(() => updateSaleDate(db, saleId, besok)).toThrow('Tanggal transaksi tidak boleh melewati waktu sekarang.')
  })
})
