import { existsSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'

import { defineMessages } from '@shared/i18n'
import { foldSearchText } from '@shared/search'

import { fileSources } from '../../files/file-sources'
import { messages } from '../../i18n'
import { reachablePath } from '../../services/network-volumes'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  stringArg,
  stringListArg,
  ToolInputError,
  type FileSearch,
  type FoundFile,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { countOf, formatDateTime } from './format'

const DEFAULT_FILE_LIMIT = 30

/** The step's lines, as the user sees them in the panel. */
const STEPS = defineMessages({
  listing: {
    en: 'Looking in the folder…',
    it: 'Guardo nella cartella…',
    de: 'Sehe im Ordner nach…'
  },
  continuing: {
    en: 'Still looking for the files…',
    it: 'Continuo a cercare i file…',
    de: 'Suche weiter nach den Dateien…'
  },
  searchingNamed: {
    en: (name: string) => `Looking for files “${name}”…`,
    it: (name: string) => `Cerco i file «${name}»…`,
    de: (name: string) => `Suche Dateien „${name}“…`
  },
  searching: { en: 'Looking for files…', it: 'Cerco i file…', de: 'Suche Dateien…' },
  lookedIn: {
    en: (folder: string) => `Looked in ${folder}`,
    it: (folder: string) => `Guardato in ${folder}`,
    de: (folder: string) => `In ${folder} nachgesehen`
  },
  stillSearching: { en: 'Still looking…', it: 'Cerco ancora…', de: 'Suche noch…' },
  none: { en: 'No files', it: 'Nessun file', de: 'Keine Dateien' },
  found: {
    en: (count: number, more: boolean) =>
      `Found ${count === 1 ? '1 file' : `${count} files`}${more ? ', there are more' : ''}`,
    it: (count: number, more: boolean) =>
      `Trovati ${count} file${more ? ', ce ne sono altri' : ''}`,
    de: (count: number, more: boolean) =>
      `${count === 1 ? '1 Datei' : `${count} Dateien`} gefunden${more ? ', es gibt weitere' : ''}`
  }
})
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The path that reaches `path` now, wherever its network share is mounted;
 * the share brought back first when it went away (after a sleep) only with
 * the user there to answer if the system asks for its password — Conoscimi,
 * or a conversation. Work on its own reads what is reachable and says what
 * is not.
 */
export function reachShare(context: ToolContext, path: string): Promise<string> {
  return reachablePath(path, {
    mount: context.run.watched || context.run.task === 'conoscimi'
  })
}

/**
 * How long one call of a search looks before it says what it found so far:
 * a large network archive takes longer, and the search goes on from where it
 * stopped (`continua`) — the model decides whether it is worth it.
 */
const SEARCH_SLICE_MS = 8_000
/** Entries of a folder asked about at once, listing it: a share answers a few at a time. */
const LIST_STAT_BATCH = 32

/**
 * Folders no document worth finding lives in: the system's, the programs',
 * the caches, the hidden ones. Skipping them is what keeps a search of a
 * whole home directory to a few seconds.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'library',
  'appdata',
  'application data',
  '$recycle.bin',
  'system volume information',
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  '.trash',
  'trash'
])

/**
 * Where a search without a folder looks: the File sources (see
 * `src/main/files`) — the user's own folders first, then their home with
 * the drives synced into it, then each mounted volume, local or network.
 */
async function defaultRoots(): Promise<string[]> {
  const home = homedir()
  const { app } = await import('electron')
  // The system's own folders — moved into OneDrive on many Windows, named in the user's language
  // on Linux —, then the usual names.
  const system = (['desktop', 'documents', 'downloads'] as const).flatMap((name) => {
    try {
      return [app.getPath(name)]
    } catch {
      return []
    }
  })
  const own = [
    ...new Set([
      ...system,
      ...['Desktop', 'Documents', 'Downloads', 'Documenti', 'Scrivania'].map((name) =>
        join(home, name)
      )
    ])
  ].filter((path) => existsSync(path))
  const volumes = (await fileSources())
    .filter((source) => source.kind !== 'computer' && source.mounted)
    .map((source) => source.path)

  return [...own, home, ...(await syncedDrives(home)), ...volumes]
}

/**
 * The drives of the providers synced on this computer where a search of the
 * home would not go: on macOS they live under Library, which holds the
 * system's files too — OneDrive, Google Drive, Dropbox and Box in
 * CloudStorage, iCloud Drive in Mobile Documents. On Windows and Linux they
 * are folders of the home (OneDrive, Dropbox) or a drive of their own
 * (Google Drive), which the search finds already.
 */
async function syncedDrives(home: string): Promise<string[]> {
  if (process.platform !== 'darwin') {
    return []
  }

  const cloud = join(home, 'Library', 'CloudStorage')
  const drives = await readdir(cloud, { withFileTypes: true }).catch(() => [])
  const iCloud = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')

  return [
    ...drives
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(cloud, entry.name)),
    ...(existsSync(iCloud) ? [iCloud] : [])
  ]
}

