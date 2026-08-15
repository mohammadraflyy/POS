/// <reference types="vite/client" />

import type { AuthUser, UserRole } from './types'

declare global {
  interface Window {
    api: {
      auth: {
        login: (username: string, password: string) => Promise<AuthUser>
        logout: () => Promise<void>
        me: () => Promise<AuthUser | null>
      }
      users: {
        list: () => Promise<{ id: number; username: string; name: string; role: UserRole; createdAt: string }[]>
        create: (input: { username: string; name: string; password: string; role: UserRole }) => Promise<number>
        update: (id: number, input: { name: string; role: UserRole; password: string | null }) => Promise<void>
        delete: (id: number) => Promise<void>
      }
      kasir: {
        listProducts: () => Promise<
          {
            id: number
            kodeItem: string
            barcode: string | null
            namaItem: string
            satuan: string
            hargaJual: number
            stok: number
            baseProductUnitId: number
            productUnits: { id: number; satuan: string; konversi: number; hargaJual: number }[]
            priceTiers: { productUnitId: number; minQty: number; maxQty: number | null; hargaJual: number }[]
          }[]
        >
        listCustomers: () => Promise<string[]>
        listSalesToday: () => Promise<
          {
            id: number
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
            items: { productId: number; qty: number; satuan: string | null; hargaJual: number; subtotal: number }[]
          }[]
        >
        checkout: (input: {
          metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
          namaPelanggan: string | null
          dibayar: number | null
          items: { productId: number; productUnitId: number | null; qty: number }[]
        }) => Promise<{
          saleId: number
          total: number
          dibayar: number
          metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
          namaPelanggan: string | null
          createdAt: string
          kasirName: string | null
          items: { namaItem: string; qty: number; satuan: string | null; hargaJual: number; subtotal: number }[]
        }>
        cancelSale: (saleId: number) => Promise<void>
        deleteSale: (saleId: number) => Promise<void>
        getStoreSettings: () => Promise<{
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
          printerName: string | null
          receiptWidth: '58mm' | '80mm'
        }>
        printReceipt: (saleId: number) => Promise<void>
        listPrinters: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>
        testPrint: () => Promise<void>
        listSalesHistory: (filters: {
          dari?: string
          sampai?: string
          status?: 'selesai' | 'dibatalkan'
          metodePembayaran?: 'tunai' | 'bon' | 'qris' | 'transfer'
          search?: string
          page: number
        }) => Promise<{
          data: {
            id: number
            createdAt: string
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
            items: { namaItem: string; qty: number }[]
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
        getSaleDetail: (saleId: number) => Promise<{
          id: number
          namaPelanggan: string | null
          metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
          status: 'selesai' | 'dibatalkan'
          total: number
          dibayar: number
          createdAt: string
          items: { id: number; qty: number; satuan: string | null; namaItem: string }[]
          bonPayments: { id: number; jumlah: number; tanggal: string; keterangan: string | null }[]
        }>
        recordBonPayment: (input: { saleId: number; jumlah: number; keterangan: string | null }) => Promise<void>
        updateStoreSettings: (input: {
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
          printerName: string | null
          receiptWidth: '58mm' | '80mm'
        }) => Promise<void>
        purgeSalesBefore: (before: string) => Promise<{ deleted: number }>
        purgeTodaySales: () => Promise<{ deleted: number; skipped: number }>
      }
      inventory: {
        listProducts: (input: { search?: string; page: number; pageSize?: number }) => Promise<{
          data: {
            id: number
            kodeItem: string
            barcode: string | null
            namaItem: string
            categoryName: string | null
            satuan: string
            hargaPokok: number
            hargaJual: number
            stok: number
            isActive: boolean
            unitsCount: number
            priceTiersCount: number
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
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
        ) => Promise<void>
        deleteProduct: (id: number) => Promise<void>
        bulkDeleteProducts: (ids: number[]) => Promise<{ deleted: number; blocked: string[] }>
        searchProducts: (q: string) => Promise<
          {
            id: number
            kodeItem: string
            barcode: string | null
            namaItem: string
            categoryName: string | null
            satuan: string
            hargaPokok: number
            hargaJual: number
            stok: number
            isActive: boolean
            unitsCount: number
            priceTiersCount: number
          }[]
        >
        findByBarcode: (barcode: string) => Promise<{
          id: number
          kodeItem: string
          barcode: string | null
          namaItem: string
          categoryName: string | null
          satuan: string
          hargaPokok: number
          hargaJual: number
          stok: number
          isActive: boolean
          unitsCount: number
          priceTiersCount: number
        } | null>
        getProductDetail: (productId: number) => Promise<{
          namaItem: string
          kodeItem: string
          units: {
            id: number
            unitId: number
            satuan: string
            parentUnitId: number | null
            jumlahKemasan: number
            konversi: number
            hargaJual: number
            hargaPokok: number
            isBaseUnit: boolean
          }[]
          priceTiers: { id: number; productUnitId: number; minQty: number; maxQty: number | null; hargaJual: number }[]
          priceHistory: {
            id: number
            hargaPokokLama: number
            hargaPokokBaru: number
            hargaJualLama: number
            hargaJualBaru: number
            createdAt: string
            userName: string | null
          }[]
        }>
        addProductUnit: (
          productId: number,
          input: { unitId: number; jumlahKemasan: number; hargaJual: number; hargaPokok?: number; parentUnitId?: number | null },
        ) => Promise<void>
        updateProductUnit: (
          productId: number,
          unitRowId: number,
          input: { unitId: number; jumlahKemasan: number; hargaJual: number; hargaPokok?: number; parentUnitId?: number | null },
        ) => Promise<void>
        deleteProductUnit: (productId: number, unitId: number) => Promise<void>
        addPriceTier: (
          productId: number,
          input: { minQty: number; maxQty?: number | null; hargaJual: number; productUnitId?: number },
        ) => Promise<void>
        deletePriceTier: (productId: number, tierId: number) => Promise<void>
        getProductsByIds: (ids: number[]) => Promise<
          {
            id: number
            kodeItem: string
            barcode: string | null
            namaItem: string
            categoryName: string | null
            satuan: string
            hargaPokok: number
            hargaJual: number
            stok: number
            unitsCount: number
            priceTiersCount: number
          }[]
        >
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
        ) => Promise<
          | { success: true; created: number; updated: number; unchanged: number }
          | { success: false; rowErrors: Record<string, Record<string, string>> }
        >
        importProducts: () => Promise<{ created: number; updated: number; unchanged: number; skipped: number } | null>
        importSatuan: () => Promise<{
          produkDiperbarui: number
          satuanDitambahkan: number
          dilewatiTidakDitemukan: number
          dilewatiSatuanTidakCocok: number
          dilewatiRantaiTidakValid: number
        } | null>
      }
      supplier: {
        listSuppliers: (input: { search?: string; page: number; pageSize?: number }) => Promise<{
          data: {
            id: number
            nama: string
            telepon: string | null
            alamat: string | null
            keterangan: string | null
            purchaseCount: number
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
        createSupplier: (input: {
          nama: string
          telepon: string | null
          alamat: string | null
          keterangan: string | null
        }) => Promise<number>
        updateSupplier: (
          id: number,
          input: { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null },
        ) => Promise<void>
        deleteSupplier: (id: number) => Promise<void>
      }
      purchase: {
        recordPurchase: (input: {
          supplierId: number | null
          tanggal: string
          catatan: string | null
          items: { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }[]
          dibayar?: number | null
        }) => Promise<{ purchaseId: number }>
        listPurchases: (input: { page: number; pageSize?: number }) => Promise<{
          data: {
            id: number
            tanggal: string
            total: number
            dibayar: number
            sisa: number
            catatan: string | null
            supplierName: string | null
            itemSummary: string
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
        listSupplierDebts: (supplierId?: number | null) => Promise<
          {
            purchaseId: number
            supplierId: number | null
            supplierName: string | null
            tanggal: string
            total: number
            dibayar: number
            sisa: number
          }[]
        >
        recordSupplierPayment: (input: {
          supplierId: number
          jumlah: number
          tanggal: string
          keterangan: string | null
        }) => Promise<{ alokasi: { purchaseId: number; jumlah: number }[] }>
        listSupplierPayments: (supplierId: number) => Promise<
          { id: number; purchaseId: number; jumlah: number; tanggal: string; keterangan: string | null }[]
        >
        searchProducts: (q: string) => Promise<
          {
            id: number
            kodeItem: string
            namaItem: string
            satuan: string
            hargaPokok: number
            units: { id: number; level: number; satuan: string; konversi: number }[]
          }[]
        >
        findProductByBarcode: (barcode: string) => Promise<{
          id: number
          kodeItem: string
          namaItem: string
          satuan: string
          hargaPokok: number
          units: { id: number; satuan: string; konversi: number }[]
        } | null>
      }
      expense: {
        recordExpense: (input: {
          tanggal: string
          kategori: string
          jumlah: number
          keterangan: string | null
        }) => Promise<{ expenseId: number }>
        listExpenses: (input: { from?: string; to?: string; page: number; pageSize?: number }) => Promise<{
          data: {
            id: number
            tanggal: string
            kategori: string
            jumlah: number
            keterangan: string | null
            userName: string | null
          }[]
          currentPage: number
          lastPage: number
          total: number
          totalJumlah: number
        }>
        deleteExpense: (id: number) => Promise<void>
      }
      stockOpname: {
        listCategories: () => Promise<{ id: number; nama: string }[]>
        searchProducts: (input: { q: string; categoryIds: number[] }) => Promise<
          {
            id: number
            kodeItem: string
            barcode: string | null
            namaItem: string
            categoryName: string | null
            satuan: string
            stok: number
          }[]
        >
        recordAdjustment: (input: { productId: number; stokSesudah: number; alasan: string | null }) => Promise<{ id: number }>
      }
      rekap: {
        getRekap: (input: { from: string; to: string }) => Promise<{
          summary: {
            omzetTunai: number
            omzetNonTunai: number
            piutangBeredar: number
            jumlahTransaksi: number
            labaKotor: number
          }
          labaPerKategori: { categoryName: string; omzet: number; laba: number }[]
          labaPerHari: { tanggal: string; omzet: number; laba: number }[]
          labaPerSatuan: { satuan: string; qtyTerjual: number; omzet: number; laba: number; marginPersen: number }[]
          produkTerlaris: { namaItem: string; qtyTerjual: number; totalPenjualan: number }[]
          pembelianPerSupplier: { supplierName: string; totalPembelian: number }[]
          stockValue: {
            totalNilai: number
            produk: { namaItem: string; kodeItem: string; satuan: string; stok: number; hargaPokok: number; nilai: number }[]
          }
          salesHistory: {
            id: number
            createdAt: string
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
          }[]
        }>
        exportExcel: (input: { from: string; to: string }) => Promise<string | null>
      }
      dashboard: {
        getDashboard: () => Promise<{
          summary: {
            omzetTunai: number
            omzetNonTunai: number
            piutangBeredar: number
            jumlahTransaksi: number
            labaKotor: number
          }
          stokMenipis: { id: number; kodeItem: string; namaItem: string; satuan: string; stok: number }[]
          produkTerlarisHariIni: { namaItem: string; qtyTerjual: number; totalPenjualan: number }[]
          transaksiTerbaru: {
            id: number
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
            createdAt: string
            itemSummary: string
          }[]
        }>
      }
      masterSatuan: {
        list: () => Promise<{ id: number; code: string; name: string; symbol: string; isActive: boolean }[]>
        create: (input: { code: string; name: string; symbol: string }) => Promise<void>
        update: (id: number, input: { code: string; name: string; symbol: string; isActive: boolean }) => Promise<void>
        deactivate: (id: number) => Promise<void>
      }
    }
  }
}

export {}
