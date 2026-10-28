import { describe, expect, it } from 'vitest'

import { parseReadyDraft, readyDraftRequest } from './ready-drafts'

describe('parseReadyDraft', () => {
  it('takes the reply and what to check first', () => {
    expect(
      parseReadyDraft(
        JSON.stringify({ testo: 'Ciao Anna,\n\nva bene giovedì.', dubbi: '  Conferma l’orario. ' })
      )
    ).toEqual({ text: 'Ciao Anna,\n\nva bene giovedì.', doubts: 'Conferma l’orario.' })
  })

  it('refuses an empty reply', () => {
    expect(() => parseReadyDraft(JSON.stringify({ testo: '  ', dubbi: '' }))).toThrow()
  })
})

describe('readyDraftRequest', () => {
  const anna = { name: 'Anna Rossi', address: 'anna@cliente.it' }
  const me = { name: 'Mattia', address: 'mattia@example.com' }

  it('asks to answer the message, with the note and how the user writes to the person', () => {
    const request = readyDraftRequest({
      today: new Date(2026, 9, 27),
      accountEmail: me.address,
      accountName: 'Mattia',
      accountNote: null,
      people: [],
      note: { summary: 'Anna chiede l’offerta entro venerdì', due: '2026-10-30' },
      thread: [
        {
          date: '2026-10-27T09:00:00.000Z',
          from: [anna],
          to: [me],
          cc: [],
          subject: 'Offerta',
          text: 'Mi mandi l’offerta entro venerdì?',
          target: true
        }
      ],
      examples: [
        { date: '12 ott 2026, 10:00', subject: 'Re: Sopralluogo', text: 'Ciao Anna, confermo.' }
      ]
    })

    expect(request).toContain('▶ IL MESSAGGIO A CUI RISPONDERE')
    expect(request).not.toContain('Cose già aperte')
    expect(request).toContain('Anna chiede l’offerta entro venerdì (entro 2026-10-30)')
    expect(request).toContain(
      '### 12 ott 2026, 10:00 · Oggetto: Re: Sopralluogo\nCiao Anna, confermo.'
    )
  })

  it('asks for a reminder after the user’s own message, with what is awaited', () => {
    const request = readyDraftRequest({
      today: new Date(2026, 9, 28),
      accountEmail: me.address,
      accountName: 'Mattia',
      accountNote: null,
      people: [],
      note: { summary: 'Chiedi ad Anna il verbale firmato', due: null },
      thread: [
        {
          date: '2026-10-21T09:00:00.000Z',
          from: [me],
          to: [anna],
          cc: [],
          subject: 'Verbale',
          text: 'Mi rimandi il verbale firmato?',
          target: true
        }
      ],
      examples: [],
      awaited: [{ text: 'Il verbale firmato da Anna', due: '2026-10-24' }]
    })

    expect(request).toContain("▶ L'ULTIMO MESSAGGIO DELL'UTENTE, ANCORA SENZA RISPOSTA")
    expect(request).toContain('- Il verbale firmato da Anna (era atteso entro 2026-10-24)')
    expect(request).not.toContain('Cosa chiede, secondo la tua nota')
  })
})
