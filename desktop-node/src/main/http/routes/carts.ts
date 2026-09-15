import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema'
import { previewCart, type CartItemInput } from '../../kasir'
import { toCents, toRupiah } from '../../money'
import { withAuth, type HttpRequest, type HttpResponse } from '../context'

interface PriceCartBody {
  items: { productId: number; productUnitId: number | null; qty: number; hargaJual?: number | null; diskon?: number | null }[]
  diskonNota?: number | null
}

export async function handleCartsRoutes(
  db: BetterSQLite3Database<typeof schema>,
  req: HttpRequest,
): Promise<HttpResponse | null> {
  if (req.method !== 'POST' || req.path !== '/v1/carts/price') {
    return null
  }

  return withAuth(db, req.headers, () => {
    const input = req.body as Partial<PriceCartBody> | null

    if (!input?.items) {
      return { status: 400, body: { error: 'items wajib diisi.' } }
    }

    const items: CartItemInput[] = input.items.map((item) => ({
      productId: item.productId,
      productUnitId: item.productUnitId,
      qty: item.qty,
      hargaJual: item.hargaJual == null ? null : toCents(item.hargaJual),
      diskon: item.diskon == null ? null : toCents(item.diskon),
    }))

    const result = previewCart(db, {
      items,
      diskon: input.diskonNota == null ? null : toCents(input.diskonNota),
    })

    return {
      status: 200,
      body: {
        lines: result.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          satuan: line.satuan,
          qty: line.qty,
          hargaJual: toRupiah(line.hargaJual),
          diskon: toRupiah(line.diskon),
          subtotal: toRupiah(line.subtotal),
          priceSource: line.priceSource,
          stokCukup: line.stokCukup,
        })),
        subtotal: toRupiah(result.subtotal),
        diskon: toRupiah(result.diskon),
        total: toRupiah(result.total),
      },
    }
  })
}
