import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import XLSX from 'xlsx'
import { createDb } from './db/migrate'
import { cashExpenses, users } from './db/schema'
import {
  recordCashExpense,
  updateCashExpense,
  listCashExpenses,
  listAllCashExpenses,
  buildExpenseWorkbook,
  deleteCashExpense,
} from './expense'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()

  return db
}

function expenseInput(overrides: Partial<Parameters<typeof recordCashExpense>[1]> = {}) {
  return {
    tanggal: '2026-08-10',
    kategori: 'DPAM',
    jumlah: 150000_00,
    keterangan: null,
    userId: 1,
    ...overrides,
  }
}

describe('recordCashExpense', () => {
  it('records an expense with a trimmed kategori', () => {
    const db = seedDb()
    const { expenseId } = recordCashExpense(db, expenseInput({ kategori: '  KARYAWAN  ', keterangan: '  gaji mingguan  ' }))

    expect(expenseId).toBeGreaterThan(0)

    const rows = db.select().from(cashExpenses).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tanggal: '2026-08-10',
      kategori: 'KARYAWAN',
      jumlah: 150000_00,
      keterangan: 'gaji mingguan',
      userId: 1,
    })
  })

  it('stores an empty keterangan as null', () => {
    const db = seedDb()
    recordCashExpense(db, expenseInput({ keterangan: '   ' }))

    expect(db.select().from(cashExpenses).all()[0].keterangan).toBeNull()
  })

  it('rejects a missing tanggal, blank kategori, or non-positive jumlah', () => {
    const db = seedDb()

    expect(() => recordCashExpense(db, expenseInput({ tanggal: '  ' }))).toThrow('Tanggal wajib diisi.')
    expect(() => recordCashExpense(db, expenseInput({ kategori: '  ' }))).toThrow('Kategori wajib diisi.')
    expect(() => recordCashExpense(db, expenseInput({ jumlah: 0 }))).toThrow('Jumlah harus lebih dari 0.')
    expect(() => recordCashExpense(db, expenseInput({ jumlah: -1 }))).toThrow('Jumlah harus lebih dari 0.')
    expect(db.select().from(cashExpenses).all()).toEqual([])
  })

  it('rejects an over-long kategori or keterangan', () => {
    const db = seedDb()

    expect(() => recordCashExpense(db, expenseInput({ kategori: 'X'.repeat(51) }))).toThrow('Kategori maksimal 50 karakter.')
    expect(() => recordCashExpense(db, expenseInput({ keterangan: 'X'.repeat(501) }))).toThrow(
      'Keterangan maksimal 500 karakter.',
    )
  })
})

describe('listCashExpenses', () => {
  it('lists newest first and sums the filtered rows, not only the page', () => {
    const db = seedDb()
    recordCashExpense(db, expenseInput({ tanggal: '2026-08-01', kategori: 'DPAM', jumlah: 100000_00 }))
    recordCashExpense(db, expenseInput({ tanggal: '2026-08-05', kategori: 'KARYAWAN', jumlah: 200000_00 }))
    recordCashExpense(db, expenseInput({ tanggal: '2026-08-09', kategori: 'BENSIN', jumlah: 50000_00 }))

    const result = listCashExpenses(db, { page: 1, pageSize: 10 })

    expect(result.data.map((e) => e.tanggal)).toEqual(['2026-08-09', '2026-08-05', '2026-08-01'])
    expect(result.total).toBe(3)
    expect(result.totalJumlah).toBe(350000_00)
  })

  it('filters by an inclusive date range', () => {
    const db = seedDb()
    recordCashExpense(db, expenseInput({ tanggal: '2026-07-31', jumlah: 100000_00 }))
    recordCashExpense(db, expenseInput({ tanggal: '2026-08-01', jumlah: 200000_00 }))
    recordCashExpense(db, expenseInput({ tanggal: '2026-08-31', jumlah: 300000_00 }))
    recordCashExpense(db, expenseInput({ tanggal: '2026-09-01', jumlah: 400000_00 }))

    const result = listCashExpenses(db, { from: '2026-08-01', to: '2026-08-31', page: 1 })

    expect(result.data.map((e) => e.tanggal)).toEqual(['2026-08-31', '2026-08-01'])
    expect(result.totalJumlah).toBe(500000_00)
  })

  it('paginates while the total stays the full count', () => {
    const db = seedDb()
    for (const day of ['01', '02', '03']) {
      recordCashExpense(db, expenseInput({ tanggal: `2026-08-${day}`, jumlah: 100000_00 }))
    }

    const result = listCashExpenses(db, { page: 2, pageSize: 10 })

    expect(result.data).toHaveLength(0)
    expect(result.currentPage).toBe(2)
    expect(result.lastPage).toBe(1)
    expect(result.total).toBe(3)
    expect(result.totalJumlah).toBe(300000_00)
  })

  it('names the user who recorded the expense', () => {
    const db = seedDb()
    recordCashExpense(db, expenseInput())

    expect(listCashExpenses(db, { page: 1 }).data[0].userName).toBe('Admin')
  })

  it('filters by a search term against kategori or keterangan', () => {
    const db = seedDb()
    recordCashExpense(db, expenseInput({ kategori: 'BENSIN', keterangan: 'motor kasir' }))
    recordCashExpense(db, expenseInput({ kategori: 'DPAM', keterangan: 'tagihan air' }))
    recordCashExpense(db, expenseInput({ kategori: 'LAIN-LAIN', keterangan: 'beli bensin motor' }))

    const byKategori = listCashExpenses(db, { q: 'bensin', page: 1 })
    expect(byKategori.data.map((e) => e.kategori).sort()).toEqual(['BENSIN', 'LAIN-LAIN'])

    const byKeterangan = listCashExpenses(db, { q: 'air', page: 1 })
    expect(byKeterangan.data).toHaveLength(1)
    expect(byKeterangan.data[0].kategori).toBe('DPAM')
  })
})