/**
 * What an entry is, for a search that never follows a link out of where it
 * looks. On Windows the files and folders of a synced drive (OneDrive, also
 * Desktop and Documents when OneDrive keeps them, Dropbox) are reparse
 * points, which a listing calls links: `lstat` tells a true link — a
 * symbolic link, a junction — from them.
 */
async function entryKind(directory: string, entry: Dirent): Promise<'directory' | 'file' | 'link'> {
  if (!entry.isSymbolicLink()) {
    return entry.isDirectory() ? 'directory' : 'file'
  }

  if (process.platform !== 'win32') {
    return 'link'
  }

  const info = await lstat(join(directory, entry.name)).catch(() => null)
  return !info || info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'directory' : 'file'
}

/** Whether a file found by name is also of the kind and the time asked. */
function wanted(search: FileSearch, path: string, directory: boolean, modified: number): boolean {
  if (
    search.types.length > 0 &&
    (directory || !search.types.includes(extname(path).toLowerCase()))
  ) {
    return false
  }

  if (search.changedFrom === undefined && search.changedTo === undefined) {
    return true
  }

  return (
    !directory &&
    modified >= (search.changedFrom ?? -Infinity) &&
    modified <= (search.changedTo ?? Infinity)
  )
}

/**
 * Files and folders whose name holds every word of the search, breadth
 * first: the nearest first, the newest first among them. Looks for a slice
 * of time, then stops where it is — what it has not looked in stays in the
 * search, to go on from. Read only; never follows a link out of where it
 * looks.
 */
async function findFiles(search: FileSearch): Promise<FoundFile[]> {
  const started = Date.now()
  const found: FoundFile[] = []

  while (search.queue.length > 0 && Date.now() - started < SEARCH_SLICE_MS) {
    const directory = search.queue.shift() as string

    if (search.seen.has(directory)) {
      continue
    }

    search.seen.add(directory)
    let entries

    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const kind = entry.name.startsWith('.') ? 'link' : await entryKind(directory, entry)

      if (kind === 'link') {
        continue
      }

      const path = join(directory, entry.name)
      const isDirectory = kind === 'directory'
      const name = foldSearchText(entry.name)

      if (
        search.words.every((word) => name.includes(word)) &&
        (search.types.length === 0 || search.types.includes(extname(entry.name).toLowerCase()))
      ) {
        try {
          const info = await stat(path)

          if (wanted(search, path, isDirectory, info.mtimeMs)) {
            found.push({ path, directory: isDirectory, size: info.size, modified: info.mtimeMs })
          }
        } catch {
          // Gone, or not ours to read.
        }
      }

      if (isDirectory && !SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) {
        search.queue.push(path)
      }
    }
  }

  return found.sort((a, b) => b.modified - a.modified)
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function nameFile(context: ToolContext, path: string): string {
  return context.handles.name(
    { kind: 'file', file: { kind: 'path', path, fileName: basename(path) } },
    context.newHandles
  )
}

