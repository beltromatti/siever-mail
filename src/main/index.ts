import { join } from 'node:path'
import { existsSync } from 'node:fs'

import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { config as loadDotenv } from 'dotenv'
import { IPC_CHANNELS } from '@shared/ipc'

import extensionMain from '@app/extension/main'

import { loadRuntimeConfig } from './config/env'
import { registerMailIpc } from './ipc/register-mail-ipc'
import { prepareUpgradeMigration, restoreUpgradeStashIfNeeded } from './services/data-migration'
import { MailService } from './services/mail-service'
import { normalizeExternalHttpUrl } from './utils/external-url'

import icon from '../../resources/icon.png?asset'

const dotenvPath = is.dev ? join(process.cwd(), '.env') : join(process.resourcesPath, '.env')

if (existsSync(dotenvPath)) {
  loadDotenv({ path: dotenvPath })
}

let mainWindow: BrowserWindow | null = null
let mailService: MailService | null = null
let appTray: Tray | null = null
let isQuitting = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function createTray(): Tray {
  const trayImage = nativeImage.createFromPath(icon).resize({
    width: process.platform === 'darwin' ? 22 : 20,
    height: process.platform === 'darwin' ? 22 : 20
  })

  const tray = new Tray(trayImage)

  tray.setToolTip('SIEVER Mail')
  tray.on('click', () => {
    showMainWindow()
  })

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Apri SIEVER Mail',
      click: () => showMainWindow()
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  return tray
}

function isAllowedNavigation(urlString: string): boolean {
  try {
    const url = new URL(urlString)

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const devUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
      if (url.origin === devUrl.origin) {
        return true
      }
    }

    return url.protocol === 'file:'
  } catch {
    return false
  }
}

function createMainWindow(): BrowserWindow {
  const isWindows = process.platform === 'win32'
  const hasCustomTopDragRegion = isWindows || process.platform === 'darwin'
  const window = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1180,
    minHeight: 700,
    show: false,
    frame: !isWindows,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#070b14',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      backgroundThrottling: false
    }
  })

  const emitWindowControlsState = (): void => {
    if (window.isDestroyed()) {
      return
    }

    window.webContents.send(IPC_CHANNELS.windowControlsStateChanged, {
      enabled: isWindows,
      maximized: window.isMaximized(),
      dragTopRegionEnabled: hasCustomTopDragRegion
    })
  }

  window.on('ready-to-show', () => {
    window.show()
    emitWindowControlsState()
  })

  window.on('maximize', emitWindowControlsState)
  window.on('unmaximize', emitWindowControlsState)

  window.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    window.hide()
  })

  window.webContents.setWindowOpenHandler((details) => {
    const safeExternalUrl = normalizeExternalHttpUrl(details.url)
    if (safeExternalUrl) {
      void shell.openExternal(safeExternalUrl)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedNavigation(navigationUrl)) {
      event.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.on('second-instance', () => {
  const showExistingWindow = (): void => {
    showMainWindow()
  }

  if (app.isReady()) {
    showExistingWindow()
    return
  }

  void app.whenReady().then(showExistingWindow)
})

if (hasSingleInstanceLock) {
  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.siever.siever-mail')

    if (process.platform === 'darwin') {
      app.dock?.setIcon(icon)
    }

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    prepareUpgradeMigration()

    mailService = new MailService(loadRuntimeConfig())
    void mailService
      .start()
      .then(() => {
        restoreUpgradeStashIfNeeded()
        return mailService?.installExtension(extensionMain)
      })
      .then(() => {
        if (extensionMain.id !== 'noop') {
          console.info(
            `[extension] installed "${extensionMain.displayName}" (id="${extensionMain.id}")`
          )
        }
      })
      .catch((error) => {
        console.error('[extension] install failed', error)
      })

    registerMailIpc(mailService, () => mainWindow)

    mainWindow = createMainWindow()
    appTray = createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
        return
      }

      showMainWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
  appTray?.destroy()
  appTray = null
  const shuttingDown = mailService
  mailService = null
  void shuttingDown?.stop()
})

app.on('window-all-closed', () => {
  return
})
