import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Input } from '@renderer/components/ui/input'
import { hourStyle, messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { calendarKey } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import type { MessageRef } from '@shared/models'
import { PLACES } from '@shared/places'
import type { Commitment, DayLine, TodayPage as Today } from '@shared/segretario'

import { dateFormat, isOnDay, startOfDay } from '@renderer/features/calendar/calendar-dates'
import { EventLine } from '@renderer/features/calendar/event-line'
import { useCalendarEvents, useCalendarList } from '@renderer/features/calendar/use-calendar'

import {
  CommitmentMenu,
  CommitmentRow,
  undoTick
} from '@renderer/features/segretario/commitment-row'
import { ProposalCard } from '@renderer/features/segretario/message-work'
import {
  dayLineKey,
  dayLineLink,
  dayLineSince,
  dayLineSourceWords
} from '@renderer/features/segretario/day-line-source'
import { LinkedWords, useOpenLink } from '@renderer/features/segretario/segretario-text'
import { COMMITMENT_LABELS, dueLabel } from '@renderer/features/segretario/row-work'
import {
  dimmedBy,
  PendingWordsLine,
  RewriteField,
  useWorkWords,
  WORK_WORDS,
  WorkMenu,
  type WorkWords
} from '@renderer/features/segretario/work-words'

const MESSAGES = defineMessages({
  arrived: {
    en: 'Marked as arrived',
    it: 'Segnato come arrivato',
    de: 'Als eingetroffen markiert'
  },
  done: { en: 'Marked as done', it: 'Segnata come fatta', de: 'Als erledigt markiert' },
  undo: { en: 'Undo', it: 'Annulla', de: 'Rückgängig' },
  notChanged: { en: 'It did not change', it: 'Non è cambiata', de: 'Es wurde nicht geändert' },
  settleArrived: { en: 'Arrived', it: 'Arrivato', de: 'Eingetroffen' },
  settleDone: { en: 'Done', it: 'Fatto', de: 'Erledigt' },
  followUp: { en: 'Follow-up', it: 'Sollecito', de: 'Nachfassen' },
  since: {
    en: (day: string) => `since ${day}`,
    it: (day: string) => `da ${day}`,
    de: (day: string) => `seit ${day}`
  },
  notAdded: {
    en: 'It was not added',
    it: 'Non è stata aggiunta',
    de: 'Es wurde nicht hinzugefügt'
  },
  remember: { en: 'Something to remember', it: 'Una cosa da ricordare', de: 'Etwas zum Merken' },
  rememberPlaceholder: {
    en: 'Something to remember: write it and press Enter',
    it: 'Una cosa da ricordare: scrivila e premi Invio',
    de: 'Etwas zum Merken: Schreiben Sie es und drücken Sie Eingabe'
  },
  notRefreshed: {
    en: 'The day could not be refreshed',
    it: 'La giornata non si aggiorna',
    de: 'Der Tag lässt sich nicht aktualisieren'
  },
  lookAgain: {
    en: 'Look at the day again',
    it: 'Guarda di nuovo la giornata',
    de: 'Den Tag erneut ansehen'
  },
  point: {
    en: (point: string) => `${point}, from the Segretario`,
    it: (point: string) => `${point} del Segretario`,
    de: (point: string) => `${point} vom Segretario`
  },
  writtenAt: {
    en: (time: string) => `written at ${time}`,
    it: (time: string) => `scritto alle ${time}`,
    de: (time: string) => `geschrieben um ${time}`
  },
  glance: { en: 'The day at a glance', it: 'La giornata in breve', de: 'Der Tag auf einen Blick' },
  stillToRead: {
    en: (count: number, written: string) =>
      `${count === 1 ? 'One message is' : `${written} messages are`} still to be read.`,
    it: (count: number, written: string) =>
      `Restano da leggere ${count === 1 ? 'un messaggio' : `${written} messaggi`}.`,
    de: (count: number, written: string) =>
      `${count === 1 ? 'Eine Nachricht ist' : `${written} Nachrichten sind`} noch zu lesen.`
  },
  lookingAtDay: {
    en: 'I’m looking at your day…',
    it: 'Sto guardando la tua giornata…',
    de: 'Ich sehe mir Ihren Tag an…'
  },
  stillReading: {
    en: (count: number, written: string, hasLetter: boolean) =>
      `I’m still reading your mail: ${count === 1 ? 'one message' : `${written} messages`}${hasLetter ? '.' : ', then I’ll tell you how the day looks.'}`,
    it: (count: number, written: string, hasLetter: boolean) =>
      `Sto ancora leggendo la tua posta: ${count === 1 ? 'un messaggio' : `${written} messaggi`}${hasLetter ? '.' : ", poi ti dico com'è la giornata."}`,
    de: (count: number, written: string, hasLetter: boolean) =>
      `Ich lese noch Ihre E-Mails: ${count === 1 ? 'eine Nachricht' : `${written} Nachrichten`}${hasLetter ? '.' : ', danach sage ich Ihnen, wie der Tag aussieht.'}`
  },
  noLetter: {
    en: 'Today’s letter isn’t here yet.',
    it: 'La lettera di oggi non c’è ancora.',
    de: 'Der Brief für heute ist noch nicht da.'
  },
  writeNow: { en: 'Write it now', it: 'Scrivila ora', de: 'Jetzt schreiben' },
  agenda: { en: 'On the agenda', it: 'In agenda', de: 'Auf der Agenda' },
  questions: { en: 'Questions for you', it: 'Ti chiedo', de: 'Fragen an Sie' },
  letter: { en: 'The letter', it: 'La lettera', de: 'Der Brief' },
  proposals: { en: 'Proposals', it: 'Proposte', de: 'Vorschläge' },
  nothingPending: {
    en: 'Nothing pending: everything is in order.',
    it: 'Niente in sospeso: è tutto in ordine.',
    de: 'Nichts offen: Alles ist in Ordnung.'
  }
})

/** Each part of the day, as its heading says it. */
const SECTION_TITLES = defineMessages({
  today: { en: 'To do today', it: 'Da fare oggi', de: 'Heute zu tun' },
  week: { en: 'This week', it: 'Questa settimana', de: 'Diese Woche' },
  waiting: { en: 'Waiting on you', it: 'Ti aspettano', de: 'Warten auf Sie' },
  ready: PLACES.readyReplies,
  awaited: { en: 'You’re waiting', it: 'Aspetti tu', de: 'Sie warten' }
})

/** Each part of the day, as its count reads at a glance: "3 to do today". */
const SECTION_GLANCES = defineMessages({
  today: { en: 'to do today', it: 'da fare oggi', de: 'heute zu tun' },
  week: { en: 'this week', it: 'questa settimana', de: 'diese Woche' },
  waiting: { en: 'waiting on you', it: 'ti aspettano', de: 'warten auf Sie' },
  ready: { en: 'ready', it: 'pronte', de: 'fertig' },
  awaited: { en: 'you’re waiting on', it: 'aspetti tu', de: 'von Ihnen erwartet' }
})

const DAY_TITLE: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
}

