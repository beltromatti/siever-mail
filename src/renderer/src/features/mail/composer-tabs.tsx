import { useEffect, useRef } from 'react'
import { CloudOff, Forward, LoaderCircle, MailOpen, PenLine, Plus, Reply, X } from 'lucide-react'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, type Messages } from '@shared/i18n'

import { addressDisplayName } from './address-tokens'
import { COMPOSER_TITLES, type ComposerKind, type ComposerSummary } from './mail-composer'

const MESSAGES = defineMessages({
  to: {
    en: (name: string, others: number) =>
      `To ${name}${others === 0 ? '' : others === 1 ? ' and 1 other' : ` and ${others} others`}`,
    it: (name: string, others: number) => `A ${name}${others > 0 ? ` e altri ${others}` : ''}`,
    de: (name: string, others: number) => `An ${name}${others > 0 ? ` und ${others} weitere` : ''}`
  },
  noRecipient: { en: 'No recipient', it: 'Nessun destinatario', de: 'Kein Empfänger' },
  savingToDrafts: {
    en: 'Saving to Drafts…',
    it: 'Salvataggio in Bozze…',
    de: 'Wird in Entwürfen gespeichert…'
  },
  notInDraftsYet: {
    en: 'Saved on this computer, not in Drafts yet',
    it: 'Salvata su questo computer, non ancora in Bozze',
    de: 'Auf diesem Computer gespeichert, noch nicht in den Entwürfen'
  },
  tabs: {
    en: 'Reading and messages being written',
    it: 'Lettura e messaggi in scrittura',
    de: 'Lesen und Nachrichten in Arbeit'
  },
  reading: { en: 'Reading', it: 'Lettura', de: 'Lesen' },
  closeNamed: {
    en: (title: string) => `Close ${title} and keep it in Drafts`,
    it: (title: string) => `Chiudi ${title} e tienila in Bozze`,
    de: (title: string) => `${title} schließen und in Entwürfen behalten`
  },
  closeKeepInDrafts: {
    en: 'Close and keep in Drafts',
    it: 'Chiudi e tieni in Bozze',
    de: 'Schließen und in Entwürfen behalten'
  }
})

const KIND_ICONS = { new: PenLine, reply: Reply, forward: Forward } as const

/** A message being written, as its tab shows it. */
export interface ComposerTab {
  id: string
  kind: ComposerKind
  summary: ComposerSummary | null
}

function tabTitle(tab: ComposerTab, titles: Messages<typeof COMPOSER_TITLES>): string {
  const summary = tab.summary
  const subject = summary?.subject.trim()

  if (subject) {
    return subject
  }

  const [first] = summary?.recipients ?? []
  return first
    ? `${titles[summary?.kind ?? tab.kind]} · ${addressDisplayName(first)}`
    : titles[summary?.kind ?? tab.kind]
}

/** Who it goes to, in the tooltip: the tab itself has room for the subject only. */
function tabHint(tab: ComposerTab, m: Messages<typeof MESSAGES>): string {
  const [first, ...others] = tab.summary?.recipients ?? []
  const to = first ? m.to(addressDisplayName(first), others.length) : m.noRecipient
  const state = tab.summary?.status?.state
  const saved = state === 'saving' ? m.savingToDrafts : state === 'error' ? m.notInDraftsYet : null

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
  const m = useMessages(MESSAGES)
  const titles = useMessages(COMPOSER_TITLES)
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
        aria-label={m.tabs}
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
          <span className="min-w-0 truncate">{readingLabel || m.reading}</span>
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
              title={tabHint(tab, m)}
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
              <span className="min-w-0 flex-1 truncate">{tabTitle(tab, titles)}</span>
              <button
                type="button"
                aria-label={m.closeNamed(tabTitle(tab, titles))}
                title={m.closeKeepInDrafts}
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

      <ActionTooltip label={titles.new} commandId="compose" side="bottom">
        <button
          type="button"
          aria-label={titles.new}
          onClick={onNew}
          className="window-no-drag text-muted-foreground hover:bg-hover hover:text-foreground mb-1 grid size-7 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
        >
          <Plus className="size-4" />
        </button>
      </ActionTooltip>
    </div>
  )
}
