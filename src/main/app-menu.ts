import { is } from '@electron-toolkit/utils'
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

import {
  commandChord,
  COMMANDS,
  findCommand,
  type CommandDefinition,
  type ShortcutOverrides
} from '@shared/commands'
import { IPC_CHANNELS } from '@shared/ipc'
import { chordToAccelerator } from '@shared/shortcuts'

const APP_NAME = 'SIEVER Mail'

let getWindow: (() => BrowserWindow | null) | null = null
let overrides: ShortcutOverrides = {}

/**
 * The menu bar, in Italian, on macOS — where every app has one and where
 * copy and paste only work through its Edit roles. Windows and Linux get
 * none: the window draws its own title bar there, and Electron's default
 * menu would only bring English labels, a reload shortcut and the
 * developer tools along.
 *
 * Every command of the app is listed with the chord it answers to — the
 * user's own, from Settings › Scorciatoie. The chords are shown but not
 * registered, so pressing one reaches the page the same way on every
 * platform; choosing the item sends the same command.
 */
export function installAppMenu(getMainWindow: () => BrowserWindow | null): void {
  getWindow = getMainWindow
  buildMenu()
}

/** Rebuilds the menu when the user changes a chord. */
export function updateAppMenuShortcuts(next: ShortcutOverrides): void {
  if (JSON.stringify(next) === JSON.stringify(overrides)) {
    return
  }

  overrides = next
  buildMenu()
}

function sendCommand(id: string): void {
  const window = getWindow?.()

  if (window && !window.isDestroyed()) {
    window.show()
    window.webContents.send(IPC_CHANNELS.appMenuCommand, id)
  }
}

function commandItem(command: CommandDefinition): MenuItemConstructorOptions {
  const accelerator = chordToAccelerator(commandChord(command, overrides)) ?? undefined

  return {
    label: command.label,
    accelerator,
    registerAccelerator: false,
    click: () => sendCommand(command.id)
  }
}

function item(id: string): MenuItemConstructorOptions {
  const command = findCommand(id)

  if (!command) {
    throw new Error(`Comando sconosciuto: ${id}`)
  }

  return commandItem(command)
}

function buildMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  if (!getWindow) {
    return
  }

  // The extension's commands act on the selection, as the message commands do.
  const extensionCommands = COMMANDS.filter((command) => command.fromExtension).map(commandItem)

  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `Informazioni su ${APP_NAME}` },
        { type: 'separator' },
        { ...item('settings'), label: 'Impostazioni…' },
        { type: 'separator' },
        { role: 'services', label: 'Servizi' },
        { type: 'separator' },
        { role: 'hide', label: `Nascondi ${APP_NAME}` },
        { role: 'hideOthers', label: 'Nascondi altre' },
        { role: 'unhide', label: 'Mostra tutte' },
        { type: 'separator' },
        { role: 'quit', label: `Esci da ${APP_NAME}` }
      ]
    },
    {
      label: 'File',
      submenu: [
        item('compose'),
        { type: 'separator' },
        item('check-mail'),
        { type: 'separator' },
        { role: 'close', label: 'Chiudi finestra' }
      ]
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'pasteAndMatchStyle', label: 'Incolla e adatta stile' },
        { role: 'delete', label: 'Elimina' },
        { role: 'selectAll', label: 'Seleziona tutto' },
        { type: 'separator' },
        item('search')
      ]
    },
    {
      label: 'Messaggio',
      submenu: [
        item('reply'),
        item('reply-all'),
        item('forward'),
        { type: 'separator' },
        item('archive'),
        item('move'),
        ...extensionCommands,
        { type: 'separator' },
        item('toggle-read'),
        item('toggle-flag')
      ]
    },
    {
      label: 'Vista',
      submenu: [
        item('reader-zoom-in'),
        item('reader-zoom-out'),
        item('reader-zoom-reset'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
        ...(is.dev
          ? ([
              { type: 'separator' },
              { role: 'reload', label: 'Ricarica' },
              { role: 'toggleDevTools', label: 'Strumenti per sviluppatori' }
            ] satisfies MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      label: 'Finestra',
      submenu: [
        { role: 'minimize', label: 'Riduci a icona' },
        { role: 'zoom', label: 'Ridimensiona' },
        { type: 'separator' },
        { role: 'front', label: 'Porta tutto in primo piano' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
