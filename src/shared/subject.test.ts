import { describe, expect, it } from 'vitest'

import {
  emptySubjectLabel,
  forwardSubject,
  isEmptySubjectLabel,
  replySubject,
  stripSubjectPrefixes,
  subjectSortKey
} from './subject'

describe('stripSubjectPrefixes', () => {
  it('strips stacked reply and forward prefixes in any client language', () => {
    expect(stripSubjectPrefixes('Re: R: I: Fwd: Preventivo')).toBe('Preventivo')
    expect(stripSubjectPrefixes('AW: WG: Angebot')).toBe('Angebot')
    expect(stripSubjectPrefixes('RE[2]: Offerta')).toBe('Offerta')
    expect(stripSubjectPrefixes('Re(3): Offerta')).toBe('Offerta')
    expect(stripSubjectPrefixes('Inoltro: Wtr: FW: Fw: Verbale')).toBe('Verbale')
    expect(stripSubjectPrefixes('TR: RV: ENC: Doorst: Antw: SV: VS: Rapport')).toBe('Rapport')
    expect(stripSubjectPrefixes('Rif: Odp: PD: Oferta')).toBe('Oferta')
  })

  it('strips bracketed gateway tags', () => {
    expect(stripSubjectPrefixes('[External] Re: Consegna')).toBe('Consegna')
  })

  it('leaves words that only start like a prefix alone', () => {
    expect(stripSubjectPrefixes('Rendiconto marzo')).toBe('Rendiconto marzo')
    expect(stripSubjectPrefixes('Invito: riunione')).toBe('Invito: riunione')
    expect(stripSubjectPrefixes('Angebot: Wärmepumpe')).toBe('Angebot: Wärmepumpe')
    expect(stripSubjectPrefixes('Agenda: review')).toBe('Agenda: review')
  })
})

describe('subjectSortKey', () => {
  it('puts a reply or a forward, in any language, beside the message it answers', () => {
    expect(subjectSortKey('Re: Offerta')).toBe(subjectSortKey('offerta'))
    expect(subjectSortKey('AW: Angebot')).toBe(subjectSortKey('Angebot'))
    expect(subjectSortKey('WG: AW: Angebot')).toBe(subjectSortKey('Re: Angebot'))
    expect(subjectSortKey('I: R: Offerta')).toBe(subjectSortKey('Fwd: Offerta'))
  })

  it('folds case and accents', () => {
    expect(subjectSortKey('Città  Estense')).toBe('citta estense')
  })

  it('sorts by the first letter or digit, past quotes, brackets and symbols', () => {
    expect(subjectSortKey('"Best drum kit" (50% OFF)')).toBe('best drum kit" (50% off)')
    expect(subjectSortKey('(CHECK THIS OUT!) Vol. 3')).toBe('check this out!) vol. 3')
    expect(subjectSortKey('$5 Kit')).toBe('5 kit')
    expect(subjectSortKey('!!!')).toBe('!!!')
  })

  it('files every message without a subject together, first, whatever language it was listed in', () => {
    for (const language of ['en', 'it', 'de'] as const) {
      expect(subjectSortKey(emptySubjectLabel(language))).toBe('')
      expect(subjectSortKey(`Re: ${emptySubjectLabel(language)}`)).toBe('')
    }
    expect(subjectSortKey('Re:')).toBe('')
  })
})

describe('the placeholder of a message without a subject', () => {
  it('is said in each language, and known in every one', () => {
    expect(emptySubjectLabel('en')).toBe('(No subject)')
    expect(emptySubjectLabel('it')).toBe('(Senza oggetto)')
    expect(emptySubjectLabel('de')).toBe('(Kein Betreff)')
    expect(isEmptySubjectLabel(' (Senza oggetto) ')).toBe(true)
    expect(isEmptySubjectLabel('(Kein Betreff)')).toBe(true)
    expect(isEmptySubjectLabel('No subject')).toBe(false)
  })
})

describe('replySubject and forwardSubject', () => {
  it('add the prefix once', () => {
    expect(replySubject('Offerta pompe', 'it')).toBe('Re: Offerta pompe')
    expect(replySubject('RE: Offerta pompe', 'it')).toBe('RE: Offerta pompe')
    expect(forwardSubject('Offerta pompe', 'it')).toBe('Fwd: Offerta pompe')
    expect(forwardSubject('Fwd: Offerta pompe', 'it')).toBe('Fwd: Offerta pompe')
  })

  it('write the prefix of the language the reply is written in', () => {
    expect(replySubject('Pump offer', 'en')).toBe('Re: Pump offer')
    expect(forwardSubject('Pump offer', 'en')).toBe('Fwd: Pump offer')
    expect(replySubject('Angebot Pumpen', 'de')).toBe('AW: Angebot Pumpen')
    expect(forwardSubject('Angebot Pumpen', 'de')).toBe('WG: Angebot Pumpen')
    expect(replySubject('Re: Pump offer', 'de')).toBe('Re: Pump offer')
    expect(forwardSubject('Fwd: Pump offer', 'de')).toBe('Fwd: Pump offer')
  })

  it('never double a prefix another language’s client wrote', () => {
    expect(replySubject('AW: Angebot', 'en')).toBe('AW: Angebot')
    expect(replySubject('R: Offerta', 'en')).toBe('R: Offerta')
    expect(replySubject('SV: Offert', 'en')).toBe('SV: Offert')
    expect(replySubject('RE[2]: Offerta', 'de')).toBe('RE[2]: Offerta')
    expect(forwardSubject('WG: Angebot', 'en')).toBe('WG: Angebot')
    expect(forwardSubject('I: Offerta', 'en')).toBe('I: Offerta')
    expect(forwardSubject('Inoltro: Offerta', 'en')).toBe('Inoltro: Offerta')
    expect(forwardSubject('FW: Offerta', 'de')).toBe('FW: Offerta')
    expect(forwardSubject('Wtr: Offerte', 'en')).toBe('Wtr: Offerte')
    expect(forwardSubject('TR: Offre', 'en')).toBe('TR: Offre')
  })

  it('reply to a forward and forward a reply, as every client does', () => {
    expect(replySubject('WG: Angebot', 'en')).toBe('Re: WG: Angebot')
    expect(forwardSubject('AW: Angebot', 'en')).toBe('Fwd: AW: Angebot')
    expect(replySubject('Rif: preventivo 12', 'it')).toBe('Re: Rif: preventivo 12')
    expect(forwardSubject('Re: Offer', 'de')).toBe('WG: Re: Offer')
  })

  it('leave out the placeholder of a message without a subject, in any language', () => {
    expect(replySubject(emptySubjectLabel('it'), 'it')).toBe('Re:')
    expect(forwardSubject(emptySubjectLabel('en'), 'en')).toBe('Fwd:')
    expect(replySubject(emptySubjectLabel('de'), 'en')).toBe('Re:')
    expect(replySubject(emptySubjectLabel('it'), 'de')).toBe('AW:')
    expect(replySubject('', 'en')).toBe('Re:')
  })
})
