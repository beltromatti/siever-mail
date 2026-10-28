import { useMemo, useState } from 'react'
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Hourglass,
  ListTodo,
  PenLine,
  Search,
  Sun,
  type Inbox
} from 'lucide-react'

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { TopicPickerPopover } from '@renderer/features/segretario/topic-picker'
import { buildFolderTree, folderNodeLabel, type FolderTreeNode } from '@renderer/lib/folder-tree'
import { cn, formatCount } from '@renderer/lib/utils'
import {
  folderRole,
  folderRoleLabel,
  segretarioTopic,
  segretarioTopicPath,
  segretarioViewLabel,
  segretarioViewPath,
  unifiedFolderPath,
  type FolderRole,
  type SegretarioView
} from '@shared/folders'
import type { MailFolder, UnifiedFolderSummary } from '@shared/models'
import type { Topic } from '@shared/segretario'

import { folderIcon, ROLE_ICONS } from './folder-icons'

/** How many topics in corso the sidebar lists; the others are a search away. */
const TOPICS_SHOWN = 8

const VIEW_ICONS: Readonly<Record<SegretarioView, typeof Inbox>> = {
  'da-gestire': ListTodo,
  'in-attesa': Hourglass,
  'bozze-pronte': PenLine
}

/** Where dragged messages can land: a folder of an account, or a kind of folder of every account. */
export type FolderDropTarget =
  { kind: 'folder'; accountId: string; folderPath: string } | { kind: 'role'; role: FolderRole }

/** What a right click in the sidebar is on. */
export type FolderMenuTarget =
  | { kind: 'folder'; folder: MailFolder }
  /** A parent the server keeps only to hold other folders. */
  | { kind: 'container'; accountId: string; path: string; name: string }
  | { kind: 'role'; summary: UnifiedFolderSummary }
  /** The account's section, for a folder at its top. */
  | { kind: 'account' }

interface FolderSidebarProps {
  /** The Segretario's day, "Oggi": shown with its views, open or not. */
  today: { open: boolean; onOpen: () => void } | null
  /** The Segretario's views and how many conversations each holds; none without the Segretario. */
  segretarioViews: ReadonlyArray<{ view: SegretarioView; count: number }>
  /**
   * The topics — a company's pratiche — with their name: those in corso
   * listed, every one a search away. Null without the Segretario.
   */
  topics: { label: string; items: ReadonlyArray<Topic> } | null
  /** The account the dropdown above has open, whose folders the tree shows. */
  accountLabel: string
  folders: MailFolder[]
  /** The folders of "Tutti gli account"; none when there is a single account. */
  unifiedFolders: UnifiedFolderSummary[]
  selectedFolderPath: string | null
  onSelectFolder: (folderPath: string) => void
  onFolderContextMenu: (target: FolderMenuTarget) => void
  /** While messages are dragged: which folders take them, and the drop. */
  messageDrop: {
    accepts: (target: FolderDropTarget) => boolean
    onDrop: (target: FolderDropTarget) => void
  } | null
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
  onSelect,
  drop,
  onContextMenu,
  hint
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
  /** Set while messages are dragged and this folder takes them. */
  drop?: { hovered: boolean; onEnter: () => void; onLeave: () => void; onDrop: () => void }
  /** Undefined for a row without a menu of its own: a view of the Segretario's. */
  onContextMenu?: () => void
  /** What its tooltip says, when not its count of messages. */
  hint?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex h-7 w-full items-center rounded-[6px] transition-colors',
        active
          ? 'bg-selected text-foreground'
          : 'text-muted-foreground hover:bg-hover hover:text-foreground',
        drop?.hovered && 'bg-selected text-foreground ring-foreground/40 ring-1 ring-inset'
      )}
      style={{ paddingLeft: depth * 12 }}
      onContextMenu={
        onContextMenu
          ? (event) => {
              event.preventDefault()
              onContextMenu()
            }
          : undefined
      }
      onDragOver={
        drop
          ? (event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
          : undefined
      }
      onDragEnter={drop ? () => drop.onEnter() : undefined}
      onDragLeave={
        drop
          ? (event) => {
              // Leaving for one of its own children is not leaving.
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                drop.onLeave()
              }
            }
          : undefined
      }
      onDrop={
        drop
          ? (event) => {
              event.preventDefault()
              drop.onDrop()
            }
          : undefined
      }
    >
      <span className="flex w-4 shrink-0 justify-center">
        {expanded !== undefined && (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-label={expanded ? `Comprimi ${name}` : `Espandi ${name}`}
            className="text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 inline-flex size-4 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
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
          hint ??
          (onSelect
            ? `${name} — ${formatCount(messageCount, 'messaggio', 'messaggi')}${
                unseenCount > 0 ? `, ${formatCount(unseenCount, 'non letto', 'non letti')}` : ''
              }`
            : name)
        }
        className="focus-visible:ring-ring/60 flex h-full min-w-0 flex-1 items-center gap-2 rounded-[6px] pr-2 pl-0.5 text-left outline-none focus-visible:ring-2 disabled:cursor-default"
      >
        <Icon
          className={cn(
            'size-[15px] shrink-0',
            active ? 'text-foreground' : 'text-faint-foreground'
          )}
          strokeWidth={1.7}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12.5px] font-medium',
            unseenCount > 0 && 'text-foreground font-[650]',
            !onSelect && 'text-faint-foreground'
          )}
        >
          {name}
        </span>
        {badge > 0 && (
          <span
            className={cn(
              'shrink-0 text-[11px] tabular-nums',
              unseenCount > 0 ? 'text-foreground font-semibold' : 'text-faint-foreground'
            )}
          >
            {badge.toLocaleString('it-IT')}
          </span>
        )}
      </button>
    </div>
  )
}

