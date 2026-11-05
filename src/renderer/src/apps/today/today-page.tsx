import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, LoaderCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { cn } from '@renderer/lib/utils'
import type { MessageRef } from '@shared/models'
import type { Commitment, DayLine, TodayPage as Today } from '@shared/segretario'

import { isOnDay, startOfDay } from '@renderer/features/calendar/calendar-dates'
import { EventLine } from '@renderer/features/calendar/event-line'
import { useCalendarEvents } from '@renderer/features/calendar/use-calendar'

import {
  CommitmentMenu,
  CommitmentRow,
  undoTick
} from '@renderer/features/segretario/commitment-row'
import { ProposalCard } from '@renderer/features/segretario/message-work'
import { LinkedWords } from '@renderer/features/segretario/segretario-text'
import { COMMITMENT_LABELS, dueLabel } from '@renderer/features/segretario/row-work'

const DAY_TITLE = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})

const SINCE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const WRITTEN_AT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
/** How long the page waits for a letter asked again before it stops saying so. */
const REWRITE_WAIT_MS = 3 * 60_000

/** The day's parts, in the order the page gives them: where each is, and how its count reads. */
const SECTIONS = [
  { key: 'today', id: 'oggi-da-fare', title: 'Da fare oggi', glance: 'da fare oggi' },
  { key: 'week', id: 'oggi-settimana', title: 'Questa settimana', glance: 'questa settimana' },
  { key: 'waiting', id: 'oggi-ti-aspettano', title: 'Ti aspettano', glance: 'ti aspettano' },
  { key: 'ready', id: 'oggi-pronte', title: 'Risposte pronte', glance: 'pronte' },
  { key: 'awaited', id: 'oggi-aspetti', title: 'Aspetti tu', glance: 'aspetti tu' }
] as const satisfies ReadonlyArray<{
  key: keyof Pick<Today, 'today' | 'week' | 'waiting' | 'ready' | 'awaited'>
  id: string
  title: string
  glance: string
}>

/** A line's key: its message, and the thing open in it when it is one. */
function lineKey(line: DayLine): string {
  return `${line.ref.accountId}\u0000${line.messageKey}\u0000${line.commitment?.id ?? line.readyKind ?? ''}`
}

/** Ticks a line's commitment off — done, or arrived — with an undo. */
async function settleLine(line: DayLine): Promise<boolean> {
  const commitment = line.commitment

  if (!commitment) {
    return false
  }

  try {
    await window.segretarioApi.setCommitmentStatus(commitment.id, 'fatta')
    toast(commitment.kind === 'aspetti' ? 'Segnato come arrivato' : 'Segnata come fatta', {
      description: commitment.text,
      action: {
        label: 'Annulla',
        onClick: () => undoTick(commitment.id)
      }
    })
    return true
  } catch (error) {
    toast.error('Non è cambiata', {
      description: error instanceof Error ? error.message : undefined
    })
    return false
  }
}

function Line({
  line,
  day,
  showWaitingSince,
  onOpen,
  onSettled,
  onRemind
}: {
  line: DayLine
  day: string
  showWaitingSince?: boolean
  onOpen: (ref: MessageRef) => void
  onSettled: (line: DayLine) => void
  onRemind: (commitment: Commitment) => void
}): React.JSX.Element {
  const late = line.due !== null && line.due < day
  const kind = line.commitment?.kind
  const settleLabel = kind ? (kind === 'aspetti' ? 'Arrivato' : 'Fatto') : null

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onOpen(line.ref)}
        className="hover:bg-hover focus-visible:ring-ring/60 -mx-3 flex w-[calc(100%+1.5rem)] flex-col gap-1 rounded-[8px] px-3 py-2.5 pr-24 text-left outline-none focus-visible:ring-2"
      >
        <span className="voice text-foreground text-[16px] leading-[1.4]">
          {(kind || line.readyKind === 'sollecito') && (
            <span className="text-ai mr-1.5 font-sans text-[12px] font-semibold">
              {kind ? COMMITMENT_LABELS[kind] : 'Sollecito'}
            </span>
          )}
          {line.text}
        </span>
        <span className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-[12px]">
          {line.due && (
            <span
              className={cn(
                'shrink-0 font-semibold',
                late || line.priority === 'alta' ? 'text-urgent' : 'text-foreground'
              )}
            >
              {dueLabel(line.due)}
            </span>
          )}
          {showWaitingSince && (
            <span className="shrink-0">da {SINCE.format(new Date(line.date))}</span>
          )}
          <span className="min-w-0 truncate">
            {line.from}
            {line.subject && ` · «${line.subject}»`}
          </span>
        </span>
      </button>
      {settleLabel && line.commitment && (
        <span className="absolute top-2.5 -right-1 flex items-center gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
          <CommitmentMenu
            commitment={line.commitment}
            onRemind={onRemind}
            className="grid size-7 place-items-center"
          />
          <button
            type="button"
            onClick={() => void settleLine(line).then((settled) => settled && onSettled(line))}
            className="button-raised focus-visible:ring-ring/60 flex h-7 items-center gap-1 rounded-[7px] px-2 text-[11.5px] font-semibold outline-none focus-visible:ring-2"
          >
            <Check className="size-3.5" />
            {settleLabel}
          </button>
        </span>
      )}
    </li>
  )
}