export const searchFilesTool: SegretarioTool = {
  name: 'cerca_file',
  description: PROMPTS.tools.cerca_file,
  parameters: {
    type: 'object',
    properties: {
      nome: { type: 'string' },
      tipo: { type: 'array', items: { type: 'string' } },
      dal: { type: 'string' },
      al: { type: 'string' },
      cartella: { type: 'string' },
      elenca: { type: 'boolean' },
      pagina: { type: 'integer' },
      continua: { type: 'string' },
      limite: { type: 'integer' }
    }
  },
  running: (args) => {
    const m = messages(STEPS)
    const name = stringArg(args, 'nome')

    return booleanArg(args, 'elenca')
      ? m.listing
      : stringArg(args, 'continua')
        ? m.continuing
        : name
          ? m.searchingNamed(name)
          : m.searching
  },
  readsOnly: () => true,
  async execute(args, context) {
    const given = stringArg(args, 'cartella')
    const limit = Math.max(1, numberArg(args, 'limite') ?? DEFAULT_FILE_LIMIT)
    const resumed = stringArg(args, 'continua')

    if (resumed) {
      const search = context.run.fileSearches.get(resumed)

      if (!search) {
        throw new ToolInputError(
          `Non c'è una ricerca «${resumed}» da continuare: è già finita, o va rifatta con \`nome\`.`
        )
      }

      return searchResult(context, resumed, search, await findFiles(search), limit)
    }

    if (given && !isAbsolute(given)) {
      throw new ToolInputError('`cartella` va indicata come percorso completo.')
    }

    const folder = given ? await reachShare(context, given) : undefined

    if (booleanArg(args, 'elenca')) {
      if (!folder) {
        throw new ToolInputError('Per elencare indica `cartella`.')
      }

      const entries = await readdir(resolve(folder), { withFileTypes: true }).catch(() => {
        throw new ToolInputError(`Non riesco ad aprire la cartella «${folder}».`)
      })
      // All of it, sorted, before any is left out: the newest of a large archive come first. A
      // share is asked a few at a time and for as long as a search is: what it had not told by
      // then comes after, by name.
      const visible = entries.filter((entry) => !entry.name.startsWith('.'))
      const deadline = Date.now() + SEARCH_SLICE_MS
      const items: Array<{ path: string; directory: boolean; size: number; modified: number }> = []
      let undated = 0

      for (let start = 0; start < visible.length; start += LIST_STAT_BATCH) {
        const late = Date.now() > deadline
        items.push(
          ...(await Promise.all(
            visible.slice(start, start + LIST_STAT_BATCH).map(async (entry) => {
              const path = join(folder, entry.name)
              const info = late ? null : await stat(path).catch(() => null)
              undated += late ? 1 : 0
              return {
                path,
                // What the entry leads to: a folder of a synced drive is a folder on Windows too.
                directory: info?.isDirectory() ?? entry.isDirectory(),
                size: info?.size ?? 0,
                modified: info?.mtimeMs ?? 0
              }
            })
          ))
        )
      }

      const page = Math.max(1, numberArg(args, 'pagina') ?? 1)
      const shown = items
        .sort(
          (a, b) =>
            Number(b.directory) - Number(a.directory) ||
            b.modified - a.modified ||
            a.path.localeCompare(b.path)
        )
        .slice((page - 1) * limit, page * limit)
      const lines = shown.map((item) =>
        item.directory
          ? `[cartella] ${basename(item.path)}`
          : `${nameFile(context, item.path)} ${basename(item.path)} · ${sizeLabel(item.size)} · ${formatDateTime(new Date(item.modified).toISOString())}`
      )
      const rest = items.length - page * limit

      return {
        content: `${folder} (${countOf(items.length, 'elemento', 'elementi')}: le cartelle, poi i più recenti${page > 1 ? `; pagina ${page}` : ''}${undated > 0 ? `; ${countOf(undated, 'elemento', 'elementi')} senza data, la cartella risponde lentamente` : ''}):\n${lines.join('\n') || '(nient’altro)'}${rest > 0 ? `\n[Altri ${rest}: continua con pagina=${page + 1}.]` : ''}`,
        summary: messages(STEPS).lookedIn(basename(folder) || folder),
        files: shown.filter((item) => !item.directory).map((item) => item.path)
      }
    }

    const name = stringArg(args, 'nome') ?? ''
    const types = stringListArg(args, 'tipo')
      .flatMap((item) => item.split(/[\s,;]+/))
      .filter(Boolean)
      .map((item) => `.${item.toLowerCase().replace(/^\*?\./, '')}`)
    const from = stringArg(args, 'dal')
    const to = stringArg(args, 'al')

    for (const [label, value] of [
      ['dal', from],
      ['al', to]
    ] as const) {
      if (value && !ISO_DATE.test(value)) {
        throw new ToolInputError(`\`${label}\` va scritto come AAAA-MM-GG.`)
      }
    }

    if (!name.trim() && types.length === 0 && !from && !to) {
      throw new ToolInputError(
        'Indica che cosa cercare: `nome`, `tipo` o il periodo (`dal`, `al`); per guardare in una cartella usa `elenca`.'
      )
    }

    const search: FileSearch = {
      words: foldSearchText(name).split(/\s+/).filter(Boolean),
      types,
      // The days of the user's calendar: from the first moment of `dal` to the last of `al`.
      changedFrom: from ? new Date(`${from}T00:00:00`).getTime() : undefined,
      changedTo: to ? new Date(`${to}T23:59:59.999`).getTime() : undefined,
      queue: folder ? [resolve(folder)] : await defaultRoots(),
      seen: new Set(),
      pending: []
    }
    const id = `s${context.run.fileSearches.size + 1}`

    return searchResult(context, id, search, await findFiles(search), limit, {
      name,
      folder,
      from,
      to
    })
  }
}

