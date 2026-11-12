import { Component, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  broken: {
    en: 'Something broke here.',
    it: 'Qui qualcosa si è rotto.',
    de: 'Hier ist etwas kaputtgegangen.'
  },
  unexpected: {
    en: 'An unexpected error.',
    it: 'Un errore inatteso.',
    de: 'Ein unerwarteter Fehler.'
  },
  restWorks: {
    en: 'The rest of SIEVER Mail works.',
    it: 'Il resto di SIEVER Mail funziona.',
    de: 'Der Rest von SIEVER Mail funktioniert.'
  },
  retry: { en: 'Try again', it: 'Riprova', de: 'Erneut versuchen' },
  reload: { en: 'Reload the window', it: 'Ricarica la finestra', de: 'Fenster neu laden' }
})

/**
 * A part of the window that broke while drawing says so in its place, and
 * the rest of the window goes on (§14.3): "Try again" draws it again. The
 * error reaches the log as React reports it to the root (`main.tsx`).
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode
    className?: string
    /** Around the whole window: nothing else is left drawn to go on with. */
    whole?: boolean
    /** What is drawn inside: another thing there draws afresh, not the broken one's error. */
    resetKey?: unknown
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidUpdate(previous: Readonly<{ resetKey?: unknown }>): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    const { error } = this.state

    if (!error) {
      return this.props.children
    }

    return (
      <BrokenHere
        error={error}
        whole={this.props.whole}
        className={this.props.className}
        onRetry={() => this.setState({ error: null })}
      />
    )
  }
}

/** What a broken part shows in its place, in the interface's language. */
function BrokenHere({
  error,
  whole,
  className,
  onRetry
}: {
  error: Error
  whole?: boolean
  className?: string
  onRetry: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)

  return (
    <div
      role="alert"
      className={cn(
        'flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6 text-center',
        className
      )}
    >
      <TriangleAlert className="text-destructive size-5" />
      <p className="text-[13px] font-semibold">{m.broken}</p>
      <p className="text-muted-foreground max-w-[380px] text-[12px] break-words">
        {error.message || m.unexpected}
        {!whole && ` ${m.restWorks}`}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          {m.retry}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
          {m.reload}
        </Button>
      </div>
    </div>
  )
}
