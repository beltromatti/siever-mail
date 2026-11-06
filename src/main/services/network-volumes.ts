/**
 * Folders on a network share, reachable whenever the share can be, wherever
 * it is mounted now.
 *
 *   • macOS — a share mounted under /Volumes is gone after a restart until
 *     the Finder mounts it again, and a path inside it simply does not
 *     exist: "Lavori" looked empty until the user opened it in the Finder.
 *     Every share seen mounted is remembered with the URL it was mounted
 *     from (as `mount` reports it), and mounted again — with the
 *     credentials the keychain keeps for it, as the Finder would — when a
 *     path under it is needed and missing. The same share may come back at
 *     another mount point — "Archivio-1", when a folder left behind holds
 *     "Archivio" — and a path kept under the old one is reached under it.
 *   • Windows — a mapped drive can come back from a restart "Unavailable"
 *     (the red cross in Esplora file) until something reconnects it; it is
 *     reconnected as Microsoft documents it, with New-SmbMapping. A share
 *     mapped to another letter since is reached there, and one no longer
 *     mapped at all through its UNC path.
 *
 * What the app keeps (a copy's folder, a project's folder, the archive's
 * root) is kept as `canonicalPath` writes it: under the mount point — the
 * letter — the share first had, so two paths of one share always compare
 * alike. `reachablePath` turns it into the path that reaches it now.
 *
 * Nothing here runs for a path that is not on such a share.
 */
import { execFile } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve, win32 } from 'node:path'

import { app } from 'electron'

import { logMainError } from '@main/utils/error-utils'

const VOLUMES_ROOT = '/Volumes'
const KNOWN_SHARES_FILE = 'network-volumes.json'
/** Long enough for a password typed into the system's prompt, when the keychain has none. */
const MOUNT_DEADLINE_MS = 60_000
const RECONNECT_DEADLINE_MS = 30_000
const MAPPINGS_DEADLINE_MS = 15_000
const NETWORK_FILE_SYSTEMS = new Set(['smbfs', 'afpfs', 'nfs', 'webdav'])

export interface MountedShare {
  mountPoint: string
  /** The URL the share was mounted from, as the Finder's "Connetti al server" takes it. */
  url: string
}

/** A Windows drive letter mapped to a share, as Get-SmbMapping reports it. */
export interface DriveMapping {
  /** "Z:" */
  letter: string
  /** "\\nas\archivio" */
  remote: string
  status: string
}

export interface Reach {
  /**
   * Mount the share again — reconnect the drive — when it is not there:
   * what the user asks for. Without, a path is only found where its share
   * already is: work on its own never brings up the system's password prompt.
   */
  mount?: boolean
}

function run(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    execFile(command, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        rejectRun(new Error(stderr.trim() || error.message, { cause: error }))
      } else {
        resolveRun(stdout)
      }
    })
  })
}

/**
 * The network shares in `mount`'s output, each as the URL it was mounted
 * from: `//anna@nas.local/Lavori on /Volumes/Lavori (smbfs, …)` is
 * smb://anna@nas.local/Lavori. Share names come percent-encoded, as URLs
 * want them; mount points as they are, spaces included.
 */
export function parseNetworkMounts(output: string): MountedShare[] {
  return output.split('\n').flatMap((line) => {
    const match = /^(\S+) on (\/.*) \(([a-z0-9_]+)[,)]/.exec(line.trim())

    if (!match || !NETWORK_FILE_SYSTEMS.has(match[3])) {
      return []
    }

    const [, source, mountPoint, fileSystem] = match
    const url =
      fileSystem === 'smbfs' && source.startsWith('//')
        ? `smb:${source}`
        : fileSystem === 'afpfs' && source.startsWith('//')
          ? `afp:${source}`
          : fileSystem === 'nfs' && /^[^/:]+:\//.test(source)
            ? `nfs://${source.replace(':/', '/')}`
            : /^https?:\/\//.test(source)
              ? source
              : null

    return url ? [{ mountPoint, url }] : []
  })
}

