import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AuthenticationResult,
  type ICachePlugin
} from '@azure/msal-node'
import { net, shell } from 'electron'

import type { RuntimeConfig } from '@main/config/env'
import { currentLanguage, messages } from '@main/i18n'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  signInAgain: {
    en: 'Microsoft asks you to sign in to this account again.',
    it: 'Microsoft chiede di accedere di nuovo a questo account.',
    de: 'Microsoft verlangt, dass Sie sich erneut bei diesem Konto anmelden.'
  },
  cancelled: {
    en: 'Signing in to Microsoft was cancelled.',
    it: 'Accesso a Microsoft annullato.',
    de: 'Die Anmeldung bei Microsoft wurde abgebrochen.'
  },
  notConfigured: {
    en: 'Signing in with Microsoft isn’t configured (MICROSOFT_OAUTH_CLIENT_ID).',
    it: "L'accesso con Microsoft non è configurato (MICROSOFT_OAUTH_CLIENT_ID).",
    de: 'Die Anmeldung mit Microsoft ist nicht konfiguriert (MICROSOFT_OAUTH_CLIENT_ID).'
  },
  chooseService: {
    en: 'Choose mail, calendar, or both.',
    it: 'Scegli la posta, il calendario o tutti e due.',
    de: 'Wählen Sie E-Mail, Kalender oder beides.'
  },
  signedIn: { en: 'Signed in', it: 'Accesso completato', de: 'Angemeldet' },
  signedInBody: {
    en: 'You can close this tab and go back to SIEVER Mail.',
    it: 'Puoi chiudere questa scheda e tornare a SIEVER Mail.',
    de: 'Sie können diesen Tab schließen und zu SIEVER Mail zurückkehren.'
  },
  signInFailed: {
    en: 'Sign-in didn’t succeed',
    it: 'Accesso non riuscito',
    de: 'Anmeldung fehlgeschlagen'
  },
  signInFailedBody: {
    en: 'Authorization cancelled or not valid. You can close this tab.',
    it: 'Autorizzazione annullata o non valida. Puoi chiudere questa scheda.',
    de: 'Autorisierung abgebrochen oder ungültig. Sie können diesen Tab schließen.'
  },
  noAccount: {
    en: 'Microsoft didn’t say which account you chose.',
    it: 'Microsoft non ha detto quale account hai scelto.',
    de: 'Microsoft hat nicht mitgeteilt, welches Konto Sie gewählt haben.'
  },
  noAddress: {
    en: 'Microsoft didn’t give this account’s address.',
    it: "Microsoft non ha dato l'indirizzo di questo account.",
    de: 'Microsoft hat die Adresse dieses Kontos nicht mitgeteilt.'
  }
})

/** Work, school and personal accounts alike. */
const AUTHORITY = 'https://login.microsoftonline.com/common'
/** The tenant of personal accounts (Outlook.com, Hotmail): their mail is sent through Outlook.com's server. */
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

/** The mailbox over IMAP and SMTP: tokens for the outlook.office.com resource. */
export const MICROSOFT_MAIL_SCOPES = [
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send'
]
/** Graph: the account's address, whichever service it is signed in for. */
const MICROSOFT_USER_SCOPES = ['https://graph.microsoft.com/User.Read']
/**
 * Graph, for the mail: sending through Graph where the organisation turned
 * SMTP off — a message with blind copies as a draft first, which takes
 * Mail.ReadWrite.
 */
const MICROSOFT_GRAPH_MAIL_SCOPES = [
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Mail.ReadWrite'
]
/** Graph, for the calendar: its events. */
export const MICROSOFT_CALENDAR_SCOPES = ['https://graph.microsoft.com/Calendars.ReadWrite']
/**
 * Graph, for the mailbox's time zone, which an all-day event is written in
 * so Outlook shows it on its day. Consented with the calendar, and asked
 * for on its own: a calendar connected before it was asked for goes on
 * syncing without it.
 */
export const MICROSOFT_MAILBOX_SETTINGS_SCOPES = [
  'https://graph.microsoft.com/MailboxSettings.Read'
]

