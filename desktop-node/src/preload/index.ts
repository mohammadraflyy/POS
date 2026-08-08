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
  inventory: {
    listProducts: (input: { search?: string; page: number; pageSize?: number }) =>
      invoke('inventory:listProducts', input),
    updateProduct: (
      id: number,
      input: {
        kodeItem: string
        barcode: string | null
        namaItem: string
        kategori: string | null
        satuan: string
        hargaPokok: number
        hargaJual: number
        isActive: boolean
      },
    ) => invoke('inventory:updateProduct', id, input),
    deleteProduct: (id: number) => invoke('inventory:deleteProduct', id),
    bulkDeleteProducts: (ids: number[]) => invoke('inventory:bulkDeleteProducts', ids),
    searchProducts: (q: string) => invoke('inventory:searchProducts', q),
    getProductDetail: (productId: number) => invoke('inventory:getProductDetail', productId),
    setProductUnit: (productId: number, level: 2 | 3, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) =>
      invoke('inventory:setProductUnit', productId, level, input),
    deleteProductUnit: (productId: number, level: 2 | 3) => invoke('inventory:deleteProductUnit', productId, level),
    addPriceTier: (productId: number, input: { minQty: number; hargaJual: number }) =>
      invoke('inventory:addPriceTier', productId, input),
    deletePriceTier: (productId: number, tierId: number) => invoke('inventory:deletePriceTier', productId, tierId),
    getProductsByIds: (ids: number[]) => invoke('inventory:getProductsByIds', ids),
    bulkSaveProducts: (
      rows: {
        key: string
        id: number | null
        kodeItem: string
        barcode: string | null
        namaItem: string
        kategori: string | null
        satuan: string
        hargaPokok: number
        hargaJual: number
        stok: number
      }[],
    ) => invoke('inventory:bulkSaveProducts', rows),
    importProducts: () => invoke('inventory:importProducts'),
  },
  supplier: {
    listSuppliers: (input: { search?: string; page: number; pageSize?: number }) =>
      invoke('supplier:listSuppliers', input),
    createSupplier: (input: { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null }) =>
      invoke('supplier:createSupplier', input),
    updateSupplier: (
      id: number,
      input: { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null },
    ) => invoke('supplier:updateSupplier', id, input),
    deleteSupplier: (id: number) => invoke('supplier:deleteSupplier', id),
  },
  purchase: {
    recordPurchase: (input: {
      supplierId: number | null
      tanggal: string
      catatan: string | null
      items: { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }[]
    }) => invoke('purchase:recordPurchase', input),
    listPurchases: (input: { page: number; pageSize?: number }) => invoke('purchase:listPurchases', input),
    searchProducts: (q: string) => invoke('purchase:searchProducts', q),
  },
}

contextBridge.exposeInMainWorld('api', api)