/** The drives Get-SmbMapping lists, from its JSON: one object, or a list of them. */
export function parseDriveMappings(json: string): DriveMapping[] {
  const parsed = json.trim() ? (JSON.parse(json) as unknown) : []
  const entries = Array.isArray(parsed) ? parsed : [parsed]

  return entries.flatMap((entry) => {
    const record = entry as Record<string, unknown> | null
    const letter =
      typeof record?.LocalPath === 'string' ? record.LocalPath.trim().toUpperCase() : ''
    const remote = typeof record?.RemotePath === 'string' ? record.RemotePath.trim() : ''

    return /^[A-Z]:$/.test(letter) && remote.startsWith('\\\\')
      ? [{ letter, remote, status: String(record?.Status ?? '') }]
      : []
  })
}

/** "/Volumes/Lavori" for any path inside that volume, or null for a path elsewhere. */
export function volumeMountPointOf(path: string): string | null {
  const absolute = resolve(path)

  if (!absolute.startsWith(`${VOLUMES_ROOT}/`)) {
    return null
  }

  const [volume] = absolute.slice(VOLUMES_ROOT.length + 1).split('/')
  return volume ? join(VOLUMES_ROOT, volume) : null
}

/** A path under one mount point — a drive — written under another: the rest of it as it was. */
export function movedPath(path: string, from: string, to: string): string {
  return from === to ? path : `${to}${path.slice(from.length)}`
}

/**
 * Of the mount points a share has had, the one its paths are kept under:
 * the first without the "-1" macOS adds when the usual one is taken, else
 * the first.
 */
export function canonicalMountPoint(points: ReadonlyArray<string>): string | undefined {
  return points.find((point) => !/-\d+$/.test(point)) ?? points[0]
}

/** "smb://anna@nas.local/Lavori" as the user reads it: "Lavori su nas.local". */
function describeShare(url: string): string {
  try {
    const parsed = new URL(url)
    const share = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    return share ? `«${share}» su ${parsed.hostname}` : parsed.hostname
  } catch {
    return url
  }
}

