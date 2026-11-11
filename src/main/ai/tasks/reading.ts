import type { MailAddress } from '@shared/models'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import {
  lookingKey,
  seenKey,
  type MessageLocation,
  type SegretarioMailPort
} from '../agent/tool-types'
import type { Registry } from '../registry/registry'
import type { NoteRecord } from '../registry/types'
import { formatAddresses, formatDateTime } from '../tools/format'
import { nowLine } from './context'

export interface ReadingScope {
  accountId: string
  threadId: string
  /** When its newest message came: in a lane, the conversations are read the oldest first. */
  newest?: string
}

export interface ReadingDeps {
  mail: SegretarioMailPort
  registry: Registry
}

export interface ReadingPlan {
  title: string
  /** The data the run starts from, after its task and the context. */
  data: string
  handles: HandleRecord[]
  /** The messages the run must leave a note on, by key, with their short names. */
  targets: Array<{ messageKey: string; handle: string }>
  /** Shown without a note: one written meanwhile by another run is a change it has not seen. */
  seen: Map<string, number>
  /** Its messages, as it looks at them: marked read as it ends, and its to tell (`RunContext.looking`). */
  looking: string[]
}

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
 * What a reading starts from: what came — the conversation's messages not
 * read yet (within the horizon), named for the run to read with `leggi`.
 * What is already there around them, the run looks up as it needs. A
 * message that came to another of the user's accounts too, and was read
 * there, is not read again: its note is copied. Null when nothing is left
 * to read.
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
  const keys = await mail.threadKeys(scope.accountId, scope.threadId)
  const located = await mail.locate(scope.accountId, keys)
  // Only in the Trash or Spam, or a draft not sent: not part of the reading.
  const messages = keys
    .map((messageKey) => ({ messageKey, location: located.get(messageKey) }))
    .filter(
      (message): message is { messageKey: string; location: MessageLocation } =>
        message.location !== undefined && !message.location.setAside && !message.location.draft
    )
  const read = await registry.readMarks.read(
    scope.accountId,
    messages.map((message) => message.messageKey)
  )
  let targets = messages.filter(
    (message) => !read.has(message.messageKey) && message.location.dateIso >= sinceIso
  )

  // A copy of a message read in another account: its note, what the user was told of it, and its
  // mark, without reading it again — told where it is not muted, once (§13.3).
  for (const message of [...targets]) {
    // Read there by its own reading: a note of its own, and the mark.
    let twin: NoteRecord | null = null

    for (const note of await registry.notes.many(
      await mail.sameMessageElsewhere(message.location.ref)
    )) {
      if (
        note.twinAccountId === null &&
        (await registry.readMarks.read(note.accountId, [note.messageKey])).size > 0
      ) {
        twin = note
        break
      }
    }

    if (!twin) {
      continue
    }

    const here = { accountId: scope.accountId, messageKey: message.messageKey }

    if (!(await registry.notes.get(here.accountId, here.messageKey))) {
      await registry.writeNote(
        {
          ...here,
          threadId: scope.threadId,
          direction: isOwn(message.location.from, own) ? 'out' : 'in',
          messageDate: message.location.dateIso
        },
        {
          summary: twin.summary,
          nature: twin.nature,
          priority: twin.priority,
          reason: twin.reason,
          due: twin.due
        },
        { by: 'sistema' },
        { twinAccountId: twin.accountId }
      )
    }

    // Told there, the user knows; not arrived there — that mailbox muted —, told here.
    if ((await registry.alerts.of({ kind: 'message', ...here })).length === 0) {
      for (const alert of await registry.alerts.of({ kind: 'message', ...twin })) {
        const delivered = alert.delivered || (await mail.alert(here, alert.text)) === 'told'
        await registry.alerts.told({ kind: 'message', ...here }, alert.text, null, delivered)
      }
    }

    await registry.markRead(here.accountId, [here.messageKey], null, twin.accountId)
    targets = targets.filter((target) => target.messageKey !== message.messageKey)
  }

  if (targets.length === 0) {
    return null
  }

  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const handleOf = new Map(
    targets.map((target) => [
      target.messageKey,
      handles.name(
        { kind: 'message', ref: target.location.ref, messageKey: target.messageKey },
        added
      )
    ])
  )
  const lines = targets.map(
    (target) =>
      `- ${handleOf.get(target.messageKey)} · ${formatDateTime(target.location.dateIso)} · ${
        isOwn(target.location.from, own)
          ? "scritto dall'utente"
          : `da ${formatAddresses(target.location.from, 2)}`
      } · «${target.location.subject || '(senza oggetto)'}»`
  )
  const lastTarget = targets[targets.length - 1]
  // What the data shows of their notes: none, for those without — a note come since is a change.
  const noted = new Set(
    (
      await registry.notes.many(
        targets.map((target) => ({ accountId: scope.accountId, messageKey: target.messageKey }))
      )
    ).map((note) => note.messageKey)
  )
  const later = messages.filter(
    (message) => message.location.dateIso > lastTarget.location.dateIso
  ).length
  const others = messages.length - targets.length
  const sections = [
    nowLine(),
    `Nella casella ${account.email}:\n${lines.join('\n')}`,
    others > 0
      ? `La conversazione ha altri ${others === 1 ? 'un messaggio' : `${others} messaggi`}, già letti${
          later > 0
            ? `; ${later === 1 ? 'uno è più recente' : `${later} sono più recenti`} di questi: la questione è andata avanti`
            : ''
        }.`
      : 'È il primo messaggio della conversazione.'
  ]
  const from = lastTarget.location.from[0]

  return {
    title:
      `${isOwn(lastTarget.location.from, own) ? 'Tuo messaggio' : from?.name || from?.address || 'Messaggio'} · ${lastTarget.location.subject || '(senza oggetto)'}`.slice(
        0,
        120
      ),
    data: sections.join('\n\n'),
    handles: added,
    targets: targets.map((target) => ({
      messageKey: target.messageKey,
      handle: handleOf.get(target.messageKey)!
    })),
    seen: new Map(
      targets
        .filter((target) => !noted.has(target.messageKey))
        .map((target) => [seenKey('note', scope.accountId, target.messageKey), 0])
    ),
    looking: targets.map((target) =>
      lookingKey({ kind: 'message', accountId: scope.accountId, messageKey: target.messageKey })
    )
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
