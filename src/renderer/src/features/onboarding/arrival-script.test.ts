import { describe, expect, it } from 'vitest'

import type { MemoryNote, OnboardingState } from '@shared/segretario'

import {
  aboutYouNote,
  arrivalSentences,
  arrivesAfter,
  greetingName,
  letterState,
  noteSentences,
  rankNotes,
  senderName
} from './arrival-script'

function note(path: string, content = '', updatedAt = 0): MemoryNote {
  return { path, content, updatedAt, revision: 1, updatedBy: 'segretario' }
}

const ITALIAN = `# Tu — Mario Rossi, titolare di Acme S.r.l.

Mario Rossi è il titolare di **Acme S.r.l.**, studio di progettazione a Brenta (fondato nel 2009). Segue di persona i cantieri più grandi e delega l'amministrazione a [Bianchi](contatti/bianchi.md).

## Come lavora
- preferisce risposte brevi e dirette, senza giri di parole
- Email: mario@acme-srl.it
- Lavora soprattutto con il comune e con \`Rossi & figli\`.
- Non vuole essere disturbato dopo le 19, salvo urgenze dai cantieri;
- Per i fornitori di fiducia vedi [[contatti/verdi|Verdi]], che conosce da vent'anni.
- Le offerte stanno in contatti/offerte, ordinate per anno.
- Cellulare 333 123 4567, solo per le urgenze dei cantieri.

## Come vuole essere avvisato:
1. Solo per i clienti che aspettano una risposta in giornata
2. Ok

| Chi | Come |
| --- | --- |
| Bianchi | sempre per email, anche per le cose brevi |

\`\`\`
regola interna, non una frase da mostrare a nessuno
\`\`\`

> Dice sempre: «prima il cantiere, poi la carta».
`

const ENGLISH = `You run a small design studio with two partners. You care most about deadlines with public clients; you hate long email threads. The studio's site is https://acme.example and nobody updates it.

* Prefers replies in the same language the client used
* Phone: +39 333 123 4567
* Short
`

const GERMAN = `---
aktualisiert: 2026-11-10
---
# Sie

Sie leiten das Büro in Brenta und kümmern sich selbst um die Angebote. Dr. Weber ist Ihr wichtigster Ansprechpartner bei der Stadt. Kurze, sachliche Antworten sind Ihnen lieber als lange Erklärungen.
`

describe('noteSentences', () => {
  it('keeps the prose of an Italian note, each list item a sentence, without what does not read alone', () => {
    expect(noteSentences(ITALIAN, 'it')).toEqual([
      'Mario Rossi è il titolare di Acme S.r.l., studio di progettazione a Brenta.',
      "Segue di persona i cantieri più grandi e delega l'amministrazione a Bianchi.",
      'Preferisce risposte brevi e dirette, senza giri di parole.',
      'Non vuole essere disturbato dopo le 19, salvo urgenze dai cantieri.',
      "Per i fornitori di fiducia vedi Verdi, che conosce da vent'anni.",
      'Solo per i clienti che aspettano una risposta in giornata.',
      'Dice sempre: «prima il cantiere, poi la carta».'
    ])
  })

  it('leaves out addresses of the web, phone numbers and fragments, in English', () => {
    expect(noteSentences(ENGLISH, 'en')).toEqual([
      'You run a small design studio with two partners.',
      'You care most about deadlines with public clients; you hate long email threads.',
      'Prefers replies in the same language the client used.'
    ])
  })

  it('skips front matter and headings, and does not break after a title, in German', () => {
    expect(noteSentences(GERMAN, 'de')).toEqual([
      'Sie leiten das Büro in Brenta und kümmern sich selbst um die Angebote.',
      'Dr. Weber ist Ihr wichtigster Ansprechpartner bei der Stadt.',
      'Kurze, sachliche Antworten sind Ihnen lieber als lange Erklärungen.'
    ])
  })

  it('leaves out a sentence too long to read in a breath, and one that leads into a list', () => {
    const long = `Lavora ${'con molta attenzione ai dettagli di ogni progetto, '.repeat(4)}sempre.`

    expect(noteSentences(`${long}\n\nLe sue regole per i clienti sono queste:\n`, 'it')).toEqual([])
  })
})

