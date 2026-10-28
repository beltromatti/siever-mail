import type { CalendarEvent, CalendarResponse } from '@shared/calendar'

import {
  booleanArg,
  stringArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { PROMPTS } from '../prompts'
import { countOf } from './format'

/** Without dates, the agenda listed: today and the week after. */
const DEFAULT_DAYS = 8
/** The most days one look reaches. */
const MAX_DAYS = 62

const DAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

const RESPONSE_WORDS: Readonly<Record<CalendarResponse, string>> = {
  accepted: 'partecipa',
  tentative: 'forse',
  declined: 'non partecipa',
  needsAction: 'non ha ancora risposto'
}

/** A day written AAAA-MM-GG, at its local midnight. */
function localDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

function eventLine(event: CalendarEvent, context: ToolContext): string {
  const handle = context.handles.name(
    { kind: 'event', eventKey: event.key, title: event.title },
    context.newHandles
  )
  const when = event.allDay
    ? `${DAY.format(new Date(`${event.start}T00:00`))}, tutto il giorno`
    : `${DAY.format(new Date(event.start))} ${TIME.format(new Date(event.start))}–${TIME.format(new Date(event.end))}`
  const others = event.attendees.filter((attendee) => !attendee.self)

  return [
    `${handle} · ${when} · ${event.title}`,
    event.location ? `   luogo: ${event.location}` : null,
    others.length > 0
      ? `   con: ${others
          .slice(0, 8)
          .map(
            (attendee) =>
              `${attendee.name ?? attendee.email} (${RESPONSE_WORDS[attendee.response]})`
          )
          .join(', ')}${others.length > 8 ? ` e altri ${others.length - 8}` : ''}`
      : null,
    event.myResponse && event.myResponse !== 'accepted'
      ? `   l'utente: ${RESPONSE_WORDS[event.myResponse]}`
      : null,
    event.description ? `   ${event.description.replace(/\s+/g, ' ').slice(0, 200)}` : null
  ]
    .filter(Boolean)
    .join('\n')
}

/** "AAAA-MM-GGTHH:MM" (local) or, all day, "AAAA-MM-GG": as the provider takes it. */
function instant(value: string | undefined, allDay: boolean, name: string): string {
  const text = value?.trim() ?? ''

  if (allDay) {
    if (!localDay(text)) {
      throw new ToolInputError(`\`${name}\` è una data AAAA-MM-GG.`)
    }

    return text
  }

  const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? new Date(text) : null

  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new ToolInputError(`\`${name}\` è una data e un'ora AAAA-MM-GGTHH:MM.`)
  }

  return parsed.toISOString()
}

