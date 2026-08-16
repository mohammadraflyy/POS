export type MetodePembayaran = 'tunai' | 'bon' | 'qris' | 'transfer'

export const METODE_LABEL: Record<MetodePembayaran, string> = {
  tunai: 'Tunai',
  bon: 'Bon',
  qris: 'QRIS',
  transfer: 'Transfer',
}
