import { useEffect, useState } from 'react'
import { Forward, LoaderCircle, PenLine, Reply, X } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { IconButton } from '@renderer/components/ui/icon-button'
import { cn } from '@renderer/lib/utils'

import { addressDisplayName } from './address-tokens'
import { COMPOSER_TITLES, type ComposerKind, type ComposerSummary } from './mail-composer'

const KIND_ICONS = { new: PenLine, reply: Reply, forward: Forward } as const
const BAR_WIDTH = 248
const BAR_GAP = 8
const OVERFLOW_WIDTH = 48
/** The share of the window's width the dock may take, from the right: the list stays clear. */
const DOCK_SHARE_OF_WIDTH = 0.62

export interface ComposeDockEntry {
  id: string
  kind: ComposerKind
  summary: ComposerSummary | null
}

function dockRoom(): number {
  return window.innerWidth * DOCK_SHARE_OF_WIDTH
}

/** How many of `count` bars show in `room`; the rest fold into "+N" beside them. */
function barsShown(count: number, room: number): number {
  const all = Math.floor((room + BAR_GAP) / (BAR_WIDTH + BAR_GAP))

  return count <= all
    ? count
    : Math.max(1, Math.floor((room - OVERFLOW_WIDTH) / (BAR_WIDTH + BAR_GAP)))
}

function entryTitle(entry: ComposeDockEntry): string {
  return entry.summary?.subject.trim() || COMPOSER_TITLES[entry.summary?.kind ?? entry.kind]
}

function entryDetail(entry: ComposeDockEntry): string {
  const summary = entry.summary

  if (summary?.status?.state === 'saving') {
    return 'Salvataggio in Bozze…'
  }

  const [first, ...others] = summary?.recipients ?? []

  if (!first) {
    return 'Nessun destinatario'
  }

  const name = addressDisplayName(first)
  return others.length === 0 ? `A: ${name}` : `A: ${name} e altri ${others.length}`
}

function DockBar({
  entry,
  onRestore,
  onClose
}: {
  entry: ComposeDockEntry
  onRestore: () => void
  onClose: () => void
}): React.JSX.Element {
  const Icon = KIND_ICONS[entry.summary?.kind ?? entry.kind]
  const saving = entry.summary?.status?.state === 'saving'

  return (
    <div
      className="glass-dialog dock-enter flex h-11 shrink-0 items-center gap-1 rounded-lg pr-1"
      style={{ width: BAR_WIDTH }}
    >
      <button
        type="button"
        onClick={onRestore}
        className="focus-visible:ring-ring/70 flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-l-lg pl-3 text-left outline-none focus-visible:ring-2"
        aria-label={`Riprendi ${entryTitle(entry)}`}
      >
        {saving ? (
          <LoaderCircle className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
        ) : (
          <Icon className="text-primary size-3.5 shrink-0" />
        )}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[12px] font-medium">{entryTitle(entry)}</span>
          <span className="text-muted-foreground truncate text-[10.5px]">{entryDetail(entry)}</span>
        </span>
      </button>
      <IconButton
        label="Chiudi e salva in Bozze"
        tooltipSide="top"
        className="size-7 shrink-0"
        onClick={onClose}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}

/**
 * The messages being written that are put aside: a bar each in the bottom
 * right corner, the latest nearest the edge, as Gmail keeps them. A click
 * brings one back as it was left; × closes it, keeping its draft. Those
 * that do not fit fold into "+N". The dock steps away while a message is
 * in front, and the app's notices rise above it.
 */
export function ComposeDock({
  entries,
  hidden,
  onRestore,
  onClose
}: {
  entries: ReadonlyArray<ComposeDockEntry>
  /** A message is in front: the dock is out of its way. */
  hidden: boolean
  onRestore: (id: string) => void
  onClose: (id: string) => void
}): React.JSX.Element | null {
  const [room, setRoom] = useState(dockRoom)

  useEffect(() => {
    const onResize = (): void => setRoom(dockRoom())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (entries.length === 0) {
    return null
  }

  // The latest put aside sits by the edge; the oldest fold away first.
  const ordered = [...entries].reverse()
  const shown = ordered.slice(0, barsShown(entries.length, room))
  const folded = ordered.slice(shown.length)

  return (
    <section
      aria-label="Messaggi in scrittura"
      className={cn(
        'fixed right-3 bottom-3 z-40 flex flex-row-reverse items-end transition-[opacity,transform] duration-200',
        hidden ? 'pointer-events-none translate-y-4 opacity-0' : 'opacity-100'
      )}
      style={{ gap: BAR_GAP }}
    >
      {shown.map((entry) => (
        <DockBar
          key={entry.id}
          entry={entry}
          onRestore={() => onRestore(entry.id)}
          onClose={() => onClose(entry.id)}
        />
      ))}
      {folded.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Altri ${folded.length} messaggi in scrittura`}
              className="glass-dialog focus-visible:ring-ring/70 flex h-11 shrink-0 items-center justify-center rounded-lg text-[12px] font-medium outline-none focus-visible:ring-2"
              style={{ width: OVERFLOW_WIDTH }}
            >
              +{folded.length}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-64">
            {folded.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onSelect={() => onRestore(entry.id)}
                className="flex flex-col items-start gap-0"
              >
                <span className="w-full truncate text-[12px] font-medium">{entryTitle(entry)}</span>
                <span className="text-muted-foreground w-full truncate text-[10.5px]">
                  {entryDetail(entry)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </section>
  )
}

/** The room the dock takes along the bottom, for notices to rise above it. */
export const COMPOSE_DOCK_HEIGHT = 44 + 12
