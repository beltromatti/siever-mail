import { type ReactNode, useMemo, useRef, useState } from 'react'

import { AlertCircle, Check, LoaderCircle, LogIn, Plus } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import type { MailAccount } from '@shared/models'

interface AddAccountDialogProps {
  canUseGoogle: boolean
  onAccountCreated: (account: MailAccount) => void
  trigger?: ReactNode | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type ImapForm = typeof DEFAULT_IMAP_FORM
type MailServer = 'imap' | 'smtp'

const DEFAULT_IMAP_FORM = {
  email: '',
  displayName: '',
  username: '',
  password: '',
  imapHost: '',
  imapPort: '993',
  imapSecure: true,
  smtpHost: '',
  smtpPort: '465',
  smtpSecure: true
}

/**
 * The ports each kind of encryption is served on: SSL/TLS from the first
 * byte, or STARTTLS on a plain connection that turns encrypted. Picking one
 * moves a standard port to the other's, and typing a standard port picks
 * its encryption — as Thunderbird does.
 */
const STANDARD_PORTS: Readonly<Record<MailServer, { tls: number; starttls: readonly number[] }>> = {
  imap: { tls: 993, starttls: [143] },
  smtp: { tls: 465, starttls: [587, 25] }
}

const SERVER_FIELDS = {
  imap: { port: 'imapPort', secure: 'imapSecure' },
  smtp: { port: 'smtpPort', secure: 'smtpSecure' }
} as const

function withPort(form: ImapForm, server: MailServer, port: string): ImapForm {
  const fields = SERVER_FIELDS[server]
  const standard = STANDARD_PORTS[server]
  const number = Number(port)
  const secure =
    number === standard.tls
      ? true
      : standard.starttls.includes(number)
        ? false
        : form[fields.secure]

  return { ...form, [fields.port]: port, [fields.secure]: secure }
}

function withEncryption(form: ImapForm, server: MailServer, secure: boolean): ImapForm {
  const fields = SERVER_FIELDS[server]
  const standard = STANDARD_PORTS[server]
  const port = Number(form[fields.port])
  const onStandardPort = port === standard.tls || standard.starttls.includes(port)
  const nextPort = onStandardPort
    ? String(secure ? standard.tls : standard.starttls[0])
    : form[fields.port]

  return { ...form, [fields.port]: nextPort, [fields.secure]: secure }
}

function getErrorMessage(caughtError: unknown, fallback: string): string {
  if (caughtError instanceof Error && caughtError.message.trim()) {
    return caughtError.message
  }

  if (typeof caughtError === 'string' && caughtError.trim()) {
    return caughtError
  }

  return fallback
}

export function AddAccountDialog({
  canUseGoogle,
  onAccountCreated,
  trigger,
  open,
  onOpenChange
}: AddAccountDialogProps): React.JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(canUseGoogle ? 'google' : 'imap')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imapForm, setImapForm] = useState(DEFAULT_IMAP_FORM)
  // The username is the address for nearly every provider, so it follows
  // the email until the user writes a different one.
  const usernameEditedRef = useRef(false)
  const controlledOpen = typeof open === 'boolean'
  const dialogOpen = controlledOpen ? open : internalOpen

  // Closing, however it happens, forgets what was typed — the password
  // above all — and any error.
  const setDialogOpen = (nextOpen: boolean): void => {
    if (!nextOpen) {
      setImapForm(DEFAULT_IMAP_FORM)
      usernameEditedRef.current = false
      setActiveTab(canUseGoogle ? 'google' : 'imap')
      setError(null)
      setPending(false)
    }

    if (!controlledOpen) {
      setInternalOpen(nextOpen)
    }

    onOpenChange?.(nextOpen)
  }

  const canSubmitImap = useMemo(() => {
    return (
      Boolean(imapForm.email.trim()) &&
      Boolean(imapForm.displayName.trim()) &&
      Boolean(imapForm.username.trim()) &&
      Boolean(imapForm.password.trim()) &&
      Boolean(imapForm.imapHost.trim()) &&
      Boolean(imapForm.smtpHost.trim())
    )
  }, [imapForm])

  const closeDialog = (): void => {
    setDialogOpen(false)
  }

  const renderEncryption = (server: MailServer): React.JSX.Element => {
    const secure = imapForm[SERVER_FIELDS[server].secure]

    return (
      <Select
        value={secure ? 'tls' : 'starttls'}
        onValueChange={(value) =>
          setImapForm((current) => withEncryption(current, server, value === 'tls'))
        }
      >
        <SelectTrigger
          aria-label={`Crittografia ${server.toUpperCase()}`}
          className="min-w-0 flex-1"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tls">SSL/TLS</SelectItem>
          <SelectItem value="starttls">STARTTLS</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  const handleGoogleAdd = async (): Promise<void> => {
    setError(null)
    setPending(true)

    try {
      const account = await window.mailApi.addGoogleAccount()
      onAccountCreated(account)
      closeDialog()
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Accesso Google non riuscito.'))
    } finally {
      setPending(false)
    }
  }

  const handleImapAdd = async (): Promise<void> => {
    if (!canSubmitImap) {
      return
    }

    setError(null)
    setPending(true)

    try {
      const account = await window.mailApi.addImapAccount({
        email: imapForm.email.trim(),
        displayName: imapForm.displayName.trim(),
        username: imapForm.username.trim(),
        password: imapForm.password,
        imapHost: imapForm.imapHost.trim(),
        imapPort: Number(imapForm.imapPort),
        imapSecure: imapForm.imapSecure,
        smtpHost: imapForm.smtpHost.trim(),
        smtpPort: Number(imapForm.smtpPort),
        smtpSecure: imapForm.smtpSecure
      })

      onAccountCreated(account)
      closeDialog()
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Connessione IMAP/SMTP non riuscita.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger || (
            <Button className="gap-2" size="sm">
              <Plus className="size-4" />
              Aggiungi account
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="w-[min(720px,calc(100vw-1.5rem))]">
        <DialogHeader>
          <DialogTitle>Aggiungi un account</DialogTitle>
          <DialogDescription>
            La posta resta dov&apos;è: SIEVER Mail la legge e la manda dal server del tuo account.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {canUseGoogle && <TabsTrigger value="google">Gmail</TabsTrigger>}
            <TabsTrigger value="imap">Un&apos;altra casella</TabsTrigger>
          </TabsList>

          {canUseGoogle && (
            <TabsContent value="google" className="flex flex-col items-start gap-3 pt-1">
              <p className="text-muted-foreground max-w-[52ch] text-[12.5px] leading-[1.5]">
                Si apre la pagina di Google: scegli l&apos;account e consenti l&apos;accesso alla
                posta. La password resta a Google, non passa da qui.
              </p>
              {/* `w-fit`, not `w-full`: a single sign-in button stretched
                  across the dialog read as a banner rather than a control. */}
              <Button className="w-fit gap-2" onClick={handleGoogleAdd} disabled={pending}>
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <LogIn className="size-4" />
                )}
                Continua con Google
              </Button>
            </TabsContent>
          )}

          <TabsContent value="imap" className="space-y-3">
            <p className="text-muted-foreground text-[12px] leading-[1.5]">
              Aruba, Register, il server della tua azienda: i dati dei server te li dà chi gestisce
              la tua posta, e spesso sono nella sua pagina di aiuto.
            </p>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  autoComplete="email"
                  value={imapForm.email}
                  onChange={(event) => {
                    const email = event.target.value
                    setImapForm((current) => ({
                      ...current,
                      email,
                      username: usernameEditedRef.current ? current.username : email
                    }))
                  }}
                  placeholder="utente@azienda.com"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="display-name">Nome visualizzato</Label>
                <Input
                  id="display-name"
                  value={imapForm.displayName}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="Mario Rossi"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="username">Nome utente</Label>
                <Input
                  id="username"
                  value={imapForm.username}
                  onChange={(event) => {
                    const username = event.target.value
                    // Emptied, it goes back to following the email.
                    usernameEditedRef.current = username !== ''
                    setImapForm((current) => ({ ...current, username }))
                  }}
                  placeholder="utente@azienda.com"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={imapForm.password}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="••••••••"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="imap-host">Server IMAP</Label>
                <Input
                  id="imap-host"
                  value={imapForm.imapHost}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, imapHost: event.target.value }))
                  }
                  placeholder="imap.azienda.com"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="imap-port">Porta e crittografia IMAP</Label>
                <div className="flex gap-2">
                  <Input
                    id="imap-port"
                    type="number"
                    min={1}
                    max={65535}
                    className="w-24 shrink-0"
                    value={imapForm.imapPort}
                    onChange={(event) =>
                      setImapForm((current) => withPort(current, 'imap', event.target.value))
                    }
                  />
                  {renderEncryption('imap')}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="smtp-host">Server SMTP</Label>
                <Input
                  id="smtp-host"
                  value={imapForm.smtpHost}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, smtpHost: event.target.value }))
                  }
                  placeholder="smtp.azienda.com"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="smtp-port">Porta e crittografia SMTP</Label>
                <div className="flex gap-2">
                  <Input
                    id="smtp-port"
                    type="number"
                    min={1}
                    max={65535}
                    className="w-24 shrink-0"
                    value={imapForm.smtpPort}
                    onChange={(event) =>
                      setImapForm((current) => withPort(current, 'smtp', event.target.value))
                    }
                  />
                  {renderEncryption('smtp')}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button
                className="w-fit gap-2"
                onClick={handleImapAdd}
                disabled={pending || !canSubmitImap}
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Collega la casella
              </Button>
              <p className="text-muted-foreground text-[11.5px]">
                Prova subito i due server; la password resta cifrata su questo computer.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="border-destructive/35 bg-destructive/10 text-destructive-soft-foreground rounded-md border p-3 text-[12px]">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4" />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold">Diagnostica login</p>
                <pre className="mt-1 font-sans text-[11px] leading-relaxed break-words whitespace-pre-wrap">
                  {error}
                </pre>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={closeDialog}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
