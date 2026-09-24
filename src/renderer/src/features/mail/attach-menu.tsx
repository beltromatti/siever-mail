import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, FolderOpen, LoaderCircle, Paperclip } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import type { RecentFile } from '@shared/models'

import { AttachmentIcon } from './attachment-chip'

const TIME_FORMAT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('it-IT', { weekday: 'long' })
const DATE_FORMAT = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "oggi alle 15:32", "ieri alle 9:05", "lunedì", "12 set". */
function formatUsedAt(usedAt: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(usedAt)) / DAY_MS)

  if (days <= 0) {
    return `oggi alle ${TIME_FORMAT.format(usedAt)}`
  }

  if (days === 1) {
    return `ieri alle ${TIME_FORMAT.format(usedAt)}`
  }

  return days < 7 ? WEEKDAY_FORMAT.format(usedAt) : DATE_FORMAT.format(usedAt)
}

export interface AttachMenuProps {
  disabled?: boolean
  /** Adds files the user picked from the recent list. */
  onAttachPaths: (paths: string[]) => void
  /** Opens the system file picker. */
  onBrowse: () => void
}

/**
 * "Allega": the files the user most likely wants — the ones they just had
 * open, sent or saved, from anywhere on the computer or the network — with
 * the system picker one row below for everything else.
 *
 * The list is fetched when the composer opens, so the menu is ready the
 * moment it is clicked, and refreshed on every open.
 */
export function AttachMenu({
  disabled,
  onAttachPaths,
  onBrowse
}: AttachMenuProps): React.JSX.Element {
  const [recentFiles, setRecentFiles] = useState<RecentFile[] | null>(null)

  const refresh = useCallback(() => {
    void window.mailApi
      .listRecentFiles()
      .then(setRecentFiles)
      .catch(() => setRecentFiles([]))
  }, [])

  useEffect(refresh, [refresh])

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          refresh()
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          disabled={disabled}
        >
          <Paperclip className="size-3.5" />
          Allega
          <ChevronDown className="text-muted-foreground size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-80">
        <DropdownMenuLabel className="text-muted-foreground text-[11px] font-medium">
          File recenti
        </DropdownMenuLabel>

        {recentFiles === null ? (
          <div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-[12px]">
            <LoaderCircle className="size-3.5 animate-spin" />
            Ricerca dei file recenti…
          </div>
        ) : recentFiles.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-[12px]">
            Nessun file recente. I file che apri, invii o salvi compaiono qui.
          </p>
        ) : (
          recentFiles.map((file) => (
            <DropdownMenuItem
              key={file.path}
              className="items-start gap-2 py-1.5"
              title={file.path}
              onSelect={() => onAttachPaths([file.path])}
            >
              <AttachmentIcon
                fileName={file.name}
                className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[12px] font-medium">{file.name}</span>
                <span className="text-muted-foreground truncate text-[10.5px]">
                  {file.activity} · {formatUsedAt(file.usedAt)}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={onBrowse}>
          <FolderOpen className="text-muted-foreground size-3.5" />
          Sfoglia questo computer…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
