import { PROMPTS } from '../prompts'
import {
  lookingKey,
  requireString,
  stringArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  type ToolOutcome
} from '../agent/tool-types'
import { resolveEvent, resolveSentOrReceived } from './anchors'

/** Who tells: the run that looks at the arrival or the change; with the user there, it says it. */
function notTheirs(context: ToolContext, what: string): ToolInputError {
  return new ToolInputError(
    context.run.watched
      ? 'Con l’utente davanti, diglielo e basta: una notifica è per quando non guarda.'
      : what
  )
}

/** A message that came, told now: by its reading, once. */
async function alertOfMessage(
  context: ToolContext,
  handle: string,
  line: string
): Promise<ToolOutcome> {
  const message = await resolveSentOrReceived(context, handle)

  if (message.direction === 'out') {
    throw new ToolInputError(`${handle} l'ha scritto l'utente: lo sa già.`)
  }

  const target = {
    kind: 'message',
    accountId: message.accountId,
    messageKey: message.messageKey
  } as const

  if (!context.run.looking.has(lookingKey(target))) {
    throw notTheirs(
      context,
      `Di un messaggio avvisa la lettura che lo legge, quando arriva: ${handle} non è tra quelli che leggi.`
    )
  }

  const [before] = await context.registry.alerts.of(target)

  if (before) {
    throw new ToolInputError(
      `${before.delivered ? "L'utente l'ha già saputo" : "Ne hai già deciso l'avviso, che non gli è arrivato"}: «${before.text}». Un messaggio si avvisa una volta.`
    )
  }

  // Kept even where it does not arrive: a copy come to a mailbox the user hears is told there.
  const result = await context.mail.alert(target, line)
  await context.registry.alerts.told(
    target,
    line,
    context.run.actor.runId ?? null,
    result === 'told'
  )

  if (result === 'told') {
    return {
      content: `Avvisato l'utente: «${line}».`,
      summary: 'Avvisato l’utente',
      messages: [message.ref]
    }
  }

  return result === 'off'
    ? {
        content:
          "I tuoi avvisi della posta non gli arrivano — notifiche spente o casella silenziata, o le vuole tutte com'è —: lo vedrà da sé.",
        summary: 'Avviso non mandato: notifiche della posta spente, o tutte com’è'
      }
    : {
        content: `Di ${handle} non parte una notifica: non è tra i messaggi appena arrivati nella Posta in arrivo che aspettano — l'utente l'ha già aperto, oppure è arrivato in un'altra cartella o da tempo. Lo trova nella posta.`,
        summary: 'Avviso non mandato: il messaggio non aspetta una notifica'
      }
}

/** An event that changed, told now: by the look at its change, once for each change. */
async function alertOfEvent(
  context: ToolContext,
  handle: string,
  line: string
): Promise<ToolOutcome> {
  const event = resolveEvent(context, handle)
  const target = { kind: 'event', eventKey: event.eventKey } as const

  if (!context.run.looking.has(lookingKey(target))) {
    throw notTheirs(
      context,
      `Di un evento avvisa chi ne guarda il cambiamento: «${event.title}» non è tra i cambiamenti che guardi.`
    )
  }

  const runId = context.run.actor.runId ?? null

  if ((await context.registry.alerts.of(target)).some((alert) => alert.runId === runId)) {
    throw new ToolInputError(
      `Di «${event.title}» hai già deciso l'avviso: un cambiamento si avvisa una volta.`
    )
  }

  const result = await context.calendar.alert(event.eventKey, line)

  if (result === 'unknown') {
    throw new ToolInputError(
      `«${event.title}» non è più nel calendario e non ne resta traccia: non posso avvisarne.`
    )
  }

  await context.registry.alerts.told(target, line, runId, result === 'told')

  if (result === 'told') {
    return {
      content: `Avvisato l'utente di «${event.title}»: «${line}».`,
      summary: 'Avvisato l’utente'
    }
  }

  return {
    content: `I tuoi avvisi del calendario non gli arrivano — ha spento le novità, o le vuole tutte com'è —: «${event.title}» lo vedrà da sé.`,
    summary: 'Avviso non mandato: novità del calendario spente, o tutte com’è'
  }
}

/**
 * Tells the user now what cannot wait (vision §13.3): an action, not a note
 * — of the run that looks at a thing as it arrives or changes: a message's
 * reading, once; the look at a calendar's change, once for that change. It
 * stays with the thing, found again when it is read.
 */
export const alertTool: SegretarioTool = {
  name: 'avvisa',
  description: PROMPTS.tools.avvisa,
  parameters: {
    type: 'object',
    properties: {
      messaggio: { type: 'string' },
      evento: { type: 'string' },
      riga: { type: 'string' }
    },
    required: ['riga']
  },
  running: () => 'Avviso l’utente…',
  async execute(args, context) {
    const message = stringArg(args, 'messaggio')
    const event = stringArg(args, 'evento')
    const line = requireString(args, 'riga').replace(/\s+/g, ' ').trim()

    if (message && event) {
      throw new ToolInputError('Un avviso è di una cosa sola: `messaggio` oppure `evento`.')
    }

    if (message) {
      return alertOfMessage(context, message, line)
    }

    if (event) {
      return alertOfEvent(context, event, line)
    }

    throw new ToolInputError(
      'Indica di che cosa avvisi: un `messaggio` (m…) oppure un `evento` (e…).'
    )
  }
}
