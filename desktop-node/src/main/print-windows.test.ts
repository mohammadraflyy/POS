import { beforeEach, describe, expect, it, vi } from 'vitest'
import { printRaw } from './print-windows'

// `printRaw` talks to koffi's `winspool.drv` binding directly, so the only seam available
// to a test is koffi itself. Mocking it lets us make the *first* OpenPrinter call
// observably slow and the second one instant - if `printQueue` is ever removed, the second
// call's OpenPrinter would fire while the first is still "in flight" and `overlapped` would
// flip to true. A real printer always fails instantly here (there is no "Printer Yang Tidak
// Ada 12345"), so without this mock both calls settle too close together to prove ordering
// one way or the other - see the fix report for the empirical check that this actually
// catches a missing queue.
const state = vi.hoisted(() => ({ busy: false, overlapped: false, calls: 0 }))

vi.mock('koffi', () => {
  const asyncImpl = (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, res: unknown) => void

    if (state.busy) {
      state.overlapped = true
    }
    state.busy = true

    const delay = state.calls === 0 ? 30 : 0
    state.calls += 1

    setTimeout(() => {
      state.busy = false
      cb(null, false) // OpenPrinterA fails - no such printer, matches the real thing
    }, delay)
  }

  const stubFunc = Object.assign(() => false, { async: asyncImpl })

  return {
    default: {
      load: () => ({ func: () => stubFunc }),
      struct: () => ({}),
      pointer: (t: unknown) => t,
    },
  }
})

beforeEach(() => {
  state.busy = false
  state.overlapped = false
  state.calls = 0
})

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
    expect(state.overlapped).toBe(false)
  })
})
