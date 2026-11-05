import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, FolderPlus, Search } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'
import type { Project } from '@shared/segretario'
import { foldSearchText } from '@shared/search'

/** With nothing typed, how many of the quieter projects follow those in corso. */
const QUIET_SHOWN = 40
/** How many matches a search lists: past these, typing more narrows them. */
const MATCHES_SHOWN = 80

type Entry =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'project'; key: string; project: Project; linked: boolean }
  | { kind: 'create'; key: string; title: string }

export interface ProjectPickerProps {
  projects: ReadonlyArray<Project>
  /** The projects the conversation is in: marked, and picked again to take it out. */
  linkedIds: ReadonlyArray<string>
  /** Puts the conversation in a project, or — one it is in — takes it out. */
  onToggle: (project: Project, linked: boolean) => void
  /** Offers to make the project searched for, when none has that name. */
  onCreate?: (title: string) => void
}

/**
 * The projects, found as fast as they can be typed: with nothing typed,
 * those the conversation is in, then those in corso, the most recently
 * moved first, then the concluded; typing narrows to those whose name
 * matches, case and accents aside. Arrows move, Invio picks.
 */
export function ProjectPicker({
  projects,
  linkedIds,
  onToggle,
  onCreate
}: ProjectPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const entries = useMemo((): Entry[] => {
    const folded = foldSearchText(query.trim())
    const linked = new Set(linkedIds)
    const visible = projects.filter((project) => !project.hidden || linked.has(project.id))
    const entry = (project: Project, section: string): Entry => ({
      kind: 'project',
      key: `${section}:${project.id}`,
      project,
      linked: linked.has(project.id)
    })

    if (folded) {
      const matches = visible.filter((project) =>
        foldSearchText(`${project.title} ${project.description ?? ''}`).includes(folded)
      )
      const exact = visible.some((project) => foldSearchText(project.title) === folded)

      return [
        ...matches.slice(0, MATCHES_SHOWN).map((project) => entry(project, 'match')),
        ...(onCreate && !exact
          ? [{ kind: 'create' as const, key: 'create', title: query.trim() }]
          : [])
      ]
    }

    const mine = visible.filter((project) => linked.has(project.id))
    const others = visible.filter((project) => !linked.has(project.id))
    const active = others.filter((project) => !project.closed)
    const closed = others.filter((project) => project.closed).slice(0, QUIET_SHOWN)

    return [
      ...(mine.length > 0
        ? [
            { kind: 'heading' as const, key: 'heading:mine', label: 'Qui' },
            ...mine.map((project) => entry(project, 'mine'))
          ]
        : []),
      ...(active.length > 0
        ? [
            { kind: 'heading' as const, key: 'heading:active', label: 'In corso' },
            ...active.map((project) => entry(project, 'active'))
          ]
        : []),
      ...(closed.length > 0
        ? [
            { kind: 'heading' as const, key: 'heading:closed', label: 'Conclusi' },
            ...closed.map((project) => entry(project, 'closed'))
          ]
        : [])
    ]
  }, [linkedIds, onCreate, projects, query])

  const choosable = useMemo(
    () => entries.flatMap((entry, index) => (entry.kind === 'heading' ? [] : [index])),
    [entries]
  )
  const activeEntryIndex = choosable[Math.min(activeIndex, choosable.length - 1)] ?? -1

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-entry-index="${activeEntryIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeEntryIndex])

  const choose = (entry: Entry | undefined): void => {
    if (entry?.kind === 'create') {
      onCreate?.(entry.title)
    } else if (entry?.kind === 'project') {
      onToggle(entry.project, !entry.linked)
    }
  }

  return (
    <div className="flex w-80 flex-col">
      <div className="border-border/60 relative border-b p-1 pb-1.5">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActiveIndex((current) =>
                choosable.length === 0
                  ? 0
                  : (Math.min(current, choosable.length - 1) + step + choosable.length) %
                    choosable.length
              )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(entries[activeEntryIndex])
            }
          }}
          placeholder="Cerca un progetto…"
          aria-label="Cerca un progetto"
          spellCheck={false}
          autoComplete="off"
          className="bg-background/60 border-border/70 focus-visible:ring-ring/60 h-7 w-full rounded-md border pr-2 pl-7 text-[12px] outline-none focus-visible:ring-2"
        />
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-multiselectable
        className="max-h-80 overflow-y-auto p-1"
      >
        {entries.length === 0 && (
          <p className="text-muted-foreground px-2 py-3 text-center text-[11.5px]">
            {query.trim()
              ? 'Nessun risultato.'
              : 'Nessun progetto, per ora: il Segretario li riconosce leggendo la posta. Scrivi un nome per crearne uno.'}
          </p>
        )}
        {entries.map((entry, index) => {
          if (entry.kind === 'heading') {
            return (
              <p
                key={entry.key}
                className="text-muted-foreground px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-widest uppercase"
              >
                {entry.label}
              </p>
            )
          }

          const active = index === activeEntryIndex
          const hover = (): void => {
            const position = choosable.indexOf(index)

            if (position >= 0) {
              setActiveIndex(position)
            }
          }

          return (
            <button
              key={entry.key}
              type="button"
              role="option"
              aria-selected={entry.kind === 'project' ? entry.linked : false}
              data-entry-index={index}
              onMouseEnter={hover}
              onClick={() => choose(entry)}
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px]',
                active && 'bg-secondary',
                entry.kind === 'create' && 'text-primary'
              )}
            >
              {entry.kind === 'create' ? (
                <>
                  <FolderPlus className="size-3.5 shrink-0" />
                  <span className="min-w-0 truncate">Crea «{entry.title}»</span>
                </>
              ) : (
                <>
                  <span className="grid size-3.5 shrink-0 place-items-center">
                    {entry.linked && <Check className="text-primary size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{entry.project.title}</span>
                  {entry.linked && active ? (
                    <span className="text-muted-foreground shrink-0 text-[10.5px]">togli</span>
                  ) : (
                    entry.project.conversations > 0 && (
                      <span className="text-faint-foreground shrink-0 text-[10.5px] tabular-nums">
                        {entry.project.conversations}
                      </span>
                    )
                  )}
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The picker as a popover under its trigger, mounted anew at each opening. */
export function ProjectPickerPopover({
  open,
  onOpenChange,
  trigger,
  align = 'start',
  side,
  ...picker
}: ProjectPickerProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  align?: 'start' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
}): React.JSX.Element {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} side={side} className="p-0">
        {open && <ProjectPicker {...picker} />}
      </PopoverContent>
    </Popover>
  )
}
