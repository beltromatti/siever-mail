import { useEffect, useRef } from 'react'
import { CloudOff, Forward, LoaderCircle, MailOpen, PenLine, Plus, Reply, X } from 'lucide-react'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { cn } from '@renderer/lib/utils'

import { addressDisplayName } from './address-tokens'
import { COMPOSER_TITLES, type ComposerKind, type ComposerSummary } from './mail-composer'

const KIND_ICONS = { new: PenLine, reply: Reply, forward: Forward } as const

/** A message being written, as its tab shows it. */
export interface ComposerTab {
  id: string
  kind: ComposerKind
  summary: ComposerSummary | null
}

function tabTitle(tab: ComposerTab): string {
  const summary = tab.summary
  const subject = summary?.subject.trim()

  if (subject) {
    return subject
  }

  const [first] = summary?.recipients ?? []
  return first
    ? `${COMPOSER_TITLES[summary?.kind ?? tab.kind]} · ${addressDisplayName(first)}`
    : COMPOSER_TITLES[summary?.kind ?? tab.kind]
}

/** Who it goes to, in the tooltip: the tab itself has room for the subject only. */
function tabHint(tab: ComposerTab): string {
  const [first, ...others] = tab.summary?.recipients ?? []
  const to = first
    ? `A ${addressDisplayName(first)}${others.length > 0 ? ` e altri ${others.length}` : ''}`
    : 'Nessun destinatario'
  const state = tab.summary?.status?.state
  const saved =
    state === 'saving'
      ? 'Salvataggio in Bozze…'
      : state === 'error'
        ? 'Salvata su questo computer, non ancora in Bozze'
        : null

  return [to, saved].filter(Boolean).join(' · ')
}

const TAB =
  'group relative flex h-[30px] min-w-[7.5rem] max-w-[15rem] shrink items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60'

/**
 * The tabs of the reading pane, while something is being written (vision
 * §6.6): the message being read first, then each message being written —
 * the latest last — and a new one. A message clicked in the list brings
 * the reading tab forward; the others stay exactly as they were left. ×
 * closes a message, keeping its draft in Bozze.
 */
export function ComposerTabs({
  readingLabel,
  tabs,
  activeId,
  atWindowTopRight,
  onSelect,
  onClose,
  onNew
}: {
  /** The message the reading tab shows: its subject, or nothing. */
  readingLabel: string | null
  tabs: ReadonlyArray<ComposerTab>
  /** The message in front; null for the reading tab. */
  activeId: string | null
  /** The strip is the window's title bar there: clear of its buttons on Windows. */
  atWindowTopRight: boolean
  onSelect: (id: string | null) => void
  onClose: (id: string) => void
  onNew: () => void
}): React.JSX.Element {
  const stripRef = useRef<HTMLDivElement | null>(null)

  // The tab in front is always in sight, however many there are.
  useEffect(() => {
    const strip = stripRef.current
    const tab = strip?.querySelector<HTMLElement>('[aria-selected="true"]')
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, tabs.length])

  return (
    <div
      className={cn(
        'window-drag-region bg-background flex h-[38px] shrink-0 items-end gap-1 border-b pl-2',
        atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-2'
      )}
    >
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Lettura e messaggi in scrittura"
        // The tabs scroll sideways when they do not fit; the wheel moves them too.
        onWheel={(event) => {
          if (event.deltaY !== 0 && stripRef.current) {
            stripRef.current.scrollLeft += event.deltaY
          }
        }}
        className="window-no-drag -mb-px flex min-w-0 [scrollbar-width:none] items-end gap-1 overflow-x-auto"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeId === null}
          onClick={() => onSelect(null)}
          title={readingLabel ?? undefined}
          className={cn(
            TAB,
            activeId === null
              ? 'bg-page text-foreground border-border'
              : 'text-muted-foreground hover:bg-hover hover:text-foreground border-transparent'
          )}
        >
          <MailOpen className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{readingLabel || 'Lettura'}</span>
        </button>

        {tabs.map((tab) => {
          const Icon = KIND_ICONS[tab.summary?.kind ?? tab.kind]
          const state = tab.summary?.status?.state
          const active = tab.id === activeId

          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={active}
              title={tabHint(tab)}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(tab.id)
                }
              }}
              // A middle click closes it, as it closes a tab anywhere.
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault()
                  onClose(tab.id)
                }
              }}
              className={cn(
                TAB,
                'cursor-default pr-1',
                active
                  ? 'bg-page text-foreground border-border'
                  : 'text-muted-foreground hover:bg-hover hover:text-foreground border-transparent'
              )}
            >
              {state === 'saving' ? (
                <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
              ) : state === 'error' ? (
                <CloudOff className="text-warning size-3.5 shrink-0" />
              ) : (
                <Icon className="text-primary size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{tabTitle(tab)}</span>
              <button
                type="button"
                aria-label={`Chiudi ${tabTitle(tab)} e tienila in Bozze`}
                title="Chiudi e tieni in Bozze"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.id)
                }}
                className={cn(
                  'hover:bg-secondary text-muted-foreground hover:text-foreground grid size-5 shrink-0 place-items-center rounded-sm',
                  !active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
      </div>

      <ActionTooltip label="Nuovo messaggio" commandId="compose" side="bottom">
        <button
          type="button"
          aria-label="Nuovo messaggio"
          onClick={onNew}
          className="window-no-drag text-muted-foreground hover:bg-hover hover:text-foreground mb-1 grid size-7 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
        >
          <Plus className="size-4" />
        </button>
      </ActionTooltip>
    </div>
  )
}
