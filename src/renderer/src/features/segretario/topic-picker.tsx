import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FolderMinus, FolderPlus, Search } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'
import type { Topic } from '@shared/segretario'
import { foldSearchText } from '@shared/search'

/** With nothing typed, how many of the quiet topics follow those in corso. */
const QUIET_SHOWN = 40
/** How many matches a search lists: past these, typing more narrows them. */
const MATCHES_SHOWN = 80

type Entry =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'topic'; key: string; topic: Topic; current: boolean }
  | { kind: 'create'; key: string; title: string }
  | { kind: 'remove'; key: string }

export interface TopicPickerProps {
  topics: ReadonlyArray<Topic>
  /** "Pratiche", or "Argomenti": what the list is of. */
  label: string
  /** The topic the conversation is in, marked and not offered. */
  currentId?: string | null
  onPick: (topic: Topic) => void
  /** Offers to make the topic searched for, when none has that title. */
  onCreate?: (title: string) => void
  /** Offers to take the conversation out of its topic. */
  onRemove?: () => void
}

/**
 * The topics, found as fast as they can be typed: with nothing typed,
 * those with conversations, the most recently moved first, then the
 * others; typing narrows to those whose title matches, case and accents
 * aside — "2451", "valli". Arrows move, Invio picks.
 */
export function TopicPicker({
  topics,
  label,
  currentId,
  onPick,
  onCreate,
  onRemove
}: TopicPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const current = currentId ? topics.find((topic) => topic.id === currentId) : undefined

  const entries = useMemo((): Entry[] => {
    const folded = foldSearchText(query.trim())
    const open = topics.filter((topic) => !topic.archived)
    const entry = (topic: Topic, section: string): Entry => ({
      kind: 'topic',
      key: `${section}:${topic.id}`,
      topic,
      current: topic.id === currentId
    })

    if (folded) {
      const matches = topics.filter((topic) =>
        foldSearchText(`${topic.title} ${topic.description ?? ''}`).includes(folded)
      )
      const exact = topics.some((topic) => foldSearchText(topic.title) === folded)

      return [
        ...matches.slice(0, MATCHES_SHOWN).map((topic) => entry(topic, 'match')),
        ...(onCreate && !exact
          ? [{ kind: 'create' as const, key: 'create', title: query.trim() }]
          : [])
      ]
    }

    const active = open.filter((topic) => topic.conversations > 0)
    const quiet = open.filter((topic) => topic.conversations === 0).slice(0, QUIET_SHOWN)

    return [
      ...(onRemove && current ? [{ kind: 'remove' as const, key: 'remove' }] : []),
      ...(active.length > 0
        ? [
            { kind: 'heading' as const, key: 'heading:active', label: 'In corso' },
            ...active.map((topic) => entry(topic, 'active'))
          ]
        : []),
      ...(quiet.length > 0
        ? [
            {
              kind: 'heading' as const,
              key: 'heading:quiet',
              label: active.length > 0 ? 'Meno recenti' : label
            },
            ...quiet.map((topic) => entry(topic, 'quiet'))
          ]
        : [])
    ]
  }, [current, currentId, label, onCreate, onRemove, query, topics])

  const choosable = useMemo(
    () =>
      entries.flatMap((entry, index) =>
        entry.kind === 'create' ||
        entry.kind === 'remove' ||
        (entry.kind === 'topic' && !entry.current)
          ? [index]
          : []
      ),
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
    } else if (entry?.kind === 'remove') {
      onRemove?.()
    } else if (entry?.kind === 'topic' && !entry.current) {
      onPick(entry.topic)
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
          placeholder={`Cerca ${label.toLowerCase()}…`}
          aria-label={`Cerca ${label.toLowerCase()}`}
          spellCheck={false}
          autoComplete="off"
          className="bg-background/60 border-border/70 focus-visible:ring-ring/60 h-7 w-full rounded-md border pr-2 pl-7 text-[12px] outline-none focus-visible:ring-2"
        />
      </div>

      <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-1">
        {entries.length === 0 && (
          <p className="text-muted-foreground px-2 py-3 text-center text-[11.5px]">
            {query.trim()
              ? 'Nessun risultato.'
              : 'Niente, per ora: il Segretario riconosce di cosa parla la posta mentre la legge.'}
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
          const rowClass = cn(
            'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px]',
            active && 'bg-secondary'
          )
          const hover = (): void => {
            const position = choosable.indexOf(index)

            if (position >= 0) {
              setActiveIndex(position)
            }
          }

          if (entry.kind === 'create') {
            return (
              <button
                key={entry.key}
                type="button"
                role="option"
                aria-selected={active}
                data-entry-index={index}
                onMouseEnter={hover}
                onClick={() => choose(entry)}
                className={cn(rowClass, 'text-primary')}
              >
                <FolderPlus className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">Crea «{entry.title}»</span>
              </button>
            )
          }

          if (entry.kind === 'remove') {
            return (
              <button
                key={entry.key}
                type="button"
                role="option"
                aria-selected={active}
                data-entry-index={index}
                onMouseEnter={hover}
                onClick={() => choose(entry)}
                className={cn(rowClass, 'text-muted-foreground')}
              >
                <FolderMinus className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">Togli da «{current?.title}»</span>
              </button>
            )
          }

          return (
            <button
              key={entry.key}
              type="button"
              role="option"
              aria-selected={active}
              aria-disabled={entry.current}
              data-entry-index={index}
              disabled={entry.current}
              onMouseEnter={hover}
              onClick={() => choose(entry)}
              className={cn(rowClass, entry.current && 'text-muted-foreground cursor-default')}
            >
              <span className="min-w-0 flex-1 truncate">{entry.topic.title}</span>
              {entry.current ? (
                <span className="text-muted-foreground shrink-0 text-[10.5px]">qui</span>
              ) : (
                entry.topic.conversations > 0 && (
                  <span className="text-faint-foreground shrink-0 text-[10.5px] tabular-nums">
                    {entry.topic.conversations}
                  </span>
                )
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The picker as a popover under its trigger, mounted anew at each opening. */
export function TopicPickerPopover({
  open,
  onOpenChange,
  trigger,
  align = 'start',
  side,
  ...picker
}: TopicPickerProps & {
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
        {open && <TopicPicker {...picker} />}
      </PopoverContent>
    </Popover>
  )
}
