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
import { cn } from '@renderer/lib/utils'
import type { Commitment, CommitmentStatus } from '@shared/segretario'

import { COMMITMENT_LABELS, dueLabel } from './row-work'

const SHORT_DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short'
})

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

/** The days a thing can be put off to, or given as its deadline, as a person says them. */
function dayChoices(): Array<{ label: string; day: string }> {
  return [
    { label: 'Domani', day: inDays(1) },
    { label: 'Venerdì', day: nextWeekday(5) },
    { label: 'Lunedì prossimo', day: nextWeekday(1) },
    { label: 'Tra una settimana', day: inDays(7) },
    { label: 'Tra un mese', day: inDays(30) }
  ].map((choice) => ({
    ...choice,
    label: `${choice.label} · ${SHORT_DAY.format(new Date(`${choice.day}T00:00`))}`
  }))
}

/** "da te", "dal Segretario": who settled it, when it was not the app itself. */
function byWhom(commitment: Commitment): string {
  return commitment.setBy === 'utente'
    ? ' da te'
    : commitment.setBy === 'segretario'
      ? ' dal Segretario'
      : ''
}

/** What became of a thing no longer open, in a few words. */
function settledLine(commitment: Commitment): string | null {
  switch (commitment.status) {
    case 'fatta':
      return `${commitment.kind === 'aspetti' ? 'Arrivato' : 'Fatta'}${byWhom(commitment)}${commitment.reason ? ` · ${commitment.reason}` : ''}`
    case 'non_serve':
      return `Non serve${byWhom(commitment)}${commitment.reason ? ` · ${commitment.reason}` : ''}`
    case 'rinviata':
      return commitment.until
        ? `Rinviata a ${SHORT_DAY.format(new Date(`${commitment.until}T00:00`))}`
        : 'Rinviata'
    case 'aperta':
      return null
  }
}

const UNDO_WORDS: Readonly<Record<Exclude<CommitmentStatus, 'aperta'>, string>> = {
  fatta: 'Segnata come fatta',
  non_serve: 'Segnata come non necessaria',
  rinviata: 'Rinviata'
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
          ? 'Segnato come arrivato'
          : UNDO_WORDS[status],
        {
          description: commitment.text,
          action: {
            label: 'Annulla',
            onClick: () => void window.segretarioApi.setCommitmentStatus(commitment.id, 'aperta')
          }
        }
      )
    }
  } catch (error) {
    toast.error('Non è cambiata', {
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
    toast.error('Non è cambiata', {
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
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(commitment.text)
  const open = commitment.status === 'aperta'
  const awaited = commitment.kind === 'aspetti'
  const settled = settledLine(commitment)
  const late = open && commitment.due !== null && dueLabel(commitment.due).startsWith('scaduto')

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
            ? `${awaited ? 'Segna come arrivato' : 'Segna come fatta'}: ${commitment.text}`
            : `Riapri: ${commitment.text}`
        }
        title={open ? (awaited ? 'Arrivato' : 'Fatta') : 'Riapri'}
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
            aria-label="Correggi"
            className="border-input bg-background focus-visible:ring-ring/60 w-full rounded-[4px] border px-1.5 py-0.5 text-[12.5px] outline-none focus-visible:ring-2"
          />
        ) : (
          <span className={cn('min-w-0', !open && 'text-faint-foreground')}>
            <span className="text-muted-foreground">{COMMITMENT_LABELS[commitment.kind]}:</span>{' '}
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
              È ancora aperta
            </button>
            <button
              type="button"
              onClick={() => void setStatus(commitment, 'fatta')}
              className="text-foreground focus-visible:ring-ring/60 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
            >
              {awaited ? 'È arrivato' : 'È fatta'}
            </button>
            <button
              type="button"
              onClick={() => void setStatus(commitment, 'non_serve')}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm outline-none focus-visible:ring-2"
            >
              Non serve
            </button>
          </div>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Altro: ${commitment.text}`}
            className="text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 data-[state=open]:text-foreground mt-[1px] shrink-0 rounded-sm opacity-0 outline-none group-hover/commitment:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[13rem]">
          {open ? (
            <>
              {awaited && onRemind && (
                <DropdownMenuItem onSelect={() => onRemind(commitment)}>
                  Sollecita…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => void setStatus(commitment, 'non_serve')}>
                Non serve
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Rinvia</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {dayChoices().map((choice) => (
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
                <DropdownMenuSubTrigger>Scadenza</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => void edit(commitment, { due: inDays(0) })}>
                    Oggi
                  </DropdownMenuItem>
                  {dayChoices().map((choice) => (
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
                        Senza scadenza
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEditing(true)}>Correggi</DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => void setStatus(commitment, 'aperta')}>
              Riapri
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
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
            {showSettled ? 'Nascondi' : 'Fatte di recente'} ({settled.length})
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
