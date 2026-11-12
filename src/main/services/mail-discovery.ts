import { XMLParser } from 'fast-xml-parser'
import { getDomain } from 'tldts'

import { messages } from '@main/i18n'
import type { DiscoveredMailSettings, MailServerSettings } from '@shared/connections'
import { defineMessages } from '@shared/i18n'

/**
 * Finding a mailbox's servers from its address, as Thunderbird does:
 * the providers SIEVER Mail knows (the Italian ones and the PEC among them,
 * also by their mail servers for a company's own domain), the provider's
 * own file over https, Thunderbird's database, the domain's mail servers
 * (MX) and their provider, the domain's SRV records (RFC 6186) — and only
 * then a guess, tried on the network. A real sign-in checks it in the end.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface DiscoveryDeps {
  fetch: Fetch
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>
  resolveSrv(
    name: string
  ): Promise<Array<{ name: string; port: number; priority: number; weight: number }>>
  /** Whether a server answers there, encrypted from the first byte or not. */
  reachable(host: string, port: number, secure: boolean): Promise<boolean>
}

const ISPDB = 'https://autoconfig.thunderbird.net/v1.1/'
const HTTP_TIMEOUT_MS = 8_000
const MAX_CONFIG_BYTES = 256 * 1024
const MAX_REDIRECTS = 5

/** What the user should know to sign in to a provider, said in the interface's language. */
const NOTES = defineMessages({
  arubaPec: {
    en: 'With two-step verification on, you need a “password for mail programs”, created in the mailbox’s management.',
    it: 'Con la verifica in due passaggi attiva serve una «password per programmi di posta», da creare nella gestione della casella.',
    de: 'Bei aktivierter Bestätigung in zwei Schritten benötigen Sie ein „Passwort für E-Mail-Programme“, das Sie in der Postfachverwaltung erstellen.'
  },
  legalmail: {
    en: 'The username is the InfoCert User ID, not the address.',
    it: 'Il nome utente è lo User ID di InfoCert, non l’indirizzo.',
    de: 'Der Benutzername ist die InfoCert User ID, nicht die Adresse.'
  },
  postecertifica: {
    en: 'The password for mail programs is generated in the Postecertifica dashboard.',
    it: 'La password per i programmi di posta si genera nella dashboard di Postecertifica.',
    de: 'Das Passwort für E-Mail-Programme wird im Dashboard von Postecertifica erzeugt.'
  },
  timPec: {
    en: 'The username is “PEC address*webmail user”, with the secondary password from devicepassword.pectim.it.',
    it: 'Il nome utente è «indirizzo PEC*utente della webmail», con la password secondaria di devicepassword.pectim.it.',
    de: 'Der Benutzername lautet „PEC-Adresse*Webmail-Benutzer“, mit dem Zweitpasswort von devicepassword.pectim.it.'
  },
  yahoo: {
    en: 'Yahoo asks for an app password, generated in the account’s security settings.',
    it: 'Yahoo chiede una password per app, da generare nella sicurezza dell’account.',
    de: 'Yahoo verlangt ein App-Passwort, das Sie in den Sicherheitseinstellungen des Kontos erzeugen.'
  }
})

const MESSAGES = defineMessages({
  notAnAddress: {
    en: 'This doesn’t look like an email address.',
    it: 'Questo non sembra un indirizzo email.',
    de: 'Das sieht nicht nach einer E-Mail-Adresse aus.'
  }
})

type Known = Omit<DiscoveredMailSettings, 'source' | 'username' | 'note'> & {
  /** The user name, when it is not the address; empty: the user writes it. */
  username?: ''
  /** What the user should know to sign in, said when it is found. */
  note: keyof typeof NOTES | null
}

const ssl = (host: string, port: number): MailServerSettings => ({ host, port, secure: true })
const starttls = (host: string, port: number): MailServerSettings => ({ host, port, secure: false })

const known = (
  name: string,
  imap: MailServerSettings,
  smtp: MailServerSettings,
  extra: Partial<Known> = {}
): Known => ({
  name,
  provider: null,
  pec: false,
  appPassword: false,
  note: null,
  imap,
  smtp,
  ...extra
})

