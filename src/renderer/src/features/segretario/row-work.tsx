import { useEffect, useRef, useState } from 'react'

import { languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, type Messages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import type { CommitmentKind, MessageRowWork } from '@shared/segretario'

/** A thing open, by its kind, as a label before its words. */
export const COMMITMENT_LABELS = defineMessages({
  ti_chiedono: { en: 'Asked of you', it: 'Ti chiedono', de: 'An Sie gerichtet' },
  hai_promesso: { en: 'You promised', it: 'Hai promesso', de: 'Von Ihnen zugesagt' },
  aspetti: { en: 'You’re waiting', it: 'Aspetti', de: 'Sie warten' },
  da_fare: { en: 'To do', it: 'Da fare', de: 'Zu tun' }
}) satisfies Record<CommitmentKind, unknown>

const MESSAGES = defineMessages({
  overdue: {
    en: (day: string) => `was due ${day}`,
    it: (day: string) => `scaduto il ${day}`,
    de: (day: string) => `überfällig seit ${day}`
  },
  today: { en: 'today', it: 'oggi', de: 'heute' },
  tomorrow: { en: 'tomorrow', it: 'domani', de: 'morgen' },
  by: {
    en: (day: string) => `by ${day}`,
    it: (day: string) => `entro ${day}`,
    de: (day: string) => `bis ${day}`
  },
  readyReply: { en: 'Ready reply', it: 'Risposta pronta', de: 'Fertige Antwort' }
})

const SHORT_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }

/** A day AAAA-MM-GG at its local midnight. */
function dayDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

/** How many days from today a day is: negative when past. */
export function daysFromToday(day: string, today = new Date()): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((dayDate(day).getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
}

/** A deadline as a person says it: "today", "tomorrow", "by Oct 30", "was due Oct 2". */
export function dueLabel(due: string, today = new Date()): string {
  const m = messagesNow(MESSAGES)
  const days = daysFromToday(due, today)
  const day = (): string =>
    new Intl.DateTimeFormat(languageNow().formatLocale, SHORT_DAY).format(dayDate(due))

  if (days < 0) {
    return m.overdue(day())
  }

  return days === 0 ? m.today : days === 1 ? m.tomorrow : m.by(day())
}

export function rowWorkKey(message: { accountId: string; messageKey: string }): string {
  return `${message.accountId}\u0000${message.messageKey}`
}

/** What a row says is expected now, in a word or two: what is owed, a reply ready, an answer awaited. */
function expected(
  work: Pick<MessageRowWork, 'owed' | 'reply' | 'awaited'>,
  kinds: Messages<typeof COMMITMENT_LABELS>
): string | null {
  if (work.owed) {
    return kinds[work.owed.kind]
  }

  if (work.reply === 'pronta') {
    return messagesNow(MESSAGES).readyReply
  }

  return work.awaited ? messagesNow(PLACES).waiting : null
}

/** Whether the Segretario has a word for a message's row; without one the row shows the preview. */
export function hasWorkLine(work: MessageRowWork): boolean {
  return work.note !== null || expected(work, messagesNow(COMMITMENT_LABELS)) !== null
}

/**
 * The Segretario's word on a message, in a row: what is expected now and
 * by when, in the star's colour — red when it matters or is late — then
 * what the message said in a calmer shade. Noise stays faint.
 */
export function WorkLine({
  work,
  className
}: {
  work: MessageRowWork
  className?: string
}): React.JSX.Element {
  // Read here, so a row kept by its list redraws in the interface's language.
  const label = expected(work, useMessages(COMMITMENT_LABELS))
  const due = work.owed?.due ?? null
  const urgent = work.note?.priority === 'alta' || (due !== null && daysFromToday(due) <= 0)
  const note = work.note

  return (
    <span
      className={cn(
        'min-w-0 truncate',
        note?.nature === 'rumore' && !label ? 'text-faint-foreground' : 'text-ai-muted',
        className
      )}
      title={note ? (note.reason ? `${note.summary} — ${note.reason}` : note.summary) : undefined}
    >
      {label && (
        <span className={cn('mr-1.5 font-semibold', urgent ? 'text-urgent' : 'text-ai')}>
          {label}
          {due && ` · ${dueLabel(due)}`}
        </span>
      )}
      {note?.summary}
    </span>
  )
}

/** Messages are asked for in pages this big: a page of rows, and room to spare. */
const ROWS_PER_REQUEST = 500

/**
 * What the Segretario has on the messages a list holds — notes, what is
 * open, replies — kept in step as its work changes. Each message is asked
 * for once; one whose work changed is asked for again.
 */
export function useRowWork(
  messages: ReadonlyArray<{ accountId: string; messageKey: string; threadId?: string }>
): ReadonlyMap<string, MessageRowWork> {
  const [work, setWork] = useState<ReadonlyMap<string, MessageRowWork>>(() => new Map())
  const requested = useRef(new Set<string>())

  const fetchWork = (wanted: ReadonlyArray<{ accountId: string; messageKey: string }>): void => {
    for (let start = 0; start < wanted.length; start += ROWS_PER_REQUEST) {
      const chunk = wanted.slice(start, start + ROWS_PER_REQUEST)

      void window.segretarioApi.getRowWork(chunk).then((found) => {
        setWork((current) => {
          const next = new Map(current)

          // What has nothing any more — a commitment closed, a reply used — leaves its row.
          for (const message of chunk) {
            next.delete(rowWorkKey(message))
          }

          for (const row of found) {
            next.set(rowWorkKey(row), row)
          }

          return next
        })
      })
    }
  }

  useEffect(() => {
    const missing = messages.filter((message) => !requested.current.has(rowWorkKey(message)))

    if (missing.length === 0) {
      return
    }

    for (const message of missing) {
      requested.current.add(rowWorkKey(message))
    }

    fetchWork(missing.map(({ accountId, messageKey }) => ({ accountId, messageKey })))
  }, [messages])

  useEffect(
    () =>
      window.segretarioApi.onWorkChanged((change) => {
        const changed = new Set(change.messageKeys)
        const threads = new Set(change.threadIds)
        // A change names messages, or whole conversations: the rows of either are asked again.
        const wanted = messages.filter(
          (message) =>
            requested.current.has(rowWorkKey(message)) &&
            (change.accountIds.length === 0 || change.accountIds.includes(message.accountId)) &&
            (changed.has(message.messageKey) ||
              (message.threadId !== undefined && threads.has(message.threadId)))
        )

        if (wanted.length > 0) {
          fetchWork(wanted.map(({ accountId, messageKey }) => ({ accountId, messageKey })))
        }
      }),
    [messages]
  )

  return work
}
