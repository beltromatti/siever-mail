import type { CalendarConnection } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import { calendarLearningKey, type HandleLink, type WorkTarget } from '@shared/segretario'

import { messages } from '../../i18n'
import { HandleRegistry, type HandleRecord, type HandleTarget } from '../agent/handles'
import { seenKey, type SegretarioCalendarPort, type SegretarioMailPort } from '../agent/tool-types'
import type { AiStore } from '../ai-store'
import type { Registry } from '../registry/registry'
import { WORDS_LESSONS } from '../registry/words'
import { localDay } from '../tools/day'
import { commitmentLine, noteLine, replyLines } from '../tools/describe'
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

/** A short name a word that stays links to, as the run that reads it names it anew; null for one it cannot. */
function targetOfLink(link: HandleLink): HandleTarget | null {
  switch (link.kind) {
    case 'message':
      return link.messageKey
        ? { kind: 'message', ref: link.ref, messageKey: link.messageKey }
        : null
    case 'file':
      return link.path
        ? { kind: 'file', file: { kind: 'path', path: link.path, fileName: link.fileName } }
        : link.ref && link.attachmentId
          ? {
              kind: 'file',
              file: {
                kind: 'attachment',
                ref: link.ref,
                attachmentId: link.attachmentId,
                fileName: link.fileName
              }
            }
          : null
    case 'draft':
      return { kind: 'draft', draftId: link.draftId }
    case 'project':
      return { kind: 'project', projectId: link.projectId, title: link.title }
    case 'event':
      return { kind: 'event', eventKey: link.eventKey, title: link.title }
    case 'commitment':
      return null
  }
}

/**
 * Words that stay — a preparation, «Il punto», the letter — with their
 * links named for this run: what the reflection writes back over them
 * keeps them, as the run that wrote them did (§3.4). A link it cannot name
 * again reads as its words.
 */
function linkedForRun(
  text: string,
  links: ReadonlyArray<HandleLink>,
  handles: HandleRegistry,
  added: HandleRecord[]
): string {
  const renamed = new Map<string, string>()

  for (const link of links) {
    const target = targetOfLink(link)

    if (target) {
      renamed.set(link.handle.toLowerCase(), handles.name(target, added))
    }
  }

  return text.replace(
    /\[([^\]]*)\]\(\s*(?:(mail|file|bozza|progetto|evento|risposta|sollecito)\s*:\s*)?([mfbpe]\d+)\s*\)/gi,
    (_whole, label: string, scheme: string | undefined, handle: string) => {
      const name = renamed.get(handle.toLowerCase())
      return name ? `[${label}](${scheme ? `${scheme}:` : ''}${name})` : label
    }
  )
}

/** The thing the user's words are about, as a heading names it. */
function thingWords(target: WorkTarget): string {
  switch (target.kind) {
    case 'impegno':
      return `la cosa aperta #${target.id}`
    case 'nota':
      return 'la nota di un messaggio'
    case 'risposta':
      return 'una risposta preparata'
    case 'preparazione':
      return 'la preparazione di un incontro'
    case 'punto':
      return '«Il punto» di un progetto'
    case 'lettera':
      return 'la lettera di Oggi'
  }
}

function isWorkTarget(value: unknown): value is WorkTarget {
  return (
    typeof value === 'object' && value !== null && typeof (value as WorkTarget).kind === 'string'
  )
}

/**
 * What a reflection starts from: first the user's words on what the
 * Segretario wrote (§10.1) — each with the thing as it is now, a name to
 * reach it, and its revision as seen, so the tools let it be put right
 * (§4.6) —; then the lessons since the last one — what the user rewrote,
 * drafts corrected or sent as they were, commitments they said were not
 * needed or reopened, projects renamed, merged, conversations moved,
 * proposals accepted with changes or set aside, replies discarded. Null
 * when there is nothing worth reflecting on. `words`: the things whose
 * words it takes in, which show again as they are once it is done.
 */
