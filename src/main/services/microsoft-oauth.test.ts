import { InteractionRequiredAuthError } from '@azure/msal-node'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MICROSOFT_CALENDAR_SCOPES,
  MICROSOFT_MAILBOX_SETTINGS_SCOPES,
  MicrosoftOAuthService,
  MicrosoftSignInNeeded
} from './microsoft-oauth'

const msal = vi.hoisted(() => ({
  interactive: [] as Array<{ scopes: string[]; extraScopesToConsent?: string[] }>,
  /** The Graph scopes the account consented to. */
  consented: new Set<string>()
}))

vi.mock('electron', () => ({
  shell: {},
  net: {
    fetch: async () =>
      new Response(JSON.stringify({ mail: 'mattia@studio.it', displayName: 'Mattia Rossi' }))
  }
}))

/** MSAL with no browser and no network: a token for what the account consented to, else interaction. */
vi.mock('@azure/msal-node', async (original) => ({
  ...(await original<typeof import('@azure/msal-node')>()),
  PublicClientApplication: class {
    async acquireTokenInteractive(request: {
      scopes: string[]
      extraScopesToConsent?: string[]
    }): Promise<{ account: { homeAccountId: string; username: string; tenantId: string } }> {
      msal.interactive.push(request)
      return { account: { homeAccountId: 'home', username: 'mattia@studio.it', tenantId: 't' } }
    }

    getTokenCache(): { getAccountByHomeId: () => Promise<{ homeAccountId: string }> } {
      return { getAccountByHomeId: async () => ({ homeAccountId: 'home' }) }
    }

    async acquireTokenSilent({ scopes }: { scopes: string[] }): Promise<{ accessToken: string }> {
      if (scopes.some((scope) => scope.startsWith('https://graph') && !msal.consented.has(scope))) {
        throw new InteractionRequiredAuthError(
          'invalid_grant',
          '',
          'AADSTS65001',
          'consent_required'
        )
      }

      return { accessToken: `token for ${scopes.join(' ')}` }
    }
  }
}))

const CALENDARS = 'https://graph.microsoft.com/Calendars.ReadWrite'
const MAILBOX_SETTINGS = 'https://graph.microsoft.com/MailboxSettings.Read'
const USER = 'https://graph.microsoft.com/User.Read'

describe('MicrosoftOAuthService', () => {
  const service = new MicrosoftOAuthService({ microsoftClientId: 'client' })
  const secret = JSON.stringify({ homeAccountId: 'home', cache: '' })
  const keep = async (): Promise<void> => undefined

  beforeEach(() => {
    msal.interactive.length = 0
    msal.consented = new Set([USER])
  })

  it('asks a new calendar for its events and its mailbox’s time zone in one consent, the mail alone for neither', async () => {
    await service.authorize(undefined, { mail: false, calendar: true })
    await service.authorize(undefined, { mail: true, calendar: false })

    expect(msal.interactive[0].scopes).toEqual([USER, CALENDARS, MAILBOX_SETTINGS])
    expect(msal.interactive[1].extraScopesToConsent).not.toContain(CALENDARS)
    expect(msal.interactive[1].extraScopesToConsent).not.toContain(MAILBOX_SETTINGS)
  })

  it('gives a calendar connected before the time zone was asked for its token, and the time zone none', async () => {
    msal.consented.add(CALENDARS)

    expect(await service.accessToken(secret, MICROSOFT_CALENDAR_SCOPES, keep)).toBe(
      `token for ${CALENDARS}`
    )
    await expect(
      service.accessToken(secret, MICROSOFT_MAILBOX_SETTINGS_SCOPES, keep)
    ).rejects.toBeInstanceOf(MicrosoftSignInNeeded)
  })
})
