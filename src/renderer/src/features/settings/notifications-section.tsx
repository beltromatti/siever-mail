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
import { accessOfMail } from '@renderer/features/connections/connection-groups'
import { ConnectionName } from '@renderer/features/connections/connection-name'
import { hourStyle, languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { CALENDAR_ROLES, type CalendarListEntry, type CalendarRole } from '@shared/calendar'
import type { Messages } from '@shared/i18n'
import type { MailAccount } from '@shared/models'
import {
  REMINDER_LEADS,
  type BadgeCount,
  type NotificationPreferences,
  type NotificationStatus
} from '@shared/notifications'
import { PLACES } from '@shared/places'

import { BADGE_WORDS, MESSAGES, ROLE_WORDS } from './notifications-section.messages'

/** When a notification was shown: the day and the time, as the region writes them. */
function timeWords(at: number): string {
  return new Intl.DateTimeFormat(languageNow().formatLocale, {
    day: 'numeric',
    month: 'short',
    hour: hourStyle(),
    minute: '2-digit'
  }).format(at)
}

/** Where the icon carrying the count sits, as each system calls it. */
function iconPlace(m: Messages<typeof MESSAGES>, platform = navigator.platform): string {
  if (/mac/i.test(platform)) {
    return m.onDockIcon
  }

  return /win/i.test(platform) ? m.onTaskbarIcon : m.onAppIcon
}

function leadWords(m: Messages<typeof MESSAGES>, lead: number | null): string {
  if (lead === null) {
    return m.noReminder
  }

  if (lead === 0) {
    return m.atStart
  }

  return lead === 60 ? m.hourBefore : m.minutesBefore(lead)
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
  const m = useMessages(MESSAGES)
  const where = `${calendar.connection}${calendar.primary ? ` · ${m.principal}` : ''}${calendar.hidden ? ` · ${m.hiddenInCalendar}` : ''}`

  if (calendar.roleBy === 'utente') {
    return (
      <>
        {where} · {m.chosenByYou} ·{' '}
        <button
          type="button"
          className="hover:text-foreground underline underline-offset-2 disabled:no-underline"
          disabled={disabled}
          onClick={onRestore}
        >
          {aiOn ? m.letSegretarioDecide : m.restore}
        </button>
      </>
    )
  }

  if (calendar.roleBy === 'segretario') {
    return (
      <>
        {where} · {m.decidedBySegretario}
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
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const roles = useMessages(ROLE_WORDS)
  const badges = useMessages(BADGE_WORDS)
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
          setLoadError(errorText(error) ?? messagesNow(MESSAGES).unreadable)
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
      toast.error(messagesNow(MESSAGES).notSaved, { description: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async (): Promise<void> => {
    setTesting(true)

    try {
      setStatus(await window.notificationsApi.showTest())
    } catch (error) {
      toast.error(messagesNow(MESSAGES).testNotSent, { description: errorText(error) })
    } finally {
      setTesting(false)
    }
  }

  const setRole = async (key: string, role: CalendarRole | null): Promise<void> => {
    setSaving(true)

    try {
      setCalendars(await window.calendarApi.setCalendarRole(key, role))
    } catch (error) {
      toast.error(messagesNow(MESSAGES).notSaved, { description: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  const openSystemSettings = (): void => {
    window.notificationsApi.openSystemSettings().catch((error: unknown) =>
      toast.error(messagesNow(MESSAGES).systemSettingsNotOpened, {
        description: errorText(error)
      })
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
    return <SettingsLoading>{m.loading}</SettingsLoading>
  }

  const delivery = status.delivery
  const muted = new Set(preferences.mail.mutedAccountIds)
  const off = saving || !preferences.enabled

  return (
    <SettingsPage>
      <Group title="SIEVER Mail" description={m.appText}>
        {!status.supported ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-[12px]">
            {m.unsupported}
          </div>
        ) : (
          <>
            <SettingRow
              id="notifications-enabled"
              title={m.desktop}
              checked={preferences.enabled}
              disabled={saving}
              onCheckedChange={(enabled) => void update((current) => ({ ...current, enabled }))}
            />
            <SettingRow
              id="notifications-preview"
              title={m.preview}
              description={m.previewText(aiOn)}
              checked={preferences.showPreview}
              disabled={off}
              onCheckedChange={(showPreview) =>
                void update((current) => ({ ...current, showPreview }))
              }
            />
            <SettingRow
              id="notifications-sound"
              title={m.sound}
              checked={preferences.sound}
              disabled={off}
              onCheckedChange={(sound) => void update((current) => ({ ...current, sound }))}
            />
            <p className="text-muted-foreground text-[11px]">{m.alertsText(aiOn)}</p>
          </>
        )}
      </Group>

      {status.supported && aiOn && (
        <Group title={places.segretario}>
          <SettingRow
            id="notifications-needs-you"
            title={m.needsYou}
            description={m.needsYouText}
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
            title={m.day}
            description={m.dayText}
            checked={preferences.segretario.day}
            disabled={off}
            onCheckedChange={(day) =>
              void update((current) => ({ ...current, segretario: { ...current.segretario, day } }))
            }
          />
        </Group>
      )}

      {status.supported && accounts.length > 0 && (
        <Group title={places.mail}>
          <SettingRow
            id="notifications-mail"
            title={m.newMail}
            description={m.newMailText}
            checked={preferences.mail.enabled}
            disabled={off}
            onCheckedChange={(enabled) =>
              void update((current) => ({ ...current, mail: { ...current.mail, enabled } }))
            }
          />
          {aiOn && (
            <SettingRow
              id="notifications-flagged"
              title={m.onlyFlagged}
              description={m.onlyFlaggedMailText}
              checked={preferences.mail.onlyFlagged}
              disabled={off || !preferences.mail.enabled}
              onCheckedChange={(onlyFlagged) =>
                void update((current) => ({ ...current, mail: { ...current.mail, onlyFlagged } }))
              }
            />
          )}

          {accounts.length > 1 && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground mt-1 text-[11px]">{m.mailboxes}</p>
              {accounts.map((account) => (
                <SettingRow
                  key={account.id}
                  id={`notifications-account-${account.id}`}
                  title={
                    <ConnectionName provider={accessOfMail(account)}>
                      {account.displayName || account.email}
                    </ConnectionName>
                  }
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
        <Group title={places.calendar}>
          {status.supported && (
            <>
              <SettingRow
                id="notifications-reminders"
                title={m.reminders}
                description={m.remindersText}
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
                title={m.defaultLead}
                description={m.defaultLeadText}
                value={String(preferences.calendar.defaultLead)}
                options={REMINDER_LEADS.map(String)}
                words={(lead) => leadWords(m, lead === 'null' ? null : Number(lead))}
                label={m.defaultLeadLabel}
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
                title={m.changes}
                description={m.changesText}
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
                  title={m.onlyFlagged}
                  description={m.onlyFlaggedCalendarText}
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
                {m.whoseText(aiOn, places.today)}
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
                  words={(role) => roles[role]}
                  label={m.whoseLabel(calendar.name)}
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
        <Group title={m.permission} description={m.permissionText}>
          {delivery.state === 'failed' ? (
            <div className="text-destructive-soft-foreground border-destructive/35 bg-destructive/10 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                {m.deliveryFailed(timeWords(delivery.at))}
                <span className="block text-[11px] opacity-80">{delivery.reason}</span>
              </span>
            </div>
          ) : (
            <p className="text-[12px]">
              {delivery.state === 'shown'
                ? m.deliveryShown(timeWords(delivery.at))
                : m.deliveryNone}
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
              {m.sendTest}
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
                {m.openSystemSettings}
              </Button>
            )}
          </div>
        </Group>
      )}

      <Group
        title={m.appIcon}
        description={m.appIconText(iconPlace(m), /mac/i.test(navigator.platform))}
      >
        {aiOn ? (
          <ChoiceRow
            title={m.counts}
            description={m.countsText}
            value={preferences.badge}
            options={Object.keys(BADGE_WORDS) as BadgeCount[]}
            words={(badge) => badges[badge]}
            label={m.countsLabel}
            width="w-60"
            disabled={saving}
            onChange={(badge) => void update((current) => ({ ...current, badge }))}
          />
        ) : (
          <SettingRow
            id="notifications-badge"
            title={badges.unread}
            description={m.allMailboxes}
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
