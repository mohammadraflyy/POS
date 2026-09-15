import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema'
import { checkout, getSaleDetail, listSalesHistory, type CheckoutInput, type MetodePembayaran } from '../../kasir'
import { toCents, toRupiah } from '../../money'
import { withAuth, matchPath, type HttpRequest, type HttpResponse, type RouterDeps } from '../context'

interface CheckoutBody {
  metodePembayaran: MetodePembayaran
  namaPelanggan: string | null
  dibayar: number | null
  tanggal?: string | null
  diskon?: number | null
  keterangan?: string | null
  items: { productId: number; productUnitId: number | null; qty: number; diskon?: number | null }[]
}

export async function handleSalesRoutes(
  db: BetterSQLite3Database<typeof schema>,
  req: HttpRequest,
  deps: RouterDeps,
): Promise<HttpResponse | null> {
  if (req.method === 'POST' && req.path === '/v1/sales') {
    return withAuth(db, req.headers, async (user) => {
      const input = req.body as Partial<CheckoutBody> | null

      if (!input?.metodePembayaran || !input.items) {
        return { status: 400, body: { error: 'metodePembayaran dan items wajib diisi.' } }
      }

      const checkoutInput: CheckoutInput = {
        metodePembayaran: input.metodePembayaran,
        namaPelanggan: input.namaPelanggan ?? null,
        dibayar: input.dibayar == null ? null : toCents(input.dibayar),
        userId: user.id,
        tanggal: input.tanggal ?? null,
        diskon: input.diskon == null ? null : toCents(input.diskon),
        keterangan: input.keterangan ?? null,
        items: input.items.map((item) => ({
          productId: item.productId,
          productUnitId: item.productUnitId,
          qty: item.qty,
          diskon: item.diskon == null ? null : toCents(item.diskon),
        })),
      }

      const result = checkout(db, checkoutInput)

      // The sale is already committed at this point - a printer problem must never
      // look like the sale itself failed. The phone gets told so it can ask the
      // cashier to reprint from the PC instead of retrying the whole checkout.
      let printed = false
      let printError: string | undefined

      if (deps.printReceipt) {
        try {
          await deps.printReceipt(db, result.saleId, user.name)
          printed = true
        } catch (err) {
          printError = err instanceof Error ? err.message : 'Gagal mencetak struk.'
        }
      }

      return {
        status: 200,
        body: { saleId: result.saleId, total: toRupiah(result.total), printed, printError },
      }
    })
  }

  if (req.method === 'GET' && req.path === '/v1/sales') {
    return withAuth(db, req.headers, () => {
      const result = listSalesHistory(db, {
        dari: req.query.dari,
        sampai: req.query.sampai,
        status: req.query.status as 'selesai' | 'dibatalkan' | undefined,
        metodePembayaran: req.query.metodePembayaran as MetodePembayaran | undefined,
        search: req.query.search,
        page: Number(req.query.page ?? '1') || 1,
      })

      return {
        status: 200,
        body: {
          data: result.data.map((sale) => ({
            id: sale.id,
            createdAt: sale.createdAt.toISOString(),
            namaPelanggan: sale.namaPelanggan,
            metodePembayaran: sale.metodePembayaran,
            status: sale.status,
            total: toRupiah(sale.total),
            dibayar: toRupiah(sale.dibayar),
            items: sale.items,
          })),
          currentPage: result.currentPage,
          lastPage: result.lastPage,
          total: result.total,
        },
      }
    })
  }

  const printMatch = matchPath('/v1/sales/:id/print', req.path)

  if (req.method === 'POST' && printMatch) {
    return withAuth(db, req.headers, async () => {
      if (!deps.printReceipt) {
        return { status: 400, body: { error: 'Cetak tidak tersedia dari server ini.' } }
      }

      const saleId = Number(printMatch[0])
      const detail = getSaleDetail(db, saleId)
      await deps.printReceipt(db, saleId, detail.kasirName)

      return { status: 200, body: { printed: true } }
    })
  }

  const detailMatch = matchPath('/v1/sales/:id', req.path)

  if (req.method === 'GET' && detailMatch) {
    return withAuth(db, req.headers, () => {
      const detail = getSaleDetail(db, Number(detailMatch[0]))

      return {
        status: 200,
        body: {
          id: detail.id,
          namaPelanggan: detail.namaPelanggan,
          metodePembayaran: detail.metodePembayaran,
          status: detail.status,
          diskon: toRupiah(detail.diskon),
          total: toRupiah(detail.total),
          dibayar: toRupiah(detail.dibayar),
          keterangan: detail.keterangan,
          createdAt: detail.createdAt.toISOString(),
          kasirName: detail.kasirName,
          items: detail.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            productUnitId: item.productUnitId,
            qty: item.qty,
            satuan: item.satuan,
            namaItem: item.namaItem,
            hargaJual: toRupiah(item.hargaJual),
            diskon: toRupiah(item.diskon),
            subtotal: toRupiah(item.subtotal),
            priceSource: item.priceSource,
          })),
          bonPayments: detail.bonPayments.map((payment) => ({
            id: payment.id,
            jumlah: toRupiah(payment.jumlah),
            tanggal: payment.tanggal,
            keterangan: payment.keterangan,
          })),
          edits: detail.edits.map((row) => ({
            id: row.id,
            keterangan: row.keterangan,
            kasirName: row.kasirName,
            totalSebelum: toRupiah(row.totalSebelum),
            totalSesudah: toRupiah(row.totalSesudah),
            createdAt: row.createdAt.toISOString(),
          })),
        },
      }
    })
  }

  return null
}
