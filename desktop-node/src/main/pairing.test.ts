import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generatePairingCode, consumePairingCode } from './pairing'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('generatePairingCode + consumePairingCode', () => {
  it('accepts the code it just generated', () => {
    const { code } = generatePairingCode()

    expect(() => consumePairingCode(code)).not.toThrow()
  })

  it('rejects a wrong code without burning the real one', () => {
    const { code } = generatePairingCode()

    expect(() => consumePairingCode('000000')).toThrow('Kode pairing tidak valid.')
    expect(() => consumePairingCode(code)).not.toThrow()
  })

  it('is single-use: the same code cannot be consumed twice', () => {
    const { code } = generatePairingCode()

    consumePairingCode(code)

    expect(() => consumePairingCode(code)).toThrow('Kode pairing tidak valid.')
  })

  it('rejects a code once its TTL has passed', () => {
    const { code } = generatePairingCode()

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    expect(() => consumePairingCode(code)).toThrow('Kode pairing sudah kedaluwarsa.')
  })

  it('generating a new code invalidates the old one', () => {
    const { code: oldCode } = generatePairingCode()
    generatePairingCode()

    expect(() => consumePairingCode(oldCode)).toThrow('Kode pairing tidak valid.')
  })
})
