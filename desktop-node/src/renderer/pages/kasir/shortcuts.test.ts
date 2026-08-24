import { describe, expect, it } from 'vitest'
import { resolveShortcut, type KasirShortcutState } from './shortcuts'

function state(overrides: Partial<KasirShortcutState> = {}): KasirShortcutState {
  return {
    cartCount: 1,
    anyDialogOpen: false,
    editableFocused: false,
    bayarEnabled: true,
    ...overrides,
  }
}

describe('resolveShortcut', () => {
  it('opens the payment dialog on End', () => {
    expect(resolveShortcut({ key: 'End', altKey: false }, state())).toEqual({ type: 'openBayar' })
  })

  it('no longer pays on a lone Enter', () => {
    expect(resolveShortcut({ key: 'Enter', altKey: false }, state())).toBeNull()
  })

  it('refuses End on an empty cart', () => {
    expect(resolveShortcut({ key: 'End', altKey: false }, state({ cartCount: 0 }))).toBeNull()
  })

  it('refuses End while an edited sale is not ready to be saved', () => {
    expect(resolveShortcut({ key: 'End', altKey: false }, state({ bayarEnabled: false }))).toBeNull()
  })

  it('sends PageUp to the Jumlah field and PageDown to the Cari box', () => {
    expect(resolveShortcut({ key: 'PageUp', altKey: false }, state())).toEqual({ type: 'focusJumlah' })
    expect(resolveShortcut({ key: 'PageDown', altKey: false }, state())).toEqual({ type: 'focusCari' })
  })

  it('keeps PageUp and PageDown working while an input is focused, so the two fields can be hopped between', () => {
    expect(resolveShortcut({ key: 'PageUp', altKey: false }, state({ editableFocused: true }))).toEqual({
      type: 'focusJumlah',
    })
    expect(resolveShortcut({ key: 'PageDown', altKey: false }, state({ editableFocused: true }))).toEqual({
      type: 'focusCari',
    })
  })

  it('yields every key to an open dialog, because PaymentDialog owns PageUp and PageDown itself', () => {
    const open = state({ anyDialogOpen: true })

    expect(resolveShortcut({ key: 'PageUp', altKey: false }, open)).toBeNull()
    expect(resolveShortcut({ key: 'PageDown', altKey: false }, open)).toBeNull()
    expect(resolveShortcut({ key: 'End', altKey: false }, open)).toBeNull()
    expect(resolveShortcut({ key: 'F3', altKey: false }, open)).toBeNull()
  })

  it('keeps the existing shortcuts', () => {
    expect(resolveShortcut({ key: 'F3', altKey: false }, state())).toEqual({ type: 'editTopQty' })
    expect(resolveShortcut({ key: '/', altKey: false }, state())).toEqual({ type: 'focusCari' })
    expect(resolveShortcut({ key: 'k', altKey: true }, state())).toEqual({ type: 'clearCart' })
    expect(resolveShortcut({ key: 'p', altKey: true }, state())).toEqual({ type: 'openCustomer' })
  })

  it('does not steal a typed slash or Alt shortcut from a focused input', () => {
    const typing = state({ editableFocused: true })

    expect(resolveShortcut({ key: '/', altKey: false }, typing)).toBeNull()
    expect(resolveShortcut({ key: 'k', altKey: true }, typing)).toBeNull()
  })

  it('refuses F3 on an empty cart', () => {
    expect(resolveShortcut({ key: 'F3', altKey: false }, state({ cartCount: 0 }))).toBeNull()
  })

  it('fires F3 even while an input is focused, ahead of the editable-focused guard', () => {
    expect(resolveShortcut({ key: 'F3', altKey: false }, state({ editableFocused: true }))).toEqual({
      type: 'editTopQty',
    })
  })
})
