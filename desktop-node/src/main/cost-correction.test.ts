import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { products, productUnits, saleItems, sales } from './db/schema'
import { applyCostCorrection, listCostCorrections, previewCostCorrection } from './cost-correction'
import { getRekap } from './rekap'
import { updateSale } from './kasir'
import type { AuthUser } from './auth'
import type { CostCorrectionRequest } from '../shared/cost-correction'

const admin: AuthUser = { id: 1, username: 'admin', name: 'Pemilik', role: 'admin' }
const cashier: AuthUser = { ...admin, role: 'kasir' }
const now = new Date(2026, 8, 10, 10)
const range = { from: '2026-09-01', to: '2026-09-30' }
const request: CostCorrectionRequest = { saleItemId: 1, scope: 'item', ...range, hargaPokok: 9000 }
let db: ReturnType<typeof createDb>

function seedSale(id: number, input: { date?: Date; status?: 'selesai' | 'dibatalkan'; unit?: number; conversion?: number; label?: string; cost?: number; method?: 'tunai' | 'bon' } = {}) {
  db.insert(sales).values({ id, userId: 1, metodePembayaran: input.method ?? 'tunai', status: input.status ?? 'selesai', total: 11000_00, dibayar: input.method === 'bon' ? 0 : 11000_00, createdAt: input.date ?? now, updatedAt: now }).run()
  db.insert(saleItems).values({ id, saleId: id, productId: 1, productUnitId: input.unit ?? 1, qty: 1, konversi: input.conversion ?? 1, satuan: input.label ?? 'KALENG', hargaJual: 11000_00, hargaPokok: input.cost ?? 12000_00, subtotal: 11000_00, createdAt: now, updatedAt: now }).run()
}

beforeEach(() => {
  db = createDb(':memory:', path.resolve(__dirname, '../../drizzle'))
  db.$client.exec(`
    INSERT INTO users (id,username,password_hash,name,role,created_at,updated_at) VALUES (1,'admin','hash','Pemilik','admin',1,1);
    INSERT INTO units (id,code,name,symbol,created_at,updated_at) VALUES (1,'KALENG','Kaleng','klg',1,1),(2,'DUS','Dus','dus',1,1);
    INSERT INTO products (id,kode_item,nama_item,harga_pokok,harga_jual,stok,created_at,updated_at) VALUES (1,'SUSU','Susu',900000,1200000,100,1,1);
    INSERT INTO product_units (id,product_id,unit_id,jumlah_kemasan,conversion_factor,harga_jual,harga_pokok,is_base_unit,created_at,updated_at)
    VALUES (1,1,1,1,1,1200000,900000,1,1,1),(2,1,2,12,12,13000000,10800000,0,1,1);
  `)
  seedSale(1)
})

afterEach(() => db.$client.close())

