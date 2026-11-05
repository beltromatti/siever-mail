import { describe, expect, it } from 'vitest'

import { reviewRequest } from './review'

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
      answered: { from: 'Fabio Costa', date: '27 ott 2026, 16:05', text: 'Muletto o gru?' },
      found: ['«lunedì 4 novembre»: il 4 novembre 2026 è mercoledì.']
    })

    expect(request).toContain('Allegati: nessuno')
    expect(request).toContain('mer 4 nov')
    expect(request).toContain('## Il messaggio a cui risponde')
    expect(request).toContain('Muletto o gru?')
    expect(request).toContain(
      "## Già segnalato all'utente dal programma (non ripeterlo)\n\n- «lunedì 4 novembre»"
    )
  })
})