/** What is kept of a Microsoft sign-in, encrypted: whose it is, and MSAL's cache with its tokens. */
interface MicrosoftSecret {
  homeAccountId: string
  cache: string
}

export interface MicrosoftAuthResult {
  email: string
  displayName: string
  /** A personal account (Outlook.com, Hotmail, Live), not a work or school one. */
  personal: boolean
  /** The secret to keep, encrypted, for the mail and for the calendar. */
  secret: string
}

/** The account has to sign in again: the server will not renew its access by itself. */
export class MicrosoftSignInNeeded extends Error {
  constructor() {
    super(messages(MESSAGES).signInAgain)
    this.name = 'MicrosoftSignInNeeded'
  }
}

/** The sign-in in the browser was left: the user went back, or the browser never answered. */
export class MicrosoftSignInCancelled extends Error {
  constructor() {
    super(messages(MESSAGES).cancelled)
    this.name = 'MicrosoftSignInCancelled'
  }
}

/** How long the browser has to bring a sign-in back before it is given up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="${currentLanguage()}"><head><meta charset="utf-8" /><title>${title}</title></head><body style="font-family:system-ui;padding:24px;background:#101421;color:#f1f5f9"><h2>${title}</h2><p>${body}</p></body></html>`

function parseSecret(secret: string): MicrosoftSecret {
  const parsed = JSON.parse(secret) as Partial<MicrosoftSecret>

  if (typeof parsed.homeAccountId !== 'string' || typeof parsed.cache !== 'string') {
    throw new MicrosoftSignInNeeded()
  }

  return { homeAccountId: parsed.homeAccountId, cache: parsed.cache }
}

/**
 * Signing in with Microsoft — Microsoft 365, Outlook.com — in the user's
 * browser, with MSAL: one consent for what the user turns on — the mailbox
 * (IMAP, SMTP, Graph to send), the calendar (Graph) — then a token for
 * whichever is asked. MSAL keeps its
 * tokens in a cache that this service hands back to be stored encrypted,
 * and takes from there: Microsoft renews the refresh token at each use,
 * so every change of the cache is passed on to be kept.
 */
export class MicrosoftOAuthService {
  private readonly clientId?: string
  /** The latest cache of each account, ahead of what was stored: one renewal at a time each. */
  private readonly latest = new Map<string, string>()
  private readonly queues = new Map<string, Promise<unknown>>()
  /** The sign-in waiting for the browser, to give up. */
  private signIn: AbortController | null = null

  constructor(config: RuntimeConfig) {
    this.clientId = config.microsoftClientId
  }

  /** Stops waiting for the sign-in in the browser: the user went back, or closed its tab. */
  cancelSignIn(): void {
    this.signIn?.abort()
  }

  isConfigured(): boolean {
    return Boolean(this.clientId)
  }

  private application(state: { cache: string }): PublicClientApplication {
    if (!this.clientId) {
      throw new Error(messages(MESSAGES).notConfigured)
    }

    const cachePlugin: ICachePlugin = {
      beforeCacheAccess: async (context) => {
        if (state.cache) {
          context.tokenCache.deserialize(state.cache)
        }
      },
      afterCacheAccess: async (context) => {
        if (context.cacheHasChanged) {
          state.cache = context.tokenCache.serialize()
        }
      }
    }

    return new PublicClientApplication({
      auth: { clientId: this.clientId, authority: AUTHORITY },
      cache: { cachePlugin }
    })
  }

