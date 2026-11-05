import { folderRole } from '@shared/folders'
import type { MailAddress, MessageRef } from '@shared/models'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import { seenKey, type SegretarioMailPort } from '../agent/tool-types'
import { threadMessages } from '../mail-search'
import type { Notebook } from '../memory/notebook'
import type { Registry } from '../registry/registry'
import type { CommitmentRecord, ProjectSummary } from '../registry/types'
import { commitmentLine, noteLine, replyLines } from '../tools/describe'
import { clip, formatAddresses, formatDateTime, withoutQuotedHistory } from '../tools/format'
import { nowLine } from './context'

/** Messages of the conversation shown before the first one to read, as its story. */
const EARLIER_SHOWN = 5
/** Characters of a message to read, and of one shown as the story around it. */
const TARGET_CHARS = 8_000
const STORY_CHARS = 2_500
/** What is shown of the projects the conversation is in, and of the sender's other conversations. */
const PROJECT_OPEN_SHOWN = 20
const PROJECT_LATER_SHOWN = 6
const SENDER_CONVERSATIONS_LOOKED = 12
const SENDER_CONVERSATIONS_SHOWN = 5
const SENDER_LOOKBACK_DAYS = 30
/** The projects offered to file the conversation into, the most recently moved first. */
const PROJECTS_OFFERED = 40
const PEOPLE_NOTES = 3

export interface ReadingScope {
  accountId: string
  threadId: string
}

export interface ReadingDeps {
  mail: SegretarioMailPort
  registry: Registry
  notebook: Notebook
}

export interface ReadingPlan {
  title: string
  /** The data the run starts from, after its task and the context. */
  data: string
  handles: HandleRecord[]
  /** The revisions of what the opening showed: writes against older looks are refused. */
  seen: Map<string, number>
  /** The messages the run must leave a note on, by key, with their short names. */
  targets: Array<{ messageKey: string; handle: string }>
}

type ReadMessage = Awaited<ReturnType<SegretarioMailPort['readMessage']>> & { ref: MessageRef }

/** The keys a reading holds while it runs: its conversation, its projects, the outside sender. */
export async function readingLockKeys(deps: ReadingDeps, scope: ReadingScope): Promise<string[]> {
  const keys = [`conv:${scope.accountId}:${scope.threadId}`]
  const links = await deps.registry.projects.linksOf([scope])
  keys.push(...links.filter((link) => !link.rejected).map((link) => `proj:${link.projectId}`))

  const messageKeys = await deps.mail.threadKeys(scope.accountId, scope.threadId)
  const last = messageKeys[messageKeys.length - 1]

  if (last) {
    const own = new Set(
      (await deps.mail.listAccounts()).map((account) => account.email.toLowerCase())
    )
    const location = (await deps.mail.locate(scope.accountId, [last])).get(last)
    const sender = location?.from.find((address) => !own.has(address.address.toLowerCase()))

    if (sender) {
      keys.push(`from:${sender.address.toLowerCase()}`)
    }
  }

  return keys
}

function isOwn(addresses: ReadonlyArray<MailAddress>, own: ReadonlySet<string>): boolean {
  return addresses.some((address) => own.has(address.address.toLowerCase()))
}

/**
 * What a reading starts from: the conversation's messages not yet read
 * (within the horizon), the story around them, and what is already there —
 * its commitments and those of its projects and its sender, the reply
 * prepared, the projects to file it into. A message that came to another
 * of the user's accounts too, and was read there, is not read again: its
 * note is copied. Null when nothing is left to read.
 */
