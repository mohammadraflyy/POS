import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, saleCostCorrections, saleItems, sales } from './db/schema'
import { assertAdmin, type AuthUser } from './auth'
import { toCents, toRupiah } from './money'
import type { CostCorrectionApply, CostCorrectionHistory, CostCorrectionPreview, CostCorrectionRequest } from '../shared/cost-correction'

type Db = BetterSQLite3Database<typeof schema>

function dateBound(value: string, end: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Tanggal koreksi tidak valid.')
  const date = new Date(`${value}T00:00:00`)
  const parts = value.split('-').map(Number)
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== parts[0] || date.getMonth() + 1 !== parts[1] || date.getDate() !== parts[2]) {
    throw new Error('Tanggal koreksi tidak valid.')
  }
  if (end) date.setHours(23, 59, 59, 999)
  return date
}

function prepare(db: Db, input: CostCorrectionRequest) {
  if (!Number.isSafeInteger(input.saleItemId) || input.saleItemId < 1) throw new Error('Item transaksi tidak valid.')
  if (input.scope !== 'item' && input.scope !== 'period') throw new Error('Cakupan koreksi tidak valid.')
  const cost = toCents(input.hargaPokok)
  if (typeof input.hargaPokok !== 'number' || !Number.isFinite(input.hargaPokok) || input.hargaPokok < 0 || !Number.isSafeInteger(cost)) {
    throw new Error('HPP harus berupa angka nol atau lebih.')
  }
  const source = db.select().from(saleItems).where(eq(saleItems.id, input.saleItemId)).get()
  if (!source) throw new Error('Item transaksi tidak ditemukan. Muat ulang Rekap.')
  const product = db.select().from(products).where(eq(products.id, source.productId)).get()!
  const sourceSale = db.select().from(sales).where(eq(sales.id, source.saleId)).get()!
  if (sourceSale.status !== 'selesai') throw new Error('Transaksi yang dibatalkan tidak bisa dikoreksi.')

  let candidates = [source]
  if (input.scope === 'period') {
    const from = dateBound(input.from, false)
    const to = dateBound(input.to, true)
    if (from > to) throw new Error('Tanggal awal harus sebelum atau sama dengan tanggal akhir.')
    candidates = db.select({ item: saleItems }).from(saleItems).innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(eq(saleItems.productId, source.productId), eq(sales.status, 'selesai'), gte(sales.createdAt, from), lte(sales.createdAt, to)))
      .orderBy(asc(saleItems.id)).all().map((row) => row.item)
      // A unit's conversion may have changed: only correct matching historical units.
      .filter((item) => item.productUnitId === source.productUnitId && item.satuan === source.satuan && item.konversi === source.konversi)
  }
  const targets = candidates.filter((item) => item.hargaPokok !== cost)
  if (targets.length === 0) throw new Error('Tidak ada HPP yang perlu diubah untuk cakupan ini.')
  if (targets.length > 500) throw new Error('Maksimal 500 baris per koreksi. Persempit rentang tanggal.')
  if (targets.some((item) => !Number.isFinite(item.qty * cost) || item.qty * cost > Number.MAX_SAFE_INTEGER)) {
    throw new Error('Nilai modal terlalu besar.')
  }

  const saleIds = [...new Set(targets.map((item) => item.saleId))]
  const saleRows = db.select().from(sales).where(inArray(sales.id, saleIds)).orderBy(asc(sales.id)).all()
  const allItems = db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds)).orderBy(asc(saleItems.saleId), asc(saleItems.id)).all()
  const netByItem = new Map<number, number>()
  for (const sale of saleRows) {
    const items = allItems.filter((item) => item.saleId === sale.id)
    let remainingDiscount = sale.diskon
    let remainingSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
    for (const item of items) {
      const discount = remainingSubtotal > 0 ? Math.round(remainingDiscount * item.subtotal / remainingSubtotal) : 0
      remainingDiscount -= discount
      remainingSubtotal -= item.subtotal
      netByItem.set(item.id, item.subtotal - discount)
    }
  }
  // Reject stale previews, including price/discount edits and new matching transactions.
  const token = createHash('sha256').update(JSON.stringify({ input, targets, saleRows, allItems })).digest('hex')
  const rows = targets.map((item) => {
    const omzet = netByItem.get(item.id)!
    return {
      saleItemId: item.id, saleId: item.saleId,
      tanggal: saleRows.find((sale) => sale.id === item.saleId)!.createdAt.toISOString(),
      qty: item.qty, hargaPokokLama: toRupiah(item.hargaPokok), omzet: toRupiah(omzet),
      labaLama: toRupiah(omzet - item.qty * item.hargaPokok), labaBaru: toRupiah(omzet - item.qty * cost),
    }
  })
  const preview: CostCorrectionPreview = {
    token, namaItem: product.namaItem, satuan: source.satuan ?? 'Satuan transaksi', hargaPokok: toRupiah(cost), rows,
    labaLama: rows.reduce((sum, row) => sum + row.labaLama, 0), labaBaru: rows.reduce((sum, row) => sum + row.labaBaru, 0),
  }
  return { preview, targets, cost }
}

export function previewCostCorrection(db: Db, user: AuthUser | null, input: CostCorrectionRequest): CostCorrectionPreview {
  assertAdmin(user)
  return prepare(db, input).preview
}

export function applyCostCorrection(db: Db, user: AuthUser | null, input: CostCorrectionApply): { count: number } {
  const admin = assertAdmin(user)
  if (typeof input.alasan !== 'string' || !input.alasan.trim() || input.alasan.trim().length > 1000) {
    throw new Error('Alasan koreksi wajib diisi, maksimal 1.000 karakter.')
  }
  const { token, alasan, ...request } = input
  return db.transaction((tx) => {
    const { preview, targets, cost } = prepare(tx, request)
    if (typeof token !== 'string' || token !== preview.token) throw new Error('Data sudah berubah. Tampilkan pratinjau lagi sebelum menyimpan.')
    const now = new Date()
    const batchId = randomUUID()
    for (const item of targets) {
      tx.insert(saleCostCorrections).values({
        batchId, saleId: item.saleId, saleItemId: item.id, productId: item.productId,
        namaItem: preview.namaItem, satuan: preview.satuan, qty: item.qty,
        hargaPokokLama: item.hargaPokok, hargaPokokBaru: cost,
        userId: admin.id, adminName: admin.name, alasan: alasan.trim(), createdAt: now,
      }).run()
      tx.update(saleItems).set({ hargaPokok: cost, updatedAt: now }).where(eq(saleItems.id, item.id)).run()
    }
    return { count: targets.length }
  })
}

export function listCostCorrections(db: Db, user: AuthUser | null): CostCorrectionHistory[] {
  assertAdmin(user)
  return db.select().from(saleCostCorrections).orderBy(desc(saleCostCorrections.id)).limit(200).all().map((row) => ({
    id: row.id, batchId: row.batchId, saleId: row.saleId, namaItem: row.namaItem, satuan: row.satuan, qty: row.qty,
    hargaPokokLama: toRupiah(row.hargaPokokLama), hargaPokokBaru: toRupiah(row.hargaPokokBaru),
    alasan: row.alasan, adminName: row.adminName, createdAt: row.createdAt.toISOString(),
  }))
}
