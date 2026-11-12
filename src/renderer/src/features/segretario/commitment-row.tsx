import { useState } from 'react'
import { Check, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, type Messages } from '@shared/i18n'
import type { Commitment, CommitmentStatus, WorkActor } from '@shared/segretario'

import { COMMITMENT_LABELS, daysFromToday, dueLabel } from './row-work'

const MESSAGES = defineMessages({
  tomorrow: { en: 'Tomorrow', it: 'Domani', de: 'Morgen' },
  friday: { en: 'Friday', it: 'Venerdì', de: 'Freitag' },
  nextMonday: { en: 'Next Monday', it: 'Lunedì prossimo', de: 'Nächster Montag' },
  inAWeek: { en: 'In a week', it: 'Tra una settimana', de: 'In einer Woche' },
  inAMonth: { en: 'In a month', it: 'Tra un mese', de: 'In einem Monat' },
  done: {
    en: (by: WorkActor): string =>
      by === 'utente' ? 'Done by you' : by === 'segretario' ? 'Done by the Segretario' : 'Done',
    it: (by: WorkActor): string =>
      `Fatta${by === 'utente' ? ' da te' : by === 'segretario' ? ' dal Segretario' : ''}`,
    de: (by: WorkActor): string =>
      by === 'utente'
        ? 'Von Ihnen erledigt'
        : by === 'segretario'
          ? 'Vom Segretario erledigt'
          : 'Erledigt'
  },
  arrived: {
    en: (by: WorkActor): string =>
      by === 'utente'
        ? 'Arrived, marked by you'
        : by === 'segretario'
          ? 'Arrived, marked by the Segretario'
          : 'Arrived',
    it: (by: WorkActor): string =>
      `Arrivato${by === 'utente' ? ' da te' : by === 'segretario' ? ' dal Segretario' : ''}`,
    de: (by: WorkActor): string =>
      by === 'utente'
        ? 'Eingetroffen, von Ihnen markiert'
        : by === 'segretario'
          ? 'Eingetroffen, vom Segretario markiert'
          : 'Eingetroffen'
  },
  notNeededBy: {
    en: (by: WorkActor): string =>
      by === 'utente'
        ? 'Not needed, marked by you'
        : by === 'segretario'
          ? 'Not needed, marked by the Segretario'
          : 'Not needed',
    it: (by: WorkActor): string =>
      `Non serve${by === 'utente' ? ' da te' : by === 'segretario' ? ' dal Segretario' : ''}`,
    de: (by: WorkActor): string =>
      by === 'utente'
        ? 'Nicht nötig, von Ihnen markiert'
        : by === 'segretario'
          ? 'Nicht nötig, vom Segretario markiert'
          : 'Nicht nötig'
  },
  postponedTo: {
    en: (day: string) => `Postponed to ${day}`,
    it: (day: string) => `Rinviata a ${day}`,
    de: (day: string) => `Verschoben auf ${day}`
  },
  postponed: { en: 'Postponed', it: 'Rinviata', de: 'Verschoben' },
  notUndone: {
    en: 'Can’t be undone',
    it: 'Non si annulla',
    de: 'Lässt sich nicht rückgängig machen'
  },
  markedDone: { en: 'Marked as done', it: 'Segnata come fatta', de: 'Als erledigt markiert' },
  markedNotNeeded: {
    en: 'Marked as not needed',
    it: 'Segnata come non necessaria',
    de: 'Als nicht nötig markiert'
  },
  markedArrived: {
    en: 'Marked as arrived',
    it: 'Segnato come arrivato',
    de: 'Als eingetroffen markiert'
  },
  undo: { en: 'Undo', it: 'Annulla', de: 'Rückgängig' },
  notChanged: { en: 'Not changed', it: 'Non è cambiata', de: 'Nicht geändert' },
  markArrived: {
    en: (text: string) => `Mark as arrived: ${text}`,
    it: (text: string) => `Segna come arrivato: ${text}`,
    de: (text: string) => `Als eingetroffen markieren: ${text}`
  },
  markDone: {
    en: (text: string) => `Mark as done: ${text}`,
    it: (text: string) => `Segna come fatta: ${text}`,
    de: (text: string) => `Als erledigt markieren: ${text}`
  },
  reopenItem: {
    en: (text: string) => `Reopen: ${text}`,
    it: (text: string) => `Riapri: ${text}`,
    de: (text: string) => `Wieder öffnen: ${text}`
  },
  arrivedTitle: { en: 'Arrived', it: 'Arrivato', de: 'Eingetroffen' },
  doneTitle: { en: 'Done', it: 'Fatta', de: 'Erledigt' },
  reopen: { en: 'Reopen', it: 'Riapri', de: 'Wieder öffnen' },
  correct: { en: 'Edit', it: 'Correggi', de: 'Korrigieren' },
  stillOpen: { en: 'Still open', it: 'È ancora aperta', de: 'Noch offen' },
  hasArrived: { en: 'It arrived', it: 'È arrivato', de: 'Ist eingetroffen' },
  isDone: { en: 'It’s done', it: 'È fatta', de: 'Ist erledigt' },
  notNeeded: { en: 'Not needed', it: 'Non serve', de: 'Nicht nötig' },
  more: {
    en: (text: string) => `More: ${text}`,
    it: (text: string) => `Altro: ${text}`,
    de: (text: string) => `Mehr: ${text}`
  },
  followUp: { en: 'Follow up…', it: 'Sollecita…', de: 'Nachfassen…' },
  postpone: { en: 'Postpone', it: 'Rinvia', de: 'Verschieben' },
  deadline: { en: 'Deadline', it: 'Scadenza', de: 'Frist' },
  today: { en: 'Today', it: 'Oggi', de: 'Heute' },
  noDeadline: { en: 'No deadline', it: 'Senza scadenza', de: 'Keine Frist' },
  hide: { en: 'Hide', it: 'Nascondi', de: 'Ausblenden' },
  doneLately: { en: 'Done lately', it: 'Fatte di recente', de: 'Kürzlich erledigt' }
})

