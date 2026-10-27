import { Archive, Flag, FolderInput, MailOpen, Trash2 } from 'lucide-react'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { MailFolder } from '@shared/models'

import { FolderPickerPopover } from './folder-picker'

export interface SelectionActionsProps {
  /** Where "Sposta" can put the selection: the folders of its account. */
  moveFolders: MailFolder[]
  /** The folder the whole selection sits in, shown but not offered. */
  moveExcludedPath: string | null
  /** The account's recent destinations, the latest first. */
  recentMovePaths: string[]
  /**
   * Set when the selection spans more than one account, which no folder
   * can take at once: "Sposta" then explains instead of listing folders.
   */
  onMoveAcrossAccounts?: () => void
  /** "Sposta" opens from its button and from its chord. */
  moveMenuOpen: boolean
  onMoveMenuOpenChange: (open: boolean) => void
  toggleSeenLabel: string
  /** True when every selected message already carries the flag. */
  selectionFlagged: boolean
  onArchive: () => void
  onMoveToFolder: (folderPath: string) => void
  onCreateFolderAndMove: (name: string) => void
  onToggleSeen: () => void
  onToggleFlagged: () => void
  onDelete: () => void
}

/**
 * What can be done to the selection — one message or many: archive, move,
 * mark, flag, delete. Icons with their names in the bubble when one message
 * is read; words beside them when the pane is the selection's, and has the
 * room.
 */
export function SelectionActions({
  labelled,
  ...props
}: SelectionActionsProps & { labelled: boolean }): React.JSX.Element {
  const flagLabel = props.selectionFlagged ? 'Rimuovi contrassegno' : 'Contrassegna'
  const buttonClass = cn('gap-1.5', labelled ? 'h-[28px] px-2' : 'size-[28px] px-0')
  const moveTrigger = (
    <Button
      variant="ghost"
      size="sm"
      className={buttonClass}
      disabled={!props.onMoveAcrossAccounts && props.moveFolders.length === 0}
      aria-label="Sposta"
      onClick={props.onMoveAcrossAccounts}
    >
      <FolderInput className="size-[15px]" />
      {labelled && 'Sposta'}
    </Button>
  )

  return (
    <div className="flex items-center gap-0.5">
      <ActionTooltip label="Archivia" commandId="archive">
        <Button
          variant="ghost"
          size="sm"
          className={buttonClass}
          onClick={props.onArchive}
          aria-label="Archivia"
        >
          <Archive className="size-[15px]" />
          {labelled && 'Archivia'}
        </Button>
      </ActionTooltip>

      {props.onMoveAcrossAccounts ? (
        <ActionTooltip label="Sposta in una cartella" commandId="move">
          {moveTrigger}
        </ActionTooltip>
      ) : (
        <FolderPickerPopover
          open={props.moveMenuOpen}
          onOpenChange={props.onMoveMenuOpenChange}
          align="end"
          folders={props.moveFolders}
          recentPaths={props.recentMovePaths}
          excludedPath={props.moveExcludedPath}
          onPick={(folderPath) => {
            props.onMoveMenuOpenChange(false)
            props.onMoveToFolder(folderPath)
          }}
          onCreate={(name) => {
            props.onMoveMenuOpenChange(false)
            props.onCreateFolderAndMove(name)
          }}
          wrapTrigger={(trigger) => (
            <ActionTooltip label="Sposta in una cartella" commandId="move">
              {trigger}
            </ActionTooltip>
          )}
          trigger={moveTrigger}
        />
      )}

      <ActionTooltip label={props.toggleSeenLabel} commandId="toggle-read">
        <Button
          variant="ghost"
          size="sm"
          className={buttonClass}
          onClick={props.onToggleSeen}
          aria-label={props.toggleSeenLabel}
        >
          <MailOpen className="size-[15px]" />
          {labelled && props.toggleSeenLabel}
        </Button>
      </ActionTooltip>

      <ActionTooltip label={flagLabel} commandId="toggle-flag">
        <Button
          variant="ghost"
          size="sm"
          className={cn(buttonClass, props.selectionFlagged && 'text-flagged hover:text-flagged')}
          onClick={props.onToggleFlagged}
          aria-label={flagLabel}
        >
          <Flag className={cn('size-[15px]', props.selectionFlagged && 'fill-current')} />
          {labelled && flagLabel}
        </Button>
      </ActionTooltip>

      <ActionTooltip label="Elimina">
        <Button
          variant="ghost"
          size="sm"
          className={cn(buttonClass, 'hover:text-destructive')}
          onClick={props.onDelete}
          aria-label="Elimina"
        >
          <Trash2 className="size-[15px]" />
          {labelled && 'Elimina'}
        </Button>
      </ActionTooltip>
    </div>
  )
}
