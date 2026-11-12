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
import { diagnostics } from '@main/diagnostics/log'
import type { ContextMenuItem, ContextMenuRequest } from '@shared/context-menu'
import { defineMessages, type Language } from '@shared/i18n'
import { IPC_CHANNELS } from '@shared/ipc'
import { chordToAccelerator } from '@shared/shortcuts'

import { languageState, messages, onLanguageChange } from './i18n'

const log = diagnostics('app')

const MESSAGES = defineMessages({
  noSuggestions: { en: 'No suggestions', it: 'Nessun suggerimento', de: 'Keine Vorschläge' },
  addToDictionary: {
    en: 'Add to dictionary',
    it: 'Aggiungi al dizionario',
    de: 'Zum Wörterbuch hinzufügen'
  },
  undo: { en: 'Undo', it: 'Annulla', de: 'Widerrufen' },
  redo: { en: 'Redo', it: 'Ripeti', de: 'Wiederholen' },
  cut: { en: 'Cut', it: 'Taglia', de: 'Ausschneiden' },
  copy: { en: 'Copy', it: 'Copia', de: 'Kopieren' },
  paste: { en: 'Paste', it: 'Incolla', de: 'Einsetzen' },
  pasteAsPlainText: {
    en: 'Paste as plain text',
    it: 'Incolla come testo semplice',
    de: 'Als reinen Text einsetzen'
  },
  selectAll: { en: 'Select all', it: 'Seleziona tutto', de: 'Alles auswählen' },
  searchMail: {
    en: (text: string) => `Search mail for “${text}”`,
    it: (text: string) => `Cerca «${text}» nella posta`,
    de: (text: string) => `E-Mails nach „${text}“ durchsuchen`
  },
  inspect: { en: 'Inspect element', it: 'Ispeziona elemento', de: 'Element untersuchen' },
  writeTo: {
    en: (address: string) => `Write to ${address}`,
    it: (address: string) => `Scrivi a ${address}`,
    de: (address: string) => `E-Mail an ${address} verfassen`
  },
  copyEmailAddress: {
    en: 'Copy email address',
    it: 'Copia indirizzo email',
    de: 'E-Mail-Adresse kopieren'
  },
  openLink: {
    en: 'Open link in browser',
    it: 'Apri link nel browser',
    de: 'Link im Browser öffnen'
  },
  copyLinkAddress: {
    en: 'Copy link address',
    it: 'Copia indirizzo link',
    de: 'Linkadresse kopieren'
  },
  copyImage: { en: 'Copy image', it: 'Copia immagine', de: 'Bild kopieren' },
  saveImageAs: {
    en: 'Save image as…',
    it: 'Salva immagine con nome…',
    de: 'Bild speichern unter …'
  },
  copyImageAddress: {
    en: 'Copy image address',
    it: 'Copia indirizzo immagine',
    de: 'Bildadresse kopieren'
  },
  serverAnswered: {
    en: (status: number) => `The server answered ${status}.`,
    it: (status: number) => `Il server ha risposto ${status}.`,
    de: (status: number) => `Der Server hat mit ${status} geantwortet.`
  },
  imageFileName: { en: 'image', it: 'immagine', de: 'Bild' },
  saveImage: { en: 'Save image', it: 'Salva immagine', de: 'Bild speichern' },
  imageNotSaved: {
    en: 'The image couldn’t be saved',
    it: 'Impossibile salvare l’immagine',
    de: 'Das Bild konnte nicht gespeichert werden'
  }
})

const SEARCH_LABEL_MAX_LENGTH = 24
const SPELLING_SUGGESTIONS_SHOWN = 6

/**
 * Right-click menus wherever there is text, a link or a picture — the
 * message being read, the editor, every field — native on each platform and
 * in the interface's language. Electron shows none of its own, so before this a selected
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

/** Each interface language's dictionary when the region has none of its own. */
const DEFAULT_DICTIONARY: Readonly<Record<Language, string>> = {
  en: 'en-US',
  it: 'it-IT',
  de: 'de-DE'
}

/** Sessions whose dictionaries follow the interface's language already. */
const followingLanguage = new WeakSet<Session>()

/**
 * The dictionary of a language tag: its own, or one of the same language —
 * 'de-CH' finds 'de-DE', 'it' finds 'it-IT'.
 */
function dictionaryFor(tag: string, available: ReadonlyArray<string>): string | null {
  const wanted = tag.replace('_', '-').toLowerCase()
  const base = wanted.split('-')[0]
  const same = available.filter((code) => code.toLowerCase().split('-')[0] === base)

  return (
    same.find((code) => code.toLowerCase() === wanted) ??
    same.find((code) => code.toLowerCase() === `${base}-${base}`) ??
    same.find((code) => code.toLowerCase() === base) ??
    same[0] ??
    null
  )
}

