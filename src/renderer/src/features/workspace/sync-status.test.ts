import { describe, expect, it } from 'vitest'

import type { AccountConnectionState, MailAccount } from '@shared/models'

import { summarizeSyncStatus } from './sync-status'

function account(id: string): MailAccount {
  return {
    id,
    type: 'imap',
    email: `${id}@example.com`,
    displayName: id,
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
    username: id,
    authType: 'password',
    createdAt: 0,
    updatedAt: 0
  }
}

function state(
  accountId: string,
  status: AccountConnectionState['status'],
  extra: Partial<AccountConnectionState> = {}
): AccountConnectionState {
  return { accountId, status, syncing: false, ...extra }
}

const A = account('a')
const B = account('b')

describe('summarizeSyncStatus', () => {
  it('reports nothing without accounts', () => {
    expect(summarizeSyncStatus([], {})).toBeNull()
  })

  it('says synced only when every account is connected and done downloading', () => {
    expect(summarizeSyncStatus([A], { a: state('a', 'connected') })?.label).toBe('Sincronizzato')
    expect(summarizeSyncStatus([A], { a: state('a', 'connected', { syncing: true }) })?.label).toBe(
      'Sincronizzazione…'
    )
  })

  it('never calls a dropped link synced', () => {
    const summary = summarizeSyncStatus([A], { a: state('a', 'reconnecting') })
    expect(summary?.tone).toBe('busy')
    expect(summary?.label).toBe('Riconnessione…')
  })

  it('waits for accounts it has not heard from yet', () => {
    expect(summarizeSyncStatus([A], {})?.label).toBe('Connessione…')
  })

  it('names the unreachable account and when it last answered', () => {
    const lastContactAt = new Date(2026, 8, 24, 15, 32).getTime()
    const summary = summarizeSyncStatus([A, B], {
      a: state('a', 'connected'),
      b: state('b', 'error', { errorMessage: 'ETIMEDOUT', lastContactAt })
    })

    expect(summary?.tone).toBe('problem')
    expect(summary?.label).toBe('Connessione persa')
    expect(summary?.detail).toContain('b@example.com')
    expect(summary?.detail).toContain('15:32')
  })

  it('puts a refused login ahead of a missing network', () => {
    const summary = summarizeSyncStatus([A, B], {
      a: state('a', 'offline'),
      b: state('b', 'error', { authFailed: true })
    })

    expect(summary?.label).toBe('Accesso non riuscito')
  })

  it('reports a missing network as such', () => {
    expect(summarizeSyncStatus([A], { a: state('a', 'offline') })?.label).toBe('Non in linea')
  })
})
