import { and, desc, eq, gt, gte, lte, ne, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import XLSX from 'xlsx'
import * as schema from './db/schema'
import { bonPayments, categories, customers, products, productUnits, purchases, saleItems, sales, storeSettings, suppliers, units } from './db/schema'
import { METODE_NON_TUNAI, type MetodePembayaran } from './kasir'

/** the local calendar day, in the `YYYY-MM-DD` shape the report ranges are given in */
function tanggalLokal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export interface RekapSummary {
  omzetTunai: number
  /** qris + transfer: real takings, but not cash in the drawer */
  omzetNonTunai: number
  piutangBeredar: number
  jumlahTransaksi: number
  labaKotor: number
}

export interface LabaPerKategoriRow {
  categoryName: string
  omzet: number
  laba: number
}

export interface LabaPerHariRow {
  tanggal: string
  omzet: number
  laba: number
}

export interface LabaPerSatuanRow {
  satuan: string
  qtyTerjual: number
  omzet: number
  laba: number
  /** laba as a percentage of omzet, 0 when nothing was sold in this unit */
  marginPersen: number
}

export interface ProdukTerlarisRow {
  namaItem: string
  qtyTerjual: number
  totalPenjualan: number
}

export interface PembelianPerSupplierRow {
  supplierName: string
  totalPembelian: number
}

export interface PiutangPerPelangganRow {
  customerId: number | null
  namaPelanggan: string
  telepon: string | null
  totalPiutang: number
  /** how many of this customer's bon are still unpaid, not their whole bon history */
  jumlahBon: number
}

export interface StockValueRow {
  namaItem: string
  kodeItem: string
  satuan: string
  stok: number
  hargaPokok: number
  nilai: number
}

export interface StockValueSummary {
  totalNilai: number
  produk: StockValueRow[]
}

export interface SalesHistoryRow {
  id: number
  createdAt: string
  namaPelanggan: string | null
  metodePembayaran: MetodePembayaran
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}

/** one sold line that lost money, with every number the arithmetic needs shown separately */
export interface BarisRugiRow {
  saleItemId: number
  productUnitId: number | null
  productId: number
  saleId: number
  tanggal: string
  namaItem: string
  satuan: string
  qty: number
  /** price of one of the unit sold, before any discount */
  hargaJual: number
  /** cost of one of the same unit */
  hargaPokok: number
  /** the line's own discount plus its share of the bill-wide one */
  diskon: number
  omzet: number
  modal: number
  laba: number
}

/**
 * Why the margin came out the way it did, in the shape the Rekap page explains it:
 * `penjualanKotor - diskon = omzet`, then `omzet - modal = labaKotor`.
 */
/**
 * One piece of advice, derived from this period's own numbers. The wording lives in the
 * renderer - main deals in sen, and a sentence built here would have to format money twice.
 */
export interface SaranLaba {
  status: 'aktif' | 'riwayat' | 'diperbaiki'
  kode: 'harga_di_bawah_modal' | 'diskon_memakan_margin' | 'satuan_margin_tipis' | 'katalog_di_bawah_margin'
  /** how many rows, satuan, or catalog entries this is about */
  jumlah: number
  /** the money involved, in sen; 0 where the advice is not about an amount */
  nilai: number
  /** the percentage involved; 0 where the advice is not about a rate */
  persen: number
  /** a few names to make the advice concrete */
  contoh: string[]
  produk: { productId: number; namaItem: string; satuan: string }[]
  saleIds: number[]
}

export interface PenjelasanLaba {
  /** what the goods were priced at before any discount */
  penjualanKotor: number
  diskonItem: number
  diskonNota: number
  omzet: number
  /** harga pokok of everything sold */
  modal: number
  labaKotor: number
  jumlahBarisRugi: number
  /** what the loss-making lines cost in total - the rest of the sales carried it */
  totalRugi: number
  /** the worst offenders, worst first, capped so the page stays readable */
  barisRugi: BarisRugiRow[]
  /** what to do about it, worst cause first; empty when nothing sold at a loss */
  saran: SaranLaba[]
}

/** a discount that leaves less than this share of the margin standing is worth flagging */
const AMBANG_SISA_MARGIN = 0.5

/** a satuan selling thinner than this is worth pointing at by name */
const AMBANG_MARGIN_SATUAN = 5

/**
 * Turns the period's own figures into advice. Every entry has to be earned by the numbers -
 * generic "sell for more" wording would be noise on a report the owner reads every day.
 */
function unikProduk(rows: SaranLaba['produk']): SaranLaba['produk'] {
  return [...new Map(rows.map((row) => [`${row.productId}:${row.satuan}`, {
    productId: row.productId, namaItem: row.namaItem, satuan: row.satuan,
  }])).values()]
}

function susunSaran(
  db: BetterSQLite3Database<typeof schema>,
  input: {
    penjualanKotor: number
    modal: number
    labaKotor: number
    totalDiskon: number
    barisRugi: BarisRugiRow[]
    labaPerSatuan: LabaPerSatuanRow[]
    barisTerjual: SaranLaba['produk']
    saleIdsDiskon: number[]
  },
): SaranLaba[] {
  const saran: SaranLaba[] = []
  const marginMinimal = db.select().from(storeSettings).get()?.marginMinimalPersen ?? 10
  const currentUnits = db.select().from(productUnits).all()

  // Priced under cost: no discount involved, the master price itself is wrong. This is the one
  // cause the owner can fix outright, so it leads.
  const rugiKarenaHarga = input.barisRugi.filter((row) => row.hargaJual < row.hargaPokok)

  if (rugiKarenaHarga.length > 0) {
    const namaUnik = [...new Set(rugiKarenaHarga.map((row) => `${row.namaItem} (${row.satuan})`))]

    saran.push({
      kode: 'harga_di_bawah_modal',
      status: rugiKarenaHarga.every((row) => {
        // A deleted unit must not be mistaken for the product's base unit.
        const unit = currentUnits.find((unit) => unit.id === row.productUnitId)
        return unit && unit.hargaJual > 0 && unit.hargaPokok > 0 && unit.hargaJual * (100 - marginMinimal) >= unit.hargaPokok * 100
      }) ? 'diperbaiki' : 'aktif',
      jumlah: namaUnik.length,
      nilai: rugiKarenaHarga.reduce((sum, row) => sum + row.laba, 0),
      persen: 0,
      contoh: namaUnik.slice(0, 3),
      produk: unikProduk(rugiKarenaHarga),
      saleIds: [...new Set(rugiKarenaHarga.map((row) => row.saleId))],
    })
  }

  // The discount ate most of what the goods would otherwise have earned
  const labaSebelumDiskon = input.penjualanKotor - input.modal

  if (input.totalDiskon > 0 && labaSebelumDiskon > 0 && input.labaKotor < labaSebelumDiskon * AMBANG_SISA_MARGIN) {
    saran.push({
      kode: 'diskon_memakan_margin',
      status: 'riwayat',
      jumlah: 0,
      nilai: input.totalDiskon,
      // the rate the goods can actually carry - a discount above this sells at a loss
      persen: (labaSebelumDiskon / input.penjualanKotor) * 100,
      contoh: [],
      produk: [],
      saleIds: input.saleIdsDiskon,
    })
  }

  // The thinnest satuan sold, usually a grosir packaging whose real cost was never recorded
  const satuanTertipis = [...input.labaPerSatuan].filter((row) => row.omzet > 0).sort((a, b) => a.marginPersen - b.marginPersen)[0]

  if (satuanTertipis && satuanTertipis.marginPersen < AMBANG_MARGIN_SATUAN) {
    saran.push({
      kode: 'satuan_margin_tipis',
      status: 'riwayat',
      jumlah: satuanTertipis.qtyTerjual,
      nilai: satuanTertipis.laba,
      persen: satuanTertipis.marginPersen,
      contoh: [satuanTertipis.satuan],
      produk: unikProduk(input.barisTerjual.filter((row) => row.satuan === satuanTertipis.satuan)),
      saleIds: [],
    })
  }

  // What is still mispriced in the catalog, sold this period or not: margin = (jual - pokok) / jual,
  // so "below m percent" is `jual * (100 - m) < pokok * 100` with no division to round away
  const diBawahMargin =
    db
      .select({ productId: products.id, namaItem: products.namaItem, satuan: units.code })
      .from(productUnits)
      .innerJoin(products, eq(productUnits.productId, products.id))
      .innerJoin(units, eq(productUnits.unitId, units.id))
      .where(
        sql`${productUnits.hargaJual} > 0 and ${productUnits.hargaPokok} > 0 and ${productUnits.hargaJual} * ${100 - marginMinimal} < ${productUnits.hargaPokok} * 100`,
      )
      .all()

  if (diBawahMargin.length > 0) {
    saran.push({
      kode: 'katalog_di_bawah_margin',
      status: 'aktif',
      jumlah: diBawahMargin.length,
      nilai: 0,
      persen: marginMinimal,
      contoh: [],
      produk: unikProduk(diBawahMargin),
      saleIds: [],
    })
  }

  return saran
}

export interface RekapResult {
  summary: RekapSummary
  penjelasanLaba: PenjelasanLaba
  labaPerKategori: LabaPerKategoriRow[]
  labaPerHari: LabaPerHariRow[]
  labaPerSatuan: LabaPerSatuanRow[]
  produkTerlaris: ProdukTerlarisRow[]
  pembelianPerSupplier: PembelianPerSupplierRow[]
  piutangPerPelanggan: PiutangPerPelangganRow[]
  stockValue: StockValueSummary
  salesHistory: SalesHistoryRow[]
}

/**
 * Every sale whose money could land inside the range, and the day it landed.
 *
 * The report is on a cash basis: a sale counts as income on the day the shop was actually
 * paid, not on the day the goods walked out. Cash, QRIS and transfer settle at the till, so
 * for them the two days are the same. A bon counts for nothing at all until it is paid off,
 * and then it counts on the day of the payment that cleared it - which is why an old bon
 * settled today lands in today's rekap and never retroactively in last month's.
 *
 * A bon marked paid without any recorded `bon_payments` row (an admin correcting money that
 * was taken but never entered) has no payment date to use, so it falls back to its own.
 *
 * The query pulls every bon rather than only those created in range, because the payment
 * that recognises a bon can arrive any length of time after the sale. Bons are a small
 * slice of the table, and only their recognised subset survives the filter below.
 */
function pengakuanPenjualan(
  db: BetterSQLite3Database<typeof schema>,
  rangeStart: Date,
  rangeEnd: Date,
): Map<number, { tanggal: string; metodePembayaran: MetodePembayaran; total: number; diskon: number }> {
  const saleRows = db
    .select({
      id: sales.id,
      metodePembayaran: sales.metodePembayaran,
      total: sales.total,
      diskon: sales.diskon,
      dibayar: sales.dibayar,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .where(
      and(
        eq(sales.status, 'selesai'),
        or(
          eq(sales.metodePembayaran, 'bon'),
          and(ne(sales.metodePembayaran, 'bon'), gte(sales.createdAt, rangeStart), lte(sales.createdAt, rangeEnd)),
        ),
      ),
    )
    .all()

  const pelunasanRows = db
    .select({ saleId: bonPayments.saleId, tanggal: sql<string>`max(${bonPayments.tanggal})` })
    .from(bonPayments)
    .groupBy(bonPayments.saleId)
    .all()
  const pelunasanBySaleId = new Map(pelunasanRows.map((row) => [row.saleId, row.tanggal]))

  const from = tanggalLokal(rangeStart)
  const to = tanggalLokal(rangeEnd)
  const diakui = new Map<
    number,
    { tanggal: string; metodePembayaran: MetodePembayaran; total: number; diskon: number }
  >()

  for (const sale of saleRows) {
    let tanggal = tanggalLokal(sale.createdAt)

    if (sale.metodePembayaran === 'bon') {
      if (sale.dibayar < sale.total) {
        continue
      }

      tanggal = pelunasanBySaleId.get(sale.id) ?? tanggal
    }

    if (tanggal < from || tanggal > to) {
      continue
    }

    diakui.set(sale.id, {
      tanggal,
      metodePembayaran: sale.metodePembayaran,
      total: sale.total,
      diskon: sale.diskon,
    })
  }

  return diakui
}

export function getRekap(db: BetterSQLite3Database<typeof schema>, input: { from: string; to: string }): RekapResult {
  const rangeStart = new Date(`${input.from}T00:00:00`)
  const rangeEnd = new Date(`${input.to}T23:59:59`)

  const diakui = pengakuanPenjualan(db, rangeStart, rangeEnd)

  let omzetTunai = 0
  let omzetNonTunai = 0

  for (const sale of diakui.values()) {
    // a settled bon is cash in the drawer on the day it was settled, so it lands here
    if ((METODE_NON_TUNAI as readonly string[]).includes(sale.metodePembayaran)) {
      // qris and transfer are takings the till never sees; the cash book needs them apart
      omzetNonTunai += sale.total
    } else {
      omzetTunai += sale.total
    }
  }

  // max(...,0) per row guards against an overpaid bon (dibayar > total) turning into a
  // negative contribution that would understate everyone else's outstanding balance
  const piutangRow = db
    .select({ piutang: sql<number>`coalesce(sum(max(${sales.total} - ${sales.dibayar}, 0)), 0)` })
    .from(sales)
    .where(and(eq(sales.status, 'selesai'), eq(sales.metodePembayaran, 'bon')))
    .get()

  // Who owes what, all-time - grouped by customerId (stable identity: `findOrCreateCustomerByName`
  // reuses the same row for the same name, and a bon always has one because it's required at
  // checkout) so a renamed customer's older bon still lands on the same line, not a second one.
  // `customers.nama` is preferred over the sale's own snapshot so a rename is reflected here -
  // this list is for collecting a debt today, not for reproducing a past receipt.
  const piutangPerPelanggan: PiutangPerPelangganRow[] = db
    .select({
      customerId: sales.customerId,
      namaPelanggan: sql<string>`coalesce(${customers.nama}, ${sales.namaPelanggan}, 'Tanpa Nama')`,
      telepon: customers.telepon,
      totalPiutang: sql<number>`coalesce(sum(max(${sales.total} - ${sales.dibayar}, 0)), 0)`,
      jumlahBon: sql<number>`count(case when ${sales.total} > ${sales.dibayar} then 1 end)`,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(and(eq(sales.status, 'selesai'), eq(sales.metodePembayaran, 'bon')))
    .groupBy(sales.customerId)
    .having(sql`sum(max(${sales.total} - ${sales.dibayar}, 0)) > 0`)
    .all()
    .sort((a, b) => b.totalPiutang - a.totalPiutang)

  // Same net as pengakuanPenjualan casts, then narrowed to the sales it recognised - the
  // margin has to be counted on exactly the sales the omzet was counted on.
  const saleItemRows = db
    .select({
      saleItemId: saleItems.id,
      productUnitId: saleItems.productUnitId,
      saleId: saleItems.saleId,
      categoryName: categories.nama,
      productId: products.id,
      namaItem: products.namaItem,
      subtotal: saleItems.subtotal,
      qty: saleItems.qty,
      hargaJual: saleItems.hargaJual,
      diskonBaris: saleItems.diskon,
      hargaPokok: saleItems.hargaPokok,
      // the live unit label, falling back to the snapshot for lines whose unit row was deleted
      unitCode: units.code,
      satuanSnapshot: saleItems.satuan,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(productUnits, eq(saleItems.productUnitId, productUnits.id))
    .leftJoin(units, eq(productUnits.unitId, units.id))
    .where(
      and(
        eq(sales.status, 'selesai'),
        or(
          eq(sales.metodePembayaran, 'bon'),
          and(ne(sales.metodePembayaran, 'bon'), gte(sales.createdAt, rangeStart), lte(sales.createdAt, rangeEnd)),
        ),
      ),
    )
    // deterministic order so the discount-rounding remainder always lands on the same
    // line of a sale (the last one inserted), not on whichever row SQLite's query plan
    // happens to return last
    .orderBy(saleItems.saleId, saleItems.id)
    .all()
    .filter((row) => diakui.has(row.saleId))

  let labaKotor = 0
  let totalModal = 0
  let totalDiskonItem = 0
  let totalDiskonNota = 0
  const semuaBarisRugi: BarisRugiRow[] = []
  const labaPerKategoriMap = new Map<string, { omzet: number; laba: number }>()
  const labaPerHariMap = new Map<string, { omzet: number; laba: number }>()
  const labaPerSatuanMap = new Map<string, { qtyTerjual: number; omzet: number; laba: number }>()
  const produkTerlarisMap = new Map<number, { namaItem: string; qtyTerjual: number; totalPenjualan: number }>()

  /**
   * A bill-wide discount belongs to no single line, so it is spread across the sale's
   * lines in proportion to what each one contributed. Without this the shop would be
   * shown margin on money it never took, and omzet per kategori/hari/satuan would not
   * add up to omzetTunai + omzetNonTunai, which both read `sales.total`.
   *
   * Each line takes its share of what is *left*, so the rounding remainder lands on the
   * last line of the sale and the allocations sum to the discount exactly.
   */
  const sisaAlokasi = new Map<number, { diskon: number; subtotal: number }>()

  for (const row of saleItemRows) {
    const sisa = sisaAlokasi.get(row.saleId) ?? { diskon: diakui.get(row.saleId)!.diskon, subtotal: 0 }
    sisa.subtotal += row.subtotal
    sisaAlokasi.set(row.saleId, sisa)
  }

  for (const row of saleItemRows) {
    const sisa = sisaAlokasi.get(row.saleId)!
    const alokasiDiskon = sisa.subtotal > 0 ? Math.round((sisa.diskon * row.subtotal) / sisa.subtotal) : 0
    sisa.diskon -= alokasiDiskon
    sisa.subtotal -= row.subtotal

    // what this line really brought in: its own subtotal less its share of the bill discount
    const omzet = row.subtotal - alokasiDiskon
    // hargaPokok is the cost of one of the unit that was sold, so qty alone scales it
    const modal = row.qty * row.hargaPokok
    const laba = omzet - modal
    labaKotor += laba
    totalModal += modal
    totalDiskonItem += row.diskonBaris
    totalDiskonNota += alokasiDiskon

    if (laba < 0) {
      semuaBarisRugi.push({
        saleItemId: row.saleItemId,
        productUnitId: row.productUnitId,
        productId: row.productId,
        saleId: row.saleId,
        tanggal: diakui.get(row.saleId)!.tanggal,
        namaItem: row.namaItem,
        satuan: row.unitCode ?? row.satuanSnapshot ?? '-',
        qty: row.qty,
        hargaJual: row.hargaJual,
        hargaPokok: row.hargaPokok,
        diskon: row.diskonBaris + alokasiDiskon,
        omzet,
        modal,
        laba,
      })
    }

    const categoryName = row.categoryName ?? 'Tanpa Kategori'
    const kategoriEntry = labaPerKategoriMap.get(categoryName) ?? { omzet: 0, laba: 0 }
    kategoriEntry.omzet += omzet
    kategoriEntry.laba += laba
    labaPerKategoriMap.set(categoryName, kategoriEntry)

    // filed under the day the money arrived, not the day the goods left - a bon settled
    // today adds its margin to today, the same day its omzet lands on
    const tanggal = diakui.get(row.saleId)!.tanggal
    const hariEntry = labaPerHariMap.get(tanggal) ?? { omzet: 0, laba: 0 }
    hariEntry.omzet += omzet
    hariEntry.laba += laba
    labaPerHariMap.set(tanggal, hariEntry)

    const satuan = row.unitCode ?? row.satuanSnapshot ?? 'Tanpa Satuan'
    const satuanEntry = labaPerSatuanMap.get(satuan) ?? { qtyTerjual: 0, omzet: 0, laba: 0 }
    satuanEntry.qtyTerjual += row.qty
    satuanEntry.omzet += omzet
    satuanEntry.laba += laba
    labaPerSatuanMap.set(satuan, satuanEntry)

    const produkEntry = produkTerlarisMap.get(row.productId) ?? { namaItem: row.namaItem, qtyTerjual: 0, totalPenjualan: 0 }
    produkEntry.qtyTerjual += row.qty
    produkEntry.totalPenjualan += omzet
    produkTerlarisMap.set(row.productId, produkEntry)
  }

  const labaPerKategori: LabaPerKategoriRow[] = Array.from(labaPerKategoriMap.entries())
    .map(([categoryName, v]) => ({ categoryName, ...v }))
    .sort((a, b) => b.laba - a.laba)

  const labaPerHari: LabaPerHariRow[] = Array.from(labaPerHariMap.entries())
    .map(([tanggal, v]) => ({ tanggal, ...v }))
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0))

  const labaPerSatuan: LabaPerSatuanRow[] = Array.from(labaPerSatuanMap.entries())
    .map(([satuan, v]) => ({ satuan, ...v, marginPersen: v.omzet === 0 ? 0 : (v.laba / v.omzet) * 100 }))
    .sort((a, b) => b.laba - a.laba)

  const produkTerlaris: ProdukTerlarisRow[] = Array.from(produkTerlarisMap.values())
    .sort((a, b) => b.qtyTerjual - a.qtyTerjual)
    .slice(0, 5)

  const pembelianPerSupplier: PembelianPerSupplierRow[] = db
    .select({
      supplierName: suppliers.nama,
      totalPembelian: sql<number>`coalesce(sum(${purchases.total}), 0)`,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(and(gte(purchases.tanggal, input.from), lte(purchases.tanggal, input.to)))
    .groupBy(purchases.supplierId)
    .all()
    .map((row) => ({ supplierName: row.supplierName ?? 'Tanpa Supplier', totalPembelian: row.totalPembelian }))
    .sort((a, b) => b.totalPembelian - a.totalPembelian)

  const stockValue = getStockValue(db)
  const salesHistory = getSalesHistory(db, input)

  const omzet = omzetTunai + omzetNonTunai
  const penjualanKotor = omzet + totalDiskonItem + totalDiskonNota
  const saran = susunSaran(db, {
    penjualanKotor,
    modal: totalModal,
    labaKotor,
    totalDiskon: totalDiskonItem + totalDiskonNota,
    barisRugi: semuaBarisRugi,
    barisTerjual: saleItemRows.map((row) => ({ productId: row.productId, namaItem: row.namaItem, satuan: row.unitCode ?? row.satuanSnapshot ?? 'Tanpa Satuan' })),
    saleIdsDiskon: [...new Set(saleItemRows.filter((row) => row.diskonBaris > 0 || diakui.get(row.saleId)!.diskon > 0).map((row) => row.saleId))],
    labaPerSatuan,
  })

  return {
    summary: {
      omzetTunai,
      omzetNonTunai,
      piutangBeredar: piutangRow?.piutang ?? 0,
      jumlahTransaksi: diakui.size,
      labaKotor,
    },
    penjelasanLaba: {
      // omzet is already net of both discounts, so adding them back gives the list price
      penjualanKotor,
      diskonItem: totalDiskonItem,
      diskonNota: totalDiskonNota,
      omzet,
      modal: totalModal,
      labaKotor,
      jumlahBarisRugi: semuaBarisRugi.length,
      totalRugi: semuaBarisRugi.reduce((sum, row) => sum + row.laba, 0),
      barisRugi: [...semuaBarisRugi].sort((a, b) => a.laba - b.laba).slice(0, 10),
      saran,
    },
    labaPerKategori,
    labaPerHari,
    labaPerSatuan,
    produkTerlaris,
    pembelianPerSupplier,
    piutangPerPelanggan,
    stockValue,
    salesHistory,
  }
}

export function getStockValue(db: BetterSQLite3Database<typeof schema>): StockValueSummary {
  const rows = db
    .select({
      namaItem: products.namaItem,
      kodeItem: products.kodeItem,
      // the satuan label lives on the product's base product_units row now; left-joined so a
      // product with a broken unit chain still shows up in the report, just without a label
      satuan: units.code,
      stok: products.stok,
      hargaPokok: products.hargaPokok,
    })
    .from(products)
    .leftJoin(productUnits, and(eq(productUnits.productId, products.id), eq(productUnits.isBaseUnit, true)))
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .where(and(eq(products.isActive, true), gt(products.stok, 0)))
    .all()

  const produk: StockValueRow[] = rows
    .map((row) => ({ ...row, satuan: row.satuan ?? '', nilai: row.stok * row.hargaPokok }))
    .sort((a, b) => b.nilai - a.nilai)

  const totalNilai = produk.reduce((sum, row) => sum + row.nilai, 0)

  return { totalNilai, produk }
}

export function getSalesHistory(
  db: BetterSQLite3Database<typeof schema>,
  input: { from: string; to: string },
): SalesHistoryRow[] {
  const rangeStart = new Date(`${input.from}T00:00:00`)
  const rangeEnd = new Date(`${input.to}T23:59:59`)

  return db
    .select({
      id: sales.id,
      createdAt: sales.createdAt,
      namaPelanggan: sales.namaPelanggan,
      metodePembayaran: sales.metodePembayaran,
      status: sales.status,
      total: sales.total,
      dibayar: sales.dibayar,
    })
    .from(sales)
    .where(and(gte(sales.createdAt, rangeStart), lte(sales.createdAt, rangeEnd)))
    .orderBy(desc(sales.createdAt))
    .all()
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

function toRupiahExport(cents: number): number {
  return cents / 100
}

function computeColWidths(headers: string[], rows: Record<string, unknown>[]): { wch: number }[] {
  return headers.map((header) => {
    const maxRowLen = rows.reduce((max, row) => Math.max(max, String(row[header] ?? '').length), 0)
    return { wch: Math.min(Math.max(header.length, maxRowLen) + 2, 40) }
  })
}

export function buildRekapWorkbook(rekap: RekapResult): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()

  const sheets: { name: string; headers: string[]; rows: Record<string, unknown>[] }[] = [
    {
      name: 'Riwayat Transaksi',
      headers: ['Tanggal', 'Pelanggan', 'Metode', 'Status', 'Total', 'Dibayar'],
      rows: rekap.salesHistory.map((row) => ({
        Tanggal: new Date(row.createdAt).toLocaleString('id-ID'),
        Pelanggan: row.namaPelanggan ?? '-',
        Metode: row.metodePembayaran,
        Status: row.status,
        Total: toRupiahExport(row.total),
        Dibayar: toRupiahExport(row.dibayar),
      })),
    },
    {
      name: 'Laba per Kategori',
      headers: ['Kategori', 'Omzet', 'Laba'],
      rows: rekap.labaPerKategori.map((row) => ({
        Kategori: row.categoryName,
        Omzet: toRupiahExport(row.omzet),
        Laba: toRupiahExport(row.laba),
      })),
    },
    {
      name: 'Laba per Hari',
      headers: ['Tanggal', 'Omzet', 'Laba'],
      rows: rekap.labaPerHari.map((row) => ({
        Tanggal: row.tanggal,
        Omzet: toRupiahExport(row.omzet),
        Laba: toRupiahExport(row.laba),
      })),
    },
    {
      name: 'Laba per Satuan',
      headers: ['Satuan', 'Qty Terjual', 'Omzet', 'Laba', 'Margin %'],
      rows: rekap.labaPerSatuan.map((row) => ({
        Satuan: row.satuan,
        'Qty Terjual': row.qtyTerjual,
        Omzet: toRupiahExport(row.omzet),
        Laba: toRupiahExport(row.laba),
        'Margin %': Number(row.marginPersen.toFixed(2)),
      })),
    },
    {
      name: 'Produk Terlaris',
      headers: ['Produk', 'Qty Terjual', 'Total Penjualan'],
      rows: rekap.produkTerlaris.map((row) => ({
        Produk: row.namaItem,
        'Qty Terjual': row.qtyTerjual,
        'Total Penjualan': toRupiahExport(row.totalPenjualan),
      })),
    },
    {
      name: 'Pembelian per Supplier',
      headers: ['Supplier', 'Total Pembelian'],
      rows: rekap.pembelianPerSupplier.map((row) => ({
        Supplier: row.supplierName,
        'Total Pembelian': toRupiahExport(row.totalPembelian),
      })),
    },
    {
      name: 'Piutang per Pelanggan',
      headers: ['Pelanggan', 'Telepon', 'Jumlah Bon Belum Lunas', 'Total Piutang'],
      rows: rekap.piutangPerPelanggan.map((row) => ({
        Pelanggan: row.namaPelanggan,
        Telepon: row.telepon ?? '-',
        'Jumlah Bon Belum Lunas': row.jumlahBon,
        'Total Piutang': toRupiahExport(row.totalPiutang),
      })),
    },
    {
      name: 'Nilai Stock',
      headers: ['Kode Item', 'Produk', 'Stok', 'Satuan', 'Harga Pokok', 'Nilai'],
      rows: rekap.stockValue.produk.map((row) => ({
        'Kode Item': row.kodeItem,
        Produk: row.namaItem,
        Stok: row.stok,
        Satuan: row.satuan,
        'Harga Pokok': toRupiahExport(row.hargaPokok),
        Nilai: toRupiahExport(row.nilai),
      })),
    },
  ]

  for (const sheet of sheets) {
    const worksheet: XLSX.WorkSheet = {}
    XLSX.utils.sheet_add_json(worksheet, sheet.rows, { header: sheet.headers, origin: 'A2' })
    XLSX.utils.sheet_add_aoa(worksheet, [[sheet.name]], { origin: 'A1' })
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(sheet.headers.length - 1, 0) } }]
    worksheet['!cols'] = computeColWidths(sheet.headers, sheet.rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31))
  }

  return workbook
}