describe('rankNotes', () => {
  it('puts the note about the user first, by its likeliest names, at the root before in a folder', () => {
    const notes = [
      note('contatti/rossi.md', '', 9),
      note('stile.md'),
      note('progetti/tu.md'),
      note('decisioni.md', '', 5),
      note('profilo-utente.md'),
      note('tu.md'),
      note('connessioni.md', '', 7)
    ]

    expect(rankNotes(notes).map(({ path }) => path)).toEqual([
      'tu.md',
      'progetti/tu.md',
      'profilo-utente.md',
      'stile.md',
      'connessioni.md',
      'decisioni.md',
      'contatti/rossi.md'
    ])
  })

  it('finds the note about the user in every language, accents and case aside', () => {
    expect(aboutYouNote([note('stile.md'), note('Über mich.md')])?.path).toBe('Über mich.md')
    expect(aboutYouNote([note('style.md'), note('you.md')])?.path).toBe('you.md')
    expect(aboutYouNote([note('stil.md'), note('du.md')])?.path).toBe('du.md')
    expect(aboutYouNote([note('stile.md'), note('decisioni.md')])).toBeNull()
  })
})

describe('arrivalSentences', () => {
  it('shows the note about the user alone when it says enough', () => {
    const notes = [
      note(
        'contatti/bianchi.md',
        'Bianchi tiene la contabilità dello studio da dieci anni. Risponde sempre entro sera, anche nel fine settimana.'
      ),
      note('stile.md', '- Scrive ai clienti dando del lei, sempre.'),
      note('tu.md', ITALIAN)
    ]

    expect(arrivalSentences(notes, 'it')).toEqual(noteSentences(ITALIAN, 'it'))
  })

  it('with little about the user, goes on to how they write, then the rest, each sentence once', () => {
    const notes = [
      note(
        'contatti/bianchi.md',
        'Bianchi tiene la contabilità dello studio da dieci anni. Risponde sempre entro sera, anche nel fine settimana. Gli piace ricevere tutto in una mail sola.'
      ),
      note(
        'stile.md',
        '- Scrive ai clienti dando del lei, sempre.\n- Firma solo con il nome quando scrive ai colleghi.'
      ),
      note('tu.md', 'Lavora come geometra a Ferrara, in uno studio associato.')
    ]

    expect(arrivalSentences(notes, 'it')).toEqual([
      'Lavora come geometra a Ferrara, in uno studio associato.',
      'Scrive ai clienti dando del lei, sempre.',
      'Firma solo con il nome quando scrive ai colleghi.',
      'Bianchi tiene la contabilità dello studio da dieci anni.',
      'Risponde sempre entro sera, anche nel fine settimana.'
    ])
  })

  it('never ends a sentence on a title joined to its article, and leaves out rules written as templates', () => {
    expect(
      noteSentences(
        'Lavora a stretto contatto con l\'ing. Rossi, che segue i cantieri.\n\nClienti: "Buongiorno Sig.ra / Sig. / ing.", dà del Lei, frasi piene ma asciutte.',
        'it'
      )
    ).toEqual(["Lavora a stretto contatto con l'ing. Rossi, che segue i cantieri."])
  })

  it('without a note about the user, takes from the others', () => {
    expect(
      arrivalSentences(
        [note('decisioni.md', 'Le offerte si mandano sempre in PDF, mai modificabili.')],
        'it'
      )
    ).toEqual(['Le offerte si mandano sempre in PDF, mai modificabili.'])
    expect(arrivalSentences([], 'it')).toEqual([])
  })
})