const GMAIL = known('Gmail', ssl('imap.gmail.com', 993), ssl('smtp.gmail.com', 465), {
  provider: 'google'
})
const OUTLOOK = known(
  'Outlook.com',
  ssl('outlook.office365.com', 993),
  starttls('smtp-mail.outlook.com', 587),
  { provider: 'microsoft' }
)
const MICROSOFT_365 = known(
  'Microsoft 365',
  ssl('outlook.office365.com', 993),
  starttls('smtp.office365.com', 587),
  { provider: 'microsoft' }
)
const ICLOUD = known('iCloud', ssl('imap.mail.me.com', 993), starttls('smtp.mail.me.com', 587), {
  provider: 'icloud',
  appPassword: true
})
const ARUBA_PEC = known(
  'Aruba PEC',
  ssl('imaps.pec.aruba.it', 993),
  ssl('smtps.pec.aruba.it', 465),
  {
    pec: true,
    note: 'arubaPec'
  }
)
const LEGALMAIL = known(
  'Legalmail (InfoCert)',
  ssl('mbox.cert.legalmail.it', 993),
  ssl('sendm.cert.legalmail.it', 465),
  { pec: true, username: '', note: 'legalmail' }
)
const POSTECERTIFICA = known(
  'Postecertifica (Poste Italiane)',
  ssl('mail.postecertifica.it', 993),
  ssl('mail.postecertifica.it', 465),
  {
    pec: true,
    note: 'postecertifica'
  }
)
const REGISTER_PEC = known(
  'PEC Register.it',
  ssl('imap.pec-email.com', 993),
  ssl('smtp.pec-email.com', 465),
  {
    pec: true
  }
)
const NAMIRIAL = known(
  'PEC Namirial',
  ssl('imaps.sicurezzapostale.it', 993),
  ssl('smtps.sicurezzapostale.it', 465),
  { pec: true }
)
const LIBERO_PEC = known(
  'PEC Libero',
  ssl('mail.postacert.it.net', 993),
  ssl('mail.postacert.it.net', 465),
  {
    pec: true
  }
)
const TIM_PEC = known('PEC TIM', ssl('imap.pectim.it', 993), ssl('smtp.pectim.it', 465), {
  pec: true,
  username: '',
  note: 'timPec'
})
const ARUBA_HOSTED = known('Aruba', ssl('imaps.aruba.it', 993), ssl('smtps.aruba.it', 465))
const REGISTER_HOSTED = known(
  'Register.it',
  ssl('pop.securemail.pro', 993),
  ssl('authsmtp.securemail.pro', 465)
)

/** The providers known by the address's domain. */
const BY_DOMAIN: ReadonlyArray<[ReadonlyArray<string>, Known]> = [
  [['gmail.com', 'googlemail.com'], GMAIL],
  [
    ['outlook.com', 'outlook.it', 'hotmail.com', 'hotmail.it', 'live.com', 'live.it', 'msn.com'],
    OUTLOOK
  ],
  [['icloud.com', 'me.com', 'mac.com'], ICLOUD],
  [
    ['yahoo.com', 'yahoo.it', 'ymail.com', 'rocketmail.com'],
    known('Yahoo', ssl('imap.mail.yahoo.com', 993), ssl('smtp.mail.yahoo.com', 465), {
      appPassword: true,
      note: 'yahoo'
    })
  ],
  [
    ['libero.it', 'iol.it', 'inwind.it', 'blu.it', 'giallo.it'],
    known('Libero', ssl('imapmail.libero.it', 993), ssl('smtp.libero.it', 465))
  ],
  [['virgilio.it'], known('Virgilio', ssl('in.virgilio.it', 993), ssl('out.virgilio.it', 465))],
  [['tim.it'], known('TIM', starttls('imap.tim.it', 143), starttls('smtp.tim.it', 587))],
  [['alice.it'], known('Alice', starttls('in.alice.it', 143), starttls('out.alice.it', 587))],
  [['tin.it'], known('TIN', starttls('imaps.tin.it', 143), starttls('smtps.tin.it', 587))],
  [['tiscali.it'], known('Tiscali', ssl('imap.tiscali.it', 993), ssl('smtp.tiscali.it', 465))],
  [
    ['fastwebnet.it'],
    known('Fastweb', ssl('imap.fastwebnet.it', 993), ssl('smtp.fastwebnet.it', 465))
  ],
  [
    ['aruba.it', 'technet.it'],
    known('Aruba', ssl('imap.aruba.it', 993), ssl('smtp.aruba.it', 465))
  ],
  [
    ['pec.it', 'arubapec.it', 'mypec.eu', 'gigapec.it', 'ingpec.eu', 'actaliscertymail.it'],
    ARUBA_PEC
  ],
  [['legalmail.it', 'cert.legalmail.it'], LEGALMAIL],
  [['postecertifica.it'], POSTECERTIFICA],
  [
    ['postecert.it'],
    known(
      'Postecert (Poste Italiane)',
      ssl('mail.postecert.it', 993),
      ssl('mail.postecert.it', 465),
      {
        pec: true
      }
    )
  ],
  [['registerpec.it', 'dadapec.com', 'pec-mail.it'], REGISTER_PEC],
  [['sicurezzapostale.it'], NAMIRIAL],
  [['pec.libero.it'], LIBERO_PEC],
  [['timpec.it', 'pec.telecomitalia.it', 'trustpec.it'], TIM_PEC]
]

