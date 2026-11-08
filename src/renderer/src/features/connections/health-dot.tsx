import { cn } from '@renderer/lib/utils'

import type { ConnectionHealth } from './connection-health'

/**
 * How a connection stands, as a dot: green in step, grey at work, amber
 * waiting on what passes by itself, red when the user is wanted (§13ter).
 * The rail's and Settings' alike.
 */
const DOT: Readonly<Record<ConnectionHealth, string>> = {
  ok: 'bg-status-online',
  working: 'bg-faint-foreground animate-pulse',
  waiting: 'bg-status-waiting',
  attention: 'bg-status-offline'
}

export function HealthDot({
  health,
  className
}: {
  health: ConnectionHealth
  className?: string
}): React.JSX.Element {
  return <span aria-hidden className={cn('shrink-0 rounded-full', DOT[health], className)} />
}
