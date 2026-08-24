import { describe, expect, it } from 'vitest'
import { printRaw } from './print-windows'

describe('printRaw', () => {
  it('rejects an unknown printer with a message a cashier can read', async () => {
    await expect(printRaw('Printer Yang Tidak Ada 12345', Buffer.from('x'))).rejects.toThrow(/Gagal mencetak/)
  })

  it('serialises concurrent prints instead of interleaving them', async () => {
    const order: string[] = []

    const first = printRaw('Printer Yang Tidak Ada 12345', Buffer.from('a')).catch(() => order.push('a'))
    const second = printRaw('Printer Yang Tidak Ada 12345', Buffer.from('b')).catch(() => order.push('b'))

    await Promise.all([first, second])

    expect(order).toEqual(['a', 'b'])
  })
})