/** The mail servers of the certified mail (PEC) providers SIEVER Mail knows. */
const PEC_SERVERS = new Set(
  BY_DOMAIN.flatMap(([, settings]) =>
    settings.pec ? [settings.imap.host.toLowerCase(), settings.smtp.host.toLowerCase()] : []
  )
)

/** Whether a mailbox on this server is a certified one (PEC), as its provider is known. */
export function isPecServer(host: string): boolean {
  return PEC_SERVERS.has(host.trim().toLowerCase())
}

/** The providers known by their mail servers: a company's own domain hosted there. */
const BY_MX: ReadonlyArray<[string, Known]> = [
  ['google.com', GMAIL],
  ['googlemail.com', GMAIL],
  ['olc.protection.outlook.com', OUTLOOK],
  ['mail.protection.outlook.com', MICROSOFT_365],
  ['pec.aruba.it', ARUBA_PEC],
  ['pec.actalis.it', ARUBA_PEC],
  ['cert.legalmail.it', LEGALMAIL],
  ['pec-email.com', REGISTER_PEC],
  ['sicurezzapostale.it', NAMIRIAL],
  ['postacert.it.net', LIBERO_PEC],
  ['telecompost.it', TIM_PEC],
  ['postecertifica.it', POSTECERTIFICA],
  ['aruba.it', ARUBA_HOSTED],
  ['register.it', REGISTER_HOSTED],
  ['icloud.com', ICLOUD]
]

/** Mail servers of PEC providers not in the table: the mailbox is certified, its servers found elsewhere. */
const PEC_MX = ['postecert.it', 'ig-trustmail.com', 'pec.notariato.it']

/** A domain as DNS takes it — an international one in its ASCII form — or null. */
function hostnameOf(domain: string): string | null {
  try {
    return new URL(`http://${domain}`).hostname
  } catch {
    return null
  }
}

const endsWithDomain = (host: string, suffix: string): boolean =>
  host === suffix || host.endsWith(`.${suffix}`)

function settingsOf(
  entry: Known,
  source: DiscoveredMailSettings['source'],
  address: string
): DiscoveredMailSettings {
  const { username, note, ...rest } = entry
  return {
    ...rest,
    source,
    username: username ?? address,
    note: note ? messages(NOTES)[note] : null
  }
}

/** Who keeps the servers, by their names: a provider with its own way in. */
function providerOfHosts(imapHost: string): DiscoveredMailSettings['provider'] {
  if (endsWithDomain(imapHost, 'gmail.com') || endsWithDomain(imapHost, 'googlemail.com')) {
    return 'google'
  }

  if (endsWithDomain(imapHost, 'office365.com') || endsWithDomain(imapHost, 'outlook.com')) {
    return 'microsoft'
  }

  return endsWithDomain(imapHost, 'mail.me.com') ? 'icloud' : null
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  isArray: (name) =>
    [
      'emailProvider',
      'domain',
      'incomingServer',
      'outgoingServer',
      'socketType',
      'authentication'
    ].includes(name)
})

const PASSWORD_AUTH = new Set(['password-cleartext', 'plain', 'password-encrypted', 'secure'])

interface ConfigServer {
  '@type'?: string
  hostname?: string
  port?: string
  socketType?: string[]
  authentication?: string[]
  username?: string
}

/**
 * The first IMAP and SMTP servers of a config-v1.1 file that sign in with
 * a password over an encrypted connection; with OAuth only, the provider
 * that runs it (Google, Microsoft), whose own sign-in SIEVER Mail has.
 */
