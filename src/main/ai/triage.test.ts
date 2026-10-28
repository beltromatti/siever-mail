import { describe, expect, it } from 'vitest'

import {
  namedTopicIndexes,
  namedTopicLine,
  parseTriage,
  topicCatalog,
  triageRequest
} from './triage'
import { distinctNames, nameForm, nameForms, saysAnyName } from './topic-names'

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
            { tipo: 'ti_chiedono', testo: 'Offerta 3 pompe', scadenza: '2026-10-30' },
            { tipo: 'aspetti', testo: 'Aspetti il riscontro di Giulia', scadenza: null },
            { tipo: 'ti_chiedono', testo: 'Ti_chiedono: la disponibilità', scadenza: null }
          ],
          impegni_aggiornati: [{ numero: 2, testo: 'Sopralluogo da Anna', scadenza: '2026-11-03' }],
          impegni_chiusi: [4],
          argomento: '[T3]'
        })
      )
    ).toEqual({
      summary: 'Anna chiede l’offerta entro venerdì',
      state: 'da_rispondere',
      priority: 'alta',
      reason: 'cliente, scadenza vicina',
      due: '2026-10-30',
      opened: [
        { kind: 'ti_chiedono', text: 'Offerta 3 pompe', due: '2026-10-30' },
        { kind: 'aspetti', text: 'Il riscontro di Giulia', due: null },
        { kind: 'ti_chiedono', text: 'La disponibilità', due: null }
      ],
      updated: [{ id: 2, text: 'Sopralluogo da Anna', due: '2026-11-03' }],
      closed: [4],
      topic: { key: 'T3' }
    })
  })

  it('reads the topic as a key, a new one, or none', () => {
    const answer = (argomento: string): ReturnType<typeof parseTriage>['topic'] =>
      parseTriage(
        JSON.stringify({
          sintesi: 'x',
          stato: 'informativo',
          priorita: 'media',
          motivo: '',
          scadenza: null,
          impegni_nuovi: [],
          impegni_aggiornati: [],
          impegni_chiusi: [],
          argomento
        })
      ).topic

    expect(answer('t12')).toEqual({ key: 'T12' })
    expect(answer('NUOVO:  Celle di stagionatura –  Caseificio Valli')).toEqual({
      create: 'Celle di stagionatura – Caseificio Valli'
    })
    expect(answer('')).toBeNull()
    expect(answer('nessuno')).toBeNull()
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
        impegni_aggiornati: [],
        impegni_chiusi: [],
        argomento: ''
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
          impegni_aggiornati: [],
          impegni_chiusi: [],
          argomento: ''
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
    expect(request).toContain('- [7] aspetti: Conferma del sopralluogo')
    expect(request.indexOf('Ci confermi giovedì?')).toBeLessThan(
      request.indexOf('▶ IL MESSAGGIO DA ANNOTARE')
    )
    expect(request).toContain('Mi mandi l’offerta entro venerdì?')
  })
})

describe('topic names', () => {
  it('matches a pratica however its number is written, and only whole', () => {
    const names = nameForms(['Prat2451', 'pratica n. 2451', 'CASEIFICIO VALLI', 'xy'])

    expect(names).toEqual(['prat2451', 'pratica n2451', 'caseificio valli'])
    expect(saysAnyName(nameForm('Re: Prat. 2451 – ordine'), names)).toBe(true)
    expect(saysAnyName(nameForm('vedi PRAT 2451(snc)'), names)).toBe(true)
    expect(saysAnyName(nameForm('la pratica n.2451 è chiusa'), names)).toBe(true)
    expect(saysAnyName(nameForm('Il Caseificio Vallì di Bondeno'), names)).toBe(true)
    expect(saysAnyName(nameForm('Prat24510'), names)).toBe(false)
    expect(saysAnyName(nameForm('caseificio vallio'), names)).toBe(false)
  })

  it('names a pratica only by what no other one is called', () => {
    const [older, newer, other] = distinctNames([
      nameForms(['Prat2447', 'AUSL FERRARA']),
      nameForms(['Prat2427', 'AUSL FERRARA']),
      nameForms(['Prat2483', 'AUSL OSPEDALE SANT ANNA'])
    ])

    expect(older).toEqual(['prat2447'])
    expect(newer).toEqual(['prat2427'])
    expect(other).toEqual(['prat2483', 'ausl ospedale sant anna'])
    expect(saysAnyName(nameForm("AUSL Ferrara — Ospedale Sant'Anna"), older)).toBe(false)
  })
})

describe('the topic catalogue', () => {
  const topics = [
    { title: 'Prat2495 · ENERGIA VERDE', description: null, current: true, names: ['prat2495'] },
    { title: 'Prat2310 · MOLINO SPADONI', description: null, current: false, names: ['prat2310'] },
    { title: 'Prat2311 · BANCA DEL PO', description: null, current: false, names: ['prat2311'] }
  ]

  it('lists those in corso, with keys that hold for the others', () => {
    const catalog = topicCatalog('Pratiche', topics)

    expect(catalog).toContain('# Pratiche in corso')
    expect(catalog).toContain('[T1] Prat2495 · ENERGIA VERDE')
    expect(catalog).not.toContain('MOLINO')
    expect(catalog).toContain('altri 2')
  })

  it('points out every topic a conversation names, in corso or not', () => {
    const named = namedTopicIndexes(topics, [
      { subject: 'Re: Prat. 2310 molino', text: 'vedi anche Prat2495' }
    ])

    expect(named).toEqual([0, 1])
    expect(named.map((index) => namedTopicLine(topics, index))).toEqual([
      '[T1] Prat2495 · ENERGIA VERDE',
      '[T2] Prat2310 · MOLINO SPADONI'
    ])
  })
})

describe('triageRequest with its topic', () => {
  it('shows what is open in the rest of the pratica, to close and not to reopen', () => {
    const request = triageRequest({
      today: new Date(2026, 9, 28),
      accountEmail: 'm@example.com',
      accountName: 'Mattia',
      accountNote: null,
      fromUser: false,
      people: [],
      open: [],
      thread: [
        {
          date: '2026-10-27T09:00:00.000Z',
          from: [{ name: 'Laura', address: 'laura@comune.example' }],
          to: [],
          cc: [],
          subject: 'Integrazioni',
          text: 'Ricevute le integrazioni, grazie.',
          target: true
        }
      ],
      openInTopic: {
        title: 'Prat2463 · COMUNE DI COPPARO',
        items: [
          {
            id: 41,
            accountId: 'a',
            threadId: 't2',
            messageKey: 'k',
            kind: 'da_fare',
            text: 'Trasmettere le integrazioni ai VVF',
            due: '2026-11-16',
            status: 'aperto',
            createdAt: 0,
            closedAt: null,
            closedBy: null
          }
        ]
      },
      laterInTopic: {
        title: 'Prat2463 · COMUNE DI COPPARO',
        notes: [{ date: '2026-10-27T16:20:00.000Z', summary: 'Integrazioni trasmesse ai VVF' }]
      }
    })

    expect(request).toContain(
      '## Cose già aperte in Prat2463 · COMUNE DI COPPARO, in altre conversazioni'
    )
    expect(request).toContain(
      '- [41] da_fare: Trasmettere le integrazioni ai VVF (entro 2026-11-16)'
    )
    expect(request).toMatch(
      /## Dopo questo messaggio, in Prat2463 · COMUNE DI COPPARO\n\n- .*27\/10\/2026.*: Integrazioni trasmesse ai VVF/
    )
  })
})
