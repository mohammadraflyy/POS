import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema'
import { listCustomers, searchCatalogForSale } from '../../kasir'
import { toRupiah } from '../../money'
import { withAuth, type HttpRequest, type HttpResponse } from '../context'

export async function handleCatalogRoutes(
  db: BetterSQLite3Database<typeof schema>,
  req: HttpRequest,
): Promise<HttpResponse | null> {
  if (req.method === 'GET' && req.path === '/v1/customers') {
    return withAuth(db, req.headers, () => ({ status: 200, body: { names: listCustomers(db) } }))
  }

  if (req.method === 'GET' && req.path === '/v1/catalog/search') {
    return withAuth(db, req.headers, () => {
      const page = Number(req.query.page ?? '1') || 1
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined
      const result = searchCatalogForSale(db, { q: req.query.q, page, pageSize })

      return {
        status: 200,
        body: {
          data: result.data.map((item) => ({
            id: item.id,
            kodeItem: item.kodeItem,
            barcode: item.barcode,
            namaItem: item.namaItem,
            satuan: item.satuan,
            hargaJual: toRupiah(item.hargaJual),
            hargaPokok: toRupiah(item.hargaPokok),
            stok: item.stok,
            baseProductUnitId: item.baseProductUnitId,
            productUnits: item.productUnits.map((unit) => ({
              id: unit.id,
              satuan: unit.satuan,
              konversi: unit.konversi,
              hargaJual: toRupiah(unit.hargaJual),
              hargaPokok: toRupiah(unit.hargaPokok),
            })),
            priceTiers: item.priceTiers.map((tier) => ({
              productUnitId: tier.productUnitId,
              minQty: tier.minQty,
              maxQty: tier.maxQty,
              hargaJual: toRupiah(tier.hargaJual),
            })),
          })),
          currentPage: result.currentPage,
          lastPage: result.lastPage,
          total: result.total,
        },
      }
    })
  }

  return null
}
