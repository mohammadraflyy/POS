import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { createDb } from './db/migrate'
import { registerAuthIpc } from './ipc/auth'
import { registerKasirIpc } from './ipc/kasir'
import { registerInventoryIpc } from './ipc/inventory'
import { registerSupplierIpc } from './ipc/supplier'
import { registerPurchaseIpc } from './ipc/purchase'
import { registerStockOpnameIpc } from './ipc/stock-opname'
import { registerRekapIpc } from './ipc/rekap'

let mainWindow: BrowserWindow | null
let db: ReturnType<typeof createDb> | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function getDbPath(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'pos.sqlite')
  }
  return join(__dirname, '../../dev.sqlite')
}

function getMigrationsFolder(): string {
  return join(__dirname, '../../drizzle')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  const isDev = !app.isPackaged
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

app.whenReady().then(() => {
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  registerKasirIpc(db)
  registerInventoryIpc(db)
  registerSupplierIpc(db)
  registerPurchaseIpc(db)
  registerStockOpnameIpc(db)
  registerRekapIpc(db)
  createWindow()
})

app.on('before-quit', () => {
  db?.$client?.close()
})
