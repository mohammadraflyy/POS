import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema'
import { listCategories, searchProductsForOpname, recordStockAdjustment } from '../../stock-opname'
import { withAuth, type HttpRequest, type HttpResponse } from '../context'

interface AdjustmentBody {
  expectedStock?: number
  expectedRevision?: number
  productId: number
  stokSesudah: number
  alasan: string | null
}

export async function handleOpnameRoutes(
  db: BetterSQLite3Database<typeof schema>,
  req: HttpRequest,
): Promise<HttpResponse | null> {
  if (req.method === 'GET' && req.path === '/v1/opname/categories') {
    return withAuth(db, req.headers, () => ({ status: 200, body: { data: listCategories(db) } }))
  }

  if (req.method === 'GET' && req.path === '/v1/opname/products') {
    return withAuth(db, req.headers, () => {
      const categoryIds = req.query.categoryIds
        ? req.query.categoryIds
            .split(',')
            .map((id) => Number(id.trim()))
            .filter((id) => Number.isFinite(id))
        : []

      const data = searchProductsForOpname(db, { q: req.query.q ?? '', categoryIds })

      return { status: 200, body: { data } }
    })
  }

  if (req.method === 'POST' && req.path === '/v1/opname/adjustments') {
    return withAuth(db, req.headers, (user) => {
      const input = req.body as Partial<AdjustmentBody> | null

      if (input?.productId == null || input.stokSesudah == null) {
        return { status: 400, body: { error: 'productId dan stokSesudah wajib diisi.' } }
      }

      const result = recordStockAdjustment(db, {
        productId: input.productId,
        stokSesudah: input.stokSesudah,
        alasan: input.alasan ?? null,
        userId: user.id,
        expectedStock: input.expectedStock,
        expectedRevision: input.expectedRevision,
      })

      return { status: 200, body: result }
    })
  }

  return null
}
