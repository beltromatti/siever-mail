/**
 * Pieces shared by the two message-list shells.
 *
 * `MessageList` (the "apple" layout) renders multi-line rows next to a
 * reading pane; `MessageTable` (the "outlook" layout) renders a dense
 * single-line grid above one. They are genuinely different markup, but the
 * vocabulary below — how an unread row is marked, how a flag toggles, what a
 * section heading looks like, how a search hit is highlighted — has to read
 * identically in both, otherwise the two layouts stop feeling like the same
 * product.
 */
import { Fragment, useMemo } from 'react'
import { ChevronDown, ChevronRight, Flag, Paperclip } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn, formatCount } from '@renderer/lib/utils'
import type { MessageSection } from '@renderer/lib/message-sections'
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpDown,
  Calendar,
  Check,
  HardDrive,
  Layers,
  Tag,
  User,
  X
} from 'lucide-react'
import {
  defaultSortDirection,
  type MailMessageListSort,
  type MailMessageSummary,
  type MessageGroupingMode,
  type MessageListSortDirection,
  type MessageListSortField,
  type PecMessage
} from '@shared/models'
import { isPecFailure, pecLabel } from '@shared/pec'
import { findHighlightRanges, type SearchHighlightField } from '@shared/search'

/**
 * Search terms to paint, per field. Scoped queries (`da:rossi`) only
 * highlight the field they matched on, so a row never shows a highlight in
 * text that had nothing to do with why it was returned.
 */
export interface MessageHighlightTerms {
  sender: readonly string[]
  recipients: readonly string[]
  subject: readonly string[]
  body: readonly string[]
}

export const EMPTY_MESSAGE_HIGHLIGHT_TERMS: MessageHighlightTerms = {
  sender: [],
  recipients: [],
  subject: [],
  body: []
}

export function highlightTermsFor(
  terms: MessageHighlightTerms,
  field: SearchHighlightField
): readonly string[] {
  return terms[field === 'body' ? 'body' : field]
}

export function HighlightedText({
  text,
  terms
}: {
  text: string
  terms: readonly string[]
}): React.JSX.Element {
  const ranges = useMemo(() => findHighlightRanges(text, terms), [terms, text])

  if (ranges.length === 0) {
    return <>{text}</>
  }

  const segments: React.ReactNode[] = []
  let cursor = 0

  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      segments.push(<Fragment key={`pre-${index}`}>{text.slice(cursor, range.start)}</Fragment>)
    }

    segments.push(
      <mark key={`hit-${index}`} className="bg-warning/25 text-foreground rounded-[2px] px-px">
        {text.slice(range.start, range.end)}
      </mark>
    )
    cursor = range.end
  })

  if (cursor < text.length) {
    segments.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>)
  }

  return <>{segments}</>
}

/**
 * Unread marker. A dot, not a pill: at fifteen rows on screen a row of
 * "NUOVA" badges is noise, while a 6px dot in a fixed gutter reads as a
 * single scannable column.
 */
export function UnreadDot({ unread }: { unread: boolean }): React.JSX.Element {
  return (
    <span className="flex w-3.5 shrink-0 justify-center pt-[6px]" aria-hidden={!unread}>
      {unread && <span className="bg-unread size-[7px] rounded-full" />}
      {unread && <span className="sr-only">Non letta</span>}
    </span>
  )
}

/**
 * The IMAP `\Flagged` toggle. Always occupies its slot so rows never
 * reflow; the outline only appears on hover or focus when the message is
 * not flagged, which keeps an unflagged list quiet.
 */
