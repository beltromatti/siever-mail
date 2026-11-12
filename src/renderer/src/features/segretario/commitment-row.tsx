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
import type { ContextMenuItem } from '@shared/context-menu'
import { defineMessages, type Messages } from '@shared/i18n'
import type { Commitment, CommitmentStatus, WorkActor, WorkTarget } from '@shared/segretario'

import { COMMITMENT_LABELS, daysFromToday, dueLabel } from './row-work'
import {
  dimmedBy,
  PendingWordsLine,
  RewriteField,
  useWorkWords,
  withdrawWords,
  WORK_WORDS,
  type WorkWords
} from './work-words'

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
  openMessage: { en: 'Open the email', it: 'Apri la mail', de: 'E-Mail öffnen' },
  openEvent: { en: 'Open the event', it: 'Apri l’evento', de: 'Termin öffnen' },
  openProject: { en: 'Open the project', it: 'Apri il progetto', de: 'Projekt öffnen' },
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

/** An open thing, as the user's words on it name it (vision §10.1). */
function targetOf(commitment: Commitment): WorkTarget {
  return { kind: 'impegno', id: commitment.id }
}

/** What can be done to an open thing, as a menu has it: an item, a group of them, a line between. */
type CommitmentAction =
  | { id: string; label: string; run: () => void | Promise<void> }
  | { id: string; label: string; submenu: CommitmentAction[] }
  | 'separator'

interface CommitmentActionOptions {
  /** The boxes for the user's words: «Correggi…», «Rispondi…», «Riscrivi» where not in place. */
  words: WorkWords
  /** Asks the Segretario for a reminder to who is awaited; absent where it cannot be asked. */
  onRemind?: (commitment: Commitment) => void
  /** Opens where it comes from — its message, its event, its project —, where the thing shows apart. */
  onOpenSource?: (commitment: Commitment) => void
  /** Rewrites its words in place; without, in a box. */
  onRewrite?: () => void
}

/** Where a thing comes from, as its menu offers to open it; null for the user's word alone. */
function sourceLabel(commitment: Commitment, m: Messages<typeof MESSAGES>): string | null {
  const { source } = commitment
  return source.kind === 'message'
    ? m.openMessage
    : source.kind === 'event'
      ? m.openEvent
      : source.projectId
        ? m.openProject
        : null
}

/**
 * Everything that can be done to an open thing besides ticking it, in one
 * list for every menu that offers it — its «⋯», a native one in the
 * Calendario: open where it comes from, chase it, say it is not needed, put
 * it off, move its deadline; and the user's word on it — rewrite it,
 * correct it, answer its question, or take back what they said (§10.1).
 * For one settled: reopen it, or correct it.
 */
function commitmentActions(
  commitment: Commitment,
  m: Messages<typeof MESSAGES>,
  w: Messages<typeof WORK_WORDS>,
  options: CommitmentActionOptions
): CommitmentAction[] {
  const { words, onRemind, onOpenSource, onRewrite } = options
  const target = targetOf(commitment)
  const pending = commitment.pending ?? null
  const open = commitment.status === 'aperta'
  const source = onOpenSource ? sourceLabel(commitment, m) : null
  const actions: CommitmentAction[] = []

  if (source && onOpenSource) {
    actions.push({ id: 'source', label: source, run: () => onOpenSource(commitment) }, 'separator')
  }

  if (open) {
    if (commitment.kind === 'aspetti' && onRemind) {
      actions.push({ id: 'remind', label: m.followUp, run: () => onRemind(commitment) })
    }

    actions.push(
      {
        id: 'not-needed',
        label: m.notNeeded,
        run: () => setStatus(commitment, 'non_serve')
      },
      {
        id: 'postpone',
        label: m.postpone,
        submenu: dayChoices(m).map((choice) => ({
          id: `postpone:${choice.day}`,
          label: choice.label,
          run: () => setStatus(commitment, 'rinviata', { until: choice.day })
        }))
      },
      {
        id: 'deadline',
        label: m.deadline,
        submenu: [
          { id: 'due:today', label: m.today, run: () => edit(commitment, { due: inDays(0) }) },
          ...dayChoices(m).map((choice) => ({
            id: `due:${choice.day}`,
            label: choice.label,
            run: () => edit(commitment, { due: choice.day })
          })),
          ...(commitment.due
            ? ([
                'separator',
                { id: 'due:none', label: m.noDeadline, run: () => edit(commitment, { due: null }) }
              ] as const)
            : [])
        ]
      },
      'separator',
      {
        id: 'rewrite',
        label: w.rewrite,
        run: () => (onRewrite ? onRewrite() : words.rewrite(target, commitment.text))
      }
    )
  } else {
    actions.push(
      { id: 'reopen', label: m.reopen, run: () => setStatus(commitment, 'aperta') },
      'separator'
    )
  }

  if (pending) {
    actions.push({
      id: 'withdraw',
      label: pending.kind === 'correzione' ? w.withdrawCorrection : w.withdrawAnswer,
      run: () => withdrawWords(target)
    })
  } else {
    actions.push({
      id: 'correct',
      label: w.correct,
      run: () => words.correct(target, commitment.text)
    })

    if (open && commitment.question) {
      actions.push({ id: 'answer', label: w.answer, run: () => words.answer(commitment) })
    }
  }

  return tidy(actions)
}

