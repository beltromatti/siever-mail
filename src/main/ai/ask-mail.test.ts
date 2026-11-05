import { describe, expect, it } from 'vitest'

import { periodWords, searchPeriod } from './ask-mail'

describe('searchPeriod', () => {
  // Wednesday 28 October 2026.
  const today = new Date(2026, 9, 28, 9)
  const fixed = { from: '2026-09-01', to: '2026-09-30' }

  it('counts a period from the day it runs, the week from Monday', () => {
    const on = (
      kind:
        'oggi' | 'ieri' | 'questa_settimana' | 'settimana_scorsa' | 'questo_mese' | 'mese_scorso'
    ): { from: string | null; to: string | null } =>
      searchPeriod({ ...fixed, period: { kind, days: null } }, today)

    expect(on('oggi')).toEqual({ from: '2026-10-28', to: '2026-10-28' })
    expect(on('ieri')).toEqual({ from: '2026-10-27', to: '2026-10-27' })
    expect(on('questa_settimana')).toEqual({ from: '2026-10-26', to: '2026-10-28' })
    expect(on('settimana_scorsa')).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(on('questo_mese')).toEqual({ from: '2026-10-01', to: '2026-10-28' })
    expect(on('mese_scorso')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(searchPeriod({ ...fixed, period: { kind: 'ultimi_giorni', days: 10 } }, today)).toEqual({
      from: '2026-10-19',
      to: '2026-10-28'
    })
    expect(periodWords({ kind: 'ultimi_giorni', days: 10 })).toBe('negli ultimi 10 giorni')
  })

  it('keeps fixed dates, and takes a search kept before periods existed', () => {
    expect(searchPeriod({ ...fixed, period: null }, today)).toEqual(fixed)
    expect(searchPeriod(fixed, today)).toEqual(fixed)
  })
})
