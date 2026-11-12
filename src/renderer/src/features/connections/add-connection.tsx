import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  AtSign,
  CalendarDays,
  Cloud,
  Link2,
  LoaderCircle,
  LogIn,
  Mail,
  Server,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { DiscoveredMailSettings } from '@shared/connections'
import { defineMessages } from '@shared/i18n'
import type { MailAccount } from '@shared/models'
import { PLACES } from '@shared/places'

import {
  EMPTY_SERVERS,
  serversComplete,
  withEncryption,
  withPort,
  type MailServer,
  type ServersForm
} from './mail-servers'

type Choice = 'google' | 'microsoft' | 'icloud' | 'mail' | 'caldav' | 'ics'

const CHOICES: ReadonlyArray<{ id: Choice; icon: LucideIcon }> = [
  { id: 'google', icon: Mail },
  { id: 'microsoft', icon: Mail },
  { id: 'icloud', icon: Cloud },
  { id: 'mail', icon: AtSign },
  { id: 'caldav', icon: Server },
  { id: 'ics', icon: Link2 }
]

/** Each choice by name, as the user knows who it is with. */
const CHOICE_TITLES = defineMessages({
  google: { en: 'Google', it: 'Google', de: 'Google' },
  microsoft: { en: 'Microsoft', it: 'Microsoft', de: 'Microsoft' },
  icloud: { en: 'iCloud', it: 'iCloud', de: 'iCloud' },
  mail: { en: 'Other mail', it: 'Altra posta', de: 'Andere E-Mail' },
  caldav: { en: 'CalDAV calendar', it: 'Calendario CalDAV', de: 'CalDAV-Kalender' },
  ics: { en: 'Calendar from a link', it: 'Calendario da un link', de: 'Kalender über einen Link' }
}) satisfies Record<Choice, unknown>

/** What each choice connects, in a line under its name. */
const CHOICE_LINES = defineMessages({
  google: {
    en: 'Gmail and Google Calendar',
    it: 'Gmail e Google Calendar',
    de: 'Gmail und Google Kalender'
  },
  microsoft: {
    en: 'Outlook, Hotmail and Microsoft 365',
    it: 'Outlook, Hotmail e Microsoft 365',
    de: 'Outlook, Hotmail und Microsoft 365'
  },
  icloud: {
    en: 'Apple’s mail and calendar',
    it: 'La posta e il calendario di Apple',
    de: 'E-Mail und Kalender von Apple'
  },
  mail: {
    en: 'Any mailbox, PEC too',
    it: 'Qualunque casella, anche PEC',
    de: 'Jedes Postfach, auch PEC'
  },
  caldav: {
    en: 'Fastmail, Nextcloud, your company’s server',
    it: 'Fastmail, Nextcloud, il server dell’azienda',
    de: 'Fastmail, Nextcloud, der Server Ihres Unternehmens'
  },
  ics: {
    en: 'A published calendar, to read',
    it: 'Un calendario pubblicato, da leggere',
    de: 'Ein veröffentlichter Kalender, zum Lesen'
  }
}) satisfies Record<Choice, unknown>

const ICLOUD_SERVERS: ServersForm = {
  username: '',
  imapHost: 'imap.mail.me.com',
  imapPort: '993',
  imapSecure: true,
  smtpHost: 'smtp.mail.me.com',
  smtpPort: '587',
  smtpSecure: false
}
const ICLOUD_CALDAV = 'https://caldav.icloud.com'
/** Where an Apple Account's app passwords are made: a name, the same in every language. */
const APPLE_ACCOUNT_SITE = 'account.apple.com'

/** The encryptions a mail server is reached with, by the names of their protocols. */
const ENCRYPTIONS = { tls: 'SSL/TLS', starttls: 'STARTTLS' } as const

