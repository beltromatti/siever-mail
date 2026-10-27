import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Check,
  Eye,
  FileSearch,
  FileText,
  FolderInput,
  LoaderCircle,
  Mail,
  MailOpen,
  NotebookPen,
  Paperclip,
  PenLine,
  Plus,
  Search,
  Send,
  Square,
  X
} from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'
import { cn } from '@renderer/lib/utils'
import type {
  ActivityEntry,
  ActivityStatus,
  ActivitySummary,
  ApprovalRequest,
  HandleLink,
  SegretarioContext
} from '@shared/segretario'

import { SegretarioText } from './segretario-text'
import type { SegretarioState } from './use-segretario'

/** What the user is looking at, as the input shows it before it is sent along. */
export interface SegretarioContextChip {
  context: SegretarioContext
  label: string
}

const TOOL_ICONS: Readonly<Record<string, typeof Search>> = {
  cerca_posta: Search,
  leggi_posta: MailOpen,
  leggi_allegato: Paperclip,
  cerca_file: FileSearch,
  leggi_file: FileText,
  scrivi_bozza: PenLine,
  invia_bozza: Send,
  organizza: FolderInput,
  memoria: NotebookPen,
  mostra: Eye
}

/** A draft's text holds no short names: its links are the message's own. */
const NO_HANDLES: ReadonlyMap<string, HandleLink> = new Map()

const EMPTY_CONTEXT: SegretarioContext = { messages: [], accountId: null, folderLabel: null }

function StatusMark({ status }: { status: ActivityStatus }): React.JSX.Element {
  switch (status) {
    case 'running':
      return <LoaderCircle className="text-ai size-3.5 animate-spin" />
    case 'waiting':
      return <span className="bg-seal-text size-[7px] rounded-full" aria-label="Ti aspetta" />
    case 'done':
      return <Check className="text-faint-foreground size-3.5" />
    case 'failed':
      return <AlertCircle className="text-destructive size-3.5" />
    case 'cancelled':
      return <Square className="text-faint-foreground size-3" />
  }
}

