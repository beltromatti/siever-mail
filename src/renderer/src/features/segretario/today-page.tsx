import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, RefreshCw } from 'lucide-react'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { cn } from '@renderer/lib/utils'
import type { MessageRef } from '@shared/models'
import type { Briefing, BriefingItem } from '@shared/segretario'

import { isOn, startOfDay } from '@renderer/features/calendar/calendar-days'
import { EventLine } from '@renderer/features/calendar/event-line'
import { useCalendarEvents } from '@renderer/features/calendar/use-calendar'

import { COMMITMENT_LABELS, dueLabel } from './message-notes'

const DAY_TITLE = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})

const SINCE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const WRITTEN_AT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

/** The day's parts, in the order the page gives them: where each is, and how its count reads. */
const SECTIONS = [
  { key: 'today', id: 'oggi-da-fare', title: 'Da fare oggi', glance: 'da fare oggi' },
  { key: 'week', id: 'oggi-settimana', title: 'Questa settimana', glance: 'questa settimana' },
  { key: 'waiting', id: 'oggi-ti-aspettano', title: 'Ti aspettano', glance: 'ti aspettano' },
  { key: 'ready', id: 'oggi-pronte', title: 'Risposte pronte', glance: 'pronte' },
  { key: 'awaited', id: 'oggi-aspetti', title: 'Aspetti tu', glance: 'aspetti tu' }
] as const satisfies ReadonlyArray<{
  key: keyof Pick<Briefing, 'today' | 'week' | 'waiting' | 'ready' | 'awaited'>
  id: string
  title: string
  glance: string
}>

/** A line's key: its message, and the thing open in it when it is one. */
function lineKey(item: BriefingItem): string {
  return `${item.ref.accountId}\u0000${item.messageKey}\u0000${item.commitmentId ?? ''}\u0000${item.text}`
}

/**
 * What can be done with a line without opening it: a thing open is ticked
 * off, a message that asked something is marked handled. A reply prepared
 * is used from its message.
 */
async function settleLine(item: BriefingItem): Promise<boolean> {
  if (item.commitmentId !== undefined) {
    await window.segretarioApi.closeCommitment(item.commitmentId)
    return true
  }

  if (!item.readyKind) {
    await window.segretarioApi.dismissNote(item.ref.accountId, item.messageKey)
    return true
  }

  return false
}

function Line({
  item,
  day,
  showWaitingSince,
  onOpen,
  onSettled
}: {
  item: BriefingItem
  day: string
  showWaitingSince?: boolean
  onOpen: (ref: MessageRef) => void
  onSettled: (item: BriefingItem) => void
}): React.JSX.Element {
  const late = item.due !== null && item.due < day
  const settleLabel = item.commitmentId !== undefined ? 'Fatto' : item.readyKind ? null : 'Gestito'

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onOpen(item.ref)}
        className="hover:bg-hover focus-visible:ring-ring/60 -mx-3 flex w-[calc(100%+1.5rem)] flex-col gap-1 rounded-[8px] px-3 py-2.5 pr-24 text-left outline-none focus-visible:ring-2"
      >
        <span className="voice text-foreground text-[16px] leading-[1.4]">
          {(item.commitmentKind || item.readyKind === 'sollecito') && (
            <span className="text-ai mr-1.5 font-sans text-[12px] font-semibold">
              {item.commitmentKind ? COMMITMENT_LABELS[item.commitmentKind] : 'Sollecito'}
            </span>
          )}
          {item.text}
        </span>
        <span className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-[12px]">
          {item.due && (
            <span
              className={cn(
                'shrink-0 font-semibold',
                late || item.priority === 'alta' ? 'text-urgent' : 'text-foreground'
              )}
            >
              {dueLabel(item.due)}
            </span>
          )}
          {showWaitingSince && (
            <span className="shrink-0">da {SINCE.format(new Date(item.date))}</span>
          )}
          <span className="min-w-0 truncate">
            {item.from}
            {item.subject && ` · «${item.subject}»`}
          </span>
        </span>
      </button>
      {settleLabel && (
        <button
          type="button"
          onClick={() => void settleLine(item).then((settled) => settled && onSettled(item))}
          className="button-raised focus-visible:ring-ring/60 absolute top-2.5 -right-1 flex h-7 items-center gap-1 rounded-[7px] px-2 text-[11.5px] font-semibold opacity-0 transition-opacity outline-none group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:ring-2"
        >
          <Check className="size-3.5" />
          {settleLabel}
        </button>
      )}
    </li>
  )
}

