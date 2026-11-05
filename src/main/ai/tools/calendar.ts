import {
  calendarKey,
  type CalendarEvent,
  type CalendarResponse,
  type EventChange
} from '@shared/calendar'

import type { ProposalRecord, UndoSpec } from '../registry/types'

import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  type ToolOutcome
} from '../agent/tool-types'
import { resolveMessage } from './anchors'
import { countOf } from './format'

/** Without dates, the agenda listed: today and the week after. */
const DEFAULT_DAYS = 8
/** The most days one look reaches: a year and a little. */
const MAX_DAYS = 400
/** Free slots offered at most. */
const FREE_SLOTS_SHOWN = 12

const DAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

const RESPONSE_WORDS: Readonly<Record<CalendarResponse, string>> = {
  accepted: 'partecipa',
  tentative: 'forse',
  declined: 'non partecipa',
  needsAction: 'non ha ancora risposto'
}

const ACTIONS = ['elenco', 'liberi', 'crea', 'modifica', 'elimina', 'rispondi', 'proponi'] as const

/** A day written AAAA-MM-GG, at its local midnight. */
function localDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

export function eventLine(
  event: CalendarEvent,
  context: Pick<ToolContext, 'handles' | 'newHandles'>,
  prep?: string
): string {
  const handle = context.handles.name(
    { kind: 'event', eventKey: event.key, title: event.title },
    context.newHandles
  )
  const when = event.allDay
    ? `${DAY.format(new Date(`${event.start}T00:00`))}, tutto il giorno`
    : `${DAY.format(new Date(event.start))} ${TIME.format(new Date(event.start))}–${TIME.format(new Date(event.end))}`
  const others = event.attendees.filter((attendee) => !attendee.self)

  return [
    `${handle} · ${when} · ${event.title} · ${event.calendarName}`,
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
    event.description ? `   ${event.description.replace(/\s+/g, ' ').slice(0, 200)}` : null,
    prep ? `   preparazione già scritta: ${prep.replace(/\s+/g, ' ').slice(0, 160)}` : null
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

function range(args: Record<string, unknown>): { from: Date; to: Date } {
  const from = localDay(stringArg(args, 'da') ?? '') ?? new Date(new Date().setHours(0, 0, 0, 0))
  const lastDay =
    localDay(stringArg(args, 'a') ?? '') ??
    new Date(from.getFullYear(), from.getMonth(), from.getDate() + DEFAULT_DAYS - 1)
  const to = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)

  if (days < 1 || days > MAX_DAYS) {
    throw new ToolInputError(
      `Un periodo da uno a ${MAX_DAYS} giorni, con \`da\` prima di \`a\`. Il calendario qui tiene gli eventi da due mesi fa a un anno avanti: più indietro non c'è niente da leggere.`
    )
  }

  return { from, to }
}

function eventOf(context: ToolContext, args: Record<string, unknown>): string {
  const handle = requireString(args, 'evento')
  const event = context.handles.event(handle)

  if (!event) {
    throw new ToolInputError(
      `Non conosco l'evento «${handle}»: usa un riferimento e… ricevuto da \`calendario\`.`
    )
  }

  return event.eventKey
}

/** A change to the calendar, in the run's diary: what it did, and how to undo it. */
function recordChange(
  context: ToolContext,
  action: string,
  label: string,
  event: CalendarEvent,
  undo: UndoSpec
): void {
  context.run.changes.push({
    object: 'evento',
    action,
    label,
    accountId: event.origin?.accountId ?? null,
    threadIds: [],
    messageKeys: event.origin?.messageKey ? [event.origin.messageKey] : [],
    projectIds: [],
    id: event.key,
    undo
  })
}

/** What an event was, in the fields a change touches: to put it back. */
function beforeChange(event: CalendarEvent, change: EventChange): EventChange {
  const before: EventChange = {}

  if (change.title !== undefined) before.title = event.title
  if (change.start !== undefined || change.end !== undefined || change.allDay !== undefined) {
    before.start = event.start
    before.end = event.end
    before.allDay = event.allDay
  }
  if (change.location !== undefined) before.location = event.location
  if (change.description !== undefined) before.description = event.description
  if (change.attendees !== undefined) {
    before.attendees = event.attendees
      .filter((attendee) => !attendee.self)
      .map((attendee) => attendee.email)
  }

  return before
}

/** Whether an event brings in other people: changing it tells them. */
function hasGuests(event: Pick<CalendarEvent, 'attendees'>): boolean {
  return event.attendees.some((attendee) => !attendee.self)
}

/** The calendar an event goes in: the one named, or the only one; its key. */
async function chooseCalendar(context: ToolContext, wanted: string | undefined): Promise<string> {
  const calendars = (await context.calendar.calendars()).filter((calendar) => calendar.writable)

  if (calendars.length === 0) {
    throw new ToolInputError(
      "Nessun calendario collegato in cui scrivere: l'utente lo collega in Impostazioni › Connessioni."
    )
  }

  if (!wanted) {
    if (calendars.length === 1) {
      return calendars[0].key
    }

    throw new ToolInputError(
      `Indica \`calendario\`: ${calendars
        .map(
          (calendar) =>
            `«${calendar.name}» (${calendar.connection}${calendar.primary ? ', principale' : ''})`
        )
        .join(
          ', '
        )}. Scegli quello giusto per chi è l'evento: la tua memoria dice quale calendario è di cosa.`
    )
  }

  const folded = wanted.toLowerCase()
  const match =
    calendars.find((calendar) => calendar.key === wanted) ??
    calendars.find((calendar) =>
      `${calendar.name} ${calendar.connection}`.toLowerCase().includes(folded)
    ) ??
    calendars.find((calendar) => calendar.name.toLowerCase() === folded)

  if (!match) {
    throw new ToolInputError(
      `Nessun calendario «${wanted}». Ci sono: ${calendars.map((calendar) => `«${calendar.name}» (${calendar.connection})`).join(', ')}.`
    )
  }

  return match.key
}

/** The free stretches of the working days in a period, long enough for a meeting. */
function freeSlots(
  events: ReadonlyArray<CalendarEvent>,
  from: Date,
  to: Date,
  minutes: number,
  hours: { start: number; end: number }
): Array<{ start: Date; end: Date }> {
  const busy = events
    .filter((event) => !event.allDay && event.myResponse !== 'declined')
    .map((event) => ({
      start: new Date(event.start).getTime(),
      end: new Date(event.end).getTime()
    }))
    .sort((a, b) => a.start - b.start)
  const slots: Array<{ start: Date; end: Date }> = []
  const now = Date.now()

  for (
    let day = new Date(from);
    day < to && slots.length < FREE_SLOTS_SHOWN;
    day.setDate(day.getDate() + 1)
  ) {
    const weekday = day.getDay()

    if (weekday === 0 || weekday === 6) {
      continue
    }

    let cursor = Math.max(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours.start).getTime(),
      now
    )
    const close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours.end).getTime()

    for (const block of busy) {
      if (block.end <= cursor || block.start >= close) {
        continue
      }

      if (block.start - cursor >= minutes * 60_000) {
        slots.push({ start: new Date(cursor), end: new Date(block.start) })
      }

      cursor = Math.max(cursor, block.end)
    }

    if (close - cursor >= minutes * 60_000) {
      slots.push({ start: new Date(cursor), end: new Date(close) })
    }
  }

  return slots.slice(0, FREE_SLOTS_SHOWN)
}

