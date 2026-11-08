import { describe, expect, it } from 'vitest'

import {
  formatRecipient,
  isValidEmailAddress,
  mergeRecipients,
  parseRecipients
} from './email-address'

describe('isValidEmailAddress', () => {
  it('takes the addresses people write to', () => {
    for (const address of [
      'f.ferri@brenta.it',
      'mario.rossi+fatture@studio-rossi.co.uk',
      "o'brien@example.ie",
      'info@xn--caff-dma.it',
      'josé@café.it',
      'a@b.museum',
      'UPPER@EXAMPLE.COM'
    ]) {
      expect(isValidEmailAddress(address), address).toBe(true)
    }
  })

  it('catches what cannot be delivered', () => {
    for (const address of [
      'f.ferri@brenta.i',
      'f.ferri@brenta',
      'f.ferri@brenta.it.',
      'f.ferri@.brenta.it',
      'f.ferri@brenta..it',
      'f..ferri@brenta.it',
      '.ferri@brenta.it',
      'ferri.@brenta.it',
      'f.ferri@-brenta.it',
      'f.ferri@brenta-.it',
      'f.ferri@brenta.123',
      'f ferri@brenta.it',
      'f.ferri@@brenta.it',
      'ferri@brenta@it.it',
      '@brenta.it',
      'f.ferri@',
      'Franco Ferri',
      'f.ferri@[10.0.0.1]',
      `${'a'.repeat(65)}@brenta.it`,
      ''
    ]) {
      expect(isValidEmailAddress(address), address).toBe(false)
    }
  })
})

describe('parseRecipients', () => {
  it('reads a list in any of the shapes it is copied in', () => {
    expect(
      parseRecipients('Mario Rossi <mario@x.it>; "Rossi, Luca" <luca@x.it>, anna@y.it')
    ).toEqual([
      { name: 'Mario Rossi', address: 'mario@x.it' },
      { name: 'Rossi, Luca', address: 'luca@x.it' },
      { address: 'anna@y.it' }
    ])
  })

  it('reads a column of addresses and addresses apart by spaces', () => {
    expect(parseRecipients('a@x.it\nb@y.it\r\nc@z.it')).toEqual([
      { address: 'a@x.it' },
      { address: 'b@y.it' },
      { address: 'c@z.it' }
    ])
    expect(parseRecipients('a@x.it b@y.it')).toEqual([{ address: 'a@x.it' }, { address: 'b@y.it' }])
  })

  it('keeps "Surname, Name <address>" one person', () => {
    expect(parseRecipients('Rossi, Mario <m@x.it>; Bianchi, Anna <a@x.it>')).toEqual([
      { name: 'Rossi, Mario', address: 'm@x.it' },
      { name: 'Bianchi, Anna', address: 'a@x.it' }
    ])
  })

  it('strips the dress around names and addresses', () => {
    expect(parseRecipients("'Franco Ferri' <f.ferri@brenta.it>")).toEqual([
      { name: 'Franco Ferri', address: 'f.ferri@brenta.it' }
    ])
    expect(parseRecipients('mailto:a@b.it?subject=Ciao')).toEqual([{ address: 'a@b.it' }])
    expect(parseRecipients('<a@b.it>')).toEqual([{ address: 'a@b.it' }])
    expect(parseRecipients('"a@b.it" <a@b.it>')).toEqual([{ address: 'a@b.it' }])
    expect(parseRecipients('x@y.it (Mario Rossi)')).toEqual([
      { name: 'Mario Rossi', address: 'x@y.it' }
    ])
    expect(parseRecipients('Mario Rossi mario@x.it')).toEqual([
      { name: 'Mario Rossi', address: 'mario@x.it' }
    ])
  })

  it('keeps what is not an address as it was written', () => {
    expect(parseRecipients('Mario Rossi')).toEqual([{ address: 'Mario Rossi' }])
    expect(parseRecipients('f.ferri@brenta.i, ,;')).toEqual([{ address: 'f.ferri@brenta.i' }])
    expect(parseRecipients('   ')).toEqual([])
  })

  it('reads back what formatRecipient writes', () => {
    for (const entry of [
      { name: 'Rossi, Mario', address: 'm@x.it' },
      { name: 'Il "Capo"', address: 'c@x.it' },
      { name: 'Anna Bianchi', address: 'a@x.it' },
      { address: 'b@x.it' }
    ]) {
      expect(parseRecipients(formatRecipient(entry))).toEqual([entry])
    }
  })
})

describe('mergeRecipients', () => {
  it('adds each address once, whatever its case', () => {
    expect(
      mergeRecipients(
        [{ name: 'Mario', address: 'Mario@x.it' }],
        [{ address: 'mario@X.it' }, { address: 'anna@x.it' }, { address: 'ANNA@x.it' }]
      )
    ).toEqual([{ name: 'Mario', address: 'Mario@x.it' }, { address: 'anna@x.it' }])
  })
})
