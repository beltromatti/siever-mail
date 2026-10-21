/**
 * "Apple" message list: multi-line rows beside a reading pane.
 *
 * Tuned for density — more on screen, fewer big cards: rows are
 * hairline-separated instead of floating cards,
 * the unread state is a dot rather than a badge, and the attachment marker
 * is an icon rather than a labelled chip. Roughly twice the messages fit on
 * screen compared with the previous card list, with no information removed —
 * the attachment marker in particular is now visible at every density, which
 * it was not before.
 */
import { useMemo } from 'react'

import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { initialsFromName } from '@renderer/lib/email'
import {
  messageRefKey,
  resolveSelectionIntent,
  summaryToMessageRef
} from '@renderer/lib/message-selection'
import { cn, formatCount, formatDateLabel } from '@renderer/lib/utils'
import type { MailMessageSummary } from '@shared/models'

import type { MessageListViewProps } from './message-list-view'
import {
  AccountTag,
  AttachmentMark,
  avatarLabel,
  FlagToggle,
  HighlightedText,
  MessageListControls,
  MessageListTitle,
  MessageSectionHeading,
  primaryAddressLabel,
  UnreadDot
} from './message-list-shared'
import { MessageListEmpty } from './message-list-empty'
import { VirtualMessageRows } from './virtual-message-rows'

/** A row as tall as it renders at the default text size; each row is measured. */
const MESSAGE_ROW_HEIGHT_ESTIMATE_PX = 69
const SECTION_HEADING_HEIGHT_PX = 28

export function MessageList({
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

  return (
    // Rows are things to pick, not text to copy: a Shift or Ctrl click
    // selects messages, as in Outlook and Finder, never a run of words
    // across them.
    <div className="glass-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg select-none">
      <header className="border-border/60 flex h-11 shrink-0 items-center justify-between gap-2 border-b px-2.5">
        <div className="min-w-0">
          <MessageListTitle
            title={title}
            searchQuery={searchQuery}
            onClearSearch={onClearSearch}
            className="text-[13px]"
          />
          <p className="text-muted-foreground text-[10px] leading-tight">
            {selectedCount > 1
              ? formatCount(selectedCount, 'selezionata', 'selezionate')
              : countLabel}
          </p>
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
          rowHeightEstimate={MESSAGE_ROW_HEIGHT_ESTIMATE_PX}
          headingHeight={SECTION_HEADING_HEIGHT_PX}
          renderHeading={(section, collapsed, toggleCollapsed) => (
            <MessageSectionHeading
              section={section}
              collapsed={collapsed}
              allSelected={section.messages.every((message) =>
                selectedKeys.has(messageRefKey(summaryToMessageRef(message)))
              )}
              onToggleCollapsed={toggleCollapsed}
              onSelectSection={() => onSelectSection(section)}
            />
          )}
          renderRow={(message: MailMessageSummary) => {
            const messageRef = summaryToMessageRef(message)
            const key = messageRefKey(messageRef)
            const isSelected = selectedKeys.has(key)
            const isCursor = key === cursorKey
            const primaryLabel = primaryAddressLabel(message, primaryAddressMode)
            const accountLabel = accountLabels?.get(message.accountId)

            return (
              <div
                data-message-key={key}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={(event) => onActivateRow(messageRef, resolveSelectionIntent(event))}
                onDoubleClick={() => onOpenRow(messageRef)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onRowContextMenu(messageRef)
                }}
                className={cn(
                  'group border-border/40 relative flex cursor-default gap-2 border-b px-2.5 py-1.5 transition-colors',
                  isSelected ? 'bg-primary/14 hover:bg-primary/18' : 'hover:bg-secondary/45',
                  // The cursor is drawn as an inset ring, never as a fill: a
                  // row can be "current but not selected" after a Ctrl-click
                  // that removed it, and the two states have to look different.
                  isCursor && !isSelected && 'ring-primary/45 ring-1 ring-inset',
                  isCursor && isSelected && 'ring-primary/60 ring-1 ring-inset'
                )}
              >
                <UnreadDot unread={!message.isRead} />

                <Avatar className="border-border/70 mt-0.5 size-7 shrink-0 border">
                  <AvatarFallback className="bg-secondary/80 text-[10px] font-semibold">
                    {initialsFromName(avatarLabel(message, primaryAddressMode))}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate text-[12.5px] leading-5',
                        message.isRead ? 'font-medium' : 'font-bold'
                      )}
                    >
                      <HighlightedText
                        text={primaryLabel}
                        terms={
                          primaryAddressMode === 'sender'
                            ? highlightTerms.sender
                            : highlightTerms.recipients
                        }
                      />
                    </p>

                    {accountLabel && (
                      <AccountTag label={accountLabel} className="max-w-[40%] shrink-0" />
                    )}

                    <span className="text-muted-foreground shrink-0 text-[10.5px] tabular-nums">
                      {formatDateLabel(message.date)}
                    </span>
                  </div>

                  <div className="flex min-w-0 items-center gap-1.5">
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate text-[12px] leading-5',
                        message.isRead ? 'text-foreground/80' : 'text-foreground font-semibold'
                      )}
                    >
                      <HighlightedText text={message.subject} terms={highlightTerms.subject} />
                    </p>
                    <AttachmentMark present={message.hasAttachments} />
                    <FlagToggle
                      flagged={message.isFlagged}
                      onToggle={() => onToggleFlag(messageRef, !message.isFlagged)}
                    />
                  </div>

                  {message.previewHydrated ? (
                    <p className="text-muted-foreground min-w-0 truncate text-[11px] leading-4">
                      <HighlightedText text={message.preview} terms={highlightTerms.body} />
                    </p>
                  ) : (
                    <p className="text-muted-foreground/55 min-w-0 truncate text-[11px] leading-4 italic">
                      Caricamento anteprima…
                    </p>
                  )}
                </div>
              </div>
            )
          }}
        />
      )}
    </div>
  )
}
