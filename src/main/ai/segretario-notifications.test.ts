import { describe, expect, it, vi } from 'vitest'

import type { NotificationCenter, NotificationInput } from '@main/notifications/center'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@shared/notifications'
import type { ActivitySummary } from '@shared/segretario'

import { plainLine, SegretarioNotifications } from './segretario-notifications'

function activity(overrides: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: 'r1',
    task: 'richiesta',
    title: 'Le offerte di Gallo',
    status: 'running',
    createdAt: 0,
    updatedAt: 0,
    unseen: false,
    cost: 0,
    visibility: 'pannello',
    ...overrides
  }
}

function notices(letter: string | null = null): {
  segretario: SegretarioNotifications
  shown: NotificationInput[]
  withdrawn: string[]
} {
  const shown: NotificationInput[] = []
  const withdrawn: string[] = []
  const given = new Set<string>()
  const center = {
    preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    wouldShow: () => true,
    notify: (input: NotificationInput) => {
      shown.push(input)
      return true
    },
    withdraw: (key: string) => withdrawn.push(key),
    giveOnce: async (key: string) => {
      const first = !given.has(key)
      given.add(key)
      return first
    }
  } as unknown as NotificationCenter
  const segretario = new SegretarioNotifications({
    center,
    letter: async () => letter,
    lastAnswer: async () =>
      'Ho trovato [tre offerte](mail:m1) da settembre. Te le ho messe in fila.',
    setup: async () => null,
    readingDone: async () => true
  })
  return { segretario, shown, withdrawn }
}

describe('the Segretario’s notifications', () => {
  it('tell when it waits for the user, and take it back once answered', () => {
    const { segretario, shown, withdrawn } = notices()
    segretario.activity(activity({ status: 'running' }))
    segretario.activity(activity({ status: 'waiting' }))
    segretario.activity(activity({ status: 'running' }))

    expect(shown.map((input) => input.kind)).toEqual(['segretario.waiting'])
    expect(withdrawn).toEqual(['segretario:waiting:r1'])
  })

  it('tell what the user asked is done, with the first line of the answer', async () => {
    const { segretario, shown } = notices()
    segretario.activity(activity({ status: 'running' }))
    segretario.activity(activity({ status: 'done' }))
    await vi.waitFor(() => expect(shown).toHaveLength(1))

    expect(shown[0]).toMatchObject({
      title: 'Il Segretario ha finito',
      body: 'Ho trovato tre offerte da settembre.',
      when: 'away',
      target: { kind: 'activity', activityId: 'r1' }
    })

    // A run listed once more, without being seen to end, says nothing.
    segretario.activity(activity({ id: 'r2', status: 'done' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(shown).toHaveLength(1)
  })

  it('tell the day’s letter once a day', async () => {
    const { segretario, shown } = notices('Oggi conta **la consegna**. Poi la riunione.')
    const day = (id: string): void => {
      segretario.activity(activity({ id, task: 'giornata', status: 'running' }))
      segretario.activity(activity({ id, task: 'giornata', status: 'done' }))
    }

    day('g1')
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    day('g2')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({
      kind: 'segretario.day',
      body: 'Oggi conta la consegna.',
      target: { kind: 'today' }
    })
  })

  it('make plain text of the Segretario’s words', () => {
    expect(plainLine('Vedi [il preventivo](mail:m4) e **subito**: è urgente! Il resto dopo.')).toBe(
      'Vedi il preventivo e subito: è urgente!'
    )
    expect(plainLine('x'.repeat(300), 20)).toHaveLength(20)
  })
})
