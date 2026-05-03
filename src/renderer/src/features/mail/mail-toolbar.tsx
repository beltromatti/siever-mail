import { Archive, FolderInput, MailOpen, MailPlus, Settings, Trash2, X } from 'lucide-react'

import { Fragment } from 'react'
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
import type { MailFolder } from '@shared/models'

interface MailToolbarProps {
  folders: MailFolder[]
  currentFolderPath: string | null
  search: string
  onSearchChange: (value: string) => void
  multiSelectEnabled: boolean
  canActOnMessage: boolean
  toggleSeenLabel: string
  /**
   * Toolbar actions contributed by the active extension (if any). Each
   * descriptor renders inline next to the host's primary "Nuovo
   * messaggio" button. Empty in the public build.
   */
  extensionToolbarActions: ReadonlyArray<ToolbarActionDescriptor>
  /** Selection context handed to extension toolbar actions. */
  extensionSelection: ExtensionSelectionContext
  /** Host hooks handed to extension toolbar actions (optimistic UI helpers). */
  extensionHostHooks: ExtensionHostHooks
  /** Triggers the extension's PrimaryActionDialog. */
  onActivateExtensionPrimaryAction: () => void
  onCompose: () => void
  onOpenSettings: () => void
  onArchiveClassic: () => void
  onMoveToFolder: (folderPath: string) => void
  onDelete: () => void
  onToggleSeen: () => void
}

export function MailToolbar({
  folders,
  currentFolderPath,
  search,
  onSearchChange,
  multiSelectEnabled,
  canActOnMessage,
  toggleSeenLabel,
  extensionToolbarActions,
  extensionSelection,
  extensionHostHooks,
  onActivateExtensionPrimaryAction,
  onCompose,
  onOpenSettings,
  onArchiveClassic,
  onMoveToFolder,
  onDelete,
  onToggleSeen
}: MailToolbarProps): React.JSX.Element {
  const destinationFolders = folders.filter((folder) => folder.path !== currentFolderPath)

  return (
    <div className="glass-panel sticky top-0 z-10 rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <TooltipProvider delayDuration={120}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={onCompose}
                  aria-label="Nuovo messaggio"
                  className="size-11"
                >
                  <MailPlus className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Nuovo messaggio</TooltipContent>
            </Tooltip>
          </TooltipProvider>

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

        <div className="toolbar-scroll-x min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex w-max items-center gap-2 pr-2">
            {multiSelectEnabled && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  disabled={!canActOnMessage}
                  onClick={onArchiveClassic}
                >
                  <Archive className="size-4" /> Archivia
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      disabled={!canActOnMessage || destinationFolders.length === 0}
                    >
                      <FolderInput className="size-4" /> Sposta
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {destinationFolders.map((folder) => (
                      <DropdownMenuItem
                        key={folder.path}
                        className="cursor-pointer"
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
                  className="gap-1.5"
                  disabled={!canActOnMessage}
                  onClick={onToggleSeen}
                >
                  <MailOpen className="size-4" />
                  {toggleSeenLabel}
                </Button>

                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  disabled={!canActOnMessage}
                  onClick={onDelete}
                >
                  <Trash2 className="size-4" /> Elimina
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
          <div className="relative w-full max-w-xl">
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Cerca email"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Cancella ricerca"
              tabIndex={search ? 0 : -1}
              aria-hidden={!search}
              className={cn(
                'text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 absolute inset-y-0 right-2 inline-flex w-6 items-center justify-center rounded-sm transition-opacity outline-none focus-visible:ring-2',
                search ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <X className="size-4" />
            </button>
          </div>

          <TooltipProvider delayDuration={120}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onOpenSettings}
                    title="Impostazioni"
                    aria-label="Apri impostazioni"
                  >
                    <Settings className="size-4" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Impostazioni</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}
