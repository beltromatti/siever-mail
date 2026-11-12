import { defineMessages } from '@shared/i18n'

import { messages } from '../../i18n'
import { HandleRegistry, type HandleRecord } from '../agent/handles'
import type { Registry } from '../registry/registry'
import { localDay } from '../tools/day'
import { formatDateTime } from '../tools/format'
import { userDates } from '../tools/user-dates'
import { nowLine } from './context'

/** The runs' titles, as the panel and the diary show them. */
const TITLES = defineMessages({
  dayUpdated: {
    en: (at: string) => `The day, updated · ${at}`,
    it: (at: string) => `La giornata, aggiornata · ${at}`,
    de: (at: string) => `Der Tag, aktualisiert · ${at}`
  },
  day: {
    en: (day: string) => `The day · ${day}`,
    it: (day: string) => `La giornata · ${day}`,
    de: (day: string) => `Der Tag · ${day}`
  },
  projectState: {
    en: (title: string) => `Where it stands · ${title}`,
    it: (title: string) => `Il punto · ${title}`,
    de: (title: string) => `Stand der Dinge · ${title}`
  }
})

export interface StartingData {
  title: string
  data: string
  handles: HandleRecord[]
  /** The revisions of what the data showed: writes against older looks are refused. */
  seen?: Map<string, number>
  /** What the run looks at as its source changed (`RunContext.looking`). */
  looking?: ReadonlyArray<string>
}

/**
 * What the day starts from: the moment, and — on a second look — when the
 * letter was written. The calendar, what is open, the replies and the
 * proposals waiting, the day's run looks up itself.
 */
export function prepareDay(options: {
  refresh: boolean
  lastLetterAt: number | null
}): StartingData {
  const now = new Date()
  const sections = [nowLine()]

  if (options.refresh && options.lastLetterAt !== null) {
    sections.push(
      `Hai già scritto la lettera di oggi alle ${new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(new Date(options.lastLetterAt))}: guarda la giornata com'è adesso e aggiorna la lettera, e il resto solo se serve.`
    )
  }

  return {
    title: options.refresh
      ? messages(TITLES).dayUpdated(formatDateTime(now.toISOString(), userDates().locale))
      : messages(TITLES).day(localDay(now)),
    data: sections.join('\n\n'),
    handles: []
  }
}

/**
 * What "Il punto" of a project starts from: the project, named for the run
 * to read, and when it was last written. The rest the run reads itself.
 */
export async function prepareProjectState(
  deps: { registry: Registry },
  projectId: string
): Promise<StartingData | null> {
  const project = await deps.registry.projects.summary(projectId)

  if (!project) {
    return null
  }

  const added: HandleRecord[] = []
  const handle = new HandleRegistry().name(
    { kind: 'project', projectId: project.id, title: project.title },
    added
  )
  const written = project.stateAt
    ? `«Il punto» l'hai scritto ${formatDateTime(new Date(project.stateAt).toISOString())}`
    : "«Il punto» non c'è ancora"
  const moved = project.lastMessageAt
    ? `; l'ultimo messaggio è del ${formatDateTime(project.lastMessageAt)}`
    : ''

  return {
    title: messages(TITLES).projectState(project.title),
    data: `${nowLine()}\n\nIl progetto: ${handle} ${project.title}. ${written}${moved}.`,
    handles: added
  }
}
