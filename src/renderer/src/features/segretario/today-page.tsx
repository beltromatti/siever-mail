import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'

import { IconButton } from '@renderer/components/ui/icon-button'
import { cn } from '@renderer/lib/utils'
import type { MessageRef } from '@shared/models'
import type { Briefing, BriefingItem, CommitmentKind } from '@shared/segretario'

import { dueLabel } from './message-notes'

const DAY_TITLE = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})

const COMMITMENT_LABELS: Readonly<Record<CommitmentKind, string>> = {
  ti_chiedono: 'Ti chiedono',
  hai_promesso: 'Hai promesso',
  aspetti: 'Aspetti',
  da_fare: 'Da fare'
}

const SINCE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })

function Line({
  item,
  day,
  showWaitingSince,
  onOpen
}: {
  item: BriefingItem
  day: string
  showWaitingSince?: boolean
  onOpen: (ref: MessageRef) => void
}): React.JSX.Element {
  const late = item.due !== null && item.due < day

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.ref)}
        className="hover:bg-hover focus-visible:ring-ring/60 -mx-3 flex w-[calc(100%+1.5rem)] flex-col gap-1 rounded-[8px] px-3 py-2.5 text-left outline-none focus-visible:ring-2"
      >
        <span className="voice text-foreground text-[16px] leading-[1.4]">
          {item.commitmentKind && (
            <span className="text-ai mr-1.5 font-sans text-[12px] font-semibold">
              {COMMITMENT_LABELS[item.commitmentKind]}
            </span>
          )}
          {item.text}
        </span>
        <span className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-[12px]">
          {item.due && (
            <span
              className={cn(
                'shrink-0 font-semibold',
                late || item.priority === 'alta' ? 'text-seal-text' : 'text-foreground'
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
    </li>
  )
}

function Section({
  title,
  items,
  day,
  showWaitingSince,
  onOpen
}: {
  title: string
  items: ReadonlyArray<BriefingItem>
  day: string
  showWaitingSince?: boolean
  onOpen: (ref: MessageRef) => void
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null
  }

  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="eyebrow">
        {title} · {items.length}
      </h2>
      <ul className="flex flex-col">
        {items.map((item) => (
          <Line
            key={`${item.ref.accountId}:${item.ref.folderPath}:${item.ref.uid}:${item.text}`}
            item={item}
            day={day}
            showWaitingSince={showWaitingSince}
            onOpen={onOpen}
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

  const empty =
    briefing !== null &&
    [briefing.today, briefing.week, briefing.waiting, briefing.awaited, briefing.ready].every(
      (items) => items.length === 0
    )

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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex max-w-[680px] flex-col gap-8 px-8 pt-10 pb-16">
          <div className="flex flex-col gap-4">
            <p className="display-title text-[28px] leading-tight first-letter:uppercase">
              {DAY_TITLE.format(new Date())}
            </p>
            {briefing?.opening && (
              <p
                className={cn(
                  'voice text-foreground text-[18px] leading-[1.55] whitespace-pre-line',
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

          {briefing && (
            <>
              <Section
                title="Da fare oggi"
                items={briefing.today}
                day={briefing.day}
                onOpen={onOpenMessage}
              />
              <Section
                title="Questa settimana"
                items={briefing.week}
                day={briefing.day}
                onOpen={onOpenMessage}
              />
              <Section
                title="Ti aspettano"
                items={briefing.waiting}
                day={briefing.day}
                onOpen={onOpenMessage}
              />
              <Section
                title="Risposte pronte"
                items={briefing.ready}
                day={briefing.day}
                onOpen={onOpenMessage}
              />
              <Section
                title="Aspetti tu"
                items={briefing.awaited}
                day={briefing.day}
                showWaitingSince
                onOpen={onOpenMessage}
              />
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