export function FlagToggle({
  flagged,
  onToggle,
  className
}: {
  flagged: boolean
  onToggle: () => void
  className?: string
}): React.JSX.Element {
  const label = flagged ? 'Rimuovi contrassegno' : 'Contrassegna messaggio'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={flagged}
          aria-label={label}
          onClick={(event) => {
            // The row underneath owns click-to-select; a flag toggle must not
            // also move the selection.
            event.stopPropagation()
            onToggle()
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-sm transition-opacity',
            'focus-visible:ring-ring/70 outline-none focus-visible:opacity-100 focus-visible:ring-2',
            flagged
              ? 'text-flagged opacity-100'
              : 'text-faint-foreground hover:text-foreground opacity-0 group-hover:opacity-100',
            className
          )}
        >
          <Flag className={cn('size-3.5', flagged && 'fill-current')} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** The projects of a conversation, on its row: the first by its code or short name, and how many more. */
export function ProjectTag({
  label,
  className
}: {
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'text-primary-text bg-primary/[0.07] inline-block max-w-[40%] shrink-0 truncate rounded-[4px] px-1 align-middle text-[10.5px] leading-4 font-semibold shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22)]',
        className
      )}
      title={label}
    >
      {label}
    </span>
  )
}

/** A copy of the message saved outside the mail by an extension, on its row, by its label. */
export function SavedTag({ label }: { label: string }): React.JSX.Element {
  return (
    <span
      className="text-muted-foreground bg-hover inline-block max-w-[40%] shrink-0 truncate rounded-[4px] px-1 align-middle text-[10.5px] leading-4 font-semibold shadow-[inset_0_0_0_1px_hsl(var(--border))]"
      title={label}
    >
      {label}
    </span>
  )
}

/**
 * What a certified message (PEC) is, on its row: "PEC" for one the
 * provider carried; for a receipt, what it says of the message sent —
 * "Consegnata", "Non consegnata", in red when it went wrong.
 */
export function PecTag({ pec }: { pec: PecMessage }): React.JSX.Element {
  const label = pecLabel(pec.kind)

  return (
    <span
      className={cn(
        'inline-block max-w-[40%] shrink-0 truncate rounded-[4px] px-1 align-middle text-[10.5px] leading-4 font-semibold',
        isPecFailure(pec.kind)
          ? 'text-destructive-soft-foreground bg-destructive/10 shadow-[inset_0_0_0_1px_hsl(var(--destructive)/0.3)]'
          : pec.kind === 'anomalia'
            ? 'text-warning bg-warning/10 shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.3)]'
            : 'text-muted-foreground bg-hover shadow-[inset_0_0_0_1px_hsl(var(--border))]'
      )}
      title={
        pec.kind === 'busta'
          ? 'Posta certificata'
          : pec.kind === 'anomalia'
            ? 'Posta certificata · anomalia: il gestore non ha potuto certificarlo'
            : `Ricevuta PEC · ${label}`
      }
    >
      {label}
    </span>
  )
}

/**
 * The account a message came to, on the rows of Tutti gli account. As quiet as the date
 * beside it, but always there: it is the account a reply or a move acts on.
 */
export function AccountTag({
  label,
  className
}: {
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'bg-hover text-muted-foreground inline-block max-w-full truncate rounded-[4px] px-1 align-middle text-[10.5px] leading-4 font-medium shadow-[inset_0_0_0_1px_hsl(var(--border))]',
        className
      )}
      title={label}
    >
      {label}
    </span>
  )
}

export function AttachmentMark({ present }: { present: boolean }): React.JSX.Element {
  return (
    <span className="flex w-4 shrink-0 justify-center" aria-hidden={!present}>
      {present && <Paperclip className="text-faint-foreground size-3.5" />}
      {present && <span className="sr-only">Contiene allegati</span>}
    </span>
  )
}

/**
 * Heading above a run of rows. Clicking it selects the whole run — that is
 * the point of grouping when filing mail: gather everything from one
 * sender, then act on the lot in a single pass.
 */