export function parseAutoconfig(xml: string, address: string): DiscoveredMailSettings | null {
  let document: { clientConfig?: { emailProvider?: Array<Record<string, unknown>> } }

  try {
    document = parser.parse(xml) as typeof document
  } catch {
    return null
  }

  const provider = document.clientConfig?.emailProvider?.[0]

  if (!provider) {
    return null
  }

  const [local, domain] = [
    address.slice(0, address.lastIndexOf('@')),
    address.slice(address.lastIndexOf('@') + 1)
  ]
  const fill = (value: string): string =>
    value
      .replaceAll('%EMAILADDRESS%', address)
      .replaceAll('%EMAILLOCALPART%', local)
      .replaceAll('%EMAILDOMAIN%', domain)
      .trim()
  const pick = (
    servers: unknown,
    type: string
  ): { server: MailServerSettings; username: string; oauthOnly: boolean } | null => {
    let oauthOnly: { server: MailServerSettings; username: string; oauthOnly: boolean } | null =
      null

    for (const candidate of (Array.isArray(servers) ? servers : []) as ConfigServer[]) {
      const socket = (candidate.socketType ?? []).find(
        (value) => value === 'SSL' || value === 'STARTTLS'
      )
      const port = Number(candidate.port)
      const host = fill(String(candidate.hostname ?? ''))

      if (candidate['@type'] !== type || !socket || !host || !(port > 0 && port < 65536)) {
        continue
      }

      const found = {
        server: { host, port, secure: socket === 'SSL' },
        username: fill(String(candidate.username ?? '%EMAILADDRESS%')),
        oauthOnly: false
      }

      if (
        (candidate.authentication ?? ['password-cleartext']).some((value) =>
          PASSWORD_AUTH.has(value)
        )
      ) {
        return found
      }

      oauthOnly ??= { ...found, oauthOnly: true }
    }

    return oauthOnly
  }

  const imap = pick(provider.incomingServer, 'imap')
  const smtp = pick(provider.outgoingServer, 'smtp')

  if (!imap || !smtp) {
    return null
  }

  const hostProvider = providerOfHosts(imap.server.host)

  // A server that takes only OAuth is one whose sign-in SIEVER Mail must have.
  if (
    (imap.oauthOnly || smtp.oauthOnly) &&
    hostProvider !== 'google' &&
    hostProvider !== 'microsoft'
  ) {
    return null
  }

  // A provider's name, not a placeholder of the address standing for one.
  const named = typeof provider.displayName === 'string' ? fill(provider.displayName) : ''
  const name =
    named && named.toLowerCase() !== address.toLowerCase() && !named.includes('%') ? named : null

  return {
    source: 'ispdb',
    provider: hostProvider,
    name,
    pec: false,
    appPassword: hostProvider === 'icloud',
    imap: imap.server,
    smtp: smtp.server,
    username: imap.username,
    note: null
  }
}

/** A config file over https: redirects followed only to https, the answer kept small. */
async function fetchConfig(
  url: string,
  deps: DiscoveryDeps,
  signal: AbortSignal
): Promise<string | null> {
  let next = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await deps.fetch(next, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)])
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      const target = location ? new URL(location, next) : null

      if (!target || target.protocol !== 'https:') {
        return null
      }

      next = target.toString()
      continue
    }

    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_CONFIG_BYTES) {
      return null
    }

    const text = await response.text()
    return text.length <= MAX_CONFIG_BYTES && text.includes('clientConfig') ? text : null
  }

  return null
}

