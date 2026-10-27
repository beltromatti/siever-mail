import type { AiStore } from '../ai-store'
import { PROMPTS } from '../prompts'
import {
  numberArg,
  requireString,
  stringArg,
  ToolInputError,
  type SegretarioTool
} from '../agent/tool-types'

/** Notes are short by design: a note this long is a note to split. */
const MAX_NOTE_CHARS = 20_000

/**
 * A note's path as kept: relative, with forward slashes, ending in `.md`,
 * never climbing out of the notebook.
 */
export function normalizeMemoryPath(path: string): string {
  const cleaned = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^memoria\//, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/')

  if (!cleaned || cleaned.split('/').includes('..')) {
    throw new ToolInputError(`Percorso non valido: «${path}».`)
  }

  return cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`
}

/** The first line of a note, which says what it is about. */
export function memoryHeadline(content: string): string {
  const line = content.split('\n').find((candidate) => candidate.trim()) ?? ''
  return line
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, 160)
}

/** The notebook's index: each note and its first line. */
export async function memoryIndex(store: AiStore): Promise<string> {
  const notes = await store.listMemory()

  return notes.length === 0
    ? '(la memoria è vuota)'
    : notes.map((note) => `- ${note.path} — ${memoryHeadline(note.content)}`).join('\n')
}

export const memoryTool: SegretarioTool = {
  name: 'memoria',
  description: PROMPTS.tools.memoria,
  parameters: {
    type: 'object',
    properties: {
      comando: {
        type: 'string',
        enum: ['leggi', 'scrivi', 'sostituisci', 'inserisci', 'elimina', 'rinomina']
      },
      percorso: { type: 'string' },
      testo: { type: 'string' },
      vecchio: { type: 'string' },
      nuovo: { type: 'string' },
      riga: { type: 'integer' },
      nuovo_percorso: { type: 'string' }
    },
    required: ['comando']
  },
  running: (args) => (args.comando === 'leggi' ? 'Rileggo la memoria…' : 'Aggiorno la memoria…'),
  async execute(args, context) {
    const command = requireString(args, 'comando')
    const rawPath = stringArg(args, 'percorso')

    if (command === 'leggi' && !rawPath) {
      return {
        content: await memoryIndex(context.store),
        summary: 'Riletto l’indice della memoria'
      }
    }

    const path = normalizeMemoryPath(rawPath ?? '')
    const existing = await context.store.readMemory(path)

    switch (command) {
      case 'leggi': {
        if (!existing) {
          throw new ToolInputError(
            `La nota «${path}» non esiste. ${await memoryIndex(context.store)}`
          )
        }

        const numbered = existing.content
          .split('\n')
          .map((line, index) => `${String(index + 1).padStart(4)}  ${line}`)
          .join('\n')
        return { content: `${path}\n${numbered}`, summary: `Riletto ${path}` }
      }
      case 'scrivi': {
        const text = requireString(args, 'testo')
        checkSize(text)
        await context.store.writeMemory(path, text.trimEnd() + '\n')
        return {
          content: existing ? `Nota ${path} riscritta.` : `Nota ${path} creata.`,
          summary: `${existing ? 'Aggiornata' : 'Creata'} la nota ${path}`
        }
      }
      case 'sostituisci': {
        if (!existing) {
          throw new ToolInputError(`La nota «${path}» non esiste.`)
        }

        const before = typeof args.vecchio === 'string' ? args.vecchio : ''
        const after = typeof args.nuovo === 'string' ? args.nuovo : ''
        const count = before ? existing.content.split(before).length - 1 : 0

        if (count !== 1) {
          throw new ToolInputError(
            count === 0
              ? `«${before}» non compare in ${path}: rileggi la nota.`
              : `«${before}» compare ${count} volte in ${path}: indica un testo più lungo, che compaia una volta sola.`
          )
        }

        const next = existing.content.replace(before, after)
        checkSize(next)
        await context.store.writeMemory(path, next)
        return { content: `Nota ${path} aggiornata.`, summary: `Aggiornata la nota ${path}` }
      }
      case 'inserisci': {
        const text = requireString(args, 'testo')
        const lines = (existing?.content ?? '').split('\n')
        const at = Math.max(0, Math.min(lines.length, numberArg(args, 'riga') ?? lines.length))
        lines.splice(at, 0, ...text.split('\n'))
        const next = lines.join('\n')
        checkSize(next)
        await context.store.writeMemory(path, next)
        return { content: `Testo inserito in ${path}.`, summary: `Aggiornata la nota ${path}` }
      }
      case 'elimina': {
        const deleted = await context.store.deleteMemory(path)
        return {
          content: deleted ? `Nota ${path} eliminata.` : `La nota ${path} non c'era.`,
          summary: `Eliminata la nota ${path}`
        }
      }
      case 'rinomina': {
        if (!existing) {
          throw new ToolInputError(`La nota «${path}» non esiste.`)
        }

        const target = normalizeMemoryPath(requireString(args, 'nuovo_percorso'))

        if (await context.store.readMemory(target)) {
          throw new ToolInputError(`Esiste già una nota «${target}».`)
        }

        await context.store.renameMemory(path, target)
        return { content: `Nota ${path} rinominata in ${target}.`, summary: `Rinominata ${path}` }
      }
      default:
        throw new ToolInputError(`Comando sconosciuto «${command}».`)
    }
  }
}

function checkSize(text: string): void {
  if (text.length > MAX_NOTE_CHARS) {
    throw new ToolInputError(
      `La nota supererebbe ${MAX_NOTE_CHARS} caratteri: dividila in note più piccole.`
    )
  }
}
