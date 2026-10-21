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
import { Input } from '@renderer/components/ui/input'

export interface PromptOptions {
  title: string
  description?: ReactNode
  /** What the field is for, read by screen readers and shown as its placeholder. */
  label: string
  initialValue?: string
  confirmLabel: string
  /** Why the value cannot be taken, or null when it can. */
  validate?: (value: string) => string | null
}

/**
 * The app's request for a word — a folder's name — asked the way
 * `window.prompt` is: `const name = await prompt({ … })`, null when the
 * request was dismissed. Like the confirm dialog it stacks above every other
 * dialog and settles every promise, also when its owner unmounts.
 */
export function usePromptDialog(): {
  prompt: (options: PromptOptions) => Promise<string | null>
  dialog: React.JSX.Element
  open: boolean
} {
  const [options, setOptions] = useState<PromptOptions | null>(null)
  const [value, setValue] = useState('')
  const resolveRef = useRef<((value: string | null) => void) | null>(null)

  const settle = useCallback((answer: string | null): void => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setOptions(null)
    resolve?.(answer)
  }, [])

  const prompt = useCallback((next: PromptOptions): Promise<string | null> => {
    resolveRef.current?.(null)

    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve
      setValue(next.initialValue ?? '')
      setOptions(next)
    })
  }, [])

  useEffect(() => {
    const pending = resolveRef
    return () => pending.current?.(null)
  }, [])

  const trimmed = value.trim()
  const error = options && trimmed ? (options.validate?.(trimmed) ?? null) : null
  const canConfirm = trimmed.length > 0 && error === null

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(nextOpen) => !nextOpen && settle(null)}>
      <DialogContent
        hideClose
        overlayClassName="z-[60]"
        className="z-[70] w-[min(420px,calc(100vw-2rem))] gap-4"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()

            if (canConfirm) {
              settle(trimmed)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
            {options?.description && <DialogDescription>{options.description}</DialogDescription>}
          </DialogHeader>

          <div className="space-y-1.5">
            <Input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder={options?.label}
              aria-label={options?.label}
              aria-invalid={error !== null}
              spellCheck={false}
              autoComplete="off"
            />
            {error && <p className="text-destructive-soft-foreground text-[12px]">{error}</p>}
          </div>

          <DialogFooter className="flex-wrap">
            <Button type="button" variant="ghost" onClick={() => settle(null)}>
              Annulla
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              {options?.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  return { prompt, dialog, open: options !== null }
}
