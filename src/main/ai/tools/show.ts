import { defineMessages } from '@shared/i18n'

import { messages } from '../../i18n'
import { PROMPTS } from '../prompts'
import { RELATIVE_PERIODS, type AskedSearch, type RelativePeriod } from '../ask-mail'
import {
  booleanArg,
  numberArg,
  stringArg,
  ToolInputError,
  requireInteractive,
  type SegretarioTool,
  UnknownHandle
} from '../agent/tool-types'
import { clip } from './format'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The step's lines, as the user sees them in the panel. */
const STEPS = defineMessages({
  running: { en: 'Showing you…', it: 'Te lo mostro…', de: 'Zeige es Ihnen…' },
  search: {
    en: (title: string) => `Search: ${title}`,
    it: (title: string) => `Ricerca: ${title}`,
    de: (title: string) => `Suche: ${title}`
  },
  shownSearch: {
    en: (title: string) => `Showed the search “${title}”`,
    it: (title: string) => `Mostrata la ricerca «${title}»`,
    de: (title: string) => `Suche „${title}“ angezeigt`
  },
  openedMessage: { en: 'Opened the message', it: 'Aperto il messaggio', de: 'Nachricht geöffnet' },
  openedDraft: { en: 'Opened the draft', it: 'Aperta la bozza', de: 'Entwurf geöffnet' },
  opened: {
    en: (title: string) => `Opened ${title}`,
    it: (title: string) => `Aperto ${title}`,
    de: (title: string) => `${title} geöffnet`
  },
  openedDay: {
    en: (day: string) => `Opened ${day} in the calendar`,
    it: (day: string) => `Aperto il ${day} nel calendario`,
    de: (day: string) => `${day} im Kalender geöffnet`
  }
})

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
  running: () => messages(STEPS).running,
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
          summary: messages(STEPS).search(asked.summary)
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
        summary: messages(STEPS).shownSearch(asked.summary)
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
        throw new UnknownHandle(`Non conosco il messaggio «${messageHandle}».`)
      }

      context.page.show({ kind: 'message', ref: message.ref })
      return {
        content: 'Aperto nel lettore.',
        summary: messages(STEPS).openedMessage,
        messages: [message.ref]
      }
    }

    if (draftHandle) {
      const draftId = context.handles.draft(draftHandle)

      if (!draftId) {
        throw new UnknownHandle(`Non conosco la bozza «${draftHandle}».`)
      }

      context.page.show({ kind: 'draft', draftId })
      return { content: 'Bozza aperta.', summary: messages(STEPS).openedDraft }
    }

    if (projectHandle) {
      const project = context.handles.project(projectHandle)

      if (!project) {
        throw new UnknownHandle(`Non conosco il progetto «${projectHandle}».`)
      }

      context.page.show({ kind: 'project', projectId: project.projectId })
      return { content: 'Progetto aperto.', summary: messages(STEPS).opened(project.title) }
    }

    if (eventHandle) {
      const event = context.handles.event(eventHandle)

      if (!event) {
        throw new UnknownHandle(
          `Non conosco l'evento «${eventHandle}»: usa un riferimento e… ricevuto da \`calendario\`.`
        )
      }

      context.page.show({ kind: 'event', eventKey: event.eventKey })
      return {
        content: 'Evento aperto nel calendario.',
        summary: messages(STEPS).opened(event.title)
      }
    }

    if (day) {
      if (!ISO_DAY.test(day)) {
        throw new ToolInputError('`giorno` va scritto come AAAA-MM-GG.')
      }

      context.page.show({ kind: 'day', day })
      return {
        content: 'Giorno aperto nel calendario.',
        summary: messages(STEPS).openedDay(day)
      }
    }

    throw new ToolInputError(
      'Indica `messaggio`, `bozza`, `progetto`, `evento`, `giorno` o `ricerca`.'
    )
  }
}
