import type { ComposeSpec } from '@shared/segretario'

import { PROMPTS } from '../prompts'
import {
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool
} from '../agent/tool-types'

const KINDS: Readonly<Record<string, ComposeSpec['kind']>> = {
  risposta: 'reply',
  risposta_a_tutti: 'replyAll',
  inoltro: 'forward',
  nuovo: 'new'
}

export const writeDraftTool: SegretarioTool = {
  name: 'scrivi_bozza',
  description: PROMPTS.tools.scrivi_bozza,
  parameters: {
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: Object.keys(KINDS) },
      messaggio: { type: 'string' },
      account: { type: 'string' },
      a: { type: 'array', items: { type: 'string' } },
      cc: { type: 'array', items: { type: 'string' } },
      ccn: { type: 'array', items: { type: 'string' } },
      oggetto: { type: 'string' },
      testo: { type: 'string' },
      allegati: { type: 'array', items: { type: 'string' } },
      bozza: { type: 'string' }
    },
    required: ['tipo', 'testo']
  },
  running: () => 'Scrivo la bozza…',
  async execute(args, context) {
    const kind = KINDS[requireString(args, 'tipo')]

    if (!kind) {
      throw new ToolInputError('`tipo` è risposta, risposta_a_tutti, inoltro o nuovo.')
    }

    const text = requireString(args, 'testo')
    const spec: ComposeSpec = { kind, text }
    const sourceHandle = stringArg(args, 'messaggio')

    if (kind !== 'new') {
      if (!sourceHandle) {
        throw new ToolInputError('Per una risposta o un inoltro indica `messaggio`.')
      }

      const source = context.handles.message(sourceHandle)

      if (!source) {
        throw new ToolInputError(`Non conosco il messaggio «${sourceHandle}».`)
      }

      spec.source = source.ref
    } else {
      const accounts = await context.mail.listAccounts()
      const address = stringArg(args, 'account')
      const account = address
        ? accounts.find((item) => item.email.toLowerCase() === address.toLowerCase())
        : accounts.length === 1
          ? accounts[0]
          : undefined

      if (!account) {
        throw new ToolInputError(
          `Indica \`account\` tra: ${accounts.map((item) => item.email).join(', ')}.`
        )
      }

      spec.accountId = account.id
      spec.subject = stringArg(args, 'oggetto') ?? ''
    }

    for (const [field, name] of [
      ['to', 'a'],
      ['cc', 'cc'],
      ['bcc', 'ccn']
    ] as const) {
      const addresses = stringListArg(args, name)

      if (addresses.length > 0) {
        spec[field] = addresses
      }
    }

    if (kind === 'new' && !spec.to?.length) {
      throw new ToolInputError('Un messaggio nuovo ha bisogno di almeno un destinatario in `a`.')
    }

    const attachments: Array<{ path: string; name: string }> = []

    for (const handle of stringListArg(args, 'allegati')) {
      const file = context.handles.file(handle)

      if (!file) {
        throw new ToolInputError(`Non conosco il file «${handle}».`)
      }

      if (file.kind === 'path') {
        attachments.push({ path: file.path, name: file.fileName })
      } else {
        attachments.push(...(await context.mail.copyAttachments(file.ref, [file.attachmentId])))
      }
    }

    if (attachments.length > 0) {
      spec.attachments = attachments
    }

    const rewrite = stringArg(args, 'bozza')

    if (rewrite) {
      const draftId = context.handles.draft(rewrite)

      if (!draftId) {
        throw new ToolInputError(`Non conosco la bozza «${rewrite}».`)
      }

      spec.draftId = draftId
    }

    const draftId = await context.page.compose(spec, context.signal)
    const handle = context.handles.name({ kind: 'draft', draftId }, context.newHandles)
    const draft = await context.mail.getDraft(draftId)

    return {
      content: `Bozza ${handle} pronta${draft ? ` · da ${draft.to.length > 0 ? `a ${draft.to.join(', ')}` : 'senza destinatari'} · oggetto «${draft.subject}»` : ''}. È sulla scrivania dell'utente e in Bozze; per inviarla usa invia_bozza.`,
      summary: rewrite ? 'Corretta la bozza' : 'Preparata una bozza'
    }
  }
}

export const sendDraftTool: SegretarioTool = {
  name: 'invia_bozza',
  description: PROMPTS.tools.invia_bozza,
  parameters: {
    type: 'object',
    properties: { bozza: { type: 'string' } },
    required: ['bozza']
  },
  running: () => 'Aspetto la conferma per inviare…',
  async execute(args, context) {
    const handle = requireString(args, 'bozza')
    const draftId = context.handles.draft(handle)

    if (!draftId) {
      throw new ToolInputError(`Non conosco la bozza «${handle}».`)
    }

    const draft = await context.mail.getDraft(draftId)

    if (!draft) {
      return {
        content: "La bozza non c'è più: l'utente l'ha già inviata o scartata.",
        summary: 'Bozza non più disponibile',
        failed: true
      }
    }

    if (draft.to.length + draft.cc.length + draft.bcc.length === 0) {
      throw new ToolInputError(
        'La bozza non ha destinatari: aggiungili con scrivi_bozza prima di inviarla.'
      )
    }

    const { approved, outcome } = await context.requestApproval({
      kind: 'send',
      title: `Invio a ${draft.to.join(', ') || draft.cc.join(', ')}`,
      draft: { draftId, ...draft }
    })

    if (!approved) {
      return {
        content: "L'utente ha preferito non inviarla per ora. La bozza resta in Bozze.",
        summary: 'Non inviato: non hai confermato'
      }
    }

    if (outcome && !outcome.sent) {
      return {
        content: `L'invio non è riuscito: ${outcome.error}. La bozza è in Bozze come era.`,
        summary: 'Invio non riuscito',
        failed: true
      }
    }

    return {
      content: 'Inviato.',
      summary: `Inviato con la tua conferma · «${draft.subject || 'Senza oggetto'}»`
    }
  }
}
