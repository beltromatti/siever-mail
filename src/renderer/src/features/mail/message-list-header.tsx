import { ListFilter, LoaderCircle, Search, Square, X } from 'lucide-react'

import { CompassStar } from '@renderer/components/ui/compass-star'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { IS_MAC, useCommandKeys } from '@renderer/lib/command-shortcuts'
import { useMessages } from '@renderer/lib/i18n'
import { cn, formatCount } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import type { MessageListFilter } from '@shared/models'
import { SEARCH_FIELD_PREFIXES } from '@shared/search'

import type { MessageListViewProps } from './message-list-view'
import { MessageListControls, MessageListTitle } from './message-list-shared'

const MESSAGES = defineMessages({
  allMessages: { en: 'All messages', it: 'Tutti i messaggi', de: 'Alle Nachrichten' },
  unread: { en: 'Unread', it: 'Non letti', de: 'Ungelesen' },
  flagged: { en: 'Flagged', it: 'Contrassegnati', de: 'Markiert' },
  active: { en: 'Active', it: 'Attivi', de: 'Aktiv' },
  selectedOne: { en: 'selected', it: 'selezionato', de: 'ausgewählt' },
  selectedOther: { en: 'selected', it: 'selezionati', de: 'ausgewählt' },
  searchHelp: {
    en: (scope: string) =>
      `Searches every message in “${scope}”, text included, ignoring capitals and accents. Use`,
    it: (scope: string) =>
      `Cerca in tutti i messaggi di «${scope}», testo compreso, senza badare a maiuscole e accenti. Usa`,
    de: (scope: string) =>
      `Durchsucht alle Nachrichten in „${scope}“, auch den Text, ohne auf Groß- und Kleinschreibung oder Akzente zu achten. Mit`
  },
  orKeyword: { en: 'OR', it: 'OR', de: 'OR' },
  searchHelpField: {
    en: 'to narrow to one field,',
    it: 'per restringere a un campo,',
    de: 'schränken Sie auf ein Feld ein, mit'
  },
  searchHelpOr: {
    en: 'for alternatives.',
    it: 'per alternative.',
    de: 'suchen Sie Alternativen.'
  },
  searchIn: {
    en: (scope: string) => `Search in ${scope}`,
    it: (scope: string) => `Cerca in ${scope}`,
    de: (scope: string) => `In ${scope} suchen`
  },
  stopSearch: { en: 'Stop the search', it: 'Ferma la ricerca', de: 'Suche anhalten' },
  askSegretario: {
    en: 'Ask the Segretario',
    it: 'Chiedi al Segretario',
    de: 'Den Segretario fragen'
  },
  segretarioSearching: {
    en: 'The Segretario is searching: stop',
    it: 'Il Segretario sta cercando: ferma',
    de: 'Der Segretario sucht: anhalten'
  },
  askSegretarioTip: {
    en: (keys: string) => `Ask the Segretario: search the way you would say it · ${keys}`,
    it: (keys: string) => `Chiedi al Segretario: cerca come lo diresti · ${keys}`,
    de: (keys: string) => `Den Segretario fragen: suchen, wie Sie es sagen würden · ${keys}`
  },
  enterKey: { en: 'Ctrl+Enter', it: 'Ctrl+Invio', de: 'Strg+Eingabe' },
  clearSearch: { en: 'Clear search', it: 'Cancella ricerca', de: 'Suche löschen' },
  filterLabel: {
    en: (label: string) => `Filter: ${label}`,
    it: (label: string) => `Filtro: ${label}`,
    de: (label: string) => `Filter: ${label}`
  },
  showTip: {
    en: (label: string) => `Show: ${label}`,
    it: (label: string) => `Mostra: ${label}`,
    de: (label: string) => `Anzeigen: ${label}`
  },
  show: { en: 'Show', it: 'Mostra', de: 'Anzeigen' }
})

/**
 * The top of the message list: what it shows and how many, the controls
 * for its order and selection, and below them the search and the filter.
 * Its first band is the window's title bar, dragged like one; on Windows,
 * where the list is the pane in the top right corner, it keeps clear of the
 * window's own buttons.
 */
export type MessageListHeaderProps = Pick<
  MessageListViewProps,
  | 'title'
  | 'searchQuery'
  | 'onClearSearch'
  | 'countLabel'
  | 'atWindowTopRight'
  | 'sort'
  | 'onSortChange'
  | 'grouping'
  | 'onGroupingChange'
  | 'onClearSelection'
  | 'onSelectAll'
  | 'search'
  | 'onSearchChange'
  | 'searchInputRef'
  | 'searchScopeLabel'
  | 'filter'
  | 'onFilterChange'
  | 'showActiveFilter'
  | 'askSegretario'
> & {
  selectedCount: number
  /** Whether there are rows to select. */
  canSelectAll: boolean
}

