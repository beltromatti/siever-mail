/**
 * Folders on a network share, reachable whenever the share can be.
 *
 *   • macOS — a share mounted under /Volumes is gone after a restart until
 *     the Finder mounts it again, and a path inside it simply does not
 *     exist: "Lavori" looked empty until the user opened it in the Finder.
 *     Every share seen mounted is remembered with the URL it was mounted
 *     from (as `mount` reports it), and mounted again — with the
 *     credentials the keychain keeps for it, as the Finder would — when a
 *     path under it is needed and missing.
 *   • Windows — a mapped drive can come back from a restart "Unavailable"
 *     (the red cross in Esplora file) until something reconnects it; it is
 *     reconnected as Microsoft documents it, with New-SmbMapping.
 *
 * Nothing here runs for a path that is not on such a share, or that is.
 */
import { execFile } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { app } from 'electron'

import { logMainError } from '@main/utils/error-utils'

const VOLUMES_ROOT = '/Volumes'
const KNOWN_SHARES_FILE = 'network-volumes.json'
/** Long enough for a password typed into the system's prompt, when the keychain has none. */
const MOUNT_DEADLINE_MS = 60_000
const RECONNECT_DEADLINE_MS = 30_000
const NETWORK_FILE_SYSTEMS = new Set(['smbfs', 'afpfs', 'nfs', 'webdav'])

export interface MountedShare {
  mountPoint: string
  /** The URL the share was mounted from, as the Finder's "Connetti al server" takes it. */
  url: string
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

/** "/Volumes/Lavori" for any path inside that volume, or null for a path elsewhere. */
export function volumeMountPointOf(path: string): string | null {
  const absolute = resolve(path)

  if (!absolute.startsWith(`${VOLUMES_ROOT}/`)) {
    return null
  }

  const [volume] = absolute.slice(VOLUMES_ROOT.length + 1).split('/')
  return volume ? join(VOLUMES_ROOT, volume) : null
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
function isSameShare(left: string, right: string): boolean {
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

class MacNetworkVolumes {
  private knownShares: Map<string, string> | null = null
  private readonly mounting = new Map<string, Promise<void>>()

  private get storePath(): string {
    return join(app.getPath('userData'), KNOWN_SHARES_FILE)
  }

  private async known(): Promise<Map<string, string>> {
    if (!this.knownShares) {
      try {
        const stored = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown
        this.knownShares = new Map(
          Object.entries(stored && typeof stored === 'object' ? stored : {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      } catch {
        // Nothing remembered yet.
        this.knownShares = new Map()
      }
    }

    return this.knownShares
  }

  /** The shares mounted now, remembered for when they are not. */
  async mountedShares(): Promise<MountedShare[]> {
    const mounted = parseNetworkMounts(await run('/sbin/mount', [], 10_000))
    const known = await this.known()
    const changed = mounted.filter((share) => known.get(share.mountPoint) !== share.url)

    if (changed.length > 0) {
      for (const share of changed) {
        known.set(share.mountPoint, share.url)
      }

      await writeFile(this.storePath, JSON.stringify(Object.fromEntries(known), null, 2)).catch(
        (error: unknown) => logMainError('Remembering network shares failed', error)
      )
    }

    return mounted
  }

  /** The remembered shares that are not mounted now, by mount point. */
  async unmountedShares(): Promise<Set<string>> {
    const mounted = new Set((await this.mountedShares()).map((share) => share.mountPoint))
    return new Set([...(await this.known()).keys()].filter((point) => !mounted.has(point)))
  }

  async ensureReachable(path: string): Promise<void> {
    const mountPoint = volumeMountPointOf(path)

    if (!mountPoint) {
      return
    }

    const pending = this.mounting.get(mountPoint)

    if (pending) {
      return pending
    }

    const work = this.mountIfNeeded(mountPoint).finally(() => this.mounting.delete(mountPoint))
    this.mounting.set(mountPoint, work)
    return work
  }

  private async mountIfNeeded(mountPoint: string): Promise<void> {
    const mounted = await this.mountedShares()

    if (
      mounted.some((share) => share.mountPoint === mountPoint) ||
      (await isLocalVolume(mountPoint))
    ) {
      return
    }

    const name = mountPoint.slice(VOLUMES_ROOT.length + 1)
    const url = (await this.known()).get(mountPoint)

    if (!url) {
      throw new Error(
        `«${name}» non è collegato. Se è una cartella di rete, aprila una volta nel Finder: da quel momento SIEVER Mail la ricollegherà da sola.`
      )
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

    const now = (await this.mountedShares()).find((share) => isSameShare(share.url, url))

    if (now && now.mountPoint !== mountPoint) {
      throw new Error(
        `${describeShare(url)} è stata collegata come «${now.mountPoint}», perché «${mountPoint}» è occupato da una cartella rimasta da un collegamento precedente: riavvia il Mac per liberarlo.`
      )
    }
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

const DRIVE_LETTER_PATTERN = /^([a-z]):[\\/]?/i

/** Reconnects the mapped drive `path` is on, when Windows left it "Unavailable" after a restart. */
async function reconnectMappedDrive(path: string): Promise<void> {
  const drive = DRIVE_LETTER_PATTERN.exec(path)?.[1]?.toUpperCase()

  if (
    !drive ||
    (await stat(`${drive}:\\`).then(
      () => true,
      () => false
    ))
  ) {
    return
  }

  const script = [
    `$mapping = Get-SmbMapping -LocalPath '${drive}:' -ErrorAction SilentlyContinue`,
    "if ($mapping -and $mapping.Status -ne 'OK') {",
    `  New-SmbMapping -LocalPath '${drive}:' -RemotePath $mapping.RemotePath -Persistent $true -ErrorAction Stop | Out-Null`,
    '}'
  ].join('\n')

  try {
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      RECONNECT_DEADLINE_MS
    )
  } catch (error) {
    throw new Error(
      `L'unità ${drive}: non è collegata e non si è potuta ricollegare: aprila in Esplora file, o controlla la rete.`,
      { cause: error }
    )
  }
}

const macVolumes = process.platform === 'darwin' ? new MacNetworkVolumes() : null

/**
 * Makes the share `path` is on reachable, when it is on one that is not:
 * mounts it again on macOS, reconnects its drive on Windows. Rejects, in
 * words for the user, when that cannot be done; resolves at once for any
 * other path.
 */
export async function ensurePathReachable(path: string): Promise<void> {
  if (macVolumes) {
    await macVolumes.ensureReachable(path)
  } else if (process.platform === 'win32') {
    await reconnectMappedDrive(path)
  }
}

/**
 * The volumes of shares the app has seen mounted that are not mounted now
 * (macOS): a file on one is still there, and comes back with the share.
 */
export async function unmountedShareMountPoints(): Promise<ReadonlySet<string>> {
  return macVolumes ? macVolumes.unmountedShares() : new Set()
}

/** Learns the shares mounted now, so they can be mounted again after a restart. */
export async function rememberMountedShares(): Promise<void> {
  await macVolumes?.mountedShares()
}