describe('senderName', () => {
  it('reads the person a mailbox sends as', () => {
    expect(senderName('Mario Rossi')).toEqual({ full: 'Mario Rossi', first: 'Mario' })
    expect(senderName('Rossi, Mario')).toEqual({ full: 'Mario Rossi', first: 'Mario' })
    expect(senderName('Dott.ssa Anna Bianchi')?.first).toBe('Anna')
    expect(senderName('MARIO ROSSI')?.first).toBe('Mario')
    expect(senderName('"anna-lena weber"')?.first).toBe('Anna-Lena')
  })

  it('finds no person in an address, a number, an office or a company', () => {
    expect(senderName('mario.rossi@brenta.it')).toBeNull()
    expect(senderName('Ufficio Tecnico')).toBeNull()
    expect(senderName('Acme S.r.l.')).toBeNull()
    expect(senderName('Cantiere 12')).toBeNull()
    expect(senderName('  ')).toBeNull()
  })
})

describe('greetingName', () => {
  it('takes the name the mailboxes send with', () => {
    expect(
      greetingName([{ displayName: 'Mario Rossi' }, { displayName: 'Mario Rossi' }], null)
    ).toBe('Mario')
    expect(greetingName([{ displayName: 'info@acme-srl.it' }], null)).toBeNull()
    expect(greetingName([], 'Mario Rossi è il titolare.')).toBeNull()
  })

  it('of several names, the one the note about the user names', () => {
    const accounts = [{ displayName: 'Anna Bianchi' }, { displayName: 'Mario Rossi' }]

    expect(greetingName(accounts, 'Mario Rossi è il titolare di Acme S.r.l.')).toBe('Mario')
    expect(greetingName(accounts, 'Mario segue i cantieri.')).toBe('Mario')
    expect(greetingName(accounts, 'Segue i cantieri.')).toBe('Anna')
  })
})

describe('arrivesAfter', () => {
  const at = (setup: Partial<OnboardingState>): OnboardingState => ({
    case: 'primo-avvio',
    step: 'entra',
    accountIds: [],
    conoscimiId: 'run',
    startedAt: 0,
    ...setup
  })

  it('follows a setup that ran Conoscimi with the AI on', () => {
    expect(arrivesAfter(at({}), true)).toBe(true)
    expect(arrivesAfter(at({ case: 'ai-prima-volta' }), true)).toBe(true)
    expect(arrivesAfter(at({ case: 'ai-riaccesa' }), true)).toBe(true)
    expect(arrivesAfter(at({ case: 'conoscimi' }), true)).toBe(true)
    expect(arrivesAfter(at({ case: 'nuova-connessione', turnsAiOn: true }), true)).toBe(true)
  })

  it('not without the AI, nor for a connection added with it on, nor before «Entra»', () => {
    expect(arrivesAfter(at({}), false)).toBe(false)
    expect(arrivesAfter(at({ case: 'nuova-connessione' }), true)).toBe(false)
    expect(arrivesAfter(at({ case: 'conoscimi', step: 'conoscimi' }), true)).toBe(false)
  })
})

describe('letterState', () => {
  const day = '2026-11-12'
  const today = new Date(2026, 10, 12, 7, 30).getTime()

  it('is ready when today’s letter is written and not being written again', () => {
    expect(
      letterState({ day, letter: 'La giornata.', letterAt: today, letterRewriting: false })
    ).toBe('ready')
    expect(
      letterState({ day, letter: 'La giornata.', letterAt: today, letterRewriting: true })
    ).toBe('coming')
    expect(letterState({ day, letter: null, letterAt: null, letterRewriting: true })).toBe('coming')
  })

  it('has none coming when nothing is written for today, nor on its way', () => {
    expect(letterState({ day, letter: null, letterAt: null, letterRewriting: false })).toBe('none')
    expect(
      letterState({
        day,
        letter: 'Ieri.',
        letterAt: new Date(2026, 10, 11, 7).getTime(),
        letterRewriting: false
      })
    ).toBe('none')
  })
})