const SINCE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
/** Made when used: the hour is written as the region writes it now. */
const WRITTEN_AT = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })
/** How long the page waits for a letter asked again before it stops saying so. */
const REWRITE_WAIT_MS = 3 * 60_000

/** The day's parts, in the order the page gives them, and where each is. */
const SECTIONS = [
  { key: 'today', id: 'oggi-da-fare' },
  { key: 'week', id: 'oggi-settimana' },
  { key: 'waiting', id: 'oggi-ti-aspettano' },
  { key: 'ready', id: 'oggi-pronte' },
  { key: 'awaited', id: 'oggi-aspetti' }
] as const satisfies ReadonlyArray<{
  key: keyof Pick<Today, 'today' | 'week' | 'waiting' | 'ready' | 'awaited'> &
    keyof typeof SECTION_TITLES
  id: string
}>

/** Ticks a line's commitment off — done, or arrived — with an undo. */
async function settleLine(line: DayLine): Promise<boolean> {
  const commitment = line.commitment

  if (!commitment) {
    return false
  }

  try {
    await window.segretarioApi.setCommitmentStatus(commitment.id, 'fatta')
    const m = messagesNow(MESSAGES)
    toast(commitment.kind === 'aspetti' ? m.arrived : m.done, {
      description: commitment.text,
      action: {
        label: m.undo,
        onClick: () => undoTick(commitment.id)
      }
    })
    return true
  } catch (error) {
    toast.error(messagesNow(MESSAGES).notChanged, {
      description: error instanceof Error ? error.message : undefined
    })
    return false
  }
}

/** A line's body, whether it opens something or not. */
const LINE_BODY =
  '-mx-3 flex w-[calc(100%+1.5rem)] flex-col gap-1 rounded-[8px] px-3 py-2.5 pr-24 text-left'

