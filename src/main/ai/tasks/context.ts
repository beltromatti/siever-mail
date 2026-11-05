import { seenKey, type SegretarioCalendarPort, type SegretarioMailPort } from '../agent/tool-types'
import type { Notebook } from '../memory/notebook'
import { fillTemplate, PROMPTS } from '../prompts'
import { clip } from '../tools/format'

/** The notes every run begins with, beside the index: the rest it reads when it needs them. */
const CORE_NOTES = ['tu.md', 'stile.md', 'connessioni.md']

export interface ContextSources {
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  notebook: Notebook
}

/**
 * The context every run begins with (`contesto.md`): the day, the user's
 * connections — mail with signatures, calendars — and the memory's index
 * with its core notes and the note of each mail account. The same for
 * every run until the memory changes: it sits early in the request, where
 * the provider's cache keeps it. `seen` is the revision of each note it
 * shows: the run has read them, and a whole rewrite of one changed since
 * is refused as for any note read.
 */
export async function contextBlock(
  sources: ContextSources
): Promise<{ text: string; seen: Map<string, number> }> {
  const [accounts, signatures, calendars, notes, index] = await Promise.all([
    sources.mail.listAccounts(),
    sources.mail.accountSignatures(),
    sources.calendar.calendars().catch(() => []),
    sources.notebook.list(),
    sources.notebook.index()
  ])
  const now = new Date()
  const core = [
    ...CORE_NOTES.map((path) => notes.find((note) => note.path === path)).filter(
      (note): note is NonNullable<typeof note> => note !== undefined
    ),
    ...notes.filter((note) => note.path.startsWith('account/'))
  ]
  const mailLines = accounts.map((account) => {
    const signature = signatures.get(account.id)
    return [
      `- Posta: ${account.email} — ${account.displayName}`,
      signature
        ? `  Firma dell'utente da qui: «${clip(signature.replace(/\s+/g, ' '), 400).text}»`
        : '  Nessuna firma.'
    ].join('\n')
  })
  const calendarLines = calendars.map(
    (calendar) =>
      `- Calendario: «${calendar.name}» di ${calendar.connection}${calendar.primary ? ' (principale)' : ''}${calendar.writable ? '' : ' (sola lettura)'}`
  )

  const text = fillTemplate(PROMPTS.context, {
    data: new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(now),
    prossimi_giorni: nextDays(now),
    fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
    connessioni: [...mailLines, ...calendarLines].join('\n') || '(nessuna connessione)',
    indice_memoria: index,
    note_principali: core.map((note) => `### ${note.path}\n\n${note.content.trim()}`).join('\n\n')
  })

  return { text, seen: new Map(core.map((note) => [seenKey('memory', note.path), note.revision])) }
}

const NEXT_DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric'
})

/** The next two weeks, each day with its weekday — "ven 6/11, sab 7/11, …" — so none is reckoned. */
function nextDays(now: Date): string {
  return Array.from({ length: 14 }, (_, offset) =>
    NEXT_DAY.format(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1))
  ).join(', ')
}

/** The moment, for the data a run starts from: the day is in the context, the hour is here. */
export function nowLine(): string {
  const now = new Date()
  return `Ora: ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'short' }).format(now)}.`
}