describe('historical HPP corrections', () => {
  it('previews and corrects a loss with an audit trail, leaving money and stock untouched', () => {
    const saleBefore = db.select().from(sales).all()
    const productBefore = db.select().from(products).all()
    const unitsBefore = db.select().from(productUnits).all()
    const preview = previewCostCorrection(db, admin, request)
    expect(preview.labaLama).toBe(-1000)
    expect(preview.labaBaru).toBe(2000)
    expect(db.select().from(saleItems).get()!.hargaPokok).toBe(12000_00)
    expect(applyCostCorrection(db, admin, { ...request, token: preview.token, alasan: 'Salah input faktur' })).toEqual({ count: 1 })
    expect(getRekap(db, range).summary.labaKotor).toBe(2000_00)
    expect(getRekap(db, range).penjelasanLaba.barisRugi).toEqual([])
    expect(db.select().from(sales).all()).toEqual(saleBefore)
    expect(db.select().from(products).all()).toEqual(productBefore)
    expect(db.select().from(productUnits).all()).toEqual(unitsBefore)
    expect(listCostCorrections(db, admin)).toEqual([expect.objectContaining({ saleId: 1, hargaPokokLama: 12000, hargaPokokBaru: 9000, adminName: 'Pemilik', alasan: 'Salah input faktur' })])
  })

  it('allocates item and bill discounts consistently with Rekap, including fractional qty', () => {
    db.update(saleItems).set({ qty: 1.5, diskon: 1000_00, subtotal: 15500_00 }).where(eq(saleItems.id, 1)).run()
    db.insert(saleItems).values({ id: 2, saleId: 1, productId: 1, productUnitId: 1, qty: 1, konversi: 1, satuan: 'KALENG', hargaJual: 11000_00, hargaPokok: 9000_00, subtotal: 11000_00, createdAt: now, updatedAt: now }).run()
    db.update(sales).set({ diskon: 1000_01, total: 25500_00 - 1, dibayar: 25500_00 - 1 }).where(eq(sales.id, 1)).run()
    const preview = previewCostCorrection(db, admin, request)
    const before = getRekap(db, range).summary.labaKotor
    applyCostCorrection(db, admin, { ...request, token: preview.token, alasan: 'HPP faktur' })
    const after = getRekap(db, range).summary.labaKotor
    expect(after - before).toBeCloseTo((preview.labaBaru - preview.labaLama) * 100, 5)
    expect(preview.rows[0].omzet).toBe(14915.09)
  })

  it('limits a period correction to the same product, historical unit, conversion and completed dates', () => {
    seedSale(2)
    seedSale(3, { unit: 2, conversion: 12, label: 'DUS' })
    seedSale(4, { conversion: 2 })
    seedSale(5, { date: new Date(2026, 7, 31, 23, 59) })
    seedSale(6, { status: 'dibatalkan' })
    seedSale(7, { label: 'PCS' })
    seedSale(8, { method: 'bon' })
    const input = { ...request, scope: 'period' as const }
    const preview = previewCostCorrection(db, admin, input)
    expect(preview.rows.map((row) => row.saleId)).toEqual([1, 2, 8])
    expect(applyCostCorrection(db, admin, { ...input, token: preview.token, alasan: 'Salah HPP batch supplier' }).count).toBe(3)
    expect(new Set(listCostCorrections(db, admin).map((row) => row.batchId)).size).toBe(1)
    expect(db.select().from(saleItems).where(eq(saleItems.id, 3)).get()!.hargaPokok).toBe(12000_00)
  })

  it('rejects a stale preview when a sibling line discount changes', () => {
    const preview = previewCostCorrection(db, admin, request)
    db.update(sales).set({ diskon: 1000_00, total: 10000_00 }).where(eq(sales.id, 1)).run()
    expect(() => applyCostCorrection(db, admin, { ...request, token: preview.token, alasan: 'Koreksi' })).toThrow('Data sudah berubah')
    expect(listCostCorrections(db, admin)).toEqual([])
    expect(db.select().from(saleItems).get()!.hargaPokok).toBe(12000_00)
  })

  it('rejects newly matching transactions after a period preview', () => {
    const input = { ...request, scope: 'period' as const }
    const preview = previewCostCorrection(db, admin, input)
    seedSale(2)
    expect(() => applyCostCorrection(db, admin, { ...input, token: preview.token, alasan: 'Koreksi' })).toThrow('Data sudah berubah')
    expect(listCostCorrections(db, admin)).toEqual([])
  })

  it('requires an admin for preview, apply, and audit history', () => {
    for (const user of [null, cashier]) {
      expect(() => previewCostCorrection(db, user, request)).toThrow()
      expect(() => applyCostCorrection(db, user, { ...request, token: '', alasan: 'Koreksi' })).toThrow()
      expect(() => listCostCorrections(db, user)).toThrow()
    }
  })

  it('requires a reason and rejects invalid values and calendar dates', () => {
    const preview = previewCostCorrection(db, admin, request)
    expect(() => applyCostCorrection(db, admin, { ...request, token: preview.token, alasan: '  ' })).toThrow('Alasan')
    for (const hargaPokok of [-1, NaN, Infinity, Number.MAX_VALUE]) {
      expect(() => previewCostCorrection(db, admin, { ...request, hargaPokok })).toThrow('HPP')
    }
    expect(() => previewCostCorrection(db, admin, { ...request, scope: 'period', from: '2026-02-30' })).toThrow('Tanggal')
    expect(() => previewCostCorrection(db, admin, { ...request, scope: 'period', from: '2026-10-01' })).toThrow('Tanggal awal')
  })

  it('rejects cancelled sales, unchanged costs and duplicate apply', () => {
    seedSale(2, { status: 'dibatalkan' })
    expect(() => previewCostCorrection(db, admin, { ...request, saleItemId: 2 })).toThrow('dibatalkan')
    expect(() => previewCostCorrection(db, admin, { ...request, hargaPokok: 12000 })).toThrow('Tidak ada HPP')
    const input = { ...request, token: previewCostCorrection(db, admin, request).token, alasan: 'Koreksi' }
    applyCostCorrection(db, admin, input)
    expect(() => applyCostCorrection(db, admin, input)).toThrow()
    expect(listCostCorrections(db, admin)).toHaveLength(1)
  })

  it('keeps genuine losses after a correction', () => {
    const input = { ...request, hargaPokok: 11500 }
    const preview = previewCostCorrection(db, admin, input)
    expect(preview.labaBaru).toBe(-500)
    applyCostCorrection(db, admin, { ...input, token: preview.token, alasan: 'Modal sebenarnya masih di atas harga jual' })
    expect(getRekap(db, range).summary.labaKotor).toBe(-500_00)
  })

  it('marks a historical price warning as resolved only when that unit currently meets the target', () => {
    const historical = getRekap(db, range).penjelasanLaba
    expect(historical.saran.find((row) => row.kode === 'harga_di_bawah_modal')!.status).toBe('diperbaiki')
    expect(historical.barisRugi[0].hargaPokok).toBe(12000_00)
    db.update(productUnits).set({ hargaJual: 9500_00 }).where(eq(productUnits.id, 1)).run()
    expect(getRekap(db, range).penjelasanLaba.saran.find((row) => row.kode === 'harga_di_bawah_modal')!.status).toBe('aktif')
    db.update(saleItems).set({ productUnitId: 2, satuan: 'DUS' }).where(eq(saleItems.id, 1)).run()
    db.update(productUnits).set({ hargaJual: 100000_00 }).where(eq(productUnits.id, 2)).run()
    db.update(productUnits).set({ hargaJual: 12000_00 }).where(eq(productUnits.id, 1)).run()
    expect(getRekap(db, range).penjelasanLaba.saran.find((row) => row.kode === 'harga_di_bawah_modal')!.status).toBe('aktif')
  })

  it('preserves the corrected cost and audit when a sale is subsequently edited or deleted', () => {
    const preview = previewCostCorrection(db, admin, request)
    applyCostCorrection(db, admin, { ...request, token: preview.token, alasan: 'Faktur diverifikasi' })
    updateSale(db, 1, { userId: 1, metodePembayaran: 'tunai', namaPelanggan: null, dibayar: 24000_00, tanggal: '2026-09-10T10:00', keterangan: '', items: [{ productId: 1, productUnitId: 1, qty: 2 }] })
    expect(db.select().from(saleItems).get()!.hargaPokok).toBe(9000_00)
    expect(listCostCorrections(db, admin)).toHaveLength(1)
    db.delete(sales).where(eq(sales.id, 1)).run()
    expect(listCostCorrections(db, admin)).toHaveLength(1)
  })

  it('rolls back both cost updates and audit rows if part of a batch fails', () => {
    seedSale(2)
    const input = { ...request, scope: 'period' as const }
    const preview = previewCostCorrection(db, admin, input)
    db.$client.exec("CREATE TRIGGER fail_second_audit BEFORE INSERT ON sale_cost_corrections WHEN NEW.sale_item_id = 2 BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    expect(() => applyCostCorrection(db, admin, { ...input, token: preview.token, alasan: 'Koreksi batch' })).toThrow('test failure')
    expect(listCostCorrections(db, admin)).toEqual([])
    expect(db.select().from(saleItems).all().map((row) => row.hargaPokok)).toEqual([12000_00, 12000_00])
  })
})