export async function prepareReading(
  deps: ReadingDeps,
  scope: ReadingScope,
  sinceIso: string
): Promise<ReadingPlan | null> {
  const { mail, registry } = deps
  const accounts = await mail.listAccounts()
  const account = accounts.find((candidate) => candidate.id === scope.accountId)

  if (!account) {
    return null
  }

  const own = new Set(accounts.map((candidate) => candidate.email.toLowerCase()))
  const folders = await mail.listFolders(scope.accountId)
  const roleOf = (ref: MessageRef): string | null => {
    const folder = folders.find((candidate) => candidate.path === ref.folderPath)
    return folder ? folderRole(folder) : null
  }
  const refs = (
    await threadMessages(await mail.searchClient(), scope.accountId, scope.threadId, folders)
  ).filter((ref) => {
    const role = roleOf(ref)
    return role !== '\\Trash' && role !== '\\Junk' && role !== '\\Drafts'
  })

  if (refs.length === 0) {
    return null
  }

  const messages: ReadMessage[] = []

  for (const ref of refs) {
    try {
      messages.push({ ...(await mail.readMessage(ref)), ref })
    } catch {
      // A message that left meanwhile is not part of the reading.
    }
  }

  const notes = new Map(
    (
      await registry.notes.many(
        messages.map((message) => ({ accountId: scope.accountId, messageKey: message.messageKey }))
      )
    ).map((note) => [note.messageKey, note])
  )
  let targets = messages.filter(
    (message) => !notes.has(message.messageKey) && message.date >= sinceIso
  )

  // A copy of a message read in another account: its note, without reading it again.
  for (const message of [...targets]) {
    const twins = await mail.sameMessageElsewhere(message.ref)
    const read = (await registry.notes.many(twins)).find((note) => note.twinAccountId === null)

    if (read) {
      await registry.writeNote(
        {
          accountId: scope.accountId,
          messageKey: message.messageKey,
          threadId: scope.threadId,
          direction: isOwn(message.from, own) ? 'out' : 'in',
          messageDate: message.date
        },
        {
          summary: read.summary,
          nature: read.nature,
          priority: read.priority,
          reason: read.reason,
          due: read.due
        },
        { by: 'sistema' },
        { twinAccountId: read.accountId }
      )
      targets = targets.filter((target) => target.messageKey !== message.messageKey)
    }
  }

  if (targets.length === 0) {
    return null
  }

  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const seen = new Map<string, number>()
  const nameMessage = (message: ReadMessage): string =>
    handles.name({ kind: 'message', ref: message.ref, messageKey: message.messageKey }, added)
  const nameProject = (project: ProjectSummary): string => {
    seen.set(seenKey('project', project.id), project.revision)
    return handles.name({ kind: 'project', projectId: project.id, title: project.title }, added)
  }
  const remember = (records: ReadonlyArray<CommitmentRecord>): void => {
    for (const record of records) {
      seen.set(seenKey('item', record.id), record.revision)
    }
  }
  const firstTarget = messages.indexOf(targets[0])
  const story = messages.slice(Math.max(0, firstTarget - EARLIER_SHOWN))
  const targetKeys = new Set(targets.map((target) => target.messageKey))
  const sections: string[] = [nowLine(), `Account: ${account.email} (${account.displayName}).`]
  const others = accounts
    .filter((candidate) => candidate.id !== account.id)
    .map((candidate) => candidate.email)

  if (others.length > 0) {
    sections.push(
      `Gli altri indirizzi dell'utente: ${others.join(', ')}. Chi scrive da uno di questi, o a uno di questi, è l'utente stesso — un promemoria, una prova — non un'altra persona.`
    )
  }

  // What the memory says of the people in the conversation.
  const outsiders = new Set(
    story
      .flatMap((message) => [...message.from, ...message.to, ...message.cc])
      .map((address) => address.address.toLowerCase())
      .filter((address) => !own.has(address))
  )
  const people = (await deps.notebook.list())
    .filter(
      (note) =>
        note.path.startsWith('persone/') &&
        [...outsiders].some((address) => note.content.toLowerCase().includes(address))
    )
    .slice(0, PEOPLE_NOTES)

  if (people.length > 0) {
    sections.push(
      `## Cosa sai delle persone coinvolte\n\n${people
        .map((note) => `### ${note.path}\n${clip(note.content, 1500).text}`)
        .join('\n\n')}`
    )
  }

  sections.push(
    `## La conversazione, dal più vecchio\n\n${story
      .map((message, index) => {
        const target = targetKeys.has(message.messageKey)
        const handle = nameMessage(message)
        const note = notes.get(message.messageKey)
        const own =
          index === 0
            ? { text: message.textForReading }
            : withoutQuotedHistory(message.textForReading)
        const attachments = message.attachments.map(
          (attachment) =>
            `${handles.name(
              {
                kind: 'file',
                file: {
                  kind: 'attachment',
                  ref: message.ref,
                  attachmentId: attachment.id,
                  fileName: attachment.fileName,
                  contentType: attachment.contentType
                }
              },
              added
            )} ${attachment.fileName}`
        )

        if (note) {
          seen.set(seenKey('note', scope.accountId, message.messageKey), note.revision)
        }

        return [
          `### ${handle} · ${target ? 'DA LEGGERE' : 'già letto'} · ${formatDateTime(message.date)} · da ${formatAddresses(message.from, 2)} · a ${formatAddresses([...message.to, ...message.cc], 4)} · ${message.folderPath}`,
          `Oggetto: ${message.subject || '(senza oggetto)'}`,
          note ? `La tua nota: ${noteLine(note)}` : '',
          '',
          clip(own.text.trim() || '(nessun testo)', target ? TARGET_CHARS : STORY_CHARS).text,
          attachments.length > 0 ? `Allegati: ${attachments.join(' · ')}` : ''
        ]
          .filter((line, position) => line !== '' || position === 3)
          .join('\n')
      })
      .join('\n\n')}`
  )

  // What is already there, in the conversation.
  const [items, links, replies, proposals] = await Promise.all([
    registry.commitments.ofThreads([scope]),
    registry.projects.linksOf([scope]),
    registry.replies.liveOfThreads([scope]),
    registry.proposals.open({ threads: [scope] })
  ])
  remember(items)
  const projects = (
    await Promise.all(
      links
        .filter((link) => !link.rejected)
        .map((link) => registry.projects.summary(link.projectId))
    )
  ).filter((project): project is ProjectSummary => project !== null)
  const rejected = (
    await Promise.all(
      links.filter((link) => link.rejected).map((link) => registry.projects.get(link.projectId))
    )
  ).filter((project) => project !== null)
  const already: string[] = [
    items.length > 0
      ? `Cose aperte (e chiuse di recente):\n${items.map((item) => `- ${commitmentLine(item)}`).join('\n')}`
      : 'Nessuna cosa aperta.',
    projects.length > 0
      ? `È nei progetti: ${projects.map((project) => `${nameProject(project)} ${project.title}${project.description ? ` — ${project.description}` : ''}`).join('; ')}.`
      : 'Non è in nessun progetto.'
  ]

  if (rejected.length > 0) {
    already.push(
      `L'utente ha detto che non è di: ${rejected.map((project) => project!.title).join(', ')}.`
    )
  }

  for (const reply of replies) {
    seen.set(seenKey('reply', reply.accountId, reply.messageKey), reply.revision)
    const anchor = messages.find((message) => message.messageKey === reply.messageKey)
    already.push(
      `Per ${anchor ? nameMessage(anchor) : 'un messaggio'}: ${replyLines(reply).join('\n')}`
    )
  }

  for (const proposal of proposals) {
    already.push(`Una tua proposta aspetta l'utente: ${proposal.title}.`)
  }

  sections.push(`## Cosa c'è già in questa conversazione\n\n${already.join('\n')}`)

  // The projects it is in: what is open elsewhere in them, and where they got to after these messages.
  for (const project of projects) {
    const threads = (await registry.projects.threadsOf(project.id)).filter(
      (thread) => !(thread.accountId === scope.accountId && thread.threadId === scope.threadId)
    )

    if (threads.length === 0) {
      continue
    }

    const [open, projectNotes] = await Promise.all([
      registry.commitments.open({ threads, includeDeferred: true }),
      registry.notes.ofThreads(threads)
    ])
    remember(open)
    const later = projectNotes
      .filter((note) => note.messageDate > targets[0].date && note.twinAccountId === null)
      .slice(-PROJECT_LATER_SHOWN)
    const lines: string[] = []

    if (open.length > 0) {
      lines.push(
        `Cose aperte in altre conversazioni:\n${open
          .slice(0, PROJECT_OPEN_SHOWN)
          .map((item) => `- ${commitmentLine(item)}`)
          .join('\n')}`
      )
    }

    if (later.length > 0) {
      lines.push(
        `Dopo questi messaggi (li stai leggendo in ritardo):\n${later
          .map((note) => `- ${formatDateTime(note.messageDate)}: ${note.summary}`)
          .join('\n')}`
      )
    }

    if (lines.length > 0) {
      sections.push(
        `## Nel progetto ${nameProject(project)} ${project.title}\n\n${lines.join('\n\n')}`
      )
    }
  }

  // The same sender, in other conversations still open: what this message may repeat.
  const lastTarget = targets[targets.length - 1]
  const sender = lastTarget.from.find((address) => !own.has(address.address.toLowerCase()))

  if (sender) {
    const since = new Date(Date.now() - SENDER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const threadIds = (
      await mail.threadsFromSender(
        scope.accountId,
        sender.address,
        since,
        SENDER_CONVERSATIONS_LOOKED
      )
    ).filter((threadId) => threadId !== scope.threadId)
    const open = await registry.commitments.open({
      threads: threadIds.map((threadId) => ({ accountId: scope.accountId, threadId })),
      includeDeferred: true
    })
    remember(open)
    const byThread = new Map<string, CommitmentRecord[]>()

    for (const item of open) {
      byThread.set(item.threadId, [...(byThread.get(item.threadId) ?? []), item])
    }

    const shown = [...byThread.entries()].slice(0, SENDER_CONVERSATIONS_SHOWN)

    if (shown.length > 0) {
      sections.push(
        `## Ancora aperto con lo stesso indirizzo (${sender.address}), in altre conversazioni\n\n${shown
          .map(([, threadItems]) =>
            threadItems.map((item) => `- ${commitmentLine(item)}`).join('\n')
          )
          .join('\n')}`
      )
    }
  }

  const offered = (await registry.projects.list()).slice(0, PROJECTS_OFFERED)

  sections.push(
    offered.length > 0
      ? `## I progetti in corso, i più mossi di recente per primi\n\n${offered
          .map(
            (project) =>
              `${nameProject(project)} ${project.title}${project.description ? ` — ${project.description}` : ''}`
          )
          .join(
            '\n'
          )}${offered.length === PROJECTS_OFFERED ? '\n(Ce ne sono altri: cercali con `progetti`.)' : ''}`
      : '## I progetti in corso\n\nNessuno ancora.'
  )

  const subject = lastTarget.subject || '(senza oggetto)'
  return {
    title:
      `${isOwn(lastTarget.from, own) ? 'Tuo messaggio' : lastTarget.from[0]?.name || lastTarget.from[0]?.address || 'Messaggio'} · ${subject}`.slice(
        0,
        120
      ),
    data: sections.join('\n\n'),
    handles: added,
    seen,
    targets: targets.map((target) => ({
      messageKey: target.messageKey,
      handle: nameMessage(target)
    }))
  }
}

/** What a reading still has to leave: a note on each message it was given. */
export async function readingMissing(
  registry: Registry,
  scope: ReadingScope,
  targets: ReadingPlan['targets']
): Promise<string | null> {
  const written = new Set(
    (
      await registry.notes.many(
        targets.map((target) => ({ accountId: scope.accountId, messageKey: target.messageKey }))
      )
    ).map((note) => note.messageKey)
  )
  const missing = targets.filter((target) => !written.has(target.messageKey))

  return missing.length === 0
    ? null
    : `Manca ancora la nota di ${missing.map((target) => target.handle).join(', ')}: scrivila con \`nota\`, poi completa il resto se serve.`
}
