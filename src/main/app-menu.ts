import { is } from '@electron-toolkit/utils'
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

import {
  commandChord,
  COMMANDS,
  findCommand,
  type CommandDefinition,
  type ShortcutOverrides
} from '@shared/commands'
import { defineMessages, localized } from '@shared/i18n'
import { IPC_CHANNELS } from '@shared/ipc'
import { chordToAccelerator } from '@shared/shortcuts'

import { PRODUCT_NAME } from './app-identity'
import { currentLanguage, messages } from './i18n'

const APP_NAME = PRODUCT_NAME

const MENU = defineMessages({
  about: {
    en: `About ${APP_NAME}`,
    it: `Informazioni su ${APP_NAME}`,
    de: `Über ${APP_NAME}`
  },
  settings: { en: 'Settings…', it: 'Impostazioni…', de: 'Einstellungen …' },
  services: { en: 'Services', it: 'Servizi', de: 'Dienste' },
  hide: { en: `Hide ${APP_NAME}`, it: `Nascondi ${APP_NAME}`, de: `${APP_NAME} ausblenden` },
  hideOthers: { en: 'Hide Others', it: 'Nascondi altre', de: 'Andere ausblenden' },
  unhide: { en: 'Show All', it: 'Mostra tutte', de: 'Alle einblenden' },
  quit: { en: `Quit ${APP_NAME}`, it: `Esci da ${APP_NAME}`, de: `${APP_NAME} beenden` },
  file: { en: 'File', it: 'File', de: 'Ablage' },
  closeWindow: { en: 'Close Window', it: 'Chiudi finestra', de: 'Fenster schließen' },
  edit: { en: 'Edit', it: 'Modifica', de: 'Bearbeiten' },
  undo: { en: 'Undo', it: 'Annulla', de: 'Widerrufen' },
  redo: { en: 'Redo', it: 'Ripeti', de: 'Wiederholen' },
  cut: { en: 'Cut', it: 'Taglia', de: 'Ausschneiden' },
  copy: { en: 'Copy', it: 'Copia', de: 'Kopieren' },
  paste: { en: 'Paste', it: 'Incolla', de: 'Einsetzen' },
  pasteAndMatchStyle: {
    en: 'Paste and Match Style',
    it: 'Incolla e adatta stile',
    de: 'Einsetzen und Stil anpassen'
  },
  delete: { en: 'Delete', it: 'Elimina', de: 'Löschen' },
  selectAll: { en: 'Select All', it: 'Seleziona tutto', de: 'Alles auswählen' },
  message: { en: 'Message', it: 'Messaggio', de: 'Nachricht' },
  view: { en: 'View', it: 'Vista', de: 'Darstellung' },
  fullScreen: { en: 'Enter Full Screen', it: 'Schermo intero', de: 'Vollbildmodus' },
  reload: { en: 'Reload', it: 'Ricarica', de: 'Neu laden' },
  devTools: {
    en: 'Developer Tools',
    it: 'Strumenti per sviluppatori',
    de: 'Entwicklerwerkzeuge'
  },
  window: { en: 'Window', it: 'Finestra', de: 'Fenster' },
  minimize: { en: 'Minimize', it: 'Riduci a icona', de: 'Im Dock ablegen' },
  zoom: { en: 'Zoom', it: 'Ridimensiona', de: 'Zoomen' },
  front: {
    en: 'Bring All to Front',
    it: 'Porta tutto in primo piano',
    de: 'Alle nach vorne bringen'
  }
})

let getWindow: (() => BrowserWindow | null) | null = null
let overrides: ShortcutOverrides = {}
/** With the AI off, the Segretario is nowhere: not in the menu either. */
let aiOn = false

/**
 * The menu bar, in the interface's language, on macOS — where every app has one and where
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

/** Rebuilds the menu in the interface's language, when it changes. */
export function refreshAppMenu(): void {
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

/** Rebuilds the menu when the AI goes on or off: the switch up and a key given. */
export function updateAppMenuAi(on: boolean): void {
  if (on === aiOn) {
    return
  }

  aiOn = on
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
    label: localized(command.label, currentLanguage()),
    accelerator,
    registerAccelerator: false,
    click: () => sendCommand(command.id)
  }
}

function item(id: string): MenuItemConstructorOptions {
  const command = findCommand(id)

  if (!command) {
    throw new Error(`Unknown command: ${id}`)
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

  const m = messages(MENU)
  // The extension's commands act on the selection, as the message commands do.
  const extensionCommands = COMMANDS.filter((command) => command.fromExtension).map(commandItem)

  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: m.about },
        { type: 'separator' },
        { ...item('settings'), label: m.settings },
        { type: 'separator' },
        { role: 'services', label: m.services },
        { type: 'separator' },
        { role: 'hide', label: m.hide },
        { role: 'hideOthers', label: m.hideOthers },
        { role: 'unhide', label: m.unhide },
        { type: 'separator' },
        { role: 'quit', label: m.quit }
      ]
    },
    {
      label: m.file,
      submenu: [
        item('compose'),
        { type: 'separator' },
        item('check-mail'),
        { type: 'separator' },
        { role: 'close', label: m.closeWindow }
      ]
    },
    {
      label: m.edit,
      submenu: [
        { role: 'undo', label: m.undo },
        { role: 'redo', label: m.redo },
        { type: 'separator' },
        { role: 'cut', label: m.cut },
        { role: 'copy', label: m.copy },
        { role: 'paste', label: m.paste },
        { role: 'pasteAndMatchStyle', label: m.pasteAndMatchStyle },
        { role: 'delete', label: m.delete },
        { role: 'selectAll', label: m.selectAll },
        { type: 'separator' },
        item('search')
      ]
    },
    {
      label: m.message,
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
      label: m.view,
      submenu: [
        ...(aiOn ? [item('segretario'), { type: 'separator' as const }] : []),
        item('reader-zoom-in'),
        item('reader-zoom-out'),
        item('reader-zoom-reset'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: m.fullScreen },
        ...(is.dev
          ? ([
              { type: 'separator' },
              { role: 'reload', label: m.reload },
              { role: 'toggleDevTools', label: m.devTools }
            ] satisfies MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      label: m.window,
      submenu: [
        { role: 'minimize', label: m.minimize },
        { role: 'zoom', label: m.zoom },
        { type: 'separator' },
        { role: 'front', label: m.front }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
