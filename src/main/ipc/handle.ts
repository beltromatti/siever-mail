import { ipcMain } from 'electron'
import { z } from 'zod'

import { diagnostics, isSecretKey } from '@main/diagnostics/log'
import type { DiagnosticArea } from '@shared/diagnostics'

/** A call of the page that takes longer than this is written down: where the app feels slow. */
const SLOW_MS = 2_000
/** Text longer than this is not a name, whatever its field. */
const NAME_LENGTH = 200
/** The fields that name a thing — an id, a key, a folder, a choice —: kept as they are. */
const NAME_KEY =
  /(^id$|Id$|Ids$|^uid$|Key$|Keys$|^folderPath$|^role$|^status$|^kind$|^field$|^direction$|^filter$|^grouping$|^view$|^family$|^provider$|^task$)/
/** An id given on its own, without a field to say so. */
const ID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * What a failed call was given, as the log may keep it (§14.4): what tells
 * which thing failed — ids, keys, folders, numbers, choices —, and of any
 * other text only its length. A password given to sign in again, a key, a
 * private calendar link, a question, a message: never their words.
 */
export function argsForLog(value: unknown, key = ''): unknown {
  if (key && isSecretKey(key)) {
    return '[tolto]'
  }

  if (typeof value === 'string') {
    return (NAME_KEY.test(key) || ID_SHAPED.test(value)) && value.length <= NAME_LENGTH
      ? value
      : `[${value.length} caratteri]`
  }

  if (Array.isArray(value)) {
    return value.map((item) => argsForLog(item, key))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, entry]) => [
        name,
        argsForLog(entry, name)
      ])
    )
  }

  return value
}

/** What a rejected input has wrong, each thing once: "«x@y.i» non è un indirizzo email valido." */
export function validationMessage(error: z.ZodError): string {
  return [...new Set(error.issues.map((issue) => issue.message))].slice(0, 3).join(' ')
}

export interface HandleOptions {
  /** What the channel waits for before its work: the storage, the Segretario. */
  before?: () => Promise<unknown>
  /** Its time is the user's — a dialog, a sign-in — or the model's: never written down as slow. */
  untimed?: boolean
}

/**
 * Answers a channel of the page, every part of the app the same way (§14.3,
 * §14.4): what it waits for first — the storage, the Segretario —, then the
 * work; what went wrong is written with the part it belongs to (input turned
 * down as a warning, the rest as an error) and goes back to the page in
 * words; a call that took long is written down with how long.
 */
export function handleIpc<Args extends unknown[], Result>(
  area: DiagnosticArea,
  channel: string,
  handler: (...args: Args) => Promise<Result> | Result,
  options: HandleOptions = {}
): void {
  const log = diagnostics(area)

  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (_event, ...args: Args) => {
    let startedAt = Date.now()

    try {
      if (options.before) {
        await options.before()
        startedAt = Date.now()
      }

      return await handler(...args)
    } catch (error) {
      // What was wrong, by where and what kind — never the words, which may repeat the input.
      if (error instanceof z.ZodError) {
        log.warn('ipc.refused', {
          channel,
          issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }))
        })
        throw new Error(validationMessage(error))
      }

      log.failed('ipc.failed', error, { channel, args: argsForLog(args) })
      throw error
    } finally {
      const ms = Date.now() - startedAt

      if (!options.untimed && ms >= SLOW_MS) {
        log.info('ipc.slow', { channel, ms })
      }
    }
  })
}
