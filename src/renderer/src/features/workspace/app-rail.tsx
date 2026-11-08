import type { LucideIcon } from 'lucide-react'
import { CalendarDays, Mail, Settings } from 'lucide-react'
import { Fragment } from 'react'

import appMark from '@renderer/assets/logo-128.png'
import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

import type { ConnectionsStatus } from '@renderer/features/connections/connection-health'
import { HealthDot } from '@renderer/features/connections/health-dot'
import { AppEdition } from '@renderer/features/workspace/app-edition'

export interface RailItem {
  id: string
  label: string
  icon: LucideIcon
  /** Items of a group sit together; a thin line parts one group from the next. */
  group: string
  /** A dot on the icon: something there wants the user. */
  attention?: boolean
  /** Not here yet: it opens on what it will be. */
  soon?: boolean
}

/**
 * The column on the far left: the app's mark — which SIEVER Mail this is, and
 * the way back to the welcome screen —, the apps in their groups — the
 * Segretario's desk, the sources, the views derived from them — and, at the
 * bottom, how the connections are and the way to Settings. It is the
 * window's edge, so its top is the title bar the window is dragged by.
 */
export function AppRail({
  items,
  activeItemId,
  onSelectItem,
  onOpenWelcome,
  connections,
  segretario,
  onOpenSettings,
  onOpenConnections
}: {
  items: ReadonlyArray<RailItem>
  activeItemId: string
  onSelectItem: (id: string) => void
  /** The welcome screen again, over the workspace that keeps working under it. */
  onOpenWelcome: () => void
  /** How every connection stands — mail and calendars — null with none. */
  connections: ConnectionsStatus | null
  /** The Segretario's panel, open or not and whether something waits in it; null with the AI off. */
  segretario: { open: boolean; attention: boolean; onToggle: () => void } | null
  onOpenSettings: () => void
  /** Settings › Connessioni, where a connection is put right. */
  onOpenConnections: () => void
}): React.JSX.Element {
  return (
    <nav
      aria-label="Sezioni"
      className="window-drag-region flex h-full w-[52px] flex-col items-center border-r pt-[var(--titlebar-band)] pb-3"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Schermata iniziale"
            onClick={onOpenWelcome}
            className="window-no-drag group focus-visible:ring-ring/60 relative mt-0.5 mb-3 grid size-9 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2"
          >
            <span
              aria-hidden
              className="logo-glow absolute -inset-3 rounded-full opacity-0 transition-opacity duration-300 [--glow:3] group-hover:opacity-100"
            />
            <img
              src={appMark}
              alt=""
              draggable={false}
              className="relative size-[30px] drop-shadow-[0_1px_2px_hsl(var(--shadow)/0.35)] transition-[transform,filter] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] select-none group-hover:scale-110 group-hover:drop-shadow-[0_3px_6px_hsl(var(--shadow)/0.35)] group-active:scale-95 group-active:duration-100 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <AppEdition
            className="font-semibold"
            extensionClassName="text-muted-foreground font-normal"
          />
          <span className="text-faint-foreground mt-1.5 block font-normal">
            Clic: schermata iniziale
          </span>
        </TooltipContent>
      </Tooltip>

      <div className="window-no-drag flex flex-col items-center gap-1">
        {items.map((item, index) => {
          const Icon = item.icon
          const active = item.id === activeItemId
          const startsGroup = index > 0 && items[index - 1].group !== item.group

          return (
            <Fragment key={item.id}>
              {startsGroup && <span aria-hidden className="bg-border my-1 h-px w-5" />}
              <Tooltip>
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
            </Fragment>
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
        {connections && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={connections.title}
                onClick={onOpenConnections}
                className="hover:bg-hover focus-visible:ring-ring/60 grid size-9 place-items-center rounded-[9px] outline-none focus-visible:ring-2"
              >
                <HealthDot health={connections.health} className="size-[7px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-80">
              <span className="block font-semibold">{connections.title}</span>
              <span className="mt-1.5 flex flex-col gap-1 font-normal">
                {connections.standings.map((standing) => {
                  const Icon = standing.family === 'posta' ? Mail : CalendarDays
                  return (
                    <span key={standing.key} className="flex min-w-0 items-start gap-1.5">
                      <HealthDot health={standing.health} className="mt-[5px] size-[6px]" />
                      <Icon className="text-muted-foreground mt-px size-3 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate">{standing.label}</span>
                        <span className="text-muted-foreground block">{standing.text}</span>
                      </span>
                    </span>
                  )
                })}
              </span>
              {connections.indexing && (
                <span className="mt-2 block font-normal">
                  <span className="text-muted-foreground block">
                    Lettura della posta per la ricerca:{' '}
                    {connections.indexing.indexed.toLocaleString('it-IT')} di{' '}
                    {connections.indexing.total.toLocaleString('it-IT')}
                  </span>
                  <span className="bg-hover mt-1 block h-1 overflow-hidden rounded-full">
                    <span
                      className="bg-foreground/60 block h-full rounded-full"
                      style={{
                        width: `${Math.round((connections.indexing.indexed / connections.indexing.total) * 100)}%`
                      }}
                    />
                  </span>
                </span>
              )}
              <span className="text-faint-foreground mt-2 block font-normal">
                Clic: Impostazioni › Connessioni
              </span>
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
