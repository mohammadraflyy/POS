import { contextBridge, ipcRenderer } from 'electron'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((err: Error) => {
    throw new Error(err.message.replace(/^Error invoking remote method '[^']*': \w*Error: /, ''))
  })
}

const api = {
  auth: {
    login: (username: string, password: string) =>
      invoke('auth:login', username, password),
    logout: () => invoke('auth:logout'),
    me: () => invoke('auth:me'),
  },
  kasir: {
    listProducts: () => invoke('kasir:listProducts'),
    listSalesToday: () => invoke('kasir:listSalesToday'),
    checkout: (input: {
      metodePembayaran: 'tunai' | 'bon'
      namaPelanggan: string | null
      dibayar: number | null
      items: { productId: number; productUnitId: number | null; qty: number }[]
    }) => invoke('kasir:checkout', input),
    cancelSale: (saleId: number) => invoke('kasir:cancelSale', saleId),
    getStoreSettings: () => invoke('kasir:getStoreSettings'),
    printReceipt: (saleId: number) => invoke('kasir:printReceipt', saleId),
    listPrinters: () => invoke('kasir:listPrinters'),
    testPrint: () => invoke('kasir:testPrint'),
    listSalesHistory: (filters: {
      dari?: string
      sampai?: string
      status?: 'selesai' | 'dibatalkan'
      metodePembayaran?: 'tunai' | 'bon'
      search?: string
      page: number
    }) => invoke('kasir:listSalesHistory', filters),
    getSaleDetail: (saleId: number) => invoke('kasir:getSaleDetail', saleId),
    recordBonPayment: (input: { saleId: number; jumlah: number; keterangan: string | null }) =>
      invoke('kasir:recordBonPayment', input),
    updateStoreSettings: (input: {
      namaToko: string
      alamat: string | null
      telepon: string | null
      pesanFooter: string | null
      printerName: string | null
      receiptWidth: '58mm' | '80mm'
    }) => invoke('kasir:updateStoreSettings', input),
    purgeSalesBefore: (before: string) => invoke('kasir:purgeSalesBefore', before),
  },
}

contextBridge.exposeInMainWorld('api', api)
