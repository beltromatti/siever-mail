import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MailAccount } from '@shared/models'

import { ConnectionsList } from './connections-list'

// The test runner compiles JSX to `React.createElement`: the components find React here.
Object.assign(globalThis, { React })

const mailbox = (id: string, email: string, change: Partial<MailAccount> = {}): MailAccount => ({
  id,
  type: 'gmail',
  email,
  displayName: email,
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapSecure: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecure: true,
  username: email,
  authType: 'oauth',
  createdAt: 0,
  updatedAt: 0,
  pec: false,
  ...change
})

const GOOGLE = mailbox('g', 'anna@gmail.example')
const MICROSOFT = mailbox('m', 'anna@brenta.it', {
  type: 'imap',
  imapHost: 'outlook.office365.com'
})

let calendarApi: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  calendarApi = {
    listConnections: vi.fn(async () => []),
    onChanged: vi.fn(() => () => undefined),
    connectGoogle: vi.fn(async () => []),
    connectMicrosoft: vi.fn(async () => [])
  }
  Object.assign(window, { calendarApi, filesApi: { sources: vi.fn(async () => []) } })
})

afterEach(cleanup)

const list = (props: Partial<React.ComponentProps<typeof ConnectionsList>> = {}): void => {
  render(
    <ConnectionsList
      accounts={[GOOGLE, MICROSOFT]}
      mailStates={{}}
      removingAccountId={null}
      googleReady
      microsoftReady
      aiOn
      onRemoveMail={() => undefined}
      {...props}
    />
  )
}

describe('the calendar a mailbox can give (§11.1, §12.2)', () => {
  it('is added through the guided setup from Settings: a connection of its own', async () => {
    const onAddCalendar = vi.fn()
    list({ onAddCalendar })
    const [google, microsoft] = await screen.findAllByRole('button', { name: 'Connect' })

    fireEvent.click(microsoft)
    fireEvent.click(google)

    expect(onAddCalendar.mock.calls).toEqual([['m'], ['g']])
    expect(calendarApi.connectGoogle).not.toHaveBeenCalled()
    expect(calendarApi.connectMicrosoft).not.toHaveBeenCalled()
  })

  it('is asked of its provider in the setup, at once for the mailbox it was opened for, once', async () => {
    const asked = vi.fn()
    list({ connectCalendarOf: 'm', onConnectCalendarAsked: asked })
    await screen.findAllByRole('button', { name: 'Connect' })
    await act(async () => undefined)

    expect(calendarApi.connectMicrosoft).toHaveBeenCalledTimes(1)
    expect(calendarApi.connectMicrosoft).toHaveBeenCalledWith('m')
    expect(asked).toHaveBeenCalledTimes(1)

    // In the setup, another mailbox's is asked of its own provider.
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0])
    await act(async () => undefined)
    expect(calendarApi.connectGoogle).toHaveBeenCalledWith('g')
    expect(calendarApi.connectMicrosoft).toHaveBeenCalledTimes(1)
  })
})
