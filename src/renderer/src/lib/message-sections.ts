import type { MailMessageSummary, MessageGroupingMode, MessageListSortField } from '@shared/models'

/**
 * Slices an already-ordered page of messages into the labelled sections the
 * list renders.
 *
 * The database does the ordering; this only walks the page and cuts it where
 * the section key changes. That is why sender grouping asks the query to
 * order by sender first — each sender then arrives as one contiguous run and
 * a single pass is enough, with no client-side re-sorting to drift out of
 * step with what the server returned.
 */
export interface MessageSection {
  /**
   * Identity of this RUN, not of the thing it groups.
   *
   * The distinction matters: a sender only produces one section while the
   * query orders by sender, but between changing the grouping and the
   * re-ordered page arriving the list is briefly grouped by sender over
   * date-ordered rows — and the same sender then appears in several
   * non-adjacent runs. Reusing the sender as the key there hands React
   * duplicate keys, which breaks reconciliation and leaves orphaned
   * headings behind for good. The run ordinal keeps every key unique.
   */
  key: string
  /** Heading shown above the run. Empty when the list is ungrouped. */
  label: string
  messages: MailMessageSummary[]
  unreadCount: number
}

const UNGROUPED_SECTION_KEY = '__all__'

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Monday-based start of the week containing `date`. Italian calendars start
 * on Monday, so a message from Sunday belongs to the week that just ended,
 * not to the one starting the next day.
 */
function startOfWeek(date: Date): number {
  const dayOfWeek = (date.getDay() + 6) % 7
  return startOfDay(date) - dayOfWeek * 24 * 60 * 60 * 1000
}

function capitalizeFirst(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

/**
 * Buckets a message date relative to `now`: Oggi / Ieri / this week / this
 * month, then one section per calendar month. Returns a key plus the label,
 * so two dates in the same month share a section without re-deriving text.
 */
function resolveDateSection(dateIso: string, now: Date): { key: string; label: string } {
  const date = new Date(dateIso)

  if (Number.isNaN(date.valueOf())) {
    return { key: 'unknown', label: 'Data sconosciuta' }
  }

  const messageDay = startOfDay(date)
  const today = startOfDay(now)
  const dayInMs = 24 * 60 * 60 * 1000

  if (messageDay === today) {
    return { key: 'today', label: 'Oggi' }
  }

  if (messageDay === today - dayInMs) {
    return { key: 'yesterday', label: 'Ieri' }
  }

  // Future-dated messages do exist (clock skew on the sending server). They
  // belong at the top with today's mail rather than in a month section that
  // would sort below it.
  if (messageDay > today) {
    return { key: 'today', label: 'Oggi' }
  }

  if (messageDay >= startOfWeek(now)) {
    return { key: 'this-week', label: 'Questa settimana' }
  }

  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
    return { key: 'this-month', label: 'Questo mese' }
  }

  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = new Intl.DateTimeFormat('it-IT', {
    month: 'long',
    year: 'numeric'
  }).format(date)

  return { key: `month-${monthKey}`, label: capitalizeFirst(monthLabel) }
}

function resolveSenderSection(message: MailMessageSummary): { key: string; label: string } {
  const key = message.senderKey || message.senderName.toLowerCase()
  return {
    key: key ? `sender-${key}` : 'sender-unknown',
    label: message.senderName || message.senderKey || 'Mittente sconosciuto'
  }
}

/**
 * Date grouping only makes sense while the list is ordered by date — under
 * any other sort the buckets would interleave and produce a "Oggi" heading
 * three times down the page. Sender grouping is always valid because the
 * query puts the sender key first in its ORDER BY.
 */
export function isGroupingApplicable(
  grouping: MessageGroupingMode,
  sortField: MessageListSortField
): boolean {
  if (grouping === 'none') {
    return false
  }

  if (grouping === 'date') {
    return sortField === 'date'
  }

  return true
}

export function buildMessageSections(
  messages: MailMessageSummary[],
  grouping: MessageGroupingMode,
  sortField: MessageListSortField,
  now: Date = new Date()
): MessageSection[] {
  const countUnread = (items: MailMessageSummary[]): number =>
    items.reduce((total, message) => (message.isRead ? total : total + 1), 0)

  if (messages.length === 0) {
    return []
  }

  if (!isGroupingApplicable(grouping, sortField)) {
    return [
      {
        key: UNGROUPED_SECTION_KEY,
        label: '',
        messages,
        unreadCount: countUnread(messages)
      }
    ]
  }

  const resolveSection =
    grouping === 'sender'
      ? resolveSenderSection
      : (message: MailMessageSummary) => resolveDateSection(message.date, now)

  const sections: MessageSection[] = []
  let currentGroupKey: string | null = null

  for (const message of messages) {
    const { key, label } = resolveSection(message)
    const currentSection = sections[sections.length - 1]

    if (currentSection && currentGroupKey === key) {
      currentSection.messages.push(message)
      continue
    }

    currentGroupKey = key
    sections.push({
      key: `${key}#${sections.length}`,
      label,
      messages: [message],
      unreadCount: 0
    })
  }

  for (const section of sections) {
    section.unreadCount = countUnread(section.messages)
  }

  return sections
}