/** What config files say for a domain: its provider's own (https), then Thunderbird's database. */
async function fromConfigFiles(
  domain: string,
  address: string,
  deps: DiscoveryDeps,
  signal: AbortSignal,
  options: { wellKnown: boolean }
): Promise<DiscoveredMailSettings | null> {
  const quietly = (url: string): Promise<string | null> =>
    fetchConfig(url, deps, signal).catch(() => null)
  const own = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(address)}`,
    ...(options.wellKnown
      ? [
          `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(address)}`
        ]
      : [])
  ]
  const [ownFiles, database] = await Promise.all([
    Promise.all(own.map(quietly)),
    quietly(`${ISPDB}${encodeURIComponent(domain)}`)
  ])

  for (const text of ownFiles) {
    const settings = text ? parseAutoconfig(text, address) : null

    if (settings) {
      return { ...settings, source: 'provider' }
    }
  }

  return database ? parseAutoconfig(database, address) : null
}

const quietDns = <T>(work: Promise<T[]>): Promise<T[]> => work.catch(() => [])

/** The settings the domain's SRV records give (RFC 6186): IMAP over TLS, and submission. */
async function fromSrv(
  domain: string,
  address: string,
  deps: DiscoveryDeps
): Promise<DiscoveredMailSettings | null> {
  const best = async (name: string): Promise<{ host: string; port: number } | null> => {
    const records = (await quietDns(deps.resolveSrv(name)))
      // A target "." says the service is not offered.
      .filter((record) => record.name && record.name !== '.' && record.port > 0)
      .sort((a, b) => a.priority - b.priority || b.weight - a.weight)
    return records[0] ? { host: records[0].name.replace(/\.$/, ''), port: records[0].port } : null
  }

  const [imaps, imap, submissions, submission] = await Promise.all([
    best(`_imaps._tcp.${domain}`),
    best(`_imap._tcp.${domain}`),
    best(`_submissions._tcp.${domain}`),
    best(`_submission._tcp.${domain}`)
  ])
  const incoming = imaps
    ? ssl(imaps.host, imaps.port)
    : imap
      ? starttls(imap.host, imap.port)
      : null
  const outgoing = submissions
    ? ssl(submissions.host, submissions.port)
    : submission
      ? starttls(submission.host, submission.port)
      : null

  return incoming && outgoing
    ? {
        source: 'dns',
        provider: providerOfHosts(incoming.host),
        name: null,
        pec: false,
        appPassword: false,
        imap: incoming,
        smtp: outgoing,
        username: address,
        note: null
      }
    : null
}

/** The usual names, tried on the network: encrypted first. */
async function guess(
  domain: string,
  address: string,
  deps: DiscoveryDeps
): Promise<DiscoveredMailSettings | null> {
  const first = async (candidates: MailServerSettings[]): Promise<MailServerSettings | null> => {
    const answers = await Promise.all(
      candidates.map((candidate) =>
        deps.reachable(candidate.host, candidate.port, candidate.secure).catch(() => false)
      )
    )
    return candidates[answers.indexOf(true)] ?? null
  }

  const [imap, smtp] = await Promise.all([
    first([
      ssl(`imap.${domain}`, 993),
      ssl(`mail.${domain}`, 993),
      starttls(`imap.${domain}`, 143),
      starttls(`mail.${domain}`, 143)
    ]),
    first([
      ssl(`smtp.${domain}`, 465),
      starttls(`smtp.${domain}`, 587),
      ssl(`mail.${domain}`, 465),
      starttls(`mail.${domain}`, 587)
    ])
  ])

  return imap && smtp
    ? {
        source: 'guess',
        provider: null,
        name: null,
        pec: false,
        appPassword: false,
        imap,
        smtp,
        username: address,
        note: null
      }
    : null
}

/** The servers of a mailbox, from its address; null when nothing can be found and the user writes them. */
export async function discoverMailSettings(
  rawAddress: string,
  deps: DiscoveryDeps,
  signal: AbortSignal = new AbortController().signal
): Promise<DiscoveredMailSettings | null> {
  const address = rawAddress.trim()
  const at = address.lastIndexOf('@')
  const domain = at > 0 ? hostnameOf(address.slice(at + 1)) : null

  if (!domain?.includes('.')) {
    throw new Error(messages(MESSAGES).notAnAddress)
  }

  const byDomain = BY_DOMAIN.find(([domains]) => domains.includes(domain))?.[1]

  if (byDomain) {
    return settingsOf(byDomain, 'known', address)
  }

  const [files, mx] = await Promise.all([
    fromConfigFiles(domain, address, deps, signal, { wellKnown: true }),
    quietDns(deps.resolveMx(domain)).then((records) =>
      records
        // A null MX (RFC 7505) says the domain takes no mail.
        .filter((record) => record.exchange && record.exchange !== '.')
        .sort((a, b) => a.priority - b.priority)
        .map((record) => record.exchange.toLowerCase().replace(/\.$/, ''))
    )
  ])
  const exchange = mx[0] ?? null
  const pec = mx.some((host) => PEC_MX.some((suffix) => endsWithDomain(host, suffix)))
  const byMx = exchange
    ? BY_MX.find(([suffix]) => endsWithDomain(exchange, suffix))?.[1]
    : undefined

  // The provider's own file and Thunderbird's database come first; then the known mail server.
  if (files) {
    return { ...files, pec: files.pec || pec || Boolean(byMx?.pec) }
  }

  if (byMx) {
    return settingsOf(byMx, 'known', address)
  }

  // The mail server's provider, by its own domain: Thunderbird's MX lookup.
  if (exchange) {
    const base = getDomain(exchange)

    if (base && base !== domain) {
      for (const candidate of [...new Set([exchange.slice(exchange.indexOf('.') + 1), base])]) {
        const found = await fromConfigFiles(candidate, address, deps, signal, { wellKnown: false })

        if (found) {
          return { ...found, source: 'dns', pec }
        }
      }
    }
  }

  const srv = await fromSrv(domain, address, deps)

  if (srv) {
    return { ...srv, pec }
  }

  const guessed = await guess(domain, address, deps)
  return guessed ? { ...guessed, pec } : null
}
