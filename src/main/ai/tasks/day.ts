import { HandleRegistry, type HandleRecord } from '../agent/handles'
import type { Registry } from '../registry/registry'
import { localDay } from '../tools/day'
import { formatDateTime } from '../tools/format'
import { nowLine } from './context'

export interface StartingData {
  title: string
  data: string
  handles: HandleRecord[]
  /** The revisions of what the data showed: writes against older looks are refused. */
  seen?: Map<string, number>
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

  if (options.refresh) {
    sections.push(
      `Hai già scritto la lettera di oggi${options.lastLetterAt ? ` alle ${new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(new Date(options.lastLetterAt))}` : ''}: da allora qualcosa di aperto è cambiato. Aggiorna la lettera a com'è adesso, e il resto solo se serve.`
    )
  }

  return {
    title: options.refresh
      ? `La giornata, aggiornata · ${formatDateTime(now.toISOString())}`
      : `La giornata · ${localDay(now)}`,
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
    title: `Il punto · ${project.title}`,
    data: `${nowLine()}\n\nIl progetto: ${handle} ${project.title}. ${written}${moved}.`,
    handles: added
  }
}
