import { describe, expect, it } from 'vitest'

import { summarizeMail, type OverviewRow } from './mail-overview'

const me = { name: 'Mattia', address: 'mattia@example.com' }
const anna = { name: 'Anna Rossi', address: 'anna@cliente.it' }
const bot = { name: 'Notifiche', address: 'noreply@servizio.com' }

let key = 0
const row = (
  from: OverviewRow['from'][number],
  to: OverviewRow['to'],
  dateIso: string,
  threadId: string,
  messageKey = `k${++key}`
): OverviewRow => ({ messageKey, threadId, from: [from], to, cc: [], dateIso })

describe('summarizeMail', () => {
  const own = new Set([me.address])

  it('counts each message once, whichever folders hold it', () => {
    const sent = row(me, [anna], '2026-10-01T10:00:00Z', 't1', 'dup')
    const overview = summarizeMail([sent, { ...sent }], own, 10)

    expect(overview.sent).toBe(1)
    expect(overview.writtenTo).toEqual([
      { address: anna.address, name: 'Anna Rossi', messages: 1, lastIso: '2026-10-01T10:00:00Z' }
    ])
  })

  it('says how many of a sender’s messages the user answered, by a later reply in the thread', () => {
    const overview = summarizeMail(
      [
        row(anna, [me], '2026-10-01T09:00:00Z', 't1'),
        row(me, [anna], '2026-10-01T10:00:00Z', 't1'),
        row(anna, [me], '2026-10-02T09:00:00Z', 't1'),
        row(bot, [me], '2026-10-03T09:00:00Z', 't2'),
        row(bot, [me], '2026-10-04T09:00:00Z', 't3'),
        row(bot, [me], '2026-10-05T09:00:00Z', 't4')
      ],
      own,
      10
    )

    expect(
      overview.writers.map((person) => [person.address, person.messages, person.answered])
    ).toEqual([
      [bot.address, 3, 0],
      [anna.address, 2, 1]
    ])
  })

  it('leaves the user’s own addresses out of the people, and counts by month', () => {
    const overview = summarizeMail(
      [
        row(me, [me, anna], '2026-09-30T23:00:00Z', 't1'),
        row(anna, [me], '2026-10-01T09:00:00Z', 't2')
      ],
      own,
      10
    )

    expect(overview.writtenTo.map((person) => person.address)).toEqual([anna.address])
    expect(overview.months).toEqual([
      { month: '2026-10', sent: 0, received: 1 },
      { month: '2026-09', sent: 1, received: 0 }
    ])
  })
})
