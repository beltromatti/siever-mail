import { describe, expect, it } from 'vitest'

import type { MessageRowWork } from '@shared/segretario'

import { segretarioSuggestions } from './suggestions'

const work = (change: Partial<MessageRowWork>): MessageRowWork => ({
  accountId: 'a',
  messageKey: 'k',
  note: null,
  owed: null,
  awaited: false,
  reply: null,
  saved: null,
  ...change
})

const base = {
  selectionCount: 1,
  work: null,
  messageOpen: false,
  project: null,
  calendarConnected: false
}

describe('segretarioSuggestions', () => {
  it('offers to go through the reply prepared for a message that asks the user something', () => {
    expect(
      segretarioSuggestions({
        ...base,
        messageOpen: true,
        work: work({ owed: { kind: 'ti_chiedono', due: null }, reply: 'pronta' })
      })[0]
    ).toBe('Rivedi con me la risposta pronta')
    expect(
      segretarioSuggestions({ ...base, messageOpen: true, work: work({ awaited: true }) })[0]
    ).toBe('Prepara un sollecito')
  })

  it('asks where a project stands from its list, and keeps to four', () => {
    const suggestions = segretarioSuggestions({
      ...base,
      project: 'Prat2451 · CASEIFICIO VALLI',
      calendarConnected: true
    })

    expect(suggestions[0]).toBe('A che punto è Prat2451 · CASEIFICIO VALLI?')
    expect(suggestions).toHaveLength(4)
  })
})
