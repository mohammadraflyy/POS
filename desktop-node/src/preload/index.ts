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
  },
}

contextBridge.exposeInMainWorld('api', api)
