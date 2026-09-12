/**
 * Which key does what on the Penjualan page, as a pure function.
 *
 * Ownership of these keys is split across Kasir.tsx and three dialogs, and the same key
 * means different things depending on what is open - PaymentDialog already uses PageUp
 * and PageDown to cycle its own actions. Keeping the rules here means they can be tested
 * without a DOM, which matters because End is the key that opens the till.
 */
export type KasirShortcut =
  | { type: 'editTopQty' }
  | { type: 'focusJumlah' }
  | { type: 'focusCari' }
  | { type: 'clearCart' }
  | { type: 'openCustomer' }
  | { type: 'openBayar' }

export interface ShortcutEvent {
  key: string
  altKey: boolean
}

export interface KasirShortcutState {
  /** number of lines in the cart */
  cartCount: number
  /** payment dialog, product palette, or customer picker is showing */
  anyDialogOpen: boolean
  /** focus is in an input, textarea, or contenteditable */
  editableFocused: boolean
  /** false while an edited sale is still loading or cannot be safely rewritten */
  bayarEnabled: boolean
}

export function resolveShortcut(event: ShortcutEvent, state: KasirShortcutState): KasirShortcut | null {
  // A dialog always wins. PaymentDialog binds PageUp/PageDown to its action selector, and
  // cmdk dialogs own the arrows and Enter while they are open.
  if (state.anyDialogOpen) {
    return null
  }

  // Checked ahead of the focus guard: these three type nothing, so they are safe to fire
  // out of a focused input - and hopping between Jumlah and Cari is the entire point of
  // PageUp/PageDown, which means they must work while one of them is focused.
  if (event.key === 'F3') {
    return state.cartCount > 0 ? { type: 'editTopQty' } : null
  }

  if (event.key === 'PageUp') {
    return { type: 'focusJumlah' }
  }

  if (event.key === 'PageDown') {
    return { type: 'focusCari' }
  }

  if (state.editableFocused) {
    return null
  }

  if (event.key === '/') {
    return { type: 'focusCari' }
  }

  if (event.altKey && event.key.toLowerCase() === 'k') {
    return { type: 'clearCart' }
  }

  if (event.altKey && event.key.toLowerCase() === 'p') {
    return { type: 'openCustomer' }
  }

  // Enter used to do this. It was handed to End so that Enter falls back to the grid's own
  // "start editing this cell", and so the scanner's Enter has one less meaning to compete with.
  if (event.key === 'End') {
    return state.cartCount > 0 && state.bayarEnabled ? { type: 'openBayar' } : null
  }

  return null
}
