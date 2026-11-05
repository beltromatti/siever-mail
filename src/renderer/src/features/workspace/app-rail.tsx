import type { LucideIcon } from 'lucide-react'
import { Settings } from 'lucide-react'

import appMark from '@renderer/assets/logo-128.png'
import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

import type { SyncSummary } from './sync-status'

export interface RailItem {
  id: string
  label: string
  icon: LucideIcon
  /** A dot on the icon: something there wants the user. */
  attention?: boolean
  /** Not here yet: it opens on what it will be. */
  soon?: boolean
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
  segretario,
  onOpenSettings
}: {
  items: ReadonlyArray<RailItem>
  activeItemId: string
  onSelectItem: (id: string) => void
  syncSummary: SyncSummary | null
  /** The Segretario's panel, open or not and whether something waits in it; null with the AI off. */
  segretario: { open: boolean; attention: boolean; onToggle: () => void } | null
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <nav
      aria-label="Sezioni"
      className="window-drag-region flex h-full w-[52px] flex-col items-center border-r pt-[var(--titlebar-band)] pb-3"
    >
      <img
        src={appMark}
        alt=""
        draggable={false}
        className="mt-1 mb-4 size-[30px] shrink-0 drop-shadow-[0_1px_2px_hsl(var(--shadow)/0.35)] select-none"
      />

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
                    <span className="bg-ai-star ring-background absolute top-[7px] right-[7px] size-[7px] rounded-full ring-2" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {item.label}
                {item.soon && (
                  <span className="text-muted-foreground font-normal"> · in arrivo</span>
                )}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <div className="flex-1" />

      <div className="window-no-drag flex flex-col items-center gap-1">
        {segretario && (
          <ActionTooltip label="Segretario" commandId="segretario" side="right">
            <button
              type="button"
              aria-label="Segretario"
              aria-pressed={segretario.open}
              onClick={segretario.onToggle}
              className={cn(
                'focus-visible:ring-ring/60 relative mb-1 grid size-9 place-items-center rounded-[9px] transition-colors outline-none focus-visible:ring-2',
                segretario.open
                  ? 'bg-ai-soft text-ai-star shadow-[inset_0_0_0_1px_hsl(var(--ai-line)/0.6)]'
                  : 'text-faint-foreground hover:bg-hover hover:text-ai-star'
              )}
            >
              <CompassStar className="size-[19px]" />
              {segretario.attention && !segretario.open && (
                <span className="bg-urgent ring-background absolute top-[7px] right-[7px] size-[7px] rounded-full ring-2" />
              )}
            </button>
          </ActionTooltip>
        )}
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
              {syncSummary.indexing && (
                <span className="mt-2 block font-normal">
                  <span className="text-muted-foreground block">
                    Lettura della posta per la ricerca:{' '}
                    {syncSummary.indexing.indexed.toLocaleString('it-IT')} di{' '}
                    {syncSummary.indexing.total.toLocaleString('it-IT')}
                  </span>
                  <span className="bg-hover mt-1 block h-1 overflow-hidden rounded-full">
                    <span
                      className="bg-foreground/60 block h-full rounded-full"
                      style={{
                        width: `${Math.round((syncSummary.indexing.indexed / syncSummary.indexing.total) * 100)}%`
                      }}
                    />
                  </span>
                </span>
              )}
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
