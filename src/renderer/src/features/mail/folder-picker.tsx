import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FolderPlus, Search } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { buildFolderTree, flattenFolderTree, folderNodeLabel } from '@renderer/lib/folder-tree'
import { useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { folderDisplayName, folderRole } from '@shared/folders'
import { defineMessages, type Language } from '@shared/i18n'
import type { MailFolder } from '@shared/models'
import { foldSearchText } from '@shared/search'

import { folderIcon } from './folder-icons'

const MESSAGES = defineMessages({
  recent: { en: 'Recent', it: 'Recenti', de: 'Zuletzt verwendet' },
  allFolders: { en: 'All folders', it: 'Tutte le cartelle', de: 'Alle Ordner' },
  searchFolder: { en: 'Search for a folder', it: 'Cerca una cartella', de: 'Ordner suchen' },
  searchFolderPlaceholder: {
    en: 'Search for a folder…',
    it: 'Cerca una cartella…',
    de: 'Ordner suchen…'
  },
  noFolder: {
    en: 'No folder with this name.',
    it: 'Nessuna cartella con questo nome.',
    de: 'Kein Ordner mit diesem Namen.'
  },
  createAndMove: {
    en: (name: string) => `Create “${name}” and move here`,
    it: (name: string) => `Crea «${name}» e sposta qui`,
    de: (name: string) => `„${name}“ erstellen und hierher verschieben`
  },
  alreadyHere: {
    en: 'The messages are already here',
    it: 'I messaggi sono già qui',
    de: 'Die Nachrichten sind bereits hier'
  }
})

type PickerEntry =
  | {
      kind: 'folder'
      key: string
      label: string
      /** Where it sits, for a folder found by searching: "Clienti › 2024". */
      hint?: string
      depth: number
      folder: MailFolder | null
      disabled: boolean
    }
  | { kind: 'create'; key: string; name: string }

export interface FolderPickerProps {
  /** The folders of the account the messages are in. */
  folders: ReadonlyArray<MailFolder>
  /** The account's recent destinations, the latest first (see `listRecentFolders`). */
  recentPaths: ReadonlyArray<string>
  /** Where the messages already are: shown, not offered. */
  excludedPath: string | null
  onPick: (folderPath: string) => void
  /** Offers to create the folder searched for, when the account has none of that name. */
  onCreate?: (name: string) => void
}

/** "Clienti/2024/Fatture" as it reads: "Clienti › 2024". */
function parentHint(
  folder: MailFolder,
  folders: ReadonlyArray<MailFolder>,
  language: Language
): string | undefined {
  if (!folder.delimiter) {
    return undefined
  }

  const parts = folder.path.split(folder.delimiter).slice(0, -1)
  const names = parts.map((_, index) => {
    const path = parts.slice(0, index + 1).join(folder.delimiter)
    const parent = folders.find((candidate) => candidate.path === path)
    return parent ? folderDisplayName(parent, language) : parts[index]
  })

  return names.length > 0 ? names.join(' › ') : undefined
}

/**
 * "Sposta": where messages can go, found as fast as it can be typed. With
 * nothing typed it lists the account's recent destinations, then every
 * folder as the sidebar nests them; typing narrows that to the folders whose
 * name or place matches, case and accents aside, and offers to create the
 * folder when none has the name. Arrows move, Enter moves the messages.
 */
export function FolderPicker({
  folders,
  recentPaths,
  excludedPath,
  onPick,
  onCreate
}: FolderPickerProps): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { language } = useLanguage()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const entries = useMemo((): Array<
    PickerEntry | { kind: 'heading'; key: string; label: string }
  > => {
    const folded = foldSearchText(query.trim())
    const folderEntry = (
      folder: MailFolder,
      depth: number,
      section: string,
      hint?: string
    ): PickerEntry => ({
      kind: 'folder',
      key: `${section}:${folder.path}`,
      label: folderDisplayName(folder, language),
      hint,
      depth,
      folder,
      disabled: folder.path === excludedPath
    })

    if (folded) {
      const matches = folders.filter((folder) =>
        foldSearchText(`${folderDisplayName(folder, language)} ${folder.path}`).includes(folded)
      )
      const exactName = folders.some(
        (folder) => foldSearchText(folderDisplayName(folder, language)) === folded
      )

      return [
        ...matches.map((folder) =>
          folderEntry(folder, 0, 'match', parentHint(folder, folders, language))
        ),
        ...(onCreate && !exactName
          ? [{ kind: 'create' as const, key: 'create', name: query.trim() }]
          : [])
      ]
    }

    const recent = recentPaths
      .map((path) => folders.find((folder) => folder.path === path))
      .filter(
        (folder): folder is MailFolder => folder !== undefined && folder.path !== excludedPath
      )
      .slice(0, 5)

    return [
      ...(recent.length > 0
        ? [
            { kind: 'heading' as const, key: 'heading:recent', label: m.recent },
            ...recent.map((folder) =>
              folderEntry(folder, 0, 'recent', parentHint(folder, folders, language))
            )
          ]
        : []),
      { kind: 'heading' as const, key: 'heading:all', label: m.allFolders },
      ...flattenFolderTree(buildFolderTree([...folders])).map(({ node, depth }) =>
        node.folder
          ? folderEntry(node.folder, depth, 'tree')
          : {
              kind: 'folder' as const,
              key: `tree:${node.path}`,
              label: folderNodeLabel(node, language),
              depth,
              folder: null,
              disabled: true
            }
      )
    ]
  }, [excludedPath, folders, language, m, onCreate, query, recentPaths])

  // Only folders that take messages, and the "create" line, are reached by the arrows.
  const choosable = useMemo(
    () =>
      entries.flatMap((entry, index) =>
        entry.kind === 'create' || (entry.kind === 'folder' && !entry.disabled) ? [index] : []
      ),
    [entries]
  )
  const activeEntryIndex = choosable[Math.min(activeIndex, choosable.length - 1)] ?? -1

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-entry-index="${activeEntryIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeEntryIndex])

  const choose = (entry: PickerEntry | undefined): void => {
    if (entry?.kind === 'create') {
      onCreate?.(entry.name)
    } else if (entry?.kind === 'folder' && entry.folder && !entry.disabled) {
      onPick(entry.folder.path)
    }
  }

  return (
    <div className="flex w-72 flex-col">
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
              choose(entries[activeEntryIndex] as PickerEntry | undefined)
            }
          }}
          placeholder={m.searchFolderPlaceholder}
          aria-label={m.searchFolder}
          spellCheck={false}
          autoComplete="off"
          className="bg-background/60 border-border/70 focus-visible:ring-ring/60 h-7 w-full rounded-md border pr-2 pl-7 text-[12px] outline-none focus-visible:ring-2"
        />
      </div>

      <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-1">
        {entries.length === 0 && (
          <p className="text-muted-foreground px-2 py-3 text-center text-[11.5px]">{m.noFolder}</p>
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

          if (entry.kind === 'create') {
            return (
              <button
                key={entry.key}
                type="button"
                role="option"
                aria-selected={active}
                data-entry-index={index}
                onMouseEnter={() => setActiveIndex(choosable.indexOf(index))}
                onClick={() => choose(entry)}
                className={cn(
                  'text-primary flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px]',
                  active && 'bg-secondary'
                )}
              >
                <FolderPlus className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{m.createAndMove(entry.name)}</span>
              </button>
            )
          }

          const Icon = folderIcon(entry.folder ? folderRole(entry.folder) : null)

          return (
            <button
              key={entry.key}
              type="button"
              role="option"
              aria-selected={active}
              aria-disabled={entry.disabled}
              data-entry-index={index}
              disabled={entry.disabled}
              onMouseEnter={() => {
                if (!entry.disabled) {
                  setActiveIndex(choosable.indexOf(index))
                }
              }}
              onClick={() => choose(entry)}
              title={entry.folder?.path === excludedPath ? m.alreadyHere : undefined}
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-sm pr-2 text-left text-[12px]',
                active && 'bg-secondary',
                entry.disabled && 'text-muted-foreground/70 cursor-default'
              )}
              style={{ paddingLeft: 8 + entry.depth * 12 }}
            >
              <Icon className="text-muted-foreground size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{entry.label}</span>
              {entry.hint && (
                <span className="text-muted-foreground ml-auto min-w-0 shrink truncate text-[10.5px]">
                  {entry.hint}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** "Move" as a popover under its button: the picker, open as long as it is being used. */
export function FolderPickerPopover({
  open,
  onOpenChange,
  trigger,
  wrapTrigger,
  align = 'start',
  ...picker
}: FolderPickerProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  /** Wraps the trigger — in its tooltip — outside the popover's own handling. */
  wrapTrigger?: (trigger: React.ReactElement) => ReactNode
  align?: 'start' | 'end'
}): React.JSX.Element {
  const popoverTrigger = <PopoverTrigger asChild>{trigger}</PopoverTrigger>

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {wrapTrigger ? wrapTrigger(popoverTrigger) : popoverTrigger}
      <PopoverContent align={align} className="p-0">
        {/* Mounted anew at each opening: the search starts empty. */}
        {open && <FolderPicker {...picker} />}
      </PopoverContent>
    </Popover>
  )
}
