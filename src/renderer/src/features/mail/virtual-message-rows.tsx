import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Spinner } from '@renderer/components/ui/spinner'
import type { MessageSection } from '@renderer/lib/message-sections'
import { messageRefKey, summaryToMessageRef } from '@renderer/lib/message-selection'
import { cn } from '@renderer/lib/utils'
import type { MailMessageSummary } from '@shared/models'

/** How close to the end of what is loaded the next page is asked for, in rows. */
const LOAD_AHEAD_ROWS = 30
/** Rows rendered beyond the edges of the screen, so a scroll never shows a blank. */
const OVERSCAN_ROWS = 10
/** How long the rows in view stay put before their previews are asked for. */
const ROWS_IN_VIEW_SETTLE_MS = 150

type ListItem =
  | { kind: 'heading'; key: string; section: MessageSection }
  | { kind: 'row'; key: string; message: MailMessageSummary }

export interface VirtualMessageRowsProps {
  sections: MessageSection[]
  /** Newest at the bottom: the exact mirror of the list, headings above their rows. */
  invert: boolean
  cursorKey: string | null
  /**
   * Changes when the list should bring the cursor's row into view — a new
   * folder, order, grouping or filter has just been shown.
   */
  revealCursorToken: number
  canLoadMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  /** The messages whose rows are on screen, once a scroll settles. */
  onRowsInView: (messages: MailMessageSummary[]) => void
  rowHeightEstimate: number
  headingHeight: number
  renderHeading: (
    section: MessageSection,
    collapsed: boolean,
    toggleCollapsed: () => void
  ) => ReactNode
  renderRow: (message: MailMessageSummary) => ReactNode
}

/**
 * The rows of a message list, built only as they come into view, so a
 * folder of ten thousand messages scrolls like one of a hundred. The next
 * page loads by itself as the end comes near — newest at the top, or at the
 * bottom in the inverted order — and the rows the user is reading stay put
 * while mail arrives above them or older mail loads in.
 *
 * Section headings stay pinned at the top while their rows scroll under
 * them, as they did before the list was virtualised.
 */
