/**
 * "Outlook" message table: one line per message, above the reading pane.
 *
 * Built from the layout the SIEVER team asked for by name — a dense grid of
 * Da / A / Oggetto / Ricevuto / Dimensione with clickable column headers and
 * collapsible group bands. At the app's default window height it shows
 * around fifteen messages at once, which was the explicit requirement.
 *
 * Column headers double as the sort control: clicking one sorts by it and
 * clicking again flips the direction. That is the interaction the team
 * already knows, and it makes sorting discoverable without hunting for a
 * menu — the dropdown in the header bar stays for the fields that have no
 * column of their own.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Flag, Paperclip } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Spinner } from '@renderer/components/ui/spinner'
import {
  messageRefKey,
  resolveSelectionIntent,
  summaryToMessageRef
} from '@renderer/lib/message-selection'
import { cn, formatByteSize, formatDateTimeLabel } from '@renderer/lib/utils'
import { MESSAGE_LIST_PAGE_SIZE, type MessageListSortField } from '@shared/models'

import type { MessageListViewProps } from './message-list-view'
import {
  FlagToggle,
  HighlightedText,
  MessageListControls,
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

const SORTABLE_COLUMNS: ReadonlyArray<SortableColumn> = [
  { field: 'sender', label: 'Da' },
  { field: 'subject', label: 'Oggetto' },
  { field: 'date', label: 'Ricevuto' },
  { field: 'size', label: 'Dimensione', align: 'right' }
]

export function MessageTable({
  title,
  messages,
  sections,
  totalCount,
  selection,
  highlightTerms,
  sort,
  onSortChange,
  grouping,
  onGroupingChange,
  invertVisualOrder,
  primaryAddressMode,
  canLoadMoreMessages,
  loadingMoreMessages,
  onLoadMoreMessages,
  onActivateRow,
  onOpenRow,
  onToggleFlag,
  onSelectSection,
  onSelectAll,
  onClearSelection
}: MessageListViewProps): React.JSX.Element {
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const scrollRootRef = useRef<HTMLDivElement | null>(null)

  const selectedKeys = useMemo(
    () => new Set(selection.selectedRefs.map(messageRefKey)),
    [selection.selectedRefs]
  )
  const cursorKey = selection.cursorRef ? messageRefKey(selection.cursorRef) : null

  const renderedSections = useMemo(
    () => (invertVisualOrder ? [...sections].reverse() : sections),
    [invertVisualOrder, sections]
  )

  useEffect(() => {
    if (!cursorKey) {
      return
    }

    scrollRootRef.current
      ?.querySelector(`[data-message-key="${CSS.escape(cursorKey)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursorKey])

  const selectedCount = selection.selectedRefs.length
  const resultsLabel =
    totalCount > messages.length ? `${messages.length} di ${totalCount}` : `${messages.length}`

  const toggleColumnSort = (field: MessageListSortField): void => {
    if (sort.field === field) {
      onSortChange({ field, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
      return
    }

    // First click on a new column picks the direction people actually expect
    // from it: newest and largest first, but names alphabetically.
    onSortChange({ field, direction: field === 'date' || field === 'size' ? 'desc' : 'asc' })
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
    <div className="glass-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg">
      <header className="border-border/60 flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-[12px] font-semibold">{title}</h2>
          <span className="text-muted-foreground shrink-0 text-[10px]">
            {selectedCount > 1 ? `${selectedCount} selezionate` : `${resultsLabel} messaggi`}
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
          'border-border/60 text-muted-foreground grid shrink-0 items-center gap-1.5 border-b px-2 py-1 text-[10px] tracking-[0.04em] uppercase',
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
        <span className="px-1">A</span>
        {renderColumnHeader(SORTABLE_COLUMNS[1])}
        {renderColumnHeader(SORTABLE_COLUMNS[2])}
        {renderColumnHeader(SORTABLE_COLUMNS[3])}
      </div>

      <ScrollArea ref={scrollRootRef} className="min-h-0 min-w-0 flex-1">
        <div className={cn('flex min-w-0 flex-col', invertVisualOrder && 'flex-col-reverse')}>
          {renderedSections.map((section) => {
            const collapsed = collapsedSectionKeys.has(section.key)
            const sectionRefs = section.messages.map(summaryToMessageRef)
            const allSelected =
              sectionRefs.length > 0 &&
              sectionRefs.every((ref) => selectedKeys.has(messageRefKey(ref)))
            const sectionMessages = invertVisualOrder
              ? [...section.messages].reverse()
              : section.messages

            return (
              <section key={section.key} className="min-w-0">
                {section.label && (
                  <MessageSectionHeading
                    section={section}
                    collapsed={collapsed}
                    allSelected={allSelected}
                    uppercaseLabel={grouping === 'date'}
                    dense
                    onToggleCollapsed={() =>
                      setCollapsedSectionKeys((current) => {
                        const next = new Set(current)

                        if (next.has(section.key)) {
                          next.delete(section.key)
                        } else {
                          next.add(section.key)
                        }

                        return next
                      })
                    }
                    onSelectSection={() => onSelectSection(section)}
                  />
                )}

                {!collapsed &&
                  sectionMessages.map((message) => {
                    const messageRef = summaryToMessageRef(message)
                    const key = messageRefKey(messageRef)
                    const isSelected = selectedKeys.has(key)
                    const isCursor = key === cursorKey

                    return (
                      <div
                        key={key}
                        data-message-key={key}
                        role="row"
                        aria-selected={isSelected}
                        onClick={(event) =>
                          onActivateRow(messageRef, resolveSelectionIntent(event))
                        }
                        onDoubleClick={() => onOpenRow(messageRef)}
                        className={cn(
                          'group border-border/25 grid h-[26px] cursor-default items-center gap-1.5 border-b px-2 text-[11.5px] transition-colors',
                          TABLE_GRID_TEMPLATE,
                          isSelected
                            ? 'bg-primary/16 hover:bg-primary/20'
                            : 'hover:bg-secondary/40',
                          isCursor && 'ring-primary/55 ring-1 ring-inset',
                          !message.isRead && !isSelected && 'text-foreground'
                        )}
                      >
                        <UnreadDot unread={!message.isRead} />

                        <span className="flex justify-center">
                          {message.hasAttachments && (
                            <Paperclip className="text-muted-foreground size-3" />
                          )}
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

                        <span
                          className="text-muted-foreground min-w-0 truncate px-1"
                          title={recipientsLabel(message)}
                        >
                          <HighlightedText
                            text={recipientsLabel(message)}
                            terms={highlightTerms.recipients}
                          />
                        </span>

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
                  })}
              </section>
            )
          })}

          {canLoadMoreMessages && (
            <div className="p-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full text-[11px]"
                disabled={loadingMoreMessages}
                onClick={onLoadMoreMessages}
              >
                {loadingMoreMessages ? (
                  <>
                    <Spinner className="size-3.5" /> Caricamento…
                  </>
                ) : (
                  `Carica altre ${MESSAGE_LIST_PAGE_SIZE} email`
                )}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
