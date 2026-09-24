import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

import { app } from 'electron'

/**
 * Mirrors the main process console into a file in the system's log folder
 * (~/Library/Logs/SIEVER Mail on macOS, %APPDATA%\SIEVER Mail\logs on
 * Windows). A packaged app has no terminal: without this, a sync that
 * stalled on someone's machine left nothing behind to read. The file rolls
 * over at a few megabytes and the previous one is kept.
 */
const LOG_FILE_NAME = 'main.log'
const PREVIOUS_LOG_FILE_NAME = 'main.previous.log'
const MAX_LOG_BYTES = 4 * 1024 * 1024

export function startFileLogging(): void {
  const directory = app.getPath('logs')
  const filePath = join(directory, LOG_FILE_NAME)
  mkdirSync(directory, { recursive: true })

  let size = currentSize(filePath)

  const write = (level: string, args: unknown[]): void => {
    const line = `${new Date().toISOString()} ${level} ${format(...args)}\n`

    // Logging must never be the reason something else fails.
    try {
      if (size + line.length > MAX_LOG_BYTES) {
        renameSync(filePath, join(directory, PREVIOUS_LOG_FILE_NAME))
        size = 0
      }

      appendFileSync(filePath, line)
      size += Buffer.byteLength(line)
    } catch {
      // The console copy of the line still went out.
    }
  }

  for (const level of ['info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)

    console[level] = (...args: unknown[]): void => {
      original(...args)
      write(level.toUpperCase(), args)
    }
  }
}

function currentSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}
