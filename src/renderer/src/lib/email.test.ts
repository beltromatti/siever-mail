import { describe, expect, it } from 'vitest'

import { htmlToPlainText, initialsFromName, splitRecipients } from './email'

describe('splitRecipients', () => {
  it('parses comma-separated recipients and trims spaces', () => {
    expect(splitRecipients('a@example.com, b@example.com , ,c@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com'
    ])
  })
})

describe('htmlToPlainText', () => {
  it('converts rich html to readable plain text', () => {
    expect(htmlToPlainText('<p>Ciao<br/>Mondo</p><p><strong>Test</strong></p>')).toBe(
      'Ciao\nMondo\n\nTest'
    )
  })
})

describe('initialsFromName', () => {
  it('returns first letters for first two words', () => {
    expect(initialsFromName('Mario Rossi')).toBe('MR')
  })

  it('returns fallback for empty text', () => {
    expect(initialsFromName('   ')).toBe('?')
  })
})
