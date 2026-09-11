import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@renderer/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

/**
 * Height of the grab strip along the top edge of every dialog. Wide enough
 * to hit without aiming, short enough to leave the description line
 * selectable.
 */
const DIALOG_DRAG_HANDLE_HEIGHT = 34

/**
 * Keeps a dragged dialog from being pushed off-screen. The top inset also
 * clears the frameless window's own drag strip (`.window-drag-edge`), which
 * sits above dialogs in the stacking order.
 */
const DIALOG_VIEWPORT_MARGIN = 12
const WINDOW_DRAG_EDGE_HEIGHT = 20

interface DialogDragOffset {
  x: number
  y: number
}

/**
 * Makes a centred dialog draggable by its top edge.
 *
 * The SIEVER team asked for this after hitting a real problem: the archive
 * wizard's last step asks for a folder name, and the information needed to
 * choose one — the folder listing and the message behind the dialog — was
 * covered by a panel they could not move. Dragging is the smallest change
 * that solves it without adding anything to the dialog's own layout.
 *
 * Panels stay centred by transform, so the drag adds an offset on top of the
 * centring translate rather than switching to absolute coordinates: the
 * dialog keeps re-centring itself on resize until the user moves it.
 * Deliberately no resizing — dialog bodies are laid out for their natural
 * width and would break.
 */
