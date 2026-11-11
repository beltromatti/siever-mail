import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Where the messages being written live: in the reading pane, in place of
 * the message — but never inside it.
 *
 * A message being written keeps its editor for as long as it is open: the
 * caret, the undo history, a recipient half typed. The editor is a frame,
 * and a frame taken out of the page and put back starts again from nothing;
 * the reading pane, though, is drawn anew whenever the workspace changes
 * shape — reading expanded, another app in front. So the composers stay
 * mounted in a layer of their own, and the pane holds only their place
 * (`ComposerSlot`): the layer lies exactly over it, follows it as it moves
 * or resizes, and steps out of sight when there is no place to fill. It is
 * how editors that host frames keep them alive across layouts.
 */

type RegisterSlot = (element: HTMLElement | null) => void

const ComposerSlotContext = createContext<RegisterSlot>(() => undefined)

/** The place of the message being written, in the reading pane. */
export function ComposerSlot(): React.JSX.Element {
  const register = useContext(ComposerSlotContext)

  return <div ref={register} aria-hidden className="min-h-0 flex-1" />
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

function rectOf(element: HTMLElement): Rect {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  )
}

/** Hands the reading pane's slot, as it mounts and unmounts, to `onSlot`. */
export function ComposerSlotProvider({
  onSlot,
  children
}: {
  onSlot: RegisterSlot
  children: ReactNode
}): React.JSX.Element {
  return <ComposerSlotContext.Provider value={onSlot}>{children}</ComposerSlotContext.Provider>
}

/**
 * The layer the composers are mounted in, laid over `slot`: out of sight
 * — still mounted — while there is none, or while `hidden`.
 */
export function ComposerLayer({
  slot,
  hidden,
  children
}: {
  slot: HTMLElement | null
  hidden: boolean
  children: ReactNode
}): React.JSX.Element {
  const [rect, setRect] = useState<Rect | null>(null)

  useLayoutEffect(() => {
    if (!slot) {
      return
    }

    let frame = 0
    const measure = (): void => {
      const next = rectOf(slot)
      setRect((current) => (sameRect(current, next) ? current : next))
    }
    // A frame later every change of the layout has landed: the pane resized,
    // or moved with it — a column opening beside it, a banner above it.
    const remeasure = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(measure)
    }

    measure()

    const observer = new ResizeObserver(remeasure)
    observer.observe(slot)

    // The pane around it, and the workspace around that: a move without a change of size
    // comes with one of theirs.
    for (let around = slot.parentElement, depth = 0; around && depth < 3; depth += 1) {
      observer.observe(around)
      around = around.parentElement
    }
    window.addEventListener('resize', remeasure)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', remeasure)
    }
  }, [slot])

  const shown = slot !== null && rect !== null && !hidden

  return createPortal(
    <div
      // Under the panes' dividers (z-10), so the one beside the reading pane stays draggable
      // from both sides; above the pane, whose place it fills.
      className="fixed z-[5]"
      style={
        shown
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : { display: 'none' }
      }
    >
      {children}
    </div>,
    document.body
  )
}
