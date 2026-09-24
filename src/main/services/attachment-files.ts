/**
 * Attachments on disk: the copies opened from the reader, and the files the
 * user saves.
 *
 * An opened attachment lands in `userData/attachments/<account>/<message>`.
 * One folder per account, so clearing an account's data or removing the
 * account takes its copies with it, and the data settings can measure and
 * empty them; the upgrade migration drops the whole tree on every version
 * change, like the rest of the message cache. Each attachment keeps its own
 * file name — it is what the opening application shows in its title bar.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { app } from 'electron'

import { pathExists } from './file-utils'

const ATTACHMENT_CACHE_DIRECTORY_NAME = 'attachments'

/**
 * Types that run code when opened. Outlook will not open these from a
 * message at all; here they can still be saved, deliberately, but a click
 * never launches one. Disk images are in because mounting one is how
 * malware slips past the mark-of-the-web.
 */
const EXECUTABLE_EXTENSIONS = new Set([
  // Windows
  'ade',
  'adp',
  'app',
  'application',
  'appref-ms',
  'appx',
  'appxbundle',
  'bas',
  'bat',
  'chm',
  'cmd',
  'com',
  'cpl',
  'diagcab',
  'exe',
  'gadget',
  'hlp',
  'hta',
  'inf',
  'ins',
  'isp',
  'jar',
  'js',
  'jse',
  'lnk',
  'msc',
  'msi',
  'msix',
  'msixbundle',
  'msp',
  'mst',
  'pif',
  'ps1',
  'ps1xml',
  'ps2',
  'psc1',
  'psd1',
  'psm1',
  'reg',
  'scf',
  'scr',
  'sct',
  'settingcontent-ms',
  'shb',
  'url',
  'vb',
  'vbe',
  'vbs',
  'ws',
  'wsc',
  'wsf',
  'wsh',
  'xll',
  // macOS and Unix
  'action',
  'command',
  'csh',
  'ksh',
  'mpkg',
  'pkg',
  'scpt',
  'sh',
  'terminal',
  'tool',
  'workflow',
  'zsh',
  // Disk images
  'dmg',
  'img',
  'iso',
  'vhd',
  'vhdx'
])

export function isExecutableAttachment(fileName: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(extname(fileName).slice(1).toLowerCase())
}

export function attachmentCacheRoot(): string {
  return join(app.getPath('userData'), ATTACHMENT_CACHE_DIRECTORY_NAME)
}

export function accountAttachmentCacheDirectory(accountId: string): string {
  return join(attachmentCacheRoot(), accountId)
}

/**
 * The folder one opened attachment lives in. Keyed on what identifies the
 * attachment for good — not the UID alone, which a server hands out again
 * after a mailbox is rebuilt — so a copy is never opened for the wrong
 * message.
 */
export function openedAttachmentDirectory(
  accountId: string,
  identity: ReadonlyArray<string | number>
): string {
  const key = createHash('sha256').update(identity.join('\n')).digest('hex').slice(0, 24)
  return join(accountAttachmentCacheDirectory(accountId), key)
}

export function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function fileSha256(filePath: string): Promise<string | null> {
  return (await pathExists(filePath)) ? sha256(await readFile(filePath)) : null
}

/**
 * Tags a file written from a message as coming from the internet, as
 * Outlook and every browser do on Windows: Office then opens it in
 * Protected View and SmartScreen vets anything that runs. The stream only
 * exists on NTFS; elsewhere (a FAT drive, some network shares) the file
 * itself is written all the same.
 */
export async function markFromInternet(filePath: string): Promise<void> {
  if (process.platform !== 'win32') {
    return
  }

  try {
    await writeFile(`${filePath}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n')
  } catch {
    // No alternate data streams on this volume.
  }
}

export async function directorySize(directoryPath: string): Promise<number> {
  if (!(await pathExists(directoryPath))) {
    return 0
  }

  const entries = await readdir(directoryPath, { withFileTypes: true, recursive: true })
  const sizes = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => (await stat(join(entry.parentPath, entry.name))).size)
  )

  return sizes.reduce((total, size) => total + size, 0)
}

export async function clearAttachmentCache(accountId?: string): Promise<void> {
  await rm(accountId ? accountAttachmentCacheDirectory(accountId) : attachmentCacheRoot(), {
    recursive: true,
    force: true
  })
}