const SHORT_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }

function shortDay(day: string): string {
  return new Intl.DateTimeFormat(languageNow().formatLocale, SHORT_DAY).format(
    new Date(`${day}T00:00`)
  )
}

/** A day AAAA-MM-GG, local. */
function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function inDays(days: number, from = new Date()): string {
  return isoDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days))
}

/** The next given weekday after today (1 Monday … 5 Friday). */
function nextWeekday(weekday: number, from = new Date()): string {
  const ahead = (weekday - from.getDay() + 7) % 7 || 7
  return inDays(ahead, from)
}

/**
 * The days a thing can be put off to, or given as its deadline, as a person
 * says them — each day once: on a Thursday, "Friday" is tomorrow.
 */
function dayChoices(m: Messages<typeof MESSAGES>): Array<{ label: string; day: string }> {
  const seen = new Set<string>()

  return [
    { label: m.tomorrow, day: inDays(1) },
    { label: m.friday, day: nextWeekday(5) },
    { label: m.nextMonday, day: nextWeekday(1) },
    { label: m.inAWeek, day: inDays(7) },
    { label: m.inAMonth, day: inDays(30) }
  ]
    .filter((choice) => !seen.has(choice.day) && Boolean(seen.add(choice.day)))
    .map((choice) => ({ ...choice, label: `${choice.label} · ${shortDay(choice.day)}` }))
}

/** What became of a thing no longer open, in a few words — and by whom, when not the app itself. */
function settledLine(commitment: Commitment, m: Messages<typeof MESSAGES>): string | null {
  const reason = commitment.reason ? ` · ${commitment.reason}` : ''

  switch (commitment.status) {
    case 'fatta':
      return `${(commitment.kind === 'aspetti' ? m.arrived : m.done)(commitment.setBy)}${reason}`
    case 'non_serve':
      return `${m.notNeededBy(commitment.setBy)}${reason}`
    case 'rinviata':
      return commitment.until ? m.postponedTo(shortDay(commitment.until)) : m.postponed
    case 'aperta':
      return null
  }
}

/** "Undo" on a tick: the thing as it was, and what the tick taught taken back; said when it cannot. */
export function undoTick(id: number): void {
  void window.segretarioApi.undoCommitmentStatus(id).catch((error: unknown) =>
    toast.error(messagesNow(MESSAGES).notUndone, {
      description: error instanceof Error ? error.message : undefined
    })
  )
}

