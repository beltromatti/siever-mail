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
import { cn, formatByteSize, formatCount, formatDateTimeLabel } from '@renderer/lib/utils'
import {
  defaultSortDirection,
  type MailMessageSummary,
  type MessageListSortField
} from '@shared/models'

import { MESSAGE_TABLE_ROW_HEIGHT_PX } from './message-list-metrics'
import { MessageListEmpty } from './message-list-empty'
import { VirtualMessageRows } from './virtual-message-rows'

import type { MessageListViewProps } from './message-list-view'
import {
  AccountTag,
  FlagToggle,
  HighlightedText,
  MessageListControls,
  MessageListTitle,
  MessageSectionHeading,
  primaryAddressLabel,
  recipientsLabel,
  UnreadDot
} from './message-list-shared'

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

export function MessageTable({
  title,
  searchQuery,
  onClearSearch,
  messages,
  sections,
  countLabel,
  emptyState,
  selection,
  highlightTerms,
  sort,
  onSortChange,
  grouping,
  onGroupingChange,
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
  onSelectAll,
  onClearSelection
}: MessageListViewProps): React.JSX.Element {
  const selectedKeys = useMemo(
    () => new Set(selection.selectedRefs.map(messageRefKey)),
    [selection.selectedRefs]
  )
  const cursorKey = selection.cursorRef ? messageRefKey(selection.cursorRef) : null

  const selectedCount = selection.selectedRefs.length

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
          'focus-visible:ring-ring/70 hover:text-foreground flex min-w-0 items-center gap-1 rounded-sm px-1 text-left outline-none focus-visible:ring-2',
          column.align === 'right' && 'justify-end',
          isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'
        )}
        aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="truncate">{column.label}</span>
        {isActive &&
          (sort.direction === 'asc' ? (
            <ArrowUp className="text-primary size-3 shrink-0" />
          ) : (
            <ArrowDown className="text-primary size-3 shrink-0" />
          ))}
      </button>
    )
  }

  return (
    // Rows are things to pick, not text to copy: a Shift or Ctrl click
    // selects messages, as in Outlook and Finder, never a run of words
    // across them.
    <div className="glass-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg select-none">
      <header className="border-border/60 flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <MessageListTitle
            title={title}
            searchQuery={searchQuery}
            onClearSearch={onClearSearch}
            className="text-[12px]"
          />
          <span className="text-muted-foreground shrink-0 text-[10px]">
            {selectedCount > 1
              ? formatCount(selectedCount, 'selezionata', 'selezionate')
              : countLabel}
          </span>
        </div>

        <MessageListControls
          sort={sort}
          onSortChange={onSortChange}
          grouping={grouping}
          onGroupingChange={onGroupingChange}
          selectedCount={selectedCount}
          onClearSelection={onClearSelection}
          onSelectAll={onSelectAll}
          canSelectAll={messages.length > 0}
        />
      </header>

      <div
        className={cn(
          'border-border/60 text-muted-foreground grid shrink-0 items-center gap-1.5 border-b px-2 py-1 text-[10px]',
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
                  'group border-border/25 grid cursor-default items-center gap-1.5 border-b px-2 text-[11.5px] transition-colors',
                  TABLE_GRID_TEMPLATE,
                  isSelected ? 'bg-primary/16 hover:bg-primary/20' : 'hover:bg-secondary/40',
                  isCursor && 'ring-primary/55 ring-1 ring-inset',
                  !message.isRead && !isSelected && 'text-foreground'
                )}
              >
                <UnreadDot unread={!message.isRead} />

                <span className="flex justify-center">
                  {message.hasAttachments && <Paperclip className="text-muted-foreground size-3" />}
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
                    message.isRead ? 'font-normal' : 'font-bold'
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

                <span
                  className={cn(
                    'min-w-0 truncate px-1',
                    message.isRead ? 'text-foreground/85' : 'font-semibold'
                  )}
                  title={message.subject}
                >
                  <HighlightedText text={message.subject} terms={highlightTerms.subject} />
                </span>

                <span
                  className={cn(
                    'truncate px-1 text-[10.5px] tabular-nums',
                    message.isRead ? 'text-muted-foreground' : 'text-foreground/90'
                  )}
                >
                  {formatDateTimeLabel(message.date)}
                </span>

                <span className="text-muted-foreground truncate px-1 text-right text-[10.5px] tabular-nums">
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
