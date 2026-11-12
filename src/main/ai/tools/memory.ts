import { defineMessages } from '@shared/i18n'

import { messages } from '../../i18n'
import {
  LONG_NOTE_CHARS,
  memoryHeadline,
  normalizeMemoryPath,
  type MemoryDocument
} from '../memory/notebook'
import { PROMPTS } from '../prompts'
import { RegistryRefusal } from '../registry/types'
import {
  MissingArgument,
  numberArg,
  objectListArg,
  requireString,
  seenKey,
  seenOf,
  type SegretarioTool,
  stringArg,
  ToolConflict,
  type ToolContext,
  ToolInputError
} from '../agent/tool-types'
import { formatDateTime } from './format'

/** The step's lines, as the user sees them in the panel. */
const STEPS = defineMessages({
  reading: { en: 'Rereading my memory…', it: 'Rileggo la memoria…', de: 'Lese das Gedächtnis…' },
  updating: {
    en: 'Updating my memory…',
    it: 'Aggiorno la memoria…',
    de: 'Aktualisiere das Gedächtnis…'
  },
  searched: {
    en: (words: string) => `Searched “${words}” in my memory`,
    it: (words: string) => `Cercato «${words}» nella memoria`,
    de: (words: string) => `„${words}“ im Gedächtnis gesucht`
  },
  index: {
    en: 'Reread the memory’s index',
    it: 'Riletto l’indice della memoria',
    de: 'Inhaltsverzeichnis des Gedächtnisses gelesen'
  },
  folder: {
    en: (path: string) => `Looked at the folder ${path}`,
    it: (path: string) => `Guardata la cartella ${path}`,
    de: (path: string) => `Ordner ${path} angesehen`
  },
  read: {
    en: (path: string) => `Reread ${path}`,
    it: (path: string) => `Riletto ${path}`,
    de: (path: string) => `${path} gelesen`
  },
  updated: {
    en: (path: string) => `Updated the note ${path}`,
    it: (path: string) => `Aggiornata la nota ${path}`,
    de: (path: string) => `Notiz ${path} aktualisiert`
  },
  created: {
    en: (path: string) => `Created the note ${path}`,
    it: (path: string) => `Creata la nota ${path}`,
    de: (path: string) => `Notiz ${path} erstellt`
  },
  rewritten: {
    en: (path: string) => `Rewrote the note ${path}`,
    it: (path: string) => `Riscritta la nota ${path}`,
    de: (path: string) => `Notiz ${path} neu geschrieben`
  },
  deleted: {
    en: (path: string) => `Deleted the note ${path}`,
    it: (path: string) => `Eliminata la nota ${path}`,
    de: (path: string) => `Notiz ${path} gelöscht`
  },
  renamed: {
    en: (path: string) => `Renamed ${path}`,
    it: (path: string) => `Rinominata ${path}`,
    de: (path: string) => `${path} umbenannt`
  },
  history: {
    en: (path: string) => `Looked at the history of ${path}`,
    it: (path: string) => `Guardata la storia di ${path}`,
    de: (path: string) => `Verlauf von ${path} angesehen`
  },
  restored: {
    en: (path: string) => `Restored ${path}`,
    it: (path: string) => `Ripristinata ${path}`,
    de: (path: string) => `${path} wiederhergestellt`
  }
})

const COMMANDS = [
  'leggi',
  'cerca',
  'modifica',
  'inserisci',
  'scrivi',
  'elimina',
  'rinomina',
  'storia',
  'ripristina'
] as const

/** The text to write; one put in `parole` — `cerca`'s — is said so, for the next call to land. */
function textArg(args: Record<string, unknown>): string {
  const text = stringArg(args, 'testo')

  if (!text) {
    throw new ToolInputError(
      stringArg(args, 'parole')
        ? 'Manca `testo`: il testo da scrivere va in `testo` (`parole` serve solo a `cerca`).'
        : 'Manca `testo`: il testo da scrivere.'
    )
  }

  return text
}

