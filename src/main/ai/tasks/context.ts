import type { SegretarioCalendarPort, SegretarioMailPort } from '../agent/tool-types'
import type { Notebook } from '../memory/notebook'
import { fillTemplate, PROMPTS } from '../prompts'
import { clip } from '../tools/format'

export interface ContextSources {
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  notebook: Notebook
}

/**
 * The context every run begins with (`contesto.md`): a map, not the
 * territory — the day, the user's connections (mail with its signature,
 * calendars) and the memory's index. What the work needs of them the run
 * reads itself, when it needs it. The same for every run until the memory
 * changes: it sits early in the request, where the provider's cache keeps
 * it.
 */
export async function contextBlock(sources: ContextSources): Promise<string> {
  const [accounts, signatures, calendars, index] = await Promise.all([
    sources.mail.listAccounts(),
    sources.mail.accountSignatures(),
    sources.calendar.calendars().catch(() => []),
    sources.notebook.index()
  ])
  const now = new Date()
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

  return fillTemplate(PROMPTS.context, {
    data: new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(now),
    fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
    connessioni: [...mailLines, ...calendarLines].join('\n') || '(nessuna connessione)',
    indice_memoria: index
  })
}

/** The moment, for the data a run starts from: the day is in the context, the hour is here. */
export function nowLine(): string {
  const now = new Date()
  return `Ora: ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'short' }).format(now)}.`
}