  /**
   * Asks Microsoft, in the browser, for the services the user turned on of
   * the account they pick — the mailbox, the calendar, or both in one
   * consent — and for nothing else.
   */
  async authorize(
    loginHint?: string,
    services: { mail: boolean; calendar: boolean } = { mail: true, calendar: true }
  ): Promise<MicrosoftAuthResult> {
    if (!services.mail && !services.calendar) {
      throw new Error(messages(MESSAGES).chooseService)
    }

    // MSAL asks for one resource's scopes and has the others consented with them: the
    // mailbox's (outlook.office.com) first when the mail is asked for, Graph's alone if not.
    const graph = [
      ...MICROSOFT_USER_SCOPES,
      ...(services.mail ? MICROSOFT_GRAPH_MAIL_SCOPES : []),
      ...(services.calendar
        ? [...MICROSOFT_CALENDAR_SCOPES, ...MICROSOFT_MAILBOX_SETTINGS_SCOPES]
        : [])
    ]
    const state = { cache: '' }
    const application = this.application(state)
    // MSAL waits on its own loopback server and cannot be stopped: the wait for it can. One
    // sign-in at a time; the one before, still waiting, is given up.
    this.signIn?.abort()
    const controller = new AbortController()
    this.signIn = controller
    const timer = setTimeout(() => controller.abort(), SIGN_IN_TIMEOUT_MS)
    const interactive = application.acquireTokenInteractive({
      scopes: services.mail ? MICROSOFT_MAIL_SCOPES : graph,
      extraScopesToConsent: services.mail ? graph : undefined,
      prompt: 'select_account',
      loginHint,
      openBrowser: async (url) => {
        await shell.openExternal(url)
      },
      successTemplate: page(messages(MESSAGES).signedIn, messages(MESSAGES).signedInBody),
      errorTemplate: page(messages(MESSAGES).signInFailed, messages(MESSAGES).signInFailedBody)
    })
    // Answered after it was given up, it goes nowhere.
    interactive.catch(() => undefined)

    let result: Awaited<typeof interactive>

    try {
      result = await Promise.race([
        interactive,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new MicrosoftSignInCancelled()),
            {
              once: true
            }
          )
        })
      ])
    } finally {
      clearTimeout(timer)

      if (this.signIn === controller) {
        this.signIn = null
      }
    }

    if (!result.account) {
      throw new Error(messages(MESSAGES).noAccount)
    }

    const homeAccountId = result.account.homeAccountId
    const user = await this.silent(application, homeAccountId, MICROSOFT_USER_SCOPES)
    // The mailbox's address: a work account's sign-in name may not be it.
    const me = (await (
      await net.fetch(
        'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName',
        {
          headers: { Authorization: `Bearer ${user.accessToken}` }
        }
      )
    ).json()) as { mail?: string | null; userPrincipalName?: string; displayName?: string }
    const email = (me.mail || result.account.username || me.userPrincipalName || '').trim()

    if (!email) {
      throw new Error(messages(MESSAGES).noAddress)
    }

    this.latest.set(homeAccountId, state.cache)

    return {
      email,
      displayName: me.displayName?.trim() || result.account.name?.trim() || email,
      personal: result.account.tenantId === PERSONAL_TENANT,
      secret: JSON.stringify({ homeAccountId, cache: state.cache } satisfies MicrosoftSecret)
    }
  }

  /**
   * A token for `scopes` (one resource: the mailbox, or Graph) of the
   * account the secret is of. A renewed cache is handed to `keep`.
   */
  async accessToken(
    secret: string,
    scopes: ReadonlyArray<string>,
    keep: (secret: string) => Promise<void>
  ): Promise<string> {
    const stored = parseSecret(secret)
    const { homeAccountId } = stored
    const previous = this.queues.get(homeAccountId) ?? Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const state = { cache: this.latest.get(homeAccountId) ?? stored.cache }
        const before = state.cache
        const result = await this.silent(this.application(state), homeAccountId, scopes)

        if (state.cache !== before) {
          this.latest.set(homeAccountId, state.cache)
          await keep(
            JSON.stringify({ homeAccountId, cache: state.cache } satisfies MicrosoftSecret)
          )
        }

        return result.accessToken
      })

    this.queues.set(homeAccountId, run)
    return run
  }

  private async silent(
    application: PublicClientApplication,
    homeAccountId: string,
    scopes: ReadonlyArray<string>
  ): Promise<AuthenticationResult> {
    const account = await application.getTokenCache().getAccountByHomeId(homeAccountId)

    if (!account) {
      throw new MicrosoftSignInNeeded()
    }

    try {
      return await application.acquireTokenSilent({ account, scopes: [...scopes] })
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        throw new MicrosoftSignInNeeded()
      }

      throw error
    }
  }
}
