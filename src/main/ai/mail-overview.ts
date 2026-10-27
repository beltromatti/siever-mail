import type { PrismaClient } from '@prisma/client'

import { folderRole } from '@shared/folders'
import type { MailAccount, MailAddress, MailFolder } from '@shared/models'

/** One message as the overview counts it: once, whichever folders hold it. */
export interface OverviewRow {
  messageKey: string
  threadId: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  dateIso: string
}

export interface OverviewPerson {
  address: string
  name: string
  messages: number
  /** For those who write: how many of their messages the user answered. */
  answered?: number
  lastIso: string
}

export interface AccountOverview {
  sent: number
  received: number
  /** Who the user writes to, the most first. */
  writtenTo: OverviewPerson[]
  /** Who writes to the user, the most first. */
  writers: OverviewPerson[]
  /** `AAAA-MM` → messages sent and received that month, newest first. */
  months: Array<{ month: string; sent: number; received: number }>
}

/**
 * What an account's mail says about the user's work, from the envelopes
 * alone: who they write to, who writes to them and how often they answer,
 * month by month. A message is the user's when it comes from one of their
 * addresses; it is answered when the user wrote in its conversation after
 * it. Counted, not guessed: what matters to the user is what they do.
 */
export function summarizeMail(
  rows: ReadonlyArray<OverviewRow>,
  ownAddresses: ReadonlySet<string>,
  peopleLimit: number
): AccountOverview {
  const own = (address: MailAddress): boolean => ownAddresses.has(address.address.toLowerCase())
  const seen = new Set<string>()
  const sent: OverviewRow[] = []
  const received: OverviewRow[] = []

  for (const row of rows) {
    if (seen.has(row.messageKey)) {
      continue
    }

    seen.add(row.messageKey)
    ;(row.from.some(own) ? sent : received).push(row)
  }

  // When the user last wrote in each conversation: a message they answered
  // is one with a reply of theirs after it.
  const lastSentInThread = new Map<string, string>()

  for (const row of sent) {
    const last = lastSentInThread.get(row.threadId)

    if (!last || row.dateIso > last) {
      lastSentInThread.set(row.threadId, row.dateIso)
    }
  }

  const tally = (
    people: Map<string, OverviewPerson>,
    address: MailAddress,
    dateIso: string,
    answered?: boolean
  ): void => {
    const key = address.address.toLowerCase()
    const person = people.get(key) ?? {
      address: key,
      name: '',
      messages: 0,
      ...(answered === undefined ? {} : { answered: 0 }),
      lastIso: dateIso
    }

    person.messages++
    person.name ||= address.name?.trim() ?? ''

    if (answered && person.answered !== undefined) {
      person.answered++
    }

    if (dateIso > person.lastIso) {
      person.lastIso = dateIso
      person.name = address.name?.trim() || person.name
    }

    people.set(key, person)
  }

  const writtenTo = new Map<string, OverviewPerson>()
  const writers = new Map<string, OverviewPerson>()
  const months = new Map<string, { sent: number; received: number }>()
  const month = (dateIso: string): { sent: number; received: number } => {
    const key = dateIso.slice(0, 7)
    const entry = months.get(key) ?? { sent: 0, received: 0 }
    months.set(key, entry)
    return entry
  }

  for (const row of sent) {
    month(row.dateIso).sent++

    for (const address of [...row.to, ...row.cc]) {
      if (!own(address)) {
        tally(writtenTo, address, row.dateIso)
      }
    }
  }

  for (const row of received) {
    month(row.dateIso).received++
    const sender = row.from[0]

    if (sender) {
      const reply = lastSentInThread.get(row.threadId)
      tally(writers, sender, row.dateIso, reply !== undefined && reply > row.dateIso)
    }
  }

  const ranked = (people: Map<string, OverviewPerson>): OverviewPerson[] =>
    [...people.values()]
      .sort((a, b) => b.messages - a.messages || b.lastIso.localeCompare(a.lastIso))
      .slice(0, peopleLimit)

  return {
    sent: sent.length,
    received: received.length,
    writtenTo: ranked(writtenTo),
    writers: ranked(writers),
    months: [...months.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, counts]) => ({ month: key, ...counts }))
  }
}

/** The folders an overview leaves out: what was thrown away, never wanted, or not yet written. */
function countedFolderPaths(folders: ReadonlyArray<MailFolder>): string[] {
  return folders
    .filter((folder) => {
      const role = folderRole(folder)
      return role !== '\\Junk' && role !== '\\Trash' && role !== '\\Drafts'
    })
    .map((folder) => folder.path)
}

function parseAddresses(json: string): MailAddress[] {
  const parsed = JSON.parse(json) as unknown
  return Array.isArray(parsed) ? (parsed as MailAddress[]) : []
}

/** The overview of one account since `sinceIso`. */
export async function accountOverview(
  prisma: PrismaClient,
  account: MailAccount,
  folders: ReadonlyArray<MailFolder>,
  ownAddresses: ReadonlySet<string>,
  sinceIso: string,
  peopleLimit: number
): Promise<AccountOverview> {
  const rows = await prisma.message.findMany({
    where: {
      accountId: account.id,
      folderPath: { in: countedFolderPaths(folders) },
      dateIso: { gte: sinceIso }
    },
    select: {
      messageKey: true,
      threadId: true,
      fromJson: true,
      toJson: true,
      ccJson: true,
      dateIso: true
    }
  })

  return summarizeMail(
    rows.map((row) => ({
      messageKey: row.messageKey,
      threadId: row.threadId,
      from: parseAddresses(row.fromJson),
      to: parseAddresses(row.toJson),
      cc: parseAddresses(row.ccJson),
      dateIso: row.dateIso
    })),
    ownAddresses,
    peopleLimit
  )
}
