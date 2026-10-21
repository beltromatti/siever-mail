import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { is } from '@electron-toolkit/utils'
import {
  app,
  clipboard,
  dialog,
  Menu,
  net,
  shell,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents
} from 'electron'

import { normalizeExternalHttpUrl } from '@main/utils/external-url'
import { logMainError } from '@main/utils/error-utils'
import type { ContextMenuItem, ContextMenuRequest } from '@shared/context-menu'
import { IPC_CHANNELS } from '@shared/ipc'
import { chordToAccelerator } from '@shared/shortcuts'

const SEARCH_LABEL_MAX_LENGTH = 24
const SPELLING_SUGGESTIONS_SHOWN = 6

/**
 * Right-click menus wherever there is text, a link or a picture — the
 * message being read, the editor, every field — native on each platform and
 * in Italian. Electron shows none of its own, so before this a selected
 * line could not be copied with the mouse and a misspelled word showed its
 * red underline with no way to fix it.
 *
 * Places the page gives a menu of its own (a message in the list, an
 * attachment, a person) cancel the browser's, and this one never opens.
 */
export function installContextMenus(window: BrowserWindow): void {
  configureSpellChecker(window.webContents.session)

  window.webContents.on('context-menu', (_event, params) => {
    const template = tidySeparators(buildMenu(window, params))

    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window, frame: params.frame ?? undefined })
    }
  })
}

/**
 * The languages misspellings are found in. macOS uses its own spell
 * checker, which follows the languages in System Settings. Elsewhere the
 * dictionaries are Electron's: the system's language first, then Italian
 * and English, which the people writing here mix freely.
 */
function configureSpellChecker(session: Session): void {
  if (process.platform === 'darwin') {
    return
  }

  const available = new Set(session.availableSpellCheckerLanguages)
  const wanted = [app.getLocale(), 'it-IT', 'it', 'en-US', 'en-GB']
  const languages = [...new Set(wanted)].filter((language) => available.has(language))

  if (languages.length > 0) {
    session.setSpellCheckerLanguages(languages)
  }
}

function request(window: BrowserWindow, payload: ContextMenuRequest): void {
  if (!window.isDestroyed()) {
    window.show()
    window.webContents.send(IPC_CHANNELS.contextMenuRequest, payload)
  }
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SEARCH_LABEL_MAX_LENGTH
    ? `${flat.slice(0, SEARCH_LABEL_MAX_LENGTH - 1)}…`
    : flat
}

function buildMenu(window: BrowserWindow, params: ContextMenuParams): MenuItemConstructorOptions[] {
  const contents = window.webContents
  const items: MenuItemConstructorOptions[] = []

  if (params.isEditable && params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, SPELLING_SUGGESTIONS_SHOWN)

    items.push(
      ...(suggestions.length > 0
        ? suggestions.map((suggestion) => ({
            label: suggestion,
            click: () => contents.replaceMisspelling(suggestion)
          }))
        : [{ label: 'Nessun suggerimento', enabled: false }]),
      {
        label: 'Aggiungi al dizionario',
        click: () => {
          contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        }
      },
      { type: 'separator' }
    )
  }

  items.push(...linkItems(window, params.linkURL))

  if (params.mediaType === 'image' && params.srcURL) {
    items.push(...imageItems(window, contents, params), { type: 'separator' })
  }

  if (params.isEditable) {
    const flags = params.editFlags
    items.push(
      { role: 'undo', label: 'Annulla', enabled: flags.canUndo },
      { role: 'redo', label: 'Ripeti', enabled: flags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Taglia', enabled: flags.canCut },
      { role: 'copy', label: 'Copia', enabled: flags.canCopy },
      { role: 'paste', label: 'Incolla', enabled: flags.canPaste },
      { role: 'pasteAndMatchStyle', label: 'Incolla come testo semplice', enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Seleziona tutto', enabled: flags.canSelectAll }
    )
  } else if (params.selectionText.trim()) {
    const text = params.selectionText.trim()
    items.push(
      { role: 'copy', label: 'Copia' },
      {
        label: `Cerca «${shorten(text)}» nella posta`,
        click: () => request(window, { kind: 'search', text: text.replace(/\s+/g, ' ') })
      },
      { type: 'separator' },
      { role: 'selectAll', label: 'Seleziona tutto' }
    )
  }

  if (is.dev && items.length > 0) {
    items.push(
      { type: 'separator' },
      { label: 'Ispeziona elemento', click: () => contents.inspectElement(params.x, params.y) }
    )
  }

  return items
}

function linkItems(window: BrowserWindow, linkUrl: string): MenuItemConstructorOptions[] {
  if (!linkUrl) {
    return []
  }

  if (/^mailto:/i.test(linkUrl)) {
    const address = decodeURIComponent(linkUrl.slice('mailto:'.length).split('?')[0] ?? '').trim()

    return address
      ? [
          {
            label: `Scrivi a ${address}`,
            click: () => request(window, { kind: 'compose', address })
          },
          { label: 'Copia indirizzo email', click: () => void clipboard.writeText(address) },
          { type: 'separator' }
        ]
      : []
  }

  const safeUrl = normalizeExternalHttpUrl(linkUrl)

  return safeUrl
    ? [
        { label: 'Apri link nel browser', click: () => void shell.openExternal(safeUrl) },
        { label: 'Copia indirizzo link', click: () => void clipboard.writeText(safeUrl) },
        { type: 'separator' }
      ]
    : []
}

function imageItems(
  window: BrowserWindow,
  contents: WebContents,
  params: ContextMenuParams
): MenuItemConstructorOptions[] {
  const remoteUrl = normalizeExternalHttpUrl(params.srcURL)

  return [
    { label: 'Copia immagine', click: () => contents.copyImageAt(params.x, params.y) },
    {
      label: 'Salva immagine con nome…',
      click: () => void saveImage(window, params.srcURL, params.suggestedFilename)
    },
    ...(remoteUrl
      ? [
          {
            label: 'Copia indirizzo immagine',
            click: () => void clipboard.writeText(remoteUrl)
          }
        ]
      : [])
  ]
}

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp'
}

