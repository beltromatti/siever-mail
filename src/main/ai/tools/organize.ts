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
  running: () => 'Metto in ordine…',
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
      summary: `${ACTION_LINES[action]} ${countOf(done, 'messaggio', 'messaggi')}`,
      messages: refs,
      failed: done === 0
    }
  }
}
