import { DatabaseSync } from 'node:sqlite'

import type { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { fullTextMatchExpression, indexTokens, numberWords, queryNumbers } from './full-text-query'

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

describe('a number inside a code', () => {
  it('is looked for on its own and in the words that write it', () => {
    const words = new Map([['2463', ['prat2463', 'prat24630']]])

    expect(fullTextMatchExpression('2463', words)).toBe('("2463"* OR "prat2463" OR "prat24630")')
    expect(fullTextMatchExpression('oggetto:2463 offerta', words)).toBe(
      '(subject : "2463"* OR subject : "prat2463" OR subject : "prat24630") AND "offerta"*'
    )
    expect(fullTextMatchExpression('"prat 2463"', words)).toBe('"prat 2463"*')
  })

  it('is a number of the query standing alone, long enough not to be part of everything', () => {
    expect(queryNumbers('2463 offerta 12 oggetto:2470 "prat 2480" 2463')).toEqual(['2463', '2470'])
  })

  it('is found in the words the index writes it in after letters, not in the middle of a hash', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE VIRTUAL TABLE message_fts USING fts5(subject, body, tokenize='unicode61 remove_diacritics 2');
      CREATE VIRTUAL TABLE message_fts_vocab USING fts5vocab(message_fts, 'row');
      INSERT INTO message_fts VALUES
        ('Prat2463 – offerta', 'Prat2463'), ('Re: Prat2463', ''), ('Prat24630', ''),
        ('Allegato', 'id f2463be8 e 2463 da solo'), ('n2463a', '');
    `)
    const prisma = {
      $queryRawUnsafe: async (sql: string, ...params: string[]) => db.prepare(sql).all(...params)
    } as unknown as PrismaClient

    expect(await numberWords(prisma, '2463')).toEqual(['prat2463', 'n2463a', 'prat24630'])
  })
})
