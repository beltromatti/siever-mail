import { describe, expect, it } from 'vitest'

import { emptyMessages } from './i18n'
import { noticeWords, TASK_LABELS } from './segretario'

const ENGLISH = { language: 'en', formatLocale: 'en-US' } as const
const ITALIAN = { language: 'it', formatLocale: 'it-IT' } as const

describe('noticeWords', () => {
  it('says the AI is off, why, and how it comes back', () => {
    const { title, body } = noticeWords({ kind: 'credito-finito', at: 0 }, ENGLISH)

    expect(title).toBe('AI credit used up')
    expect(body).toContain('the AI features are off')
    expect(body).toContain('top up your credit on OpenRouter, then turn “AI features” back on')
    expect(noticeWords({ kind: 'chiave-rifiutata', at: 0 }, ENGLISH).body).toContain(
      'enter a valid key'
    )
    expect(noticeWords({ kind: 'credito-finito', at: 0 }, ITALIAN).body).toContain(
      'ricarica il credito su OpenRouter, poi riattiva «Funzioni AI»'
    )
  })

  it('says what is left of the credit and how long it lasts, amounts as the language writes them', () => {
    const low = noticeWords({ kind: 'credito-basso', at: 0, available: 2.5, days: 6 }, ENGLISH)

    expect(low.title).toBe('AI credit low')
    expect(low.body).toMatch(
      /^\$2\.50 of OpenRouter credit left — at the pace of the last few days, about 6 days\./
    )
    expect(
      noticeWords({ kind: 'credito-quasi-finito', at: 0, available: 0.3, days: 0 }, ENGLISH).body
    ).toContain('less than a day')
    expect(
      noticeWords({ kind: 'credito-basso', at: 0, available: 0.9, days: null }, ITALIAN).body
    ).toMatch(/^Restano 0,90\s?USD di credito OpenRouter\. Ricaricalo/)
    expect(
      noticeWords({ kind: 'credito-basso', at: 0, available: 2.5, days: 1 }, ITALIAN).body
    ).toContain('circa un giorno')
  })
})

describe('TASK_LABELS', () => {
  it('names every task in every language', () => {
    expect(emptyMessages(TASK_LABELS)).toEqual([])
  })
})