describe('updateCashExpense', () => {
  it('overwrites every field of an existing expense', () => {
    const db = seedDb()
    const { expenseId } = recordCashExpense(db, expenseInput({ kategori: 'DPAM', jumlah: 100000_00 }))

    updateCashExpense(db, expenseId, {
      tanggal: '2026-08-11',
      kategori: 'KARYAWAN',
      jumlah: 250000_00,
      keterangan: 'gaji lembur',
    })

    const row = db.select().from(cashExpenses).where(eq(cashExpenses.id, expenseId)).get()
    expect(row).toMatchObject({
      tanggal: '2026-08-11',
      kategori: 'KARYAWAN',
      jumlah: 250000_00,
      keterangan: 'gaji lembur',
    })
  })

  it('rejects an unknown id', () => {
    const db = seedDb()
    expect(() =>
      updateCashExpense(db, 99, { tanggal: '2026-08-11', kategori: 'DPAM', jumlah: 1000_00, keterangan: null }),
    ).toThrow('Pengeluaran tidak ditemukan.')
  })

  it('rejects the same invalid input as recordCashExpense', () => {
    const db = seedDb()
    const { expenseId } = recordCashExpense(db, expenseInput())

    expect(() => updateCashExpense(db, expenseId, { tanggal: '2026-08-11', kategori: '  ', jumlah: 1000_00, keterangan: null })).toThrow(
      'Kategori wajib diisi.',
    )
  })
})

describe('listAllCashExpenses', () => {
  it('returns every matching row, ignoring pagination', () => {
    const db = seedDb()
    for (let i = 0; i < 30; i++) {
      recordCashExpense(db, expenseInput({ tanggal: '2026-08-01' }))
    }

    expect(listAllCashExpenses(db, {})).toHaveLength(30)
  })

  it('applies the same from/to/q filters as listCashExpenses', () => {
    const db = seedDb()
    recordCashExpense(db, expenseInput({ tanggal: '2026-07-31', kategori: 'DPAM' }))
    recordCashExpense(db, expenseInput({ tanggal: '2026-08-01', kategori: 'BENSIN' }))

    const result = listAllCashExpenses(db, { from: '2026-08-01', q: 'bensin' })
    expect(result).toHaveLength(1)
    expect(result[0].kategori).toBe('BENSIN')
  })
})

describe('buildExpenseWorkbook', () => {
  it('writes a Pengeluaran sheet with money converted from cents to Rupiah', () => {
    const db = seedDb()
    recordCashExpense(db, expenseInput({ tanggal: '2026-08-01', kategori: 'DPAM', jumlah: 150000_00, keterangan: 'tagihan' }))

    const workbook = buildExpenseWorkbook(listAllCashExpenses(db, {}))

    expect(workbook.SheetNames).toEqual(['Pengeluaran'])
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Pengeluaran']) as Record<string, unknown>[]
    expect(rows).toEqual([
      { Tanggal: '2026-08-01', Kategori: 'DPAM', Jumlah: 150000, Keterangan: 'tagihan', 'Dicatat Oleh': 'Admin' },
    ])
  })
})

describe('deleteCashExpense', () => {
  it('deletes one expense and leaves the rest alone', () => {
    const db = seedDb()
    const kept = recordCashExpense(db, expenseInput({ tanggal: '2026-08-01' }))
    const dropped = recordCashExpense(db, expenseInput({ tanggal: '2026-08-02' }))

    deleteCashExpense(db, dropped.expenseId)

    expect(db.select().from(cashExpenses).all().map((e) => e.id)).toEqual([kept.expenseId])
  })

  it('rejects an unknown id', () => {
    const db = seedDb()
    expect(() => deleteCashExpense(db, 99)).toThrow('Pengeluaran tidak ditemukan.')
  })
})