function Section({
  id,
  title,
  items,
  day,
  showWaitingSince,
  onOpen,
  settled,
  onSettled
}: {
  id: string
  title: string
  items: ReadonlyArray<BriefingItem>
  day: string
  showWaitingSince?: boolean
  onOpen: (ref: MessageRef) => void
  /** Lines just dealt with here, gone before the day is read again. */
  settled: ReadonlySet<string>
  onSettled: (item: BriefingItem) => void
}): React.JSX.Element | null {
  const shown = items.filter((item) => !settled.has(lineKey(item)))

  if (shown.length === 0) {
    return null
  }

  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-1.5">
      <h2 className="eyebrow">
        {title} · {shown.length}
      </h2>
      <ul className="flex flex-col">
        {shown.map((item) => (
          <Line
            key={lineKey(item)}
            item={item}
            day={day}
            showWaitingSince={showWaitingSince}
            onOpen={onOpen}
            onSettled={onSettled}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * "Oggi": the day as the Segretario sees it, written in its hand. At the
 * top what it thinks matters most, then what is due today, this week, who
 * waits on the user, what the user waits on, the replies prepared — each
 * line opens its message.
 */
export function TodayPage({
  canWrite,
  atWindowTopRight,
  onOpenMessage
}: {
  /** The key answers: the opening can be written. */
  canWrite: boolean
  atWindowTopRight: boolean
  onOpenMessage: (ref: MessageRef) => void
}): React.JSX.Element {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set())
  const settle = useCallback(
    (item: BriefingItem): void => setSettled((current) => new Set(current).add(lineKey(item))),
    []
  )
  const [now] = useState(() => Date.now())
  const today = startOfDay(new Date(now))
  const agenda = useCalendarEvents(
    today.toISOString(),
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()
  )
  const [writing, setWriting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const reloadTimer = useRef<number | null>(null)
  // Written by itself at most once a visit: after that, only when asked.
  const wroteOnItsOwn = useRef(false)

  const write = useCallback(async (): Promise<void> => {
    setWriting(true)
    setProblem(null)

    try {
      setBriefing(await window.segretarioApi.writeBriefingOpening())
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Non sono riuscito a scrivere il punto.')
    } finally {
      setWriting(false)
    }
  }, [])

  useEffect(() => {
    let current = true

    // The day is written once the mail is read: on opening, when there is
    // none yet or the day moved since; while the page is open, the first
    // time the reading is done.
    const show = (loaded: Briefing, opening: boolean): void => {
      if (!current) {
        return
      }

      setBriefing(loaded)

      if (
        canWrite &&
        !wroteOnItsOwn.current &&
        loaded.reading === 0 &&
        (loaded.opening === null || (opening && loaded.openingBehind > 0))
      ) {
        wroteOnItsOwn.current = true
        void write()
      }
    }

    void window.segretarioApi.getBriefing().then((loaded) => show(loaded, true))

    // New notes change the day: the lists follow, the opening says it is behind.
    const unsubscribe = window.segretarioApi.onNotesChanged(() => {
      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }

      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null
        void window.segretarioApi.getBriefing().then((loaded) => show(loaded, false))
      }, 1500)
    })

    return () => {
      current = false
      unsubscribe()

      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }
    }
  }, [canWrite, write])

  const empty = briefing !== null && SECTIONS.every(({ key }) => briefing[key].length === 0)
  // At a glance, what each part holds still: a click goes to it.
  const glance = briefing
    ? SECTIONS.flatMap((section) => {
        const count = briefing[section.key].filter((item) => !settled.has(lineKey(item))).length
        return count > 0 ? [{ ...section, count }] : []
      })
    : []

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
            label="Riscrivi il punto della giornata"
            className="window-no-drag text-faint-foreground size-[28px]"
            disabled={writing}
            onClick={() => void write()}
          >
            {writing ? (
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
              {briefing?.openingAt && !writing && (
                <span className="text-faint-foreground text-[11.5px]">
                  scritto alle {WRITTEN_AT.format(briefing.openingAt)}
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
            {briefing?.opening && (
              <p
                className={cn(
                  'voice drop-cap text-foreground text-[18px] leading-[1.55] whitespace-pre-line',
                  writing && 'opacity-60'
                )}
              >
                {briefing.opening}
              </p>
            )}
            {writing ? (
              <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <LoaderCircle className="text-ai size-4 animate-spin" />
                Sto guardando la tua giornata…
              </p>
            ) : briefing && briefing.reading > 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <LoaderCircle className="text-ai size-4 animate-spin" />
                Sto ancora leggendo la tua posta:{' '}
                {briefing.reading === 1
                  ? 'un messaggio'
                  : `${briefing.reading.toLocaleString('it-IT')} messaggi`}
                {", poi ti dico com'è la giornata."}
              </p>
            ) : (
              briefing?.opening &&
              briefing.openingBehind > 0 &&
              canWrite && (
                <p className="text-muted-foreground text-[12.5px]">
                  {briefing.openingBehind === 1
                    ? "Da quando l'ho scritto è arrivata una cosa nuova."
                    : `Da quando l'ho scritto sono arrivate ${briefing.openingBehind} cose nuove.`}{' '}
                  <button
                    type="button"
                    onClick={() => void write()}
                    className="text-ai focus-visible:ring-ring/60 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
                  >
                    Aggiorna
                  </button>
                </p>
              )
            )}
            {problem && <p className="text-destructive-soft-foreground text-[12.5px]">{problem}</p>}
          </div>

          {agenda && agenda.some((event) => isOn(event, today)) && (
            <section className="flex flex-col gap-1">
              <h2 className="eyebrow">In agenda</h2>
              <ul className="flex flex-col">
                {agenda
                  .filter((event) => isOn(event, today))
                  .map((event) => (
                    <EventLine key={event.key} event={event} day={today} now={now} />
                  ))}
              </ul>
            </section>
          )}

          {briefing && (
            <>
              {SECTIONS.map((section) => (
                <Section
                  key={section.key}
                  id={section.id}
                  title={section.title}
                  items={briefing[section.key]}
                  day={briefing.day}
                  showWaitingSince={section.key === 'awaited'}
                  onOpen={onOpenMessage}
                  settled={settled}
                  onSettled={settle}
                />
              ))}
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