export const calendarTool: SegretarioTool = {
  name: 'calendario',
  description: PROMPTS.tools.calendario,
  parameters: {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: ['elenco', 'crea', 'rispondi'] },
      da: { type: 'string' },
      a: { type: 'string' },
      titolo: { type: 'string' },
      inizio: { type: 'string' },
      fine: { type: 'string' },
      tutto_il_giorno: { type: 'boolean' },
      luogo: { type: 'string' },
      descrizione: { type: 'string' },
      invitati: { type: 'array', items: { type: 'string' } },
      account: { type: 'string' },
      evento: { type: 'string' },
      risposta: { type: 'string', enum: ['accepted', 'tentative', 'declined'] }
    },
    required: ['azione']
  },
  running: (args) =>
    stringArg(args, 'azione') === 'crea'
      ? 'Preparo l’evento…'
      : stringArg(args, 'azione') === 'rispondi'
        ? 'Preparo la risposta all’invito…'
        : 'Guardo il calendario…',
  async execute(args, context) {
    const connected = await context.calendar.connectedAccountIds()

    if (connected.length === 0) {
      throw new ToolInputError(
        "Nessun calendario collegato: l'utente lo collega in Impostazioni › Account."
      )
    }

    const action = stringArg(args, 'azione')

    if (action === 'crea') {
      const allDay = booleanArg(args, 'tutto_il_giorno')
      const title = stringArg(args, 'titolo')?.trim()

      if (!title) {
        throw new ToolInputError(
          'Manca `titolo`. Per creare un evento servono insieme `titolo`, `inizio`, `fine` e, se li sai, `luogo` e `descrizione`.'
        )
      }

      const accounts = await context.mail.listAccounts()
      const calendars = accounts.filter((candidate) => connected.includes(candidate.id))
      const wanted = stringArg(args, 'account')?.toLowerCase()
      // The user's calendar is one, whichever account the mail came to: with one connected, it is that.
      const account =
        calendars.length === 1
          ? calendars[0]
          : calendars.find((candidate) => candidate.email.toLowerCase() === wanted)

      if (!account) {
        throw new ToolInputError(
          `Dimmi in quale calendario: \`account\`, uno tra ${calendars.map((candidate) => candidate.email).join(', ')}.`
        )
      }

      const start = instant(stringArg(args, 'inizio'), allDay, 'inizio')
      const end = instant(stringArg(args, 'fine'), allDay, 'fine')

      if (allDay ? end < start : Date.parse(end) <= Date.parse(start)) {
        throw new ToolInputError(
          allDay
            ? '`fine` è il giorno dopo l’ultimo, non prima di `inizio`.'
            : '`fine` viene dopo `inizio`.'
        )
      }
      const attendees = Array.isArray(args.invitati)
        ? args.invitati.map((value) => String(value).trim()).filter(Boolean)
        : []
      const location = stringArg(args, 'luogo')?.trim() || null
      const description = stringArg(args, 'descrizione')?.trim() || null
      const when = allDay
        ? `${DAY.format(new Date(`${start}T00:00`))}, tutto il giorno`
        : `${DAY.format(new Date(start))} ${TIME.format(new Date(start))}–${TIME.format(new Date(end))}`

      const { approved } = await context.requestApproval({
        kind: 'action',
        title: `Mettere in calendario «${title}»`,
        details: [
          when,
          location ? `Luogo: ${location}` : null,
          attendees.length > 0 ? `Invitati, che ricevono l'invito: ${attendees.join(', ')}` : null,
          `Nel calendario di ${account.email}`
        ].filter((line): line is string => line !== null),
        confirmLabel: 'Metti in calendario'
      })

      if (!approved) {
        return {
          content: "L'utente non ha confermato: niente in calendario.",
          summary: 'Evento non creato'
        }
      }

      const created = await context.calendar.create({
        accountId: account.id,
        title,
        start,
        end,
        allDay,
        location,
        description,
        attendees
      })

      return {
        content: `Fatto:\n${eventLine(created, context)}`,
        summary: `Messo in calendario «${created.title}»`
      }
    }

    if (action === 'rispondi') {
      const target = context.handles.event(stringArg(args, 'evento') ?? '')
      const response = stringArg(args, 'risposta') as
        Exclude<CalendarResponse, 'needsAction'> | undefined

      if (!target || !response) {
        throw new ToolInputError('Dimmi l’evento (`evento`, un riferimento e…) e la `risposta`.')
      }

      const { approved } = await context.requestApproval({
        kind: 'action',
        title: `Rispondere all'invito «${target.title}»`,
        details: [`Risposta: ${RESPONSE_WORDS[response]}`, "L'organizzatore lo saprà."],
        confirmLabel: 'Rispondi'
      })

      if (!approved) {
        return {
          content: "L'utente non ha confermato: nessuna risposta data.",
          summary: 'Invito senza risposta'
        }
      }

      const answered = await context.calendar.respond(target.eventKey, response)
      return {
        content: `Fatto:\n${eventLine(answered, context)}`,
        summary: `Risposto all'invito «${answered.title}»`
      }
    }

    const today = new Date()
    const from =
      localDay(stringArg(args, 'da') ?? '') ??
      new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const last = localDay(stringArg(args, 'a') ?? '')
    const to = last
      ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
      : new Date(from.getFullYear(), from.getMonth(), from.getDate() + DEFAULT_DAYS)

    if (to <= from || to.getTime() - from.getTime() > MAX_DAYS * 24 * 60 * 60 * 1000) {
      throw new ToolInputError(`Un intervallo da uno a ${MAX_DAYS} giorni, \`da\` prima di \`a\`.`)
    }

    const events = await context.calendar.events(from.toISOString(), to.toISOString())

    return {
      content:
        events.length > 0
          ? `${countOf(events.length, 'evento', 'eventi')} dal ${DAY.format(from)} al ${DAY.format(new Date(to.getTime() - 1))}:\n\n${events
              .map((event) => eventLine(event, context))
              .join('\n')}`
          : `Niente in calendario dal ${DAY.format(from)} al ${DAY.format(new Date(to.getTime() - 1))}.`,
      summary: `Guardato il calendario · ${countOf(events.length, 'evento', 'eventi')}`
    }
  }
}
