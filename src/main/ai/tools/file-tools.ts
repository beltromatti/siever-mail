import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'

import { foldSearchText } from '@shared/search'

import { ensurePathReachable } from '../../services/network-volumes'
import { extractContent } from '../extraction'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  requireString,
  stringArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { describeExtraction } from './mail-tools'
import { countOf, formatDateTime } from './format'

const DEFAULT_FILE_LIMIT = 30
/** Entries a search looks at, and how long it may take, before it reports what it has. */
const SEARCH_MAX_ENTRIES = 80_000
const SEARCH_MAX_MS = 8_000
/** Files read at most, in bytes: a document larger is not one to read in a conversation. */
const READ_MAX_BYTES = 40 * 1024 * 1024

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

/** Where a search looks when no folder is given: the user's own folders, then the disks attached. */
function defaultRoots(): string[] {
  const home = homedir()
  const roots = ['Desktop', 'Documents', 'Downloads', 'Documenti', 'Scrivania']
    .map((name) => join(home, name))
    .filter((path) => existsSync(path))

  roots.push(home)

  if (process.platform === 'darwin' && existsSync('/Volumes')) {
    roots.push('/Volumes')
  } else if (process.platform === 'win32') {
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${letter}:\\`

      if (existsSync(drive)) {
        roots.push(drive)
      }
    }
  } else {
    for (const path of ['/media', '/mnt']) {
      if (existsSync(path)) {
        roots.push(path)
      }
    }
  }

  return roots
}

interface FoundFile {
  path: string
  directory: boolean
  size: number
  modified: number
}

/**
 * Files and folders whose name holds every word of `words`, breadth first
 * from `roots`: the nearest first, the newest first among them. Read only;
 * never follows a link out of where it looks.
 */
async function findFiles(roots: string[], words: string[], limit: number): Promise<FoundFile[]> {
  const started = Date.now()
  const queue = [...roots]
  const seen = new Set<string>()
  const found: FoundFile[] = []
  let visited = 0

  while (queue.length > 0 && visited < SEARCH_MAX_ENTRIES && Date.now() - started < SEARCH_MAX_MS) {
    const directory = queue.shift() as string

    if (seen.has(directory)) {
      continue
    }

    seen.add(directory)
    let entries

    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      visited += 1

      if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
        continue
      }

      const path = join(directory, entry.name)
      const isDirectory = entry.isDirectory()
      const name = foldSearchText(entry.name)

      if (words.every((word) => name.includes(word))) {
        try {
          const info = await stat(path)
          found.push({ path, directory: isDirectory, size: info.size, modified: info.mtimeMs })
        } catch {
          // Gone, or not ours to read.
        }
      }

      if (isDirectory && !SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) {
        queue.push(path)
      }
    }

    if (found.length >= limit * 3) {
      break
    }
  }

  return found.sort((a, b) => b.modified - a.modified).slice(0, limit)
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
      limite: { type: 'integer' }
    }
  },
  running: (args) =>
    booleanArg(args, 'elenca')
      ? 'Guardo nella cartella…'
      : `Cerco i file «${stringArg(args, 'nome') ?? ''}»…`,
  async execute(args, context) {
    const folder = stringArg(args, 'cartella')
    const limit = Math.min(100, Math.max(1, numberArg(args, 'limite') ?? DEFAULT_FILE_LIMIT))

    if (folder && !isAbsolute(folder)) {
      throw new ToolInputError('`cartella` va indicata come percorso completo.')
    }

    if (folder) {
      await ensurePathReachable(folder)
    }

    if (booleanArg(args, 'elenca')) {
      if (!folder) {
        throw new ToolInputError('Per elencare indica `cartella`.')
      }

      const entries = await readdir(resolve(folder), { withFileTypes: true }).catch(() => {
        throw new ToolInputError(`Non riesco ad aprire la cartella «${folder}».`)
      })
      const items = await Promise.all(
        entries
          .filter((entry) => !entry.name.startsWith('.'))
          .slice(0, 300)
          .map(async (entry) => {
            const path = join(folder, entry.name)
            const info = await stat(path).catch(() => null)
            return {
              path,
              directory: entry.isDirectory(),
              size: info?.size ?? 0,
              modified: info?.mtimeMs ?? 0
            }
          })
      )
      const lines = items
        .sort((a, b) => Number(b.directory) - Number(a.directory) || b.modified - a.modified)
        .slice(0, limit)
        .map((item) =>
          item.directory
            ? `[cartella] ${basename(item.path)}`
            : `${nameFile(context, item.path)} ${basename(item.path)} · ${sizeLabel(item.size)} · ${formatDateTime(new Date(item.modified).toISOString())}`
        )

      return {
        content: `${folder} (${countOf(items.length, 'elemento', 'elementi')}${items.length > limit ? `, i primi ${limit}` : ''}):\n${lines.join('\n')}`,
        summary: `Guardato in ${basename(folder) || folder}`,
        files: items
          .filter((item) => !item.directory)
          .slice(0, limit)
          .map((item) => item.path)
      }
    }

    const name = requireString(args, 'nome')
    const words = foldSearchText(name).split(/\s+/).filter(Boolean)
    const found = await findFiles(folder ? [resolve(folder)] : defaultRoots(), words, limit)

    if (found.length === 0) {
      return {
        content: `Nessun file o cartella con «${name}» nel nome${folder ? ` in ${folder}` : ' nelle cartelle dell’utente e nei dischi collegati'}.`,
        summary: `Cercato «${name}» · nessun file`
      }
    }

    const lines = found.map((item) =>
      item.directory
        ? `[cartella] ${item.path}`
        : `${nameFile(context, item.path)} ${item.path} · ${sizeLabel(item.size)} · ${formatDateTime(new Date(item.modified).toISOString())}`
    )

    return {
      content: `${countOf(found.length, 'trovato', 'trovati')}, i più recenti per primi:\n${lines.join('\n')}`,
      summary: `Cercato «${name}» · ${found.length} file`,
      files: found.filter((item) => !item.directory).map((item) => item.path)
    }
  }
}

export const readFileTool: SegretarioTool = {
  name: 'leggi_file',
  description: PROMPTS.tools.leggi_file,
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      da_carattere: { type: 'integer' },
      pagina: { type: 'integer' }
    },
    required: ['file']
  },
  running: () => 'Leggo il file…',
  async execute(args, context) {
    const reference = requireString(args, 'file')
    const known = context.handles.file(reference)
    let path: string

    if (known?.kind === 'path') {
      path = known.path
    } else if (known?.kind === 'attachment') {
      throw new ToolInputError(`«${reference}» è un allegato: usa leggi_allegato.`)
    } else if (isAbsolute(reference)) {
      path = reference
    } else {
      throw new ToolInputError(
        `Non conosco il file «${reference}»: usa un riferimento o un percorso completo.`
      )
    }

    await ensurePathReachable(path)
    const info = await stat(path).catch(() => null)

    if (!info?.isFile()) {
      throw new ToolInputError(`Il file «${path}» non c'è o non si può aprire.`)
    }

    if (info.size > READ_MAX_BYTES) {
      throw new ToolInputError(
        `«${basename(path)}» è troppo grande da leggere (${sizeLabel(info.size)}).`
      )
    }

    const handle = nameFile(context, path)
    const outcome = describeExtraction(
      handle,
      basename(path),
      await extractContent(basename(path), undefined, await readFile(path), {
        offset: numberArg(args, 'da_carattere'),
        page: numberArg(args, 'pagina')
      })
    )

    return { ...outcome, files: [path] }
  }
}
