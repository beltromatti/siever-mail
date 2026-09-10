import { Archive, File, Folder, Inbox, Send, ShieldAlert, Trash2 } from 'lucide-react'

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Separator } from '@renderer/components/ui/separator'
import { cn } from '@renderer/lib/utils'
import type { MailFolder } from '@shared/models'

interface FolderSidebarProps {
  folders: MailFolder[]
  allInboxesFolder?: {
    path: string
    name: string
    messageCount: number
    unseenCount: number
  }
  selectedFolderPath: string | null
  onSelectFolder: (folderPath: string) => void
}

function iconForFolder(specialUse?: string): React.JSX.Element {
  switch (specialUse) {
    case '\\Inbox':
      return <Inbox className="size-3.5" />
    case '\\Sent':
      return <Send className="size-3.5" />
    case '\\Trash':
      return <Trash2 className="size-3.5" />
    case '\\Archive':
      return <Archive className="size-3.5" />
    case '\\Junk':
      return <ShieldAlert className="size-3.5" />
    case '\\Drafts':
      return <File className="size-3.5" />
    default:
      return <Folder className="size-3.5" />
  }
}

/**
 * One folder per line, with the unread count pinned right.
 *
 * The previous two-line rows spent 52px each restating "N messaggi • M non
 * letti" for every folder, which pushed half the mailbox below the fold on a
 * laptop. A single 26px line with the unread count as a badge shows the
 * whole tree at once — the count that actually gets read stays, the sentence
 * around it goes.
 */
function FolderRow({
  icon,
  name,
  messageCount,
  unseenCount,
  active,
  onSelect
}: {
  icon: React.JSX.Element
  name: string
  messageCount: number
  unseenCount: number
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${name} — ${messageCount} messaggi${unseenCount > 0 ? `, ${unseenCount} non letti` : ''}`}
      className={cn(
        'focus-visible:ring-ring/70 flex h-[26px] w-full items-center gap-2 rounded px-2 text-left transition-colors outline-none focus-visible:ring-2',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-foreground/85 hover:bg-secondary/55 hover:text-foreground'
      )}
    >
      <span className={cn('shrink-0', active ? 'text-primary' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span
        className={cn('min-w-0 flex-1 truncate text-[12px]', unseenCount > 0 && 'font-semibold')}
      >
        {name}
      </span>
      {unseenCount > 0 && (
        <span
          className={cn(
            'shrink-0 rounded px-1 text-[10px] font-semibold tabular-nums',
            active ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          {unseenCount}
        </span>
      )}
    </button>
  )
}

export function FolderSidebar({
  folders,
  allInboxesFolder,
  selectedFolderPath,
  onSelectFolder
}: FolderSidebarProps): React.JSX.Element {
  return (
    <div className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg">
      <div className="border-border/60 flex h-8 shrink-0 items-center border-b px-2.5">
        <h2 className="text-muted-foreground text-[10px] font-semibold tracking-[0.1em] uppercase">
          Cartelle
        </h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-px p-1.5">
          {allInboxesFolder && (
            <>
              <FolderRow
                icon={<Inbox className="size-3.5" />}
                name={allInboxesFolder.name}
                messageCount={allInboxesFolder.messageCount}
                unseenCount={allInboxesFolder.unseenCount}
                active={selectedFolderPath === allInboxesFolder.path}
                onSelect={() => onSelectFolder(allInboxesFolder.path)}
              />
              <Separator className="my-1.5" />
            </>
          )}

          {folders.map((folder) => (
            <FolderRow
              key={`${folder.accountId}-${folder.path}`}
              icon={iconForFolder(folder.specialUse)}
              name={folder.name}
              messageCount={folder.messageCount}
              unseenCount={folder.unseenCount}
              active={selectedFolderPath === folder.path}
              onSelect={() => onSelectFolder(folder.path)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
