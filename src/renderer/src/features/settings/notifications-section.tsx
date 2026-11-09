import { useEffect, useState, type ReactNode } from 'react'
import { BellRing, ExternalLink, LoaderCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { useCalendarConnections } from '@renderer/features/calendar/use-calendar'
import type { MailAccount } from '@shared/models'
import {
  REMINDER_LEADS,
  type BadgeCount,
  type NotificationPreferences,
  type NotificationStatus
} from '@shared/notifications'

const TIME_FORMAT = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

/** Where the icon carrying the count sits, as each system calls it. */
function iconPlace(platform = navigator.platform): string {
  if (/mac/i.test(platform)) {
    return "sull'icona nel Dock"
  }

  return /win/i.test(platform) ? "sull'icona nella barra delle applicazioni" : "sull'icona dell'app"
}

function leadWords(lead: number | null): string {
  if (lead === null) {
    return 'Nessun promemoria'
  }

  if (lead === 0) {
    return "All'inizio"
  }

  return lead === 60 ? '1 ora prima' : `${lead} minuti prima`
}

const BADGE_WORDS: Record<BadgeCount, string> = {
  work: 'Ciò che ti aspetta oggi',
  unread: 'I messaggi non letti in Posta in arrivo',
  none: 'Nessun numero'
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
      className="bg-hover flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 has-[button:disabled]:cursor-default"
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

function Group({
  title,
  description,
  children
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-group flex flex-col gap-3">
      <div>
        <p className="eyebrow">{title}</p>
        {description && <p className="text-muted-foreground mt-1 text-[11px]">{description}</p>}
      </div>
      {children}
    </div>
  )
}

/**
 * Impostazioni › Notifiche (vision §13.3): SIEVER Mail's own — the switch
 * of them all, their content, their sound — then each app's, in the order
 * of the rail: the Segretario's (with the AI), the mail's, the calendar's;
 * what the system does with them; and the number on the app's icon. No
 * system tells beforehand whether it shows the app's notifications, so the
 * page says what became of the last one, sends a test on request, and
 * opens the system's own page where they are allowed.
 */
export function NotificationsSection({
  accounts,
  aiOn
}: {
  accounts: ReadonlyArray<MailAccount>
  aiOn: boolean
}): React.JSX.Element {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [status, setStatus] = useState<NotificationStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const { connections: calendars } = useCalendarConnections()

  useEffect(() => {
    let current = true

    Promise.all([window.notificationsApi.getPreferences(), window.notificationsApi.getStatus()])
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

    const unsubscribe = window.notificationsApi.onStatusChanged(setStatus)

    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  const update = async (
    change: (current: NotificationPreferences) => NotificationPreferences
  ): Promise<void> => {
    if (!preferences) {
      return
    }

    const previous = preferences
    const next = change(previous)
    setPreferences(next)
    setSaving(true)

    try {
      setPreferences(await window.notificationsApi.setPreferences(next))
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
      setStatus(await window.notificationsApi.showTest())
    } catch (error) {
      toast.error('Notifica di prova non inviata', { description: errorText(error) })
    } finally {
      setTesting(false)
    }
  }

  const openSystemSettings = (): void => {
    window.notificationsApi
      .openSystemSettings()
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
  const muted = new Set(preferences.mail.mutedAccountIds)
  const off = saving || !preferences.enabled

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <Group
        title="SIEVER Mail"
        description="Una notifica interrompe ciò che stai facendo: arriva solo quando saperlo adesso, e non alla prossima occhiata, cambia ciò che fai. Il resto ti aspetta dove lo trovi."
      >
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
              onCheckedChange={(enabled) => void update((current) => ({ ...current, enabled }))}
            />
            <SettingRow
              id="notifications-preview"
              title="Mostra il contenuto"
              description={`Chi scrive, l'oggetto, il titolo degli eventi${aiOn ? ', le parole del Segretario' : ''}. Senza, dicono solo che cosa è arrivato.`}
              checked={preferences.showPreview}
              disabled={off}
              onCheckedChange={(showPreview) =>
                void update((current) => ({ ...current, showPreview }))
              }
            />
            <SettingRow
              id="notifications-sound"
              title="Suono"
              checked={preferences.sound}
              disabled={off}
              onCheckedChange={(sound) => void update((current) => ({ ...current, sound }))}
            />
            <p className="text-muted-foreground text-[11px]">
              Gli avvisi di SIEVER Mail{aiOn ? ' — le funzioni AI spente, ' : ' — '}una connessione
              ferma, un messaggio che non è partito — arrivano sempre quando non sei davanti alla
              finestra: senza di te non si rimettono a posto.
            </p>
          </>
        )}
      </Group>

      {status.supported && aiOn && (
        <Group title="Segretario">
          <SettingRow
            id="notifications-needs-you"
            title="Quando ti serve"
            description="Quando aspetta una tua conferma, o ha finito ciò che gli hai chiesto mentre eri altrove."
            checked={preferences.segretario.needsYou}
            disabled={off}
            onCheckedChange={(needsYou) =>
              void update((current) => ({
                ...current,
                segretario: { ...current.segretario, needsYou }
              }))
            }
          />
          <SettingRow
            id="notifications-day"
            title="La tua giornata"
            description="Al mattino, la prima volta che è pronta: com'è la giornata, senza aprire SIEVER Mail."
            checked={preferences.segretario.day}
            disabled={off}
            onCheckedChange={(day) =>
              void update((current) => ({ ...current, segretario: { ...current.segretario, day } }))
            }
          />
        </Group>
      )}

      {status.supported && accounts.length > 0 && (
        <Group title="Posta">
          <SettingRow
            id="notifications-mail"
            title="Posta nuova"
            description="I messaggi non letti che arrivano in Posta in arrivo, con Segna come letta e Archivia. Spariscono da soli quando li leggi, anche da un altro dispositivo."
            checked={preferences.mail.enabled}
            disabled={off}
            onCheckedChange={(enabled) =>
              void update((current) => ({ ...current, mail: { ...current.mail, enabled } }))
            }
          />
          {aiOn && (
            <SettingRow
              id="notifications-flagged"
              title="Solo ciò che il Segretario ti segnala"
              description="Mentre legge la posta, ti avvisa solo dei messaggi che devi sapere adesso, dicendoti cosa vogliono. Gli altri li trovi nella posta, senza interruzioni."
              checked={preferences.mail.onlyFlagged}
              disabled={off || !preferences.mail.enabled}
              onCheckedChange={(onlyFlagged) =>
                void update((current) => ({ ...current, mail: { ...current.mail, onlyFlagged } }))
              }
            />
          )}

          {accounts.length > 1 && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground mt-1 text-[11px]">Le caselle di cui avvisarti:</p>
              {accounts.map((account) => (
                <SettingRow
                  key={account.id}
                  id={`notifications-account-${account.id}`}
                  title={account.displayName || account.email}
                  description={account.email}
                  checked={!muted.has(account.id)}
                  disabled={off || !preferences.mail.enabled}
                  onCheckedChange={(told) =>
                    void update((current) => ({
                      ...current,
                      mail: {
                        ...current.mail,
                        mutedAccountIds: told
                          ? current.mail.mutedAccountIds.filter((id) => id !== account.id)
                          : [...current.mail.mutedAccountIds, account.id]
                      }
                    }))
                  }
                />
              ))}
            </div>
          )}
        </Group>
      )}

      {status.supported && Boolean(calendars?.length) && (
        <Group title="Calendario">
          <SettingRow
            id="notifications-reminders"
            title="Promemoria degli eventi"
            description="Ai promemoria che ogni evento ha nel suo calendario. Il tuo rifiuto a un invito li toglie."
            checked={preferences.calendar.reminders}
            disabled={off}
            onCheckedChange={(reminders) =>
              void update((current) => ({
                ...current,
                calendar: { ...current.calendar, reminders }
              }))
            }
          />
          <div className="bg-hover flex items-center justify-between gap-3 rounded-md px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">
                Agli eventi senza un promemoria loro
              </span>
              <span className="text-muted-foreground block text-[11px]">
                Non a quelli di tutto il giorno, come i compleanni.
              </span>
            </span>
            <Select
              value={String(preferences.calendar.defaultLead)}
              onValueChange={(value) =>
                void update((current) => ({
                  ...current,
                  calendar: {
                    ...current.calendar,
                    defaultLead: value === 'null' ? null : Number(value)
                  }
                }))
              }
              disabled={off || !preferences.calendar.reminders}
            >
              <SelectTrigger className="w-45 shrink-0" aria-label="Promemoria predefinito">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_LEADS.map((lead) => (
                  <SelectItem key={String(lead)} value={String(lead)}>
                    {leadWords(lead)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SettingRow
            id="notifications-calendar-changes"
            title="Inviti e cambiamenti decisi da altri"
            description={`Un invito, un evento spostato o annullato che non ti arriva anche per posta${aiOn ? ': con il Segretario, solo quelli che devi sapere adesso' : ''}.`}
            checked={preferences.calendar.changes}
            disabled={off}
            onCheckedChange={(changes) =>
              void update((current) => ({ ...current, calendar: { ...current.calendar, changes } }))
            }
          />
        </Group>
      )}

      {status.supported && (
        <Group
          title="Permesso del sistema"
          description="È il sistema a decidere se mostrare le notifiche di SIEVER Mail, e con quale stile. Con «Non disturbare» o una modalità Full immersion attiva le trattiene finché non la disattivi."
        >
          {delivery.state === 'failed' ? (
            <div className="text-destructive-soft-foreground border-destructive/35 bg-destructive/10 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                Il sistema non ha mostrato l&apos;ultima notifica ({TIME_FORMAT.format(delivery.at)}
                ). Consenti le notifiche di SIEVER Mail nelle impostazioni di sistema.
                <span className="block text-[11px] opacity-80">{delivery.reason}</span>
              </span>
            </div>
          ) : (
            <p className="text-[12px]">
              {delivery.state === 'shown'
                ? `Ultima notifica mostrata ${TIME_FORMAT.format(delivery.at)}. Se non l'hai vista, il sistema l'ha trattenuta.`
                : 'Nessuna notifica mostrata da quando hai aperto SIEVER Mail.'}
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
              Invia una notifica di prova
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
        </Group>
      )}

      <Group
        title="Icona dell'app"
        description={`Il numero ${iconPlace()}${/mac/i.test(navigator.platform) ? ': su macOS compare solo se le notifiche di SIEVER Mail sono consentite' : ''}.`}
      >
        {aiOn ? (
          <div className="bg-hover flex items-center justify-between gap-3 rounded-md px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Che cosa conta</span>
              <span className="text-muted-foreground block text-[11px]">
                Ciò che ti aspetta oggi: le cose aperte che toccano a te, in scadenza oggi o già
                scadute.
              </span>
            </span>
            <Select
              value={preferences.badge}
              onValueChange={(badge) =>
                void update((current) => ({ ...current, badge: badge as BadgeCount }))
              }
              disabled={saving}
            >
              <SelectTrigger className="w-60 shrink-0" aria-label="Il numero sull'icona">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BADGE_WORDS) as BadgeCount[]).map((badge) => (
                  <SelectItem key={badge} value={badge}>
                    {BADGE_WORDS[badge]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <SettingRow
            id="notifications-badge"
            title="I messaggi non letti in Posta in arrivo"
            description="Di tutte le caselle."
            checked={preferences.badge !== 'none'}
            disabled={saving}
            onCheckedChange={(shown) =>
              void update((current) => ({ ...current, badge: shown ? 'work' : 'none' }))
            }
          />
        )}
      </Group>
    </div>
  )
}
