import { describe, expect, it } from 'vitest'

import { askMailRequest, parseAskedSearch, periodWords, searchPeriod } from './ask-mail'

describe('parseAskedSearch', () => {
  it('takes the search as the model framed it, empty fields as none and bad dates dropped', () => {
    expect(
      parseAskedSearch(
        JSON.stringify({
          testo: ' Gallo "gruppi frigo" ',
          cartella: '',
          account: null,
          dal: '2026-09-01',
          al: 'settembre',
          periodo: 'nessuno',
          giorni: null,
          non_lette: false,
          con_allegati: true,
          in_breve: 'Offerte di Gallo, con allegato'
        })
      )
    ).toEqual({
      text: 'Gallo "gruppi frigo"',
      folder: null,
      account: null,
      from: '2026-09-01',
      to: null,
      period: null,
      unreadOnly: false,
      withAttachments: true,
      summary: 'Offerte di Gallo, con allegato'
    })
  })
})

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

  it('reads the last days without a number as no period', () => {
    expect(
      parseAskedSearch(
        JSON.stringify({
          testo: '',
          cartella: null,
          account: null,
          dal: null,
          al: null,
          periodo: 'ultimi_giorni',
          giorni: 0,
          non_lette: true,
          con_allegati: false,
          in_breve: 'Non lette'
        })
      ).period
    ).toBeNull()
  })
})

describe('askMailRequest', () => {
  it('gives the day, as a date the model can count from, and the accounts', () => {
    const request = askMailRequest({
      today: new Date('2026-10-28T09:00:00Z'),
      accounts: ['a@example.com'],
      question: "l'offerta di Gallo"
    })

    expect(request).toContain('(2026-10-28)')
    expect(request).toContain('a@example.com')
    expect(request).toContain("La richiesta: l'offerta di Gallo")
  })
})
