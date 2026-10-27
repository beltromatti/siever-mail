import { describe, expect, it } from 'vitest'

import { fullTextMatchExpression, indexTokens } from './full-text-query'

describe('fullTextMatchExpression', () => {
  it('turns each term into a phrase whose last word is a prefix', () => {
    expect(fullTextMatchExpression('preventivo')).toBe('"preventivo"*')
    expect(fullTextMatchExpression('"pompa centrifuga"')).toBe('"pompa centrifuga"*')
  })

  it('ANDs groups and ORs the terms of a group', () => {
    expect(fullTextMatchExpression('pompe OR valvole hera')).toBe(
      '("pompe"* OR "valvole"*) AND "hera"*'
    )
  })

  it('confines a scoped term to its column', () => {
    expect(fullTextMatchExpression('da:rossi oggetto:offerta a:bianchi')).toBe(
      'sender : "rossi"* AND subject : "offerta"* AND recipients : "bianchi"*'
    )
  })

  it('splits addresses and punctuation the way the index does, folding accents', () => {
    expect(indexTokens('L.Rossi@Idro.it')).toEqual(['l', 'rossi', 'idro', 'it'])
    expect(fullTextMatchExpression('perché')).toBe('"perche"*')
  })

  it('has nothing to look for in punctuation alone', () => {
    expect(fullTextMatchExpression('  ')).toBeNull()
    expect(fullTextMatchExpression('"…" ---')).toBeNull()
  })
})
