import { useEffect, useState, type ReactNode } from 'react'
import { BellRing, ExternalLink, LoaderCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import type { MailAccount, NotificationPreferences, NotificationStatus } from '@shared/models'

const TIME_FORMAT = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

/** Where the icon carrying the unread count sits, as each system calls it. */
function badgeLabel(platform = navigator.platform): string {
  if (/mac/i.test(platform)) {
    return "Numero di messaggi non letti sull'icona nel Dock"
  }

  return /win/i.test(platform)
    ? "Numero di messaggi non letti sull'icona nella barra delle applicazioni"
    : "Numero di messaggi non letti sull'icona dell'app"
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim() ? error.message : undefined
}

function SettingRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange
}: {
  id: string
  title: ReactNode
  description?: ReactNode
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label
      htmlFor={id}
      className="border-border/70 bg-card/45 flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 has-[button:disabled]:cursor-default"
    >
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium">{title}</span>
        {description && (
          <span className="text-muted-foreground block text-[11px]">{description}</span>
        )}
      </span>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </label>
  )
}

/**
 * Impostazioni › Notifiche: whether new mail is announced on the desktop,
 * for which accounts and with how much of it, and the unread count on the
 * app's icon. No system tells beforehand whether it shows the app's
 * notifications, so the page says what became of the last one, sends a
 * test on request, and opens the system's own page where they are allowed.
 */
