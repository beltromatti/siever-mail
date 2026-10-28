import { describe, expect, it } from 'vitest'

import type { MessageNote } from '@shared/segretario'

import { segretarioSuggestions } from './suggestions'

const note = (state: MessageNote['state']): MessageNote => ({
  accountId: 'a',
  messageKey: 'k',
  threadId: 't',
  direction: 'in',
  summary: '',
  state,
  priority: 'media',
  reason: '',
  due: null,
  messageDate: '2026-10-28T08:00:00.000Z',
  dismissedAt: null,
  twinAccountId: null
})

const base = {
  selectionCount: 1,
  note: null,
  messageOpen: false,
  topic: null,
  topicsLabel: 'Pratiche',
  readyReply: false,
  calendarConnected: false
}

describe('segretarioSuggestions', () => {
  it('offers to go through the reply prepared for a message that waits on the user', () => {
    expect(
      segretarioSuggestions({
        ...base,
        messageOpen: true,
        note: note('da_rispondere'),
        readyReply: true
      })[0]
    ).toBe('Rivedi con me la risposta pronta')
    expect(segretarioSuggestions({ ...base, messageOpen: true, note: note('in_attesa') })[0]).toBe(
      'Prepara un sollecito'
    )
  })

  it('asks where a pratica stands from its list, and keeps to four', () => {
    const suggestions = segretarioSuggestions({
      ...base,
      topic: 'Prat2451 · CASEIFICIO VALLI',
      calendarConnected: true
    })

    expect(suggestions[0]).toBe('A che punto è Prat2451 · CASEIFICIO VALLI?')
    expect(suggestions).toHaveLength(4)
  })
})
