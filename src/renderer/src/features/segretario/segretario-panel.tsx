import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import {
  AlertCircle,
  ArrowUp,
  AtSign,
  Bell,
  BookOpen,
  Briefcase,
  CalendarDays,
  Check,
  ChevronRight,
  Eye,
  FileSearch,
  FolderInput,
  History,
  ListTodo,
  LoaderCircle,
  Mail,
  MailOpen,
  MessageSquareReply,
  NotebookPen,
  Paperclip,
  PenLine,
  RotateCcw,
  Plus,
  Search,
  Send,
  SpellCheck,
  Square,
  StickyNote,
  Sun,
  X
} from 'lucide-react'

import extensionRenderer from '@app/extension/renderer'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'
import { hourStyle, languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, type Messages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import {
  TASK_LABELS,
  type ActivityEntry,
  type ActivityStatus,
  type ActivitySummary,
  type ApprovalRequest,
  type HandleLink,
  type SegretarioContext
} from '@shared/segretario'

import { SegretarioText } from './segretario-text'
import type { SegretarioState } from './use-segretario'

const MESSAGES = defineMessages({
  toConfirm: { en: 'To confirm', it: 'Da confermare', de: 'Zu bestätigen' },
  to: { en: 'To', it: 'A', de: 'An' },
  cc: { en: 'Cc', it: 'Cc', de: 'Cc' },
  noSubject: { en: 'No subject', it: 'Senza oggetto', de: 'Kein Betreff' },
  dontSend: { en: 'Don’t send', it: 'Non inviare', de: 'Nicht senden' },
  cancel: { en: 'Cancel', it: 'Annulla', de: 'Abbrechen' },
  open: { en: 'Open', it: 'Apri', de: 'Öffnen' },
  send: { en: 'Send', it: 'Invia', de: 'Senden' },
  confirm: { en: 'Confirm', it: 'Conferma', de: 'Bestätigen' },
  whatIChanged: { en: 'What I changed', it: 'Cosa ho cambiato', de: 'Was ich geändert habe' },
  undone: { en: 'undone', it: 'annullato', de: 'rückgängig gemacht' },
  notUndone: {
    en: 'It couldn’t be undone.',
    it: 'Non si è annullata.',
    de: 'Ließ sich nicht rückgängig machen.'
  },
  undo: { en: 'Undo', it: 'Annulla', de: 'Rückgängig' },
  today: { en: 'Today', it: 'Oggi', de: 'Heute' },
  yesterday: { en: 'Yesterday', it: 'Ieri', de: 'Gestern' },
  openingDiary: {
    en: 'Opening the activity…',
    it: 'Apro il diario…',
    de: 'Der Verlauf wird geöffnet…'
  },
  emptyDiary: {
    en: 'Here you’ll find what I do on my own: reading the mail as it arrives, writing up the day, updating the projects. I haven’t done any work yet.',
    it: 'Qui trovi quello che faccio da solo: leggere la posta che arriva, scrivere la giornata, aggiornare i progetti. Per ora non ho ancora lavorato.',
    de: 'Hier finden Sie, was ich selbstständig erledige: die eingehende Post lesen, den Tag zusammenfassen, die Projekte aktualisieren. Bisher habe ich noch nicht gearbeitet.'
  },
  compaction: {
    en: 'I summarized the work so far, to keep it better in mind.',
    it: 'Ho riassunto il lavoro fatto finora, per tenerlo a mente meglio.',
    de: 'Ich habe die bisherige Arbeit zusammengefasst, um sie besser im Blick zu behalten.'
  },
  retry: { en: 'Try again', it: 'Riprova', de: 'Erneut versuchen' },
  introduction: {
    en: 'I’m your Segretario. I read the mail as it arrives and keep track of what’s left to do; ask me to search, sum up a matter, prepare a reply in your style, tidy up or set up a meeting.',
    it: 'Sono il tuo segretario. Leggo la posta mentre arriva e tengo il conto di quello che resta da fare; chiedimi di cercare, riassumere una questione, preparare una risposta nel tuo stile, mettere in ordine o fissare un appuntamento.',
    de: 'Ich bin Ihr Segretario. Ich lese die Post, sobald sie eintrifft, und behalte im Blick, was noch zu tun ist; bitten Sie mich, etwas zu suchen, eine Angelegenheit zusammenzufassen, eine Antwort in Ihrem Stil vorzubereiten, Ordnung zu schaffen oder einen Termin anzusetzen.'
  },
  notResumed: {
    en: 'I couldn’t pick it up again.',
    it: 'Non sono riuscito a riprendere.',
    de: 'Ich konnte nicht weitermachen.'
  },
  notStarted: {
    en: 'I couldn’t get started.',
    it: 'Non sono riuscito a cominciare.',
    de: 'Ich konnte nicht beginnen.'
  },
  closeDiary: { en: 'Close the activity', it: 'Chiudi il diario', de: 'Verlauf schließen' },
  openDiary: {
    en: 'Activity: the work done on my own',
    it: 'Diario: il lavoro fatto da solo',
    de: 'Verlauf: selbstständig erledigte Arbeit'
  },
  newTask: { en: 'New task', it: 'Nuovo lavoro', de: 'Neue Aufgabe' },
  close: { en: 'Close', it: 'Chiudi', de: 'Schließen' },
  tasks: {
    en: 'The Segretario’s tasks',
    it: 'Lavori del Segretario',
    de: 'Aufgaben des Segretario'
  },
  detach: { en: 'Don’t send along', it: 'Non mandare insieme', de: 'Nicht mitsenden' },
  replyOrAsk: {
    en: 'Reply or ask something else…',
    it: 'Rispondi o chiedi altro…',
    de: 'Antworten oder etwas anderes fragen…'
  },
  askAboutRun: {
    en: 'Ask me about this task…',
    it: 'Chiedimi di questo lavoro…',
    de: 'Fragen Sie mich zu dieser Aufgabe…'
  },
  askOrHandOver: {
    en: 'Ask, or hand over a task…',
    it: 'Chiedi o affida un lavoro…',
    de: 'Fragen oder eine Aufgabe übergeben…'
  },
  keys: {
    en: 'Enter to send · ⇧ Enter for a new line',
    it: 'Invio per mandare · ⇧ Invio per andare a capo',
    de: 'Eingabe zum Senden · ⇧ Eingabe für neue Zeile'
  },
  stop: { en: 'Stop', it: 'Ferma', de: 'Anhalten' },
  sendRequest: { en: 'Send', it: 'Manda', de: 'Senden' }
})

/** A piece of work's state, as its row says it. */
const STATUS_LABELS = defineMessages({
  running: { en: 'Working', it: 'Al lavoro', de: 'Arbeitet' },
  waiting: { en: 'Waiting for you', it: 'Ti aspetta', de: 'Wartet auf Sie' },
  done: { en: 'Done', it: 'Fatto', de: 'Erledigt' },
  failed: { en: 'Failed', it: 'Non riuscito', de: 'Fehlgeschlagen' },
  cancelled: { en: 'Stopped', it: 'Fermato', de: 'Angehalten' }
}) satisfies Record<ActivityStatus, unknown>

/** What the user is looking at, as the input shows it before it is sent along. */
export interface SegretarioContextChip {
  context: SegretarioContext
  /** What goes along, read as the user sends: a message being written changes as it is typed. */
  resolve?: () => SegretarioContext
  label: string
  /** A message being written, rather than one read or an event. */
  kind?: 'composing'
}

/** Each tool's icon in the Segretario's work: the host's, then the extension's own. */
const TOOL_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  cerca_posta: Search,
  cerca_file: FileSearch,
  leggi: MailOpen,
  nota: StickyNote,
  // The same as Settings › Notifiche.
  avvisa: Bell,
  impegni: ListTodo,
  progetti: Briefcase,
  risposta: MessageSquareReply,
  scrivi_bozza: PenLine,
  invia_bozza: Send,
  organizza: FolderInput,
  calendario: CalendarDays,
  memoria: NotebookPen,
  oggi: Sun,
  revisione: SpellCheck,
  mostra: Eye,
  diario: History,
  // The same as Settings › Connessioni.
  connessioni: AtSign,
  ...extensionRenderer.toolIcons
}

