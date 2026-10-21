import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, type Inbox } from 'lucide-react'

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { buildFolderTree, folderNodeLabel, type FolderTreeNode } from '@renderer/lib/folder-tree'
import { cn, formatCount } from '@renderer/lib/utils'
import { folderRole, folderRoleLabel, unifiedFolderPath, type FolderRole } from '@shared/folders'
import type { MailFolder, UnifiedFolderSummary } from '@shared/models'

import { folderIcon, ROLE_ICONS } from './folder-icons'

interface FolderSidebarProps {
  /** The account the dropdown above has open, whose folders the tree shows. */
  accountLabel: string
  folders: MailFolder[]
  /** The folders of "Tutti gli account"; none when there is a single account. */
  unifiedFolders: UnifiedFolderSummary[]
  selectedFolderPath: string | null
  onSelectFolder: (folderPath: string) => void
}

/**
 * The count a folder shows: what waits to be read — or, for drafts, the
 * drafts themselves, as Outlook counts them: an unsent draft is the thing
 * left to do there. Sent mail, the archive and the trash show none: what is
 * unread there is not waiting for anyone, and on Gmail the archive is every
 * message, its count every unread one in the inbox too.
 */
function badgeCount(role: FolderRole | null, messageCount: number, unseenCount: number): number {
  switch (role) {
    case '\\Drafts':
      return messageCount
    case '\\Sent':
    case '\\Archive':
    case '\\Trash':
      return 0
    default:
      return unseenCount
  }
}

/**
 * One folder per line, with its count pinned right.
 *
 * The previous two-line rows spent 52px each restating "N messaggi • M non
 * letti" for every folder, which pushed half the mailbox below the fold on a
 * laptop. A single 26px line with the count as a badge shows the whole tree
 * at once — the count that actually gets read stays, the sentence around it
 * goes.
 */
function FolderRow({
  icon: Icon,
  name,
  messageCount,
  unseenCount,
  badge,
  depth = 0,
  active,
  expanded,
  onToggleExpanded,
  onSelect
}: {
  icon: typeof Inbox
  name: string
  messageCount: number
  unseenCount: number
  badge: number
  depth?: number
  active: boolean
  /** Undefined for a folder without subfolders. */
  expanded?: boolean
  onToggleExpanded?: () => void
  /** Undefined for a container the server keeps only to hold other folders. */
  onSelect?: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex h-6.5 w-full items-center rounded transition-colors',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-foreground/85 hover:bg-secondary/55 hover:text-foreground'
      )}
      style={{ paddingLeft: depth * 12 }}
    >
      <span className="flex w-4 shrink-0 justify-center">
        {expanded !== undefined && (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-label={expanded ? `Comprimi ${name}` : `Espandi ${name}`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 inline-flex size-4 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
      </span>
      <button
        type="button"
        onClick={onSelect}
        disabled={!onSelect}
        title={
          onSelect
            ? `${name} — ${formatCount(messageCount, 'messaggio', 'messaggi')}${
                unseenCount > 0 ? `, ${formatCount(unseenCount, 'non letto', 'non letti')}` : ''
              }`
            : name
        }
        className="focus-visible:ring-ring/70 flex h-full min-w-0 flex-1 items-center gap-2 rounded pr-2 pl-1 text-left outline-none focus-visible:ring-2 disabled:cursor-default"
      >
        <Icon
          className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12px]',
            unseenCount > 0 && 'font-semibold',
            !onSelect && 'text-muted-foreground'
          )}
        >
          {name}
        </span>
        {badge > 0 && (
          <span
            className={cn(
              'shrink-0 rounded px-1 text-[10px] font-semibold tabular-nums',
              active ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            {badge.toLocaleString('it-IT')}
          </span>
        )}
      </button>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h2 className="text-muted-foreground truncate px-2 pt-2 pb-1 text-[10px] font-semibold tracking-widest uppercase">
      {children}
    </h2>
  )
}

/**
 * The folders, in two parts. "Tutti gli account" gathers, for each kind of
 * folder every account has — Posta in arrivo, Posta inviata, Bozze,
 * Archivio, Spam, Cestino — that folder of every account it includes, in
 * one list. Below, the account the dropdown has open, as its server nests
 * its folders: the ones with a role first, named in Italian, then the
 * others as a tree whose branches fold away.
 */
export function FolderSidebar({
  accountLabel,
  folders,
  unifiedFolders,
  selectedFolderPath,
  onSelectFolder
}: FolderSidebarProps): React.JSX.Element {
  const tree = useMemo(() => buildFolderTree(folders), [folders])
  // Folded branches, for the session: by default the whole tree shows.
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set())

  const toggleCollapsed = (path: string): void =>
    setCollapsedPaths((current) => {
      const next = new Set(current)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })

  const renderNode = (node: FolderTreeNode, depth: number): React.JSX.Element => {
    const folder = node.folder
    const role = folder ? folderRole(folder) : null
    const hasChildren = node.children.length > 0
    const expanded = !collapsedPaths.has(node.path)

    return (
      <div key={node.path}>
        <FolderRow
          icon={folderIcon(role, hasChildren && expanded)}
          name={folderNodeLabel(node)}
          messageCount={folder?.messageCount ?? 0}
          unseenCount={folder?.unseenCount ?? 0}
          badge={folder ? badgeCount(role, folder.messageCount, folder.unseenCount) : 0}
          depth={depth}
          active={folder !== null && selectedFolderPath === folder.path}
          expanded={hasChildren ? expanded : undefined}
          onToggleExpanded={() => toggleCollapsed(node.path)}
          onSelect={folder ? () => onSelectFolder(folder.path) : undefined}
        />
        {hasChildren && expanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-px p-1.5 pt-0">
          {unifiedFolders.length > 0 && (
            <section aria-label="Tutti gli account" className="border-border/60 border-b pb-1.5">
              <SectionHeading>Tutti gli account</SectionHeading>
              {unifiedFolders.map((summary) => {
                const path = unifiedFolderPath(summary.role)

                return (
                  <FolderRow
                    key={path}
                    icon={ROLE_ICONS[summary.role]}
                    name={folderRoleLabel(summary.role)}
                    messageCount={summary.messageCount}
                    unseenCount={summary.unseenCount}
                    badge={badgeCount(summary.role, summary.messageCount, summary.unseenCount)}
                    active={selectedFolderPath === path}
                    onSelect={() => onSelectFolder(path)}
                  />
                )
              })}
            </section>
          )}

          <section aria-label={accountLabel}>
            <SectionHeading>{accountLabel}</SectionHeading>
            {tree.map((node) => renderNode(node, 0))}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
