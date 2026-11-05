import { PROMPTS } from '../prompts'
import { RELATIVE_PERIODS, type AskedSearch, type RelativePeriod } from '../ask-mail'
import {
  booleanArg,
  numberArg,
  stringArg,
  ToolInputError,
  requireInteractive,
  type SegretarioTool
} from '../agent/tool-types'
import { clip } from './format'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A search as the list runs it — again each time, when it is kept as a folder. */
function searchOf(query: Record<string, unknown>): AskedSearch {
  const period = stringArg(query, 'periodo') as RelativePeriod | undefined
  const days = numberArg(query, 'giorni')
  const from = stringArg(query, 'dal')
  const to = stringArg(query, 'al')

  for (const [name, value] of [
    ['dal', from],
    ['al', to]
  ] as const) {
    if (value && !ISO_DAY.test(value)) {
      throw new ToolInputError(`\`${name}\` va scritto come AAAA-MM-GG.`)
    }
  }

  if (period && !RELATIVE_PERIODS.includes(period)) {
    throw new ToolInputError(`\`periodo\` è uno di: ${RELATIVE_PERIODS.join(', ')}.`)
  }

  return {
    text: stringArg(query, 'testo') ?? '',
    folder: stringArg(query, 'cartella') ?? null,
    account: stringArg(query, 'account') ?? null,
    from: from ?? null,
    to: to ?? null,
    period:
      period && !(period === 'ultimi_giorni' && !(days && days > 0))
        ? { kind: period, days: period === 'ultimi_giorni' ? (days ?? null) : null }
        : null,
    unreadOnly: booleanArg(query, 'non_lette'),
    withAttachments: booleanArg(query, 'con_allegati'),
    summary: clip((stringArg(query, 'titolo') ?? '').replace(/\s+/g, ' '), 80).text
  }
}

export const showTool: SegretarioTool = {
  name: 'mostra',
  description: PROMPTS.tools.mostra,
  parameters: {
    type: 'object',
    properties: {
      messaggio: { type: 'string' },
      bozza: { type: 'string' },
      progetto: { type: 'string' },
      evento: { type: 'string' },
      giorno: { type: 'string' },
      ricerca: {
        type: 'object',
        properties: {
          titolo: { type: 'string' },
          testo: { type: 'string' },
          account: { type: 'string' },
          cartella: { type: 'string' },
          dal: { type: 'string' },
          al: { type: 'string' },
          periodo: { type: 'string', enum: [...RELATIVE_PERIODS] },
          giorni: { type: 'integer' },
          non_lette: { type: 'boolean' },
          con_allegati: { type: 'boolean' }
        }
      }
    }
  },
  running: () => 'Te lo mostro…',
  async execute(args, context) {
    const search = args.ricerca

    if (search && typeof search === 'object' && !Array.isArray(search)) {
      const asked = searchOf(search as Record<string, unknown>)

      if (!asked.summary) {
        throw new ToolInputError(
          'Dai alla ricerca un `titolo`: è il nome della lista che l’utente vede.'
        )
      }

      // Asked in the search field: the search is what the run hands back.
      if (context.run.task === 'ricerca') {
        context.run.results.search = asked
        return {
          content: 'La ricerca è pronta: la lista si apre per l’utente.',
          summary: `Ricerca: ${asked.summary}`
        }
      }

      requireInteractive(
        context,
        'mostrare qualcosa all’utente',
        'non c’è nessuno davanti allo schermo.'
      )
      const found = await context.page.showSearch(asked, asked.summary)
      return {
        content: `Lista aperta: ${found} messaggi.`,
        summary: `Mostrata la ricerca «${asked.summary}»`
      }
    }

    requireInteractive(
      context,
      'mostrare qualcosa all’utente',
      'non c’è nessuno davanti allo schermo.'
    )
    const messageHandle = stringArg(args, 'messaggio')
    const draftHandle = stringArg(args, 'bozza')
    const projectHandle = stringArg(args, 'progetto')
    const eventHandle = stringArg(args, 'evento')
    const day = stringArg(args, 'giorno')

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
      return { content: 'Bozza aperta.', summary: 'Aperta la bozza' }
    }

    if (projectHandle) {
      const project = context.handles.project(projectHandle)

      if (!project) {
        throw new ToolInputError(`Non conosco il progetto «${projectHandle}».`)
      }

      context.page.show({ kind: 'project', projectId: project.projectId })
      return { content: 'Progetto aperto.', summary: `Aperto ${project.title}` }
    }

    if (eventHandle) {
      const event = context.handles.event(eventHandle)

      if (!event) {
        throw new ToolInputError(
          `Non conosco l'evento «${eventHandle}»: usa un riferimento e… ricevuto da \`calendario\`.`
        )
      }

      context.page.show({ kind: 'event', eventKey: event.eventKey })
      return { content: 'Evento aperto nel calendario.', summary: `Aperto ${event.title}` }
    }

    if (day) {
      if (!ISO_DAY.test(day)) {
        throw new ToolInputError('`giorno` va scritto come AAAA-MM-GG.')
      }

      context.page.show({ kind: 'day', day })
      return {
        content: 'Giorno aperto nel calendario.',
        summary: `Aperto il ${day} nel calendario`
      }
    }

    throw new ToolInputError(
      'Indica `messaggio`, `bozza`, `progetto`, `evento`, `giorno` o `ricerca`.'
    )
  }
}