/** Two URLs of one share: the same server and share, whatever the user or its case. */
export function isSameShare(left: string, right: string): boolean {
  const key = (url: string): string => {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.hostname}${decodeURIComponent(parsed.pathname)}`.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  }

  return key(left) === key(right)
}

/**
 * What was learnt of the shares, kept in the profile: each mount point — on
 * Windows each drive letter — with the share it held. Written as it is
 * learnt, in the order learnt: the first a share had is its usual one.
 */
class KnownShares {
  private shares: Map<string, string> | null = null

  private get storePath(): string {
    return join(app.getPath('userData'), KNOWN_SHARES_FILE)
  }

  async all(): Promise<Map<string, string>> {
    if (!this.shares) {
      try {
        const stored = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown
        this.shares = new Map(
          Object.entries(stored && typeof stored === 'object' ? stored : {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      } catch {
        // Nothing remembered yet.
        this.shares = new Map()
      }
    }

    return this.shares
  }

  /** Learns where these shares are: whatever is new is kept at once. */
  async learn(found: ReadonlyArray<{ place: string; share: string }>): Promise<void> {
    const known = await this.all()
    const changed = found.filter(({ place, share }) => known.get(place) !== share)

    if (changed.length === 0) {
      return
    }

    for (const { place, share } of changed) {
      known.set(place, share)
    }

    await writeFile(this.storePath, JSON.stringify(Object.fromEntries(known), null, 2)).catch(
      (error: unknown) => logMainError('Remembering network shares failed', error)
    )
  }

  /** The places the same share has had, in the order learnt. */
  async placesOf(share: string, same: (left: string, right: string) => boolean): Promise<string[]> {
    return [...(await this.all())].filter(([, other]) => same(other, share)).map(([place]) => place)
  }
}

class MacNetworkVolumes {
  private readonly known = new KnownShares()
  private readonly mounting = new Map<string, Promise<string>>()

  /** The shares mounted now, remembered for when they are not. */
  async mountedShares(): Promise<MountedShare[]> {
    const mounted = parseNetworkMounts(await run('/sbin/mount', [], 10_000))
    await this.known.learn(mounted.map((share) => ({ place: share.mountPoint, share: share.url })))
    return mounted
  }

  /** The remembered shares that are not mounted now, by mount point. */
  async unmountedShares(): Promise<Set<string>> {
    const mounted = await this.mountedShares()
    const shares = await this.known.all()

    return new Set(
      [...shares]
        .filter(
          ([point, url]) =>
            !mounted.some((share) => share.mountPoint === point || isSameShare(share.url, url))
        )
        .map(([point]) => point)
    )
  }

  async canonical(path: string): Promise<string> {
    const mountPoint = volumeMountPointOf(path)
    const url = mountPoint ? (await this.known.all()).get(mountPoint) : undefined

    if (!mountPoint || !url) {
      return path
    }

    const usual = canonicalMountPoint(await this.known.placesOf(url, isSameShare))
    return usual ? movedPath(path, mountPoint, usual) : path
  }

  async reach(path: string, mount: boolean): Promise<string> {
    const mountPoint = volumeMountPointOf(path)

    if (!mountPoint) {
      return path
    }

    const pending = this.mounting.get(mountPoint)

    if (pending) {
      return movedPath(path, mountPoint, await pending)
    }

    const work = this.mountPointNow(mountPoint, mount)

    if (!mount) {
      return movedPath(path, mountPoint, await work)
    }

    const shared = work.finally(() => this.mounting.delete(mountPoint))
    this.mounting.set(mountPoint, shared)
    return movedPath(path, mountPoint, await shared)
  }

  /**
   * Where the volume kept at `mountPoint` is now: there, when it is — or
   * when it is a disk, or a share nobody saw — else where its share is
   * mounted, mounting it first with `mount`.
   */
  private async mountPointNow(mountPoint: string, mount: boolean): Promise<string> {
    const mounted = await this.mountedShares()

    if (
      mounted.some((share) => share.mountPoint === mountPoint) ||
      (await isLocalVolume(mountPoint))
    ) {
      return mountPoint
    }

    const url = (await this.known.all()).get(mountPoint)

    if (!url) {
      if (mount) {
        throw new Error(
          `«${mountPoint.slice(VOLUMES_ROOT.length + 1)}» non è collegato. Se è una cartella di rete, aprila una volta nel Finder: da quel momento SIEVER Mail la ricollegherà da sola.`
        )
      }

      return mountPoint
    }

    // The same share at another mount point — "Archivio-1": reached there.
    const elsewhere = mounted.find((share) => isSameShare(share.url, url))

    if (elsewhere || !mount) {
      return elsewhere?.mountPoint ?? mountPoint
    }

    try {
      // Standard Additions' "mount volume": the keychain's credentials, or
      // the system's own prompt — and no Finder window.
      await run(
        '/usr/bin/osascript',
        ['-e', `mount volume "${url.replace(/["\\]/g, '\\$&')}"`],
        MOUNT_DEADLINE_MS
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        /-128\b/.test(detail)
          ? `Collegamento a ${describeShare(url)} annullato.`
          : `Impossibile collegare ${describeShare(url)}: controlla la rete, o collegala dal Finder.`,
        { cause: error }
      )
    }

    return (
      (await this.mountedShares()).find((share) => isSameShare(share.url, url))?.mountPoint ??
      mountPoint
    )
  }
}

/** Whether `mountPoint` holds a volume mounted from a disk: the startup disk's link, a USB disk. */
async function isLocalVolume(mountPoint: string): Promise<boolean> {
  try {
    const [volume, volumes] = await Promise.all([stat(mountPoint), stat(VOLUMES_ROOT)])
    return volume.dev !== volumes.dev
  } catch {
    return false
  }
}

const DRIVE_LETTER_PATTERN = /^([a-z]):(?=[\\/]|$)/i

function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}

class WindowsNetworkDrives {
  private readonly known = new KnownShares()

