import { fileSources } from '../../files/file-sources'
import type { SegretarioCalendarPort, SegretarioMailPort } from '../agent/tool-types'
import type { Notebook } from '../memory/notebook'
import { fillTemplate, PROMPTS } from '../prompts'
import { clip } from '../tools/format'

/** Where every task takes the moment it starts from: the day is in the context, the hour here. */
export { nowLine } from '../clock'

export interface ContextSources {
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  notebook: Notebook
}

/**
 * The context every run begins with (`contesto.md`): a map, not the
 * territory — the day, the user's connections of every family (mail with
 * its signature, calendars, the File sources) and the memory's index. What the work needs of them the run
 * reads itself, when it needs it. The same for every run until the memory
 * changes: it sits early in the request, where the provider's cache keeps
 * it.
 */
export async function contextBlock(sources: ContextSources): Promise<string> {
  const [accounts, signatures, calendars, files, index] = await Promise.all([
    sources.mail.listAccounts(),
    sources.mail.accountSignatures(),
    sources.calendar.calendars().catch(() => []),
    fileSources(),
    sources.notebook.index()
  ])
  const now = new Date()
  const mailLines = accounts.map((account) => {
    const signature = signatures.get(account.id)
    return [
      `- Posta: ${account.email} — ${account.displayName}${account.pec ? ' · casella PEC (posta certificata)' : ''}`,
      signature
        ? `  Firma dell'utente da qui: «${clip(signature.replace(/\s+/g, ' '), 400).text}»`
        : '  Nessuna firma.'
    ].join('\n')
  })
  const calendarLines = calendars.map(
    (calendar) =>
      `- Calendario: «${calendar.name}» di ${calendar.connection}${calendar.primary ? ' (principale)' : ''}${calendar.writable ? '' : ' (sola lettura)'}`
  )

  const fileLines = files.map((source) =>
    source.kind === 'computer'
      ? `- File: questo computer, le cartelle dell'utente (${source.path}) — in sola lettura`
      : `- File: ${source.kind === 'rete' ? 'volume di rete' : 'volume'} «${source.label}» (${source.path})${source.mounted ? '' : ' — non montato ora: si monta quando serve'}`
  )

  return fillTemplate(PROMPTS.context, {
    data: new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(now),
    fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
    connessioni:
      [...mailLines, ...calendarLines, ...fileLines].join('\n') || '(nessuna connessione)',
    indice_memoria: index
  })
}