function Section({
  id,
  title,
  lines,
  day,
  showWaitingSince,
  onOpen,
  settled,
  onSettled,
  onRemind
}: {
  id: string
  title: string
  lines: ReadonlyArray<DayLine>
  day: string
  showWaitingSince?: boolean
  onOpen: (ref: MessageRef) => void
  /** Lines just dealt with here, gone before the day is read again. */
  settled: ReadonlySet<string>
  onSettled: (line: DayLine) => void
  onRemind: (commitment: Commitment) => void
}): React.JSX.Element | null {
  const shown = lines.filter((line) => !settled.has(lineKey(line)))

  if (shown.length === 0) {
    return null
  }

  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-1.5">
      <h2 className="eyebrow">
        {title} · {shown.length}
      </h2>
      <ul className="flex flex-col">
        {shown.map((line) => (
          <Line
            key={lineKey(line)}
            line={line}
            day={day}
            showWaitingSince={showWaitingSince}
            onOpen={onOpen}
            onSettled={onSettled}
            onRemind={onRemind}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * "Oggi": the day as the Segretario sees it, written in its hand. At the
 * top its letter, then today's meetings with how to prepare them, what is
 * due today and this week, who waits on the user, what the user waits on,
 * the replies prepared, what it asks and what it proposes — each line
 * opens its message.
 */
export function TodayPage({
  canWrite,
  atWindowTopRight,
  onOpenMessage,
  onRemind
}: {
  /** The Segretario can work: the letter can be written again. */
  canWrite: boolean
  atWindowTopRight: boolean
  onOpenMessage: (ref: MessageRef) => void
  /** Asks the Segretario for a reminder to who is awaited. */
  onRemind: (commitment: Commitment) => void
}): React.JSX.Element {
  const [page, setPage] = useState<Today | null>(null)
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set())
  const settle = useCallback(
    (line: DayLine): void => setSettled((current) => new Set(current).add(lineKey(line))),
    []
  )
  const [now] = useState(() => Date.now())
  const today = startOfDay(new Date(now))
  const agenda = useCalendarEvents(
    today.toISOString(),
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()
  )
  const [rewritingSince, setRewritingSince] = useState<number | null>(null)
  const reloadTimer = useRef<number | null>(null)

  const rewrite = useCallback(async (): Promise<void> => {
    setRewritingSince(Date.now())

    try {
      await window.segretarioApi.refreshToday()
    } catch (error) {
      setRewritingSince(null)
      toast.error('La giornata non si aggiorna', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }, [])

  useEffect(() => {
    let current = true
    const show = (loaded: Today): void => {
      if (!current) {
        return
      }

      setPage(loaded)
      // What was dealt with here is now as the registry says.
      setSettled(new Set())
      setRewritingSince((since) =>
        since !== null && (loaded.letterAt ?? 0) >= since ? null : since
      )
    }
    const load = (): void => void window.segretarioApi.getToday().then(show)

    load()

    // The work changes the day: the lists follow, and a letter written again shows.
    const unsubscribe = window.segretarioApi.onWorkChanged(() => {
      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }

      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null
        load()
      }, 1200)
    })

    return () => {
      current = false
      unsubscribe()

      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    if (rewritingSince === null) {
      return
    }

    const timer = window.setTimeout(() => setRewritingSince(null), REWRITE_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [rewritingSince])

  // Asked here, or begun by the Segretario itself — the letter behind when the page was opened.
  const rewriting = rewritingSince !== null || (page?.letterRewriting ?? false)
  const empty =
    page !== null &&
    SECTIONS.every(({ key }) => page[key].length === 0) &&
    page.questions.length === 0 &&
    page.proposals.length === 0
  // At a glance, what each part holds still: a click goes to it.
  const glance = page
    ? SECTIONS.flatMap((section) => {
        const count = page[section.key].filter((line) => !settled.has(lineKey(line))).length
        return count > 0 ? [{ ...section, count }] : []
      })
    : []
  const meetings = agenda?.filter((event) => isOnDay(event, today)) ?? []

  return (
    <div className="paper flex h-full min-h-0 flex-col">
      <header
        className={cn(
          'window-drag-region flex h-[52px] shrink-0 items-center gap-2 border-b pl-6',
          atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-3'
        )}
      >
        <h1 className="display-title text-[15px]">Oggi</h1>
        <div className="flex-1" />
        {canWrite && (
          <IconButton
            label="Guarda di nuovo la giornata"
            className="window-no-drag text-faint-foreground size-[28px]"
            disabled={rewriting}
            onClick={() => void rewrite()}
          >
            {rewriting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </IconButton>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <article className="letter mx-auto flex max-w-[720px] flex-col gap-8 rounded-[14px] px-7 pt-7 pb-14 sm:px-12">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b pb-3">
              <CompassStar className="text-ai-star size-[15px]" />
              <span className="eyebrow">Il punto del Segretario</span>
              <span className="flex-1" />
              {page?.letterAt && !rewriting && (
                <span className="text-faint-foreground text-[11.5px]">
                  scritto alle {WRITTEN_AT.format(page.letterAt)}
                </span>
              )}
            </div>
            <p className="display-title pt-2 text-[30px] leading-tight first-letter:uppercase">
              {DAY_TITLE.format(new Date())}
            </p>
            {glance.length > 0 && (
              <nav
                aria-label="La giornata in breve"
                className="text-muted-foreground flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[12.5px]"
              >
                {glance.map((part, index) => (
                  <span key={part.key} className="flex items-baseline gap-1.5">
                    {index > 0 && <span className="text-faint-foreground">·</span>}
                    <button
                      type="button"
                      onClick={() =>
                        document
                          .getElementById(part.id)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }
                      className="focus-visible:ring-ring/60 hover:text-foreground rounded-sm outline-none focus-visible:ring-2"
                    >
                      <span
                        className={cn(
                          'font-semibold tabular-nums',
                          part.key === 'today' ? 'text-urgent' : 'text-foreground'
                        )}
                      >
                        {part.count}
                      </span>{' '}
                      {part.glance}
                    </button>
                  </span>
                ))}
              </nav>
            )}
            {page?.letter && (
              <LinkedWords
                text={page.letter}
                links={page.letterLinks}
                className={cn(
                  'drop-cap text-foreground text-[18px] leading-[1.55]',
                  rewriting && 'opacity-60'
                )}
              />
            )}
            {page?.paused ? (
              <p className="text-destructive-soft-foreground flex items-start gap-2 text-[13px]">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Sono fermo: {page.paused}
                  {page.reading > 0 &&
                    ` Restano da leggere ${page.reading === 1 ? 'un messaggio' : `${page.reading.toLocaleString('it-IT')} messaggi`}.`}
                </span>
              </p>
            ) : rewriting ? (
              <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <LoaderCircle className="text-ai size-4 animate-spin" />
                Sto guardando la tua giornata…
              </p>
            ) : page && page.reading > 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <LoaderCircle className="text-ai size-4 animate-spin" />
                Sto ancora leggendo la tua posta:{' '}
                {page.reading === 1
                  ? 'un messaggio'
                  : `${page.reading.toLocaleString('it-IT')} messaggi`}
                {page.letter ? '.' : ", poi ti dico com'è la giornata."}
              </p>
            ) : (
              page &&
              !page.letter &&
              canWrite && (
                <p className="text-muted-foreground text-[12.5px]">
                  La lettera di oggi non c’è ancora.{' '}
                  <button
                    type="button"
                    onClick={() => void rewrite()}
                    className="text-ai focus-visible:ring-ring/60 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
                  >
                    Scrivila ora
                  </button>
                </p>
              )
            )}
          </div>

          {meetings.length > 0 && (
            <section className="flex flex-col gap-1">
              <h2 className="eyebrow">In agenda</h2>
              <ul className="flex flex-col">
                {meetings.map((event) => (
                  <EventLine
                    key={event.key}
                    event={event}
                    day={today}
                    now={now}
                    prep={page?.preps[event.key]}
                  />
                ))}
              </ul>
            </section>
          )}

          {page && (
            <>
              {page.questions.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="eyebrow">Ti chiedo · {page.questions.length}</h2>
                  <ul className="flex flex-col gap-2">
                    {page.questions.flatMap((line) =>
                      line.commitment
                        ? [<CommitmentRow key={lineKey(line)} commitment={line.commitment} />]
                        : []
                    )}
                  </ul>
                </section>
              )}
              {SECTIONS.map((section) => (
                <Section
                  key={section.key}
                  id={section.id}
                  title={section.title}
                  lines={page[section.key]}
                  day={page.day}
                  showWaitingSince={section.key === 'awaited'}
                  onOpen={onOpenMessage}
                  settled={settled}
                  onSettled={settle}
                  onRemind={onRemind}
                />
              ))}
              {page.proposals.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="eyebrow">Proposte · {page.proposals.length}</h2>
                  {page.proposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      onOpenSource={onOpenMessage}
                      onAct={(acted) =>
                        acted.accountId &&
                        acted.messageKey &&
                        void window.segretarioApi
                          .replySource(acted.accountId, acted.messageKey)
                          .then((ref) => ref && onOpenMessage(ref))
                      }
                    />
                  ))}
                </section>
              )}
              {empty && (
                <p className="voice text-muted-foreground text-[16px]">
                  Niente in sospeso: la posta è in ordine.
                </p>
              )}
            </>
          )}
        </article>
      </div>
    </div>
  )
}