const STATUS_LABEL: Readonly<Record<ActivityStatus, string>> = {
  running: 'Al lavoro',
  waiting: 'Ti aspetta',
  done: 'Fatto',
  failed: 'Non riuscito',
  cancelled: 'Fermato'
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
          activity.status === 'waiting' ? 'text-seal-text font-semibold' : 'text-faint-foreground'
        )}
      >
        {STATUS_LABEL[activity.status]}
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
  const [deciding, setDeciding] = useState(false)
  const draft = approval.draft

  // Once answered, the step's own line says what became of it.
  if (approval.status !== 'pending') {
    return null
  }

  return (
    <div className="sheet overflow-hidden rounded-[10px]">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-[12px]">
        <span className="bg-seal-text size-[6px] rounded-full" />
        <span className="text-foreground font-semibold">Da confermare</span>
        <span className="text-faint-foreground min-w-0 truncate">{approval.title}</span>
      </div>
      {draft && (
        <div className="space-y-1.5 px-3 py-2.5">
          <div className="text-muted-foreground space-y-0.5 text-[11.5px]">
            <p className="truncate">
              <span className="text-faint-foreground">A</span> {draft.to.join(', ') || '—'}
            </p>
            {draft.cc.length > 0 && (
              <p className="truncate">
                <span className="text-faint-foreground">Cc</span> {draft.cc.join(', ')}
              </p>
            )}
            <p className="text-foreground truncate font-semibold">
              {draft.subject || 'Senza oggetto'}
            </p>
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
          Non inviare
        </Button>
        {draft && (
          <Button
            variant="secondary"
            size="sm"
            disabled={deciding}
            onClick={() => onOpenDraft(draft.draftId)}
          >
            Apri
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
          ) : (
            <Send className="size-3.5" />
          )}
          Invia
        </Button>
      </div>
    </div>
  )
}

function Thread({
  state,
  onOpen,
  onApprove,
  onOpenDraft
}: {
  state: SegretarioState
  onOpen: (link: HandleLink) => void
  onApprove: (approval: ApprovalRequest, approved: boolean) => void
  onOpenDraft: (draftId: string) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)
  const entries = state.entries ?? []

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
            case 'compaction':
              return (
                <p key={entry.id} className="text-faint-foreground text-center text-[11.5px]">
                  Ho riassunto il lavoro fatto finora, per tenerlo a mente meglio.
                </p>
              )
            case 'error':
              return (
                <div
                  key={entry.id}
                  className="text-destructive-soft-foreground flex items-start gap-2 text-[12.5px] leading-[1.45]"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{entry.message}</span>
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
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-y-auto px-5 pb-4">
      <p className="voice text-foreground text-[17px] leading-[1.45]">
        Sono il tuo segretario. Posso cercare e leggere tutta la tua posta e i tuoi file,
        riassumerti una questione, preparare le risposte nel tuo stile e mettere in ordine.
      </p>
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

function SetupNotice({
  problem,
  onOpenSettings
}: {
  problem: string | null
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 px-6">
      <p className="voice text-foreground text-[17px] leading-[1.45]">
        Per lavorare per te mi serve una chiave OpenRouter: è il servizio da cui uso il modello, e
        paghi solo quello che consumo — di solito pochi dollari al mese.
      </p>
      {problem && <p className="text-destructive-soft-foreground text-[12.5px]">{problem}</p>}
      <Button className="self-start" onClick={onOpenSettings}>
        Collega OpenRouter
      </Button>
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
  onOpenSettings,
  onOpenHandle,
  onApprove,
  onOpenDraft
}: {
  state: SegretarioState
  contextChip: SegretarioContextChip | null
  suggestions: ReadonlyArray<string>
  atWindowTopRight: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenHandle: (link: HandleLink) => void
  onApprove: (activityId: string, approval: ApprovalRequest, approved: boolean) => void
  onOpenDraft: (draftId: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [contextDetached, setContextDetached] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const panelKeys = useCommandKeys('segretario')
  const selected = state.activities.find((activity) => activity.id === state.selectedId) ?? null
  const working = selected?.status === 'running' || selected?.status === 'waiting'
  const ready = state.status?.keyState === 'ready' || state.status?.keyState === 'unchecked'

  // What the user looks at changes: it goes along again.
  useEffect(() => {
    setContextDetached(false)
  }, [contextChip?.label])

  useEffect(() => {
    inputRef.current?.focus()
  }, [state.selectedId])

  useLayoutEffect(() => {
    const input = inputRef.current

    if (input) {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 180)}px`
    }
  }, [text])

  const submit = async (message: string): Promise<void> => {
    const trimmed = message.trim()

    if (!trimmed || sending || working) {
      return
    }

    setSending(true)
    setError(null)

    try {
      await state.send(
        trimmed,
        contextChip && !contextDetached ? contextChip.context : EMPTY_CONTEXT
      )
      setText('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a cominciare.')
    } finally {
      setSending(false)
    }
  }

  return (
    <aside
      aria-label="Segretario"
      className="paper flex h-full min-h-0 w-full min-w-0 flex-col border-l"
    >
      <header
        className={cn(
          'window-drag-region flex h-[52px] shrink-0 items-center gap-2 border-b pl-4',
          atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-2'
        )}
      >
        <PenLine className="text-ai size-4" />
        <h2 className="display-title text-[15px]">Segretario</h2>
        {panelKeys && <ShortcutKeys keys={panelKeys} className="ml-1" />}
        <div className="flex-1" />
        <div className="window-no-drag flex items-center gap-0.5">
          <IconButton
            label="Nuovo lavoro"
            className="text-faint-foreground size-[28px]"
            onClick={() => state.select(null)}
          >
            <Plus className="size-4" />
          </IconButton>
          <IconButton
            label="Chiudi"
            className="text-faint-foreground size-[28px]"
            onClick={onClose}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      </header>

      {state.activities.length > 0 && (
        <nav
          aria-label="Lavori del Segretario"
          className="flex max-h-[152px] shrink-0 flex-col gap-0.5 overflow-y-auto border-b p-2"
        >
          {state.activities.map((activity) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              selected={activity.id === state.selectedId}
              onSelect={() => state.select(activity.id)}
            />
          ))}
        </nav>
      )}

      {!state.status ||
      state.status.keyState === 'missing' ||
      state.status.keyState === 'invalid' ? (
        <SetupNotice problem={state.status?.problem ?? null} onOpenSettings={onOpenSettings} />
      ) : state.selectedId ? (
        <Thread
          state={state}
          onOpen={onOpenHandle}
          onApprove={(approval, approved) =>
            state.selectedId && onApprove(state.selectedId, approval, approved)
          }
          onOpenDraft={onOpenDraft}
        />
      ) : (
        <Introduction
          suggestions={suggestions}
          onSuggest={(suggestion) => void submit(suggestion)}
        />
      )}

      {ready && (
        <div className="shrink-0 p-3 pt-0">
          {state.status?.keyState === 'exhausted' && (
            <p className="text-destructive-soft-foreground mb-2 text-[12px]">
              {state.status.problem}
            </p>
          )}
          {error && <p className="text-destructive-soft-foreground mb-2 text-[12px]">{error}</p>}
          <div className="sheet rounded-[12px] p-2 pb-1.5">
            {contextChip && !contextDetached && (
              <span className="bg-hover text-muted-foreground mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11.5px]">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{contextChip.label}</span>
                <button
                  type="button"
                  aria-label="Non mandare insieme"
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
              placeholder={selected ? 'Rispondi o chiedi altro…' : 'Chiedi o affida un lavoro…'}
              className="placeholder:text-faint-foreground block w-full resize-none bg-transparent px-1 py-1 text-[13px] leading-[1.45] outline-none"
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-faint-foreground px-1 text-[11px]">
                {working
                  ? STATUS_LABEL[selected!.status]
                  : 'Invio per mandare · ⇧ Invio per andare a capo'}
              </span>
              {working ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => selected && state.cancel(selected.id)}
                >
                  <Square className="size-3" />
                  Ferma
                </Button>
              ) : (
                <IconButton
                  label="Manda"
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
