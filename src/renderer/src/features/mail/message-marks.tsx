import { Stamp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useLanguage, useMessages } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'
import type { MessageMark } from '@shared/message-marks'

const MESSAGES = defineMessages({
  inPlace: {
    en: (place: string) => ` in ${place}`,
    it: (place: string) => ` in ${place}`,
    de: (place: string) => ` in ${place}`
  },
  show: { en: 'Show', it: 'Mostra', de: 'Zeigen' }
})

/** A message's marks are kept by its account and key. */
export function markKey(message: { accountId: string; messageKey: string }): string {
  return `${message.accountId}\u0000${message.messageKey}`
}

/** Messages are asked for in pages this big: a page of rows, and room to spare. */
const MARKS_PER_REQUEST = 500

/**
 * The marks extensions left on the messages a list holds (`MessageMark`),
 * the newest first, kept in step as they are left. The mail's, not the
 * Segretario's: they show with the AI off too.
 */
export function useMessageMarks(
  messages: ReadonlyArray<{ accountId: string; messageKey: string }>
): ReadonlyMap<string, MessageMark[]> {
  const [marks, setMarks] = useState<ReadonlyMap<string, MessageMark[]>>(() => new Map())
  const requested = useRef(new Set<string>())

  const fetchMarks = (wanted: ReadonlyArray<{ accountId: string; messageKey: string }>): void => {
    for (let start = 0; start < wanted.length; start += MARKS_PER_REQUEST) {
      const chunk = wanted.slice(start, start + MARKS_PER_REQUEST)

      void window.mailApi.messageMarks(chunk).then((found) => {
        setMarks((current) => {
          const next = new Map(current)

          for (const message of chunk) {
            next.delete(markKey(message))
          }

          for (const mark of found) {
            next.set(markKey(mark), [...(next.get(markKey(mark)) ?? []), mark])
          }

          return next
        })
      })
    }
  }

  useEffect(() => {
    const missing = messages.filter((message) => !requested.current.has(markKey(message)))

    if (missing.length === 0) {
      return
    }

    for (const message of missing) {
      requested.current.add(markKey(message))
    }

    fetchMarks(missing.map(({ accountId, messageKey }) => ({ accountId, messageKey })))
  }, [messages])

  useEffect(
    () =>
      window.mailApi.onMarksChanged((change) => {
        const changed = change ? new Set(change.messageKeys) : null
        const wanted = messages.filter(
          (message) =>
            requested.current.has(markKey(message)) &&
            (change === null ||
              (message.accountId === change.accountId && changed?.has(message.messageKey)))
        )

        if (wanted.length > 0) {
          fetchMarks(wanted.map(({ accountId, messageKey }) => ({ accountId, messageKey })))
        }
      }),
    [messages]
  )

  return marks
}

/** "…/Clienti/Casa al mare/Corrispondenza" as it reads: its last few places. */
function placeWords(place: string): string {
  return place.split(/[\\/]/).filter(Boolean).slice(-3).join(' › ')
}

/**
 * The marks of the message in the reader: what each says, where, when, and
 * the folder a click away.
 */
export function MessageMarksLine({
  marks
}: {
  marks: ReadonlyArray<MessageMark>
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)
  const { formatLocale } = useLanguage()

  if (marks.length === 0) {
    return null
  }

  const shortDay = new Intl.DateTimeFormat(formatLocale, { day: 'numeric', month: 'short' })

  return (
    <div className="mb-3 flex flex-col gap-1">
      {marks.map(({ extension, label, place, markedAt }) => (
        <div
          key={`${extension}\u0000${place ?? ''}`}
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11.5px]"
        >
          <Stamp className="text-faint-foreground size-3.5 shrink-0" />
          <span className="min-w-0 truncate" title={place ?? label}>
            <span className="text-foreground font-semibold">{label}</span>
            {place && m.inPlace(placeWords(place))} · {shortDay.format(new Date(markedAt))}
          </span>
          {place && (
            <button
              type="button"
              onClick={() => void window.mailApi.revealFile(place)}
              className="hover:text-foreground focus-visible:ring-ring/60 shrink-0 rounded-sm outline-none focus-visible:ring-2"
            >
              {m.show}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
