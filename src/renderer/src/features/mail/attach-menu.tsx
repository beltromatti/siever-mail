import { useCallback, useEffect, useRef, useState } from 'react'
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
import { hourStyle, languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { formatByteSize } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import type { MailAttachment, RecentFile } from '@shared/models'

import { AttachmentIcon } from './attachment-chip'

const MESSAGES = defineMessages({
  todayAt: {
    en: (time: string) => `today at ${time}`,
    it: (time: string) => `oggi alle ${time}`,
    de: (time: string) => `heute um ${time}`
  },
  yesterdayAt: {
    en: (time: string) => `yesterday at ${time}`,
    it: (time: string) => `ieri alle ${time}`,
    de: (time: string) => `gestern um ${time}`
  },
  attach: { en: 'Attach', it: 'Allega', de: 'Anhängen' },
  fromOriginal: {
    en: 'From the original message',
    it: 'Dal messaggio originale',
    de: 'Aus der ursprünglichen Nachricht'
  },
  attachAll: {
    en: (count: number) => `Attach all ${count}`,
    it: (count: number) => `Allega tutti e ${count}`,
    de: (count: number) => `Alle ${count} anhängen`
  },
  recentFiles: { en: 'Recent files', it: 'File recenti', de: 'Zuletzt verwendete Dateien' },
  searching: {
    en: 'Looking for recent files…',
    it: 'Ricerca dei file recenti…',
    de: 'Zuletzt verwendete Dateien werden gesucht…'
  },
  noRecent: {
    en: 'No recent files. The files you open, send or save show up here.',
    it: 'Nessun file recente. I file che apri, invii o salvi compaiono qui.',
    de: 'Keine zuletzt verwendeten Dateien. Dateien, die Sie öffnen, senden oder speichern, erscheinen hier.'
  },
  inFolder: {
    en: (folder: string) => `in ${folder}`,
    it: (folder: string) => `in ${folder}`,
    de: (folder: string) => `in ${folder}`
  },
  browse: {
    en: 'Browse this computer…',
    it: 'Sfoglia questo computer…',
    de: 'Diesen Computer durchsuchen…'
  }
})

const DAY_MS = 24 * 60 * 60 * 1000
/**
 * A newer list that arrives within this long of the menu opening replaces
 * the one shown; later, the user is aiming at a row, and it waits for the
 * next opening.
 */
const LIST_SETTLES_MS = 400

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "today at 15:32", "yesterday at 9:05", "Monday", "12 Sept". */
function formatUsedAt(usedAt: number, now = Date.now()): string {
  const m = messagesNow(MESSAGES)
  const { formatLocale } = languageNow()
  const days = Math.round((startOfDay(now) - startOfDay(usedAt)) / DAY_MS)
  const time = (): string =>
    new Intl.DateTimeFormat(formatLocale, { hour: hourStyle(), minute: '2-digit' }).format(usedAt)

  if (days <= 0) {
    return m.todayAt(time())
  }

  if (days === 1) {
    return m.yesterdayAt(time())
  }

  return new Intl.DateTimeFormat(
    formatLocale,
    days < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'short' }
  ).format(usedAt)
}

export interface AttachMenuProps {
  disabled?: boolean
  /** The attachments of the message replied to or forwarded that are not attached. */
  originals?: ReadonlyArray<MailAttachment>
  onAttachOriginals?: (attachmentIds: string[]) => void
  /** Adds files the user picked from the recent list. */
  onAttachPaths: (paths: string[]) => void
  /** Opens the system file picker. */
  onBrowse: () => void
}

/** The last folder of a path: "Casa al mare" for ".../Clienti/Casa al mare". */
function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder
}

/**
 * "Allega": the files the user most likely wants — the attachments of the
 * message they are answering or forwarding, then the ones they just had
 * open, sent or saved, from anywhere on the computer or the network — with
 * the system picker one row below for everything else.
 *
 * The list is fetched when the composer opens and again whenever the user
 * comes back to the window — from saving the file they now want to attach —
 * so the menu is ready the moment it is clicked; an open menu never
 * reorders under the pointer (`LIST_SETTLES_MS`).
 */
export function AttachMenu({
  disabled,
  originals = [],
  onAttachOriginals,
  onAttachPaths,
  onBrowse
}: AttachMenuProps): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [recentFiles, setRecentFiles] = useState<RecentFile[] | null>(null)
  /** When the menu opened, or null while it is closed. */
  const openedAtRef = useRef<number | null>(null)
  const shownRef = useRef(false)
  const waitingRef = useRef<RecentFile[] | null>(null)

  const refresh = useCallback(() => {
    const show = (files: RecentFile[]): void => {
      const openedAt = openedAtRef.current

      if (shownRef.current && openedAt !== null && Date.now() - openedAt > LIST_SETTLES_MS) {
        waitingRef.current = files
        return
      }

      shownRef.current = true
      setRecentFiles(files)
    }

    void window.mailApi
      .listRecentFiles()
      .then(show)
      .catch(() => show([]))
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        openedAtRef.current = open ? Date.now() : null

        if (open) {
          refresh()
        } else if (waitingRef.current) {
          setRecentFiles(waitingRef.current)
          waitingRef.current = null
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
          {m.attach}
          <ChevronDown className="text-muted-foreground size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-80">
        {originals.length > 0 && onAttachOriginals && (
          <>
            <DropdownMenuLabel className="text-muted-foreground text-[11px] font-medium">
              {m.fromOriginal}
            </DropdownMenuLabel>
            {originals.map((attachment) => (
              <DropdownMenuItem
                key={attachment.id}
                className="gap-2 py-1.5"
                onSelect={() => onAttachOriginals([attachment.id])}
              >
                <AttachmentIcon
                  fileName={attachment.fileName}
                  className="text-muted-foreground size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {attachment.fileName}
                </span>
                <span className="text-muted-foreground shrink-0 text-[10.5px] tabular-nums">
                  {formatByteSize(attachment.size)}
                </span>
              </DropdownMenuItem>
            ))}
            {originals.length > 1 && (
              <DropdownMenuItem
                className="gap-2 py-1.5 text-[12px]"
                onSelect={() => onAttachOriginals(originals.map((attachment) => attachment.id))}
              >
                <Paperclip className="text-muted-foreground size-3.5" />
                {m.attachAll(originals.length)}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuLabel className="text-muted-foreground text-[11px] font-medium">
          {m.recentFiles}
        </DropdownMenuLabel>

        {recentFiles === null ? (
          <div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-[12px]">
            <LoaderCircle className="size-3.5 animate-spin" />
            {m.searching}
          </div>
        ) : recentFiles.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-[12px]">{m.noRecent}</p>
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
                  {file.activity} · {formatUsedAt(file.usedAt)} ·{' '}
                  {m.inFolder(folderName(file.folder))}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={onBrowse}>
          <FolderOpen className="text-muted-foreground size-3.5" />
          {m.browse}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
