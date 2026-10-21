/**
 * The files the "Allega" menu offers: what the user recently handled in
 * SIEVER Mail, merged with what the operating system itself remembers
 * opening, newest first.
 *
 *   • Windows — the Recent Items folder Explorer keeps, one shortcut per
 *     file opened or saved anywhere, network shares included.
 *   • macOS — Spotlight's last-used date. It only covers indexed volumes,
 *     which rules out most network shares; files used through SIEVER Mail
 *     fill that gap.
 *   • Linux — the desktop's shared `recently-used.xbel`.
 *
 * What the system remembers is kept between lookups and looked up again in
 * the background: a slow index or an unreachable share never holds the
 * menu up, and never empties it either — it shows what was last found.
 * Copies a program keeps for itself — an attachment opened from a message,
 * a temporary file — are not the user's files, and are left out.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, shell } from 'electron'

import type { RecentFile } from '@shared/models'

import { isExecutableAttachment } from './attachment-files'

export interface RecentFileCandidate {
  path: string
  activity: string
  usedAt: number
}

/** Opened or saved: the system does not tell which. */
const SYSTEM_ACTIVITY = 'Usato di recente'
const SYSTEM_LOOKUP_DEADLINE_MS = 1_500
/** What the system remembers is looked up again past this age. */
const SYSTEM_RECENTS_FRESH_MS = 3_000
const FILE_CHECK_DEADLINE_MS = 800
const SYSTEM_CANDIDATES_SCANNED = 60
const MAC_RECENT_DAYS = 30

function withDeadline<T>(work: Promise<T>, deadlineMs: number, onTimeout: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), deadlineMs)

    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(onTimeout)
      }
    )
  })
}

async function listWindowsRecentFiles(): Promise<RecentFileCandidate[]> {
  const directory = app.getPath('recent')
  const entries = await readdir(directory, { withFileTypes: true })
  const shortcuts = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.lnk'))
      .map(async (entry) => {
        const shortcutPath = join(directory, entry.name)
        return { shortcutPath, usedAt: (await stat(shortcutPath)).mtimeMs }
      })
  )

  return shortcuts
    .sort((left, right) => right.usedAt - left.usedAt)
    .slice(0, SYSTEM_CANDIDATES_SCANNED)
    .flatMap(({ shortcutPath, usedAt }) => {
      try {
        const { target } = shell.readShortcutLink(shortcutPath)
        return target ? [{ path: target, activity: SYSTEM_ACTIVITY, usedAt }] : []
      } catch {
        // A shortcut Explorer wrote for something that is not a file.
        return []
      }
    })
}

const MAC_LAST_USED_SEPARATOR = '   kMDItemLastUsedDate = '

function listMacRecentFiles(): Promise<RecentFileCandidate[]> {
  const query = [
    `kMDItemLastUsedDate >= $time.today(-${MAC_RECENT_DAYS})`,
    'kMDItemContentTypeTree != "public.folder"',
    'kMDItemContentTypeTree != "com.apple.bundle"',
    'kMDItemContentTypeTree != "com.apple.application"'
  ].join(' && ')

  return new Promise((resolve, reject) => {
    execFile(
      'mdfind',
      ['-onlyin', homedir(), '-attr', 'kMDItemLastUsedDate', query],
      { maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        const candidates = stdout.split('\n').flatMap((line) => {
          const separatorIndex = line.lastIndexOf(MAC_LAST_USED_SEPARATOR)

          if (separatorIndex <= 0) {
            return []
          }

          const path = line.slice(0, separatorIndex)
          const usedAt = Date.parse(
            line
              .slice(separatorIndex + MAC_LAST_USED_SEPARATOR.length)
              .trim()
              .replace(' ', 'T')
              .replace(' ', '')
          )

          return Number.isFinite(usedAt) ? [{ path, activity: SYSTEM_ACTIVITY, usedAt }] : []
        })

        resolve(
          candidates
            .sort((left, right) => right.usedAt - left.usedAt)
            .slice(0, SYSTEM_CANDIDATES_SCANNED)
        )
      }
    )
  })
}

