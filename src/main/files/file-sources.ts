import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename, join } from 'node:path'

import type { FileSource } from '@shared/files'

import { mountedShareMountPoints, unmountedShareMountPoints } from '../services/network-volumes'

/** How long the sources read stay good: every run of the Segretario reads them, and Settings. */
const SOURCES_FRESH_MS = 30_000
/** A Windows drive that does not answer by then is left out: a mapped share gone away can take many seconds. */
const DRIVE_ANSWER_MS = 1_500

let recent: { at: number; sources: Promise<FileSource[]> } | null = null

/**
 * The File sources of this computer: the user's folders, then each volume
 * mounted — a disk plugged in, a network share — and the shares seen before
 * that are not mounted now, which come back when a path on them is needed.
 * The startup disk is the computer itself, not a volume of its own.
 */
export function fileSources(): Promise<FileSource[]> {
  if (!recent || Date.now() - recent.at > SOURCES_FRESH_MS) {
    recent = { at: Date.now(), sources: readFileSources() }
  }

  return recent.sources
}

async function readFileSources(): Promise<FileSource[]> {
  const [mounted, network, unmounted] = await Promise.all([
    mountedVolumes(),
    mountedShareMountPoints(),
    unmountedShareMountPoints()
  ])

  return [
    { kind: 'computer', label: 'Questo computer', path: homedir(), mounted: true },
    ...mounted.map((path): FileSource => ({
      kind: network.has(path) ? 'rete' : 'volume',
      label: volumeLabel(path),
      path,
      mounted: true
    })),
    ...[...unmounted]
      .filter((path) => !mounted.includes(path))
      .map((path): FileSource => ({ kind: 'rete', label: volumeLabel(path), path, mounted: false }))
  ]
}

/** A volume as the user knows it: its name, or the drive's letter on Windows. */
function volumeLabel(path: string): string {
  return process.platform === 'win32' ? `Disco ${path.slice(0, 2)}` : basename(path) || path
}

async function mountedVolumes(): Promise<string[]> {
  if (process.platform === 'darwin') {
    const entries = await readdir('/Volumes', { withFileTypes: true }).catch(() => [])
    const volumes = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map(async (entry) => {
          const path = join('/Volumes', entry.name)
          // The startup disk is there too, as a link to "/".
          return (await realpath(path).catch(() => path)) === '/' ? null : path
        })
    )
    return volumes.filter((path): path is string => path !== null)
  }

  if (process.platform === 'win32') {
    const drives = await Promise.all(
      [...'DEFGHIJKLMNOPQRSTUVWXYZ'].map(async (letter) => {
        const drive = `${letter}:\\`
        const answered = await Promise.race([
          stat(drive).then(
            () => true,
            () => false
          ),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DRIVE_ANSWER_MS))
        ])
        return answered ? drive : null
      })
    )
    return drives.filter((drive): drive is string => drive !== null)
  }

  // A Linux desktop mounts what is plugged in under /media/<user>, by hand under /mnt.
  const found = await Promise.all(
    [join('/media', userInfo().username), '/mnt'].map(async (root) => {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
      return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
    })
  )
  return found.flat()
}
