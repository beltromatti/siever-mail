import type { MailAddress } from './models'

/**
 * Denormalised sender fields.
 *
 * A sender is an address. Each message keeps the name its own header gave
 * (what its row shows) and the address it came from (what groups it); the
 * database adds the label the address is filed under — the best name seen
 * for it across every message — and orders on that label's sort key.
 * Sorting the raw `from_json` text, as the list once did, filed every
 * nameless sender apart from the named ones.
 */

/** The name this message's header gives its sender, or the address. */
export function deriveSenderName(from: ReadonlyArray<MailAddress>): string {
  const first = from[0]

  if (!first) {
    return ''
  }

  return first.name?.trim() || first.address.trim()
}

/**
 * Identity of the sender, independent of how they spelled their display
 * name in any given message: "M. Rossi" and "Mario Rossi" writing from
 * the same address are one sender.
 */
export function deriveSenderKey(from: ReadonlyArray<MailAddress>): string {
  return from[0]?.address.trim().toLowerCase() ?? ''
}

/**
 * Whether a header display name says more than the address itself. Plenty
 * of senders put their address in the name slot, or leave it empty; neither
 * is a name worth filing the sender under.
 */
export function isMeaningfulDisplayName(name: string | undefined, address: string): boolean {
  const trimmed = name?.trim() ?? ''
  return trimmed.length > 0 && trimmed.toLowerCase() !== address.trim().toLowerCase()
}

/**
 * The key a sender is ordered by. Ordering on the display label as stored
 * was case- and accent-sensitive — SQLite compares bytes — so every
 * capitalised name sorted ahead of every lower-case address and "Élite"
 * landed after "Zeta". The key folds all of that away, and drops the
 * quotes and punctuation some clients wrap names in.
 */
export function senderSortKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
}
