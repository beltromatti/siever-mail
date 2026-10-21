import { Archive, File, Folder, FolderOpen, Inbox, Send, ShieldAlert, Trash2 } from 'lucide-react'

import type { FolderRole } from '@shared/folders'

/** The icon of each kind of folder, the same in the sidebar and in "Sposta". */
export const ROLE_ICONS: Readonly<Record<FolderRole, typeof Inbox>> = {
  '\\Inbox': Inbox,
  '\\Sent': Send,
  '\\Drafts': File,
  '\\Archive': Archive,
  '\\Junk': ShieldAlert,
  '\\Trash': Trash2
}

/** A folder's icon: its role's, or an open folder for an expanded branch. */
export function folderIcon(role: FolderRole | null, expandedBranch = false): typeof Inbox {
  return role ? ROLE_ICONS[role] : expandedBranch ? FolderOpen : Folder
}
