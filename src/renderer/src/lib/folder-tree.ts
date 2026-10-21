import { folderDisplayName } from '@shared/folders'
import type { MailFolder } from '@shared/models'

/**
 * One account's folders as the mailbox holds them: a tree, the way Outlook
 * and Apple Mail show it, instead of one flat run where two "bollette" in
 * different places could not be told apart.
 *
 *   • The folders with a role — Posta in arrivo, Inviata, Bozze, Archivio,
 *     Spam, Cestino… — come first, in that order, wherever the server keeps
 *     them: Gmail files them under "[Gmail]", a container no one needs to
 *     see, and many servers under INBOX.
 *   • Every other folder sits under its parent, as the server nests it,
 *     children in alphabetical order. A parent the server lists but that
 *     holds no mail itself (\Noselect) is still shown, to hold its children.
 */
export interface FolderTreeNode {
  /** The folder's path, or the path of a container that holds no mail. */
  path: string
  name: string
  /** Null for a container the server keeps only to hold other folders. */
  folder: MailFolder | null
  children: FolderTreeNode[]
}

const ROLE_ORDER: ReadonlyArray<string> = [
  '\\inbox',
  '\\sent',
  '\\drafts',
  '\\archive',
  '\\flagged',
  '\\important',
  '\\all',
  '\\junk',
  '\\trash'
]

function roleRank(folder: MailFolder | null): number {
  const role = folder?.specialUse?.toLowerCase()
  const rank = role ? ROLE_ORDER.indexOf(role) : -1
  return rank < 0 ? ROLE_ORDER.length : rank
}

function compareNodes(left: FolderTreeNode, right: FolderTreeNode): number {
  return (
    roleRank(left.folder) - roleRank(right.folder) ||
    left.name.localeCompare(right.name, 'it', { sensitivity: 'base', numeric: true })
  )
}

function parentPath(path: string, delimiter: string | undefined): string | null {
  if (!delimiter) {
    return null
  }

  const index = path.lastIndexOf(delimiter)
  return index > 0 ? path.slice(0, index) : null
}

export function buildFolderTree(folders: ReadonlyArray<MailFolder>): FolderTreeNode[] {
  const folderByPath = new Map(folders.map((folder) => [folder.path, folder]))
  const nodes = new Map<string, FolderTreeNode>()
  const roots: FolderTreeNode[] = []

  // Each path is placed once, knowing whether it is a folder of its own —
  // so the order the server lists folders in never changes the tree.
  const place = (path: string, delimiter: string | undefined): FolderTreeNode => {
    const placed = nodes.get(path)

    if (placed) {
      return placed
    }

    const folder = folderByPath.get(path) ?? null
    const separator = folder?.delimiter ?? delimiter
    const node: FolderTreeNode = {
      path,
      name:
        folder?.name ??
        (separator ? path.slice(path.lastIndexOf(separator) + separator.length) : path),
      folder,
      children: []
    }
    nodes.set(path, node)

    const parent = parentPath(path, separator)

    // A folder with a role is at the top wherever the server keeps it —
    // under "[Gmail]", or under INBOX as Courier and Dovecot servers often
    // do ("INBOX.Sent") — and takes its own subfolders along.
    if (!parent || folder?.specialUse) {
      roots.push(node)
    } else {
      place(parent, separator).children.push(node)
    }

    return node
  }

  for (const folder of folders) {
    place(folder.path, folder.delimiter)
  }

  const prune = (list: FolderTreeNode[]): FolderTreeNode[] =>
    list
      .map((node) => ({ ...node, children: prune(node.children) }))
      // A container left with nothing in it is not worth a line.
      .filter((node) => node.folder !== null || node.children.length > 0)
      .sort(compareNodes)

  return prune(roots)
}

/** Every folder of a tree, parents before their children. */
export function flattenFolderTree(
  nodes: ReadonlyArray<FolderTreeNode>,
  depth = 0
): Array<{ node: FolderTreeNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenFolderTree(node.children, depth + 1)])
}

/** What a node is called: its folder as the app names folders, or a container's own name. */
export function folderNodeLabel(node: FolderTreeNode): string {
  return node.folder ? folderDisplayName(node.folder) : node.name
}