/** A draft's text holds no short names: its links are the message's own. */
const NO_HANDLES: ReadonlyMap<string, HandleLink> = new Map()

const EMPTY_CONTEXT: SegretarioContext = { messages: [], accountId: null, folderLabel: null }

function StatusMark({ status }: { status: ActivityStatus }): React.JSX.Element {
  const labels = useMessages(STATUS_LABELS)

  switch (status) {
    case 'running':
      return <LoaderCircle className="text-ai size-3.5 animate-spin" />
    case 'waiting':
      return <span className="bg-urgent size-[7px] rounded-full" aria-label={labels.waiting} />
    case 'done':
      return <Check className="text-faint-foreground size-3.5" />
    case 'failed':
      return <AlertCircle className="text-destructive size-3.5" />
    case 'cancelled':
      return <Square className="text-faint-foreground size-3" />
  }
}

function ActivityRow({
  activity,
  selected,
  onSelect
}: {
  activity: ActivitySummary
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const labels = useMessages(STATUS_LABELS)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'focus-visible:ring-ring/60 flex h-[30px] w-full shrink-0 items-center gap-2.5 rounded-[7px] px-2 text-left outline-none focus-visible:ring-2',
        selected ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-hover'
      )}
    >
      <span className="grid w-3.5 shrink-0 place-items-center">
        <StatusMark status={activity.status} />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[12.5px]',
          activity.unseen ? 'text-foreground font-semibold' : 'font-medium'
        )}
      >
        {activity.title}
      </span>
      <span
        className={cn(
          'shrink-0 text-[11px]',
          activity.status === 'waiting' ? 'text-urgent font-semibold' : 'text-faint-foreground'
        )}
      >
        {labels[activity.status]}
      </span>
    </button>
  )
}

