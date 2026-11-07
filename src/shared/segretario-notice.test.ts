import { describe, expect, it } from 'vitest'

import { noticeWords } from './segretario'

describe('noticeWords', () => {
  it('says the AI is off, why, and how it comes back', () => {
    const { title, body } = noticeWords({ kind: 'credito-finito', at: 0 })

    expect(title).toBe('Credito AI finito')
    expect(body).toContain('le funzioni AI sono spente')
    expect(body).toContain('ricarica il credito su OpenRouter, poi riattiva «Funzioni AI»')
    expect(noticeWords({ kind: 'chiave-rifiutata', at: 0 }).body).toContain(
      'inserisci una chiave valida'
    )
  })

  it('says what is left of the credit and how long it lasts', () => {
    const low = noticeWords({ kind: 'credito-basso', at: 0, available: 2.5, days: 6 })

    expect(low.title).toBe('Credito AI basso')
    expect(low.body).toMatch(
      /^Restano 2,50\s?USD di credito OpenRouter — al ritmo degli ultimi giorni, circa 6 giorni\./
    )
    expect(
      noticeWords({ kind: 'credito-quasi-finito', at: 0, available: 0.3, days: 0 }).body
    ).toContain('meno di un giorno')
    expect(noticeWords({ kind: 'credito-basso', at: 0, available: 0.9, days: null }).body).toMatch(
      /^Restano 0,90\s?USD di credito OpenRouter\. Ricaricalo/
    )
  })
})
