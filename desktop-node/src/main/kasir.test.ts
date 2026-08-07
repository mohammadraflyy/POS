import { describe, expect, it } from 'vitest'
import { priceForQty, resolveCartItem, type ProductRow, type ProductUnitRow } from './kasir'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { users, products, productUnits, productPriceTiers, sales, saleItems, bonPayments } from './db/schema'
import { checkout, type CheckoutInput, cancelSale, recordBonPayment } from './kasir'

describe('priceForQty', () => {
  it('falls back to the base price when there are no tiers', () => {
    expect(priceForQty([], 10000, 5)).toBe(10000)
  })

  it('applies a tier when qty meets its threshold', () => {
    expect(priceForQty([{ minQty: 10, hargaJual: 9000 }], 10000, 12)).toBe(9000)
  })

  it('picks the highest satisfied tier threshold', () => {
    const tiers = [
      { minQty: 10, hargaJual: 9500 },
      { minQty: 50, hargaJual: 9000 },
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
    satuan: 'PCS',
    hargaJual: 65000_00,
    hargaPokok: 60000_00,
    stok: 30,
  }

  it('resolves the base unit with tier pricing when no product unit is given', () => {
    const result = resolveCartItem(product, null, [{ minQty: 5, hargaJual: 62000_00 }], 5)
    expect(result).toEqual({
      productId: 1,
      productUnitId: null,
      satuan: 'PCS',
      konversi: 1,
      hargaJual: 62000_00,
      hargaPokok: 60000_00,
      qty: 5,
      qtyDasar: 5,
    })
  })

  it('resolves a product unit, overriding satuan/konversi/hargaJual', () => {
    const unit: ProductUnitRow = { id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000_00 }
    const result = resolveCartItem(product, unit, [], 2)
    expect(result).toEqual({
      productId: 1,
      productUnitId: 9,
      satuan: 'DUS',
      konversi: 12,
      hargaJual: 700000_00,
      hargaPokok: 60000_00,
      qty: 2,
      qtyDasar: 24,
    })
  })

  it('throws when base-unit stock is insufficient', () => {
    expect(() => resolveCartItem(product, null, [], 50)).toThrow('Stok Beras 5kg tidak cukup.')
  })

  it('throws when a product-unit purchase would exceed base-unit stock', () => {
    const unit: ProductUnitRow = { id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000_00 }
    expect(() => resolveCartItem(product, unit, [], 3)).toThrow('Stok Beras 5kg tidak cukup.')
  })
})

describe('checkout', () => {
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
          satuan: 'PCS',
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
          satuan: 'PCS',
          hargaJual: 3000_00,
          hargaPokok: 2500_00,
          stok: 100,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run()

    db.insert(productUnits)
      .values({
        id: 9,
        productId: 2,
        satuan: 'DUS',
        konversi: 40,
        hargaJual: 110000_00,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(productPriceTiers)
      .values({
        id: 1,
        productId: 1,
        minQty: 5,
        hargaJual: 62000_00,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return db
  }

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
      productUnitId: null,
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

    expect(() => checkout(db, input)).toThrow('Qty harus bilangan bulat minimal 1.')
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

    expect(() => checkout(db, input)).toThrow('Qty harus bilangan bulat minimal 1.')
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('throws when qty is not an integer', () => {
    const db = seedDb()

    const input: CheckoutInput = {
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      dibayar: 100_00,
      userId: 1,
      items: [{ productId: 1, productUnitId: null, qty: 1.5 }],
    }

    expect(() => checkout(db, input)).toThrow('Qty harus bilangan bulat minimal 1.')
    expect(db.select().from(sales).all()).toHaveLength(0)
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
        satuan: 'PCS',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 5,
        createdAt: now,
        updatedAt: now,
      })
      .run()

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
        satuan: 'PCS',
        hargaJual: 3000_00,
        hargaPokok: 2500_00,
        stok: 100,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(productUnits)
      .values({
        id: 9,
        productId: 2,
        satuan: 'DUS',
        konversi: 40,
        hargaJual: 110000_00,
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
        satuan: 'PCS',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 10,
        createdAt: now,
        updatedAt: now,
      })
      .run()

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
        satuan: 'PCS',
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        stok: 10,
        createdAt: now,
        updatedAt: now,
      })
      .run()

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