/**
 * What a slice of a search found: the newest first, as many as asked; and,
 * while it has not looked everywhere, how to go on — so a name not found
 * yet is never said as not there.
 */
function searchResult(
  context: ToolContext,
  id: string,
  search: FileSearch,
  found: FoundFile[],
  limit: number,
  first?: { name: string; folder: string | undefined; from?: string; to?: string }
): { content: string; summary: string; files?: string[] } {
  // What an earlier slice found past its limit comes first, with this one's, the newest first.
  const all = [...search.pending, ...found].sort((a, b) => b.modified - a.modified)
  const shown = all.slice(0, limit)
  search.pending = all.slice(limit)
  const unfinished = search.queue.length > 0 || search.pending.length > 0

  if (unfinished) {
    context.run.fileSearches.set(id, search)
  } else {
    context.run.fileSearches.delete(id)
  }

  const asked = first
    ? [
        first.name.trim() ? `«${first.name.trim()}» nel nome` : null,
        search.types.length > 0 ? search.types.join(' ') : null,
        search.changedFrom !== undefined || search.changedTo !== undefined
          ? `modificati ${first.from ? `dal ${first.from}` : ''}${first.from && first.to ? ' ' : ''}${first.to ? `al ${first.to}` : ''}`
          : null
      ]
        .filter(Boolean)
        .join(', ')
    : ''
  const where = first
    ? `${asked}${first.folder ? ` in ${first.folder}` : ' nelle cartelle dell’utente, nei drive sincronizzati e nei dischi collegati'}`
    : 'altri, continuando la ricerca'
  const left = [
    search.pending.length > 0
      ? countOf(search.pending.length, 'trovato', 'trovati') + ' da mostrare'
      : null,
    search.queue.length > 0
      ? countOf(search.queue.length, 'cartella', 'cartelle') + ' da guardare'
      : null
  ].filter(Boolean)
  const more = unfinished
    ? `\n[La ricerca non ha finito: ${left.join(', ')}. Continua con continua="${id}".]`
    : ''

  if (shown.length === 0) {
    return {
      content: `${unfinished ? 'Per ora nessun file o cartella con' : 'Nessun file o cartella con'} ${where}.${more}`,
      summary: unfinished ? messages(STEPS).stillSearching : messages(STEPS).none
    }
  }

  const lines = shown.map((item) =>
    item.directory
      ? `[cartella] ${item.path}`
      : `${nameFile(context, item.path)} ${item.path} · ${sizeLabel(item.size)} · ${formatDateTime(new Date(item.modified).toISOString())}`
  )

  return {
    content: `${countOf(shown.length, 'trovato', 'trovati')} (${where}), i più recenti per primi:\n${lines.join('\n')}${more}`,
    summary: messages(STEPS).found(shown.length, unfinished),
    files: shown.filter((item) => !item.directory).map((item) => item.path)
  }
}