function changeOf(args: Record<string, unknown>, allDay: boolean): EventChange {
  const change: EventChange = {}
  const title = stringArg(args, 'titolo')
  const start = stringArg(args, 'inizio')
  const end = stringArg(args, 'fine')

  if (title) change.title = title
  if (start) change.start = instant(start, allDay, 'inizio')
  if (end) change.end = instant(end, allDay, 'fine')
  if (args.tutto_il_giorno !== undefined) change.allDay = allDay
  if (args.luogo !== undefined) change.location = stringArg(args, 'luogo') ?? null
  if (args.descrizione !== undefined) change.description = stringArg(args, 'descrizione') ?? null
  if (args.invitati !== undefined) change.attendees = stringListArg(args, 'invitati')

  return change
}

/** When an event proposed would be, from what `proponi` kept. */
function proposedTimes(
  payload: Record<string, unknown>
): { start: Date; end: Date; allDay: boolean } | null {
  const allDay = payload.allDay === true
  const at = (value: unknown): Date | null => {
    if (typeof value !== 'string') {
      return null
    }

    const date = new Date(allDay && !value.includes('T') ? `${value}T00:00` : value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const start = at(payload.start)
  const end = at(payload.end)
  return start && end ? { start, end, allDay } : null
}

/** An event proposed, as the calendar lists it: what, when, with whom. */
function proposalLine(proposal: ProposalRecord): string {
  const times = proposedTimes(proposal.payload)
  const attendees = Array.isArray(proposal.payload.attendees)
    ? proposal.payload.attendees.filter((value): value is string => typeof value === 'string')
    : []
  const when = !times
    ? ''
    : times.allDay
      ? ` · ${DAY.format(times.start)}, tutto il giorno`
      : ` · ${DAY.format(times.start)} ${TIME.format(times.start)}–${TIME.format(times.end)}`

  return `- «${String(proposal.payload.title ?? proposal.title)}»${when}${
    attendees.length > 0 ? ` · con ${attendees.join(', ')}` : ''
  }`
}

export const calendarTool: SegretarioTool = {
  name: 'calendario',
  description: PROMPTS.tools.calendario,
  parameters: {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: [...ACTIONS] },
      da: { type: 'string' },
      a: { type: 'string' },
      durata: { type: 'integer' },
      dalle: { type: 'integer' },
      alle: { type: 'integer' },
      evento: { type: 'string' },
      calendario: { type: 'string' },
      titolo: { type: 'string' },
      inizio: { type: 'string' },
      fine: { type: 'string' },
      tutto_il_giorno: { type: 'boolean' },
      luogo: { type: 'string' },
      descrizione: { type: 'string' },
      invitati: { type: 'array', items: { type: 'string' } },
      messaggio: { type: 'string' },
      risposta: { type: 'string', enum: ['accepted', 'tentative', 'declined'] }
    },
    required: ['azione']
  },
  running: (args) =>
    ({
      crea: 'Metto in calendario…',
      modifica: 'Correggo l’evento…',
      elimina: 'Tolgo l’evento…',
      rispondi: 'Preparo la risposta all’invito…',
      proponi: 'Preparo la proposta…',
      liberi: 'Cerco gli orari liberi…'
    })[String(args.azione)] ?? 'Guardo il calendario…',
  async execute(args, context): Promise<ToolOutcome> {
    const action = requireString(args, 'azione') as (typeof ACTIONS)[number]

    switch (action) {
      case 'elenco': {
        const { from, to } = range(args)
        const events = await context.calendar.events(from.toISOString(), to.toISOString())
        const preps = await context.registry.day.preps(events.map((event) => event.key))
        const lastDay = new Date(to.getTime() - 1)
        const proposed = (await context.registry.proposals.open({ kind: 'evento' })).filter(
          (proposal) => {
            const start = proposedTimes(proposal.payload)?.start
            return start !== undefined && start >= from && start < to
          }
        )
        const lines = [
          events.length === 0
            ? `Nessun evento dal ${DAY.format(from)} al ${DAY.format(lastDay)}.`
            : `${countOf(events.length, 'evento', 'eventi')} dal ${DAY.format(from)} al ${DAY.format(lastDay)}:\n${events
                .map((event) => eventLine(event, context, preps.get(event.key)))
                .join('\n')}`
        ]

        if (proposed.length > 0) {
          lines.push(
            `Proposti da te, in attesa che l'utente li accetti:\n${proposed.map(proposalLine).join('\n')}`
          )
        }

        return {
          content: lines.join('\n\n'),
          summary: `Guardato il calendario · ${countOf(events.length, 'evento', 'eventi')}`
        }
      }
      case 'liberi': {
        const { from, to } = range(args)
        const minutes = Math.min(8 * 60, Math.max(15, numberArg(args, 'durata') ?? 60))
        const hours = { start: numberArg(args, 'dalle') ?? 9, end: numberArg(args, 'alle') ?? 18 }
        const slots = freeSlots(
          await context.calendar.events(from.toISOString(), to.toISOString()),
          from,
          to,
          minutes,
          hours
        )

        return {
          content:
            slots.length === 0
              ? 'Nessun orario libero abbastanza lungo in quel periodo, nei giorni feriali.'
              : `Liberi (giorni feriali, ${hours.start}–${hours.end}, almeno ${minutes} minuti):\n${slots
                  .map(
                    (slot) =>
                      `- ${DAY.format(slot.start)} ${TIME.format(slot.start)}–${TIME.format(slot.end)}`
                  )
                  .join('\n')}`,
          summary: `Cercati gli orari liberi · ${slots.length}`
        }
      }
      case 'crea': {
        const allDay = booleanArg(args, 'tutto_il_giorno')
        const attendees = stringListArg(args, 'invitati')

        if (attendees.length > 0 && context.run.background) {
          throw new ToolInputError(
            'Un evento con invitati manda loro un invito: da solo non puoi. Usa `proponi`, e l’utente lo crea con un clic.'
          )
        }

        const key = await chooseCalendar(context, stringArg(args, 'calendario'))
        const source = stringArg(args, 'messaggio')
          ? await resolveMessage(context, stringArg(args, 'messaggio')!)
          : null
        const event = {
          calendarKey: key,
          title: requireString(args, 'titolo'),
          start: instant(stringArg(args, 'inizio'), allDay, 'inizio'),
          end: instant(stringArg(args, 'fine'), allDay, 'fine'),
          allDay,
          location: stringArg(args, 'luogo') ?? null,
          description: stringArg(args, 'descrizione') ?? null,
          attendees,
          origin: {
            by: 'segretario' as const,
            messageKey: source?.messageKey ?? null,
            accountId: source?.accountId ?? null
          }
        }

        if (attendees.length > 0) {
          const { approved } = await context.requestApproval({
            kind: 'action',
            title: `Nuovo evento: ${event.title}`,
            details: [
              `Quando: ${event.start}${allDay ? '' : ` – ${event.end}`}`,
              ...(event.location ? [`Dove: ${event.location}`] : []),
              `Invitati: ${attendees.join(', ')} (ricevono l'invito)`
            ],
            confirmLabel: 'Crea e invita'
          })

          if (!approved) {
            return {
              content: "L'utente non l'ha confermato: niente evento.",
              summary: 'Evento non creato'
            }
          }
        }

        const created = await context.calendar.create(event)
        recordChange(context, 'creato', `In calendario: ${created.title}`, created, {
          kind: 'evento-creato',
          eventKey: created.key
        })
        return {
          content: `Creato: ${eventLine(created, context)}`,
          summary: `In calendario: ${created.title}`
        }
      }
      case 'modifica': {
        const key = eventOf(context, args)
        const current = await context.calendar.event(key)

        if (!current) {
          throw new ToolInputError("L'evento non c'è più.")
        }

        const change = changeOf(
          args,
          args.tutto_il_giorno !== undefined ? booleanArg(args, 'tutto_il_giorno') : current.allDay
        )
        // People are told of a change to an event they are in — and invited by one that adds them.
        const invited = change.attendees ?? []

        if (
          hasGuests(current) ||
          invited.length > 0 ||
          (current.organizer && current.myResponse !== null)
        ) {
          if (context.run.background) {
            throw new ToolInputError(
              'L’evento coinvolge altre persone, o le invita: correggerlo le avvisa. Da solo non puoi: proponilo con `proponi` e spiegane il motivo.'
            )
          }

          const { approved } = await context.requestApproval({
            kind: 'action',
            title: `Modifica: ${current.title}`,
            details:
              invited.length > 0
                ? [`Invitati: ${invited.join(', ')}`, 'Ricevono l’invito o l’aggiornamento.']
                : ['Gli invitati ricevono l’aggiornamento.'],
            confirmLabel: 'Modifica'
          })

          if (!approved) {
            return { content: "L'utente non l'ha confermato.", summary: 'Evento non modificato' }
          }
        }

        const updated = await context.calendar.update(key, change)
        recordChange(context, 'modificato', `Corretto in calendario: ${updated.title}`, updated, {
          kind: 'evento-modificato',
          eventKey: key,
          before: beforeChange(current, change)
        })
        return {
          content: `Aggiornato: ${eventLine(updated, context)}`,
          summary: `Corretto: ${updated.title}`
        }
      }
      case 'elimina': {
        const key = eventOf(context, args)
        const current = await context.calendar.event(key)

        if (!current) {
          return { content: "L'evento non c'era più.", summary: 'Evento già tolto' }
        }

        if (context.run.background && (hasGuests(current) || current.origin?.by !== 'segretario')) {
          throw new ToolInputError(
            'Da solo puoi togliere solo un evento che hai messo tu e che non ha invitati: per questo, proponilo all’utente.'
          )
        }

        if (!context.run.background) {
          const { approved } = await context.requestApproval({
            kind: 'action',
            title: `Elimina: ${current.title}`,
            details: hasGuests(current) ? ['Gli invitati ricevono la cancellazione.'] : [],
            confirmLabel: 'Elimina'
          })

          if (!approved) {
            return { content: "L'utente non l'ha confermato.", summary: 'Evento non eliminato' }
          }
        }

        await context.calendar.remove(key)
        recordChange(context, 'eliminato', `Tolto dal calendario: ${current.title}`, current, {
          kind: 'evento-eliminato',
          event: {
            calendarKey: calendarKey(current.connectionId, current.calendarId),
            title: current.title,
            start: current.start,
            end: current.end,
            allDay: current.allDay,
            location: current.location,
            description: current.description,
            attendees: current.attendees
              .filter((attendee) => !attendee.self)
              .map((attendee) => attendee.email),
            origin: current.origin
          }
        })
        return {
          content: `Tolto «${current.title}».`,
          summary: `Tolto dal calendario: ${current.title}`
        }
      }
      case 'rispondi': {
        const key = eventOf(context, args)
        const response = requireString(args, 'risposta') as Exclude<CalendarResponse, 'needsAction'>

        if (context.run.background) {
          throw new ToolInputError(
            'Rispondere a un invito lo decide l’utente: se serve, scrivilo nella nota o proponilo.'
          )
        }

        const current = await context.calendar.event(key)
        const { approved } = await context.requestApproval({
          kind: 'action',
          title: `${RESPONSE_WORDS[response] === 'partecipa' ? 'Partecipi' : 'Rispondi'}: ${current?.title ?? 'invito'}`,
          details: [`Risposta: ${RESPONSE_WORDS[response]}`, "L'organizzatore riceve la risposta."],
          confirmLabel: 'Rispondi'
        })

        if (!approved) {
          return { content: "L'utente non l'ha confermato.", summary: 'Invito non risposto' }
        }

        const answered = await context.calendar.respond(key, response)
        return {
          content: `Risposto: ${eventLine(answered, context)}`,
          summary: `Risposto all'invito: ${answered.title}`
        }
      }
      case 'proponi': {
        const allDay = booleanArg(args, 'tutto_il_giorno')
        const source = stringArg(args, 'messaggio')
          ? await resolveMessage(context, stringArg(args, 'messaggio')!)
          : null
        const title = requireString(args, 'titolo')
        const proposal = await context.registry.propose(
          {
            kind: 'evento',
            title: `Evento: ${title}`,
            payload: {
              title,
              start: instant(stringArg(args, 'inizio'), allDay, 'inizio'),
              end: instant(stringArg(args, 'fine'), allDay, 'fine'),
              allDay,
              location: stringArg(args, 'luogo') ?? null,
              description: stringArg(args, 'descrizione') ?? null,
              attendees: stringListArg(args, 'invitati'),
              calendar: stringArg(args, 'calendario') ?? null,
              eventKey: stringArg(args, 'evento') ? eventOf(context, args) : null
            },
            accountId: source?.accountId ?? null,
            messageKey: source?.messageKey ?? null,
            threadId: source?.threadId ?? null
          },
          context.run.actor
        )
        return {
          content: `Proposta all'utente: ${proposal.title}. La vede in Oggi e nel calendario.`,
          summary: `Proposto: ${title}`
        }
      }
      default:
        throw new ToolInputError(`\`azione\` è una di: ${ACTIONS.join(', ')}.`)
    }
  }
}
