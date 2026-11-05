import type { CopyResponseObject, ImapFlow } from 'imapflow'

import { formatUidSet } from './fetch-results'

/** What moving and deleting on the server use of a connection. */
export type RemovingClient = Pick<
  ImapFlow,
  | 'capabilities'
  | 'messageCopy'
  | 'messageDelete'
  | 'messageFlagsAdd'
  | 'messageMove'
  | 'noop'
  | 'search'
>

/**
 * Whether messages of the selected mailbox other than `uids` and `ours` —
 * those this app deleted before, still waiting there — are flagged
 * \Deleted: marked for deletion by another program, which has yet to
 * expunge them. A server that cannot say counts as one that has some. The
 * NOOP comes first: a session's SEARCH sees the flags another one set only
 * once the server has told it of them (Dovecot holds them until then).
 */
async function othersMarkedDeleted(
  client: RemovingClient,
  uids: ReadonlyArray<number>,
  ours: ReadonlySet<number>
): Promise<boolean> {
  const own = new Set(uids)
  await client.noop()
  const flagged = await client.search({ deleted: true }, { uid: true })

  return !Array.isArray(flagged) || flagged.some((uid) => !own.has(uid) && !ours.has(uid))
}

/**
 * Deletes `uids` of the selected mailbox for good, and nothing else. With
 * UIDPLUS that is UID EXPUNGE. Without it EXPUNGE removes every message
 * flagged \Deleted — those another program marked and has yet to expunge
 * too, deleted for good on nobody's word. There it runs only when no
 * other message is so flagged, but `ours` — what this app deleted there
 * before and left waiting; otherwise `uids` stay flagged \Deleted, for the
 * next expunge of the folder to take: they join `ours`, and it resolves
 * false. Between the check and the EXPUNGE is one round trip: another
 * program flagging a message in that moment is the one case left. Throws
 * when the server refuses.
 */
export async function expungeOnly(
  client: RemovingClient,
  uids: ReadonlyArray<number>,
  ours: Set<number> = new Set()
): Promise<boolean> {
  const range = formatUidSet(uids)

  if (!client.capabilities.has('UIDPLUS')) {
    if (!(await client.messageFlagsAdd(range, ['\\Deleted'], { uid: true }))) {
      throw new Error('Il server non ha segnato i messaggi come eliminati.')
    }

    if (await othersMarkedDeleted(client, uids, ours)) {
      uids.forEach((uid) => ours.add(uid))
      return false
    }
  }

  if (!(await client.messageDelete(range, { uid: true }))) {
    throw new Error('Il server non ha eliminato i messaggi.')
  }

  return true
}

/**
 * Moves messages of the selected mailbox, and throws when the server did
 * not. imapflow reports a refused MOVE (a folder that does not exist, a
 * full quota) as `false` instead of an error, which let messages vanish
 * here while they stayed where they were. And on a server without MOVE its
 * own copy-then-delete deletes the originals even when the copy was
 * refused, so that path is spelled out here, in order, checking each step
 * — and never expunging what another program marked as deleted (see
 * `expungeOnly`, and `ours`): where some is waiting, the move is not
 * started; where some comes meanwhile, the originals stay flagged \Deleted,
 * and join `ours`.
 *
 * Resolves with what a server with UIDPLUS says about the destination: its
 * UIDVALIDITY and the UID each message has there.
 */
export async function moveOnServer(
  client: RemovingClient,
  uids: ReadonlyArray<number>,
  destination: string,
  ours: Set<number> = new Set()
): Promise<CopyResponseObject> {
  const range = formatUidSet(uids)

  if (client.capabilities.has('MOVE')) {
    const moved = await client.messageMove(range, destination, { uid: true })

    if (!moved) {
      throw new Error(`Il server non ha spostato i messaggi in «${destination}».`)
    }
    return moved
  }

  if (!client.capabilities.has('UIDPLUS') && (await othersMarkedDeleted(client, uids, ours))) {
    throw new Error(
      'Questo server sposta i messaggi copiandoli ed eliminando gli originali, e così eliminerebbe per sempre anche quelli che un altro programma ha segnato come eliminati in questa cartella: spostamento non eseguito.'
    )
  }

  const copied = await client.messageCopy(range, destination, { uid: true })

  if (!copied) {
    throw new Error(`Il server non ha copiato i messaggi in «${destination}».`)
  }

  let expunged: boolean

  try {
    expunged = await expungeOnly(client, uids, ours)
  } catch (error) {
    throw new Error(
      `I messaggi sono stati copiati in «${destination}» ma il server non li ha rimossi dalla cartella di origine.`,
      { cause: error }
    )
  }

  if (!expunged) {
    throw new Error(
      `I messaggi sono stati copiati in «${destination}»; qui restano segnati come eliminati, finché la cartella non viene ripulita: un altro programma vi ha segnato come eliminati anche altri messaggi, che SIEVER Mail non elimina al suo posto.`
    )
  }

  return copied
}
