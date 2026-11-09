/**
 * The moment, as every run of the Segretario is told it: at its start, with
 * every word of the user's, and again on a run that goes on long (see
 * `buildConversation`).
 */
export function nowLine(at = Date.now()): string {
  return `Ora: ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'short' }).format(at)}.`
}
