import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { storeSettings } from './db/schema'
import { getReceipt } from './kasir'
import { buildReceiptEscPos, type PaperWidth } from './escpos'
import { printRaw } from './print-windows'
import { getMainWindow } from './index'

export async function resolvePrinterName(savedName: string | null): Promise<string> {
  if (savedName) {
    return savedName
  }

  const window = getMainWindow()

  if (!window) {
    throw new Error('Jendela aplikasi tidak ditemukan.')
  }

  const printers = await window.webContents.getPrintersAsync()
  const defaultPrinter = printers.find((printer) => printer.isDefault)

  if (!defaultPrinter) {
    throw new Error('Tidak ada printer default. Pilih printer di Pengaturan.')
  }

  return defaultPrinter.name
}

/**
 * Builds and sends one sale's struk to the printer saved in Pengaturan (or the OS
 * default). The only entry point that touches Electron for printing - kept out of
 * `kasir.ts` so that file, and anything that only needs the pure pricing/record
 * logic (like the HTTP router), never pulls in `./index` and its module-level
 * `app.on(...)` side effects.
 */
export async function printReceiptForSale(
  db: BetterSQLite3Database<typeof schema>,
  saleId: number,
  kasirName: string | null,
): Promise<void> {
  const receipt = getReceipt(db, saleId, kasirName)

  const setting = db.select().from(storeSettings).get()
  const storeInfo = {
    namaToko: setting?.namaToko ?? 'Toko',
    alamat: setting?.alamat ?? null,
    telepon: setting?.telepon ?? null,
    pesanFooter: setting?.pesanFooter ?? null,
  }
  const paperWidth: PaperWidth = setting?.receiptWidth ?? '58mm'

  const bytes = buildReceiptEscPos(receipt, storeInfo, paperWidth)
  const printerName = await resolvePrinterName(setting?.printerName ?? null)
  await printRaw(printerName, bytes)
}