function undoWords(status: Exclude<CommitmentStatus, 'aperta'>): string {
  const m = messagesNow(MESSAGES)
  return status === 'fatta'
    ? m.markedDone
    : status === 'non_serve'
      ? m.markedNotNeeded
      : m.postponed
}

async function setStatus(
  commitment: Commitment,
  status: CommitmentStatus,
  options?: { until?: string; reason?: string }
): Promise<void> {
  try {
    await window.segretarioApi.setCommitmentStatus(commitment.id, status, options)

    if (status !== 'aperta') {
      toast(
        commitment.kind === 'aspetti' && status === 'fatta'
          ? messagesNow(MESSAGES).markedArrived
          : undoWords(status),
        {
          description: commitment.text,
          action: {
            label: messagesNow(MESSAGES).undo,
            onClick: () => undoTick(commitment.id)
          }
        }
      )
    }
  } catch (error) {
    toast.error(messagesNow(MESSAGES).notChanged, {
      description: error instanceof Error ? error.message : undefined
    })
  }
}

async function edit(
  commitment: Commitment,
  changes: { text?: string; due?: string | null }
): Promise<void> {
  try {
    await window.segretarioApi.editCommitment(commitment.id, changes)
  } catch (error) {
    toast.error(messagesNow(MESSAGES).notChanged, {
      description: error instanceof Error ? error.message : undefined
    })
  }
}

/**
 * One thing open between the user and someone, the same wherever it shows —
 * the reader, a project, Oggi, the agenda: ticked off with an undo, put
 * off, not needed, corrected, opened again. What is awaited is ticked as
 * arrived, and can be chased. A question the Segretario asks about it is
 * answered here.
 */
export function CommitmentRow({
  commitment,
  onRemind,
  className
}: {
  commitment: Commitment
  /** Asks the Segretario for a reminder to who is awaited; absent where it cannot be asked. */
  onRemind?: (commitment: Commitment) => void
  className?: string
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const kinds = useMessages(COMMITMENT_LABELS)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(commitment.text)
  const open = commitment.status === 'aperta'
  const awaited = commitment.kind === 'aspetti'
  const settled = settledLine(commitment, m)
  const late = open && commitment.due !== null && daysFromToday(commitment.due) < 0

  const save = (): void => {
    setEditing(false)
    const next = text.trim()

    if (next && next !== commitment.text) {
      void edit(commitment, { text: next })
    } else {
      setText(commitment.text)
    }
  }

  return (
    <li
      className={cn(
        'group/commitment flex items-start gap-2 text-[12.5px] leading-[1.45]',
        className
      )}
    >
      <button
        type="button"
        onClick={() => void setStatus(commitment, open ? 'fatta' : 'aperta')}
        aria-label={
          open
            ? (awaited ? m.markArrived : m.markDone)(commitment.text)
            : m.reopenItem(commitment.text)
        }
        title={open ? (awaited ? m.arrivedTitle : m.doneTitle) : m.reopen}
        className={cn(
          'focus-visible:ring-ring/60 mt-[2px] grid size-[14px] shrink-0 place-items-center rounded-[4px] outline-none focus-visible:ring-2',
          open
            ? 'hover:bg-ai-soft shadow-[inset_0_0_0_1px_hsl(var(--ai-line))]'
            : 'bg-ai text-background hover:opacity-80'
        )}
      >
        {!open && <Check className="size-2.5" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                save()
              } else if (event.key === 'Escape') {
                setText(commitment.text)
                setEditing(false)
              }
            }}
            aria-label={m.correct}
            className="border-input bg-background focus-visible:ring-ring/60 w-full rounded-[4px] border px-1.5 py-0.5 text-[12.5px] outline-none focus-visible:ring-2"
          />
        ) : (
          <span className={cn('min-w-0', !open && 'text-faint-foreground')}>
            <span className="text-muted-foreground">{kinds[commitment.kind]}:</span>{' '}
            <span className={cn(!open && commitment.status !== 'rinviata' && 'line-through')}>
              {commitment.text}
            </span>
            {commitment.due && open && (
              <span className={cn(late ? 'text-urgent font-semibold' : 'text-muted-foreground')}>
                {' '}
                · {dueLabel(commitment.due)}
              </span>
            )}
          </span>
        )}

        {settled && <p className="text-faint-foreground text-[11.5px]">{settled}</p>}

        {open && commitment.question && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
            <span className="text-ai">{commitment.question}</span>
            <button
              type="button"
              onClick={() => void setStatus(commitment, 'aperta')}
              className="text-foreground focus-visible:ring-ring/60 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
            >
              {m.stillOpen}
            </button>
            <button
              type="button"
              onClick={() => void setStatus(commitment, 'fatta')}
              className="text-foreground focus-visible:ring-ring/60 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
            >
              {awaited ? m.hasArrived : m.isDone}
            </button>
            <button
              type="button"
              onClick={() => void setStatus(commitment, 'non_serve')}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm outline-none focus-visible:ring-2"
            >
              {m.notNeeded}
            </button>
          </div>
        )}
      </div>

      <CommitmentMenu
        commitment={commitment}
        onRemind={onRemind}
        onCorrect={() => {
          // From the words as they are now: the Segretario may have changed them since.
          setText(commitment.text)
          setEditing(true)
        }}
        className="mt-[1px] opacity-0 group-hover/commitment:opacity-100"
      />
    </li>
  )
}

