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
        getStoreSettings: () => Promise<{
          namaToko: string
          alamat: string | null
          telepon: string | null
          pesanFooter: string | null
        }>
        printReceipt: () => Promise<void>
        getReceiptForSale: (saleId: number) => Promise<{
          saleId: number
          total: number
          dibayar: number
          metodePembayaran: 'tunai' | 'bon'
          namaPelanggan: string | null
          createdAt: string
          kasirName: string | null
          items: { namaItem: string; qty: number; satuan: string | null; hargaJual: number; subtotal: number }[]
        }>
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
      }
    }
  }
}

export {}
