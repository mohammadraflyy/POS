import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { listUnits, createUnit, updateUnit, deactivateUnit } from './master-satuan'

const migrationsFolder = path.join(__dirname, '../../drizzle')

describe('createUnit', () => {
  it('throws when code is empty', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() => createUnit(db, { code: '  ', name: 'Pieces', symbol: 'pcs' })).toThrow('Kode satuan wajib diisi.')
  })

  it('throws when code already exists', () => {
    const db = createDb(':memory:', migrationsFolder)
    createUnit(db, { code: 'BOX', name: 'Box', symbol: 'box' })
    expect(() => createUnit(db, { code: 'box', name: 'Box lagi', symbol: 'box' })).toThrow('Kode satuan sudah ada.')
  })

  it('creates a unit and lists it', () => {
    const db = createDb(':memory:', migrationsFolder)
    createUnit(db, { code: 'DUS', name: 'Dus', symbol: 'dus' })
    const all = listUnits(db)
    expect(all.some((u) => u.code === 'DUS')).toBe(true)
  })
})

describe('updateUnit', () => {
  it('throws when the unit does not exist', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() => updateUnit(db, 999, { code: 'X', name: 'X', symbol: 'x', isActive: true })).toThrow('Satuan tidak ditemukan.')
  })
})

describe('deactivateUnit', () => {
  it('sets isActive to false', () => {
    const db = createDb(':memory:', migrationsFolder)
    createUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    const created = listUnits(db).find((u) => u.code === 'RTG')!
    deactivateUnit(db, created.id)
    expect(listUnits(db).find((u) => u.id === created.id)?.isActive).toBe(false)
  })
})
