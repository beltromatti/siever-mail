/**
 * What SIEVER Mail finds about a mailbox from its address alone: who keeps
 * it, its servers and how to sign in — so the user types the address and
 * the password, and nothing else.
 */
export interface DiscoveredMailSettings {
  /**
   * Where the settings came from: a provider SIEVER Mail knows, Thunderbird's
   * database, the provider's own file, the domain's DNS, or a guess to check.
   */
  source: 'known' | 'ispdb' | 'provider' | 'dns' | 'guess'
  /** A provider with its own way in: Google and Microsoft sign in on their page, iCloud wants an app password. */
  provider: 'google' | 'microsoft' | 'icloud' | null
  /** The provider's name, when known: "Libero", "Aruba PEC". */
  name: string | null
  /** A certified mailbox (PEC). */
  pec: boolean
  /** The provider wants a password made for the app, not the account's own. */
  appPassword: boolean
  imap: MailServerSettings
  smtp: MailServerSettings
  /** The name to sign in with: the address, most of the time; empty when it is something else the user knows. */
  username: string
  /** What the user should know to sign in: where to make the password, what the user name is. */
  note: string | null
}

export interface MailServerSettings {
  host: string
  port: number
  /** SSL/TLS from the first byte; false: STARTTLS. */
  secure: boolean
}
