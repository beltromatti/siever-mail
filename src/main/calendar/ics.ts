/** An invitation as an iCalendar file carries it: what it asks, and the event it is about. */
export interface IcsInvitation {
  /** REQUEST (an invitation, or its update), CANCEL, REPLY… */
  method: string
  uid: string
  summary: string | null
  /** For a whole series (a rule, no RECURRENCE-ID): answered for every instance, not one. */
  series: boolean
}

/** The value of a property line — "SUMMARY;LANGUAGE=it:Riunione" — with its escapes undone. */
function valueOf(line: string): string {
  return line
    .slice(line.indexOf(':') + 1)
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim()
}

/**
 * The invitation in an iCalendar file: its method and the first event's
 * UID and summary. Long lines are unfolded first, as RFC 5545 folds them.
 */
export function parseInvitation(text: string): IcsInvitation | null {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  let method = 'PUBLISH'
  let uid: string | null = null
  let summary: string | null = null
  let rule = false
  let instance = false
  let inEvent = false

  for (const line of lines) {
    const name = line.split(/[:;]/, 1)[0].toUpperCase()

    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      inEvent = true
    } else if (line.toUpperCase() === 'END:VEVENT') {
      if (uid) {
        break
      }

      inEvent = false
    } else if (name === 'METHOD' && !inEvent) {
      method = valueOf(line).toUpperCase()
    } else if (inEvent && name === 'UID') {
      uid = valueOf(line)
    } else if (inEvent && name === 'SUMMARY') {
      summary = valueOf(line)
    } else if (inEvent && name === 'RRULE') {
      rule = true
    } else if (inEvent && name === 'RECURRENCE-ID') {
      instance = true
    }
  }

  return uid ? { method, uid, summary, series: rule && !instance } : null
}
