import { type ReactNode, useMemo, useState } from 'react'

import { AlertCircle, Check, LoaderCircle, LogIn, Mail, Plus } from 'lucide-react'

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import type { MailAccount } from '@shared/models'

interface AddAccountDialogProps {
  canUseGoogle: boolean
  onAccountCreated: (account: MailAccount) => void
  trigger?: ReactNode | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

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
  const controlledOpen = typeof open === 'boolean'
  const dialogOpen = controlledOpen ? open : internalOpen

  const setDialogOpen = (nextOpen: boolean): void => {
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
    setError(null)
    setPending(false)
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
            <Button className="gap-2 rounded-lg text-sm" size="lg">
              <Plus className="size-4" />
              Aggiungi Account
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="w-[min(880px,calc(100vw-1.5rem))]">
        <DialogHeader>
          <DialogTitle>Collega un account email</DialogTitle>
          <DialogDescription>
            Gmail con OAuth Google oppure server IMAP/SMTP aziendale con connessione sicura.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {canUseGoogle && <TabsTrigger value="google">Google</TabsTrigger>}
            <TabsTrigger value="imap">IMAP / SMTP</TabsTrigger>
          </TabsList>

          {canUseGoogle && (
            <TabsContent value="google" className="space-y-4">
              <div className="border-border bg-card/60 rounded-lg border p-6">
                <div className="space-y-2">
                  <h3 className="display-title text-2xl">Accedi con Google</h3>
                  <p className="text-muted-foreground text-sm">
                    Login sicuro OAuth 2.0. L&apos;account Gmail verrà sincronizzato con cartelle,
                    invio e gestione messaggi.
                  </p>
                </div>

                <Button
                  className="mt-6 w-full gap-2"
                  size="lg"
                  onClick={handleGoogleAdd}
                  disabled={pending}
                >
                  {pending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <LogIn className="size-4" />
                  )}
                  Continua con Google
                </Button>
              </div>
            </TabsContent>
          )}

          <TabsContent value="imap" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  autoComplete="email"
                  value={imapForm.email}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="utente@azienda.com"
                />
              </div>

              <div className="space-y-2">
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

              <div className="space-y-2">
                <Label htmlFor="username">Username IMAP/SMTP</Label>
                <Input
                  id="username"
                  value={imapForm.username}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, username: event.target.value }))
                  }
                  placeholder="utente@azienda.com"
                />
              </div>

              <div className="space-y-2">
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

              <div className="space-y-2">
                <Label htmlFor="imap-host">IMAP Host</Label>
                <Input
                  id="imap-host"
                  value={imapForm.imapHost}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, imapHost: event.target.value }))
                  }
                  placeholder="imap.azienda.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="imap-port">IMAP Port</Label>
                <Input
                  id="imap-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={imapForm.imapPort}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, imapPort: event.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp-host">SMTP Host</Label>
                <Input
                  id="smtp-host"
                  value={imapForm.smtpHost}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, smtpHost: event.target.value }))
                  }
                  placeholder="smtp.azienda.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp-port">SMTP Port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={imapForm.smtpPort}
                  onChange={(event) =>
                    setImapForm((current) => ({ ...current, smtpPort: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="border-border bg-muted/30 text-muted-foreground flex items-center gap-3 rounded-md border p-3 text-xs">
              <Mail className="size-4" />
              Il client effettua subito verifica IMAP + SMTP sicura e salva le credenziali in
              storage cifrato locale.
            </div>

            <Button
              className="w-full gap-2"
              size="lg"
              onClick={handleImapAdd}
              disabled={pending || !canSubmitImap}
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Collega Account IMAP
            </Button>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="border-destructive/35 bg-destructive/10 text-destructive-foreground rounded-md border p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Diagnostica login</p>
                <pre className="mt-1 font-sans text-xs leading-relaxed break-words whitespace-pre-wrap">
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
