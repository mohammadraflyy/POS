import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema'
import {
  recordPurchase,
  searchProductsForPurchase,
  findProductForPurchaseByBarcode,
  type PurchaseItemInput,
} from '../../purchase'
import { listSuppliers, createSupplier, type SupplierInput } from '../../supplier'
import { toCents, toRupiah } from '../../money'
import { withAuth, matchPath, type HttpRequest, type HttpResponse } from '../context'

function mapProductOption(product: {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaPokok: number
  units: { id: number; satuan: string; konversi: number; hargaPokok: number }[]
}) {
  return {
    id: product.id,
    kodeItem: product.kodeItem,
    namaItem: product.namaItem,
    satuan: product.satuan,
    hargaPokok: toRupiah(product.hargaPokok),
    units: product.units.map((unit) => ({ ...unit, hargaPokok: toRupiah(unit.hargaPokok) })),
  }
}

interface PurchaseBody {
  supplierId: number | null
  tanggal: string
  catatan: string | null
  items: { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }[]
  dibayar?: number | null
}

export async function handlePurchasesRoutes(
  db: BetterSQLite3Database<typeof schema>,
  req: HttpRequest,
): Promise<HttpResponse | null> {
  if (req.method === 'GET' && req.path === '/v1/suppliers') {
    return withAuth(db, req.headers, () => {
      const result = listSuppliers(db, { search: req.query.q, page: Number(req.query.page ?? '1') || 1 })

      return { status: 200, body: result }
    })
  }

  if (req.method === 'POST' && req.path === '/v1/suppliers') {
    return withAuth(db, req.headers, () => {
      const input = req.body as Partial<SupplierInput> | null

      if (!input?.nama) {
        return { status: 400, body: { error: 'nama wajib diisi.' } }
      }

      const id = createSupplier(db, {
        nama: input.nama,
        telepon: input.telepon ?? null,
        alamat: input.alamat ?? null,
        keterangan: input.keterangan ?? null,
      })

      return { status: 200, body: { id } }
    })
  }

  if (req.method === 'GET' && req.path === '/v1/purchases/products') {
    return withAuth(db, req.headers, () => {
      const results = searchProductsForPurchase(db, req.query.q ?? '')

      return { status: 200, body: { data: results.map(mapProductOption) } }
    })
  }

  const barcodeMatch = matchPath('/v1/purchases/products/barcode/:code', req.path)

  if (req.method === 'GET' && barcodeMatch) {
    return withAuth(db, req.headers, () => {
      const product = findProductForPurchaseByBarcode(db, barcodeMatch[0])

      if (!product) {
        return { status: 404, body: { error: 'Produk tidak ditemukan.' } }
      }

      return { status: 200, body: mapProductOption(product) }
    })
  }

  if (req.method === 'POST' && req.path === '/v1/purchases') {
    return withAuth(db, req.headers, (user) => {
      const input = req.body as Partial<PurchaseBody> | null

      if (!input?.tanggal || !input.items) {
        return { status: 400, body: { error: 'tanggal dan items wajib diisi.' } }
      }

      const items: PurchaseItemInput[] = input.items.map((item) => ({
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        hargaBeli: toCents(item.hargaBeli),
      }))

      const result = recordPurchase(db, {
        supplierId: input.supplierId ?? null,
        tanggal: input.tanggal,
        catatan: input.catatan ?? null,
        items,
        userId: user.id,
        dibayar: input.dibayar == null ? undefined : toCents(input.dibayar),
      })

      return { status: 200, body: result }
    })
  }

  return null
}
