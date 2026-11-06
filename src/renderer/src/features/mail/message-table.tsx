/**
 * "Outlook" message table: one line per message, above the reading pane.
 *
 * The layout Outlook users know by name — a dense grid of Da / A / Oggetto
 * / Ricevuto / Dimensione with clickable column headers and collapsible
 * group bands. At the app's default window height it shows around fifteen
 * messages at once.
 *
 * Column headers double as the sort control: clicking one sorts by it and
 * clicking again flips the direction. That is the interaction those users
 * already know, and it makes sorting discoverable without hunting for a
 * menu — the dropdown in the header bar stays for the fields that have no
 * column of their own.
 */
import { useMemo } from 'react'
import { ArrowDown, ArrowUp, Flag, Paperclip } from 'lucide-react'

import {
  messageRefKey,
  resolveSelectionIntent,
  summaryToMessageRef
} from '@renderer/lib/message-selection'
import { hasWorkLine, rowWorkKey, WorkLine } from '@renderer/features/segretario/row-work'
import { cn, formatByteSize, formatDateTimeLabel } from '@renderer/lib/utils'
import {
  defaultSortDirection,
  type MailMessageSummary,
  type MessageListSortField
} from '@shared/models'

import { MESSAGE_TABLE_ROW_HEIGHT_PX } from './message-list-metrics'
import { MessageListEmpty } from './message-list-empty'
import { VirtualMessageRows } from './virtual-message-rows'

import { threadKey } from '@renderer/features/segretario/conversation-projects'

import type { MessageListViewProps } from './message-list-view'
import {
  AccountTag,
  FlagToggle,
  HighlightedText,
  MessageSectionHeading,
  primaryAddressLabel,
  recipientsLabel,
  ProjectTag,
  PecTag,
  SavedTag,
  UnreadDot
} from './message-list-shared'
import { MessageListHeader } from './message-list-header'

/**
 * Grid template shared by the header and every row, so the columns line up
 * without a real `<table>` — which would fight the virtualised scroll area
 * and the sticky group bands.
 */
const TABLE_GRID_TEMPLATE =
  'grid-cols-[0.625rem_1rem_1rem_minmax(7rem,1fr)_minmax(6rem,0.85fr)_minmax(10rem,2fr)_9.5rem_4.25rem]'

interface SortableColumn {
  field: MessageListSortField
  label: string
  align?: 'right'
}

const SECTION_HEADING_HEIGHT_PX = 24

const SORTABLE_COLUMNS: ReadonlyArray<SortableColumn> = [
  { field: 'sender', label: 'Da' },
  { field: 'subject', label: 'Oggetto' },
  { field: 'date', label: 'Ricevuto' },
  { field: 'size', label: 'Dimensione', align: 'right' }
]

