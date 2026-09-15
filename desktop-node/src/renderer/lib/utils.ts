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

/** "1.234" or "1.234.567" - a dot every three digits is grouping, not a decimal point. */
const GROUPED_DIGITS = /^\d{1,3}(\.\d{3})+$/

/**
 * Reads a quantity the cashier typed, in the same Indonesian notation `formatQty`
 * writes: comma for the decimal, dot for thousands. "5,5" and "5.5" both mean 5,5,
 * but "2.133" means 2133 - `formatQty(2133)` produces exactly that string, and
 * every editable qty field is seeded from it, so reading the dot as a decimal
 * point turned a stock of 2133 into 2,133. Returns NaN for anything unparseable.
 */
export function parseQty(value: string): number {
  const trimmed = value.trim()

  // A comma settles it: the comma is the decimal, so every dot is a group separator.
  if (trimmed.includes(',')) {
    return Number(trimmed.replace(/\./g, '').replace(',', '.'))
  }

  if (GROUPED_DIGITS.test(trimmed)) {
    return Number(trimmed.replace(/\./g, ''))
  }

  return Number(trimmed)
}

/**
 * Formats a `YYYY-MM-DD` calendar-day string (no time zone of its own) for display.
 * `new Date('2026-01-15')` parses as UTC midnight, which `toLocaleDateString` can then
 * shift back a day west of Greenwich - splitting the string into a local `Date` avoids
 * that entirely instead of depending on the machine running east of UTC.
 */
export function formatTanggal(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('id-ID')
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
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