function Line({
  line,
  day,
  showWaitingSince,
  words,
  onSettled,
  onRemind
}: {
  line: DayLine
  day: string
  showWaitingSince?: boolean
  words: WorkWords
  onSettled: (line: DayLine) => void
  onRemind: (commitment: Commitment) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const w = useMessages(WORK_WORDS)
  const kinds = useMessages(COMMITMENT_LABELS)
  const openLink = useOpenLink()
  const [rewriting, setRewriting] = useState(false)
  const found = dayLineLink(line)
  // Oggi is where a thing without a source to open is kept: its line opens nothing here; nor
  // one being rewritten, whose words are a field.
  const link = found?.kind === 'commitment' || rewriting ? null : found
  const late = line.due !== null && line.due < day
  const kind = line.commitment?.kind
  const settleLabel = kind ? (kind === 'aspetti' ? m.settleArrived : m.settleDone) : null
  const pending = line.commitment?.pending ?? null

  const body = (
    <>
      <span className={cn('voice text-foreground text-[16px] leading-[1.4]', dimmedBy(pending))}>
        {(kind || line.readyKind === 'sollecito') && (
          <span className="text-ai mr-1.5 font-sans text-[12px] font-semibold">
            {kind ? kinds[kind] : m.followUp}
          </span>
        )}
        {rewriting && line.commitment ? (
          <RewriteField
            target={{ kind: 'impegno', id: line.commitment.id }}
            text={line.commitment.text}
            label={w.rewrite}
            onDone={() => setRewriting(false)}
            className="mt-1 font-sans text-[13px]"
          />
        ) : (
          line.text
        )}
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
          <span className="shrink-0">
            {m.since(dateFormat(SINCE).format(new Date(dayLineSince(line))))}
          </span>
        )}
        <span className="min-w-0 truncate">{dayLineSourceWords(line)}</span>
      </span>
      <PendingWordsLine pending={pending} />
    </>
  )

  return (
    <li className="group relative">
      {link ? (
        <button
          type="button"
          onClick={() => openLink(link)}
          className={cn(
            LINE_BODY,
            'hover:bg-hover focus-visible:ring-ring/60 outline-none focus-visible:ring-2'
          )}
        >
          {body}
        </button>
      ) : (
        <div className={LINE_BODY}>{body}</div>
      )}
      {settleLabel && line.commitment && (
        <span className="absolute top-2.5 -right-1 flex items-center gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
          <CommitmentMenu
            commitment={line.commitment}
            onRemind={onRemind}
            words={words}
            onRewrite={() => setRewriting(true)}
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

/**
 * Something to remember, in a few words: an open thing of the user's own,
 * kept with the rest — its date, if it has one, comes from its menu.
 */
function RememberField(): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const add = async (): Promise<void> => {
    const said = text.trim()

    if (!said || saving) {
      return
    }

    setSaving(true)

    try {
      await window.segretarioApi.openCommitment(
        { kind: 'user' },
        { kind: 'da_fare', text: said, due: null }
      )
      setText('')
    } catch (error) {
      toast.error(m.notAdded, {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void add()
      }}
    >
      <Plus className="text-faint-foreground size-4 shrink-0" />
      <Input
        value={text}
        disabled={saving}
        aria-label={m.remember}
        placeholder={m.rememberPlaceholder}
        onChange={(event) => setText(event.target.value)}
        className="focus-visible:border-border h-9 border-transparent bg-transparent shadow-none"
      />
    </form>
  )
}

function Section({
  id,
  title,
  lines,
  day,
  showWaitingSince,
  settled,
  words,
  onSettled,
  onRemind
}: {
  id: string
  title: string
  lines: ReadonlyArray<DayLine>
  day: string
  showWaitingSince?: boolean
  words: WorkWords
  /** Lines just dealt with here, gone before the day is read again. */
  settled: ReadonlySet<string>
  onSettled: (line: DayLine) => void
  onRemind: (commitment: Commitment) => void
}): React.JSX.Element | null {
  const shown = lines.filter((line) => !settled.has(dayLineKey(line)))

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
            key={dayLineKey(line)}
            line={line}
            day={day}
            showWaitingSince={showWaitingSince}
            words={words}
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
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const sectionTitles = useMessages(SECTION_TITLES)
  const sectionGlances = useMessages(SECTION_GLANCES)
  const { formatLocale } = useLanguage()
  const [page, setPage] = useState<Today | null>(null)
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set())
  const settle = useCallback(
    (line: DayLine): void => setSettled((current) => new Set(current).add(dayLineKey(line))),
    []
  )
  const [now] = useState(() => Date.now())
  const today = startOfDay(new Date(now))
  const { calendars } = useCalendarList()
  const agenda = useCalendarEvents(
    today.toISOString(),
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()
  )
  const [rewritingSince, setRewritingSince] = useState<number | null>(null)
  const [editingLetter, setEditingLetter] = useState(false)
  const words = useWorkWords()
  const reloadTimer = useRef<number | null>(null)

  const rewrite = useCallback(async (): Promise<void> => {
    setRewritingSince(Date.now())

    try {
      await window.segretarioApi.refreshToday()
    } catch (error) {
      setRewritingSince(null)
      toast.error(messagesNow(MESSAGES).notRefreshed, {
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
        const count = page[section.key].filter((line) => !settled.has(dayLineKey(line))).length
        return count > 0 ? [{ ...section, count }] : []
      })
    : []
  // The user's day (§7.4): their events, of the calendars they show — the Calendario shows them all.
  const shown = calendars
    ? new Set(calendars.filter((calendar) => !calendar.hidden).map((calendar) => calendar.key))
    : null
  const meetings =
    agenda?.filter(
      (event) =>
        isOnDay(event, today) &&
        event.yours !== false &&
        (shown === null || shown.has(calendarKey(event.connectionId, event.calendarId)))
    ) ?? []

  return (
    <div className="paper flex h-full min-h-0 flex-col">
      <header
        className={cn(
          'window-drag-region flex h-[52px] shrink-0 items-center gap-2 border-b pl-6',
          atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-3'
        )}
      >
        <h1 className="display-title text-[15px]">{places.today}</h1>
        <div className="flex-1" />
        {canWrite && (
          <IconButton
            label={m.lookAgain}
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
              <span className="eyebrow">{m.point(places.whereItStands)}</span>
              <span className="flex-1" />
              {page?.letterAt && !rewriting && (
                <span className="text-faint-foreground text-[11.5px]">
                  {m.writtenAt(dateFormat(WRITTEN_AT()).format(page.letterAt))}
                </span>
              )}
              {page?.letter && !rewriting && !editingLetter && (
                <WorkMenu
                  target={{ kind: 'lettera', day: page.day }}
                  pending={page.letterPending}
                  about={page.letter}
                  words={words}
                  onRewrite={() => setEditingLetter(true)}
                  label={m.letter}
                />
              )}
            </div>
            <p className="display-title pt-2 text-[30px] leading-tight first-letter:uppercase">
              {dateFormat(DAY_TITLE).format(new Date())}
            </p>
            {glance.length > 0 && (
              <nav
                aria-label={m.glance}
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
                      {sectionGlances[part.key]}
                    </button>
                  </span>
                ))}
              </nav>
            )}
            {page?.letter &&
              (editingLetter ? (
                <RewriteField
                  target={{ kind: 'lettera', day: page.day }}
                  text={page.letter}
                  label={m.letter}
                  onDone={() => setEditingLetter(false)}
                  className="voice text-[16px] leading-[1.55]"
                />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <LinkedWords
                    text={page.letter}
                    links={page.letterLinks}
                    className={cn(
                      'drop-cap text-foreground text-[18px] leading-[1.55]',
                      (rewriting || page.letterPending?.kind === 'correzione') && 'opacity-60'
                    )}
                  />
                  <PendingWordsLine pending={page.letterPending} />
                </div>
              ))}
            {page?.network ? (
              <p className="text-muted-foreground flex items-start gap-2 text-[13px]">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {page.network}
                  {page.reading > 0 &&
                    ` ${m.stillToRead(page.reading, page.reading.toLocaleString(formatLocale))}`}
                </span>
              </p>
            ) : rewriting ? (
              <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <LoaderCircle className="text-ai size-4 animate-spin" />
                {m.lookingAtDay}
              </p>
            ) : page && page.reading > 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <LoaderCircle className="text-ai size-4 animate-spin" />
                {m.stillReading(
                  page.reading,
                  page.reading.toLocaleString(formatLocale),
                  Boolean(page.letter)
                )}
              </p>
            ) : (
              page &&
              !page.letter &&
              canWrite && (
                <p className="text-muted-foreground text-[12.5px]">
                  {m.noLetter}{' '}
                  <button
                    type="button"
                    onClick={() => void rewrite()}
                    className="text-ai focus-visible:ring-ring/60 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
                  >
                    {m.writeNow}
                  </button>
                </p>
              )
            )}
          </div>

          {meetings.length > 0 && (
            <section className="flex flex-col gap-1">
              <h2 className="eyebrow">{m.agenda}</h2>
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
                  <h2 className="eyebrow">
                    {m.questions} · {page.questions.length}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {page.questions.flatMap((line) =>
                      line.commitment
                        ? [
                            <CommitmentRow
                              key={dayLineKey(line)}
                              commitment={line.commitment}
                              words={words}
                            />
                          ]
                        : []
                    )}
                  </ul>
                </section>
              )}
              <RememberField />
              {SECTIONS.map((section) => (
                <Section
                  key={section.key}
                  id={section.id}
                  title={sectionTitles[section.key]}
                  lines={page[section.key]}
                  day={page.day}
                  showWaitingSince={section.key === 'awaited'}
                  settled={settled}
                  words={words}
                  onSettled={settle}
                  onRemind={onRemind}
                />
              ))}
              {page.proposals.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="eyebrow">
                    {m.proposals} · {page.proposals.length}
                  </h2>
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
                <p className="voice text-muted-foreground text-[16px]">{m.nothingPending}</p>
              )}
            </>
          )}
          {words.dialogs}
        </article>
      </div>
    </div>
  )
}
