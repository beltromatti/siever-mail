import { useEffect, useState } from 'react'
import { BellRing, ExternalLink, LoaderCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import {
  ChoiceRow,
  SettingRow,
  SettingsGroup as Group,
  SettingsLoading,
  SettingsNotice,
  SettingsPage
} from '@renderer/components/ui/settings'
import { useCalendarList } from '@renderer/features/calendar/use-calendar'
import { CALENDAR_ROLES, type CalendarListEntry, type CalendarRole } from '@shared/calendar'
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

/** Whose a calendar's events are (§7.4), as the user chooses it. */
const ROLE_WORDS: Record<CalendarRole, string> = {
  tutti: 'Tutti gli eventi',
  propri: 'Solo i tuoi',
  nessuno: 'Nessuno'
}

const BADGE_WORDS: Record<BadgeCount, string> = {
  work: 'Ciò che ti aspetta oggi',
  unread: 'I messaggi non letti in Posta in arrivo',
  none: 'Nessun numero'
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim() ? error.message : undefined
}

/** Who chose a calendar's role, in words: the user (with the way back), the Segretario, or nobody. */
function RoleChosen({
  calendar,
  aiOn,
  disabled,
  onRestore
}: {
  calendar: CalendarListEntry
  aiOn: boolean
  disabled: boolean
  onRestore: () => void
}): React.JSX.Element {
  const where = `${calendar.connection}${calendar.primary ? ' · il principale' : ''}${calendar.hidden ? ' · nascosto nel Calendario' : ''}`

  if (calendar.roleBy === 'utente') {
    return (
      <>
        {where} · scelto da te ·{' '}
        <button
          type="button"
          className="hover:text-foreground underline underline-offset-2 disabled:no-underline"
          disabled={disabled}
          onClick={onRestore}
        >
          {aiOn ? 'lascia decidere al Segretario' : 'torna a com’era'}
        </button>
      </>
    )
  }

  if (calendar.roleBy === 'segretario') {
    return (
      <>
        {where} · deciso dal Segretario
        {calendar.roleReason ? `: ${calendar.roleReason}` : ''}
      </>
    )
  }

  return <>{where}</>
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
  const { calendars, setCalendars } = useCalendarList()

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

  const setRole = async (key: string, role: CalendarRole | null): Promise<void> => {
    setSaving(true)

    try {
      setCalendars(await window.calendarApi.setCalendarRole(key, role))
    } catch (error) {
      toast.error('Impostazione non salvata', { description: errorText(error) })
    } finally {
      setSaving(false)
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
      <SettingsPage>
        <SettingsNotice tone="error">{loadError}</SettingsNotice>
      </SettingsPage>
    )
  }

  if (!preferences || !status) {
    return <SettingsLoading>Caricamento delle impostazioni…</SettingsLoading>
  }

  const delivery = status.delivery
  const muted = new Set(preferences.mail.mutedAccountIds)
  const off = saving || !preferences.enabled

  return (
    <SettingsPage>
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

      {calendars && calendars.length > 0 && (
        <Group title="Calendario">
          {status.supported && (
            <>
              <SettingRow
                id="notifications-reminders"
                title="Promemoria"
                description="Prima dei tuoi eventi, ai tempi che ognuno ha nel suo calendario. Mai per un invito che hai rifiutato."
                checked={preferences.calendar.reminders}
                disabled={off}
                onCheckedChange={(reminders) =>
                  void update((current) => ({
                    ...current,
                    calendar: { ...current.calendar, reminders }
                  }))
                }
              />
              <ChoiceRow
                title="Agli eventi senza un promemoria loro"
                description="Non a quelli di tutto il giorno, come i compleanni."
                value={String(preferences.calendar.defaultLead)}
                options={REMINDER_LEADS.map(String)}
                words={(lead) => leadWords(lead === 'null' ? null : Number(lead))}
                label="Promemoria predefinito"
                disabled={off || !preferences.calendar.reminders}
                onChange={(lead) =>
                  void update((current) => ({
                    ...current,
                    calendar: {
                      ...current.calendar,
                      defaultLead: lead === 'null' ? null : Number(lead)
                    }
                  }))
                }
              />
              <SettingRow
                id="notifications-calendar-changes"
                title="Inviti e cambiamenti"
                description="Un evento tuo che ha in mano qualcun altro: un invito, uno spostato o annullato da chi lo organizza, uno messo nel tuo calendario da un altro. Ciò che arriva anche per posta te lo dice la posta."
                checked={preferences.calendar.changes}
                disabled={off}
                onCheckedChange={(changes) =>
                  void update((current) => ({
                    ...current,
                    calendar: { ...current.calendar, changes }
                  }))
                }
              />
              {aiOn && (
                <SettingRow
                  id="notifications-calendar-flagged"
                  title="Solo ciò che il Segretario ti segnala"
                  description="Mentre guarda il calendario, ti avvisa solo dei cambiamenti che devi sapere adesso, dicendoti perché. Se non li ha guardati entro dieci minuti, arrivano come sono."
                  checked={preferences.calendar.onlyFlagged}
                  disabled={off || !preferences.calendar.changes}
                  onCheckedChange={(onlyFlagged) =>
                    void update((current) => ({
                      ...current,
                      calendar: { ...current.calendar, onlyFlagged }
                    }))
                  }
                />
              )}
            </>
          )}

          {(calendars.length > 1 || calendars.some((calendar) => !calendar.primary)) && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground mt-1 text-[11px]">
                Quali eventi sono tuoi: ti ricordano, te ne arrivano le novità
                {aiOn ? ' e Oggi li mostra nella tua giornata' : ''}. In un calendario condiviso o
                di altri, «solo i tuoi» sono quelli a cui sei invitato, che organizzi o che hai
                creato tu
                {aiOn ? ', e quelli che il Segretario riconosce tuoi' : ''}.
              </p>
              {calendars.map((calendar) => (
                <ChoiceRow
                  key={calendar.key}
                  title={
                    <span className="flex min-w-0 items-center gap-2">
                      {calendar.color && (
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          // The calendar's own colour, as its provider gives it.
                          style={{ backgroundColor: calendar.color }}
                        />
                      )}
                      <span className="truncate">{calendar.name}</span>
                    </span>
                  }
                  description={
                    <RoleChosen
                      calendar={calendar}
                      aiOn={aiOn}
                      disabled={saving}
                      onRestore={() => void setRole(calendar.key, null)}
                    />
                  }
                  value={calendar.role}
                  options={CALENDAR_ROLES}
                  words={(role) => ROLE_WORDS[role]}
                  label={`Quali eventi di ${calendar.name} sono tuoi`}
                  width="w-40"
                  disabled={saving}
                  onChange={(role) => void setRole(calendar.key, role)}
                />
              ))}
            </div>
          )}
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
          <ChoiceRow
            title="Che cosa conta"
            description="Ciò che ti aspetta oggi: le cose aperte che toccano a te, in scadenza oggi o già scadute."
            value={preferences.badge}
            options={Object.keys(BADGE_WORDS) as BadgeCount[]}
            words={(badge) => BADGE_WORDS[badge]}
            label="Il numero sull'icona"
            width="w-60"
            disabled={saving}
            onChange={(badge) => void update((current) => ({ ...current, badge }))}
          />
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
    </SettingsPage>
  )
}
