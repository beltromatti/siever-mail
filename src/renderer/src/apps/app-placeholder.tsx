import type { LucideIcon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

/**
 * An app of the rail with nothing to show yet: not here yet ("In arrivo"),
 * or with nothing connected to it. What it is, in a few lines, and the way
 * on when there is one.
 */
export function AppPlaceholder({
  title,
  icon: Icon,
  badge,
  lead,
  points,
  action,
  atWindowTopRight
}: {
  title: string
  icon: LucideIcon
  badge?: string
  lead: string
  points: ReadonlyArray<string>
  action?: { label: string; onClick: () => void }
  atWindowTopRight: boolean
}): React.JSX.Element {
  return (
    <div className="paper flex h-full min-h-0 flex-col">
      <header
        className={cn(
          'window-drag-region flex h-[52px] shrink-0 items-center gap-2 border-b pl-6',
          atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-3'
        )}
      >
        <h1 className="display-title text-[15px]">{title}</h1>
        {badge && (
          <span className="text-muted-foreground bg-hover rounded-full px-2 py-0.5 text-[11px] font-semibold">
            {badge}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <article className="letter mx-auto flex max-w-[620px] flex-col gap-5 rounded-[14px] px-10 py-10">
          <Icon className="text-primary-text size-8" strokeWidth={1.5} />
          <p className="voice text-foreground text-[19px] leading-[1.5]">{lead}</p>
          <ul className="text-muted-foreground flex flex-col gap-2 text-[13.5px] leading-[1.5]">
            {points.map((point) => (
              <li key={point} className="flex gap-2">
                <span className="text-faint-foreground">—</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
          {action && (
            <Button className="window-no-drag self-start" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </article>
      </div>
    </div>
  )
}
