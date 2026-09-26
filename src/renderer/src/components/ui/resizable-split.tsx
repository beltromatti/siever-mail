/**
 * Two panes with a divider between them that the user can drag, following
 * the WAI-ARIA window splitter pattern.
 *
 * The first pane starts at `defaultSize`, a CSS length — usually the
 * `clamp()` the layout was designed around, so the default keeps following
 * the window. A dragged size holds until the component remounts: nothing is
 * stored, and the layout that owns the split keys it on what should bring
 * the default back.
 *
 * The default has a detent. Dragged within `SNAP_DISTANCE_PX` of it the
 * divider settles there and says so — the grip lengthens and turns to the
 * accent colour — and letting go there hands the size back to
 * `defaultSize`. Arrow keys settle on it too when they step onto or across
 * it; Enter and a double click go straight back.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react'

import { cn } from '@renderer/lib/utils'

/** The gap between the panes, which the divider fills. */
const DIVIDER_SIZE_PX = 8

/** How close to the default a dragged divider is pulled onto it. */
const SNAP_DISTANCE_PX = 14

const KEY_STEP_PX = 16
const KEY_STEP_LARGE_PX = 64

export interface ResizableSplitProps {
  /** `horizontal`: side by side, dragged left and right. `vertical`: stacked. */
  orientation: 'horizontal' | 'vertical'
  /** The first pane's size until it is dragged: any CSS length. */
  defaultSize: string
  /** The smallest the first pane may be dragged to, in pixels. */
  minFirst: number
  /** The smallest the second pane may be left with, in pixels. */
  minSecond: number
  first: ReactNode
  second: ReactNode
  /** What the divider is called to assistive technology. */
  label: string
  className?: string
}

interface Measures {
  total: number
  defaultSize: number
}

