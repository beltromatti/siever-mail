import type { MessageRef } from '@shared/models'
import type { ComposeSpec } from '@shared/segretario'

import { PROMPTS } from '../prompts'
import { comparableText } from './format'
import {
  requireInteractive,
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  UnknownHandle
} from '../agent/tool-types'

/**
 * A draft as a whole — its words, who it goes to, its subject and files —
 * in one comparable string: two that are equal are the same draft.
 */
export function draftShape(
  draft: NonNullable<Awaited<ReturnType<ToolContext['mail']['getDraft']>>>
): string {
  return JSON.stringify({
    text: comparableText(draft.text),
    to: [...draft.to].sort(),
    cc: [...draft.cc].sort(),
    bcc: [...draft.bcc].sort(),
    subject: draft.subject.trim(),
    attachments: [...draft.attachments].sort()
  })
}

/**
 * The reply the Segretario wrote to a message, as a reference to write on,
 * while it is still exactly as the Segretario left it: a draft the user
 * touched anywhere — a word, a recipient, a file — is theirs.
 */
async function untouchedReplyDraft(
  context: ToolContext,
  source: MessageRef
): Promise<string | undefined> {
  for (const draftId of await context.mail.draftsReplyingTo(source)) {
    const [left, draft] = await Promise.all([
      context.store.draftSnapshot(draftId),
      context.mail.getDraft(draftId)
    ])

    if (left !== null && draft && draftShape(draft) === left) {
      return context.handles.name({ kind: 'draft', draftId }, context.newHandles)
    }
  }

  return undefined
}

/**
 * The draft a reference names: one written here (b1…), or a message found
 * in Bozze (m1…) — a draft written earlier, in another conversation or by
 * the user — taken up and opened on the user's desk.
 */
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
    required: ['testo']
  },
  running: (args) => (args.tipo ? 'Scrivo la bozza…' : 'Scrivo…'),
  async execute(args, context) {
    const text = requireString(args, 'testo')

    // Writing in the message open in the editor: the words go there, in place.
    if (context.run.task === 'scrittura') {
      context.run.results.editorText = text
      return {
        content: context.run.editor?.selection
          ? 'Il passaggio scelto è riscritto nel messaggio.'
          : 'Il testo è nel messaggio che l’utente sta scrivendo.',
        summary: 'Scritto nel messaggio'
      }
    }

    requireInteractive(
      context,
      'scrivere bozze in Bozze',
      'prepara la risposta con `risposta` (azione `prepara`): l’utente la trova pronta nel lettore.'
    )

    const kind = KINDS[requireString(args, 'tipo')]

    if (!kind) {
      throw new ToolInputError('`tipo` è risposta, risposta_a_tutti, inoltro o nuovo.')
    }

    const spec: ComposeSpec = { kind, text }
    const sourceHandle = stringArg(args, 'messaggio')
    let answered: { accountId: string; messageKey: string } | null = null

    if (kind !== 'new') {
      if (!sourceHandle) {
        throw new ToolInputError('Per una risposta o un inoltro indica `messaggio`.')
      }

      const source = context.handles.message(sourceHandle)

      if (!source) {
        throw new UnknownHandle(`Non conosco il messaggio «${sourceHandle}».`)
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
        throw new UnknownHandle(`Non conosco il file «${handle}».`)
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

    // Kept as written, to learn from what the user changes before sending,
    // and as it was left, to know later whether the user touched it.
    if (accountId) {
      await context.store.recordDraft({
        draftId,
        activityId: context.run.activityId,
        accountId,
        text,
        snapshot: draft ? draftShape(draft) : null
      })
    }

    // The reply prepared ahead for the message is the one just written: it is not offered beside it.
    if (answered) {
      const prepared = await context.registry.replies.get(answered.accountId, answered.messageKey)

      if (prepared && (prepared.status === 'pronta' || prepared.status === 'da_rivedere')) {
        await context.registry.setReplyStatus(
          answered.accountId,
          answered.messageKey,
          'usata',
          context.run.actor
        )
      }
    }

    return {
      content: `Bozza ${handle} pronta${draft ? ` · ${draft.to.length > 0 ? `a ${draft.to.join(', ')}` : 'senza destinatari'} · oggetto «${draft.subject}»` : ''}. È aperta per l'utente e in Bozze; per inviarla usa invia_bozza.`,
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
    requireInteractive(context, 'inviare', 'prepara la risposta: la manderà l’utente.')
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
