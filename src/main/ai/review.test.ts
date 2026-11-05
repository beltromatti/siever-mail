import { describe, expect, it } from 'vitest'

import { reviewRequest } from './review'

describe('reviewRequest', () => {
  it('gives the message as it goes, and names the one it answers', () => {
    const request = reviewRequest({
      now: 'Ora: mercoledì 28 ottobre 2026 alle ore 10:00.',
      from: 'Mattia <mattia@example.com>',
      to: ['Fabio Costa <fabio@fornitore.it>'],
      cc: [],
      subject: 'Re: Ordine',
      attachments: [],
      writtenText: 'Ciao Fabio, in allegato la scheda. Ci vediamo lunedì 4 novembre.',
      answered: { handle: 'm1', from: 'Fabio Costa', date: '27 ott 2026, 16:05', subject: 'Ordine' }
    })

    expect(request).toContain('Allegati: nessuno')
    expect(request).toContain('Ci vediamo lunedì 4 novembre.')
    expect(request).toContain('Risponde a m1 · 27 ott 2026, 16:05 · da Fabio Costa · «Ordine».')
  })
})
