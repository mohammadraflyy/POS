export function toRupiah(cents: number): number {
  return cents / 100
}

export function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}
