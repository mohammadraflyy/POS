import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** quantities are plain numbers and may be fractional (0,25 KG, 5,5 KG, 2,5 DUS) */
export function formatQty(value: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(value)
}

/**
 * Reads a quantity the cashier typed. Accepts the Indonesian decimal comma, so
 * "5,5" and "5.5" both mean 5.5. Returns NaN for anything unparseable.
 */
export function parseQty(value: string): number {
  return Number(value.trim().replace(',', '.'))
}

export function formatRupiah(value: number): string {
  const formatted = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(value)
  // Replace non-breaking space (U+00A0) with regular space
  return formatted.replace(String.fromCharCode(160), ' ')
}