interface DragState {
  pointerId: number
  startPointer: number
  startSize: number
  defaultSize: number
  min: number
  max: number
  pointer: number
  frame: number | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function ResizableSplit({
  orientation,
  defaultSize,
  minFirst,
  minSecond,
  first,
  second,
  label,
  className
}: ResizableSplitProps): React.JSX.Element {
  const horizontal = orientation === 'horizontal'
  const containerRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  /** The dragged size in pixels; null while the pane is at its default. */
  const [size, setSize] = useState<number | null>(null)
  const [measures, setMeasures] = useState<Measures | null>(null)
  const [dragging, setDragging] = useState(false)
  const [snapped, setSnapped] = useState(false)

  const extent = (element: Element): number => {
    const rect = element.getBoundingClientRect()
    return horizontal ? rect.width : rect.height
  }

  const maxFor = (total: number): number => Math.max(minFirst, total - minSecond - DIVIDER_SIZE_PX)

  // The container and the default, in pixels, for the keyboard and for
  // assistive technology. The default is read off a hidden probe sized by
  // `defaultSize`, so it is exactly what the layout would draw.
  useLayoutEffect(() => {
    const container = containerRef.current
    const probe = probeRef.current

    if (!container || !probe) {
      return
    }

    const measure = (): void => {
      const rect = container.getBoundingClientRect()
      const probeRect = probe.getBoundingClientRect()
      setMeasures({
        total: horizontal ? rect.width : rect.height,
        defaultSize: horizontal ? probeRect.width : probeRect.height
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(probe)

    return () => observer.disconnect()
  }, [horizontal, defaultSize])

  const settle = (state: DragState, pointer: number): void => {
    const next = clamp(state.startSize + pointer - state.startPointer, state.min, state.max)
    const atDefault = Math.abs(next - state.defaultSize) <= SNAP_DISTANCE_PX

    setSnapped(atDefault)
    setSize(atDefault ? null : next)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current
    const probe = probeRef.current
    const firstPane = firstRef.current

    if (event.button !== 0 || !container || !probe || !firstPane) {
      return
    }

    // No text selection starts under a drag.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const pointer = horizontal ? event.clientX : event.clientY
    dragRef.current = {
      pointerId: event.pointerId,
      startPointer: pointer,
      startSize: extent(firstPane),
      defaultSize: extent(probe),
      min: minFirst,
      max: maxFor(extent(container)),
      pointer,
      frame: null
    }
    setDragging(true)
    setSnapped(size === null)
  }

  // One layout per frame, however fast the pointer reports.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = dragRef.current

    if (!state || event.pointerId !== state.pointerId) {
      return
    }

    state.pointer = horizontal ? event.clientX : event.clientY

    if (state.frame === null) {
      state.frame = requestAnimationFrame(() => {
        state.frame = null
        settle(state, state.pointer)
      })
    }
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const state = dragRef.current

    if (!state || event.pointerId !== state.pointerId) {
      return
    }

    if (state.frame !== null) {
      cancelAnimationFrame(state.frame)
    }

    if (event.type === 'pointerup') {
      settle(state, horizontal ? event.clientX : event.clientY)
    }

    dragRef.current = null
    setDragging(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!measures) {
      return
    }

    const min = minFirst
    const max = maxFor(measures.total)
    const current = clamp(size ?? measures.defaultSize, min, max)
    const step = event.shiftKey ? KEY_STEP_LARGE_PX : KEY_STEP_PX
    let next: number
    let stepped = false

    switch (event.key) {
      case horizontal ? 'ArrowLeft' : 'ArrowUp':
        next = current - step
        stepped = true
        break
      case horizontal ? 'ArrowRight' : 'ArrowDown':
        next = current + step
        stepped = true
        break
      case 'Home':
        next = min
        break
      case 'End':
        next = max
        break
      case 'Enter':
        next = measures.defaultSize
        break
      default:
        return
    }

    // The keys are the divider's now: the window's own shortcuts would
    // otherwise move through the message list or open a message too.
    event.preventDefault()
    event.stopPropagation()
    next = clamp(next, min, max)

    // An arrow step onto or across the default stops there; Home and End go
    // to the ends.
    const fromDefault = current - measures.defaultSize
    const toDefault = next - measures.defaultSize
    const settlesOnDefault = stepped
      ? fromDefault * toDefault < 0 || Math.abs(toDefault) < Math.min(step, SNAP_DISTANCE_PX)
      : Math.abs(toDefault) < 1

    setSize(settlesOnDefault ? null : next)
  }

  // A dragged size gives way to the second pane's minimum when the window
  // shrinks, and comes back when it grows again.
  const firstTrack =
    size === null
      ? defaultSize
      : `clamp(${minFirst}px, ${size}px, calc(100% - ${minSecond + DIVIDER_SIZE_PX}px))`
  const template = `${firstTrack} ${DIVIDER_SIZE_PX}px minmax(0, 1fr)`
  const style: CSSProperties = horizontal
    ? { gridTemplateColumns: template, gridTemplateRows: 'minmax(0, 1fr)' }
    : { gridTemplateRows: template, gridTemplateColumns: 'minmax(0, 1fr)' }

  const current = measures
    ? clamp(size ?? measures.defaultSize, minFirst, maxFor(measures.total))
    : null
  const percent = (value: number): number =>
    measures && measures.total > 0 ? Math.round((value / measures.total) * 100) : 0
  const cursor = horizontal ? 'cursor-col-resize' : 'cursor-row-resize'

  return (
    <div
      ref={containerRef}
      className={cn('relative grid min-h-0 min-w-0', className)}
      style={style}
    >
      <div
        ref={probeRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0"
        style={horizontal ? { width: defaultSize, height: 0 } : { height: defaultSize, width: 0 }}
      />
      <div ref={firstRef} className="min-h-0 min-w-0">
        {first}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuemin={percent(minFirst)}
        aria-valuemax={measures ? percent(maxFor(measures.total)) : 100}
        aria-valuenow={current === null ? undefined : percent(current)}
        aria-valuetext={size === null ? 'Dimensione predefinita' : undefined}
        className={cn('group relative z-10 touch-none outline-none select-none', cursor)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => setSize(null)}
        onKeyDown={onKeyDown}
      >
        {/* Wider than the gap it sits in: eight pixels are a hard target. */}
        <span
          aria-hidden
          className={cn('absolute', horizontal ? '-inset-x-1 inset-y-0' : 'inset-x-0 -inset-y-1')}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute transition-colors duration-150',
            horizontal
              ? 'inset-y-2 left-1/2 w-px -translate-x-1/2'
              : 'inset-x-2 top-1/2 h-px -translate-y-1/2',
            dragging ? (snapped ? 'bg-primary/60' : 'bg-border') : 'bg-transparent'
          )}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 ease-out',
            horizontal ? 'h-8 w-[3px]' : 'h-[3px] w-8',
            'bg-muted-foreground/45 opacity-0 group-hover:opacity-100',
            'group-focus-visible:bg-ring group-focus-visible:opacity-100',
            dragging && 'bg-muted-foreground/70 opacity-100',
            dragging && snapped && (horizontal ? 'bg-primary h-14' : 'bg-primary w-14')
          )}
        />
      </div>
      <div className="min-h-0 min-w-0">{second}</div>

      {/* Over the message frame too, which would otherwise take the pointer. */}
      {dragging && <div aria-hidden className={cn('fixed inset-0 z-50', cursor)} />}
    </div>
  )
}