  /** The drives mapped to shares now, remembered for when they are not. */
  async mappings(): Promise<DriveMapping[]> {
    const output = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-SmbMapping | Select-Object LocalPath, RemotePath, @{n="Status";e={"$($_.Status)"}} | ConvertTo-Json -Compress'
      ],
      MAPPINGS_DEADLINE_MS
    )
    const mappings = parseDriveMappings(output)
    await this.known.learn(
      mappings.map((mapping) => ({ place: mapping.letter, share: mapping.remote }))
    )
    return mappings
  }

  async canonical(path: string): Promise<string> {
    const letter = DRIVE_LETTER_PATTERN.exec(path)?.[1]?.toUpperCase()
    const remote = letter ? (await this.known.all()).get(`${letter}:`) : undefined

    if (!letter || !remote) {
      return path
    }

    const usual = (await this.known.placesOf(remote, sameRemote))[0]
    return usual ? movedPath(path, `${letter}:`, usual) : path
  }

  /**
   * The path that reaches a kept one now: on its drive when the drive is
   * there; reconnected, with `mount`, when Windows left it unavailable; on
   * another letter when the share is mapped there now; else through the
   * share's own UNC path, which needs no letter.
   */
  async reach(path: string, mount: boolean): Promise<string> {
    const letter = DRIVE_LETTER_PATTERN.exec(path)?.[1]?.toUpperCase()

    if (!letter || (await exists(`${letter}:\\`))) {
      return path
    }

    const drive = `${letter}:`
    const mappings = await this.mappings().catch((error: unknown) => {
      logMainError('Reading the mapped drives failed', error)
      return []
    })
    const mine = mappings.find((mapping) => mapping.letter === drive)

    if (mine && mount) {
      await reconnect(drive, mine.remote)
      return path
    }

    const remote = mine?.remote ?? (await this.known.all()).get(drive)

    if (!remote) {
      return path
    }

    const elsewhere = mappings.find(
      (mapping) =>
        mapping.letter !== drive && sameRemote(mapping.remote, remote) && mapping.status === 'OK'
    )

    return movedPath(path, drive, elsewhere?.letter ?? win32.normalize(remote))
  }
}

function sameRemote(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/** Reconnects a mapped drive Windows left "Unavailable" after a restart. */
async function reconnect(drive: string, remote: string): Promise<void> {
  const quoted = (value: string): string => `'${value.replace(/'/g, "''")}'`

  try {
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `New-SmbMapping -LocalPath ${quoted(drive)} -RemotePath ${quoted(remote)} -Persistent $true -ErrorAction Stop | Out-Null`
      ],
      RECONNECT_DEADLINE_MS
    )
  } catch (error) {
    throw new Error(
      `L'unità ${drive} non è collegata e non si è potuta ricollegare: aprila in Esplora file, o controlla la rete.`,
      { cause: error }
    )
  }
}

const macVolumes = process.platform === 'darwin' ? new MacNetworkVolumes() : null
const windowsDrives = process.platform === 'win32' ? new WindowsNetworkDrives() : null

/**
 * The path that reaches `path` now: the same, under the mount point — the
 * drive — its share has now. With `mount` (the default: the user asked) a
 * share a restart left unmounted is mounted again first, a drive left
 * unavailable reconnected; rejects, in words for the user, when that
 * cannot be done. Any other path comes back as it is.
 */
export async function reachablePath(path: string, { mount = true }: Reach = {}): Promise<string> {
  if (macVolumes) {
    return macVolumes.reach(path, mount)
  }

  if (windowsDrives) {
    return windowsDrives.reach(path, mount)
  }

  return path
}

/**
 * `path` as the app keeps it: under the mount point — the drive — its
 * share first had, so the same folder kept twice is kept alike whichever
 * mount point it was reached through.
 */
export async function canonicalPath(path: string): Promise<string> {
  try {
    if (macVolumes) {
      return await macVolumes.canonical(path)
    }

    if (windowsDrives) {
      return await windowsDrives.canonical(path)
    }
  } catch (error) {
    logMainError('A path could not be put as it is kept', error)
  }

  return path
}

/**
 * The volumes of shares the app has seen mounted that are not mounted now
 * (macOS): a file on one is still there, and comes back with the share.
 */
export async function unmountedShareMountPoints(): Promise<ReadonlySet<string>> {
  return macVolumes ? macVolumes.unmountedShares() : new Set()
}

/** The volumes of the network shares mounted now (macOS), learnt as `rememberMountedShares` does. */
export async function mountedShareMountPoints(): Promise<ReadonlySet<string>> {
  return new Set((await macVolumes?.mountedShares())?.map((share) => share.mountPoint) ?? [])
}

/** Learns the shares mounted — the drives mapped — now, so they can be reached after a restart. */
export async function rememberMountedShares(): Promise<void> {
  await macVolumes?.mountedShares()
  await windowsDrives?.mappings()
}
