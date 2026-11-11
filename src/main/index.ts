import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { rm, rmdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, Menu, Tray, nativeImage, powerMonitor, session, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'
import { IPC_CHANNELS } from '@shared/ipc'

import extensionMain from '@app/extension/main'
import extensionShared from '@app/extension/shared'

import { APP_ID } from './app-identity'
import { setAppWindow } from './app-window'
import { loadRuntimeConfig } from './config/env'
import { installAppMenu } from './app-menu'
import { installContextMenus } from './context-menu'
import { registerMailIpc } from './ipc/register-mail-ipc'
import { registerCalendarIpc } from './ipc/register-calendar-ipc'
import { registerFilesIpc } from './ipc/register-files-ipc'
import { registerSegretarioIpc } from './ipc/register-segretario-ipc'
import { registerDiagnosticsIpc } from './ipc/register-diagnostics-ipc'
import { registerNotificationsIpc } from './ipc/register-notifications-ipc'
import { prepareUpgradeMigration } from './services/data-migration'
import { normalizeExternalHttpUrl } from './utils/external-url'
import { profileKind, systemLine } from '@main/diagnostics/app-state'
import { diagnostics, flushDiagnostics, startDiagnostics } from '@main/diagnostics/log'
import { Workspace } from './workspace'
import {
  applyStoredThemeMode,
  followThemeWithWindowBackgrounds,
  windowBackgroundColor
} from './theme'

import icon from '../../resources/icon.png?asset'

const log = diagnostics('app')
const pageLog = diagnostics('ui')

const dotenvPath = is.dev ? join(process.cwd(), '.env') : join(process.resourcesPath, '.env')

if (existsSync(dotenvPath)) {
  loadDotenv({ path: dotenvPath })
}

// Input the main process turns down is described in the app's language.
z.config(z.locales.it())

// An error no part caught is written down and the rest goes on: one part failing neither takes
// the app down nor goes unsaid (§14.3).
process.on('uncaughtException', (error) =>
  log.error('Uncaught exception in the main process', error)
)
process.on('unhandledRejection', (reason) =>
  log.error('Unhandled rejection in the main process', reason)
)

/** The page comes back by itself once a minute at most: one that keeps dying is not reloaded in a loop. */
const PAGE_RELOAD_EVERY_MS = 60_000

// Development keeps a profile of its own beside the installed app's: the schema only moves
// forward, so a build in development would carry the installed one's data where that build cannot
// follow; and the single-instance lock is a profile's, so the two run side by side. A profile given
// on the command line — the studio di prova's — is kept as given.
if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), `${app.getName()}-dev`))
}

let mainWindow: BrowserWindow | null = null
let appWorkspace: Workspace | null = null
let appTray: Tray | null = null
let isQuitting = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  // The diagnostics start before anything else, in this profile's folder (§14.4, §15.3): what
  // happened before — an error at load — is written first.
  startDiagnostics({ folder: join(app.getPath('userData'), 'diagnostica'), echo: is.dev })
  log.info('app.start', {
    version: app.getVersion(),
    edition: extensionShared.identity?.id ?? 'public',
    profile: profileKind(),
    os: systemLine(),
    electron: process.versions.electron
  })

  // The system's log folder goes by the app's name, not its profile: development and the studio
  // share it with the installed app, whose file is the installed app's alone to let go.
  if (profileKind() === 'installed') {
    void forgetOldLog()
  }
}

/**
 * The log the versions before 2.0 kept in the system's log folder: the
 * diagnostics took its place, and it would only stay there, old.
 */
async function forgetOldLog(): Promise<void> {
  const folder = app.getPath('logs')

  try {
    await Promise.all(
      ['main.log', 'main.previous.log'].map((name) => rm(join(folder, name), { force: true }))
    )
    await rmdir(folder)
  } catch {
    // Not there, or not empty: nothing of the app's is left to take.
  }
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
      label: 'Esci',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  return tray
}

const RENDERER_ENTRY_PATH = join(__dirname, '../renderer/index.html')
/**
 * How long quitting waits for the workspace to stop — the drafts being typed
 * saved, the Segretario's work put back to wait, the database closed —
 * before it quits anyway.
 */
const QUIT_WAIT_MS = 8_000

/**
 * The web permissions the app's page uses: writing to the clipboard
 * (Copia indirizzo). Electron grants every permission unless told
 * otherwise; a message never runs scripts, but nothing in the window
 * should reach the camera, the microphone or the location.
 */
const GRANTED_WEB_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

function restrictWebPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(GRANTED_WEB_PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    GRANTED_WEB_PERMISSIONS.has(permission)
  )
}

/** What a frame inside the page may hold: the document the app wrote into it. */
const SUBFRAME_DOCUMENT_URLS: ReadonlySet<string> = new Set(['about:srcdoc', 'about:blank'])

