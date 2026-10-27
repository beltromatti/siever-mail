import { folderForRole, type FolderRole } from '@shared/folders'

import { PROMPTS } from '../prompts'
import { stringArg, ToolInputError, type SegretarioTool } from '../agent/tool-types'

const ROLE_WORDS: Readonly<Record<string, FolderRole>> = {
  arrivo: '\\Inbox',
  inviata: '\\Sent',
  bozze: '\\Drafts',
  archivio: '\\Archive',
  cestino: '\\Trash',
  spam: '\\Junk'
}

export const showTool: SegretarioTool = {
  name: 'mostra',
  description: PROMPTS.tools.mostra,
  parameters: {
    type: 'object',
    properties: {
      messaggio: { type: 'string' },
      ricerca: { type: 'string' },
      account: { type: 'string' },
      cartella: { type: 'string' },
      bozza: { type: 'string' }
    }
  },
  running: () => 'Te lo mostro…',
  async execute(args, context) {
    const messageHandle = stringArg(args, 'messaggio')
    const draftHandle = stringArg(args, 'bozza')
    const query = stringArg(args, 'ricerca')

    if (messageHandle) {
      const message = context.handles.message(messageHandle)

      if (!message) {
        throw new ToolInputError(`Non conosco il messaggio «${messageHandle}».`)
      }

      context.page.show({ kind: 'message', ref: message.ref })
      return {
        content: 'Aperto nel lettore.',
        summary: 'Aperto il messaggio',
        messages: [message.ref]
      }
    }

    if (draftHandle) {
      const draftId = context.handles.draft(draftHandle)

      if (!draftId) {
        throw new ToolInputError(`Non conosco la bozza «${draftHandle}».`)
      }

      context.page.show({ kind: 'draft', draftId })
      return { content: 'Bozza aperta sulla scrivania.', summary: 'Aperta la bozza' }
    }

    if (query !== undefined) {
      const address = stringArg(args, 'account')
      const accounts = await context.mail.listAccounts()
      const account = address
        ? accounts.find((item) => item.email.toLowerCase() === address.toLowerCase())
        : null
      let folderPath: string | null = null
      const folder = stringArg(args, 'cartella')?.toLowerCase()

      if (folder) {
        const target = account ?? accounts[0]
        const folders = target ? await context.mail.listFolders(target.id) : []
        const role = ROLE_WORDS[folder]
        folderPath =
          (role ? folderForRole(folders, role)?.path : undefined) ??
          folders.find(
            (item) => item.name.toLowerCase() === folder || item.path.toLowerCase() === folder
          )?.path ??
          null
      }

      context.page.show({ kind: 'search', query, accountId: account?.id ?? null, folderPath })
      return { content: 'Ricerca mostrata nell’elenco.', summary: `Mostrata la ricerca «${query}»` }
    }

    throw new ToolInputError('Indica `messaggio`, `ricerca` o `bozza`.')
  }
}
