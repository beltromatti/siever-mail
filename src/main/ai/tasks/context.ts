import type { SegretarioCalendarPort, SegretarioMailPort } from '../agent/tool-types'
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
 * the provider's cache keeps it.
 */
export async function contextBlock(sources: ContextSources): Promise<string> {
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
      `- Calendario: «${calendar.name}» di ${calendar.account}${calendar.primary ? ' (principale)' : ''}${calendar.writable ? '' : ' (sola lettura)'}`
  )

  return fillTemplate(PROMPTS.context, {
    data: new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(now),
    fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
    connessioni: [...mailLines, ...calendarLines].join('\n') || '(nessuna connessione)',
    indice_memoria: index,
    note_principali: core.map((note) => `### ${note.path}\n\n${note.content.trim()}`).join('\n\n')
  })
}

/** The moment, for the data a run starts from: the day is in the context, the hour is here. */
export function nowLine(): string {
  const now = new Date()
  return `Ora: ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'short' }).format(now)}.`
}