type FolderRowDrop = NonNullable<Parameters<typeof FolderRow>[0]['drop']>

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="eyebrow truncate px-2.5 pt-3.5 pb-1.5">{children}</h2>
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
  today,
  segretarioViews,
  accountLabel,
  folders,
  unifiedFolders,
  selectedFolderPath,
  onSelectFolder,
  onFolderContextMenu,
  topics,
  messageDrop
}: FolderSidebarProps): React.JSX.Element {
  const tree = useMemo(() => buildFolderTree(folders), [folders])
  const [topicSearchOpen, setTopicSearchOpen] = useState(false)
  const openTopicId = segretarioTopic(selectedFolderPath)
  // In corso: those with conversations, the most recently moved first — the open one always.
  const shownTopics = useMemo(
    () =>
      (topics?.items ?? [])
        .filter((topic) => topic.id === openTopicId || (!topic.archived && topic.conversations > 0))
        .slice(0, TOPICS_SHOWN),
    [openTopicId, topics]
  )
  // The folder dragged messages are over, to show where they would land.
  const [dropHoverKey, setDropHoverKey] = useState<string | null>(null)

  /** A folder's part in a drag: none, unless it takes the messages dragged. */
  const dropFor = (key: string, target: FolderDropTarget): FolderRowDrop | undefined =>
    messageDrop?.accepts(target)
      ? {
          hovered: dropHoverKey === key,
          onEnter: () => setDropHoverKey(key),
          onLeave: () => setDropHoverKey((current) => (current === key ? null : current)),
          onDrop: () => {
            setDropHoverKey(null)
            messageDrop.onDrop(target)
          }
        }
      : undefined
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
          onContextMenu={() =>
            onFolderContextMenu(
              folder
                ? { kind: 'folder', folder }
                : {
                    kind: 'container',
                    accountId: folders[0]?.accountId ?? '',
                    path: node.path,
                    name: folderNodeLabel(node)
                  }
            )
          }
          drop={
            folder
              ? dropFor(`folder:${folder.path}`, {
                  kind: 'folder',
                  accountId: folder.accountId,
                  folderPath: folder.path
                })
              : undefined
          }
        />
        {hasChildren && expanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-px px-2 pb-3">
          {segretarioViews.length > 0 && (
            <section aria-label="Segretario">
              <SectionHeading>Segretario</SectionHeading>
              {today && (
                <FolderRow
                  icon={Sun}
                  name="Oggi"
                  messageCount={0}
                  unseenCount={0}
                  badge={0}
                  active={today.open}
                  onSelect={today.onOpen}
                />
              )}
              {segretarioViews.map(({ view, count }) => {
                const path = segretarioViewPath(view)

                return (
                  <FolderRow
                    key={path}
                    icon={VIEW_ICONS[view]}
                    name={segretarioViewLabel(view)}
                    messageCount={count}
                    unseenCount={count}
                    badge={count}
                    active={selectedFolderPath === path}
                    onSelect={() => onSelectFolder(path)}
                  />
                )
              })}
            </section>
          )}

          {topics && (
            <section aria-label={topics.label}>
              <SectionHeading>{topics.label}</SectionHeading>
              {shownTopics.map((topic) => {
                const path = segretarioTopicPath(topic.id)

                return (
                  <FolderRow
                    key={path}
                    icon={Briefcase}
                    name={topic.title}
                    hint={`${topic.title} — ${formatCount(topic.conversations, 'conversazione', 'conversazioni')}${
                      topic.openCommitments > 0
                        ? `, ${formatCount(topic.openCommitments, 'cosa aperta', 'cose aperte')}`
                        : ''
                    }`}
                    messageCount={topic.conversations}
                    unseenCount={0}
                    badge={topic.openCommitments}
                    active={selectedFolderPath === path}
                    onSelect={() => onSelectFolder(path)}
                  />
                )
              })}
              <TopicPickerPopover
                open={topicSearchOpen}
                onOpenChange={setTopicSearchOpen}
                side="right"
                topics={topics.items}
                label={topics.label}
                currentId={openTopicId}
                onPick={(topic) => {
                  setTopicSearchOpen(false)
                  onSelectFolder(segretarioTopicPath(topic.id))
                }}
                trigger={
                  <button
                    type="button"
                    className="text-faint-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 flex h-7 w-full items-center gap-2 rounded-[6px] pr-2 pl-[18px] text-left text-[12.5px] font-medium outline-none focus-visible:ring-2"
                  >
                    <Search className="size-[15px] shrink-0" strokeWidth={1.7} />
                    <span className="min-w-0 flex-1 truncate">Cerca tra tutte…</span>
                  </button>
                }
              />
            </section>
          )}

          {unifiedFolders.length > 0 && (
            <section aria-label="Tutti gli account">
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
                    drop={dropFor(path, { kind: 'role', role: summary.role })}
                    onContextMenu={() => onFolderContextMenu({ kind: 'role', summary })}
                  />
                )
              })}
            </section>
          )}

          <section aria-label={accountLabel}>
            <div
              onContextMenu={(event) => {
                event.preventDefault()
                onFolderContextMenu({ kind: 'account' })
              }}
            >
              <SectionHeading>{accountLabel}</SectionHeading>
            </div>
            {tree.map((node) => renderNode(node, 0))}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
