import { ListFilter, Search, X } from 'lucide-react'

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
import { useCommandKeys } from '@renderer/lib/command-shortcuts'
import { cn, formatCount } from '@renderer/lib/utils'
import type { MessageListFilter } from '@shared/models'

import type { MessageListViewProps } from './message-list-view'
import { MessageListControls, MessageListTitle } from './message-list-shared'

const FILTER_OPTIONS: ReadonlyArray<{ value: MessageListFilter; label: string }> = [
  { value: 'all', label: 'Tutti i messaggi' },
  { value: 'unread', label: 'Non letti' },
  { value: 'flagged', label: 'Contrassegnati' }
]

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
  selectedCount,
  canSelectAll
}: MessageListHeaderProps): React.JSX.Element {
  const searchKeys = useCommandKeys('search')
  const activeFilter = FILTER_OPTIONS.find((option) => option.value === filter)

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
              ? formatCount(selectedCount, 'selezionato', 'selezionati')
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
              Cerca in tutti i messaggi di «{searchScopeLabel}», testo compreso, senza badare a
              maiuscole e accenti. Usa <b>da:</b> <b>a:</b> <b>oggetto:</b> per restringere a un
              campo, <b>OR</b> per alternative.
            </TooltipContent>
          </Tooltip>
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
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
            placeholder={`Cerca in ${searchScopeLabel}`}
            aria-label={`Cerca in ${searchScopeLabel}`}
            spellCheck={false}
            autoComplete="off"
            className="placeholder:text-faint-foreground min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
          />
          {search ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Cancella ricerca"
                  className="text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 grid size-5 shrink-0 place-items-center rounded-[4px] outline-none focus-visible:ring-2"
                >
                  <X className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Cancella ricerca</TooltipContent>
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
                  aria-label={`Filtro: ${activeFilter?.label ?? ''}`}
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
            <TooltipContent side="bottom">Mostra: {activeFilter?.label}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Mostra</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(next) => onFilterChange(next as MessageListFilter)}
            >
              {FILTER_OPTIONS.map((option) => (
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
