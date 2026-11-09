import type { MailAddress } from '@shared/models'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import type { MessageLocation, SegretarioMailPort } from '../agent/tool-types'
import type { Registry } from '../registry/registry'
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
  const read = new Set(
    (
      await registry.notes.many(
        messages.map((message) => ({ accountId: scope.accountId, messageKey: message.messageKey }))
      )
    ).map((note) => note.messageKey)
  )
  let targets = messages.filter(
    (message) => !read.has(message.messageKey) && message.location.dateIso >= sinceIso
  )

  // A copy of a message read in another account: its note, without reading it again.
  for (const message of [...targets]) {
    const twins = await mail.sameMessageElsewhere(message.location.ref)
    const twin = (await registry.notes.many(twins)).find((note) => note.twinAccountId === null)

    if (twin) {
      await registry.writeNote(
        {
          accountId: scope.accountId,
          messageKey: message.messageKey,
          threadId: scope.threadId,
          direction: isOwn(message.location.from, own) ? 'out' : 'in',
          messageDate: message.location.dateIso
        },
        {
          summary: twin.summary,
          nature: twin.nature,
          priority: twin.priority,
          reason: twin.reason,
          due: twin.due,
          // Told where it is not muted, once: the notifications know a copy (§13.3).
          notify: twin.notify,
          alert: twin.alert
        },
        { by: 'sistema' },
        { twinAccountId: twin.accountId }
      )
      targets = targets.filter((target) => target.messageKey !== message.messageKey)
    }
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