/** A list without a line at either end, or two in a row: where what was between them is not offered. */
function tidy(actions: CommitmentAction[]): CommitmentAction[] {
  return actions
    .map((action) =>
      action !== 'separator' && 'submenu' in action
        ? { ...action, submenu: tidy(action.submenu) }
        : action
    )
    .filter(
      (action, index, all) =>
        action !== 'separator' ||
        (index > 0 && index < all.length - 1 && all[index - 1] !== 'separator')
    )
}

/**
 * An open thing's actions as a native menu — in the Calendario, on a
 * deadline —: the same words and the same actions as its «⋯» (one list,
 * two forms). `run` does what the item chosen says.
 */
export function commitmentContextMenu(
  commitment: Commitment,
  options: CommitmentActionOptions
): { items: ContextMenuItem[]; run: (id: string) => Promise<void> } {
  const actions = commitmentActions(
    commitment,
    messagesNow(MESSAGES),
    messagesNow(WORK_WORDS),
    options
  )
  const itemOf = (action: CommitmentAction): ContextMenuItem =>
    action === 'separator'
      ? { type: 'separator' }
      : 'submenu' in action
        ? { id: action.id, label: action.label, submenu: action.submenu.map(itemOf) }
        : { id: action.id, label: action.label }
  const find = (
    list: ReadonlyArray<CommitmentAction>,
    id: string
  ): Extract<CommitmentAction, { run: unknown }> | null => {
    for (const action of list) {
      if (action === 'separator') {
        continue
      }

      const found =
        'submenu' in action ? find(action.submenu, id) : action.id === id ? action : null

      if (found) {
        return found
      }
    }

    return null
  }

  return {
    items: actions.map(itemOf),
    run: async (id) => {
      await find(actions, id)?.run()
    }
  }
}

/** The same list, as the items of a dropdown. */
function ActionItems({ actions }: { actions: ReadonlyArray<CommitmentAction> }): React.JSX.Element {
  return (
    <>
      {actions.map((action, index) =>
        action === 'separator' ? (
          <DropdownMenuSeparator key={`separator-${index}`} />
        ) : 'submenu' in action ? (
          <DropdownMenuSub key={action.id}>
            <DropdownMenuSubTrigger>{action.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <ActionItems actions={action.submenu} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem key={action.id} onSelect={() => void action.run()}>
            {action.label}
          </DropdownMenuItem>
        )
      )}
    </>
  )
}

/**
 * One thing open between the user and someone, the same wherever it shows —
 * the reader, a project, Oggi, the agenda: ticked off with an undo, put
 * off, not needed, rewritten in place, opened again. What is awaited is
 * ticked as arrived, and can be chased. A question the Segretario asks about
 * it is answered here, with a click or in words; corrected in words, it
 * stays dimmed until the Segretario has put it right (§10.1).
 */
export function CommitmentRow({
  commitment,
  onRemind,
  words: shared,
  className
}: {
  commitment: Commitment
  /** Asks the Segretario for a reminder to who is awaited; absent where it cannot be asked. */
  onRemind?: (commitment: Commitment) => void
  /** The boxes for the user's words, when the list around has them; otherwise the row's own. */
  words?: WorkWords
  className?: string
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const w = useMessages(WORK_WORDS)
  const kinds = useMessages(COMMITMENT_LABELS)
  const own = useWorkWords()
  const words = shared ?? own
  const [rewriting, setRewriting] = useState(false)
  const open = commitment.status === 'aperta'
  const awaited = commitment.kind === 'aspetti'
  const settled = settledLine(commitment, m)
  const late = open && commitment.due !== null && daysFromToday(commitment.due) < 0
  const pending = commitment.pending ?? null
  // Words wait on it — an answer, or what is wrong with it: its question is the Segretario's to settle.
  const spoken = pending !== null

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
        {rewriting ? (
          <RewriteField
            target={targetOf(commitment)}
            text={commitment.text}
            label={w.rewrite}
            onDone={() => setRewriting(false)}
            className="px-1.5 py-0.5 text-[12.5px]"
          />
        ) : (
          <span className={cn('min-w-0', !open && 'text-faint-foreground', dimmedBy(pending))}>
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

        {open && commitment.question && !spoken && (
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
            <button
              type="button"
              onClick={() => words.answer(commitment)}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm outline-none focus-visible:ring-2"
            >
              {w.answer}
            </button>
          </div>
        )}

        <PendingWordsLine pending={pending} className="mt-0.5" />
      </div>

      <CommitmentMenu
        commitment={commitment}
        onRemind={onRemind}
        words={words}
        onRewrite={() => setRewriting(true)}
        className="mt-[1px] opacity-0 group-hover/commitment:opacity-100"
      />
      {!shared && own.dialogs}
    </li>
  )
}

/**
 * What can be done to an open thing besides ticking it, wherever it is
 * shown — the reader, a project, Oggi: chase it, say it is not needed, put
 * it off, move its deadline, rewrite or correct its words, answer its
 * question; for one settled, reopen it (`commitmentActions`).
 */
export function CommitmentMenu({
  commitment,
  className,
  ...options
}: CommitmentActionOptions & {
  commitment: Commitment
  className?: string
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const w = useMessages(WORK_WORDS)

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
        <ActionItems actions={commitmentActions(commitment, m, w, options)} />
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
  const words = useWorkWords()
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
            <CommitmentRow
              key={commitment.id}
              commitment={commitment}
              onRemind={onRemind}
              words={words}
            />
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
                <CommitmentRow key={commitment.id} commitment={commitment} words={words} />
              ))}
            </ul>
          )}
        </>
      )}
      {words.dialogs}
    </div>
  )
}
