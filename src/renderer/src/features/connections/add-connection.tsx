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
import { cn } from '@renderer/lib/utils'
import type { DiscoveredMailSettings } from '@shared/connections'
import type { MailAccount } from '@shared/models'

import {
  EMPTY_SERVERS,
  serversComplete,
  withEncryption,
  withPort,
  type MailServer,
  type ServersForm
} from './mail-servers'

type Choice = 'google' | 'microsoft' | 'icloud' | 'mail' | 'caldav' | 'ics'

const CHOICES: ReadonlyArray<{ id: Choice; title: string; line: string; icon: LucideIcon }> = [
  { id: 'google', title: 'Google', line: 'Gmail e Google Calendar', icon: Mail },
  { id: 'microsoft', title: 'Microsoft', line: 'Outlook, Hotmail e Microsoft 365', icon: Mail },
  { id: 'icloud', title: 'iCloud', line: 'La posta e il calendario di Apple', icon: Cloud },
  { id: 'mail', title: 'Altra posta', line: 'Qualunque casella, anche PEC', icon: AtSign },
  {
    id: 'caldav',
    title: 'Calendario CalDAV',
    line: 'Fastmail, Nextcloud, il server dell’azienda',
    icon: Server
  },
  {
    id: 'ics',
    title: 'Calendario da un link',
    line: 'Un calendario pubblicato, da leggere',
    icon: Link2
  }
]

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