/**
 * The window only ever shows the app's own page. Any other file — one
 * dropped on the window, a `file:` link in a message — would replace the
 * whole interface with it.
 */
function isAllowedNavigation(urlString: string): boolean {
  try {
    const url = new URL(urlString)

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return url.origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    }

    url.hash = ''
    return url.href === pathToFileURL(RENDERER_ENTRY_PATH).href
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
    backgroundColor: windowBackgroundColor(),
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

  // The frames inside the page — a message being read or written — show the
  // document the app gave them and nothing else: a refresh, a form or a link
  // inside a message never takes the frame somewhere. Links open in the
  // browser through the reader instead.
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !SUBFRAME_DOCUMENT_URLS.has(event.url)) {
      event.preventDefault()
    }
  })

  installContextMenus(window)

  // What goes wrong in the page is written in the same log as the rest (§14.3): what it records
  // itself, and what it only prints.
  // Only the app's own page: a message shown in its frame prints what it could not load — the
  // addresses of its pictures, its trackers —, which is the message's, not the app's.
  window.webContents.on('console-message', ({ level, message, sourceId, lineNumber, frame }) => {
    if (level === 'error' && frame === window.webContents.mainFrame) {
      pageLog.error('console', undefined, { text: message, source: `${sourceId}:${lineNumber}` })
    }
  })
  // When the window is in front: the time spent before the app, which it exists to cut (§0).
  window.on('focus', () => pageLog.info('window.focus'))
  window.on('blur', () => pageLog.info('window.blur'))
  window.on('show', () => pageLog.info('window.show'))
  window.on('hide', () => pageLog.info('window.hide'))

  // The page died — a crash, out of memory: written down, and loaded again rather than left white;
  // one that keeps dying, a minute after the last time.
  let reloadedAt = 0
  let reloadTimer: NodeJS.Timeout | null = null
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('The window page went away', details.reason, {
      reason: details.reason,
      exitCode: details.exitCode
    })

    if (details.reason === 'clean-exit' || reloadTimer) {
      return
    }

    reloadTimer = setTimeout(
      () => {
        reloadTimer = null

        if (!window.isDestroyed()) {
          reloadedAt = Date.now()
          window.webContents.reload()
        }
      },
      Math.max(0, reloadedAt + PAGE_RELOAD_EVERY_MS - Date.now())
    )
  })

  // What only the page can draw — the Windows taskbar badge — is drawn anew
  // each time it loads.
  window.webContents.on('did-finish-load', () => appWorkspace?.windowLoaded())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(RENDERER_ENTRY_PATH)
  }

  setAppWindow(window)
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
    restrictWebPermissions()
    applyStoredThemeMode()
    followThemeWithWindowBackgrounds()
    electronApp.setAppUserModelId(APP_ID)

    if (process.platform === 'darwin') {
      app.dock?.setIcon(icon)
    }

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // The screen locked: nobody is at the window; unlocked with it in front, someone is (§14.4).
    powerMonitor.on('lock-screen', () => log.info('system.lock'))
    powerMonitor.on('unlock-screen', () => {
      log.info('system.unlock')

      if (mainWindow?.isFocused()) {
        pageLog.info('window.focus')
      }
    })

    prepareUpgradeMigration()

    const workspace = new Workspace(loadRuntimeConfig())
    appWorkspace = workspace

    void workspace.start(extensionMain)

    registerMailIpc(workspace, () => mainWindow)
    registerSegretarioIpc(workspace.segretario, () => workspace.forgetSegretario())
    registerFilesIpc()
    registerDiagnosticsIpc(
      () => workspace.diagnosticsSource(),
      () => mainWindow
    )
    registerNotificationsIpc(workspace)
    registerCalendarIpc(
      workspace.calendar,
      {
        of: (ref) => workspace.calendarInvitation(ref),
        respondByMail: (ref, response) => workspace.mail.respondToInvitationByMail(ref, response)
      },
      () => workspace.calendar.whenOpen()
    )
    installAppMenu(() => mainWindow)

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

app.on('before-quit', (event) => {
  isQuitting = true
  appTray?.destroy()
  appTray = null
  const shuttingDown = appWorkspace

  if (!shuttingDown) {
    return
  }

  // Electron would quit as soon as the windows close: it waits for the workspace to stop, then
  // quits again — with nothing left to wait for.
  appWorkspace = null
  event.preventDefault()
  log.info('app.quit', { uptimeMs: Math.round(process.uptime() * 1000) })
  void Promise.race([
    shuttingDown.stop(),
    new Promise<void>((resolve) => setTimeout(resolve, QUIT_WAIT_MS))
  ]).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  return
})

// The last lines written before the process goes: what the stop said included.
app.on('will-quit', () => flushDiagnostics())
