import { useEffect, useRef, useState } from 'react'

import { cn } from '@renderer/lib/utils'
import type { CommitmentKind, MessageNote, NoteState } from '@shared/segretario'

/** A thing open, by its kind, as a label before its words. */
export const COMMITMENT_LABELS: Readonly<Record<CommitmentKind, string>> = {
  ti_chiedono: 'Ti chiedono',
  hai_promesso: 'Hai promesso',
  aspetti: 'Aspetti',
  da_fare: 'Da fare'
}

/** What the user is expected to do, as a row says it in a word or two. */
export const NOTE_ACTION_LABELS: Readonly<Partial<Record<NoteState, string>>> = {
  da_rispondere: 'Rispondi',
  da_fare: 'Da fare',
  in_attesa: 'In attesa'
}

const SHORT_DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })

/** A deadline as a person says it: "oggi", "domani", "entro 30 ott", "scaduto il 2 ott". */
export function dueLabel(due: string, today = new Date()): string {
  const [year, month, day] = due.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))

  if (days < 0) {
    return `scaduto il ${SHORT_DAY.format(date)}`
  }

  return days === 0 ? 'oggi' : days === 1 ? 'domani' : `entro ${SHORT_DAY.format(date)}`
}

export function noteKey(note: { accountId: string; messageKey: string }): string {
  return `${note.accountId}\u0000${note.messageKey}`
}

/** Whether a note still asks something of the user: not handled, not mere information. */
export function noteAsks(note: MessageNote): boolean {
  return note.dismissedAt === null && NOTE_ACTION_LABELS[note.state] !== undefined
}

/**
 * The Segretario's word on a message, in a row: what is expected and by
 * when, in the star's colour, then the one thing that counts in a calmer
 * shade of it. Noise stays faint.
 */
export function NoteLine({
  note,
  className
}: {
  note: MessageNote
  className?: string
}): React.JSX.Element {
  const asks = noteAsks(note)
  const action = NOTE_ACTION_LABELS[note.state]

  return (
    <span
      className={cn(
        'min-w-0 truncate',
        note.state === 'rumore' ? 'text-faint-foreground' : 'text-ai-muted',
        className
      )}
      title={note.reason ? `${note.summary} — ${note.reason}` : note.summary}
    >
      {asks && action && (
        <span
          className={cn(
            'mr-1.5 font-semibold',
            note.priority === 'alta' ? 'text-urgent' : 'text-ai'
          )}
        >
          {action}
          {note.due && ` · ${dueLabel(note.due)}`}
        </span>
      )}
      {note.summary}
    </span>
  )
}

/** Messages are asked for in pages this big: a page of rows, and room to spare. */
const NOTES_PER_REQUEST = 500

/**
 * The Segretario's notes of the messages a view holds, kept in step as it
 * writes new ones. Each message is asked for once; a change it announces
 * is asked for again.
 */
export function useMessageNotes(
  messages: ReadonlyArray<{ accountId: string; messageKey: string }>
): ReadonlyMap<string, MessageNote> {
  const [notes, setNotes] = useState<ReadonlyMap<string, MessageNote>>(() => new Map())
  const requested = useRef(new Set<string>())

  const fetchNotes = (wanted: ReadonlyArray<{ accountId: string; messageKey: string }>): void => {
    for (let start = 0; start < wanted.length; start += NOTES_PER_REQUEST) {
      const chunk = wanted.slice(start, start + NOTES_PER_REQUEST)

      void window.segretarioApi.getNotes(chunk).then((found) => {
        if (found.length === 0) {
          return
        }

        setNotes((current) => {
          const next = new Map(current)

          for (const note of found) {
            next.set(noteKey(note), note)
          }

          return next
        })
      })
    }
  }

  useEffect(() => {
    const missing = messages.filter((message) => !requested.current.has(noteKey(message)))

    if (missing.length === 0) {
      return
    }

    for (const message of missing) {
      requested.current.add(noteKey(message))
    }

    fetchNotes(missing.map(({ accountId, messageKey }) => ({ accountId, messageKey })))
  }, [messages])

  useEffect(
    () =>
      window.segretarioApi.onNotesChanged((change) => {
        const changed = change.messageKeys
          .map((messageKey) => ({ accountId: change.accountId, messageKey }))
          .filter((message) => requested.current.has(noteKey(message)))

        if (changed.length > 0) {
          fetchNotes(changed)
        }
      }),
    []
  )

  return notes
}