function ToolLine({
  entry
}: {
  entry: Extract<ActivityEntry, { kind: 'tool' }>
}): React.JSX.Element {
  const Icon = TOOL_ICONS[entry.tool.name] ?? Search

  return (
    <div
      className={cn(
        'flex items-start gap-2 text-[12px] leading-[17px]',
        entry.tool.status === 'error' ? 'text-destructive-soft-foreground' : 'text-faint-foreground'
      )}
    >
      {entry.tool.status === 'running' ? (
        <LoaderCircle className="text-ai mt-px size-3.5 shrink-0 animate-spin" />
      ) : (
        <Icon className="mt-px size-3.5 shrink-0" />
      )}
      <span className="min-w-0">{entry.tool.summary}</span>
    </div>
  )
}

function ApprovalCard({
  approval,
  onDecide,
  onOpenDraft
}: {
  approval: ApprovalRequest
  onDecide: (approved: boolean) => void
  onOpenDraft: (draftId: string) => void
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)
  const [deciding, setDeciding] = useState(false)
  const draft = approval.draft

  // Once answered, the step's own line says what became of it.
  if (approval.status !== 'pending') {
    return null
  }

  return (
    <div className="sheet overflow-hidden rounded-[10px]">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-[12px]">
        <span className="bg-urgent size-[6px] rounded-full" />
        <span className="text-foreground shrink-0 font-semibold whitespace-nowrap">
          {m.toConfirm}
        </span>
        <span className="text-faint-foreground min-w-0 truncate">{approval.title}</span>
      </div>
      {draft && (
        <div className="space-y-1.5 px-3 py-2.5">
          <div className="text-muted-foreground space-y-0.5 text-[11.5px]">
            <p className="truncate">
              <span className="text-faint-foreground">{m.to}</span> {draft.to.join(', ') || '—'}
            </p>
            {draft.cc.length > 0 && (
              <p className="truncate">
                <span className="text-faint-foreground">{m.cc}</span> {draft.cc.join(', ')}
              </p>
            )}
            <p className="text-foreground truncate font-semibold">{draft.subject || m.noSubject}</p>
          </div>
          <div className="max-h-48 overflow-y-auto">
            <SegretarioText
              text={draft.text}
              handles={NO_HANDLES}
              onOpen={() => undefined}
              className="text-[14px] leading-[1.5]"
            />
          </div>
          {draft.attachments.length > 0 && (
            <p className="text-faint-foreground flex items-center gap-1 text-[11.5px]">
              <Paperclip className="size-3" />
              {draft.attachments.join(', ')}
            </p>
          )}
        </div>
      )}
      {approval.kind === 'action' && approval.details && approval.details.length > 0 && (
        <ul className="text-foreground space-y-1 px-3 py-2.5 text-[12.5px] leading-[1.45]">
          {approval.details.map((detail) => (
            <li key={detail} className="break-words">
              {detail}
            </li>
          ))}
        </ul>
      )}
      <div className="bg-hover/60 flex items-center justify-end gap-1.5 border-t px-2.5 py-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={deciding}
          onClick={() => {
            setDeciding(true)
            onDecide(false)
          }}
        >
          {approval.kind === 'send' ? m.dontSend : m.cancel}
        </Button>
        {draft && (
          <Button
            variant="secondary"
            size="sm"
            disabled={deciding}
            onClick={() => onOpenDraft(draft.draftId)}
          >
            {m.open}
          </Button>
        )}
        <Button
          variant="seal"
          size="sm"
          disabled={deciding}
          onClick={() => {
            setDeciding(true)
            onDecide(true)
          }}
        >
          {deciding ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : approval.kind === 'send' ? (
            <Send className="size-3.5" />
          ) : (
            <Check className="size-3.5" />
          )}
          {approval.kind === 'send' ? m.send : (approval.confirmLabel ?? m.confirm)}
        </Button>
      </div>
    </div>
  )
}

