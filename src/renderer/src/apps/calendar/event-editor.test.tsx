import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { calendarKey, type CalendarEvent, type CalendarListEntry } from '@shared/calendar'

import { EventEditor, type EditorTarget } from './event-editor'

// The test runner compiles JSX to `React.createElement`: the components find React here; and
// jsdom has no ResizeObserver, which the switch measures itself with.
Object.assign(globalThis, {
  React,
  ResizeObserver: class {
    observe = (): void => undefined
    unobserve = (): void => undefined
    disconnect = (): void => undefined
  }
})

const PERSONALE: CalendarListEntry = {
  key: calendarKey('g1', 'personale'),
  connectionId: 'g1',
  connection: 'rossi@brenta.it',
  name: 'Personale',
  primary: true,
  writable: true,
  color: null,
  hidden: false,
  provider: 'google',
  role: 'tutti',
  roleBy: null,
  roleReason: null
}

const LESSON: CalendarEvent = {
  key: 'g1:personale:lezione_20261112',
  connectionId: 'g1',
  calendarId: 'personale',
  calendarName: 'Personale',
  eventId: 'lezione_20261112',
  iCalUid: 'lezione@google.com',
  seriesId: 'lezione',
  title: 'Lezione di disegno',
  start: '2026-11-12T09:00:00.000Z',
  end: '2026-11-12T10:00:00.000Z',
  allDay: false,
  location: null,
  description: null,
  attendees: [],
  organizer: null,
  myResponse: null,
  meetLink: null,
  htmlLink: null,
  origin: null,
  reminders: [10],
  organizedByUser: true,
  recurrence: { frequency: 'weekly', interval: 1, weekdays: ['TH'] },
  managedBy: null
}

let calendarApi: Record<string, ReturnType<typeof vi.fn>>
let onSaved: ReturnType<typeof vi.fn<(event: CalendarEvent) => void>>

const open = (target: EditorTarget): void => {
  onSaved = vi.fn<(event: CalendarEvent) => void>()
  render(
    <EventEditor
      target={target}
      calendars={[PERSONALE]}
      preferredCalendarKey={null}
      onClose={() => undefined}
      onSaved={onSaved}
    />
  )
}

const retitle = (title: string): void => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: title } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

beforeEach(() => {
  calendarApi = {
    update: vi.fn(async (key: string) => ({ ...LESSON, key })),
    create: vi.fn(async () => LESSON)
  }
  Object.assign(window, { calendarApi })
})

afterEach(cleanup)

describe('the editor, of an event that repeats (vision §7.5)', () => {
  it('asks whether a change is for this event only', async () => {
    open({ mode: 'edit', event: LESSON })
    retitle('Lezione di acquerello')

    fireEvent.click(await screen.findByRole('button', { name: 'This event only' }))

    await waitFor(() =>
      expect(calendarApi.update).toHaveBeenCalledWith(
        LESSON.key,
        { title: 'Lezione di acquerello' },
        undefined
      )
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('or for the whole series', async () => {
    open({ mode: 'edit', event: LESSON })
    retitle('Lezione di acquerello')

    fireEvent.click(await screen.findByRole('button', { name: 'The whole series' }))

    await waitFor(() =>
      expect(calendarApi.update).toHaveBeenCalledWith(
        LESSON.key,
        { title: 'Lezione di acquerello' },
        { series: true }
      )
    )
  })

  it('saves nothing when the question is declined, and the form stays', async () => {
    open({ mode: 'edit', event: LESSON })
    retitle('Lezione di acquerello')

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel', hidden: false }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'The whole series' })).toBeNull()
    )
    expect(calendarApi.update).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeTruthy()
  })

  it('asks nothing of an event on its own', async () => {
    open({ mode: 'edit', event: { ...LESSON, seriesId: null, recurrence: null } })
    retitle('Colloquio')

    await waitFor(() =>
      expect(calendarApi.update).toHaveBeenCalledWith(LESSON.key, { title: 'Colloquio' }, undefined)
    )
    expect(screen.queryByRole('button', { name: 'This event only' })).toBeNull()
  })
})

describe('the editor, for a copy and for what another service keeps', () => {
  it('duplicates an event with how it repeats and its reminders', async () => {
    open({ mode: 'duplicate', event: LESSON })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(calendarApi.create).toHaveBeenCalled())
    expect(calendarApi.create.mock.calls[0][0]).toMatchObject({
      calendarKey: PERSONALE.key,
      title: 'Lezione di disegno',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: ['TH'] },
      reminders: [10]
    })
  })

  it('says who keeps an event Gmail put there, and changes only its reminders', () => {
    open({
      mode: 'edit',
      event: { ...LESSON, seriesId: null, recurrence: null, managedBy: 'gmail' }
    })

    expect(
      screen.getByText(
        'Gmail put it here, from a booking or a ticket, and keeps it: only its reminders can change.'
      )
    ).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Remove “10 minutes before”' })).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Remove “10 minutes before”' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  })

  it('shows a rule made elsewhere, and does not change it', () => {
    open({ mode: 'edit', event: { ...LESSON, recurrence: 'other' } })

    const repeat = screen.getByRole('combobox', { name: 'Repeat' })

    expect(repeat.textContent).toBe('Repeats (by a rule made elsewhere)')
    expect((repeat as HTMLButtonElement).disabled).toBe(true)
  })
})