export function MessageTable(props: MessageListViewProps): React.JSX.Element {
  const {
    messages,
    rowWork,
    sections,
    emptyState,
    selection,
    highlightTerms,
    sort,
    onSortChange,
    invertVisualOrder,
    primaryAddressMode,
    accountLabels,
    canLoadMoreMessages,
    loadingMoreMessages,
    onLoadMoreMessages,
    revealCursorToken,
    onRowsInView,
    onActivateRow,
    onOpenRow,
    onRowContextMenu,
    onRowDragStart,
    onRowDragEnd,
    onToggleFlag,
    onSelectSection,
    projectTags
  } = props
  const selectedKeys = useMemo(
    () => new Set(selection.selectedRefs.map(messageRefKey)),
    [selection.selectedRefs]
  )
  const cursorKey = selection.cursorRef ? messageRefKey(selection.cursorRef) : null

  const toggleColumnSort = (field: MessageListSortField): void => {
    if (sort.field === field) {
      onSortChange({ field, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
      return
    }

    onSortChange({ field, direction: defaultSortDirection(field) })
  }

  const renderColumnHeader = (column: SortableColumn): React.JSX.Element => {
    const isActive = sort.field === column.field

    return (
      <button
        key={column.field}
        type="button"
        onClick={() => toggleColumnSort(column.field)}
        className={cn(
          'focus-visible:ring-ring/60 hover:text-foreground flex min-w-0 items-center gap-1 rounded-sm px-1 text-left outline-none focus-visible:ring-2',
          column.align === 'right' && 'justify-end',
          isActive ? 'text-foreground font-semibold' : 'text-faint-foreground'
        )}
        aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="truncate">{column.label}</span>
        {isActive &&
          (sort.direction === 'asc' ? (
            <ArrowUp className="size-3 shrink-0" />
          ) : (
            <ArrowDown className="size-3 shrink-0" />
          ))}
      </button>
    )
  }

  return (
    // Rows are things to pick, not text to copy: a Shift or Ctrl click
    // selects messages, as in Outlook and Finder, never a run of words
    // across them.
    <div className="paper flex h-full min-h-0 min-w-0 flex-col overflow-hidden select-none">
      <MessageListHeader
        {...props}
        selectedCount={selection.selectedRefs.length}
        canSelectAll={messages.length > 0}
      />
      {props.banner}

      <div
        className={cn(
          'text-faint-foreground grid h-6 shrink-0 items-center gap-1.5 border-b px-2 text-[10.5px] font-[550]',
          TABLE_GRID_TEMPLATE
        )}
      >
        <span aria-hidden />
        <span className="flex justify-center" title="Allegati">
          <Paperclip className="size-3" />
        </span>
        <span className="flex justify-center" title="Contrassegnate">
          <Flag className="size-3" />
        </span>
        {renderColumnHeader(SORTABLE_COLUMNS[0])}
        {/* In Tutti gli account the account a message came to says more than its
            recipients, which are mostly that same account. */}
        <span className="px-1">{accountLabels ? 'Account' : 'A'}</span>
        {renderColumnHeader(SORTABLE_COLUMNS[1])}
        {renderColumnHeader(SORTABLE_COLUMNS[2])}
        {renderColumnHeader(SORTABLE_COLUMNS[3])}
      </div>

      {messages.length === 0 && emptyState ? (
        <MessageListEmpty state={emptyState} />
      ) : (
        <VirtualMessageRows
          sections={sections}
          invert={invertVisualOrder}
          cursorKey={cursorKey}
          revealCursorToken={revealCursorToken}
          canLoadMore={canLoadMoreMessages}
          loadingMore={loadingMoreMessages}
          onLoadMore={onLoadMoreMessages}
          onRowsInView={onRowsInView}
          rowHeightEstimate={MESSAGE_TABLE_ROW_HEIGHT_PX}
          headingHeight={SECTION_HEADING_HEIGHT_PX}
          renderHeading={(section, collapsed, toggleCollapsed) => (
            <MessageSectionHeading
              section={section}
              collapsed={collapsed}
              allSelected={section.messages.every((message) =>
                selectedKeys.has(messageRefKey(summaryToMessageRef(message)))
              )}
              dense
              onToggleCollapsed={toggleCollapsed}
              onSelectSection={() => onSelectSection(section)}
            />
          )}
          renderRow={(message: MailMessageSummary) => {
            const messageRef = summaryToMessageRef(message)
            const key = messageRefKey(messageRef)
            const isSelected = selectedKeys.has(key)
            const isCursor = key === cursorKey
            const work = rowWork.get(rowWorkKey(message))

            return (
              <div
                data-message-key={key}
                role="row"
                aria-selected={isSelected}
                onClick={(event) => onActivateRow(messageRef, resolveSelectionIntent(event))}
                onDoubleClick={() => onOpenRow(messageRef)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onRowContextMenu(messageRef)
                }}
                draggable
                onDragStart={(event) => onRowDragStart(messageRef, event.dataTransfer)}
                onDragEnd={onRowDragEnd}
                style={{ height: MESSAGE_TABLE_ROW_HEIGHT_PX }}
                className={cn(
                  'group border-border/60 relative grid cursor-default items-center gap-1.5 border-b px-2 text-[12px] transition-colors',
                  TABLE_GRID_TEMPLATE,
                  isSelected ? 'bg-selected' : 'hover:bg-hover',
                  isCursor &&
                    "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:content-['']",
                  isCursor && (isSelected ? 'before:bg-foreground' : 'before:bg-faint-foreground'),
                  !message.isRead && !isSelected && 'text-foreground'
                )}
              >
                <UnreadDot unread={!message.isRead} />

                <span className="flex justify-center">
                  {message.hasAttachments && <Paperclip className="text-faint-foreground size-3" />}
                </span>

                <span className="flex justify-center">
                  <FlagToggle
                    flagged={message.isFlagged}
                    onToggle={() => onToggleFlag(messageRef, !message.isFlagged)}
                  />
                </span>

                <span
                  className={cn(
                    'min-w-0 truncate px-1',
                    message.isRead ? 'font-normal' : 'font-[650]'
                  )}
                  title={primaryAddressLabel(message, primaryAddressMode)}
                >
                  <HighlightedText
                    text={primaryAddressLabel(message, primaryAddressMode)}
                    terms={
                      primaryAddressMode === 'sender'
                        ? highlightTerms.sender
                        : highlightTerms.recipients
                    }
                  />
                </span>

                {accountLabels ? (
                  <span className="min-w-0 px-1">
                    <AccountTag label={accountLabels.get(message.accountId) ?? ''} />
                  </span>
                ) : (
                  <span
                    className="text-muted-foreground min-w-0 truncate px-1"
                    title={recipientsLabel(message)}
                  >
                    <HighlightedText
                      text={recipientsLabel(message)}
                      terms={highlightTerms.recipients}
                    />
                  </span>
                )}

                <span className="flex min-w-0 items-baseline gap-2 px-1">
                  <span
                    className={cn(
                      'min-w-0 shrink truncate',
                      message.isRead ? 'text-foreground/85' : 'font-[600]'
                    )}
                    title={message.subject}
                  >
                    <HighlightedText text={message.subject} terms={highlightTerms.subject} />
                  </span>
                  {projectTags?.get(threadKey(message)) && (
                    <ProjectTag label={projectTags.get(threadKey(message)) ?? ''} />
                  )}
                  {message.pec && <PecTag pec={message.pec} />}
                  {work?.saved && <SavedTag label={work.saved} />}
                  {/* The Segretario's word, after the subject, where the table has room. */}
                  {work && hasWorkLine(work) && (
                    <WorkLine work={work} className="flex-1 basis-0 text-[11.5px]" />
                  )}
                </span>

                <span
                  className={cn(
                    'truncate px-1 text-[11px] tabular-nums',
                    message.isRead ? 'text-faint-foreground' : 'text-foreground/90'
                  )}
                >
                  {formatDateTimeLabel(message.date)}
                </span>

                <span className="text-faint-foreground truncate px-1 text-right text-[11px] tabular-nums">
                  {formatByteSize(message.size)}
                </span>
              </div>
            )
          }}
        />
      )}
    </div>
  )
}
