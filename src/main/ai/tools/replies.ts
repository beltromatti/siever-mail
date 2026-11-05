import { PROMPTS } from '../prompts'
import { RegistryRefusal, type ReplyKind } from '../registry/types'
import {
  requireString,
  seenKey,
  stringArg,
  ToolInputError,
  type SegretarioTool
} from '../agent/tool-types'
import { resolveMessage } from './anchors'

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
      azione: { type: 'string', enum: ['prepara', 'conferma', 'scarta'] },
      messaggio: { type: 'string' },
      tipo: { type: 'string', enum: ['risposta', 'sollecito'] },
      testo: { type: 'string' },
      dubbi: { type: 'string' },
      motivo: { type: 'string' }
    },
    required: ['azione', 'messaggio']
  },
  running: (args) =>
    args.azione === 'prepara'
      ? args.tipo === 'sollecito'
        ? 'Preparo il sollecito…'
        : 'Preparo la risposta…'
      : 'Aggiorno la risposta preparata…',
  async execute(args, context) {
    const action = requireString(args, 'azione')
    const handle = requireString(args, 'messaggio')
    const message = await resolveMessage(context, handle)
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
            content: `${kind === 'sollecito' ? 'Sollecito' : 'Risposta'} per ${handle} ${change.action}: l'utente la trova nel lettore.`,
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
          throw new ToolInputError('`azione` è prepara, conferma o scarta.')
      }
    } catch (error) {
      if (error instanceof RegistryRefusal) {
        throw new ToolInputError(error.message)
      }

      throw error
    }
  }
}
