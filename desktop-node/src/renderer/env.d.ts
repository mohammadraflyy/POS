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
            namaItem: string
            satuan: string
            hargaJual: number
            stok: number
            productUnits: { id: number; satuan: string; konversi: number; hargaJual: number }[]
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
          }[]
        >
        checkout: (input: {
          metodePembayaran: 'tunai' | 'bon'
          namaPelanggan: string | null
          dibayar: number | null
          items: { productId: number; productUnitId: number | null; qty: number }[]
        }) => Promise<{ saleId: number; total: number }>
        cancelSale: (saleId: number) => Promise<void>
      }
    }
  }
}

export {}