const SOURCE_WORDS = defineMessages({
  known: {
    en: 'Known settings for this address.',
    it: 'Impostazioni note per questo indirizzo.',
    de: 'Bekannte Einstellungen für diese Adresse.'
  },
  ispdb: {
    en: 'Settings from Thunderbird’s database.',
    it: 'Impostazioni dal database di Thunderbird.',
    de: 'Einstellungen aus der Datenbank von Thunderbird.'
  },
  provider: {
    en: 'Settings published by your mail provider.',
    it: 'Impostazioni pubblicate dal tuo fornitore di posta.',
    de: 'Von Ihrem E-Mail-Anbieter veröffentlichte Einstellungen.'
  },
  dns: {
    en: 'Settings from the domain’s records.',
    it: 'Impostazioni dai record del dominio.',
    de: 'Einstellungen aus den DNS-Einträgen der Domain.'
  },
  guess: {
    en: 'Likely settings: check them.',
    it: 'Impostazioni probabili: controllale.',
    de: 'Wahrscheinliche Einstellungen: Bitte prüfen Sie sie.'
  }
}) satisfies Record<DiscoveredMailSettings['source'], unknown>

const MESSAGES = defineMessages({
  encryption: {
    en: (server: string) => `${server} encryption`,
    it: (server: string) => `Crittografia ${server}`,
    de: (server: string) => `${server}-Verschlüsselung`
  },
  username: { en: 'Username', it: 'Nome utente', de: 'Benutzername' },
  imapServer: { en: 'IMAP server', it: 'Server IMAP', de: 'IMAP-Server' },
  imapHost: { en: 'imap.example.com', it: 'imap.dominio.it', de: 'imap.beispiel.de' },
  imapPort: {
    en: 'IMAP port and encryption',
    it: 'Porta e crittografia IMAP',
    de: 'IMAP-Port und -Verschlüsselung'
  },
  smtpServer: { en: 'SMTP server', it: 'Server SMTP', de: 'SMTP-Server' },
  smtpHost: { en: 'smtp.example.com', it: 'smtp.dominio.it', de: 'smtp.beispiel.de' },
  smtpPort: {
    en: 'SMTP port and encryption',
    it: 'Porta e crittografia SMTP',
    de: 'SMTP-Port und -Verschlüsselung'
  },
  serversNotFound: {
    en: 'I couldn’t find the servers for this address.',
    it: 'Non ho trovato i server di questo indirizzo.',
    de: 'Ich habe die Server dieser Adresse nicht gefunden.'
  },
  address: { en: 'Email address', it: 'Indirizzo email', de: 'E-Mail-Adresse' },
  addressExample: { en: 'name@example.com', it: 'nome@dominio.it', de: 'name@beispiel.de' },
  yourName: { en: 'Your name', it: 'Il tuo nome', de: 'Ihr Name' },
  yourNameHint: {
    en: 'As people who get your email see it.',
    it: 'Come lo vede chi riceve le tue mail.',
    de: 'So sehen ihn die Empfänger Ihrer E-Mails.'
  },
  nameExample: { en: 'Alex Morgan', it: 'Mario Rossi', de: 'Erika Mustermann' },
  password: { en: 'Password', it: 'Password', de: 'Passwort' },
  calendarNotConnected: {
    en: 'The calendar didn’t connect',
    it: 'Il calendario non si è collegato',
    de: 'Der Kalender wurde nicht verbunden'
  },
  signInFailed: {
    en: 'Sign-in didn’t work.',
    it: 'L’accesso non è riuscito.',
    de: 'Die Anmeldung ist fehlgeschlagen.'
  },
  providerPage: {
    en: (provider: string) =>
      `${provider}’s page opens: choose the account and allow access. The password stays with ${provider} and never passes through here. Mail and calendar are two connections, made together.`,
    it: (provider: string) =>
      `Si apre la pagina di ${provider}: scegli l’account e consenti l’accesso. La password resta a ${provider}, non passa da qui. Posta e calendario sono due connessioni, prese insieme.`,
    de: (provider: string) =>
      `Die Seite von ${provider} öffnet sich: Wählen Sie das Konto und erlauben Sie den Zugriff. Das Passwort bleibt bei ${provider} und läuft nicht über diese App. E-Mail und Kalender sind zwei Verbindungen, die zusammen hergestellt werden.`
  },
  continueWith: {
    en: (provider: string) => `Continue with ${provider}`,
    it: (provider: string) => `Continua con ${provider}`,
    de: (provider: string) => `Weiter mit ${provider}`
  },
  providerOff: {
    en: (provider: string, other: string) =>
      `Signing in with ${provider} isn’t available in this version of SIEVER Mail: the app needs to be registered with ${provider}. Meanwhile, a ${provider} mailbox can be connected with “${other}”, if your account allows it.`,
    it: (provider: string, other: string) =>
      `L’accesso con ${provider} non è attivo in questa versione di SIEVER Mail: serve che l’app sia registrata presso ${provider}. Intanto una casella ${provider} si collega con «${other}», se il tuo account lo consente.`,
    de: (provider: string, other: string) =>
      `Die Anmeldung mit ${provider} ist in dieser Version von SIEVER Mail nicht aktiv: Dafür muss die App bei ${provider} registriert sein. Bis dahin lässt sich ein ${provider}-Postfach über „${other}“ verbinden, sofern Ihr Konto das erlaubt.`
  },
  icloudPasswordBefore: {
    en: 'An app-specific password, not your Apple Account one: create it at',
    it: 'Una password per app, non quella dell’ID Apple: la crei su',
    de: 'Ein app-spezifisches Passwort, nicht das Ihres Apple Accounts: Sie erstellen es auf'
  },
  icloudPasswordAfter: {
    en: ', under Sign-In and Security.',
    it: ', in Accesso e sicurezza.',
    de: ' unter „Anmeldung und Sicherheit“.'
  },
  icloudRefused: {
    en: 'iCloud didn’t accept the sign-in.',
    it: 'iCloud non ha accettato l’accesso.',
    de: 'iCloud hat die Anmeldung nicht akzeptiert.'
  },
  connectIcloud: { en: 'Connect iCloud', it: 'Collega iCloud', de: 'iCloud verbinden' },
  isPec: { en: ' It’s a PEC mailbox.', it: ' È una casella PEC.', de: ' Es ist ein PEC-Postfach.' },
  settingsNotFound: {
    en: 'I couldn’t find the settings for this address: whoever manages your email can give them to you.',
    it: 'Non ho trovato le impostazioni di questo indirizzo: te le dà chi gestisce la tua posta.',
    de: 'Ich habe die Einstellungen dieser Adresse nicht gefunden: Sie erhalten sie von der Stelle, die Ihre E-Mails verwaltet.'
  },
  appPassword: {
    en: ' This provider asks for an app password.',
    it: ' Questo fornitore chiede una password per app.',
    de: ' Dieser Anbieter verlangt ein App-Passwort.'
  },
  mailboxNotConnected: {
    en: 'The mailbox didn’t connect.',
    it: 'La casella non si è collegata.',
    de: 'Das Postfach wurde nicht verbunden.'
  },
  connectMailbox: { en: 'Connect the mailbox', it: 'Collega la casella', de: 'Postfach verbinden' },
  continue: { en: 'Continue', it: 'Continua', de: 'Weiter' },
  serverAddress: { en: 'Server address', it: 'Indirizzo del server', de: 'Serveradresse' },
  serverAddressHint: {
    en: 'The one your provider gives for CalDAV.',
    it: 'Quello che il tuo fornitore indica per CalDAV.',
    de: 'Die Adresse, die Ihr Anbieter für CalDAV angibt.'
  },
  serverExample: {
    en: 'https://caldav.example.com',
    it: 'https://caldav.dominio.it',
    de: 'https://caldav.beispiel.de'
  },
  serverRefused: {
    en: 'The server didn’t accept the sign-in.',
    it: 'Il server non ha accettato l’accesso.',
    de: 'Der Server hat die Anmeldung nicht akzeptiert.'
  },
  connectCalendar: {
    en: 'Connect the calendar',
    it: 'Collega il calendario',
    de: 'Kalender verbinden'
  },
  link: { en: 'Calendar link', it: 'Link del calendario', de: 'Kalenderlink' },
  linkHint: {
    en: 'Starts with https:// or webcal://.',
    it: 'Comincia con https:// o webcal://.',
    de: 'Beginnt mit https:// oder webcal://.'
  },
  linkExample: {
    en: 'https://…/calendar.ics',
    it: 'https://…/calendario.ics',
    de: 'https://…/kalender.ics'
  },
  name: { en: 'Name', it: 'Nome', de: 'Name' },
  nameHint: {
    en: 'Left empty, the one the calendar gives itself.',
    it: 'Se lo lasci vuoto, quello che il calendario dà a sé.',
    de: 'Leer gelassen, der Name, den der Kalender selbst trägt.'
  },
  calendarNotLinked: {
    en: 'The calendar didn’t connect.',
    it: 'Il calendario non si è collegato.',
    de: 'Der Kalender wurde nicht verbunden.'
  },
  back: { en: 'Back', it: 'Indietro', de: 'Zurück' },
  addConnection: {
    en: 'Add a connection',
    it: 'Aggiungi una connessione',
    de: 'Verbindung hinzufügen'
  },
  cancel: { en: 'Cancel', it: 'Annulla', de: 'Abbrechen' }
})

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <Label asChild>
        <span>{label}</span>
      </Label>
      {children}
      {hint && <span className="text-muted-foreground text-[11px] leading-[1.4]">{hint}</span>}
    </label>
  )
}

