import type { CalendarEvent } from '@shared/calendar'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import { seenKey, type SegretarioCalendarPort, type SegretarioMailPort } from '../agent/tool-types'
import type { Registry } from '../registry/registry'
import { OWED_KINDS, type CommitmentRecord, type ProjectSummary } from '../registry/types'
import { eventLine } from '../tools/calendar'
import { commitmentLine } from '../tools/describe'
import { readProject } from '../tools/read'
import { localDay } from '../tools/day'
import { formatDateTime } from '../tools/format'
import { nowLine } from './context'

/** Commitments untouched this long are worth a look: done already, or forgotten. */
const STALE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export interface DayDeps {
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  registry: Registry
}

export interface StartingData {
  title: string
  data: string
  handles: HandleRecord[]
  seen: Map<string, number>
}

/**
 * Lines that name the message something came from, with its short name:
 * the run reads it with `leggi` when it needs to.
 */
async function sourceNamer(
  deps: { mail: SegretarioMailPort },
  records: ReadonlyArray<{ accountId: string; messageKey: string }>,
  handles: HandleRegistry,
  added: HandleRecord[]
): Promise<(record: { accountId: string; messageKey: string }) => string> {
  const names = new Map<string, string>()

  for (const accountId of new Set(records.map((record) => record.accountId))) {
    const located = await deps.mail.locate(
      accountId,
      records.filter((record) => record.accountId === accountId).map((record) => record.messageKey)
    )

    for (const [key, location] of located) {
      const handle = handles.name({ kind: 'message', ref: location.ref, messageKey: key }, added)
      names.set(
        `${accountId}\u0000${key}`,
        `${handle} «${location.subject}»${location.setAside ? ' (nel cestino)' : ''}`
      )
    }
  }

  return (record) =>
    names.get(`${record.accountId}\u0000${record.messageKey}`) ?? 'un messaggio non più nella posta'
}

/**
 * What the day starts from: the calendar of today and tomorrow, what is
 * open — late, due this week, owed without a date, awaited, untouched for
 * a while — the replies and proposals waiting, what moved since yesterday.
 */
export async function prepareDay(
  deps: DayDeps,
  options: { refresh: boolean; lastLetterAt: number | null }
): Promise<StartingData> {
  const { registry } = deps
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const seen = new Map<string, number>()
  const now = new Date()
  const today = localDay(now)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayAfterTomorrow = new Date(startOfToday.getTime() + 2 * DAY_MS)
  const weekEnd = localDay(new Date(startOfToday.getTime() + 7 * DAY_MS))
  const [events, open, replies, proposals, projects] = await Promise.all([
    deps.calendar
      .events(startOfToday.toISOString(), dayAfterTomorrow.toISOString())
      .catch(() => [] as CalendarEvent[]),
    registry.commitments.open({ includeDeferred: false }),
    registry.replies.withStatus(['pronta', 'da_rivedere']),
    registry.proposals.open(),
    registry.projects.list()
  ])

  for (const record of open) {
    seen.set(seenKey('item', record.id), record.revision)
  }

  const name = await sourceNamer(deps, [...open, ...replies], handles, added)
  const line = (record: CommitmentRecord): string =>
    `- ${commitmentLine(record)} · da ${name(record)}`
  const owed = open.filter((record) => OWED_KINDS.includes(record.kind))
  const awaited = open.filter((record) => record.kind === 'aspetti')
  const late = owed.filter((record) => record.due !== null && record.due <= today)
  const week = owed.filter(
    (record) => record.due !== null && record.due > today && record.due <= weekEnd
  )
  const undated = owed.filter((record) => record.due === null || record.due > weekEnd)
  const stale = open.filter((record) => now.getTime() - record.updatedAt > STALE_DAYS * DAY_MS)
  const preps = await registry.day.preps(events.map((event) => event.key))
  const eventContext = { handles, newHandles: added }
  const moved = projects.filter(
    (project: ProjectSummary) =>
      project.lastMessageAt !== null && Date.parse(project.lastMessageAt) > now.getTime() - DAY_MS
  )
  const sections = [nowLine()]

  if (options.refresh) {
    sections.push(
      `Hai già rivisto la giornata${options.lastLetterAt ? ` (la lettera è delle ${new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(new Date(options.lastLetterAt))})` : ''}: da allora la giornata è cambiata. Aggiorna la lettera a com'è adesso, e il resto solo se serve.`
    )
  }

  sections.push(
    events.length > 0
      ? `## In calendario, oggi e domani\n\n${events.map((event) => eventLine(event, eventContext, preps.get(event.key))).join('\n')}`
      : '## In calendario, oggi e domani\n\nNiente.'
  )

  const groups: Array<[string, CommitmentRecord[]]> = [
    ['Scadute o in scadenza oggi', late],
    ['Da fare entro la settimana', week],
    ['Gli devono, senza data vicina', undated],
    ['Aspetta lui', awaited],
    [`Ferme da più di ${STALE_DAYS} giorni (forse già fatte, o dimenticate)`, stale]
  ]

  for (const [title, records] of groups) {
    if (records.length > 0) {
      sections.push(`## ${title}\n\n${records.map(line).join('\n')}`)
    }
  }

  if (replies.length > 0) {
    sections.push(
      `## Risposte e solleciti preparati\n\n${replies
        .map(
          (reply) =>
            `- ${reply.kind === 'sollecito' ? 'sollecito' : 'risposta'} per ${name(reply)} · ${reply.status === 'pronta' ? 'pronta' : `da rivedere: ${reply.staleReason ?? ''}`}`
        )
        .join('\n')}`
    )
  }

  if (proposals.length > 0) {
    sections.push(
      `## Le tue proposte in attesa dell'utente\n\n${proposals.map((proposal) => `- ${proposal.title}`).join('\n')}`
    )
  }

  if (moved.length > 0) {
    sections.push(
      `## Progetti mossi da ieri\n\n${moved
        .map(
          (project) =>
            `- ${handles.name({ kind: 'project', projectId: project.id, title: project.title }, added)} ${project.title}${project.stateAt ? '' : ' (Il punto non ancora scritto)'}`
        )
        .join('\n')}`
    )
  }

  return {
    title: options.refresh
      ? `La giornata, aggiornata · ${formatDateTime(now.toISOString())}`
      : `La giornata · ${today}`,
    data: sections.join('\n\n'),
    handles: added,
    seen
  }
}

/** What "Il punto" of a project starts from: the project as `leggi` shows it. */
export async function prepareProjectState(
  deps: { mail: SegretarioMailPort; registry: Registry },
  projectId: string
): Promise<StartingData | null> {
  const project = await deps.registry.projects.summary(projectId)

  if (!project) {
    return null
  }

  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const seen = new Map<string, number>()
  const read = await readProject(
    { mail: deps.mail, registry: deps.registry, handles, newHandles: added, run: { seen } },
    projectId
  )

  return {
    title: `Il punto · ${project.title}`,
    data: `${nowLine()}\n\n## Il progetto\n\n${typeof read.content === 'string' ? read.content : ''}`,
    handles: added,
    seen
  }
}
