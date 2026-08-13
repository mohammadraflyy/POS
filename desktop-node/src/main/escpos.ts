import type { MetodePembayaran } from './kasir'

export type PaperWidth = '58mm' | '80mm'

export interface EscPosReceiptItem {
  namaItem: string
  qty: number
  satuan: string | null
  hargaJual: number
  subtotal: number
}

export interface EscPosReceiptSale {
  saleId: number
  total: number
  dibayar: number
  metodePembayaran: MetodePembayaran
  namaPelanggan: string | null
  createdAt: string
  kasirName: string | null
  items: EscPosReceiptItem[]
}

export interface EscPosStoreSettings {
  namaToko: string
  alamat: string | null
  telepon: string | null
  pesanFooter: string | null
}

const CHAR_WIDTH: Record<PaperWidth, number> = {
  '58mm': 32,
  '80mm': 48,
}

const ESC = 0x1b
const GS = 0x1d

function initPrinter(): number[] {
  return [ESC, 0x40]
}

function setAlign(mode: 0 | 1 | 2): number[] {
  return [ESC, 0x61, mode]
}

function setBold(on: boolean): number[] {
  return [ESC, 0x45, on ? 1 : 0]
}

function feed(lines: number): number[] {
  return [ESC, 0x64, lines]
}

function cutPaper(): number[] {
  return [GS, 0x56, 0x00]
}

function textLine(s: string): number[] {
  return Array.from(Buffer.from(`${s}\n`, 'ascii'))
}

/** Right-pads/truncates so `left` and `right` sit at opposite ends of a `width`-character line. */
export function padLine(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length

  if (gap < 1) {
    const maxLeft = Math.max(0, width - right.length - 1)
    return `${left.slice(0, maxLeft)} ${right}`
  }

  return `${left}${' '.repeat(gap)}${right}`
}

function formatRupiah(value: number): string {
  const formatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value)
  return formatted.replace(String.fromCharCode(160), ' ')
}

export function buildReceiptEscPos(sale: EscPosReceiptSale, storeSettings: EscPosStoreSettings, paperWidth: PaperWidth): Buffer {
  const width = CHAR_WIDTH[paperWidth]
  const dashLine = '-'.repeat(width)
  const out: number[] = []

  out.push(...initPrinter())

  out.push(...setAlign(1))
  out.push(...setBold(true))
  out.push(...textLine(storeSettings.namaToko))
  out.push(...setBold(false))

  if (storeSettings.alamat) {
    out.push(...textLine(storeSettings.alamat))
  }

  if (storeSettings.telepon) {
    out.push(...textLine(storeSettings.telepon))
  }

  out.push(...setAlign(0))
  out.push(...textLine(dashLine))

  const createdAtLabel = new Date(sale.createdAt).toLocaleString('id-ID')
  out.push(...textLine(padLine(`Struk #${sale.saleId}`, createdAtLabel, width)))

  if (sale.kasirName) {
    out.push(...textLine(padLine('Kasir', sale.kasirName, width)))
  }

  // printed for every method, not just bon - a tunai customer may still give
  // a name, and it is the only way to tie a printed struk back to a person
  if (sale.namaPelanggan) {
    out.push(...textLine(padLine('Pelanggan', sale.namaPelanggan, width)))
  }

  out.push(...textLine(dashLine))

  for (const item of sale.items) {
    out.push(...textLine(item.namaItem))
    const qtyLabel = `${item.qty} ${item.satuan ?? ''} x ${formatRupiah(item.hargaJual)}`.replace(/\s+/g, ' ').trim()
    out.push(...textLine(padLine(qtyLabel, formatRupiah(item.subtotal), width)))
  }

  out.push(...textLine(dashLine))

  out.push(...setBold(true))
  out.push(...textLine(padLine('TOTAL', formatRupiah(sale.total), width)))
  out.push(...setBold(false))

  if (sale.metodePembayaran === 'qris' || sale.metodePembayaran === 'transfer') {
    // settled in full, so there is no change line to print - just name how it was paid
    out.push(...textLine(padLine(sale.metodePembayaran === 'qris' ? 'QRIS' : 'Transfer', formatRupiah(sale.total), width)))
  } else if (sale.metodePembayaran === 'tunai') {
    out.push(...textLine(padLine('Tunai', formatRupiah(sale.dibayar), width)))
    const kembalian = sale.dibayar - sale.total
    out.push(...textLine(padLine('Kembali', formatRupiah(Math.max(kembalian, 0)), width)))
  } else {
    // the name already has its own line above, so this one carries the debt
    out.push(...textLine(padLine('Bon', formatRupiah(sale.total - sale.dibayar), width)))
  }

  if (storeSettings.pesanFooter) {
    out.push(...textLine(dashLine))
    out.push(...setAlign(1))
    out.push(...textLine(storeSettings.pesanFooter))
  }

  out.push(...feed(3))
  out.push(...cutPaper())

  return Buffer.from(out)
}

/** Fixed sample receipt for the Settings page's Test Print tool — matches the web app's dummySale() precedent. */
export const SAMPLE_RECEIPT: EscPosReceiptSale = {
  saleId: 0,
  total: 25000,
  dibayar: 30000,
  metodePembayaran: 'tunai',
  namaPelanggan: null,
  createdAt: new Date().toISOString(),
  kasirName: 'Test',
  items: [
    { namaItem: 'Contoh Produk A', qty: 2, satuan: 'PCS', hargaJual: 10000, subtotal: 20000 },
    { namaItem: 'Contoh Produk B', qty: 1, satuan: 'PCS', hargaJual: 5000, subtotal: 5000 },
  ],
}
