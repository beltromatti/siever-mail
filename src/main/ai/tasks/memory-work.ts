import type { CalendarConnection } from '@shared/calendar'
import { calendarLearningKey } from '@shared/segretario'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import type { SegretarioCalendarPort, SegretarioMailPort } from '../agent/tool-types'
import type { AiStore } from '../ai-store'
import type { Registry } from '../registry/registry'
import { formatAddresses, formatDateTime, shortDate } from '../tools/format'
import { nowLine } from './context'
import type { StartingData } from './day'

/** Lessons taken in by one reflection at most. */
const LESSONS_PER_REFLECTION = 30
/** Notes Al passo reads at most, the newest. */
const KEEP_UP_NOTES_SHOWN = 150

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
      ? 'Conoscimi'
      : `Conoscimi · ${[...now.map((account) => account.email), ...calendarsNow.map((connection) => connection.label)].join(', ')}`,
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
  // The lessons that teach, a reflection's worth; the drafts sent as they were, all of them —
  // they are told as a count. Taken in order alone, a run of those would hide what comes after.
  const pending = await deps.store.pendingLessons()
  const teaching = pending
    .filter((lesson) => lesson.kind !== 'confermata')
    .slice(0, LESSONS_PER_REFLECTION)

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
        parts.push(
          `## Connessione rimossa\n\n${String(payload.email ?? '')} è stata rimossa ${when}.`
        )
        break
      case 'calendario-rimosso': {
        const names = Array.isArray(payload.calendari) ? payload.calendari.map(String) : []
        parts.push(
          `## Calendario scollegato\n\n${names.length > 0 ? names.map((name) => `«${name}»`).join(', ') : 'Un calendario'} non ${names.length === 1 ? 'è' : 'sono'} più collegat${names.length === 1 ? 'o' : 'i'} da ${when}.`
        )
        break
      }
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
    title: 'Riflessione',
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
  const { notes, total } = await deps.registry.notes.writtenSince(sinceMs, KEEP_UP_NOTES_SHOWN)

  if (total < minimum) {
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
    title: 'Al passo',
    data: `${nowLine()}\n\nLe note dal ${formatDateTime(new Date(sinceMs).toISOString())}:\n\n${sections.join('\n\n')}${
      total > notes.length ? `\n\n(Le più recenti ${notes.length} di ${total}.)` : ''
    }`,
    handles: added,
    seen: new Map()
  }
}
