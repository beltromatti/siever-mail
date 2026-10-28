import type { MessageRef } from '@shared/models'
import type { ComposeSpec } from '@shared/segretario'

import { PROMPTS } from '../prompts'
import { comparableText } from './format'
import {
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'

/**
 * The draft a reference names: one written here (b1…), or a message found
 * in Bozze (m1…) — a draft written earlier, in another conversation or by
 * the user — taken up and opened on the user's desk.
 */
/**
 * The reply the Segretario wrote to a message and the user left as it was,
 * as a reference to write on: a draft the user changed is theirs.
 */
async function untouchedReplyDraft(
  context: ToolContext,
  source: MessageRef
): Promise<string | undefined> {
  for (const draftId of await context.mail.draftsReplyingTo(source)) {
    const [written, draft] = await Promise.all([
      context.store.draftWritten(draftId),
      context.mail.getDraft(draftId)
    ])

    // Its signature and the quoted message come after: what it wrote is all still there.
    if (written !== null && draft && comparableText(draft.text).includes(comparableText(written))) {
      return context.handles.name({ kind: 'draft', draftId }, context.newHandles)
    }
  }

  return undefined
}

async function draftIdOf(context: ToolContext, handle: string): Promise<string> {
  const written = context.handles.draft(handle)

  if (written) {
    return written
  }

  const message = context.handles.message(handle)
  const taken = message ? await context.mail.draftOfMessage(message.ref) : null

  if (!taken) {
    throw new ToolInputError(
      `«${handle}» non è una bozza: usa il riferimento di scrivi_bozza (b1…) o un messaggio che sta in Bozze.`
    )
  }

  context.page.show({ kind: 'draft', draftId: taken })
  return taken
}

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
    let answered: { accountId: string; messageKey: string } | null = null

    if (kind !== 'new') {
      if (!sourceHandle) {
        throw new ToolInputError('Per una risposta o un inoltro indica `messaggio`.')
      }

      const source = context.handles.message(sourceHandle)

      if (!source) {
        throw new ToolInputError(`Non conosco il messaggio «${sourceHandle}».`)
      }

      spec.source = source.ref

      if (kind === 'reply' || kind === 'replyAll') {
        answered = { accountId: source.ref.accountId, messageKey: source.messageKey }
      }
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

    // A reply goes on the one the Segretario already wrote to that message,
    // while the user has not taken it in hand: never a second beside it.
    const rewrite =
      stringArg(args, 'bozza') ??
      (spec.source && (kind === 'reply' || kind === 'replyAll')
        ? await untouchedReplyDraft(context, spec.source)
        : undefined)

    if (rewrite) {
      const draftId = await draftIdOf(context, rewrite)

      spec.draftId = draftId
      // The draft it replaces is thrown away: what it said is no longer what was written.
      await context.store.takeDraft(draftId)
    }

    const draftId = await context.page.compose(spec, context.signal)
    const handle = context.handles.name({ kind: 'draft', draftId }, context.newHandles)
    const draft = await context.mail.getDraft(draftId)
    const accountId = draft?.accountId ?? spec.accountId ?? spec.source?.accountId

    // Kept as written, to learn from what the user changes before sending.
    if (accountId) {
      await context.store.recordDraft({ draftId, activityId: context.activityId, accountId, text })
    }

    if (answered) {
      await context.work.replyWritten(answered.accountId, answered.messageKey)
    }

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
    const draftId = await draftIdOf(context, requireString(args, 'bozza'))
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
