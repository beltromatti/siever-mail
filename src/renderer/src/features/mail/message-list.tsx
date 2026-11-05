/**
 * "Apple" message list: multi-line rows beside a reading pane.
 *
 * Tuned for density: rows are separated by a hairline, unread is a wax dot
 * in a fixed gutter, the attachment is an icon. No avatar — a circle of
 * initials says less than the name beside it and takes the width of three
 * letters of the subject.
 */
import { useMemo } from 'react'

import {
  messageRefKey,
  resolveSelectionIntent,
  summaryToMessageRef
} from '@renderer/lib/message-selection'
import { threadKey } from '@renderer/features/segretario/conversation-projects'
import { hasWorkLine, rowWorkKey, WorkLine } from '@renderer/features/segretario/row-work'
import { cn, formatDateLabel } from '@renderer/lib/utils'
import type { MailMessageSummary } from '@shared/models'

import type { MessageListViewProps } from './message-list-view'
import {
  AccountTag,
  AttachmentMark,
  FlagToggle,
  HighlightedText,
  MessageSectionHeading,
  primaryAddressLabel,
  ProjectTag,
  SavedTag,
  UnreadDot
} from './message-list-shared'
import { MessageListHeader } from './message-list-header'
import { MessageListEmpty } from './message-list-empty'
import { VirtualMessageRows } from './virtual-message-rows'

/** A row as tall as it renders at the default text size; each row is measured. */
const MESSAGE_ROW_HEIGHT_ESTIMATE_PX = 71
const SECTION_HEADING_HEIGHT_PX = 30

export function MessageList(props: MessageListViewProps): React.JSX.Element {
  const {
    messages,
    rowWork,
    sections,
    emptyState,
    selection,
    highlightTerms,
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
            const work = rowWork.get(rowWorkKey(message))
            const projectTag = projectTags?.get(threadKey(message))

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
                draggable
                onDragStart={(event) => onRowDragStart(messageRef, event.dataTransfer)}
                onDragEnd={onRowDragEnd}
                className={cn(
                  'group relative flex cursor-default border-b py-[9px] pr-3 pl-1.5 transition-colors',
                  isSelected ? 'bg-selected' : 'hover:bg-hover',
                  // The cursor is drawn as an edge, never as a fill: a row
                  // can be "current but not selected" after a Ctrl-click
                  // that removed it, and the two states have to look
                  // different.
                  isCursor &&
                    "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:content-['']",
                  isCursor && (isSelected ? 'before:bg-foreground' : 'before:bg-faint-foreground')
                )}
              >
                <UnreadDot unread={!message.isRead} />

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate text-[13px] leading-[18px]',
                        message.isRead ? 'font-medium' : 'font-[650]'
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

                    <span className="text-faint-foreground tabular shrink-0 text-[11.5px]">
                      {formatDateLabel(message.date)}
                    </span>
                  </div>

                  <div className="flex min-w-0 items-center gap-1.5">
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate text-[12.5px] leading-[18px]',
                        message.isRead ? 'text-foreground/80' : 'text-foreground font-[550]'
                      )}
                    >
                      <HighlightedText text={message.subject} terms={highlightTerms.subject} />
                    </p>
                    {projectTag && <ProjectTag label={projectTag} />}
                    {work?.saved && <SavedTag label={work.saved} />}
                    <AttachmentMark present={message.hasAttachments} />
                    <FlagToggle
                      flagged={message.isFlagged}
                      onToggle={() => onToggleFlag(messageRef, !message.isFlagged)}
                    />
                  </div>

                  {work && hasWorkLine(work) ? (
                    <p className="mt-px flex min-w-0 text-[12px] leading-4">
                      <WorkLine work={work} />
                    </p>
                  ) : message.previewHydrated ? (
                    <p className="text-faint-foreground mt-px min-w-0 truncate text-[12px] leading-4">
                      <HighlightedText text={message.preview} terms={highlightTerms.body} />
                    </p>
                  ) : (
                    <p className="text-faint-foreground/60 mt-px min-w-0 truncate text-[12px] leading-4">
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