export function VirtualMessageRows({
  sections,
  invert,
  cursorKey,
  revealCursorToken,
  canLoadMore,
  loadingMore,
  onLoadMore,
  onRowsInView,
  rowHeightEstimate,
  headingHeight,
  renderHeading,
  renderRow
}: VirtualMessageRowsProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  // The row the user is reading — the first one in view below the pinned
  // heading — and how far down the view it sits, kept as the list scrolls:
  // when rows come or go above it, it is put back where it was.
  const readingAnchorRef = useRef<{ key: string; offset: number } | null>(null)
  // Where the view is at its edges. At the very top of a newest-first list
  // mail that arrives shows above; at the bottom of the mirrored one the view
  // follows it down.
  const viewEdgesRef = useRef({ atTop: true, atEnd: true })

  const items = useMemo(() => {
    const list: ListItem[] = []

    for (const section of invert ? [...sections].reverse() : sections) {
      if (section.label) {
        list.push({ kind: 'heading', key: `heading:${section.key}`, section })
      }

      if (collapsedSectionKeys.has(section.key)) {
        continue
      }

      for (const message of invert ? [...section.messages].reverse() : section.messages) {
        list.push({ kind: 'row', key: messageRefKey(summaryToMessageRef(message)), message })
      }
    }

    return list
  }, [collapsedSectionKeys, invert, sections])

  const headingIndexes = useMemo(
    () => items.flatMap((item, index) => (item.kind === 'heading' ? [index] : [])),
    [items]
  )

  const pinnedHeadingFor = useCallback(
    (startIndex: number): number => headingIndexes.findLast((index) => index <= startIndex) ?? -1,
    [headingIndexes]
  )

  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      const pinned = pinnedHeadingFor(range.startIndex)
      const indexes = defaultRangeExtractor(range)
      return pinned >= 0 && !indexes.includes(pinned) ? [pinned, ...indexes] : indexes
    },
    [pinnedHeadingFor]
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => (items[index]?.kind === 'heading' ? headingHeight : rowHeightEstimate),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: OVERSCAN_ROWS,
    rangeExtractor,
    // A row brought into view by the keyboard is not left under the pinned heading.
    scrollPaddingStart: headingIndexes.length > 0 ? headingHeight : 0
  })

  const virtualItems = virtualizer.getVirtualItems()
  const range = virtualizer.range
  const pinnedHeading = range ? pinnedHeadingFor(range.startIndex) : -1
  // The next heading pushes the pinned one up as it reaches the top, as a
  // CSS sticky heading is pushed by the next one.
  const nextHeading = headingIndexes.find((index) => index > pinnedHeading)
  const nextHeadingStart =
    nextHeading === undefined ? undefined : virtualizer.measurementsCache[nextHeading]?.start
  const pinnedPush =
    nextHeadingStart === undefined
      ? 0
      : Math.min(0, nextHeadingStart - (virtualizer.scrollOffset ?? 0) - headingHeight)

  const itemsRef = useRef(items)
  const pinnedCover = headingIndexes.length > 0 ? headingHeight : 0

  // The anchor follows the user's scrolling, never a change of the rows:
  // read then, it would already describe the shifted list.
  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    const recordReadingAnchor = (): void => {
      const top = viewport.scrollTop
      const measurements = virtualizer.measurementsCache
      const current = itemsRef.current
      // The first item reaching below the pinned heading: a binary search,
      // the list can hold thousands of rows.
      let low = 0
      let high = measurements.length

      while (low < high) {
        const middle = (low + high) >> 1

        if (measurements[middle].end > top + pinnedCover) {
          high = middle
        } else {
          low = middle + 1
        }
      }

      let index = low

      while (index < measurements.length && current[index]?.kind !== 'row') {
        index += 1
      }

      const anchor = measurements[index]
      readingAnchorRef.current = anchor
        ? { key: String(anchor.key), offset: anchor.start - top }
        : null
      viewEdgesRef.current = {
        atTop: top <= 1,
        atEnd: top + viewport.clientHeight >= viewport.scrollHeight - 1
      }
    }

    viewport.addEventListener('scroll', recordReadingAnchor, { passive: true })
    return () => viewport.removeEventListener('scroll', recordReadingAnchor)
  }, [pinnedCover, virtualizer])

  // Rows came or went — new mail, an older page, a collapsed group: the row
  // being read goes back where it was on screen.
  useLayoutEffect(() => {
    const previous = itemsRef.current
    itemsRef.current = items

    if (previous === items) {
      return
    }

    const { atTop, atEnd } = viewEdgesRef.current

    if (invert && atEnd) {
      if (items.length > 0) {
        virtualizer.scrollToIndex(items.length - 1, { align: 'end' })
      }
      return
    }

    const anchor = readingAnchorRef.current

    if ((!invert && atTop) || !anchor) {
      return
    }

    const index = items.findIndex((item) => item.key === anchor.key)
    const start = index >= 0 ? virtualizer.measurementsCache[index]?.start : undefined

    if (start !== undefined && start - anchor.offset !== virtualizer.scrollOffset) {
      virtualizer.scrollToOffset(start - anchor.offset)
    }
  }, [invert, items, virtualizer])

  // Keep the keyboard cursor on screen while arrowing through a long folder.
  useEffect(() => {
    const index = cursorKey ? items.findIndex((item) => item.key === cursorKey) : -1

    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: 'auto' })
    }
    // Only a move of the cursor scrolls; a list refreshing under it does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorKey])

  // A new folder, order or filter: the selection — or the top of the list —
  // in view. Sorted by sender, the selected message's group is framed from
  // its heading — every message from that person, as many as fit — whenever
  // the selected one is still on screen that way; deeper in a long group,
  // the selected message is centred.
  useEffect(() => {
    const index = cursorKey ? items.findIndex((item) => item.key === cursorKey) : -1

    if (index >= 0) {
      const heading = pinnedHeadingFor(index)
      const groupStart = heading >= 0 ? virtualizer.measurementsCache[heading]?.start : undefined
      const cursorEnd = virtualizer.measurementsCache[index]?.end
      const viewportHeight = viewportRef.current?.clientHeight ?? 0

      if (
        groupStart !== undefined &&
        cursorEnd !== undefined &&
        cursorEnd - groupStart <= viewportHeight
      ) {
        virtualizer.scrollToOffset(groupStart)
      } else {
        virtualizer.scrollToIndex(index, { align: 'center' })
      }
    } else if (items.length > 0) {
      virtualizer.scrollToIndex(invert ? items.length - 1 : 0, {
        align: invert ? 'end' : 'start'
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealCursorToken])

  const startIndex = range?.startIndex ?? 0
  const endIndex = range?.endIndex ?? -1

  // The next page, before the end of what is loaded comes into view.
  useEffect(() => {
    if (!canLoadMore || loadingMore || endIndex < 0) {
      return
    }

    const nearEdge = invert
      ? startIndex <= LOAD_AHEAD_ROWS
      : endIndex >= items.length - 1 - LOAD_AHEAD_ROWS

    if (nearEdge) {
      onLoadMore()
    }
  }, [canLoadMore, endIndex, invert, items.length, loadingMore, onLoadMore, startIndex])

  useEffect(() => {
    if (endIndex < 0) {
      return
    }

    const timer = setTimeout(() => {
      onRowsInView(
        items
          .slice(startIndex, endIndex + 1)
          .flatMap((item) => (item.kind === 'row' ? [item.message] : []))
      )
    }, ROWS_IN_VIEW_SETTLE_MS)

    return () => clearTimeout(timer)
  }, [endIndex, items, onRowsInView, startIndex])

  const toggleCollapsed = (sectionKey: string): void =>
    setCollapsedSectionKeys((current) => {
      const next = new Set(current)

      if (next.has(sectionKey)) {
        next.delete(sectionKey)
      } else {
        next.add(sectionKey)
      }

      return next
    })

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea viewportRef={viewportRef} className="min-h-0 min-w-0 flex-1">
        <div className="relative w-full min-w-0" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index]

            if (!item) {
              return null
            }

            const pinned = virtualItem.index === pinnedHeading

            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className={pinned ? 'sticky top-0 z-10 w-full' : 'absolute top-0 left-0 w-full'}
                style={{
                  transform: `translateY(${pinned ? pinnedPush : virtualItem.start}px)`
                }}
              >
                {item.kind === 'heading'
                  ? renderHeading(item.section, collapsedSectionKeys.has(item.section.key), () =>
                      toggleCollapsed(item.section.key)
                    )
                  : renderRow(item.message)}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      {/* Over the list rather than in it: a row that came and went would
          move the rows being read. */}
      {loadingMore && (
        <div
          role="status"
          className={cn(
            'bg-popover/95 text-muted-foreground border-border/70 pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shadow-sm',
            invert ? 'top-2' : 'bottom-2'
          )}
        >
          <Spinner className="size-3" /> Caricamento…
        </div>
      )}
    </div>
  )
}
