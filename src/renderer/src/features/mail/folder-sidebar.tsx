import { Archive, Folder, Inbox, Send, ShieldAlert, Trash2 } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
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
      return <Inbox className="size-4" />
    case '\\Sent':
      return <Send className="size-4" />
    case '\\Trash':
      return <Trash2 className="size-4" />
    case '\\Archive':
      return <Archive className="size-4" />
    case '\\Junk':
      return <ShieldAlert className="size-4" />
    default:
      return <Folder className="size-4" />
  }
}

export function FolderSidebar({
  folders,
  allInboxesFolder,
  selectedFolderPath,
  onSelectFolder
}: FolderSidebarProps): React.JSX.Element {
  return (
    <div className="glass-panel flex h-full min-h-0 flex-col rounded-xl p-3">
      <div className="px-2 pb-2">
        <h3 className="display-title text-xl">Cartelle</h3>
        <p className="text-muted-foreground text-xs">Sincronizzazione continua</p>
      </div>

      <ScrollArea className="min-h-0 flex-1 pr-2">
        <div className="space-y-1">
          {allInboxesFolder && (
            <Button
              variant="ghost"
              className={cn(
                'h-auto w-full justify-start rounded-lg px-3 py-2 text-left',
                selectedFolderPath === allInboxesFolder.path
                  ? 'bg-primary/14 text-primary hover:bg-primary/18'
                  : 'text-foreground hover:bg-secondary/60'
              )}
              onClick={() => onSelectFolder(allInboxesFolder.path)}
            >
              <div className="text-muted-foreground mr-2">
                <Inbox className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{allInboxesFolder.name}</p>
                <p className="text-muted-foreground text-xs">
                  {allInboxesFolder.messageCount} messaggi
                  {allInboxesFolder.unseenCount > 0
                    ? ` • ${allInboxesFolder.unseenCount} non letti`
                    : ''}
                </p>
              </div>
            </Button>
          )}

          {allInboxesFolder && <Separator className="my-2" />}

          {folders.map((folder) => {
            const isActive = selectedFolderPath === folder.path

            return (
              <Button
                key={`${folder.accountId}-${folder.path}`}
                variant="ghost"
                className={cn(
                  'h-auto w-full justify-start rounded-lg px-3 py-2 text-left',
                  isActive
                    ? 'bg-primary/14 text-primary hover:bg-primary/18'
                    : 'text-foreground hover:bg-secondary/60'
                )}
                onClick={() => onSelectFolder(folder.path)}
              >
                <div className="text-muted-foreground mr-2">{iconForFolder(folder.specialUse)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{folder.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {folder.messageCount} messaggi
                    {folder.unseenCount > 0 ? ` • ${folder.unseenCount} non letti` : ''}
                  </p>
                </div>
              </Button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
