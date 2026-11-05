import type { MailFolder, MessageRef } from '@shared/models'
import { folderForRole, folderRole } from '@shared/folders'

/** A row of the cache: a message in a folder. */
export interface ArchiveRow {
  folderPath: string
  uid: number
  messageKey: string
}

/** What archiving some messages of one account takes (see `planArchive`). */
export interface ArchivePlan {
  /** Rows to move into the archive, by the folder they are in. */
  moves: Map<string, number[]>
  /**
   * Gmail only: rows in the Trash or Spam, by folder. They go back to the
   * inbox — Gmail's own way out of either — and from there to the archive.
   */
  restores: Map<string, number[]>
  /** Each ref given with something to move, and the folders its rows are moved from. */
  pending: Array<{ ref: MessageRef; folders: string[] }>
  /** Refs given whose messages are archived already: nothing is done to them. */
  stayed: MessageRef[]
  /** Refs given the cache does not hold: gone from where they were shown. */
  unknown: MessageRef[]
}

const refKey = (ref: { folderPath: string; uid: number }): string =>
  `${ref.folderPath}\u0000${ref.uid}`

function add(groups: Map<string, number[]>, row: { folderPath: string; uid: number }): void {
  const uids = groups.get(row.folderPath) ?? []

  if (!uids.includes(row.uid)) {
    uids.push(row.uid)
  }

  groups.set(row.folderPath, uids)
}

/**
 * What archiving `refs` — messages of one account — takes, as the provider
 * means it, deciding by what each message is rather than by the row it was
 * picked from:
 *   • on Gmail archiving is leaving the inbox: the message's inbox row goes
 *     to "Tutti i messaggi" and every label stays — one picked from a
 *     label, or from "Tutti i messaggi", is archived by its inbox row. One
 *     in the Trash or Spam is brought out of it into the archive, as
 *     archiving it does on any other server. One in none of them is
 *     archived already;
 *   • elsewhere archiving is the archive folder (\Archive, or the one
 *     created for it): the row picked moves there, from wherever it is —
 *     the Trash and Spam too. One in the archive, or a folder inside it
 *     (Thunderbird files by year), is archived already.
 * `identities` and `rows` are what the cache holds of the refs: the key
 * of each, and every row of those keys.
 */
export function planArchive(input: {
  folders: ReadonlyArray<MailFolder>
  refs: ReadonlyArray<MessageRef>
  identities: ReadonlyArray<{ ref: MessageRef; messageKey: string }>
  rows: ReadonlyArray<ArchiveRow>
}): ArchivePlan {
  const archive = folderForRole(input.folders, '\\Archive')
  const labels = archive?.specialUse?.toLowerCase() === '\\all'
  const roles = new Map(input.folders.map((folder) => [folder.path, folderRole(folder)]))
  const keyOf = new Map(input.identities.map((identity) => [refKey(identity.ref), identity]))
  const rowsOf = new Map<string, ArchiveRow[]>()

  for (const row of input.rows) {
    const keyed = rowsOf.get(row.messageKey) ?? []
    keyed.push(row)
    rowsOf.set(row.messageKey, keyed)
  }

  const archived = (folderPath: string): boolean =>
    archive !== null &&
    (folderPath === archive.path ||
      (Boolean(archive.delimiter) && folderPath.startsWith(`${archive.path}${archive.delimiter}`)))
  const plan: ArchivePlan = {
    moves: new Map(),
    restores: new Map(),
    pending: [],
    stayed: [],
    unknown: []
  }

  for (const ref of input.refs) {
    const identity = keyOf.get(refKey(ref))

    if (!identity) {
      plan.unknown.push(ref)
      continue
    }

    if (!labels) {
      if (archived(ref.folderPath)) {
        plan.stayed.push(ref)
      } else {
        add(plan.moves, ref)
        plan.pending.push({ ref, folders: [ref.folderPath] })
      }
      continue
    }

    const ofMessage = rowsOf.get(identity.messageKey) ?? []
    const inInbox = ofMessage.filter((row) => roles.get(row.folderPath) === '\\Inbox')
    const binned = ofMessage.filter((row) => {
      const role = roles.get(row.folderPath)
      return role === '\\Trash' || role === '\\Junk'
    })

    if (inInbox.length > 0) {
      inInbox.forEach((row) => add(plan.moves, row))
      plan.pending.push({ ref, folders: inInbox.map((row) => row.folderPath) })
    } else if (binned.length > 0) {
      binned.forEach((row) => add(plan.restores, row))
      plan.pending.push({ ref, folders: binned.map((row) => row.folderPath) })
    } else {
      plan.stayed.push(ref)
    }
  }

  return plan
}

/**
 * The refs archived that are still where they were shown: those archived
 * already, and — on Gmail — one picked from a label, the sent mail or "Tutti
 * i messaggi", archived by its inbox row. `failed` are those the server
 * refused, which are not.
 */
export function keptRefs(plan: ArchivePlan, failed: ReadonlyArray<MessageRef>): MessageRef[] {
  const refused = new Set(failed.map(refKey))

  return [
    ...plan.stayed,
    ...plan.pending
      .filter(({ ref, folders }) => !folders.includes(ref.folderPath) && !refused.has(refKey(ref)))
      .map(({ ref }) => ref)
  ]
}
