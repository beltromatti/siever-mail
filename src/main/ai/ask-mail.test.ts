import { describe, expect, it } from 'vitest'

import { askMailRequest, parseAskedSearch } from './ask-mail'

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
      unreadOnly: false,
      withAttachments: true,
      summary: 'Offerte di Gallo, con allegato'
    })
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