/**
 * What can be done to an open thing besides ticking it, wherever it is
 * shown — the reader, a project, Oggi: chase it, say it is not needed, put
 * it off, move its deadline, correct its words; for one settled, reopen it.
 */
export function CommitmentMenu({
  commitment,
  onRemind,
  onCorrect,
  className
}: {
  commitment: Commitment
  onRemind?: (commitment: Commitment) => void
  /** Where the words can be corrected in place. */
  onCorrect?: () => void
  className?: string
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const open = commitment.status === 'aperta'
  const awaited = commitment.kind === 'aspetti'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={m.more(commitment.text)}
          className={cn(
            'text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 data-[state=open]:text-foreground shrink-0 rounded-sm outline-none focus-visible:opacity-100 focus-visible:ring-2 data-[state=open]:opacity-100',
            className
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]">
        {open ? (
          <>
            {awaited && onRemind && (
              <DropdownMenuItem onSelect={() => onRemind(commitment)}>
                {m.followUp}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void setStatus(commitment, 'non_serve')}>
              {m.notNeeded}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{m.postpone}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {dayChoices(m).map((choice) => (
                  <DropdownMenuItem
                    key={choice.day}
                    onSelect={() => void setStatus(commitment, 'rinviata', { until: choice.day })}
                  >
                    {choice.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{m.deadline}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => void edit(commitment, { due: inDays(0) })}>
                  {m.today}
                </DropdownMenuItem>
                {dayChoices(m).map((choice) => (
                  <DropdownMenuItem
                    key={choice.day}
                    onSelect={() => void edit(commitment, { due: choice.day })}
                  >
                    {choice.label}
                  </DropdownMenuItem>
                ))}
                {commitment.due && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void edit(commitment, { due: null })}>
                      {m.noDeadline}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {onCorrect && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onCorrect}>{m.correct}</DropdownMenuItem>
              </>
            )}
          </>
        ) : (
          <DropdownMenuItem onSelect={() => void setStatus(commitment, 'aperta')}>
            {m.reopen}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What was settled lately, kept below what is open: so a slip can be undone. */
export function CommitmentList({
  commitments,
  onRemind,
  className
}: {
  commitments: ReadonlyArray<Commitment>
  onRemind?: (commitment: Commitment) => void
  className?: string
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)
  const [showSettled, setShowSettled] = useState(false)
  const open = commitments.filter((commitment) => commitment.status === 'aperta')
  const settled = commitments.filter((commitment) => commitment.status !== 'aperta')

  if (commitments.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {open.length > 0 && (
        <ul className="flex flex-col gap-1">
          {open.map((commitment) => (
            <CommitmentRow key={commitment.id} commitment={commitment} onRemind={onRemind} />
          ))}
        </ul>
      )}
      {settled.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowSettled((shown) => !shown)}
            className="text-faint-foreground hover:text-muted-foreground focus-visible:ring-ring/60 self-start rounded-sm text-[11.5px] outline-none focus-visible:ring-2"
          >
            {showSettled ? m.hide : m.doneLately} ({settled.length})
          </button>
          {showSettled && (
            <ul className="flex flex-col gap-1">
              {settled.map((commitment) => (
                <CommitmentRow key={commitment.id} commitment={commitment} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