/** A note with its lines numbered: all of it, or the lines asked for. */
function numbered(document: MemoryDocument, lines?: { from?: number; to?: number }): string {
  const all = document.content.replace(/\n$/, '').split('\n')
  const from = Math.max(1, lines?.from ?? 1)
  const to = Math.min(all.length, lines?.to ?? all.length)
  const part = from > 1 || to < all.length

  return `${document.path} (versione ${document.revision}, aggiornata il ${formatDateTime(new Date(document.updatedAt).toISOString())}${part ? `; righe ${from}–${to} di ${all.length}` : ''})\n${all
    .slice(from - 1, to)
    .map((line, index) => `${String(from + index).padStart(4)}\t${line}`)
    .join('\n')}`
}

/** What a note now is, when it has grown long: said, for the Segretario to decide. */
function lengthWord(document: MemoryDocument): string {
  return document.content.length > LONG_NOTE_CHARS
    ? ` È lunga ${document.content.length.toLocaleString('it-IT')} caratteri: ogni lavoro che la apre la legge tutta. Se mescola argomenti diversi, o tiene cose che si ritrovano cercando, valuta di metterla in ordine o di dividerla.`
    : ''
}

function isDocument(value: unknown): value is MemoryDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MemoryDocument).path === 'string' &&
    typeof (value as MemoryDocument).content === 'string' &&
    typeof (value as MemoryDocument).revision === 'number'
  )
}

function remember(context: ToolContext, document: MemoryDocument): void {
  context.run.seen.set(seenKey('memory', document.path), document.revision)
}

