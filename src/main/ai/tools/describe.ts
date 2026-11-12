import type { MessageRef } from '@shared/models'

import type { CommitmentRecord, NoteRecord, ProjectSummary, ReplyRecord } from '../registry/types'
import { seenKey, type ToolContext } from '../agent/tool-types'
import { dayWithWeekday, formatDateTime, shortDate } from './format'

const KIND_WORDS: Record<CommitmentRecord['kind'], string> = {
  ti_chiedono: 'ti chiedono',
  hai_promesso: 'hai promesso',
  aspetti: 'aspetti',
  da_fare: 'da fare'
}

const NATURE_WORDS: Record<NoteRecord['nature'], string> = {
  da_rispondere: 'chiede una risposta',
  da_fare: 'chiede di fare qualcosa',
  in_attesa: 'si aspetta qualcosa da altri',
  informativo: 'informativo',
  rumore: 'rumore'
}

const ACTOR_WORDS = {
  utente: "dall'utente",
  segretario: 'da te',
  sistema: 'dal programma'
} as const

/** A commitment in a line: its number, kind, words, date and where it stands — and who decided. */
export function commitmentLine(record: CommitmentRecord): string {
  const status =
    record.status === 'aperta'
      ? 'aperta'
      : record.status === 'rinviata'
        ? `rinviata fino al ${dayWithWeekday(record.until ?? '')}`
        : `${record.status === 'fatta' ? 'fatta' : 'non serve'} ${ACTOR_WORDS[record.setBy]} il ${shortDate(
            new Date(record.updatedAt).toISOString()
          )}${record.reason ? ` («${record.reason}»)` : ''}`

  return `#${record.id} ${KIND_WORDS[record.kind]} · «${record.text}»${record.due ? ` · entro ${dayWithWeekday(record.due)}` : ''} · ${status}${
    record.question ? ` · domanda all'utente: ${record.question}` : ''
  }`
}

/** A note in a line, as the Segretario wrote it. */
export function noteLine(note: NoteRecord): string {
  return `«${note.summary}» · ${NATURE_WORDS[note.nature]} · importanza ${note.priority}${
    note.reason ? ` (${note.reason})` : ''
  }${note.due ? ` · da fare entro ${dayWithWeekday(note.due)}` : ''}${
    note.writtenBy === 'utente' ? ' · corretta dall’utente' : ''
  }`
}

export function replyLines(reply: ReplyRecord): string[] {
  return [
    `${reply.kind === 'sollecito' ? 'Il sollecito' : 'La risposta'} che hai preparato${
      reply.writtenBy === 'utente'
        ? `, ${reply.kind === 'sollecito' ? 'riscritto' : 'riscritta'} dall'utente: le parole sono sue`
        : ''
    } (${
      reply.status === 'pronta'
        ? "pronta, l'utente la vede nel lettore"
        : `da rivedere: ${reply.staleReason ?? 'la conversazione è andata avanti'}`
    }):`,
    `«${reply.text}»`,
    ...(reply.doubts ? [`I tuoi dubbi: ${reply.doubts}`] : [])
  ]
}

/** A project in a line, with its short name for links and later calls. */
export function projectLine(
  context: Pick<ToolContext, 'handles' | 'newHandles'> & { run: Pick<ToolContext['run'], 'seen'> },
  project: ProjectSummary
): string {
  const handle = context.handles.name(
    { kind: 'project', projectId: project.id, title: project.title },
    context.newHandles
  )
  context.run.seen.set(seenKey('project', project.id), project.revision)
  return `${handle} ${project.title}${project.description ? ` — ${project.description}` : ''} · ${
    project.conversations
  } conversazioni · ${project.openCommitments} cose aperte${project.hiddenAt ? ' · nascosto' : ''}${
    project.closedAt ? ' · concluso' : ''
  }`
}

/** Remembers what this run saw of commitments, for its later writes to be checked against. */
export function rememberCommitments(
  context: { run: Pick<ToolContext['run'], 'seen'> },
  records: ReadonlyArray<CommitmentRecord>
): void {
  for (const record of records) {
    context.run.seen.set(seenKey('item', record.id), record.revision)
  }
}

/**
 * What the Segretario already made of a message and its conversation: its
 * note, what is open (and what was settled lately, so it is not opened
 * again), the projects, the reply prepared, the drafts written in answer,
 * the marks an extension left, the proposals — so the work builds on it, not beside it.
 */
export async function messageWork(
  context: ToolContext,
  ref: MessageRef,
  messageKey: string,
  threadId: string,
  options: { withConversation: boolean } = { withConversation: true }
): Promise<string[]> {
  const thread = { accountId: ref.accountId, threadId }
  const [note, read, alerts, items, links, reply, drafts, marks, proposals] = await Promise.all([
    context.registry.notes.get(ref.accountId, messageKey),
    context.registry.readMarks.read(ref.accountId, [messageKey]),
    context.registry.alerts.of({ kind: 'message', accountId: ref.accountId, messageKey }),
    options.withConversation
      ? context.registry.commitments.ofThreads([thread])
      : Promise.resolve([]),
    context.registry.projects.linksOf([thread]),
    context.registry.replies.get(ref.accountId, messageKey),
    context.mail.draftsReplyingTo(ref),
    context.mail.marksOf(ref.accountId, [messageKey]),
    context.registry.proposals.open({ messages: [{ accountId: ref.accountId, messageKey }] })
  ])
  const projects = (
    await Promise.all(
      links
        .filter((link) => !link.rejected)
        .map((link) => context.registry.projects.summary(link.projectId))
    )
  ).filter((project): project is ProjectSummary => project !== null)
  const lines: string[] = []

  // No note is what it saw too: one written meanwhile by another run is a change (§4.6).
  context.run.seen.set(seenKey('note', ref.accountId, messageKey), note?.revision ?? 0)

  if (note) {
    lines.push(`La tua nota: ${noteLine(note)}`)
  }

  // Read is the system's mark, set as its reading ends well (§4.2) — not the note's: a note may
  // come first, from another run that met the message.
  if (!read.has(messageKey)) {
    lines.push(
      note
        ? 'Non è ancora stato letto: la sua lettura non c’è ancora stata, o non è finita.'
        : 'Non l’hai ancora letto: nessuna nota.'
    )
  }

  // What the user was told of it, kept with it (§13.3).
  for (const alert of alerts) {
    const when = formatDateTime(new Date(alert.toldAt).toISOString())
    lines.push(
      alert.delivered
        ? `L'hai detto all'utente, ${when}: «${alert.text}»`
        : `Volevi dirlo all'utente, ${when}, ma l'avviso non gli è arrivato: «${alert.text}»`
    )
  }

  if (items.length > 0) {
    rememberCommitments(context, items)
    lines.push(
      'Cose aperte della conversazione (e chiuse di recente):',
      ...items.map((item) => `  ${commitmentLine(item)}`)
    )
  }

  if (projects.length > 0) {
    lines.push(`Progetti: ${projects.map((project) => projectLine(context, project)).join('; ')}`)
  }

  const rejected = links.filter((link) => link.rejected)

  if (rejected.length > 0) {
    const titles = await Promise.all(
      rejected.map((link) => context.registry.projects.get(link.projectId))
    )
    lines.push(
      `L'utente ha detto che non è di: ${titles
        .map((project) => project?.title)
        .filter(Boolean)
        .join(', ')}.`
    )
  }

  if (reply && (reply.status === 'pronta' || reply.status === 'da_rivedere')) {
    context.run.seen.set(seenKey('reply', ref.accountId, messageKey), reply.revision)
    lines.push(...replyLines(reply))
  } else if (reply?.status === 'scartata') {
    lines.push("Una risposta che avevi preparato l'utente l'ha scartata.")
  }

  if (drafts.length > 0) {
    lines.push(
      `Già in Bozze, in risposta: ${drafts
        .map((draftId) => context.handles.name({ kind: 'draft', draftId }, context.newHandles))
        .join(', ')} — per correggerla o inviarla usa quella, non scriverne un'altra.`
    )
  }

  for (const mark of marks) {
    lines.push(
      `Segnato da un'estensione (${shortDate(new Date(mark.markedAt).toISOString())}): «${mark.label}»${mark.place ? `, in ${mark.place}` : ''}.`
    )
  }

  for (const proposal of proposals) {
    lines.push(`Proposta tua in attesa dell'utente: ${proposal.title}.`)
  }

  return lines
}
