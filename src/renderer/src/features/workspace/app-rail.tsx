import type { LucideIcon } from 'lucide-react'
import { Settings } from 'lucide-react'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

import type { SyncSummary } from './sync-status'

export interface RailItem {
  id: string
  label: string
  icon: LucideIcon
  /** A dot on the icon: something there wants the user. */
  attention?: boolean
}

/**
 * The column on the far left: the app's mark, where the user is — Posta,
 * and the other places as they arrive — and, at the bottom, how the
 * connection is and the way to Settings. It is the window's edge, so its top
 * is the title bar the window is dragged by.
 */
export function AppRail({
  items,
  activeItemId,
  onSelectItem,
  syncSummary,
  onOpenSettings
}: {
  items: ReadonlyArray<RailItem>
  activeItemId: string
  onSelectItem: (id: string) => void
  syncSummary: SyncSummary | null
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <nav
      aria-label="Sezioni"
      className="window-drag-region flex h-full w-[52px] flex-col items-center border-r pt-[var(--titlebar-band)] pb-3"
    >
      <span
        aria-hidden
        className="button-seal mt-1 mb-4 grid size-7 shrink-0 place-items-center rounded-full text-[13px] leading-none font-bold [font-stretch:115%]"
      >
        S
      </span>

      <div className="window-no-drag flex flex-col items-center gap-1">
        {items.map((item) => {
          const Icon = item.icon
          const active = item.id === activeItemId

          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelectItem(item.id)}
                  className={cn(
                    'focus-visible:ring-ring/60 relative grid size-9 place-items-center rounded-[9px] transition-colors outline-none focus-visible:ring-2',
                    active
                      ? 'bg-selected text-foreground'
                      : 'text-faint-foreground hover:bg-hover hover:text-foreground'
                  )}
                >
                  <Icon className="size-[17px]" strokeWidth={1.7} />
                  {item.attention && (
                    <span className="bg-ai ring-background absolute top-[7px] right-[7px] size-[7px] rounded-full ring-2" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <div className="flex-1" />

      <div className="window-no-drag flex flex-col items-center gap-1">
        {syncSummary && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label={syncSummary.label}
                className="grid size-9 cursor-default place-items-center"
              >
                <span
                  className={cn(
                    'size-[7px] rounded-full',
                    syncSummary.tone === 'ok' && 'bg-status-online',
                    syncSummary.tone === 'busy' && 'bg-faint-foreground animate-pulse',
                    syncSummary.tone === 'problem' && 'bg-status-offline'
                  )}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-72">
              <span className="block font-semibold">{syncSummary.label}</span>
              <span className="text-muted-foreground block font-normal">{syncSummary.detail}</span>
            </TooltipContent>
          </Tooltip>
        )}

        <ActionTooltip label="Impostazioni" commandId="settings" side="right">
          <button
            type="button"
            aria-label="Apri impostazioni"
            onClick={onOpenSettings}
            className="text-faint-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 grid size-9 place-items-center rounded-[9px] transition-colors outline-none focus-visible:ring-2"
          >
            <Settings className="size-[17px]" strokeWidth={1.7} />
          </button>
        </ActionTooltip>
      </div>
    </nav>
  )
}
