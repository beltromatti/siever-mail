import { PROMPTS } from '../prompts'
import { RegistryRefusal, RevisionConflict, type ReplyKind } from '../registry/types'
import {
  requireString,
  seenKey,
  stringArg,
  ToolConflict,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { resolveSentOrReceived } from './anchors'

/** The replies and reminders prepared and not yet taken up, each on its message. */
async function listReplies(context: ToolContext): Promise<string> {
  const replies = await context.registry.replies.withStatus(['pronta', 'da_rivedere'])

  if (replies.length === 0) {
    return 'Nessuna risposta o sollecito preparato in attesa.'
  }

  const lines: string[] = []

  for (const accountId of new Set(replies.map((reply) => reply.accountId))) {
    const ofAccount = replies.filter((reply) => reply.accountId === accountId)
    const located = await context.mail.locate(
      accountId,
      ofAccount.map((reply) => reply.messageKey)
    )

    for (const reply of ofAccount) {
      const location = located.get(reply.messageKey)

      if (!location) {
        continue
      }

      context.run.seen.set(seenKey('reply', reply.accountId, reply.messageKey), reply.revision)
      const handle = context.handles.name(
        { kind: 'message', ref: location.ref, messageKey: reply.messageKey },
        context.newHandles
      )
      lines.push(
        `- ${reply.kind === 'sollecito' ? 'sollecito' : 'risposta'} per ${handle} «${location.subject}» · ${
          reply.status === 'pronta'
            ? 'pronta'
            : `da rivedere: ${reply.staleReason ?? 'la conversazione è andata avanti'}`
        }${reply.doubts ? ` · dubbi: ${reply.doubts}` : ''}`
      )
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'Nessuna risposta o sollecito preparato in attesa.'
}

/**
 * Replies prepared ahead: what the user finds written in the reader, in
 * their voice, ready to take up — and reminders after the user's own
 * messages that wait too long. Local: nothing reaches Bozze, nor anyone,
 * until the user uses it. Any run may prepare one; a reply the user set
 * aside is not offered again.
 */
export const replyTool: SegretarioTool = {
  name: 'risposta',
  description: PROMPTS.tools.risposta,
  parameters: {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: ['elenco', 'prepara', 'conferma', 'scarta'] },
      messaggio: { type: 'string' },
      tipo: { type: 'string', enum: ['risposta', 'sollecito'] },
      testo: { type: 'string' },
      dubbi: { type: 'string' },
      motivo: { type: 'string' }
    },
    required: ['azione']
  },
  running: (args) =>
    args.azione === 'elenco'
      ? 'Guardo le risposte preparate…'
      : args.azione === 'prepara'
        ? args.tipo === 'sollecito'
          ? 'Preparo il sollecito…'
          : 'Preparo la risposta…'
        : 'Aggiorno la risposta preparata…',
  async execute(args, context) {
    const action = requireString(args, 'azione')

    if (action === 'elenco') {
      return { content: await listReplies(context), summary: 'Guardate le risposte preparate' }
    }

    const handle = requireString(args, 'messaggio')
    const message = await resolveSentOrReceived(context, handle)
    const key = seenKey('reply', message.accountId, message.messageKey)

    try {
      switch (action) {
        case 'prepara': {
          const kind = (stringArg(args, 'tipo') ??
            (message.direction === 'out' ? 'sollecito' : 'risposta')) as ReplyKind
          const { record, change } = await context.registry.saveReply(
            message,
            { kind, text: requireString(args, 'testo'), doubts: stringArg(args, 'dubbi') ?? '' },
            context.run.actor
          )
          context.run.seen.set(key, record.revision)
          return {
            content: `${change.label} per ${handle}: l'utente ${kind === 'sollecito' ? 'lo' : 'la'} trova nel lettore.`,
            summary: change.label,
            messages: [message.ref]
          }
        }
        case 'conferma': {
          const record = await context.registry.setReplyStatus(
            message.accountId,
            message.messageKey,
            'pronta',
            context.run.actor,
            { seenRevision: context.run.seen.get(key) }
          )

          if (!record) {
            throw new ToolInputError(`Per ${handle} non c'è una risposta preparata.`)
          }

          context.run.seen.set(key, record.revision)
          return { content: 'Confermata: è ancora quella giusta.', summary: 'Risposta confermata' }
        }
        case 'scarta': {
          // The user throws a reply away; the Segretario finds it overtaken.
          const record = await context.registry.setReplyStatus(
            message.accountId,
            message.messageKey,
            context.run.background ? 'superata' : 'scartata',
            context.run.actor,
            { seenRevision: context.run.seen.get(key), reason: stringArg(args, 'motivo') }
          )

          if (!record) {
            throw new ToolInputError(`Per ${handle} non c'è una risposta preparata.`)
          }

          return { content: 'Tolta: non è più da offrire.', summary: 'Risposta preparata tolta' }
        }
        default:
          throw new ToolInputError('`azione` è elenco, prepara, conferma o scarta.')
      }
    } catch (error) {
      if (error instanceof RevisionConflict) {
        context.run.seen.set(key, error.current.revision)
        throw new ToolConflict(error.message)
      }

      if (error instanceof RegistryRefusal) {
        throw new ToolInputError(error.message)
      }

      throw error
    }
  }
}
