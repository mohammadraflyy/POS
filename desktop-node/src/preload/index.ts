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
  users: {
    list: () => invoke('users:list'),
    create: (input: { username: string; name: string; password: string; role: 'admin' | 'kasir' }) =>
      invoke('users:create', input),
    update: (id: number, input: { name: string; role: 'admin' | 'kasir'; password: string | null }) =>
      invoke('users:update', id, input),
    delete: (id: number) => invoke('users:delete', id),
  },
  kasir: {
    listProducts: () => invoke('kasir:listProducts'),
    listSalesToday: () => invoke('kasir:listSalesToday'),
    listCustomers: () => invoke<string[]>('kasir:listCustomers'),
    checkout: (input: {
      metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
      namaPelanggan: string | null
      dibayar: number | null
      items: { productId: number; productUnitId: number | null; qty: number }[]
    }) => invoke('kasir:checkout', input),
    cancelSale: (saleId: number) => invoke('kasir:cancelSale', saleId),
    deleteSale: (saleId: number) => invoke('kasir:deleteSale', saleId),
    getStoreSettings: () => invoke('kasir:getStoreSettings'),
    printReceipt: (saleId: number) => invoke('kasir:printReceipt', saleId),
    listPrinters: () => invoke('kasir:listPrinters'),
    testPrint: () => invoke('kasir:testPrint'),
    listSalesHistory: (filters: {
      dari?: string
      sampai?: string
      status?: 'selesai' | 'dibatalkan'
      metodePembayaran?: 'tunai' | 'bon' | 'qris' | 'transfer'
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
    purgeTodaySales: () => invoke('kasir:purgeTodaySales'),
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
    findByBarcode: (barcode: string) => invoke('inventory:findByBarcode', barcode),
    getProductDetail: (productId: number) => invoke('inventory:getProductDetail', productId),
    addProductUnit: (productId: number, input: { unitId: number; jumlahKemasan: number; hargaJual: number }) =>
      invoke('inventory:addProductUnit', productId, input),
    updateProductUnit: (
      productId: number,
      unitRowId: number,
      input: { unitId: number; jumlahKemasan: number; hargaJual: number },
    ) => invoke('inventory:updateProductUnit', productId, unitRowId, input),
    deleteProductUnit: (productId: number, unitId: number) => invoke('inventory:deleteProductUnit', productId, unitId),
    addPriceTier: (
      productId: number,
      input: { minQty: number; maxQty?: number | null; hargaJual: number; productUnitId?: number },
    ) => invoke('inventory:addPriceTier', productId, input),
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
    importSatuan: () => invoke('inventory:importSatuan'),
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
      dibayar?: number | null
    }) => invoke('purchase:recordPurchase', input),
    listPurchases: (input: { page: number; pageSize?: number }) => invoke('purchase:listPurchases', input),
    searchProducts: (q: string) => invoke('purchase:searchProducts', q),
    findProductByBarcode: (barcode: string) => invoke('purchase:findProductByBarcode', barcode),
    listSupplierDebts: (supplierId?: number | null) => invoke('purchase:listSupplierDebts', supplierId ?? null),
    recordSupplierPayment: (input: { supplierId: number; jumlah: number; tanggal: string; keterangan: string | null }) =>
      invoke('purchase:recordSupplierPayment', input),
    listSupplierPayments: (supplierId: number) => invoke('purchase:listSupplierPayments', supplierId),
  },
  expense: {
    recordExpense: (input: { tanggal: string; kategori: string; jumlah: number; keterangan: string | null }) =>
      invoke('expense:recordExpense', input),
    listExpenses: (input: { from?: string; to?: string; page: number; pageSize?: number }) =>
      invoke('expense:listExpenses', input),
    deleteExpense: (id: number) => invoke('expense:deleteExpense', id),
  },
  stockOpname: {
    listCategories: () => invoke('stock-opname:listCategories'),
    searchProducts: (input: { q: string; categoryIds: number[] }) => invoke('stock-opname:searchProducts', input),
    recordAdjustment: (input: { productId: number; stokSesudah: number; alasan: string | null }) =>
      invoke('stock-opname:recordAdjustment', input),
  },
  rekap: {
    getRekap: (input: { from: string; to: string }) => invoke('rekap:getRekap', input),
    exportExcel: (input: { from: string; to: string }) => invoke('rekap:exportExcel', input),
  },
  dashboard: {
    getDashboard: () => invoke('dashboard:getDashboard'),
  },
  masterSatuan: {
    list: () => invoke('master-satuan:list'),
    create: (input: { code: string; name: string; symbol: string }) => invoke('master-satuan:create', input),
    update: (id: number, input: { code: string; name: string; symbol: string; isActive: boolean }) =>
      invoke('master-satuan:update', id, input),
    deactivate: (id: number) => invoke('master-satuan:deactivate', id),
  },
}

contextBridge.exposeInMainWorld('api', api)
