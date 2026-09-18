// IPC money values are rupiah; persistence remains in integer cents.
export interface CostCorrectionRequest {
  saleItemId: number
  scope: 'item' | 'period'
  from: string
  to: string
  hargaPokok: number
}

export interface CostCorrectionPreview {
  token: string
  namaItem: string
  satuan: string
  hargaPokok: number
  rows: {
    saleItemId: number
    saleId: number
    tanggal: string
    qty: number
    hargaPokokLama: number
    omzet: number
    labaLama: number
    labaBaru: number
  }[]
  labaLama: number
  labaBaru: number
}

export interface CostCorrectionApply extends CostCorrectionRequest {
  token: string
  alasan: string
}

export interface CostCorrectionHistory {
  id: number
  batchId: string
  saleId: number
  namaItem: string
  satuan: string
  qty: number
  hargaPokokLama: number
  hargaPokokBaru: number
  alasan: string
  adminName: string
  createdAt: string
}
