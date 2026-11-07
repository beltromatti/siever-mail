import { Component, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

/**
 * A part of the window that broke while drawing says so in its place, and
 * the rest of the window goes on (§13ter.3): "Riprova" draws it again. The
 * error reaches the log as React reports it, through the console.
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
      <div
        role="alert"
        className={cn(
          'flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6 text-center',
          this.props.className
        )}
      >
        <TriangleAlert className="text-destructive size-5" />
        <p className="text-[13px] font-semibold">Qui qualcosa si è rotto.</p>
        <p className="text-muted-foreground max-w-[380px] text-[12px] break-words">
          {error.message || 'Un errore inatteso.'}
          {!this.props.whole && ' Il resto di SIEVER Mail funziona.'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
            Riprova
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
            Ricarica la finestra
          </Button>
        </div>
      </div>
    )
  }
}
