import { Fragment } from 'react'
import {
  Archive,
  Flag,
  FolderInput,
  MailOpen,
  MailPlus,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react'

import type {
  ExtensionHostHooks,
  ExtensionSelectionContext,
  ToolbarActionDescriptor
} from '@app/extension/types'

import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import type { MailFolder, MessageListFilter } from '@shared/models'

interface MailToolbarProps {
  folders: MailFolder[]
  currentFolderPath: string | null
  search: string
  onSearchChange: (value: string) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  filter: MessageListFilter
  onFilterChange: (next: MessageListFilter) => void
  /** How many messages the actions below will apply to. */
  selectedCount: number
  toggleSeenLabel: string
  /** True when every selected message already carries the flag. */
  selectionFlagged: boolean
  /**
   * Toolbar actions contributed by the active extension (if any). Each
   * descriptor renders inline next to the host's primary "Nuovo
   * messaggio" button. Empty in the public build.
   */
  extensionToolbarActions: ReadonlyArray<ToolbarActionDescriptor>
  extensionSelection: ExtensionSelectionContext
  extensionHostHooks: ExtensionHostHooks
  onActivateExtensionPrimaryAction: () => void
  onCompose: () => void
  onOpenSettings: () => void
  onArchiveClassic: () => void
  onMoveToFolder: (folderPath: string) => void
  onDelete: () => void
  onToggleSeen: () => void
  onToggleFlagged: () => void
  onClearSelection: () => void
}

const FILTER_OPTIONS: ReadonlyArray<{ value: MessageListFilter; label: string }> = [
  { value: 'all', label: 'Tutto' },
  { value: 'unread', label: 'Non lette' },
  { value: 'flagged', label: 'Contrassegnate' }
]

/**
 * Single action bar above the workspace.
 *
 * The message actions used to appear only while a separate "multi-selection
 * mode" was engaged, which is the mode the SIEVER team kept getting stuck
 * in. There is no mode any more: the actions are simply enabled whenever
 * something is selected, and a counter appears once the selection grows
 * past one so it is always obvious how many messages the next click will
 * touch.
 */
export function MailToolbar({
  folders,
  currentFolderPath,
  search,
  onSearchChange,
  searchInputRef,
  filter,
  onFilterChange,
  selectedCount,
  toggleSeenLabel,
  selectionFlagged,
  extensionToolbarActions,
  extensionSelection,
  extensionHostHooks,
  onActivateExtensionPrimaryAction,
  onCompose,
  onOpenSettings,
  onArchiveClassic,
  onMoveToFolder,
  onDelete,
  onToggleSeen,
  onToggleFlagged,
  onClearSelection
}: MailToolbarProps): React.JSX.Element {
  const destinationFolders = folders.filter((folder) => folder.path !== currentFolderPath)
  const hasSelection = selectedCount > 0

  return (
    // Labels on the message actions appear only when the bar is actually
    // wide enough for them. At the 1180px minimum window the labelled row
    // ran past the search field, so "Segna non le…" sat clipped mid-word
    // while Contrassegna and Elimina were pushed out of sight. The query
    // measures the CONTAINER, not the viewport: the same bar is narrower in
    // the apple layout than in outlook at the same window size.
    <div className="glass-panel @container flex h-11 shrink-0 items-center gap-2 rounded-lg px-2">
      <TooltipProvider delayDuration={140}>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                onClick={onCompose}
                aria-label="Nuovo messaggio"
                className="size-8"
              >
                <MailPlus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Nuovo messaggio</TooltipContent>
          </Tooltip>

          {extensionToolbarActions.map((action) => (
            <Fragment key={action.id}>
              {action.render({
                selection: extensionSelection,
                openPrimaryActionDialog: onActivateExtensionPrimaryAction,
                hostHooks: extensionHostHooks
              })}
            </Fragment>
          ))}
        </div>

        <div className="bg-border/60 h-5 w-px shrink-0" />

        <div className="toolbar-scroll-x min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex w-max items-center gap-0.5 pr-1">
            {selectedCount > 1 && (
              <span className="text-primary mr-1 inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold">
                {selectedCount}
                <span className="hidden @[64rem]:inline">selezionate</span>
                <button
                  type="button"
                  onClick={onClearSelection}
                  aria-label="Annulla selezione"
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 inline-flex size-4 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11.5px]"
              disabled={!hasSelection}
              onClick={onArchiveClassic}
              title="Archivia"
              aria-label="Archivia"
            >
              <Archive className="size-3.5" />
              <span className="hidden @[64rem]:inline">Archivia</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11.5px]"
                  disabled={!hasSelection || destinationFolders.length === 0}
                  title="Sposta"
                  aria-label="Sposta"
                >
                  <FolderInput className="size-3.5" />
                  <span className="hidden @[64rem]:inline">Sposta</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                {destinationFolders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.path}
                    className="cursor-pointer text-[12px]"
                    onClick={() => onMoveToFolder(folder.path)}
                  >
                    {folder.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11.5px]"
              disabled={!hasSelection}
              onClick={onToggleSeen}
              title={toggleSeenLabel}
              aria-label={toggleSeenLabel}
            >
              <MailOpen className="size-3.5" />
              <span className="hidden @[64rem]:inline">{toggleSeenLabel}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 gap-1.5 px-2 text-[11.5px]',
                selectionFlagged && 'text-status-offline'
              )}
              disabled={!hasSelection}
              onClick={onToggleFlagged}
              title={selectionFlagged ? 'Rimuovi contrassegno' : 'Contrassegna'}
              aria-label={selectionFlagged ? 'Rimuovi contrassegno' : 'Contrassegna'}
            >
              <Flag className={cn('size-3.5', selectionFlagged && 'fill-current')} />
              <span className="hidden @[64rem]:inline">
                {selectionFlagged ? 'Rimuovi contrassegno' : 'Contrassegna'}
              </span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/15 hover:text-destructive h-7 gap-1.5 px-2 text-[11.5px]"
              disabled={!hasSelection}
              onClick={onDelete}
              title="Elimina"
              aria-label="Elimina"
            >
              <Trash2 className="size-3.5" />
              <span className="hidden @[64rem]:inline">Elimina</span>
            </Button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className="border-border/60 bg-background/40 flex items-center rounded-md border p-0.5"
            role="group"
            aria-label="Filtro messaggi"
          >
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => onFilterChange(option.value)}
                className={cn(
                  'focus-visible:ring-ring/70 rounded px-2 py-0.5 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2',
                  filter === option.value
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="relative w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Cerca email"
              title="Cerca in tutti i campi. Usa da: a: oggetto: per restringere a un campo, OR per alternative."
              className="h-8 pr-7 pl-7 text-[12px]"
            />
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Cancella ricerca"
              tabIndex={search ? 0 : -1}
              aria-hidden={!search}
              className={cn(
                'text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 absolute inset-y-0 right-1.5 inline-flex w-5 items-center justify-center rounded-sm transition-opacity outline-none focus-visible:ring-2',
                search ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-8"
                onClick={onOpenSettings}
                aria-label="Apri impostazioni"
              >
                <Settings className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Impostazioni</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  )
}