/** What a run changed in the user's work, a line each, with an undo where there is one. */
function ChangesBlock({
  activityId,
  entry
}: {
  activityId: string
  entry: Extract<ActivityEntry, { kind: 'changes' }>
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)
  const [undoing, setUndoing] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  if (entry.changes.length === 0) {
    return null
  }

  return (
    <div className="border-ai-line flex flex-col gap-1 border-l-2 pl-3">
      <p className="text-ai text-[11.5px] font-semibold">{m.whatIChanged}</p>
      <ul className="flex flex-col gap-0.5">
        {entry.changes.map((change, index) => (
          <li key={index} className="flex items-baseline gap-2 text-[12px] leading-[1.45]">
            <span
              className={cn(
                'min-w-0 flex-1',
                change.undone ? 'text-faint-foreground line-through' : 'text-foreground'
              )}
            >
              {change.label}
            </span>
            {change.undone ? (
              <span className="text-faint-foreground shrink-0 text-[11px]">{m.undone}</span>
            ) : (
              change.undoable && (
                <button
                  type="button"
                  disabled={undoing !== null}
                  onClick={() => {
                    setUndoing(index)
                    setProblem(null)
                    void window.segretarioApi
                      .undoChange(activityId, entry.id, index)
                      .catch((error: unknown) =>
                        setProblem(
                          error instanceof Error ? error.message : messagesNow(MESSAGES).notUndone
                        )
                      )
                      .finally(() => setUndoing(null))
                  }}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 shrink-0 rounded-sm text-[11.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
                >
                  {undoing === index ? <LoaderCircle className="size-3 animate-spin" /> : m.undo}
                </button>
              )
            )}
          </li>
        ))}
      </ul>
      {problem && <p className="text-destructive-soft-foreground text-[11.5px]">{problem}</p>}
    </div>
  )
}

const DIARY_DAY: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
/** Made when used: the hour is written as the region writes it now. */
const DIARY_TIME = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })

/** "Today", "Yesterday", or the day: what a group of the diary is headed by. */
function diaryDayLabel(
  at: number,
  m: Messages<typeof MESSAGES>,
  days: Intl.DateTimeFormat,
  now = new Date()
): string {
  const day = new Date(at)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()

  if (startOfDay === start) {
    return m.today
  }

  return startOfDay === start - 24 * 60 * 60 * 1000 ? m.yesterday : days.format(day)
}

/**
 * The work the Segretario did on its own, day by day: what it read, the
 * day it wrote, the projects it brought up to date, what it learnt. Runs
 * of the same task are gathered — "Lettura della posta · 14" — and open
 * one by one, each with what it changed and its undo.
 */
