import { describe, expect, it } from 'vitest'
import { buildReceiptEscPos, padLine, SAMPLE_RECEIPT, type EscPosReceiptSale, type EscPosStoreSettings } from './escpos'

describe('padLine', () => {
  it('pads with spaces to fill the width', () => {
    expect(padLine('Total', 'Rp 65.000', 32)).toBe('Total' + ' '.repeat(32 - 5 - 9) + 'Rp 65.000')
  })

  it('produces exactly `width` characters', () => {
    expect(padLine('Tunai', 'Rp 100.000', 32)).toHaveLength(32)
    expect(padLine('Kembali', 'Rp 35.000', 48)).toHaveLength(48)
  })

  it('truncates the left side when there is no room, keeping the right side intact', () => {
    const result = padLine('A very very very long product name that will not fit', 'Rp 65.000', 32)
    expect(result).toHaveLength(32)
    expect(result.endsWith('Rp 65.000')).toBe(true)
  })
})

describe('buildReceiptEscPos', () => {
  const storeSettings: EscPosStoreSettings = {
    namaToko: 'Toko Sekawan',
    alamat: 'Jl. Contoh No. 1',
    telepon: '021-1234567',
    pesanFooter: 'Terima kasih telah berbelanja',
  }

  const tunaiSale: EscPosReceiptSale = {
    saleId: 8,
    total: 65000,
    dibayar: 100000,
    metodePembayaran: 'tunai',
    namaPelanggan: null,
    createdAt: '2026-08-07T04:03:06.000Z',
    kasirName: 'Admin',
    items: [{ namaItem: 'Beras 5kg', qty: 1, satuan: 'PCS', hargaJual: 65000, subtotal: 65000 }],
  }

  it('starts with the ESC @ initialize sequence', () => {
    const bytes = buildReceiptEscPos(tunaiSale, storeSettings, '58mm')
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
  })

  it('ends with a feed and full cut sequence', () => {
    const bytes = buildReceiptEscPos(tunaiSale, storeSettings, '58mm')
    // GS V 0 = full cut, preceded by ESC d 3 (feed 3 lines)
    const tail = Array.from(bytes.subarray(bytes.length - 6))
    expect(tail).toEqual([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x00])
  })

  it('includes store info, item lines, and tunai payment lines as readable text', () => {
    const text = buildReceiptEscPos(tunaiSale, storeSettings, '58mm').toString('ascii')
    expect(text).toContain('Toko Sekawan')
    expect(text).toContain('Jl. Contoh No. 1')
    expect(text).toContain('021-1234567')
    expect(text).toContain('Struk #8')
    expect(text).toContain('Admin')
    expect(text).toContain('Beras 5kg')
    expect(text).toContain('TOTAL')
    expect(text).toContain('Tunai')
    expect(text).toContain('Kembali')
    expect(text).toContain('Terima kasih telah berbelanja')
    expect(text).not.toContain('Bon')
  })

  it('includes a Bon line with the customer name for bon sales, no Tunai/Kembali', () => {
    const bonSale: EscPosReceiptSale = { ...tunaiSale, metodePembayaran: 'bon', namaPelanggan: 'Bu Siti', dibayar: 0 }
    const text = buildReceiptEscPos(bonSale, storeSettings, '58mm').toString('ascii')
    expect(text).toContain('Bon')
    expect(text).toContain('Bu Siti')
    expect(text).not.toContain('Tunai')
    expect(text).not.toContain('Kembali')
  })

  it('prints the customer name on a tunai receipt too', () => {
    const namedTunai: EscPosReceiptSale = { ...tunaiSale, namaPelanggan: 'Pak Budi' }
    const line = buildReceiptEscPos(namedTunai, storeSettings, '58mm')
      .toString('ascii')
      .split('\n')
      .find((l) => l.startsWith('Pelanggan'))

    expect(line).toBeDefined()
    expect(line).toContain('Pak Budi')
  })

  it('omits the Pelanggan line when no name was given', () => {
    const text = buildReceiptEscPos(tunaiSale, storeSettings, '58mm').toString('ascii')
    expect(text).not.toContain('Pelanggan')
  })

  it('shows the outstanding amount on the Bon line', () => {
    const partlyPaid: EscPosReceiptSale = { ...tunaiSale, metodePembayaran: 'bon', namaPelanggan: 'Bu Siti', dibayar: 25000 }
    // the bold-off escape bytes ride at the head of this line, so match loosely
    const line = buildReceiptEscPos(partlyPaid, storeSettings, '58mm')
      .toString('ascii')
      .split('\n')
      .find((l) => l.includes('Bon'))

    // 65000 total - 25000 paid
    expect(line).toContain('40.000')
  })

  it('omits alamat/telepon/pesanFooter lines when null', () => {
    const bareSettings: EscPosStoreSettings = { namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }
    const text = buildReceiptEscPos(tunaiSale, bareSettings, '58mm').toString('ascii')
    expect(text).toContain('Toko')
    expect(text.split('\n').filter((line) => line.trim().length > 0).length).toBeLessThan(15)
  })

  it('produces wider padded lines for 80mm than 58mm', () => {
    const text58 = buildReceiptEscPos(tunaiSale, storeSettings, '58mm').toString('ascii')
    const text80 = buildReceiptEscPos(tunaiSale, storeSettings, '80mm').toString('ascii')
    const totalLine58 = text58.split('\n').find((line) => line.includes('TOTAL'))
    const totalLine80 = text80.split('\n').find((line) => line.includes('TOTAL'))
    expect(totalLine58).toBeDefined()
    expect(totalLine80).toBeDefined()
    // Each segment carries a fixed 3-byte bold-on prefix (ESC E 1) before the
    // width-character padded text, so the segment's total length is exactly
    // width + 3 - this proves the actual 32/48 absolute widths, not just
    // that the two differ by the expected 16-character gap between them.
    expect(totalLine58).toHaveLength(32 + 3)
    expect(totalLine80).toHaveLength(48 + 3)
  })

  it('clamps a negative kembalian to 0 rather than printing a negative amount', () => {
    const underpaid: EscPosReceiptSale = { ...tunaiSale, dibayar: 50000 }
    const text = buildReceiptEscPos(underpaid, storeSettings, '58mm').toString('ascii')
    const kembaliLine = text.split('\n').find((line) => line.startsWith('Kembali'))
    expect(kembaliLine).not.toContain('-')
  })
})

describe('SAMPLE_RECEIPT', () => {
  it('is a valid EscPosReceiptSale that builds without throwing', () => {
    const storeSettings: EscPosStoreSettings = { namaToko: 'Toko', alamat: null, telepon: null, pesanFooter: null }
    expect(() => buildReceiptEscPos(SAMPLE_RECEIPT, storeSettings, '58mm')).not.toThrow()
  })

  it('totals match its own item subtotals (internally consistent sample data)', () => {
    const sum = SAMPLE_RECEIPT.items.reduce((acc, item) => acc + item.subtotal, 0)
    expect(sum).toBe(SAMPLE_RECEIPT.total)
  })
})