export function MessageSectionHeading({
  section,
  collapsed,
  allSelected,
  onToggleCollapsed,
  onSelectSection,
  dense
}: {
  section: MessageSection
  collapsed: boolean
  allSelected: boolean
  onToggleCollapsed: () => void
  onSelectSection: () => void
  dense?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'list-section-heading flex items-center gap-1.5 border-b px-1.5',
        dense ? 'h-6' : 'h-[30px]'
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Espandi ${section.label}` : `Comprimi ${section.label}`}
            className="text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
          >
            {collapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {collapsed ? `Espandi ${section.label}` : `Comprimi ${section.label}`}
        </TooltipContent>
      </Tooltip>

      <button
        type="button"
        onClick={onSelectSection}
        aria-label={`Seleziona tutti i messaggi di ${section.label}`}
        className="focus-visible:ring-ring/70 flex min-w-0 flex-1 items-baseline gap-2 rounded-sm text-left outline-none focus-visible:ring-2"
      >
        <span
          className={cn(
            'truncate text-[11px] font-[650]',
            // Date buckets ("Oggi", "Questa settimana") suit small caps.
            // Names do not: "MARIO ROSSI" shouts, and the sender's own
            // capitalisation carries information.
            section.kind === 'date' ? 'tracking-[0.06em] uppercase' : 'tracking-normal',
            allSelected ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {section.label}
        </span>
        <span className="text-faint-foreground tabular shrink-0 text-[10.5px]">
          {section.messages.length}
          {section.unreadCount > 0
            ? ` · ${formatCount(section.unreadCount, 'non letto', 'non letti')}`
            : ''}
        </span>
      </button>
    </div>
  )
}

/* ───────────────────────── list header controls ───────────────────────── */

/**
 * The list's title — or, while a search is active, what is being searched
 * for and the way out of it. A search left running is the most convincing
 * way for mail to look as if it stopped arriving, so the query stays in
 * sight above its results, one click or Esc from gone.
 */
export function MessageListTitle({
  title,
  searchQuery,
  onClearSearch,
  className
}: {
  title: string
  searchQuery: string
  onClearSearch: () => void
  className?: string
}): React.JSX.Element {
  if (!searchQuery) {
    return <h2 className={cn('truncate font-semibold', className)}>{title}</h2>
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <h2 className={cn('min-w-0 truncate font-semibold', className)} title={searchQuery}>
        Risultati per <span className="text-muted-foreground">«{searchQuery}»</span>
      </h2>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClearSearch}
            aria-label="Esci dalla ricerca"
            className="window-no-drag text-faint-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] transition-colors outline-none focus-visible:ring-2"
          >
            <X className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Esci dalla ricerca (Esc)</TooltipContent>
      </Tooltip>
    </div>
  )
}

interface SortFieldOption {
  field: MessageListSortField
  label: string
  icon: typeof Calendar
  ascLabel: string
  descLabel: string
}

export const SORT_FIELD_OPTIONS: readonly SortFieldOption[] = [
  {
    field: 'date',
    label: 'Data',
    icon: Calendar,
    descLabel: 'Più recenti prima',
    ascLabel: 'Più vecchie prima'
  },
  { field: 'sender', label: 'Mittente', icon: User, descLabel: 'Z → A', ascLabel: 'A → Z' },
  { field: 'subject', label: 'Oggetto', icon: Tag, descLabel: 'Z → A', ascLabel: 'A → Z' },
  {
    field: 'size',
    label: 'Dimensione',
    icon: HardDrive,
    descLabel: 'Più grandi prima',
    ascLabel: 'Più piccole prima'
  }
]

export const GROUPING_OPTIONS: ReadonlyArray<{
  mode: MessageGroupingMode
  label: string
  hint: string
}> = [
  { mode: 'auto', label: 'Automatico', hint: "Segue l'ordinamento" },
  { mode: 'sender', label: 'Mittente', hint: 'Una sezione per mittente' },
  { mode: 'none', label: 'Nessuno', hint: 'Elenco continuo' }
]

export interface MessageListControlsProps {
  sort: MailMessageListSort
  onSortChange: (next: MailMessageListSort) => void
  grouping: MessageGroupingMode
  onGroupingChange: (next: MessageGroupingMode) => void
  /** Number of rows currently selected; drives the clear affordance. */
  selectedCount: number
  onClearSelection: () => void
  onSelectAll: () => void
  canSelectAll: boolean
}

export function MessageListControls({
  sort,
  onSortChange,
  grouping,
  onGroupingChange,
  selectedCount,
  onClearSelection,
  onSelectAll,
  canSelectAll
}: MessageListControlsProps): React.JSX.Element {
  const activeSortOption =
    SORT_FIELD_OPTIONS.find((option) => option.field === sort.field) ?? SORT_FIELD_OPTIONS[0]
  const activeDirectionLabel =
    sort.direction === 'asc' ? activeSortOption.ascLabel : activeSortOption.descLabel
  const activeGroupingOption =
    GROUPING_OPTIONS.find((option) => option.mode === grouping) ?? GROUPING_OPTIONS[0]

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {selectedCount > 1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-faint-foreground hover:text-foreground size-7"
              onClick={onClearSelection}
              aria-label="Annulla selezione"
            >
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Annulla selezione</TooltipContent>
        </Tooltip>
      )}

      {canSelectAll && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-faint-foreground hover:text-foreground size-7"
              onClick={onSelectAll}
              aria-label="Seleziona tutti i messaggi"
            >
              <Check className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Seleziona tutto ({'⌘/Ctrl'} + A)</TooltipContent>
        </Tooltip>
      )}

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'size-7',
                  grouping === 'none' ? 'text-faint-foreground' : 'text-foreground'
                )}
                aria-label={`Raggruppamento: ${activeGroupingOption.label}`}
              >
                <Layers className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{`Raggruppa: ${activeGroupingOption.label}`}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Raggruppa per</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={grouping}
            onValueChange={(next) => onGroupingChange(next as MessageGroupingMode)}
          >
            {GROUPING_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.mode} value={option.mode} className="gap-2">
                <span className="flex flex-col">
                  <span>{option.label}</span>
                  <span className="text-muted-foreground text-[10px]">{option.hint}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-faint-foreground hover:text-foreground size-7"
                aria-label={`Ordinamento: ${activeSortOption.label} · ${activeDirectionLabel}`}
              >
                <ArrowUpDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{`Ordina: ${activeSortOption.label} · ${activeDirectionLabel}`}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Ordina per</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort.field}
            onValueChange={(nextField) =>
              onSortChange({
                field: nextField as MessageListSortField,
                direction: defaultSortDirection(nextField as MessageListSortField)
              })
            }
          >
            {SORT_FIELD_OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <DropdownMenuRadioItem key={option.field} value={option.field} className="gap-2">
                  <Icon className="size-3.5" />
                  {option.label}
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Direzione</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort.direction}
            onValueChange={(nextDirection) =>
              onSortChange({
                field: sort.field,
                direction: nextDirection as MessageListSortDirection
              })
            }
          >
            <DropdownMenuRadioItem value="desc" className="gap-2">
              <ArrowDownWideNarrow className="size-3.5" />
              {activeSortOption.descLabel}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="asc" className="gap-2">
              <ArrowDownAZ className="size-3.5" />
              {activeSortOption.ascLabel}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/* ───────────────────────── shared row helpers ───────────────────────── */

/**
 * Who the row is "about". Sent and Drafts are about the recipient — showing
 * your own name on every line there wastes the most valuable column.
 */
export type PrimaryAddressMode = 'sender' | 'recipient'

export function primaryAddressLabel(message: MailMessageSummary, mode: PrimaryAddressMode): string {
  if (mode === 'recipient') {
    return message.to.length + message.cc.length > 0
      ? recipientsLabel(message)
      : 'Nessun destinatario'
  }

  return message.senderLabel || 'Mittente sconosciuto'
}

/**
 * Who a row's avatar stands for: the sender, or — where rows are about the
 * recipient — the first person the message went to. Never the "+3" that
 * follows them in the label.
 */
export function avatarLabel(message: MailMessageSummary, mode: PrimaryAddressMode): string {
  if (mode === 'recipient') {
    const first = message.to[0] ?? message.cc[0]
    return first ? first.name?.trim() || first.address : '?'
  }

  return message.senderLabel
}

/**
 * The "A" column: the first person the message names and how many others it
 * reached. Copies count — a message sent to one person with four hundred in
 * Cc is not a message to one person.
 */
export function recipientsLabel(message: MailMessageSummary): string {
  const recipients = [...message.to, ...message.cc]

  if (recipients.length === 0) {
    return '—'
  }

  const first = recipients[0]
  const label = first.name?.trim() || first.address

  return recipients.length > 1 ? `${label} +${recipients.length - 1}` : label
}