function DiaryView({
  diary,
  onSelect
}: {
  diary: ReadonlyArray<ActivitySummary> | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const taskNames = useMessages(TASK_LABELS)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())

  if (!diary) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-[12.5px]">
        <LoaderCircle className="size-4 animate-spin" />
        {m.openingDiary}
      </div>
    )
  }

  if (diary.length === 0) {
    return (
      <p className="voice text-muted-foreground flex-1 px-5 pt-6 text-[15px] leading-[1.45]">
        {m.emptyDiary}
      </p>
    )
  }

  const { formatLocale } = languageNow()
  const dayFormat = new Intl.DateTimeFormat(formatLocale, DIARY_DAY)
  const timeFormat = new Intl.DateTimeFormat(formatLocale, DIARY_TIME())
  const days = new Map<string, Map<string, ActivitySummary[]>>()

  for (const activity of diary) {
    const day = diaryDayLabel(activity.createdAt, m, dayFormat)
    const tasks = days.get(day) ?? new Map<string, ActivitySummary[]>()
    tasks.set(activity.task, [...(tasks.get(activity.task) ?? []), activity])
    days.set(day, tasks)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {[...days].map(([day, tasks]) => (
        <section key={day} className="mb-3 flex flex-col gap-0.5">
          <h3 className="eyebrow px-2 pb-1 first-letter:uppercase">{day}</h3>
          {[...tasks].map(([task, runs]) => {
            const key = `${day}\u0000${task}`
            const expanded = runs.length === 1 || open.has(key)

            return (
              <div key={key} className="flex flex-col">
                {runs.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpen((current) => {
                        const next = new Set(current)

                        if (!next.delete(key)) {
                          next.add(key)
                        }

                        return next
                      })
                    }
                    className="text-muted-foreground hover:bg-hover focus-visible:ring-ring/60 flex h-[30px] items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] font-medium outline-none focus-visible:ring-2"
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 transition-transform',
                        expanded && 'rotate-90'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{taskNames[task]}</span>
                    <span className="text-faint-foreground tabular-nums">{runs.length}</span>
                  </button>
                )}
                {expanded &&
                  runs.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => onSelect(run.id)}
                      className={cn(
                        'text-muted-foreground hover:bg-hover focus-visible:ring-ring/60 flex h-[30px] items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] outline-none focus-visible:ring-2',
                        runs.length > 1 && 'pl-7'
                      )}
                    >
                      <span className="grid w-3.5 shrink-0 place-items-center">
                        <StatusMark status={run.status} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{run.title}</span>
                      <span className="text-faint-foreground shrink-0 text-[11px] tabular-nums">
                        {timeFormat.format(run.createdAt)}
                      </span>
                    </button>
                  ))}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

/** A run's page, as it is written: the user's words, the Segretario's, its tools, what it changed. */
export function ActivityThread({
  state,
  onOpen,
  onApprove,
  onOpenDraft,
  onRetry
}: {
  state: SegretarioState
  onOpen: (link: HandleLink) => void
  onApprove: (approval: ApprovalRequest, approved: boolean) => void
  onOpenDraft: (draftId: string) => void
  /** The work on screen stopped short and the user waits for it: "Riprova", by its error. */
  onRetry?: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)
  const entries = state.entries ?? []
  const lastError = entries.findLastIndex((entry) => entry.kind === 'error')

  // Follows the work as it is written, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const element = scrollRef.current

    if (element && stickToBottom.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [state.entries, state.streaming])

  useEffect(() => {
    stickToBottom.current = true
  }, [state.selectedId])

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget
        stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
      }}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
    >
      <div className="flex flex-col gap-3">
        {entries.map((entry, index) => {
          const previous = entries[index - 1]
          const tight = entry.kind === 'tool' && previous?.kind === 'tool'

          switch (entry.kind) {
            case 'user':
              // Work it began itself opens with what it set out to do, in its own hand.
              if (entry.origin === 'segretario') {
                return (
                  <p
                    key={entry.id}
                    className="text-ai voice border-ai-line border-l-2 pl-3 text-[13.5px] leading-[1.5] italic"
                  >
                    {entry.text}
                  </p>
                )
              }

              return (
                <div key={entry.id} className="mt-1 flex flex-col items-end gap-1">
                  <div className="bg-hover max-w-[88%] rounded-[12px_12px_4px_12px] px-3 py-2 text-[13px] leading-[1.45] whitespace-pre-wrap shadow-[inset_0_0_0_1px_hsl(var(--border))]">
                    {entry.text}
                  </div>
                </div>
              )
            case 'assistant':
              return (
                <SegretarioText
                  key={entry.id}
                  text={entry.text}
                  handles={state.handles}
                  onOpen={onOpen}
                />
              )
            case 'tool':
              return (
                <div key={entry.id} className={cn(tight && '-mt-1.5')}>
                  <ToolLine entry={entry} />
                </div>
              )
            case 'approval':
              return (
                <ApprovalCard
                  key={entry.id}
                  approval={entry.approval}
                  onDecide={(approved) => onApprove(entry.approval, approved)}
                  onOpenDraft={onOpenDraft}
                />
              )
            case 'changes':
              return state.selectedId ? (
                <ChangesBlock key={entry.id} activityId={state.selectedId} entry={entry} />
              ) : null
            case 'compaction':
              return (
                <p key={entry.id} className="text-faint-foreground text-center text-[11.5px]">
                  {m.compaction}
                </p>
              )
            case 'error':
              return (
                <div key={entry.id} className="flex flex-col items-start gap-2">
                  <div className="text-destructive-soft-foreground flex items-start gap-2 text-[12.5px] leading-[1.45]">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{entry.message}</span>
                  </div>
                  {onRetry && index === lastError && (
                    <Button variant="outline" size="sm" className="ml-5.5" onClick={onRetry}>
                      <RotateCcw className="size-3.5" />
                      {m.retry}
                    </Button>
                  )}
                </div>
              )
          }
        })}
        {state.streaming && (
          <SegretarioText
            text={state.streaming}
            streaming
            handles={state.handles}
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  )
}

function Introduction({
  onSuggest,
  suggestions
}: {
  onSuggest: (text: string) => void
  suggestions: ReadonlyArray<string>
}): React.JSX.Element {
  const m = useMessages(MESSAGES)

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-y-auto px-5 pb-4">
      <p className="voice text-foreground text-[17px] leading-[1.45]">{m.introduction}</p>
      <div className="flex flex-col items-start gap-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSuggest(suggestion)}
            className="text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 rounded-[7px] px-2.5 py-1.5 text-left text-[12.5px] shadow-[inset_0_0_0_1px_hsl(var(--border))] outline-none focus-visible:ring-2"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The Segretario's panel, beside the mail: the work it is doing — several
 * at once, each with its state — and the conversation of the one on
 * screen. The user writes at the bottom; what they are looking at goes
 * along, shown above what they write.
 */
export function SegretarioPanel({
  state,
  contextChip,
  suggestions,
  atWindowTopRight,
  onClose,
  onOpenHandle,
  onApprove,
  onOpenDraft,
  focusRequest = 0
}: {
  state: SegretarioState
  contextChip: SegretarioContextChip | null
  /** Raised when the user turns to the panel from elsewhere (⌘J in a message): its input takes the words. */
  focusRequest?: number
  suggestions: ReadonlyArray<string>
  atWindowTopRight: boolean
  onClose: () => void
  onOpenHandle: (link: HandleLink) => void
  onApprove: (activityId: string, approval: ApprovalRequest, approved: boolean) => void
  onOpenDraft: (draftId: string) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const statusLabels = useMessages(STATUS_LABELS)
  const [text, setText] = useState('')
  const [contextDetached, setContextDetached] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const panelKeys = useCommandKeys('segretario')
  const [showDiary, setShowDiary] = useState(false)
  const selected = state.activities.find((activity) => activity.id === state.selectedId) ?? null
  // A run of the diary on screen is read, not continued: what is written starts a new request.
  const onDiaryRun = state.selectedId !== null && selected === null
  const working = selected?.status === 'running' || selected?.status === 'waiting'
  const ready = state.status?.keyState === 'ready' || state.status?.keyState === 'unchecked'

  // What the user looks at changes: it goes along again.
  useEffect(() => {
    setContextDetached(false)
  }, [contextChip?.label])

  useEffect(() => {
    inputRef.current?.focus()
  }, [state.selectedId, focusRequest])

  useLayoutEffect(() => {
    const input = inputRef.current

    if (input) {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 180)}px`
    }
  }, [text])

  const retry = async (id: string): Promise<void> => {
    setError(null)

    try {
      await state.retry(id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messagesNow(MESSAGES).notResumed)
    }
  }

  const submit = async (message: string): Promise<void> => {
    const trimmed = message.trim()

    if (!trimmed || sending || working) {
      return
    }

    setSending(true)
    setError(null)

    try {
      const context =
        contextChip && !contextDetached
          ? (contextChip.resolve?.() ?? contextChip.context)
          : EMPTY_CONTEXT
      await (onDiaryRun ? state.start(trimmed, context) : state.send(trimmed, context))
      setShowDiary(false)
      setText('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messagesNow(MESSAGES).notStarted)
    } finally {
      setSending(false)
    }
  }

  return (
    <aside
      aria-label={places.segretario}
      data-segretario-panel
      className="paper flex h-full min-h-0 w-full min-w-0 flex-col border-l"
    >
      <header
        className={cn(
          'window-drag-region flex h-[52px] shrink-0 items-center gap-2 border-b pl-4',
          atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-2'
        )}
      >
        <CompassStar className="text-ai-star size-[18px]" />
        <h2 className="display-title text-[15px]">{places.segretario}</h2>
        {panelKeys && <ShortcutKeys keys={panelKeys} className="ml-1" />}
        <div className="flex-1" />
        <div className="window-no-drag flex items-center gap-0.5">
          <IconButton
            label={showDiary ? m.closeDiary : m.openDiary}
            className={cn('size-[28px]', showDiary ? 'text-foreground' : 'text-faint-foreground')}
            onClick={() => {
              if (!showDiary) {
                void state.loadDiary()
              }

              setShowDiary((shown) => !shown)
            }}
          >
            <BookOpen className="size-4" />
          </IconButton>
          <IconButton
            label={m.newTask}
            className="text-faint-foreground size-[28px]"
            onClick={() => {
              setShowDiary(false)
              state.select(null)
            }}
          >
            <Plus className="size-4" />
          </IconButton>
          <IconButton
            label={m.close}
            className="text-faint-foreground size-[28px]"
            onClick={onClose}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      </header>

      {state.activities.length > 0 && (
        <nav
          aria-label={m.tasks}
          className="flex max-h-[152px] shrink-0 flex-col gap-0.5 overflow-y-auto border-b p-2"
        >
          {state.activities.map((activity) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              selected={activity.id === state.selectedId}
              onSelect={() => {
                setShowDiary(false)
                state.select(activity.id)
              }}
            />
          ))}
        </nav>
      )}

      {showDiary ? (
        <DiaryView
          diary={state.diary}
          onSelect={(id) => {
            setShowDiary(false)
            state.select(id)
          }}
        />
      ) : state.selectedId ? (
        <ActivityThread
          state={state}
          onOpen={onOpenHandle}
          onApprove={(approval, approved) =>
            state.selectedId && onApprove(state.selectedId, approval, approved)
          }
          onOpenDraft={onOpenDraft}
          onRetry={
            ready && selected?.task === 'richiesta' && selected.status === 'failed'
              ? () => void retry(selected.id)
              : undefined
          }
        />
      ) : (
        <Introduction
          suggestions={suggestions}
          onSuggest={(suggestion) => void submit(suggestion)}
        />
      )}

      {ready && (
        <div className="shrink-0 p-3 pt-0">
          {error && <p className="text-destructive-soft-foreground mb-2 text-[12px]">{error}</p>}
          <div className="sheet rounded-[12px] p-2 pb-1.5">
            {contextChip && !contextDetached && (
              <span className="bg-hover text-muted-foreground mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11.5px]">
                {contextChip.kind === 'composing' ? (
                  <PenLine className="size-3 shrink-0" />
                ) : contextChip.context.eventKey ? (
                  <CalendarDays className="size-3 shrink-0" />
                ) : (
                  <Mail className="size-3 shrink-0" />
                )}
                <span className="truncate">{contextChip.label}</span>
                <button
                  type="button"
                  aria-label={m.detach}
                  onClick={() => setContextDetached(true)}
                  className="hover:text-foreground shrink-0"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            <textarea
              ref={inputRef}
              value={text}
              rows={1}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit(text)
                }
              }}
              placeholder={selected ? m.replyOrAsk : onDiaryRun ? m.askAboutRun : m.askOrHandOver}
              className="placeholder:text-faint-foreground block w-full resize-none bg-transparent px-1 py-1 text-[13px] leading-[1.45] outline-none"
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-faint-foreground px-1 text-[11px]">
                {working
                  ? selected!.status === 'running' && state.waiting
                    ? state.waiting
                    : statusLabels[selected!.status]
                  : m.keys}
              </span>
              {working ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => selected && state.cancel(selected.id)}
                >
                  <Square className="size-3" />
                  {m.stop}
                </Button>
              ) : (
                <IconButton
                  label={m.sendRequest}
                  tooltipSide="top"
                  variant="default"
                  className="size-[28px] rounded-full"
                  disabled={!text.trim() || sending}
                  onClick={() => void submit(text)}
                >
                  {sending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="size-3.5" />
                  )}
                </IconButton>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
