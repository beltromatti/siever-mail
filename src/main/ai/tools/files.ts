import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'

import { foldSearchText } from '@shared/search'

import { fileSources } from '../../files/file-sources'
import { reachablePath } from '../../services/network-volumes'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  requireString,
  stringArg,
  ToolInputError,
  type FileSearch,
  type FoundFile,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { countOf, formatDateTime } from './format'

const DEFAULT_FILE_LIMIT = 30

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
 * `src/main/files`) — the user's own folders first, then their home, then
 * each mounted volume, local or network.
 */
async function defaultRoots(): Promise<string[]> {
  const home = homedir()
  const own = ['Desktop', 'Documents', 'Downloads', 'Documenti', 'Scrivania']
    .map((name) => join(home, name))
    .filter((path) => existsSync(path))
  const volumes = (await fileSources())
    .filter((source) => source.kind !== 'computer' && source.mounted)
    .map((source) => source.path)

  return [...own, home, ...volumes]
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
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
        continue
      }

      const path = join(directory, entry.name)
      const isDirectory = entry.isDirectory()
      const name = foldSearchText(entry.name)

      if (search.words.every((word) => name.includes(word))) {
        try {
          const info = await stat(path)
          found.push({ path, directory: isDirectory, size: info.size, modified: info.mtimeMs })
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
      cartella: { type: 'string' },
      elenca: { type: 'boolean' },
      pagina: { type: 'integer' },
      continua: { type: 'string' },
      limite: { type: 'integer' }
    }
  },
  running: (args) =>
    booleanArg(args, 'elenca')
      ? 'Guardo nella cartella…'
      : stringArg(args, 'continua')
        ? 'Continuo a cercare i file…'
        : `Cerco i file «${stringArg(args, 'nome') ?? ''}»…`,
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
                directory: entry.isDirectory(),
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
        summary: `Guardato in ${basename(folder) || folder}`,
        files: shown.filter((item) => !item.directory).map((item) => item.path)
      }
    }

    const name = requireString(args, 'nome')
    const search: FileSearch = {
      words: foldSearchText(name).split(/\s+/).filter(Boolean),
      queue: folder ? [resolve(folder)] : await defaultRoots(),
      seen: new Set(),
      pending: []
    }
    const id = `s${context.run.fileSearches.size + 1}`

    return searchResult(context, id, search, await findFiles(search), limit, {
      name,
      folder
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
  first?: { name: string; folder: string | undefined }
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

  const where = first
    ? `«${first.name}» nel nome${first.folder ? ` in ${first.folder}` : ' nelle cartelle dell’utente e nei dischi collegati'}`
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
      summary: unfinished ? 'Cerco ancora…' : 'Nessun file'
    }
  }

  const lines = shown.map((item) =>
    item.directory
      ? `[cartella] ${item.path}`
      : `${nameFile(context, item.path)} ${item.path} · ${sizeLabel(item.size)} · ${formatDateTime(new Date(item.modified).toISOString())}`
  )

  return {
    content: `${countOf(shown.length, 'trovato', 'trovati')} (${where}), i più recenti per primi:\n${lines.join('\n')}${more}`,
    summary: `Trovati ${shown.length} file${unfinished ? ', ce ne sono altri' : ''}`,
    files: shown.filter((item) => !item.directory).map((item) => item.path)
  }
}
