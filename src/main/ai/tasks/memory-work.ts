import type { CalendarConnection } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import { calendarLearningKey } from '@shared/segretario'

import { messages } from '../../i18n'
import { HandleRegistry, type HandleRecord } from '../agent/handles'
import type { SegretarioCalendarPort, SegretarioMailPort } from '../agent/tool-types'
import type { AiStore } from '../ai-store'
import type { Registry } from '../registry/registry'
import { formatAddresses, formatDateTime, shortDate } from '../tools/format'
import { nowLine } from './context'
import type { StartingData } from './day'

/** The runs' titles, as the user sees them. */
const TITLES = defineMessages({
  reflection: { en: 'Reflection', it: 'Riflessione', de: 'Reflexion' }
})

const NATURE_WORDS: Record<string, string> = {
  da_rispondere: 'da rispondere',
  da_fare: 'da fare',
  in_attesa: 'in attesa',
  informativo: 'informativo',
  rumore: 'rumore'
}

/** Text set as a Markdown quote. */
function quoteBlock(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

const PROVIDER_WORDS: Readonly<Record<CalendarConnection['provider'], string>> = {
  google: 'Google',
  microsoft: 'Microsoft',
  caldav: 'CalDAV',
  ics: 'un link, in sola lettura'
}

/**
 * A connection the user took away, as the reflection reads it (§11.4):
 * which, since when, the projects it leaves, and whether the same address
 * is still connected another way. One found gone after a removal cut short
 * has no name left: what is connected now is in the context.
 */
function connectionGoneLesson(
  kind: 'account-rimosso' | 'calendario-rimosso',
  payload: Record<string, unknown>,
  when: string
): string {
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null
  const projects = Array.isArray(payload.progetti) ? payload.progetti.map(String) : []
  const since = text(payload.dal)
  const lines: string[] = []

  if (kind === 'account-rimosso') {
    const email = text(payload.email)
    lines.push(
      email
        ? `La casella ${email}${payload.pec === true ? ' (PEC)' : ''}${since ? `, collegata dal ${shortDate(since)},` : ''} è stata tolta: ${when}.`
        : `Una casella di posta non c'è più: è stata tolta mentre SIEVER Mail si chiudeva. Quali ci sono ora lo dice il contesto.`
    )
  } else {
    const label = text(payload.connessione)
    const provider = text(payload.fornitore)
    const names = Array.isArray(payload.calendari) ? payload.calendari.map(String) : []
    const calendars = names.length > 0 ? names.map((name) => `«${name}»`).join(', ') : null
    lines.push(
      label
        ? `La connessione di calendario ${label}${provider && provider in PROVIDER_WORDS ? ` (${PROVIDER_WORDS[provider as CalendarConnection['provider']]})` : ''}${calendars ? ` — ${calendars}` : ''}${since ? `, collegata dal ${shortDate(since)},` : ''} è stata tolta: ${when}.`
        : calendars
          ? `${calendars} non ${names.length === 1 ? 'è più collegato' : 'sono più collegati'}: ${when}.`
          : `Un calendario non c'è più: è stato tolto mentre SIEVER Mail si chiudeva. Quali ci sono ora lo dice il contesto.`
    )
  }

  if (projects.length > 0) {
    lines.push(
      `Aveva ${kind === 'account-rimosso' ? 'conversazioni' : 'eventi'} in ${projects.map((title) => `«${title}»`).join(', ')}: ora non li hanno più.`
    )
  }

  if (payload.ancora === true) {
    lines.push(
      'Lo stesso indirizzo è ancora collegato in un altro modo: cambia solo come ci si arriva.'
    )
  }

  return `## Connessione tolta · ${kind === 'account-rimosso' ? 'posta' : 'calendario'}\n\n${lines.join(' ')}`
}

function calendarLine(connection: CalendarConnection): string {
  const names = connection.calendars.map((calendar) => `«${calendar.name}»`).join(', ')
  return `- calendario ${connection.label} (${PROVIDER_WORDS[connection.provider]})${names ? `: ${names}` : ''}`
}

/**
 * What Conoscimi starts from: the connections to know now — mailboxes and
 * calendars, by their `ConnectionLearning` keys — and those already known.
 */
export async function prepareConoscimi(
  deps: { mail: SegretarioMailPort; store: AiStore; calendars: CalendarConnection[] },
  keys: ReadonlyArray<string>
): Promise<StartingData> {
  const accounts = await deps.mail.listAccounts()
  const known = new Set(
    (await deps.store.listLearning())
      .filter((row) => row.finishedAt !== null)
      .map((row) => row.accountId)
  )
  const asked = new Set(keys)
  const now = accounts.filter((account) => asked.has(account.id))
  const before = accounts.filter((account) => !asked.has(account.id) && known.has(account.id))
  const calendarsNow = deps.calendars.filter((connection) =>
    asked.has(calendarLearningKey(connection.id))
  )
  const calendarsBefore = deps.calendars.filter(
    (connection) =>
      !asked.has(calendarLearningKey(connection.id)) &&
      (known.has(calendarLearningKey(connection.id)) ||
        (connection.mailAccountId !== null && known.has(connection.mailAccountId)))
  )
  const everything = now.length === accounts.length && calendarsNow.length === deps.calendars.length

  return {
    title: everything
      ? messages(PLACES).conoscimi
      : `${messages(PLACES).conoscimi} · ${[...now.map((account) => account.email), ...calendarsNow.map((connection) => connection.label)].join(', ')}`,
    data: [
      nowLine(),
      `## Da conoscere ora\n\n${[
        ...now.map((account) => `- posta ${account.email} (${account.displayName})`),
        ...calendarsNow.map(calendarLine)
      ].join('\n')}`,
      before.length + calendarsBefore.length > 0
        ? `## Già conosciute (la memoria le descrive): integra, non ricominciare\n\n${[
            ...before.map((account) => `- posta ${account.email}`),
            ...calendarsBefore.map(calendarLine)
          ].join('\n')}`
        : '',
      'Comincia.'
    ]
      .filter(Boolean)
      .join('\n\n'),
    handles: [],
    seen: new Map()
  }
}

/**
 * What a reflection starts from: the lessons since the last one — drafts
 * the user corrected or sent as they were, commitments they said were not
 * needed or reopened, projects renamed, merged, conversations moved,
 * proposals accepted with changes or set aside, replies discarded. Null
 * when there is nothing worth reflecting on.
 */
export async function prepareReflection(deps: {
  mail: SegretarioMailPort
  calendar: Pick<SegretarioCalendarPort, 'event'>
  store: AiStore
}): Promise<(StartingData & { lessonIds: number[] }) | null> {
  // Every lesson that teaches; the drafts sent as they were are told as a count.
  const pending = await deps.store.pendingLessons()
  const teaching = pending.filter((lesson) => lesson.kind !== 'confermata')

  if (teaching.length === 0) {
    return null
  }

  const lessons = [...pending.filter((lesson) => lesson.kind === 'confermata'), ...teaching].sort(
    (a, b) => a.id - b.id
  )

  const emails = new Map(
    (await deps.mail.listAccounts()).map((account) => [account.id, account.email])
  )
  const confirmed = new Map<string, number>()
  const parts: string[] = []
  // The message a correction is about, named: who wrote it and about what is often the lesson.
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const messageLine = async (about: unknown): Promise<string | null> => {
    const { accountId, messageKey } = (about ?? {}) as { accountId?: string; messageKey?: string }

    if (!accountId || !messageKey) {
      return null
    }

    const summary = (await deps.mail.messageSummaries(accountId, [messageKey])).get(messageKey)

    if (!summary) {
      return 'Il messaggio non è più nella posta.'
    }

    const handle = handles.name({ kind: 'message', ref: summary.ref, messageKey }, added)
    const sender = summary.from[0]
    return `Il messaggio: ${handle} · ${shortDate(summary.dateIso)} · ${sender?.name || sender?.address || ''} · «${summary.subject}»`
  }
  // The event an open thing came from, named the same way.
  const eventLine = async (eventKey: unknown): Promise<string | null> => {
    if (typeof eventKey !== 'string' || !eventKey) {
      return null
    }

    const event = await deps.calendar.event(eventKey)

    if (!event) {
      return "L'evento non è più nel calendario."
    }

    const handle = handles.name({ kind: 'event', eventKey, title: event.title }, added)
    return `L'evento: ${handle} · ${shortDate(event.start)} · «${event.title}»`
  }

  for (const lesson of lessons) {
    const {
      messaggio: about,
      evento: aboutEvent,
      ...payload
    } = (lesson.payload ?? {}) as Record<string, unknown>
    const when = formatDateTime(new Date(lesson.createdAt).toISOString())
    const from = emails.get(String(payload.accountId ?? '')) ?? 'un account'

    switch (lesson.kind) {
      case 'correzione':
        parts.push(
          [
            `## Bozza da ${from}, mandata ${when}`,
            'Avevi scritto:',
            quoteBlock(String(payload.written ?? '')),
            "L'utente ha mandato:",
            quoteBlock(String(payload.sent ?? ''))
          ].join('\n\n')
        )
        break
      case 'confermata':
        confirmed.set(from, (confirmed.get(from) ?? 0) + 1)
        break
      case 'account-rimosso':
      case 'calendario-rimosso':
        parts.push(connectionGoneLesson(lesson.kind, payload, when))
        break
      case 'percorso-spostato':
        parts.push(
          `## Una cartella si è spostata\n\nCiò che stava in ${String(payload.da ?? '')} ora sta in ${String(payload.a ?? '')}, da ${when}: i posti dei segni, le cartelle dei progetti e i file recenti seguono già. Dove la tua memoria scrive il percorso vecchio, correggilo.`
        )
        break
      default: {
        const source = (await messageLine(about)) ?? (await eventLine(aboutEvent))
        parts.push(
          `## ${lesson.kind.replace(/_/g, ' ')} · ${when}\n\n${source ? `${source}\n\n` : ''}${JSON.stringify(payload, null, 1)}`
        )
      }
    }
  }

  for (const [from, count] of confirmed) {
    parts.push(
      `## Bozze mandate così com'erano\n\n${count === 1 ? 'Una bozza' : `${count} bozze`} da ${from}.`
    )
  }

  return {
    title: messages(TITLES).reflection,
    data: `${nowLine()}\n\n${parts.join('\n\n')}`,
    handles: added,
    seen: new Map(),
    lessonIds: lessons.map((lesson) => lesson.id)
  }
}

/**
 * What keeping up starts from: the notes written since the last time on
 * messages that say something, account by account, with who wrote. Null
 * when too few came to be worth it.
 */
export async function prepareKeepingUp(
  deps: { mail: SegretarioMailPort; registry: Registry },
  sinceMs: number,
  minimum: number
): Promise<StartingData | null> {
  const notes = await deps.registry.notes.writtenSince(sinceMs)

  if (notes.length < minimum) {
    return null
  }

  const sections: string[] = []
  // Each named, to be read when a note alone does not say enough.
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []

  for (const account of await deps.mail.listAccounts()) {
    const ofAccount = notes.filter((note) => note.accountId === account.id)

    if (ofAccount.length === 0) {
      continue
    }

    const summaries = await deps.mail.messageSummaries(
      account.id,
      ofAccount.map((note) => note.messageKey)
    )

    sections.push(
      [
        `## ${account.email}`,
        ...ofAccount.map((note) => {
          const summary = summaries.get(note.messageKey)
          const handle = summary
            ? `${handles.name({ kind: 'message', ref: summary.ref, messageKey: note.messageKey }, added)} · `
            : ''
          const who =
            note.direction === 'out'
              ? "scritto dall'utente"
              : formatAddresses(summary?.from ?? [], 1)
          return `- ${handle}${formatDateTime(note.messageDate)} · ${who} · ${NATURE_WORDS[note.nature] ?? note.nature}: ${note.summary}`
        })
      ].join('\n')
    )
  }

  return {
    title: messages(PLACES).alPasso,
    data: `${nowLine()}\n\nLe note dal ${formatDateTime(new Date(sinceMs).toISOString())}:\n\n${sections.join('\n\n')}`,
    handles: added,
    seen: new Map()
  }
}
