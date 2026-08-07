import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products } from './db/schema'
import { getProductUnits, setProductUnit, deleteProductUnit } from './inventory-units'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedProduct() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(products)
    .values({
      id: 1,
      kodeItem: 'RKK1',
      barcode: null,
      namaItem: 'Rokok A',
      categoryId: null,
      satuan: 'Pcs',
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
}

describe('getProductUnits', () => {
  it('returns null for both levels when none exist', () => {
    const db = seedProduct()
    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })
})

describe('setProductUnit', () => {
  const validInput = { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }

  it('creates a level 2 unit with konversi equal to jumlahKemasan', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)

    const { level2, level3 } = getProductUnits(db, 1)
    expect(level2).toMatchObject({ level: 2, satuan: 'Renteng', jumlahKemasan: 12, konversi: 12, hargaJual: 15000_00 })
    expect(level3).toBeNull()
  })

  it('creates a level 3 unit with konversi = jumlahKemasan * level 2 konversi', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })

    const { level3 } = getProductUnits(db, 1)
    expect(level3).toMatchObject({ level: 3, satuan: 'Dus', jumlahKemasan: 10, konversi: 120 })
  })

  it('throws when level 3 is set before level 2 exists', () => {
    const db = seedProduct()

    expect(() => setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })).toThrow(
      'Isi Level 2 (satuan turunan pertama) dulu sebelum Level 3.',
    )
  })

  it('updates an existing level 2 unit (upsert)', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)
    setProductUnit(db, 1, 2, { satuan: 'Renteng Baru', jumlahKemasan: 20, hargaJual: 20000_00 })

    const { level2 } = getProductUnits(db, 1)
    expect(level2).toMatchObject({ satuan: 'Renteng Baru', jumlahKemasan: 20, konversi: 20, hargaJual: 20000_00 })
  })

  it('recomputes level 3 konversi when level 2 is updated, keeping level 3 jumlahKemasan unchanged', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput) // konversi 12
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 }) // konversi 120
    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 24, hargaJual: 15000_00 }) // konversi 24

    const { level3 } = getProductUnits(db, 1)
    expect(level3?.konversi).toBe(240) // 10 * 24
    expect(level3?.jumlahKemasan).toBe(10) // unchanged relative quantity
  })

  it('throws when satuan is empty', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, satuan: '' })).toThrow('Satuan wajib diisi.')
  })

  it('throws when satuan exceeds 20 characters', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, satuan: 'a'.repeat(21) })).toThrow('Satuan maksimal 20 karakter.')
  })

  it('throws when jumlahKemasan is not finite', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: NaN })).toThrow('Jumlah kemasan wajib diisi.')
  })

  it('throws when jumlahKemasan is less than 1', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: 0 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when jumlahKemasan is not an integer', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: 1.5 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when hargaJual is not finite', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, hargaJual: NaN })).toThrow('Harga jual wajib diisi.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })
})

describe('deleteProductUnit', () => {
  it('deletes a level 2 unit with no level 3', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    deleteProductUnit(db, 1, 2)

    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })

  it('deletes a level 3 unit without affecting level 2', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })
    deleteProductUnit(db, 1, 3)

    const { level2, level3 } = getProductUnits(db, 1)
    expect(level2).not.toBeNull()
    expect(level3).toBeNull()
  })

  it('cascades: deleting level 2 also deletes level 3', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })
    deleteProductUnit(db, 1, 2)

    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })

  it('is a no-op when the level does not exist', () => {
    const db = seedProduct()
    expect(() => deleteProductUnit(db, 1, 2)).not.toThrow()
  })
})
