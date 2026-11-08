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

  it('offers to prepare the event open in the calendar', () => {
    expect(segretarioSuggestions({ ...base, calendar: { eventOpen: true } })[0]).toBe(
      'Preparami a questo appuntamento'
    )
    expect(segretarioSuggestions({ ...base, calendar: { eventOpen: false } })[0]).toBe(
      'Cosa ho in agenda questa settimana?'
    )
  })

  it('asks where a project stands from its list, and keeps to four', () => {
    const suggestions = segretarioSuggestions({
      ...base,
      project: 'Casa al mare',
      calendarConnected: true
    })

    expect(suggestions[0]).toBe('A che punto è Casa al mare?')
    expect(suggestions).toHaveLength(4)
  })
})
