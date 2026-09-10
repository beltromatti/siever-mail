/**
 * "Apple" message list: multi-line rows beside a reading pane.
 *
 * Tuned for density after the SIEVER review asked for "più roba a schermo,
 * meno card grandi": rows are hairline-separated instead of floating cards,
 * the unread state is a dot rather than a badge, and the attachment marker
 * is an icon rather than a labelled chip. Roughly twice the messages fit on
 * screen compared with the previous card list, with no information removed —
 * the attachment marker in particular is now visible at every density, which
 * it was not before.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Spinner } from '@renderer/components/ui/spinner'
import { initialsFromName } from '@renderer/lib/email'
import { messageRefKey, summaryToMessageRef } from '@renderer/lib/message-selection'
import { cn, formatDateLabel } from '@renderer/lib/utils'
import { MESSAGE_LIST_PAGE_SIZE } from '@shared/models'

import type { MessageListViewProps } from './message-list-view'
import {
  AttachmentMark,
  FlagToggle,
  HighlightedText,
  MessageListControls,
  MessageSectionHeading,
  primaryAddressLabel,
  UnreadDot
} from './message-list-shared'
import { resolveSelectionIntent } from '@renderer/lib/message-selection'

export function MessageList({
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
  const lastScrollTopRef = useRef(0)
  const previousInvertRef = useRef(invertVisualOrder)

  const selectedKeys = useMemo(
    () => new Set(selection.selectedRefs.map(messageRefKey)),
    [selection.selectedRefs]
  )
  const cursorKey = selection.cursorRef ? messageRefKey(selection.cursorRef) : null

  const renderedSections = useMemo(
    () => (invertVisualOrder ? [...sections].reverse() : sections),
    [invertVisualOrder, sections]
  )

  function findViewport(): HTMLElement | null {
    return (
      scrollRootRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]') ?? null
    )
  }

  // Track the scroll position so the mirror below knows where the user was
  // *before* the direction flip — reading it afterwards is too late, Chromium
  // has already adjusted for the new flow direction.
  useEffect(() => {
    const viewport = findViewport()

    if (!viewport) {
      return
    }

    const onScroll = (): void => {
      lastScrollTopRef.current = viewport.scrollTop
    }

    lastScrollTopRef.current = viewport.scrollTop
    viewport.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      viewport.removeEventListener('scroll', onScroll)
    }
  }, [])

  // Mirror the scroll position when the inversion preference flips, so the
  // same messages stay in view across the swap.
  useLayoutEffect(() => {
    if (previousInvertRef.current === invertVisualOrder) {
      return
    }

    previousInvertRef.current = invertVisualOrder
    const viewport = findViewport()

    if (!viewport) {
      return
    }

    const { scrollHeight, clientHeight } = viewport

    if (scrollHeight <= clientHeight) {
      return
    }

    const maxScrollTop = scrollHeight - clientHeight
    const mirrored = Math.min(maxScrollTop, Math.max(0, maxScrollTop - lastScrollTopRef.current))
    viewport.scrollTop = mirrored
    lastScrollTopRef.current = mirrored
  }, [invertVisualOrder])

  // Keep the keyboard cursor on screen while arrowing through a long folder.
  useEffect(() => {
    if (!cursorKey) {
      return
    }

    scrollRootRef.current
      ?.querySelector(`[data-message-key="${CSS.escape(cursorKey)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursorKey])

  const resultsLabel =
    totalCount > messages.length ? `${messages.length} di ${totalCount}` : `${messages.length}`
  const selectedCount = selection.selectedRefs.length

  return (
    <div className="glass-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg">
      <header className="border-border/60 flex h-11 shrink-0 items-center justify-between gap-2 border-b px-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold">{title}</h2>
          <p className="text-muted-foreground text-[10px] leading-tight">
            {selectedCount > 1 ? `${selectedCount} selezionate` : `${resultsLabel} messaggi`}
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
                    const primaryLabel = primaryAddressLabel(message, primaryAddressMode)

                    return (
                      <div
                        key={key}
                        data-message-key={key}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={-1}
                        onClick={(event) =>
                          onActivateRow(messageRef, resolveSelectionIntent(event))
                        }
                        onDoubleClick={() => onOpenRow(messageRef)}
                        className={cn(
                          'group border-border/40 relative flex cursor-default gap-2 border-b px-2.5 py-1.5 transition-colors',
                          isSelected
                            ? 'bg-primary/14 hover:bg-primary/18'
                            : 'hover:bg-secondary/45',
                          // The cursor is drawn as an inset ring, never as a
                          // fill: a row can be "current but not selected"
                          // after a Ctrl-click that removed it, and the two
                          // states have to look different.
                          isCursor && !isSelected && 'ring-primary/45 ring-1 ring-inset',
                          isCursor && isSelected && 'ring-primary/60 ring-1 ring-inset'
                        )}
                      >
                        <UnreadDot unread={!message.isRead} />

                        <Avatar className="border-border/70 mt-0.5 size-7 shrink-0 border">
                          <AvatarFallback className="bg-secondary/80 text-[10px] font-semibold">
                            {initialsFromName(primaryLabel)}
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

                            <span className="text-muted-foreground shrink-0 text-[10.5px] tabular-nums">
                              {formatDateLabel(message.date)}
                            </span>
                          </div>

                          <div className="flex min-w-0 items-center gap-1.5">
                            <p
                              className={cn(
                                'min-w-0 flex-1 truncate text-[12px] leading-5',
                                message.isRead
                                  ? 'text-foreground/80'
                                  : 'text-foreground font-semibold'
                              )}
                            >
                              <HighlightedText
                                text={message.subject}
                                terms={highlightTerms.subject}
                              />
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