const SOURCE_WORDS: Readonly<Record<DiscoveredMailSettings['source'], string>> = {
  known: 'Impostazioni note per questo indirizzo.',
  ispdb: 'Impostazioni dal database di Thunderbird.',
  provider: 'Impostazioni pubblicate dal tuo fornitore di posta.',
  dns: 'Impostazioni dai record del dominio.',
  guess: 'Impostazioni probabili: controllale.'
}

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
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px]">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={mail}
          onCheckedChange={(checked) => onChange({ mail: checked === true, calendar })}
        />
        <Mail className="text-faint-foreground size-3.5" />
        Posta
      </label>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={calendar}
          onCheckedChange={(checked) => onChange({ mail, calendar: checked === true })}
        />
        <CalendarDays className="text-faint-foreground size-3.5" />
        Calendario
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
  const encryption = (server: MailServer): React.JSX.Element => (
    <Select
      value={form[server === 'imap' ? 'imapSecure' : 'smtpSecure'] ? 'tls' : 'starttls'}
      onValueChange={(value) => onChange(withEncryption(form, server, value === 'tls'))}
    >
      <SelectTrigger aria-label={`Crittografia ${server.toUpperCase()}`} className="min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="tls">SSL/TLS</SelectItem>
        <SelectItem value="starttls">STARTTLS</SelectItem>
      </SelectContent>
    </Select>
  )

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <Field label="Nome utente">
        <Input
          value={form.username}
          onChange={(event) => onChange({ ...form, username: event.target.value })}
        />
      </Field>
      <div className="hidden sm:block" />
      <Field label="Server IMAP">
        <Input
          value={form.imapHost}
          placeholder="imap.dominio.it"
          onChange={(event) => onChange({ ...form, imapHost: event.target.value })}
        />
      </Field>
      <Field label="Porta e crittografia IMAP">
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
      <Field label="Server SMTP">
        <Input
          value={form.smtpHost}
          placeholder="smtp.dominio.it"
          onChange={(event) => onChange({ ...form, smtpHost: event.target.value })}
        />
      </Field>
      <Field label="Porta e crittografia SMTP">
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
        setProblem(messageOf(error, 'Non ho trovato i server di questo indirizzo.'))
        setServers({ ...EMPTY_SERVERS, username: asked })
      }
    } finally {
      setPending(false)
    }
  }

  const addressFields = (passwordHint?: ReactNode): React.JSX.Element => (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <Field label="Indirizzo email">
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          value={address}
          placeholder="nome@dominio.it"
          onChange={(event) => {
            setAddress(event.target.value)
            setServers(null)
          }}
        />
      </Field>
      <Field label="Il tuo nome" hint="Come lo vede chi riceve le tue mail.">
        <Input
          value={displayName}
          placeholder="Mario Rossi"
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </Field>
      <Field label="Password" hint={passwordHint}>
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
        toast.error('Il calendario non si è collegato', { description: added.calendarProblem })
      }
    }, 'L’accesso non è riuscito.')

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
              Si apre la pagina di {provider}: scegli l’account e consenti l’accesso. La password
              resta a {provider}, non passa da qui. Posta e calendario sono due connessioni, prese
              insieme.
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
              Continua con {provider}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-[12.5px] leading-[1.5]">
            L’accesso con {provider} non è attivo in questa versione di SIEVER Mail: serve che l’app
            sia registrata presso {provider}. Intanto una casella {provider} si collega con «Altra
            posta», se il tuo account lo consente.
          </p>
        )
      }
      case 'icloud':
        return (
          <>
            {addressFields(
              <>
                Una password per app, non quella dell’ID Apple: la crei su{' '}
                <span className="font-medium">account.apple.com</span>, in Accesso e sicurezza.
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
                }, 'iCloud non ha accettato l’accesso.')
              }
            >
              {pending && <LoaderCircle className="size-4 animate-spin" />}
              Collega iCloud
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
                    ? `${found.name ? `${found.name}. ` : ''}${SOURCE_WORDS[found.source]}${found.pec ? ' È una casella PEC.' : ''}`
                    : 'Non ho trovato le impostazioni di questo indirizzo: te le dà chi gestisce la tua posta.'}
                  {found?.appPassword && ' Questo fornitore chiede una password per app.'}
                </p>
                <ServerFields form={servers} onChange={setServers} />
                <Button
                  className="w-fit"
                  disabled={pending || !address.trim() || !password || !serversComplete(servers)}
                  onClick={() =>
                    void run(() => addMailbox(servers), 'La casella non si è collegata.')
                  }
                >
                  {pending && <LoaderCircle className="size-4 animate-spin" />}
                  Collega la casella
                </Button>
              </>
            ) : (
              <Button
                className="w-fit"
                disabled={pending || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address.trim())}
                onClick={() => void discover()}
              >
                {pending && <LoaderCircle className="size-4 animate-spin" />}
                Continua
              </Button>
            )}
          </>
        )
      case 'caldav':
        return (
          <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field
                label="Indirizzo del server"
                hint="Quello che il tuo fornitore indica per CalDAV."
              >
                <Input
                  autoFocus
                  value={serverUrl}
                  placeholder="https://caldav.dominio.it"
                  onChange={(event) => setServerUrl(event.target.value)}
                />
              </Field>
              <Field label="Nome utente">
                <Input value={address} onChange={(event) => setAddress(event.target.value)} />
              </Field>
              <Field label="Password">
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
                }, 'Il server non ha accettato l’accesso.')
              }
            >
              {pending && <LoaderCircle className="size-4 animate-spin" />}
              Collega il calendario
            </Button>
          </>
        )
      case 'ics':
        return (
          <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field label="Link del calendario" hint="Comincia con https:// o webcal://.">
                <Input
                  autoFocus
                  value={link}
                  placeholder="https://…/calendario.ics"
                  onChange={(event) => setLink(event.target.value)}
                />
              </Field>
              <Field label="Nome" hint="Se lo lasci vuoto, quello che il calendario dà a sé.">
                <Input value={linkName} onChange={(event) => setLinkName(event.target.value)} />
              </Field>
            </div>
            <Button
              className="w-fit"
              disabled={pending || !link.trim()}
              onClick={() =>
                void run(async () => {
                  await window.calendarApi.addIcs(link.trim(), linkName.trim() || null)
                }, 'Il calendario non si è collegato.')
              }
            >
              {pending && <LoaderCircle className="size-4 animate-spin" />}
              Collega il calendario
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
              aria-label="Indietro"
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
            <span className="text-[13px] font-semibold">{chosen.title}</span>
            <span className="text-muted-foreground truncate text-[12px]">{chosen.line}</span>
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
            <span className="text-[13px] font-semibold">Aggiungi una connessione</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[12px]"
              onClick={onDone}
            >
              Annulla
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
                    <span className="block text-[12.5px] font-semibold">{option.title}</span>
                    <span className="text-muted-foreground block truncate text-[11.5px]">
                      {option.line}
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
