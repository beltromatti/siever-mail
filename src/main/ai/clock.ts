/** The moment, as every run of the Segretario is told it: at its start, and with every word of the user's. */
export function nowLine(at = Date.now()): string {
  return `Ora: ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'short' }).format(at)}.`
}
