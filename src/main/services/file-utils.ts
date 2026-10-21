/**
 * Generic filesystem helpers shared between the host (attachments written
 * to disk) and any extension that materialises files of its own.
 * Intentionally domain-agnostic: nothing here knows about accounts or any
 * product concept.
 */
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Resolves to `true` if the path exists on disk and is accessible by the
 * current process, `false` otherwise.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Strips characters disallowed on common filesystems (Windows is the
 * strictest) and collapses whitespace. Returns `fallback` if the input
 * normalises to an empty string.
 */
export function sanitizePathSegment(rawValue: string, fallback: string): string {
  const sanitized = rawValue
    .trim()
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0)

      if (code < 32 || /[<>:"/\\|?*]/.test(character)) {
        return '_'
      }

      return character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')

  return sanitized || fallback
}

/**
 * Drops trailing dots / spaces from a base name and returns the supplied
 * fallback when the cleaned candidate is empty.
 */
export function normalizeTruncatedBaseName(candidate: string, fallbackBaseName: string): string {
  const cleaned = candidate.trim().replace(/[. ]+$/g, '')

  if (cleaned) {
    return cleaned
  }

  return sanitizePathSegment(fallbackBaseName, 'file')
}

/**
 * Trims a file name down to `maxLength` characters while preserving the
 * extension. Used when the destination filesystem (or downstream tools)
 * impose a per-segment length limit.
 */
export function truncateFileName(
  fileName: string,
  maxLength: number,
  fallbackBaseName: string
): string {
  if (maxLength < 1) {
    return sanitizePathSegment(fallbackBaseName, 'file')
  }

  const normalized = sanitizePathSegment(fileName, fallbackBaseName)

  if (normalized.length <= maxLength) {
    return normalized
  }

  const extensionIndex = normalized.lastIndexOf('.')
  const hasExtension = extensionIndex > 0 && extensionIndex < normalized.length - 1

  if (!hasExtension) {
    return normalizeTruncatedBaseName(normalized.slice(0, maxLength), fallbackBaseName)
  }

  const extension = normalized.slice(extensionIndex)

  if (extension.length >= maxLength) {
    return normalizeTruncatedBaseName(normalized.slice(0, maxLength), fallbackBaseName)
  }

  const baseMaxLength = maxLength - extension.length
  const baseName = normalizeTruncatedBaseName(normalized.slice(0, baseMaxLength), fallbackBaseName)

  return `${baseName}${extension}`
}

/**
 * Picks a non-colliding path inside `directoryPath`, appending ` (N)` to
 * the base name as needed. Honours `maxFileNameLength` so the resulting
 * name still fits the filesystem limit after the suffix is added.
 */
export async function resolveUniqueFilePath(
  directoryPath: string,
  fileName: string,
  maxFileNameLength?: number
): Promise<string> {
  let candidatePath = join(directoryPath, candidateFileName(fileName, '', maxFileNameLength))
  let suffixIndex = 1

  while (await pathExists(candidatePath)) {
    candidatePath = join(
      directoryPath,
      candidateFileName(fileName, ` (${suffixIndex})`, maxFileNameLength)
    )
    suffixIndex += 1
  }

  return candidatePath
}

/** `fileName` with `suffix` before its extension, its base cut to fit `maxFileNameLength`. */
function candidateFileName(fileName: string, suffix: string, maxFileNameLength?: number): string {
  const extensionIndex = fileName.lastIndexOf('.')
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ''

  if (!maxFileNameLength || maxFileNameLength < 1) {
    return `${baseName}${suffix}${extension}`
  }

  const maxBaseLength = Math.max(1, maxFileNameLength - extension.length - suffix.length)
  return `${normalizeTruncatedBaseName(baseName.slice(0, maxBaseLength), 'file')}${suffix}${extension}`
}

/**
 * Writes `content` as a new file in `directoryPath`, under `fileName` or —
 * when that is taken — the first free "name (N)", and returns the path
 * written. Each name is claimed by an exclusive create, so writers working
 * in parallel in one folder never overwrite each other.
 */
export async function writeUniqueFile(
  directoryPath: string,
  fileName: string,
  content: string | Buffer,
  options?: {
    maxFileNameLength?: number
    fallbackFileName?: string
  }
): Promise<string> {
  const safeFileName = options?.maxFileNameLength
    ? truncateFileName(fileName, options.maxFileNameLength, options.fallbackFileName ?? 'file')
    : sanitizePathSegment(fileName, options?.fallbackFileName ?? 'file')

  for (let attempt = 0; ; attempt += 1) {
    const targetFilePath = join(
      directoryPath,
      candidateFileName(
        safeFileName,
        attempt === 0 ? '' : ` (${attempt})`,
        options?.maxFileNameLength
      )
    )

    try {
      await writeFile(targetFilePath, content, { flag: 'wx' })
      return targetFilePath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }
}
