import type { MailAddress } from './models'

/**
 * Denormalised sender fields.
 *
 * Ordering and grouping a mailbox by sender used to run against the raw
 * `from_json` column — the serialized address array. That sorts on the
 * JSON text, so `[{"address":"x"}]` and `[{"name":"A","address":"x"}]`
 * land in two different blocks and every nameless sender files apart from
 * the named ones. These two helpers give the database something stable to
 * order and group on instead, and the renderer reuses them so the label it
 * paints is always the one the query sorted by.
 */

/** What the UI shows and what alphabetical sorting compares. */
export function deriveSenderName(from: ReadonlyArray<MailAddress>): string {
  const first = from[0]

  if (!first) {
    return ''
  }

  return first.name?.trim() || first.address.trim()
}

/**
 * Identity of the sender, independent of how they spelled their display
 * name in any given message. Grouping keys off this so "A. Beltrami" and
 * "Alessandro Beltrami" from the same address stay in one section.
 */
export function deriveSenderKey(from: ReadonlyArray<MailAddress>): string {
  return from[0]?.address.trim().toLowerCase() ?? ''
}