/**
 * The languages misspellings are found in. macOS uses its own spell
 * checker, which follows the languages in System Settings. Elsewhere the
 * dictionaries are Electron's: the interface's language first — in the
 * computer's region when there is a dictionary for it —, then the system's
 * languages, then Italian and English, which the people writing here mix
 * freely. They follow the interface's language when it changes.
 */
function configureSpellChecker(session: Session): void {
  if (process.platform === 'darwin') {
    return
  }

  const available = session.availableSpellCheckerLanguages
  const { language, formatLocale } = languageState()
  const system = [app.getLocale(), ...app.getPreferredSystemLanguages()]
  const interfaceDictionary =
    [formatLocale, ...system.filter((tag) => tag.toLowerCase().startsWith(`${language}-`))]
      .map((tag) => available.find((code) => code.toLowerCase() === tag.toLowerCase()))
      .find(Boolean) ?? dictionaryFor(DEFAULT_DICTIONARY[language], available)
  const wanted = [
    interfaceDictionary,
    ...system.map((tag) => dictionaryFor(tag, available)),
    'it-IT',
    'it',
    'en-US',
    'en-GB'
  ]
  const languages = [...new Set(wanted)].filter(
    (code): code is string => code !== null && code !== undefined && available.includes(code)
  )

  if (languages.length > 0) {
    session.setSpellCheckerLanguages(languages)
  }

  if (!followingLanguage.has(session)) {
    followingLanguage.add(session)
    onLanguageChange(() => configureSpellChecker(session))
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
  const m = messages(MESSAGES)
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
        : [{ label: m.noSuggestions, enabled: false }]),
      {
        label: m.addToDictionary,
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
      { role: 'undo', label: m.undo, enabled: flags.canUndo },
      { role: 'redo', label: m.redo, enabled: flags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: m.cut, enabled: flags.canCut },
      { role: 'copy', label: m.copy, enabled: flags.canCopy },
      { role: 'paste', label: m.paste, enabled: flags.canPaste },
      { role: 'pasteAndMatchStyle', label: m.pasteAsPlainText, enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: m.selectAll, enabled: flags.canSelectAll }
    )
  } else if (params.selectionText.trim()) {
    const text = params.selectionText.trim()
    items.push(
      { role: 'copy', label: m.copy },
      {
        label: m.searchMail(shorten(text)),
        click: () => request(window, { kind: 'search', text: text.replace(/\s+/g, ' ') })
      },
      { type: 'separator' },
      { role: 'selectAll', label: m.selectAll }
    )
  }

  if (is.dev && items.length > 0) {
    items.push(
      { type: 'separator' },
      { label: m.inspect, click: () => contents.inspectElement(params.x, params.y) }
    )
  }

  return items
}

function linkItems(window: BrowserWindow, linkUrl: string): MenuItemConstructorOptions[] {
  if (!linkUrl) {
    return []
  }

  const m = messages(MESSAGES)

  if (/^mailto:/i.test(linkUrl)) {
    const address = decodeURIComponent(linkUrl.slice('mailto:'.length).split('?')[0] ?? '').trim()

    return address
      ? [
          {
            label: m.writeTo(address),
            click: () => request(window, { kind: 'compose', address })
          },
          { label: m.copyEmailAddress, click: () => void clipboard.writeText(address) },
          { type: 'separator' }
        ]
      : []
  }

  const safeUrl = normalizeExternalHttpUrl(linkUrl)

  return safeUrl
    ? [
        { label: m.openLink, click: () => void shell.openExternal(safeUrl) },
        { label: m.copyLinkAddress, click: () => void clipboard.writeText(safeUrl) },
        { type: 'separator' }
      ]
    : []
}

function imageItems(
  window: BrowserWindow,
  contents: WebContents,
  params: ContextMenuParams
): MenuItemConstructorOptions[] {
  const m = messages(MESSAGES)
  const remoteUrl = normalizeExternalHttpUrl(params.srcURL)

  return [
    { label: m.copyImage, click: () => contents.copyImageAt(params.x, params.y) },
    {
      label: m.saveImageAs,
      click: () => void saveImage(window, params.srcURL, params.suggestedFilename)
    },
    ...(remoteUrl
      ? [
          {
            label: m.copyImageAddress,
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
    throw new Error(messages(MESSAGES).serverAnswered(response.status))
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
    const baseName = suggestedName.trim() || messages(MESSAGES).imageFileName
    const fileName = /\.[a-z0-9]{2,4}$/i.test(baseName) ? baseName : `${baseName}.${extension}`
    const result = await dialog.showSaveDialog(window, {
      title: messages(MESSAGES).saveImage,
      defaultPath: join(app.getPath('downloads'), fileName)
    })

    if (!result.canceled && result.filePath) {
      await writeFile(result.filePath, image.content)
    }
  } catch (error) {
    log.error('Saving an image from a context menu failed', error)
    void dialog.showMessageBox(window, {
      type: 'error',
      message: messages(MESSAGES).imageNotSaved,
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
