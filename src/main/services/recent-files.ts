/**
 * The files the "Allega" menu offers: what the user recently handled in
 * SIEVER Mail, merged with what the operating system itself remembers
 * opening, newest first.
 *
 *   • Windows — the Recent Items folder Explorer keeps, one shortcut per
 *     file opened anywhere, network shares included.
 *   • macOS — Spotlight's last-used date. It only covers indexed volumes,
 *     which rules out most network shares; files used through SIEVER Mail
 *     fill that gap.
 *   • Linux — the desktop's shared `recently-used.xbel`.
 *
 * Every system lookup runs against a deadline: a slow index or an
 * unreachable share must never hold the menu up.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
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

const SYSTEM_ACTIVITY = 'Aperto di recente'
const SYSTEM_LOOKUP_DEADLINE_MS = 1_500
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

          // Spotlight also remembers files inside hidden folders and caches.
          return Number.isFinite(usedAt) && !path.includes('/.')
            ? [{ path, activity: SYSTEM_ACTIVITY, usedAt }]
            : []
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

function listSystemRecentFiles(): Promise<RecentFileCandidate[]> {
  switch (process.platform) {
    case 'win32':
      return listWindowsRecentFiles()
    case 'darwin':
      return listMacRecentFiles()
    default:
      return listLinuxRecentFiles()
  }
}

/**
 * A file still worth offering: it exists, it is a file, and it is not
 * something that runs. A path whose check outlives the deadline — a share
 * that is slow to answer — stays in the list; attaching it checks again.
 */
async function describeCandidate(candidate: RecentFileCandidate): Promise<RecentFile | null> {
  if (isExecutableAttachment(candidate.path)) {
    return null
  }

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
  const systemRecents = await withDeadline(
    listSystemRecentFiles(),
    SYSTEM_LOOKUP_DEADLINE_MS,
    [] as RecentFileCandidate[]
  )
  const ordered = mergeRecentCandidates(appHistory, systemRecents)
  const described = await Promise.all(
    ordered.slice(0, limit * 2).map((candidate) => describeCandidate(candidate))
  )

  return described.filter((file): file is RecentFile => file !== null).slice(0, limit)
}
