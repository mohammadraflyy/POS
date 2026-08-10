/// <reference types="vite/client" />

import type { AuthUser } from './types'

declare global {
  interface Window {
    api: {
      auth: {
        login: (username: string, password: string) => Promise<AuthUser>
        logout: () => Promise<void>
        me: () => Promise<AuthUser | null>
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
            productUnits: { id: number; satuan: string; konversi: number; hargaJual: number }[]
            priceTiers: { minQty: number; hargaJual: number }[]
          }[]
        >
        listSalesToday: () => Promise<
          {
            id: number
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
            items: { productId: number; qty: number; satuan: string | null; hargaJual: number; subtotal: number }[]
          }[]
        >
        checkout: (input: {
          metodePembayaran: 'tunai' | 'bon'
          namaPelanggan: string | null
          dibayar: number | null
          items: { productId: number; productUnitId: number | null; qty: number }[]
        }) => Promise<{
          saleId: number
          total: number
          dibayar: number
          metodePembayaran: 'tunai' | 'bon'
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
          metodePembayaran?: 'tunai' | 'bon'
          search?: string
          page: number
        }) => Promise<{
          data: {
            id: number
            createdAt: string
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon'
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
          metodePembayaran: 'tunai' | 'bon'
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
        getProductDetail: (productId: number) => Promise<{
          units: { id: number; satuan: string; jumlahKemasan: number; konversi: number; hargaJual: number }[]
          priceTiers: { id: number; minQty: number; hargaJual: number }[]
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
        addProductUnit: (productId: number, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) => Promise<void>
        updateProductUnit: (
          productId: number,
          unitId: number,
          input: { satuan: string; jumlahKemasan: number; hargaJual: number },
        ) => Promise<void>
        deleteProductUnit: (productId: number, unitId: number) => Promise<void>
        addPriceTier: (productId: number, input: { minQty: number; hargaJual: number }) => Promise<void>
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
        }) => Promise<{ purchaseId: number }>
        listPurchases: (input: { page: number; pageSize?: number }) => Promise<{
          data: {
            id: number
            tanggal: string
            total: number
            catatan: string | null
            supplierName: string | null
            itemSummary: string
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
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
            piutangBeredar: number
            jumlahTransaksi: number
            labaKotor: number
          }
          labaPerKategori: { categoryName: string; omzet: number; laba: number }[]
          labaPerHari: { tanggal: string; omzet: number; laba: number }[]
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
            metodePembayaran: 'tunai' | 'bon'
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
            piutangBeredar: number
            jumlahTransaksi: number
            labaKotor: number
          }
          stokMenipis: { id: number; kodeItem: string; namaItem: string; satuan: string; stok: number }[]
          produkTerlarisHariIni: { namaItem: string; qtyTerjual: number; totalPenjualan: number }[]
          transaksiTerbaru: {
            id: number
            namaPelanggan: string | null
            metodePembayaran: 'tunai' | 'bon'
            status: 'selesai' | 'dibatalkan'
            total: number
            dibayar: number
            createdAt: string
            itemSummary: string
          }[]
        }>
      }
    }
  }
}

export {}
