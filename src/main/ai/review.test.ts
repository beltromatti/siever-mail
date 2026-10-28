import { describe, expect, it } from 'vitest'

import { parseReview, reviewRequest } from './review'

describe('reviewRequest', () => {
  it('gives the message as it goes, the one it answers and the days ahead with their weekdays', () => {
    const request = reviewRequest({
      today: new Date(2026, 9, 28),
      from: 'Mattia <mattia@example.com>',
      to: ['Fabio Costa <fabio@fornitore.it>'],
      cc: [],
      subject: 'Re: Ordine',
      attachments: [],
      writtenText: 'Ciao Fabio, in allegato la scheda. Ci vediamo lunedì 4 novembre.',
      answered: { from: 'Fabio Costa', date: '27 ott 2026, 16:05', text: 'Muletto o gru?' }
    })

    expect(request).toContain('Allegati: nessuno')
    expect(request).toContain('mer 4 nov')
    expect(request).toContain('## Il messaggio a cui risponde')
    expect(request).toContain('Muletto o gru?')
  })
})

describe('parseReview', () => {
  it('keeps the problems, a short line each, at most four', () => {
    expect(
      parseReview(
        JSON.stringify({
          problemi: [
            '  Scrivi «in allegato»   ma non c’è nessun allegato ',
            '',
            'Il 4 novembre è mercoledì',
            'a',
            'b',
            'c'
          ]
        })
      )
    ).toEqual([
      'Scrivi «in allegato» ma non c’è nessun allegato',
      'Il 4 novembre è mercoledì',
      'a',
      'b'
    ])
  })
})
