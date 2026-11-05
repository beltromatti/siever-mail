import type { MailAccount } from '@shared/models'

import type { GoogleOAuthService } from './google-oauth'
import { MICROSOFT_MAIL_SCOPES, type MicrosoftOAuthService } from './microsoft-oauth'

/** A mailbox that signs in with a token, with the secret it renews it from. */
export type TokenAccount = Pick<MailAccount, 'id' | 'type'> & { secret: string }

/** Where the mail's access tokens come from, whoever gave them. */
export interface MailTokens {
  accessToken(account: TokenAccount): Promise<string>
}

/**
 * The access tokens of the mailboxes signed in with OAuth: Google's for a
 * Gmail account, Microsoft's for one signed in with Microsoft. A renewed
 * Microsoft secret is kept, encrypted, as it comes.
 */
export class MailTokenBroker implements MailTokens {
  constructor(
    private readonly google: GoogleOAuthService,
    private readonly microsoft: MicrosoftOAuthService,
    private readonly keep: (accountId: string, secret: string) => Promise<void>
  ) {}

  accessToken(account: TokenAccount): Promise<string> {
    return account.type === 'gmail'
      ? this.google.getAccessToken(account.secret)
      : this.microsoft.accessToken(account.secret, MICROSOFT_MAIL_SCOPES, (secret) =>
          this.keep(account.id, secret)
        )
  }
}