export async function prepareReflection(deps: {
  mail: SegretarioMailPort
  calendar: Pick<SegretarioCalendarPort, 'event'>
  store: AiStore
  registry: Registry
}): Promise<(StartingData & { lessonIds: number[]; words: WorkTarget[] }) | null> {
  // Every lesson that teaches; the drafts sent as they were are told as a count.
  const pending = await deps.store.pendingLessons()
  const teaching = pending.filter((lesson) => lesson.kind !== 'confermata')

  if (teaching.length === 0) {
    return null
  }

  const lessons = [...pending.filter((lesson) => lesson.kind === 'confermata'), ...teaching].sort(
    (a, b) => a.id - b.id
  )
  const { registry } = deps
  const emails = new Map(
    (await deps.mail.listAccounts()).map((account) => [account.id, account.email])
  )
  const confirmed = new Map<string, number>()
  const said: string[] = []
  const parts: string[] = []
  const words: WorkTarget[] = []
  const seen = new Map<string, number>()
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
  const quoted = (text: string): string => quoteBlock(text || '(vuoto)')

  /**
   * The thing the user's words are about, as it is now: where it comes
   * from, what it says, what reaches it — its revision registered as seen.
   * Null when it is no longer there.
   */
  const thingNow = async (target: WorkTarget): Promise<string[] | null> => {
    switch (target.kind) {
      case 'impegno': {
        const record = await registry.commitments.get(target.id)

        if (!record) {
          return null
        }

        seen.set(seenKey('item', record.id), record.revision)
        const { origin } = record
        const source =
          origin.kind === 'messaggio'
            ? await messageLine(origin)
            : origin.kind === 'evento'
              ? await eventLine(origin.eventKey)
              : 'Nata dalla parola dell’utente.'
        return [`Com'è ora: ${commitmentLine(record)}`, ...(source ? [source] : [])]
      }
      case 'nota': {
        const note = await registry.notes.get(target.accountId, target.messageKey)

        if (!note) {
          return null
        }

        seen.set(seenKey('note', note.accountId, note.messageKey), note.revision)
        const source = await messageLine(target)
        return [...(source ? [source] : []), `La nota com'è ora: ${noteLine(note)}`]
      }
      case 'risposta': {
        const reply = await registry.replies.get(target.accountId, target.messageKey)

        if (!reply || (reply.status !== 'pronta' && reply.status !== 'da_rivedere')) {
          return null
        }

        seen.set(seenKey('reply', reply.accountId, reply.messageKey), reply.revision)
        const source = await messageLine(target)
        return [...(source ? [source] : []), ...replyLines(reply)]
      }
      case 'preparazione': {
        const prep = await registry.day.prep(target.eventKey)
        seen.set(seenKey('prep', target.eventKey), prep?.writtenAt ?? 0)

        if (!prep) {
          return null
        }

        const source = await eventLine(target.eventKey)
        return [
          ...(source ? [source] : []),
          `La preparazione com'è ora${prep.writtenBy === 'utente' ? ", riscritta dall'utente" : ''}:`,
          quoted(linkedForRun(prep.text, prep.links, handles, added))
        ]
      }
      case 'punto': {
        const project = await registry.projects.get(target.projectId)

        if (!project?.state) {
          return null
        }

        seen.set(seenKey('project', project.id), project.revision)
        const handle = handles.name(
          { kind: 'project', projectId: project.id, title: project.title },
          added
        )
        return [
          `Il progetto: ${handle} ${project.title}.`,
          `«Il punto» com'è ora${project.stateBy === 'utente' ? ", riscritto dall'utente" : ''}:`,
          quoted(linkedForRun(project.state, project.stateLinks, handles, added))
        ]
      }
      case 'lettera': {
        const letter = await registry.day.letter(target.day)

        if (!letter) {
          return null
        }

        // A letter is a day's (§3.4): yesterday's nobody reads again, and `oggi` writes today's.
        if (target.day !== localDay()) {
          return [
            `È la lettera del ${shortDate(`${target.day}T12:00:00`)}: quel giorno è passato, e nessuno la rilegge.`,
            quoted(linkedForRun(letter.text, letter.links, handles, added))
          ]
        }

        seen.set(seenKey('letter', target.day), letter.writtenAt)
        return [
          `La lettera di oggi com'è ora${letter.writtenBy === 'utente' ? ", riscritta dall'utente" : ''}:`,
          quoted(linkedForRun(letter.text, letter.links, handles, added))
        ]
      }
    }
  }

  for (const lesson of lessons) {
    const raw = (lesson.payload ?? {}) as Record<string, unknown>
    const when = formatDateTime(new Date(lesson.createdAt).toISOString())

    // The user's words on a thing (§10.1): first, with the thing as it is now.
    if (
      (WORDS_LESSONS as ReadonlyArray<string>).includes(lesson.kind) &&
      isWorkTarget(raw.oggetto)
    ) {
      const target = raw.oggetto
      const answer = lesson.kind === 'risposta'
      const now = await thingNow(target)
      words.push(target)
      said.push(
        [
          `### ${answer ? 'Risposta alla tua domanda' : 'Da correggere'} · ${thingWords(target)} · ${when}`,
          ...(now ?? [
            `Non c'è più. Quando l'utente ha scritto diceva: «${String(raw.com_era ?? '')}».`
          ]),
          ...(answer && raw.domanda ? [`Avevi chiesto: «${String(raw.domanda)}»`] : []),
          answer ? "L'utente ha risposto:" : "L'utente ha scritto:",
          quoteBlock(String(raw.parole ?? ''))
        ].join('\n\n')
      )
      continue
    }

    const { messaggio: about, evento: aboutEvent, ...payload } = raw
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
      case 'riscritta': {
        const target = isWorkTarget(payload.oggetto) ? payload.oggetto : null
        const source = (await messageLine(about)) ?? (await eventLine(aboutEvent))
        parts.push(
          [
            `## Riscritta a mano · ${target ? thingWords(target) : 'un tuo testo'}${
              typeof payload.progetto === 'string' ? ` («${payload.progetto}»)` : ''
            } · ${when}`,
            ...(source ? [source] : []),
            'Avevi scritto:',
            quoted(String(payload.prima ?? '')),
            "L'utente l'ha riscritta così:",
            quoted(String(payload.dopo ?? ''))
          ].join('\n\n')
        )
        break
      }
      case 'parole_ritirate': {
        const target = isWorkTarget(payload.oggetto) ? payload.oggetto : null
        const taken = Array.isArray(payload.parole) ? payload.parole.map(String) : []
        parts.push(
          [
            `## Parole ritirate · ${when}`,
            `Mentre una riflessione le prendeva, l'utente ha ritirato ciò che aveva detto su ${
              target ? thingWords(target) : 'una cosa che avevi scritto'
            }:`,
            ...taken.map(quoteBlock)
          ].join('\n\n')
        )
        break
      }
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
    data: [
      nowLine(),
      said.length > 0
        ? `## Le parole dell'utente su ciò che hai scritto\n\n${said.join('\n\n')}`
        : '',
      ...parts
    ]
      .filter(Boolean)
      .join('\n\n'),
    handles: added,
    seen,
    lessonIds: lessons.map((lesson) => lesson.id),
    words
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
