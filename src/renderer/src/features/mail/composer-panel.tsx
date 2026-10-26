import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useDialogDrag } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'

/** Height of the grab strip along the top edge, as the app's dialogs have it. */
const DRAG_HANDLE_HEIGHT = 34
const MOTION = '200ms cubic-bezier(0, 0, 0.2, 1)'
/**
 * Coming forward it is visible at once — focus can only go to what shows;
 * stepping aside it stays visible while it shrinks away.
 */
const OPEN_TRANSITION = `transform ${MOTION}, opacity ${MOTION}, box-shadow ${MOTION}, visibility 0s`
const CLOSED_TRANSITION = `transform ${MOTION}, opacity ${MOTION}, box-shadow ${MOTION}, visibility 0s linear 200ms`

interface ComposerPanelProps {
  /** In front of the app; otherwise parked in the dock, still mounted. */
  open: boolean
  /** Off while the editor fills the panel: its toolbar sits where the grip would. */
  draggable: boolean
  onMinimize: () => void
  labelledBy: string
  className?: string
  children: ReactNode
}

/**
 * The window a message is written in. Unlike a dialog it is never taken
 * down while its message is being written: parked in the dock it is only
 * out of sight, so coming back finds the editor as it was left — the
 * caret where it was, the undo history, a half-typed recipient.
 *
 * In front, it is modal as the app's dialogs are (the app behind is made
 * `inert` by its owner), draggable by its top edge, and steps aside with
 * Esc or a click beside it; the dock is where it shrinks to.
 */
export function ComposerPanel({
  open,
  draggable,
  onMinimize,
  labelledBy,
  className,
  children
}: ComposerPanelProps): React.JSX.Element {
  const { offset, isDragging, panelRef, onHandlePointerDown, resetOffset } = useDialogDrag(
    open && draggable
  )
  /** What had focus in the panel when it stepped aside, to have it again on return. */
  const focusInsideRef = useRef<HTMLElement | null>(null)
  /** What had focus in the app when the panel came forward, to give it back. */
  const focusOutsideRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const panel = panelRef.current

    if (!panel) {
      return
    }

    if (open) {
      resetOffset()

      if (!panel.contains(document.activeElement)) {
        focusOutsideRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      }

      // Back where it was — the editor keeps its own caret — or on the panel,
      // so its keys (Esc) are its own until its owner moves focus on.
      const previous = focusInsideRef.current

      if (previous?.isConnected && panel.contains(previous)) {
        previous.focus({ preventScroll: true })
      }

      if (!panel.contains(document.activeElement)) {
        panel.focus({ preventScroll: true })
      }

      return
    }

    if (panel.contains(document.activeElement)) {
      focusInsideRef.current = document.activeElement as HTMLElement
      focusOutsideRef.current?.focus({ preventScroll: true })

      // What had focus is gone — the dock bar it came back from — and the
      // editor's frame does not let go on `blur()`: the panel takes focus out
      // of it, still visible while it shrinks, and lets it go to the app.
      if (panel.contains(document.activeElement)) {
        panel.focus({ preventScroll: true })
        panel.blur()
      }
    }
  }, [open, panelRef, resetOffset])

  const isMoved = offset.x !== 0 || offset.y !== 0

  return createPortal(
    <div className={cn('fixed inset-0 z-50', !open && 'pointer-events-none')}>
      {/* A click beside the message puts it aside, as Esc does. */}
      <div
        aria-hidden
        onPointerDown={(event) => {
          if (event.target === event.currentTarget && event.button === 0) {
            onMinimize()
          }
        }}
        className={cn(
          'bg-scrim absolute inset-0 transition-opacity duration-200',
          open ? (isDragging ? 'opacity-0' : isMoved ? 'opacity-35' : 'opacity-100') : 'opacity-0'
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onMinimize()
          }
        }}
        style={{
          transform: open
            ? `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`
            : // Shrinks towards the dock, bottom right.
              'translate(calc(-50% + 34vw), calc(-50% + 44vh)) scale(0.18)',
          transition: isDragging ? 'none' : open ? OPEN_TRANSITION : CLOSED_TRANSITION
        }}
        className={cn(
          'glass-dialog text-popover-foreground fixed top-1/2 left-1/2 flex max-h-[calc(100vh-3rem)] w-[min(980px,calc(100vw-2rem))] origin-center flex-col rounded-xl outline-none',
          isDragging && 'select-none',
          open ? 'visible opacity-100' : 'invisible opacity-0',
          className
        )}
      >
        {draggable && (
          <div
            aria-hidden
            onPointerDown={onHandlePointerDown}
            className={cn(
              'absolute inset-x-0 top-0 z-0 rounded-t-xl',
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            )}
            style={{ height: DRAG_HANDLE_HEIGHT }}
          >
            <span
              className={cn(
                'bg-muted-foreground/25 absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full transition-colors',
                isMoved && 'bg-muted-foreground/40',
                isDragging && 'bg-primary/60'
              )}
            />
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  )
}