export const memoryTool: SegretarioTool = {
  name: 'memoria',
  description: PROMPTS.tools.memoria,
  parameters: {
    type: 'object',
    properties: {
      comando: { type: 'string', enum: [...COMMANDS] },
      percorso: { type: 'string' },
      testo: { type: 'string' },
      modifiche: {
        type: 'array',
        items: {
          type: 'object',
          properties: { vecchio: { type: 'string' }, nuovo: { type: 'string' } },
          required: ['vecchio', 'nuovo']
        }
      },
      riga: { type: 'integer' },
      da_riga: { type: 'integer' },
      a_riga: { type: 'integer' },
      nuovo_percorso: { type: 'string' },
      parole: { type: 'string' },
      versione: { type: 'integer' }
    },
    required: ['comando']
  },
  running: (args) =>
    args.comando === 'leggi' || args.comando === 'cerca' || args.comando === 'storia'
      ? messages(STEPS).reading
      : messages(STEPS).updating,
  readsOnly: (args) => ['leggi', 'cerca', 'storia'].includes(String(args.comando)),
  async execute(args, context) {
    const command = requireString(args, 'comando') as (typeof COMMANDS)[number]
    const actor = context.run.actor
    const notebook = context.notebook

    try {
      if (command === 'cerca') {
        const words = requireString(args, 'parole')
        const hits = await notebook.search(words)
        return {
          content:
            hits.length === 0
              ? `Nessuna riga con «${words}» nella memoria.`
              : hits.map((hit) => `${hit.path}:${hit.line}  ${hit.text}`).join('\n'),
          summary: messages(STEPS).searched(words)
        }
      }

      const rawPath = stringArg(args, 'percorso')

      if (command === 'leggi' && !rawPath) {
        return { content: await notebook.index(), summary: messages(STEPS).index }
      }

      // A folder: its notes, each with its first line.
      if (command === 'leggi' && rawPath && !rawPath.trim().endsWith('.md')) {
        const listing = await notebook.folder(rawPath)

        if (listing !== null) {
          return { content: listing, summary: messages(STEPS).folder(rawPath) }
        }
      }

      // An edit without its note: the note that holds the text, when only one does.
      const first = objectListArg(args, 'modifiche')[0]?.vecchio
      const holders =
        !rawPath && command === 'modifica' && typeof first === 'string' && first
          ? (await notebook.list()).filter((note) => note.content.includes(first))
          : []

      if (!rawPath && holders.length !== 1) {
        throw new MissingArgument(
          holders.length > 1
            ? `Manca \`percorso\`: il testo da sostituire è in ${holders.map((note) => note.path).join(', ')}.`
            : 'Manca `percorso`: la nota su cui lavorare (`leggi` senza percorso dà la mappa).'
        )
      }

      const path = normalizeMemoryPath(rawPath ?? holders[0].path)

      switch (command) {
        case 'leggi': {
          const document = await notebook.read(path)

          if (!document) {
            throw new ToolInputError(await notebook.missing(path))
          }

          remember(context, document)
          return {
            content: numbered(document, {
              from: numberArg(args, 'da_riga'),
              to: numberArg(args, 'a_riga')
            }),
            summary: messages(STEPS).read(path)
          }
        }
        case 'modifica': {
          const edits = objectListArg(args, 'modifiche').map((edit) => ({
            old: typeof edit.vecchio === 'string' ? edit.vecchio : '',
            new: typeof edit.nuovo === 'string' ? edit.nuovo : ''
          }))

          const document = await notebook.edit(path, edits, actor)
          remember(context, document)
          return {
            content: `${path} aggiornata (versione ${document.revision}).${lengthWord(document)}`,
            summary: messages(STEPS).updated(path)
          }
        }
        case 'inserisci': {
          const text = textArg(args)
          const document = await notebook.insert(
            path,
            numberArg(args, 'riga') ?? null,
            text,
            actor,
            { seenRevision: seenOf(context.run, seenKey('memory', path)) }
          )
          remember(context, document)
          return {
            content: `Testo inserito in ${path}.${lengthWord(document)}`,
            summary: messages(STEPS).updated(path)
          }
        }
        case 'scrivi': {
          const text = textArg(args)
          // Over the note as the run read it — never read, it is shown first (§4.6).
          const { document, created } = await notebook.write(path, text, actor, {
            seenRevision: seenOf(context.run, seenKey('memory', path))
          })
          remember(context, document)

          return {
            content: `${created ? `Nota ${path} creata.` : `Nota ${path} riscritta.`}${lengthWord(document)}`,
            summary: created ? messages(STEPS).created(path) : messages(STEPS).rewritten(path)
          }
        }
        case 'elimina': {
          const deleted = await notebook.delete(path, actor)
          return {
            content: deleted
              ? `Nota ${path} eliminata (resta nella sua storia).`
              : `La nota ${path} non c'era.`,
            summary: messages(STEPS).deleted(path)
          }
        }
        case 'rinomina': {
          const target = normalizeMemoryPath(requireString(args, 'nuovo_percorso'))
          const document = await notebook.rename(path, target, actor)
          remember(context, document)
          return {
            content: `Nota ${path} rinominata in ${target}.`,
            summary: messages(STEPS).renamed(path)
          }
        }
        case 'storia': {
          const versions = await notebook.history(path)
          return {
            content:
              versions.length === 0
                ? `Nessuna versione di ${path}.`
                : versions
                    .map(
                      (version) =>
                        `versione ${version.revision} · ${formatDateTime(new Date(version.at).toISOString())} · ${version.action} · ${
                          version.actor === 'utente'
                            ? "dall'utente"
                            : version.actor === 'sistema'
                              ? 'dal programma'
                              : 'da te'
                        }${version.content ? ` · ${memoryHeadline(version.content)}` : ''}`
                    )
                    .join('\n'),
            summary: messages(STEPS).history(path)
          }
        }
        case 'ripristina': {
          const version = numberArg(args, 'versione')

          if (version === undefined) {
            throw new ToolInputError('Indica `versione`, dalla `storia` della nota.')
          }

          const document = await notebook.restore(path, version, actor)
          remember(context, document)
          return {
            content: `${path} riportata alla versione ${version}.`,
            summary: messages(STEPS).restored(path)
          }
        }
        default:
          throw new ToolInputError(`\`comando\` è uno di: ${COMMANDS.join(', ')}.`)
      }
    } catch (error) {
      if (error instanceof RegistryRefusal) {
        // Changed by another run since this one read it: here is the note as it is now, seen,
        // to do again what still holds.
        if (isDocument(error.current)) {
          remember(context, error.current)
          throw new ToolConflict(`${error.message}\n\nCom'è ora:\n${numbered(error.current)}`)
        }

        throw new ToolInputError(error.message)
      }

      throw error
    }
  }
}
