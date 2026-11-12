import { defineMessages } from '@shared/i18n'

import { messages } from '../../i18n'
import { PROMPTS } from '../prompts'
import {
  requireInteractive,
  requireString,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  UnknownHandle
} from '../agent/tool-types'
import { countOf } from './format'

const ORGANIZE_ACTIONS = [
  'archivia',
  'sposta',
  'contrassegna',
  'togli_contrassegno',
  'segna_letto',
  'segna_non_letto',
  'cestina'
] as const

const ACTION_LINES: Readonly<Record<(typeof ORGANIZE_ACTIONS)[number], string>> = {
  archivia: 'Archiviati',
  sposta: 'Spostati',
  contrassegna: 'Contrassegnati',
  togli_contrassegno: 'Tolto il contrassegno a',
  segna_letto: 'Segnati come letti',
  segna_non_letto: 'Segnati come non letti',
  cestina: 'Spostati nel cestino'
}

/** The step's lines, as the user sees them in the panel. */
const STEPS = defineMessages({
  running: { en: 'Tidying up…', it: 'Metto in ordine…', de: 'Räume auf…' },
  archivia: {
    en: (count: number) => `Archived ${count === 1 ? '1 message' : `${count} messages`}`,
    it: (count: number) => `Archiviati ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
    de: (count: number) => `${count === 1 ? '1 Nachricht' : `${count} Nachrichten`} archiviert`
  },
  sposta: {
    en: (count: number) => `Moved ${count === 1 ? '1 message' : `${count} messages`}`,
    it: (count: number) => `Spostati ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
    de: (count: number) => `${count === 1 ? '1 Nachricht' : `${count} Nachrichten`} verschoben`
  },
  contrassegna: {
    en: (count: number) => `Flagged ${count === 1 ? '1 message' : `${count} messages`}`,
    it: (count: number) => `Contrassegnati ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
    de: (count: number) => `${count === 1 ? '1 Nachricht' : `${count} Nachrichten`} markiert`
  },
  togli_contrassegno: {
    en: (count: number) => `Unflagged ${count === 1 ? '1 message' : `${count} messages`}`,
    it: (count: number) =>
      `Tolto il contrassegno a ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
    de: (count: number) =>
      `Markierung von ${count === 1 ? '1 Nachricht' : `${count} Nachrichten`} entfernt`
  },
  segna_letto: {
    en: (count: number) => `Marked ${count === 1 ? '1 message' : `${count} messages`} as read`,
    it: (count: number) =>
      `Segnati come letti ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
    de: (count: number) =>
      `${count === 1 ? '1 Nachricht' : `${count} Nachrichten`} als gelesen markiert`
  },
  segna_non_letto: {
    en: (count: number) => `Marked ${count === 1 ? '1 message' : `${count} messages`} as unread`,
    it: (count: number) =>
      `Segnati come non letti ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
    de: (count: number) =>
      `${count === 1 ? '1 Nachricht' : `${count} Nachrichten`} als ungelesen markiert`
  },
  cestina: {
    en: (count: number) => `Moved ${count === 1 ? '1 message' : `${count} messages`} to the Trash`,
    it: (count: number) =>
      `Spostati nel cestino ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
    de: (count: number) =>
      `${count === 1 ? '1 Nachricht' : `${count} Nachrichten`} in den Papierkorb verschoben`
  }
})

/**
 * Puts mail in order as the user's own clicks would — the same operations,
 * with the same undo. Only with the user at the screen: moving mail is
 * theirs to decide, and a run that reads mail it cannot trust never does.
 */
export const organizeTool: SegretarioTool = {
  name: 'organizza',
  description: PROMPTS.tools.organizza,
  parameters: {
    type: 'object',
    properties: {
      messaggi: { type: 'array', items: { type: 'string' } },
      azione: { type: 'string', enum: [...ORGANIZE_ACTIONS] },
      cartella: { type: 'string' }
    },
    required: ['messaggi', 'azione']
  },
  running: () => messages(STEPS).running,
  async execute(args, context) {
    requireInteractive(
      context,
      'spostare, archiviare o cestinare la posta',
      'è una decisione dell’utente. Se pensi che serva, diglielo quando parlate.'
    )
    const action = requireString(args, 'azione') as (typeof ORGANIZE_ACTIONS)[number]

    if (!ORGANIZE_ACTIONS.includes(action)) {
      throw new ToolInputError(`\`azione\` è una di: ${ORGANIZE_ACTIONS.join(', ')}.`)
    }

    const refs = stringListArg(args, 'messaggi').map((handle) => {
      const message = context.handles.message(handle)

      if (!message) {
        throw new UnknownHandle(`Non conosco il messaggio «${handle}».`)
      }

      return message.ref
    })

    if (refs.length === 0) {
      throw new ToolInputError('Indica almeno un messaggio.')
    }

    let result

    switch (action) {
      case 'archivia':
        result = await context.mail.archive(refs)
        break
      case 'sposta': {
        const folderName = requireString(args, 'cartella').toLowerCase()
        const accountIds = [...new Set(refs.map((ref) => ref.accountId))]

        if (accountIds.length > 1) {
          throw new ToolInputError(
            'Sposta i messaggi di un account alla volta: le cartelle sono di ciascun account.'
          )
        }

        const folders = await context.mail.listFolders(accountIds[0])
        const folder = folders.find(
          (item) => item.path.toLowerCase() === folderName || item.name.toLowerCase() === folderName
        )

        if (!folder) {
          throw new ToolInputError(
            `Nessuna cartella «${folderName}» in questo account. Ci sono: ${folders.map((item) => item.path).join(', ')}.`
          )
        }

        result = await context.mail.move(refs, folder.path)
        break
      }
      case 'contrassegna':
        result = await context.mail.setFlagged(refs, true)
        break
      case 'togli_contrassegno':
        result = await context.mail.setFlagged(refs, false)
        break
      case 'segna_letto':
        result = await context.mail.setSeen(refs, true)
        break
      case 'segna_non_letto':
        result = await context.mail.setSeen(refs, false)
        break
      case 'cestina':
        result = await context.mail.trash(refs)
        break
    }

    const failed = result.failed.length
    const done = refs.length - failed

    return {
      content:
        failed === 0
          ? `${ACTION_LINES[action]} ${countOf(done, 'messaggio', 'messaggi')}.`
          : `${ACTION_LINES[action]} ${countOf(done, 'messaggio', 'messaggi')}; ${failed} non riusciti${result.error ? `: ${result.error}` : '.'}`,
      summary: messages(STEPS)[action](done),
      messages: refs,
      failed: done === 0
    }
  }
}
