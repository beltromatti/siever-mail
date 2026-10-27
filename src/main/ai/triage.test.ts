import { describe, expect, it } from 'vitest'

import { parseTriage, triageRequest } from './triage'

describe('parseTriage', () => {
  it('takes the note and what it opens and closes', () => {
    expect(
      parseTriage(
        JSON.stringify({
          sintesi: '  Anna chiede   l’offerta entro venerdì ',
          stato: 'da_rispondere',
          priorita: 'alta',
          motivo: 'cliente, scadenza vicina',
          scadenza: '2026-10-30',
          impegni_nuovi: [
            { tipo: 'ti_chiedono', testo: 'Offerta 3 pompe', scadenza: '2026-10-30' }
          ],
          impegni_chiusi: [4]
        })
      )
    ).toEqual({
      summary: 'Anna chiede l’offerta entro venerdì',
      state: 'da_rispondere',
      priority: 'alta',
      reason: 'cliente, scadenza vicina',
      due: '2026-10-30',
      opened: [{ kind: 'ti_chiedono', text: 'Offerta 3 pompe', due: '2026-10-30' }],
      closed: [4]
    })
  })

  it('keeps only real dates as deadlines', () => {
    const triage = parseTriage(
      JSON.stringify({
        sintesi: 'Newsletter',
        stato: 'rumore',
        priorita: 'bassa',
        motivo: '',
        scadenza: 'venerdì',
        impegni_nuovi: [],
        impegni_chiusi: []
      })
    )

    expect(triage.due).toBeNull()
  })

  it('refuses an answer the views could not show', () => {
    expect(() =>
      parseTriage(
        JSON.stringify({
          sintesi: 'x',
          stato: 'urgente',
          priorita: 'alta',
          motivo: '',
          scadenza: null,
          impegni_nuovi: [],
          impegni_chiusi: []
        })
      )
    ).toThrow()
  })
})

describe('triageRequest', () => {
  const anna = { name: 'Anna Rossi', address: 'anna@cliente.it' }
  const me = { name: 'Mattia', address: 'mattia@example.com' }

  it('gives the day, the account, what is open and the conversation up to the message', () => {
    const request = triageRequest({
      today: new Date(2026, 9, 27),
      accountEmail: me.address,
      accountName: 'Mattia',
      accountNote: 'La casella di lavoro.',
      fromUser: false,
      people: [{ path: 'persone/anna-rossi.md', content: 'Cliente storica.' }],
      open: [
        {
          id: 7,
          accountId: 'a',
          threadId: 't',
          messageKey: 'k',
          kind: 'aspetti',
          text: 'Conferma del sopralluogo',
          due: null,
          status: 'aperto',
          createdAt: 0,
          closedAt: null,
          closedBy: null
        }
      ],
      thread: [
        {
          date: '2026-10-26T09:00:00.000Z',
          from: [me],
          to: [anna],
          cc: [],
          subject: 'Sopralluogo',
          text: 'Ci confermi giovedì?',
          target: false
        },
        {
          date: '2026-10-27T09:00:00.000Z',
          from: [anna],
          to: [me],
          cc: [],
          subject: 'Re: Sopralluogo',
          text: 'Confermo giovedì. Mi mandi l’offerta entro venerdì?',
          target: true
        }
      ]
    })

    expect(request).toContain('Oggi è martedì 27 ottobre 2026.')
    expect(request).toContain("arrivato all'utente")
    expect(request).toContain('La casella di lavoro.')
    expect(request).toContain('### persone/anna-rossi.md\nCliente storica.')
    expect(request).toContain("- [7] l'utente aspetta: Conferma del sopralluogo")
    expect(request.indexOf('Ci confermi giovedì?')).toBeLessThan(
      request.indexOf('▶ IL MESSAGGIO DA ANNOTARE')
    )
    expect(request).toContain('Mi mandi l’offerta entro venerdì?')
  })
})
