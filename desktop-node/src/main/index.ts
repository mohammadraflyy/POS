import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { createDb } from './db/migrate'
import { registerAuthIpc } from './ipc/auth'
import { registerKasirIpc } from './ipc/kasir'
import { registerInventoryIpc } from './ipc/inventory'
import { registerSupplierIpc } from './ipc/supplier'
import { registerPurchaseIpc } from './ipc/purchase'
import { registerStockOpnameIpc } from './ipc/stock-opname'
import { registerExpenseIpc } from './ipc/expense'
import { registerRekapIpc } from './ipc/rekap'
import { registerDashboardIpc } from './ipc/dashboard'
import { seedDefaultAdmin } from './db/seed'

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

/**
 * Caption buttons sit in the app's own 36px title bar row. The colours mirror
 * --sidebar / --foreground in the renderer theme, so the strip has to be
 * repainted whenever the cashier switches light/dark.
 */
function titleBarOverlayFor(isDark: boolean): { color: string; symbolColor: string; height: number } {
  return {
    color: isDark ? '#171717' : '#fafafa',
    symbolColor: isDark ? '#fafafa' : '#171717',
    height: 36
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayFor(true),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // The till runs on one screen all day, so it opens filling it. Maximising
    // before show() avoids a flash of the 1200x800 window, which stays as the
    // restore-down size.
    mainWindow?.maximize()
    mainWindow?.show()
  })

  const isDev = !app.isPackaged
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // The application menu is gone, and with it the View > Toggle Developer
  // Tools accelerator, so wire F12 back up for development.
  if (isDev) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow?.webContents.toggleDevTools()
      }
    })
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
  Menu.setApplicationMenu(null)
  ipcMain.on('app:titleBarTheme', (_event, isDark: boolean) => {
    mainWindow?.setTitleBarOverlay(titleBarOverlayFor(isDark))
  })
  db = createDb(getDbPath(), getMigrationsFolder())
  seedDefaultAdmin(db)
  registerAuthIpc(db)
  registerKasirIpc(db)
  registerInventoryIpc(db)
  registerSupplierIpc(db)
  registerPurchaseIpc(db)
  registerStockOpnameIpc(db)
  registerExpenseIpc(db)
  registerRekapIpc(db)
  registerDashboardIpc(db)
  createWindow()
})

app.on('before-quit', () => {
  db?.$client?.close()
})