export function NotificationsSection({
  accounts
}: {
  accounts: ReadonlyArray<MailAccount>
}): React.JSX.Element {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [status, setStatus] = useState<NotificationStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let current = true

    Promise.all([
      window.mailApi.getNotificationPreferences(),
      window.mailApi.getNotificationStatus()
    ])
      .then(([storedPreferences, currentStatus]) => {
        if (current) {
          setPreferences(storedPreferences)
          setStatus(currentStatus)
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setLoadError(errorText(error) ?? 'Impossibile leggere le impostazioni delle notifiche.')
        }
      })

    const unsubscribe = window.mailApi.onNotificationStatusChanged(setStatus)

    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  const update = async (patch: Partial<NotificationPreferences>): Promise<void> => {
    if (!preferences) {
      return
    }

    const previous = preferences
    setPreferences({ ...preferences, ...patch })
    setSaving(true)

    try {
      setPreferences(await window.mailApi.setNotificationPreferences({ ...previous, ...patch }))
    } catch (error) {
      setPreferences(previous)
      toast.error('Impostazione non salvata', { description: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async (): Promise<void> => {
    setTesting(true)

    try {
      setStatus(await window.mailApi.showTestNotification())
    } catch (error) {
      toast.error('Notifica di prova non inviata', { description: errorText(error) })
    } finally {
      setTesting(false)
    }
  }

  const openSystemSettings = (): void => {
    window.mailApi
      .openNotificationSettings()
      .catch((error: unknown) =>
        toast.error('Impostazioni di sistema non aperte', { description: errorText(error) })
      )
  }

  if (loadError) {
    return (
      <div className="text-destructive-soft-foreground border-destructive/35 bg-destructive/10 mt-4 rounded-md border px-3 py-2 text-[12px]">
        {loadError}
      </div>
    )
  }

  if (!preferences || !status) {
    return (
      <div className="text-muted-foreground mt-4 flex items-center gap-2 text-[12px]">
        <LoaderCircle className="size-4 animate-spin" />
        Caricamento delle impostazioni…
      </div>
    )
  }

  const delivery = status.delivery
  const muted = new Set(preferences.mutedAccountIds)

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div className="border-border bg-card/55 flex flex-col gap-3 rounded-md border p-3">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
            Nuova posta
          </p>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Un avviso sul desktop per ogni messaggio non letto che arriva in Posta in arrivo, con i
            pulsanti Segna come letta e Archivia. Un clic lo apre; l&apos;avviso sparisce da solo
            quando il messaggio viene letto, spostato o eliminato, anche da un altro dispositivo.
          </p>
        </div>

        {!status.supported ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-[12px]">
            Questo sistema non mostra notifiche sul desktop.
          </div>
        ) : (
          <>
            <SettingRow
              id="notifications-enabled"
              title="Notifiche sul desktop"
              checked={preferences.enabled}
              disabled={saving}
              onCheckedChange={(enabled) => void update({ enabled })}
            />
            <SettingRow
              id="notifications-preview"
              title="Mostra mittente, oggetto e anteprima"
              description="Senza, l'avviso dice solo che è arrivata posta e per quale account."
              checked={preferences.showPreview}
              disabled={saving || !preferences.enabled}
              onCheckedChange={(showPreview) => void update({ showPreview })}
            />
            <SettingRow
              id="notifications-sound"
              title="Suono"
              checked={preferences.sound}
              disabled={saving || !preferences.enabled}
              onCheckedChange={(sound) => void update({ sound })}
            />

            {accounts.length > 1 && (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground mt-1 text-[11px]">
                  Gli account di cui ricevere gli avvisi:
                </p>
                {accounts.map((account) => (
                  <SettingRow
                    key={account.id}
                    id={`notifications-account-${account.id}`}
                    title={account.displayName || account.email}
                    description={account.email}
                    checked={!muted.has(account.id)}
                    disabled={saving || !preferences.enabled}
                    onCheckedChange={(announced) =>
                      void update({
                        mutedAccountIds: announced
                          ? preferences.mutedAccountIds.filter((id) => id !== account.id)
                          : [...preferences.mutedAccountIds, account.id]
                      })
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {status.supported && (
        <div className="border-border bg-card/55 flex flex-col gap-3 rounded-md border p-3">
          <div>
            <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
              Permesso del sistema
            </p>
            <p className="text-muted-foreground mt-1 text-[11px]">
              È il sistema a decidere se mostrare gli avvisi di SIEVER Mail, e con quale stile. Con
              «Non disturbare» o una modalità Full immersion attiva li trattiene finché non la
              disattivi.
            </p>
          </div>

          {delivery.state === 'failed' ? (
            <div className="text-destructive-soft-foreground border-destructive/35 bg-destructive/10 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                Il sistema non ha mostrato l&apos;ultimo avviso ({TIME_FORMAT.format(delivery.at)}).
                Consenti le notifiche di SIEVER Mail nelle impostazioni di sistema.
                <span className="block text-[11px] opacity-80">{delivery.reason}</span>
              </span>
            </div>
          ) : (
            <p className="text-[12px]">
              {delivery.state === 'shown'
                ? `Ultimo avviso mostrato ${TIME_FORMAT.format(delivery.at)}. Se non l'hai visto, il sistema lo ha trattenuto.`
                : 'Nessun avviso mostrato da quando hai aperto SIEVER Mail.'}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={testing}
              onClick={() => void sendTest()}
            >
              {testing ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <BellRing className="size-3.5" />
              )}
              Invia un avviso di prova
            </Button>
            {status.canOpenSystemSettings && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={openSystemSettings}
              >
                <ExternalLink className="size-3.5" />
                Apri le impostazioni di sistema
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="border-border bg-card/55 flex flex-col gap-3 rounded-md border p-3">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
            Icona dell&apos;app
          </p>
          <p className="text-muted-foreground mt-1 text-[11px]">
            I messaggi non letti in Posta in arrivo, di tutti gli account.
            {/mac/i.test(navigator.platform) &&
              ' Su macOS il numero compare solo se le notifiche di SIEVER Mail sono consentite.'}
          </p>
        </div>
        <SettingRow
          id="notifications-badge"
          title={badgeLabel()}
          checked={preferences.badge}
          disabled={saving}
          onCheckedChange={(badge) => void update({ badge })}
        />
      </div>
    </div>
  )
}