function Services({
  mail,
  calendar,
  onChange
}: {
  mail: boolean
  calendar: boolean
  onChange: (services: { mail: boolean; calendar: boolean }) => void
}): React.JSX.Element {
  const places = useMessages(PLACES)

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px]">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={mail}
          onCheckedChange={(checked) => onChange({ mail: checked === true, calendar })}
        />
        <Mail className="text-faint-foreground size-3.5" />
        {places.mail}
      </label>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={calendar}
          onCheckedChange={(checked) => onChange({ mail, calendar: checked === true })}
        />
        <CalendarDays className="text-faint-foreground size-3.5" />
        {places.calendar}
      </label>
    </div>
  )
}

/** The servers of a mailbox, to read and to correct: who it signs in as, where, how encrypted. */
function ServerFields({
  form,
  onChange
}: {
  form: ServersForm
  onChange: (form: ServersForm) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const encryption = (server: MailServer): React.JSX.Element => (
    <Select
      value={form[server === 'imap' ? 'imapSecure' : 'smtpSecure'] ? 'tls' : 'starttls'}
      onValueChange={(value) => onChange(withEncryption(form, server, value === 'tls'))}
    >
      <SelectTrigger aria-label={m.encryption(server.toUpperCase())} className="min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="tls">{ENCRYPTIONS.tls}</SelectItem>
        <SelectItem value="starttls">{ENCRYPTIONS.starttls}</SelectItem>
      </SelectContent>
    </Select>
  )

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <Field label={m.username}>
        <Input
          value={form.username}
          onChange={(event) => onChange({ ...form, username: event.target.value })}
        />
      </Field>
      <div className="hidden sm:block" />
      <Field label={m.imapServer}>
        <Input
          value={form.imapHost}
          placeholder={m.imapHost}
          onChange={(event) => onChange({ ...form, imapHost: event.target.value })}
        />
      </Field>
      <Field label={m.imapPort}>
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            max={65535}
            className="w-24 shrink-0"
            value={form.imapPort}
            onChange={(event) => onChange(withPort(form, 'imap', event.target.value))}
          />
          {encryption('imap')}
        </div>
      </Field>
      <Field label={m.smtpServer}>
        <Input
          value={form.smtpHost}
          placeholder={m.smtpHost}
          onChange={(event) => onChange({ ...form, smtpHost: event.target.value })}
        />
      </Field>
      <Field label={m.smtpPort}>
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            max={65535}
            className="w-24 shrink-0"
            value={form.smtpPort}
            onChange={(event) => onChange(withPort(form, 'smtp', event.target.value))}
          />
          {encryption('smtp')}
        </div>
      </Field>
    </div>
  )
}

