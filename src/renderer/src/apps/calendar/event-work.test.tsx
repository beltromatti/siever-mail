import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CalendarEvent } from '@shared/calendar'
import type { EventWhose, EventWork } from '@shared/segretario'

import { EventWorkSection } from './event-work'

// The test runner compiles JSX to `React.createElement`: the components find React here.
Object.assign(globalThis, { React })

const EVENT = {
  key: 'c1:studio:sopralluogo',
  title: 'Sopralluogo Rossi – Ing. Bianchi',
  start: '2026-11-12T09:00:00.000Z',
  allDay: false
} as CalendarEvent

let segretarioApi: Record<string, ReturnType<typeof vi.fn>>

/** The panel of an event whose work says `whose`. */
const panel = (whose: EventWhose | null): void => {
  const work: EventWork = { projects: [], commitments: [], whose }
  segretarioApi.eventWork.mockResolvedValue(work)
  render(<EventWorkSection event={EVENT} />)
}

beforeEach(() => {
  segretarioApi = {
    eventWork: vi.fn(),
    onWorkChanged: vi.fn(() => () => undefined),
    setEventYours: vi.fn(async () => undefined)
  }
  Object.assign(window, { segretarioApi })
})

afterEach(cleanup)

describe('whose an event is, in its panel (§7.4)', () => {
  it('says the Segretario found it the user’s, with why, and takes the user’s word against it', async () => {
    panel({ yours: true, by: 'segretario', reason: 'Il sopralluogo lo fa l’utente' })

    expect(
      await screen.findByText(/Tuo, per il Segretario — Il sopralluogo lo fa l’utente/)
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Non è mio' }))

    expect(segretarioApi.setEventYours).toHaveBeenCalledWith(EVENT.key, false)
  })

  it('lets the user say theirs one the Segretario did not see as theirs', async () => {
    panel({ yours: false, by: null, reason: null })

    expect(await screen.findByText('Non è tra i tuoi eventi')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'È mio' }))

    expect(segretarioApi.setEventYours).toHaveBeenCalledWith(EVENT.key, true)
  })

  it('shows nothing where the calendar says it by itself', async () => {
    panel(null)

    await screen.findByLabelText('Una cosa da fare per questo incontro')
    expect(screen.queryByRole('button', { name: /mio$/ })).toBeNull()
  })
})
