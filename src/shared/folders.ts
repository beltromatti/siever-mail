import type { MailFolder } from './models'

/**
 * The folders every mail account has, whatever its server calls them: the
 * ones the sidebar names in Italian, lists first and gathers across
 * accounts under "Tutti gli account".
 */
export type FolderRole = '\\Inbox' | '\\Sent' | '\\Drafts' | '\\Archive' | '\\Junk' | '\\Trash'

/** The roles "Tutti gli account" shows, in the order Outlook and Apple Mail list them. */
export const UNIFIED_FOLDER_ROLES: ReadonlyArray<FolderRole> = [
  '\\Inbox',
  '\\Sent',
  '\\Drafts',
  '\\Archive',
  '\\Junk',
  '\\Trash'
]

const ROLE_LABELS: Readonly<Record<FolderRole, string>> = {
  '\\Inbox': 'Posta in arrivo',
  '\\Sent': 'Posta inviata',
  '\\Drafts': 'Bozze',
  '\\Archive': 'Archivio',
  '\\Junk': 'Spam',
  '\\Trash': 'Cestino'
}

/** "[Gmail]/…", or "[Google Mail]/…" where the brand differs. */
const GMAIL_SYSTEM_FOLDER_PATTERN = /^\[(?:gmail|google mail)\]/i

export function folderRoleLabel(role: FolderRole): string {
  return ROLE_LABELS[role]
}

/**
 * The role a folder plays: the special use the server gives it (imapflow
 * also recognises the usual names in many languages), and INBOX, which IMAP
 * spells that way in any case.
 */
export function folderRole(folder: Pick<MailFolder, 'path' | 'specialUse'>): FolderRole | null {
  if (folder.path.toUpperCase() === 'INBOX') {
    return '\\Inbox'
  }

  const specialUse = folder.specialUse?.toLowerCase()
  return (
    (Object.keys(ROLE_LABELS) as FolderRole[]).find((role) => role.toLowerCase() === specialUse) ??
    null
  )
}

/**
 * A folder as the app names it: by its role when it has one — "INBOX",
 * "Sent Items" and "INBOX.Trash" read as Italian, as every other folder of
 * that kind does — and by its own name otherwise.
 */
export function folderDisplayName(
  folder: Pick<MailFolder, 'path' | 'specialUse' | 'name'>
): string {
  const role = folderRole(folder)
  return role ? ROLE_LABELS[role] : folder.name
}

/**
 * An account's folder for a role. Archiving on Gmail leaves the inbox for
 * "Tutti i messaggi", where every message already is, and that is its
 * archive; anywhere else a folder flagged \Archive, or none yet.
 */
export function folderForRole(
  folders: ReadonlyArray<MailFolder>,
  role: FolderRole
): MailFolder | null {
  const flagged = folders.find((folder) => folderRole(folder) === role)

  if (flagged || role !== '\\Archive') {
    return flagged ?? null
  }

  return (
    folders.find(
      (folder) =>
        folder.specialUse?.toLowerCase() === '\\all' &&
        GMAIL_SYSTEM_FOLDER_PATTERN.test(folder.path)
    ) ?? null
  )
}

const UNIFIED_FOLDER_PREFIX = '__all__:'

/** The path of a folder of "Tutti gli account": one role, across the accounts included. */
export function unifiedFolderPath(role: FolderRole): string {
  return `${UNIFIED_FOLDER_PREFIX}${role}`
}

/** The role a "Tutti gli account" path gathers, or null for an account's own folder. */
export function unifiedFolderRole(path: string | null | undefined): FolderRole | null {
  if (!path?.startsWith(UNIFIED_FOLDER_PREFIX)) {
    return null
  }

  const role = path.slice(UNIFIED_FOLDER_PREFIX.length)
  return (UNIFIED_FOLDER_ROLES as ReadonlyArray<string>).includes(role)
    ? (role as FolderRole)
    : null
}