/**
 * Adding a connection, the same in the guided setup and from Settings:
 * who it is with — Google, Microsoft, iCloud, any other mailbox, a CalDAV
 * server, a calendar's link — then the least the user must say. An account
 * that gives mail and calendar gives both in one go, as two connections.
 */
export function AddConnection({
  googleReady,
  microsoftReady,
  onMailAdded,
  onDone
}: {
  googleReady: boolean
  microsoftReady: boolean
  /** A mailbox was connected: the app takes it in. */
  onMailAdded: (account: MailAccount) => void
  /** Something was connected, or the user gave up: the choice closes. */
  onDone: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const titles = useMessages(CHOICE_TITLES)
  const lines = useMessages(CHOICE_LINES)
  const sourceWords = useMessages(SOURCE_WORDS)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [services, setServices] = useState({ mail: true, calendar: true })
  const [address, setAddress] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [servers, setServers] = useState<ServersForm | null>(null)
  const [found, setFound] = useState<DiscoveredMailSettings | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [link, setLink] = useState('')
  const [linkName, setLinkName] = useState('')
  // The iCloud mailbox already connected on a try whose calendar failed: a retry adds only the calendar.
  const [mailAddedFor, setMailAddedFor] = useState<string | null>(null)
  // The address a search for servers was asked for: an answer for another one is late, and dropped.
  const discovering = useRef<string | null>(null)
  // A Microsoft sign-in waiting on the browser is given up when this closes.
  const waitingForMicrosoft = useRef(false)

  useEffect(() => {
    waitingForMicrosoft.current = pending && choice === 'microsoft'
  }, [pending, choice])

  useEffect(
    () => () => {
      if (waitingForMicrosoft.current) {
        void window.mailApi.cancelSignIn()
      }
    },
    []
  )

  const choose = (next: Choice | null): void => {
    setChoice(next)
    setProblem(null)
    setServices({ mail: true, calendar: true })
    setPassword('')
    setServers(null)
    setFound(null)
  }

  const run = async (action: () => Promise<void>, fallback: string): Promise<void> => {
    setPending(true)
    setProblem(null)

    try {
      await action()
      onDone()
    } catch (error) {
      setProblem(messageOf(error, fallback))
    } finally {
      setPending(false)
    }
  }

  const name = (): string => displayName.trim() || address.trim()

  const addMailbox = async (form: ServersForm): Promise<void> => {
    const account = await window.mailApi.addImapAccount({
      email: address.trim(),
      displayName: name(),
      username: form.username.trim(),
      password,
      imapHost: form.imapHost.trim(),
      imapPort: Number(form.imapPort),
      imapSecure: form.imapSecure,
      smtpHost: form.smtpHost.trim(),
      smtpPort: Number(form.smtpPort),
      smtpSecure: form.smtpSecure
    })
    onMailAdded(account)
  }

  /** The servers of the address, found; a provider with its own way in is offered that way. */
  const discover = async (): Promise<void> => {
    const asked = address.trim()
    discovering.current = asked
    setPending(true)
    setProblem(null)

    try {
      const settings = await window.mailApi.discoverMailSettings(asked)

      if (discovering.current !== asked) {
        return
      }

      // A provider with its own way in is offered that way — when that way is open in this build;
      // otherwise its servers are, for an app password.
      if (
        settings?.provider === 'icloud' ||
        (settings?.provider === 'google' && googleReady) ||
        (settings?.provider === 'microsoft' && microsoftReady)
      ) {
        setChoice(settings.provider)
        setProblem(null)
        return
      }

      setFound(settings)
      setServers(
        settings
          ? {
              username: settings.username,
              imapHost: settings.imap.host,
              imapPort: String(settings.imap.port),
              imapSecure: settings.imap.secure,
              smtpHost: settings.smtp.host,
              smtpPort: String(settings.smtp.port),
              smtpSecure: settings.smtp.secure
            }
          : { ...EMPTY_SERVERS, username: asked }
      )
    } catch (error) {
      if (discovering.current === asked) {
        setProblem(messageOf(error, messagesNow(MESSAGES).serversNotFound))
        setServers({ ...EMPTY_SERVERS, username: asked })
      }
    } finally {
      setPending(false)
    }
  }

  const addressFields = (passwordHint?: ReactNode): React.JSX.Element => (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <Field label={m.address}>
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          value={address}
          placeholder={m.addressExample}
          onChange={(event) => {
            setAddress(event.target.value)
            setServers(null)
          }}
        />
      </Field>
      <Field label={m.yourName} hint={m.yourNameHint}>
        <Input
          value={displayName}
          placeholder={m.nameExample}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </Field>
      <Field label={m.password} hint={passwordHint}>
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
    </div>
  )

  const signIn = (provider: 'google' | 'microsoft'): void =>
    void run(async () => {
      if (!services.mail) {
        await (provider === 'google'
          ? window.calendarApi.connectGoogle(null)
          : window.calendarApi.connectMicrosoft(null))
        return
      }

      const added = await (provider === 'google'
        ? window.mailApi.addGoogleAccount({ calendar: services.calendar })
        : window.mailApi.addMicrosoftAccount({ calendar: services.calendar }))
      onMailAdded(added.account)

      // The mailbox came; its calendar, asked for with it, did not: said, to add it again later.
      if (added.calendarProblem) {
        toast.error(messagesNow(MESSAGES).calendarNotConnected, {
          description: added.calendarProblem
        })
      }
    }, m.signInFailed)

  const form = ((): React.JSX.Element | null => {
    switch (choice) {
      case null:
        return null
      case 'google':
      case 'microsoft': {
        const ready = choice === 'google' ? googleReady : microsoftReady
        const provider = choice === 'google' ? 'Google' : 'Microsoft'

        return ready ? (
          <>
            <p className="text-muted-foreground text-[12.5px] leading-[1.5]">
              {m.providerPage(provider)}
            </p>
            <Services mail={services.mail} calendar={services.calendar} onChange={setServices} />
            <Button
              className="w-fit"
              disabled={pending || !(services.mail || services.calendar)}
              onClick={() => signIn(choice)}
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-4" />
              )}
              {m.continueWith(provider)}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-[12.5px] leading-[1.5]">
            {m.providerOff(provider, titles.mail)}
          </p>
        )
      }
      case 'icloud':
        return (
          <>
            {addressFields(
              <>
                {m.icloudPasswordBefore} <span className="font-medium">{APPLE_ACCOUNT_SITE}</span>
                {m.icloudPasswordAfter}
              </>
            )}
            <Services mail={services.mail} calendar={services.calendar} onChange={setServices} />
            <Button
              className="w-fit"
              disabled={
                pending || !address.trim() || !password || !(services.mail || services.calendar)
              }
              onClick={() =>
                void run(async () => {
                  if (services.mail && mailAddedFor !== address.trim().toLowerCase()) {
                    await addMailbox({ ...ICLOUD_SERVERS, username: address.trim() })
                    setMailAddedFor(address.trim().toLowerCase())
                  }

                  if (services.calendar) {
                    await window.calendarApi.addCalDav({
                      serverUrl: ICLOUD_CALDAV,
                      username: address.trim(),
                      password,
                      label: address.trim()
                    })
                  }
                }, m.icloudRefused)
              }
            >
              {pending && <LoaderCircle className="size-4 animate-spin" />}
              {m.connectIcloud}
            </Button>
          </>
        )
      case 'mail':
        return (
          <>
            {addressFields()}
            {servers ? (
              <>
                <p className="text-muted-foreground text-[12px]">
                  {found
                    ? `${found.name ? `${found.name}. ` : ''}${sourceWords[found.source]}${found.pec ? m.isPec : ''}`
                    : m.settingsNotFound}
                  {found?.appPassword && m.appPassword}
                </p>
                <ServerFields form={servers} onChange={setServers} />
                <Button
                  className="w-fit"
                  disabled={pending || !address.trim() || !password || !serversComplete(servers)}
                  onClick={() => void run(() => addMailbox(servers), m.mailboxNotConnected)}
                >
                  {pending && <LoaderCircle className="size-4 animate-spin" />}
                  {m.connectMailbox}
                </Button>
              </>
            ) : (
              <Button
                className="w-fit"
                disabled={pending || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address.trim())}
                onClick={() => void discover()}
              >
                {pending && <LoaderCircle className="size-4 animate-spin" />}
                {m.continue}
              </Button>
            )}
          </>
        )
      case 'caldav':
        return (
          <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field label={m.serverAddress} hint={m.serverAddressHint}>
                <Input
                  autoFocus
                  value={serverUrl}
                  placeholder={m.serverExample}
                  onChange={(event) => setServerUrl(event.target.value)}
                />
              </Field>
              <Field label={m.username}>
                <Input value={address} onChange={(event) => setAddress(event.target.value)} />
              </Field>
              <Field label={m.password}>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
            </div>
            <Button
              className="w-fit"
              disabled={pending || !serverUrl.trim() || !address.trim() || !password}
              onClick={() =>
                void run(async () => {
                  await window.calendarApi.addCalDav({
                    serverUrl: serverUrl.trim(),
                    username: address.trim(),
                    password,
                    label: address.trim()
                  })
                }, m.serverRefused)
              }
            >
              {pending && <LoaderCircle className="size-4 animate-spin" />}
              {m.connectCalendar}
            </Button>
          </>
        )
      case 'ics':
        return (
          <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field label={m.link} hint={m.linkHint}>
                <Input
                  autoFocus
                  value={link}
                  placeholder={m.linkExample}
                  onChange={(event) => setLink(event.target.value)}
                />
              </Field>
              <Field label={m.name} hint={m.nameHint}>
                <Input value={linkName} onChange={(event) => setLinkName(event.target.value)} />
              </Field>
            </div>
            <Button
              className="w-fit"
              disabled={pending || !link.trim()}
              onClick={() =>
                void run(async () => {
                  await window.calendarApi.addIcs(link.trim(), linkName.trim() || null)
                }, m.calendarNotLinked)
              }
            >
              {pending && <LoaderCircle className="size-4 animate-spin" />}
              {m.connectCalendar}
            </Button>
          </>
        )
    }
  })()

  const chosen = CHOICES.find((candidate) => candidate.id === choice)

  return (
    <div className="bg-card flex flex-col gap-3 rounded-[10px] border px-4 py-3">
      {chosen ? (
        <>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={m.back}
              // A Microsoft sign-in waits on the browser, which may never answer: going back gives it up.
              disabled={pending && choice !== 'microsoft'}
              onClick={() => {
                if (pending && choice === 'microsoft') {
                  void window.mailApi.cancelSignIn()
                }

                choose(null)
              }}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <chosen.icon className="text-faint-foreground size-4" />
            <span className="text-[13px] font-semibold">{titles[chosen.id]}</span>
            <span className="text-muted-foreground truncate text-[12px]">{lines[chosen.id]}</span>
          </div>
          {form}
          {problem && (
            <p className="text-destructive-soft-foreground text-[12px] leading-[1.45] whitespace-pre-wrap">
              {problem}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">{m.addConnection}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[12px]"
              onClick={onDone}
            >
              {m.cancel}
            </Button>
          </div>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {CHOICES.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => choose(option.id)}
                  className={cn(
                    'hover:bg-hover focus-visible:ring-ring/60 flex w-full items-center gap-2.5 rounded-[8px] border px-3 py-2 text-left outline-none focus-visible:ring-2',
                    ((option.id === 'google' && !googleReady) ||
                      (option.id === 'microsoft' && !microsoftReady)) &&
                      'opacity-60'
                  )}
                >
                  <option.icon className="text-faint-foreground size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold">{titles[option.id]}</span>
                    <span className="text-muted-foreground block truncate text-[11.5px]">
                      {lines[option.id]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