/** The picture behind `source` — inline in the message, or on the web. */
async function readImage(source: string): Promise<{ content: Buffer; type: string }> {
  const inline = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(source)

  if (inline) {
    const [, type, base64, data] = inline
    return {
      type,
      content: base64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data))
    }
  }

  const response = await net.fetch(source)

  if (!response.ok) {
    throw new Error(`Il server ha risposto ${response.status}.`)
  }

  return {
    type: response.headers.get('content-type')?.split(';')[0]?.trim() ?? '',
    content: Buffer.from(await response.arrayBuffer())
  }
}

async function saveImage(
  window: BrowserWindow,
  source: string,
  suggestedName: string
): Promise<void> {
  try {
    const image = await readImage(source)
    const extension = IMAGE_EXTENSIONS[image.type] ?? 'png'
    const baseName = suggestedName.trim() || 'immagine'
    const fileName = /\.[a-z0-9]{2,4}$/i.test(baseName) ? baseName : `${baseName}.${extension}`
    const result = await dialog.showSaveDialog(window, {
      title: 'Salva immagine',
      defaultPath: join(app.getPath('downloads'), fileName)
    })

    if (!result.canceled && result.filePath) {
      await writeFile(result.filePath, image.content)
    }
  } catch (error) {
    logMainError('Saving an image from a context menu failed', error)
    void dialog.showMessageBox(window, {
      type: 'error',
      message: 'Impossibile salvare l’immagine',
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}

/** No separator first, last or twice in a row. */
function tidySeparators(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.filter(
    (item, index) =>
      item.type !== 'separator' ||
      (index > 0 && index < items.length - 1 && items[index - 1]?.type !== 'separator')
  )
}

/** How long a dismissed menu waits for a click that may still be on its way. */
const MENU_CLOSE_GRACE_MS = 120

/**
 * Shows a menu the page composed and settles with the id of the item
 * chosen, or null when it was dismissed. Platforms deliver the click and
 * the close in either order, so a close waits a moment for a click.
 */
export function popupPageContextMenu(
  window: BrowserWindow,
  items: ReadonlyArray<ContextMenuItem>
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (value: string | null): void => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }

    const toTemplate = (entries: ReadonlyArray<ContextMenuItem>): MenuItemConstructorOptions[] =>
      tidySeparators(
        entries.map((entry) => {
          if ('type' in entry) {
            return { type: 'separator' }
          }

          const accelerator = entry.chord ? chordToAccelerator(entry.chord) : null

          return {
            label: entry.label,
            enabled: entry.enabled ?? true,
            ...(entry.checked !== undefined ? { type: 'checkbox', checked: entry.checked } : {}),
            ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
            ...(entry.submenu
              ? { submenu: toTemplate(entry.submenu) }
              : { click: () => settle(entry.id) })
          }
        })
      )

    const template = toTemplate(items)

    if (template.length === 0) {
      settle(null)
      return
    }

    Menu.buildFromTemplate(template).popup({
      window,
      callback: () => setTimeout(() => settle(null), MENU_CLOSE_GRACE_MS)
    })
  })
}
