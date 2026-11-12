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
import { useMessages } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  cancel: { en: 'Cancel', it: 'Annulla', de: 'Abbrechen' },
  thisEvent: { en: 'This event only', it: 'Solo questo evento', de: 'Nur dieser Termin' },
  wholeSeries: { en: 'The whole series', it: 'Tutta la serie', de: 'Die ganze Serie' }
})

/** For what an instance of a recurring event is changed, taken away or answered. */
export type SeriesScope = 'one' | 'series'

export interface SeriesChoiceOptions {
  title: string
  description: ReactNode
  /** Paints the answers as the irreversible action they are: a deletion. */
  destructive?: boolean
}

/**
 * The question every calendar asks of an event that repeats (vision
 * §7.5): this one alone, or the whole series — with a way out. It stacks
 * over every dialog, as the app's confirmation does, and asks with
 * `const scope = await ask({ … })`: the answer, or null when declined.
 */
export function useSeriesChoice(): {
  ask: (options: SeriesChoiceOptions) => Promise<SeriesScope | null>
  dialog: React.JSX.Element
  open: boolean
} {
  const m = useMessages(MESSAGES)
  const [options, setOptions] = useState<SeriesChoiceOptions | null>(null)
  const resolveRef = useRef<((scope: SeriesScope | null) => void) | null>(null)

  const settle = useCallback((scope: SeriesScope | null): void => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setOptions(null)
    resolve?.(scope)
  }, [])

  const ask = useCallback((next: SeriesChoiceOptions): Promise<SeriesScope | null> => {
    resolveRef.current?.(null)

    return new Promise((resolve) => {
      resolveRef.current = resolve
      setOptions(next)
    })
  }, [])

  // Unmounted mid-question, it is declined: every promise settles.
  useEffect(() => {
    const pending = resolveRef
    return () => pending.current?.(null)
  }, [])

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(open) => !open && settle(null)}>
      <DialogContent
        hideClose
        role="alertdialog"
        overlayClassName="z-[60]"
        className="z-[70] w-[min(460px,calc(100vw-2rem))] gap-4"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          <DialogDescription>{options?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="ghost" onClick={() => settle(null)}>
            {m.cancel}
          </Button>
          <Button
            type="button"
            variant={options?.destructive ? 'destructive' : 'outline'}
            onClick={() => settle('one')}
          >
            {m.thisEvent}
          </Button>
          <Button
            type="button"
            variant={options?.destructive ? 'destructive' : 'default'}
            onClick={() => settle('series')}
          >
            {m.wholeSeries}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { ask, dialog, open: options !== null }
}