export function MessageListHeader({
  title,
  searchQuery,
  onClearSearch,
  countLabel,
  atWindowTopRight,
  sort,
  onSortChange,
  grouping,
  onGroupingChange,
  onClearSelection,
  onSelectAll,
  search,
  onSearchChange,
  searchInputRef,
  searchScopeLabel,
  filter,
  onFilterChange,
  showActiveFilter,
  askSegretario,
  selectedCount,
  canSelectAll
}: MessageListHeaderProps): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const prefixes = useMessages(SEARCH_FIELD_PREFIXES)
  const searchKeys = useCommandKeys('search')
  const filterOptions: ReadonlyArray<{ value: MessageListFilter; label: string }> = [
    { value: 'all', label: m.allMessages },
    { value: 'unread', label: m.unread },
    { value: 'flagged', label: m.flagged },
    // With the Segretario on: what has something open, or a reply waiting, wherever it is.
    ...(showActiveFilter ? [{ value: 'active' as const, label: m.active }] : [])
  ]
  const activeFilter = filterOptions.find((option) => option.value === filter)

  return (
    <header className="shrink-0 border-b">
      <div
        className={cn(
          'window-drag-region flex h-[52px] items-center gap-2 pl-4',
          atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-2'
        )}
      >
        <div className="min-w-0 flex-1">
          <MessageListTitle
            title={title}
            searchQuery={searchQuery}
            onClearSearch={onClearSearch}
            className="display-title text-[16px] leading-5"
          />
          <p className="text-faint-foreground truncate text-[11px] leading-4">
            {selectedCount > 1
              ? formatCount(selectedCount, m.selectedOne, m.selectedOther)
              : countLabel}
          </p>
        </div>

        <div className="window-no-drag">
          <MessageListControls
            sort={sort}
            onSortChange={onSortChange}
            grouping={grouping}
            onGroupingChange={onGroupingChange}
            selectedCount={selectedCount}
            onClearSelection={onClearSelection}
            onSelectAll={onSelectAll}
            canSelectAll={canSelectAll}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-2.5">
        <label className="field relative flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-md pr-1.5 pl-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Search className="text-faint-foreground size-3.5 shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72 font-normal">
              {m.searchHelp(searchScopeLabel)} <b>{prefixes.from}:</b> <b>{prefixes.to}:</b>{' '}
              <b>{prefixes.subject}:</b> {m.searchHelpField} <b>{m.orKeyword}</b> {m.searchHelpOr}
            </TooltipContent>
          </Tooltip>
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              // ⌘↵ / Ctrl+↵: the Segretario searches as the words mean.
              if (
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey) &&
                askSegretario &&
                search.trim().length >= 2
              ) {
                event.preventDefault()
                askSegretario.onAsk(search.trim())
                return
              }

              if (event.key !== 'Escape') {
                return
              }

              // First Escape empties the field, the next one leaves it.
              event.preventDefault()

              if (search) {
                onSearchChange('')
              } else {
                event.currentTarget.blur()
              }
            }}
            placeholder={m.searchIn(searchScopeLabel)}
            aria-label={m.searchIn(searchScopeLabel)}
            spellCheck={false}
            autoComplete="off"
            className="placeholder:text-faint-foreground min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
          />
          {askSegretario && search.trim().length >= 2 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() =>
                    askSegretario.busy ? askSegretario.onStop() : askSegretario.onAsk(search.trim())
                  }
                  aria-label={askSegretario.busy ? m.stopSearch : m.askSegretario}
                  className="text-ai-star hover:bg-ai-soft focus-visible:ring-ring/60 group grid size-5 shrink-0 place-items-center rounded-[4px] outline-none focus-visible:ring-2"
                >
                  {askSegretario.busy ? (
                    <>
                      <LoaderCircle className="size-3.5 animate-spin group-hover:hidden" />
                      <Square className="hidden size-3 fill-current group-hover:block" />
                    </>
                  ) : (
                    <CompassStar className="size-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {askSegretario.busy
                  ? m.segretarioSearching
                  : m.askSegretarioTip(IS_MAC ? '⌘↵' : m.enterKey)}
              </TooltipContent>
            </Tooltip>
          )}
          {search ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label={m.clearSearch}
                  className="text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 grid size-5 shrink-0 place-items-center rounded-[4px] outline-none focus-visible:ring-2"
                >
                  <X className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{m.clearSearch}</TooltipContent>
            </Tooltip>
          ) : (
            searchKeys && <ShortcutKeys keys={searchKeys} className="shrink-0" />
          )}
        </label>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={m.filterLabel(activeFilter?.label ?? '')}
                  className={cn(
                    'focus-visible:ring-ring/60 flex h-[30px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-[550] outline-none focus-visible:ring-2',
                    filter === 'all'
                      ? 'text-faint-foreground hover:bg-hover hover:text-foreground'
                      : 'button-raised'
                  )}
                >
                  <ListFilter className="size-3.5" />
                  {filter !== 'all' && activeFilter?.label}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{m.showTip(activeFilter?.label ?? '')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>{m.show}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(next) => onFilterChange(next as MessageListFilter)}
            >
              {filterOptions.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
