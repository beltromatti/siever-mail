import { is } from '@electron-toolkit/utils'
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

import { IPC_CHANNELS } from '@shared/ipc'
import type { AppMenuCommand } from '@shared/models'

const APP_NAME = 'SIEVER Mail'

/**
 * The menu bar, in Italian, on macOS — where every app has one and where
 * copy and paste only work through its Edit roles. Windows and Linux get
 * none: the window draws its own title bar there, and Electron's default
 * menu would only bring English labels, a reload shortcut and the
 * developer tools along.
 *
 * The shortcuts the page owns — new message, settings, message zoom — are
 * shown here but not registered, so pressing one reaches the page the same
 * way on every platform; choosing it from the menu sends the same command.
 */
export function installAppMenu(getMainWindow: () => BrowserWindow | null): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const command = (name: AppMenuCommand) => (): void => {
    const window = getMainWindow()

    if (window && !window.isDestroyed()) {
      window.show()
      window.webContents.send(IPC_CHANNELS.appMenuCommand, name)
    }
  }
  const pageShortcut = (
    accelerator: string
  ): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> => ({
    accelerator,
    registerAccelerator: false
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `Informazioni su ${APP_NAME}` },
        { type: 'separator' },
        { label: 'Impostazioni…', ...pageShortcut('Command+,'), click: command('settings') },
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
        { label: 'Nuovo messaggio', ...pageShortcut('Command+N'), click: command('compose') },
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
        { role: 'selectAll', label: 'Seleziona tutto' }
      ]
    },
    {
      label: 'Vista',
      submenu: [
        {
          label: 'Ingrandisci messaggio',
          ...pageShortcut('Command+Plus'),
          click: command('reader-zoom-in')
        },
        {
          label: 'Riduci messaggio',
          ...pageShortcut('Command+-'),
          click: command('reader-zoom-out')
        },
        {
          label: 'Dimensioni reali',
          ...pageShortcut('Command+0'),
          click: command('reader-zoom-reset')
        },
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