const XBEL_BOOKMARK_PATTERN = /<bookmark\b[^>]*\bhref="(file:[^"]+)"[^>]*\bmodified="([^"]+)"/g

async function listLinuxRecentFiles(): Promise<RecentFileCandidate[]> {
  const xbel = await readFile(join(homedir(), '.local/share/recently-used.xbel'), 'utf8')

  return [...xbel.matchAll(XBEL_BOOKMARK_PATTERN)]
    .flatMap(([, href, modified]) => {
      const usedAt = Date.parse(modified)
      return Number.isFinite(usedAt)
        ? [
            {
              path: fileURLToPath(href.replaceAll('&amp;', '&')),
              activity: SYSTEM_ACTIVITY,
              usedAt
            }
          ]
        : []
    })
    .sort((left, right) => right.usedAt - left.usedAt)
    .slice(0, SYSTEM_CANDIDATES_SCANNED)
}

function lookUpSystemRecentFiles(): Promise<RecentFileCandidate[]> {
  switch (process.platform) {
    case 'win32':
      return listWindowsRecentFiles()
    case 'darwin':
      return listMacRecentFiles()
    default:
      return listLinuxRecentFiles()
  }
}

let systemRecents: { candidates: RecentFileCandidate[]; at: number } | null = null
let systemLookup: Promise<RecentFileCandidate[]> | null = null

/** Looks the system's recent files up again, once at a time; a failed lookup keeps the last list. */
function refreshSystemRecentFiles(): Promise<RecentFileCandidate[]> {
  systemLookup ??= lookUpSystemRecentFiles()
    .then(
      (candidates) => {
        systemRecents = { candidates, at: Date.now() }
        return candidates
      },
      () => systemRecents?.candidates ?? []
    )
    .finally(() => {
      systemLookup = null
    })

  return systemLookup
}

/**
 * What the system remembers: as found a moment ago, or looked up again —
 * waiting for that no longer than the deadline, after which the last list
 * stands in and the lookup goes on for the next time.
 */
function listSystemRecentFiles(): Promise<RecentFileCandidate[]> {
  if (systemRecents && Date.now() - systemRecents.at < SYSTEM_RECENTS_FRESH_MS) {
    return Promise.resolve(systemRecents.candidates)
  }

  return withDeadline(
    refreshSystemRecentFiles(),
    SYSTEM_LOOKUP_DEADLINE_MS,
    systemRecents?.candidates ?? []
  )
}

/** Folders holding the copies programs keep for themselves, and what in them is the user's. */
export interface PrivateFolders {
  roots: ReadonlyArray<string>
  exceptions: ReadonlyArray<string>
}

export function privateFolders(): PrivateFolders {
  const home = homedir()
  const roots = [app.getPath('userData'), app.getPath('temp'), tmpdir()]

  switch (process.platform) {
    // Roaming, Local and LocalLow: Outlook's attachment copies, every temp folder.
    case 'win32':
      return { roots: [...roots, join(home, 'AppData')], exceptions: [] }
    // iCloud Drive and the cloud providers (OneDrive, Dropbox) live under Library.
    case 'darwin':
      return {
        roots: [...roots, join(home, 'Library'), '/private/var/folders'],
        exceptions: [
          join(home, 'Library', 'Mobile Documents'),
          join(home, 'Library', 'CloudStorage')
        ]
      }
    default:
      return { roots, exceptions: [] }
  }
}

function isInside(path: string, folder: string, caseSensitive: boolean): boolean {
  const [child, parent] = caseSensitive
    ? [path, folder.replace(/[\\/]+$/, '')]
    : [path.toLowerCase(), folder.toLowerCase().replace(/[\\/]+$/, '')]

  return child.startsWith(parent) && (child[parent.length] === '/' || child[parent.length] === '\\')
}

/**
 * Whether `path` is a file of the user's: not something that runs, not in
 * a hidden folder, not a copy a program keeps for itself — an attachment
 * opened from a message lands in such a copy, and offering it back offered
 * a file that disappears with the cache.
 */
export function isUserFile(
  path: string,
  folders: PrivateFolders,
  caseSensitive = process.platform === 'linux'
): boolean {
  return (
    !isExecutableAttachment(path) &&
    !path.split(/[\\/]/).some((part) => part.startsWith('.') && part !== '.' && part !== '..') &&
    (!folders.roots.some((root) => isInside(path, root, caseSensitive)) ||
      folders.exceptions.some((folder) => isInside(path, folder, caseSensitive)))
  )
}

/**
 * A file still worth offering: it exists and it is a file. A path whose
 * check outlives the deadline — a share that is slow to answer — stays in
 * the list; attaching it checks again.
 */
async function describeCandidate(candidate: RecentFileCandidate): Promise<RecentFile | null> {
  const summary: RecentFile = {
    path: candidate.path,
    name: basename(candidate.path),
    folder: dirname(candidate.path),
    activity: candidate.activity,
    usedAt: candidate.usedAt
  }

  return withDeadline(
    stat(candidate.path).then(
      (stats) => (stats.isFile() ? summary : null),
      () => null
    ),
    FILE_CHECK_DEADLINE_MS,
    summary
  )
}

/**
 * One list, newest first, one entry per file. What the user did in SIEVER
 * Mail says more than "opened", so the app's own label wins when both
 * remember the same file — at the more recent of the two times. Paths
 * compare case-insensitively where the file system does.
 */
export function mergeRecentCandidates(
  appHistory: ReadonlyArray<RecentFileCandidate>,
  systemRecents: ReadonlyArray<RecentFileCandidate>,
  caseSensitivePaths = process.platform === 'linux'
): RecentFileCandidate[] {
  const byPath = new Map<string, RecentFileCandidate>()

  for (const candidate of [...appHistory, ...systemRecents]) {
    const key = caseSensitivePaths ? candidate.path : candidate.path.toLowerCase()
    const existing = byPath.get(key)

    if (!existing) {
      byPath.set(key, candidate)
    } else if (candidate.usedAt > existing.usedAt) {
      byPath.set(key, { ...existing, usedAt: candidate.usedAt })
    }
  }

  return [...byPath.values()].sort((left, right) => right.usedAt - left.usedAt)
}

export async function listRecentFiles(
  appHistory: ReadonlyArray<RecentFileCandidate>,
  limit: number
): Promise<RecentFile[]> {
  const folders = privateFolders()
  const ordered = mergeRecentCandidates(appHistory, await listSystemRecentFiles()).filter(
    (candidate) => isUserFile(candidate.path, folders)
  )
  const described = await Promise.all(
    ordered.slice(0, limit * 2).map((candidate) => describeCandidate(candidate))
  )

  return described.filter((file): file is RecentFile => file !== null).slice(0, limit)
}
