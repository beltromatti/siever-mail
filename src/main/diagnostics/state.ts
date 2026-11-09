import { diagnostics } from './log'

const log = diagnostics('app')

/**
 * What each part of the app says of itself when the diagnostics are
 * exported (vision §14.4): the shell, every source, the Segretario, the
 * extension. A part registers its own, under its name; a new source adds
 * its own the same way, and nothing else changes. One part that cannot
 * answer says why, and the others are told all the same.
 */
type StatePart = () => unknown

const parts = new Map<string, StatePart>()

export function provideDiagnosticState(name: string, part: StatePart): void {
  parts.set(name, part)
}

/** Every part's state, each on its own: one failing is written as such. */
export async function diagnosticState(): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    [...parts].map(async ([name, part]) => {
      try {
        return [name, await part()] as const
      } catch (error) {
        log.error(`The state of ${name} could not be told`, error)
        return [
          name,
          { unavailable: error instanceof Error ? error.message : String(error) }
        ] as const
      }
    })
  )

  return Object.fromEntries(entries)
}
