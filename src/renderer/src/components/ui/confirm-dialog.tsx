import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'

export interface ConfirmOptions {
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Paints the confirm button as the irreversible action it is. */
  destructive?: boolean
  /** Shown between the text and the buttons. */
  details?: ReactNode
  /**
   * The answer Enter gives. Cancel, unless cancelling is the answer that
   * loses something.
   */
  initialFocus?: 'cancel' | 'confirm'
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The app's question: a title, what is about to happen, and two answers.
 *
 * It always stacks above every other dialog, since it is asked from inside
 * them (the composer, Settings). The panel does not close on a click
 * outside: a question needs an answer, and Escape or the cancel button is
 * that answer. Focus starts on the cancel button unless told otherwise, so
 * a stray Enter never confirms.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Annulla',
  destructive = false,
  details,
  initialFocus = 'cancel',
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        hideClose
        role="alertdialog"
        overlayClassName="z-[60]"
        className="z-[70] w-[min(440px,calc(100vw-2rem))] gap-4"
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          if (initialFocus === 'confirm') {
            event.preventDefault()
            confirmButtonRef.current?.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {details}

        {/* Answers can name an account; a long pair wraps instead of spilling. */}
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * `ConfirmDialog` asked the way `window.confirm` is:
 * `if (await confirm({ … }))`. The owner renders `dialog` once and can tell
 * from `open` that a question is on screen — which is what keeps its
 * keyboard shortcuts from acting behind it.
 *
 * A second question while one is open replaces it, and an owner that
 * unmounts mid-question has it declined: every promise settles.
 */
export function useConfirmDialog(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  dialog: React.JSX.Element
  open: boolean
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  const settle = useCallback((confirmed: boolean): void => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setOptions(null)
    resolve?.(confirmed)
  }, [])

  const confirm = useCallback((next: ConfirmOptions): Promise<boolean> => {
    resolveRef.current?.(false)

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setOptions(next)
    })
  }, [])

  useEffect(() => {
    const pending = resolveRef
    return () => pending.current?.(false)
  }, [])

  const dialog = (
    <ConfirmDialog
      open={options !== null}
      title={options?.title ?? ''}
      description={options?.description}
      confirmLabel={options?.confirmLabel ?? ''}
      cancelLabel={options?.cancelLabel}
      destructive={options?.destructive}
      details={options?.details}
      initialFocus={options?.initialFocus}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return { confirm, dialog, open: options !== null }
}