function useDialogDrag(enabled: boolean): {
  offset: DialogDragOffset
  isDragging: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
  onHandlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  resetOffset: () => void
} {
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [offset, setOffset] = React.useState<DialogDragOffset>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = React.useState(false)
  const dragStateRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const resetOffset = React.useCallback(() => {
    setOffset({ x: 0, y: 0 })
  }, [])

  const onHandlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Primary button only, and never when the press landed on a control
      // that happens to sit inside the handle strip (the close button).
      if (!enabled || event.button !== 0 || dragStateRef.current) {
        return
      }

      const target = event.target as HTMLElement | null
      if (target?.closest('button, a, input, textarea, select, [role="button"]')) {
        return
      }

      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y
      }
      setIsDragging(true)
    },
    [enabled, offset.x, offset.y]
  )

  React.useEffect(() => {
    if (!isDragging) {
      return
    }

    const clampToViewport = (candidate: DialogDragOffset): DialogDragOffset => {
      const panel = panelRef.current

      if (!panel) {
        return candidate
      }

      const { width, height } = panel.getBoundingClientRect()
      // The panel is centred, so its untranslated top-left corner sits at
      // (viewport - size) / 2; the offset may move it by at most half the
      // slack left on each side, minus the margins we reserve.
      const horizontalSlack = Math.max(0, (window.innerWidth - width) / 2 - DIALOG_VIEWPORT_MARGIN)
      const topSlack = Math.max(
        0,
        (window.innerHeight - height) / 2 - DIALOG_VIEWPORT_MARGIN - WINDOW_DRAG_EDGE_HEIGHT
      )
      const bottomSlack = Math.max(0, (window.innerHeight - height) / 2 - DIALOG_VIEWPORT_MARGIN)

      return {
        x: Math.min(horizontalSlack, Math.max(-horizontalSlack, candidate.x)),
        y: Math.min(bottomSlack, Math.max(-topSlack, candidate.y))
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const dragState = dragStateRef.current

      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      setOffset(
        clampToViewport({
          x: dragState.originX + (event.clientX - dragState.startX),
          y: dragState.originY + (event.clientY - dragState.startY)
        })
      )
    }

    const endDrag = (event: PointerEvent): void => {
      const dragState = dragStateRef.current

      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      dragStateRef.current = null
      setIsDragging(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [isDragging])

  return { offset, isDragging, panelRef, onHandlePointerDown, resetOffset }
}

/**
 * The veil behind a dialog. Light enough to read the workspace through it —
 * the archive wizard is often used while cross-checking the message list
 * underneath — and blurred so what shows through never competes with the
 * dialog's own text.
 */
const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('bg-background/45 fixed inset-0 z-50 backdrop-blur-[3px]', className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    closeDisabled?: boolean
    hideClose?: boolean
    overlayClassName?: string
    /** Opt out of dragging for a panel that must stay put. */
    draggable?: boolean
  }
>(
  (
    {
      className,
      children,
      closeDisabled = false,
      hideClose = false,
      overlayClassName,
      draggable = true,
      ...props
    },
    forwardedRef
  ) => {
    const { offset, isDragging, panelRef, onHandlePointerDown, resetOffset } =
      useDialogDrag(draggable)

    // Every open starts centred. Without this a dialog reopened after being
    // dragged would reappear wherever it was left, which reads as a bug when
    // the previous position was tied to content that is now gone.
    React.useEffect(() => {
      resetOffset()
    }, [resetOffset])

    const setPanelRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        panelRef.current = node

        if (typeof forwardedRef === 'function') {
          forwardedRef(node)
        } else if (forwardedRef) {
          forwardedRef.current = node
        }
      },
      [forwardedRef, panelRef]
    )

    const isMoved = offset.x !== 0 || offset.y !== 0

    return (
      <DialogPortal>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={setPanelRef}
          style={{
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`
          }}
          className={cn(
            // `max-h` is a ceiling, not a scroll container: an `overflow`
            // here would clip absolutely-positioned children (the archive
            // wizard's practice picker opens past the panel's edge). Dialogs
            // whose content can grow — Settings, the composer — size and
            // scroll themselves.
            // Dialogs carry the same density as the app behind them. They
            // had drifted to a scale of their own — 20px padding, a 14px
            // gap, an 18px title, 36-38px buttons — against a workspace
            // built on 11-12.5px text and 26-32px controls, so opening
            // Settings felt like opening a different program. One set of
            // measurements here, rather than per-dialog overrides, is what
            // keeps the next dialog in line without anyone remembering to.
            'glass-dialog text-popover-foreground fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100vh-3rem)] w-[min(980px,calc(100vw-2rem))] gap-2.5 rounded-xl p-4',
            // While dragging, drop the transition so the panel tracks the
            // pointer exactly instead of easing behind it.
            isDragging ? 'transition-none select-none' : 'transition-shadow',
            className
          )}
          {...props}
        >
          {draggable && (
            <div
              onPointerDown={onHandlePointerDown}
              className={cn(
                'absolute inset-x-0 top-0 z-0 rounded-t-xl',
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              )}
              style={{ height: DIALOG_DRAG_HANDLE_HEIGHT }}
              aria-hidden
            >
              {/* Sheet-style grip: the only affordance telling the user the
                  panel can be moved. Brightens on hover and while held. */}
              <span
                className={cn(
                  'bg-muted-foreground/25 absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full transition-colors',
                  isMoved && 'bg-muted-foreground/40',
                  isDragging && 'bg-primary/60'
                )}
              />
            </div>
          )}

          {/*
            Children stay DIRECT grid children of the panel: dialogs lay
            themselves out with `grid-rows-*` on DialogContent (Settings
            pins its body to `minmax(0,1fr)` so only that scrolls), and an
            extra wrapper would silently collapse those rows into one. The
            drag strip above is absolutely positioned, so it takes part in
            neither the grid flow nor that calculation.
          */}
          {children}

          {!hideClose && (
            <DialogPrimitive.Close
              disabled={closeDisabled}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/65 absolute top-3.5 right-3.5 z-20 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45"
            >
              <X className="size-4" />
              <span className="sr-only">Chiudi</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    )
  }
)
DialogContent.displayName = DialogPrimitive.Content.displayName

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-0.5 pr-8 text-left', className)} {...props} />
}

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        // Footer buttons match the workspace's control height so a dialog's
        // Conferma is the same object as the toolbar's Archivia.
        'flex items-center justify-end gap-2 [&>button]:h-8 [&>button]:text-[12px]',
        className
      )}
      {...props}
    />
  )
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('display-title text-[14px] leading-6 font-bold', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-[11px] leading-4', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
}
