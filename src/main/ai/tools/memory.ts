import { memoryHeadline, normalizeMemoryPath, type MemoryDocument } from '../memory/notebook'
import { PROMPTS } from '../prompts'
import { RegistryRefusal } from '../registry/types'
import {
  numberArg,
  objectListArg,
  requireString,
  seenKey,
  stringArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { formatDateTime } from './format'

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

function numbered(document: MemoryDocument): string {
  return `${document.path} (versione ${document.revision}, aggiornata il ${formatDateTime(new Date(document.updatedAt).toISOString())})\n${document.content
    .replace(/\n$/, '')
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(4)}  ${line}`)
    .join('\n')}`
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
      nuovo_percorso: { type: 'string' },
      parole: { type: 'string' },
      versione: { type: 'integer' }
    },
    required: ['comando']
  },
  running: (args) =>
    args.comando === 'leggi' || args.comando === 'cerca' || args.comando === 'storia'
      ? 'Rileggo la memoria…'
      : 'Aggiorno la memoria…',
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
          summary: `Cercato «${words}» nella memoria`
        }
      }

      const rawPath = stringArg(args, 'percorso')

      if (command === 'leggi' && !rawPath) {
        return { content: await notebook.index(), summary: 'Riletto l’indice della memoria' }
      }

      // A folder: its notes, each with its first line.
      if (command === 'leggi' && rawPath && !rawPath.trim().endsWith('.md')) {
        const listing = await notebook.folder(rawPath)

        if (listing !== null) {
          return { content: listing, summary: `Guardata la cartella ${rawPath}` }
        }
      }

      if (!rawPath) {
        // The model now and then fills every other parameter and forgets this one: it is told
        // where the text it wants to change is, so the next call lands.
        const first = objectListArg(args, 'modifiche')[0]?.vecchio
        const holders =
          command === 'modifica' && typeof first === 'string' && first
            ? (await notebook.list()).filter((note) => note.content.includes(first))
            : []
        throw new ToolInputError(
          holders.length > 0
            ? `Manca \`percorso\`: il testo da sostituire è in ${holders.map((note) => note.path).join(', ')}.`
            : 'Manca `percorso`: la nota su cui lavorare (`leggi` senza percorso dà l’indice).'
        )
      }

      const path = normalizeMemoryPath(rawPath ?? '')

      switch (command) {
        case 'leggi': {
          const document = await notebook.read(path)

          if (!document) {
            throw new ToolInputError(await notebook.missing(path))
          }

          remember(context, document)
          return { content: numbered(document), summary: `Riletto ${path}` }
        }
        case 'modifica': {
          const edits = objectListArg(args, 'modifiche').map((edit) => ({
            old: typeof edit.vecchio === 'string' ? edit.vecchio : '',
            new: typeof edit.nuovo === 'string' ? edit.nuovo : ''
          }))

          const document = await notebook.edit(path, edits, actor)
          remember(context, document)
          return {
            content: `${path} aggiornata (versione ${document.revision}).`,
            summary: `Aggiornata la nota ${path}`
          }
        }
        case 'inserisci': {
          const text = requireString(args, 'testo')
          const document = await notebook.insert(
            path,
            numberArg(args, 'riga') ?? Number.MAX_SAFE_INTEGER,
            text,
            actor
          )
          remember(context, document)
          return { content: `Testo inserito in ${path}.`, summary: `Aggiornata la nota ${path}` }
        }
        case 'scrivi': {
          const text = requireString(args, 'testo')
          const read = context.run.seen.get(seenKey('memory', path))
          const { document, created } = await notebook.write(path, text, actor, {
            seenRevision: read
          })
          remember(context, document)

          if (!created && read === undefined) {
            // Rewritten whole without having been read in this work: said, so it is a choice.
            return {
              content: `${path} riscritta per intero (non l'avevi letta in questo lavoro: se conteneva altro, ora non c'è più — controlla con \`storia\`).`,
              summary: `Riscritta la nota ${path}`
            }
          }

          return {
            content: created ? `Nota ${path} creata.` : `Nota ${path} riscritta.`,
            summary: `${created ? 'Creata' : 'Riscritta'} la nota ${path}`
          }
        }
        case 'elimina': {
          const deleted = await notebook.delete(path, actor)
          return {
            content: deleted
              ? `Nota ${path} eliminata (resta nella sua storia).`
              : `La nota ${path} non c'era.`,
            summary: `Eliminata la nota ${path}`
          }
        }
        case 'rinomina': {
          const target = normalizeMemoryPath(requireString(args, 'nuovo_percorso'))
          const document = await notebook.rename(path, target, actor)
          remember(context, document)
          return { content: `Nota ${path} rinominata in ${target}.`, summary: `Rinominata ${path}` }
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
            summary: `Guardata la storia di ${path}`
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
            summary: `Ripristinata ${path}`
          }
        }
        default:
          throw new ToolInputError(`\`comando\` è uno di: ${COMMANDS.join(', ')}.`)
      }
    } catch (error) {
      if (error instanceof RegistryRefusal) {
        throw new ToolInputError(error.message)
      }

      throw error
    }
  }
}
