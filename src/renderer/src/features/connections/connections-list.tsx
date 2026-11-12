import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  Cloud,
  Files,
  HardDrive,
  Laptop,
  LoaderCircle,
  Mail,
  Network
} from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { PROVIDER_NAMES, ProviderLogo } from '@renderer/components/ui/provider-logo'
import { useCalendarConnections } from '@renderer/features/calendar/use-calendar'
import { calendarStanding, mailStanding } from '@renderer/features/connections/connection-health'
import { showConnectionRefused } from '@renderer/features/connections/connection-refused'
import { HealthDot } from '@renderer/features/connections/health-dot'
import { messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { calendarRefusedNotice, type CalendarConnection } from '@shared/calendar'
import type { FileSource } from '@shared/files'
import { defineMessages, localized } from '@shared/i18n'
import { PLACES } from '@shared/places'
import { CONNECTION_FAMILIES } from '@shared/workspace'
import { mailRefusedNotice, type AccountConnectionState, type MailAccount } from '@shared/models'

import {
  canAddCalendar,
  canRenewConsent,
  connectionGroups,
  type ConnectionGroup
} from './connection-groups'
import { removalWords } from './connection-removal'

const MESSAGES = defineMessages({
  failed: { en: 'It didn’t work.', it: 'Non è andata.', de: 'Das hat nicht geklappt.' },
  disconnectCalendar: {
    en: (label: string) => `Disconnect the calendar of ${label}?`,
    it: (label: string) => `Scollegare il calendario di ${label}?`,
    de: (label: string) => `Kalender von ${label} trennen?`
  },
  disconnect: { en: 'Disconnect', it: 'Scollega', de: 'Trennen' },
  none: {
    en: 'No connections yet.',
    it: 'Nessuna connessione, per ora.',
    de: 'Noch keine Verbindungen.'
  },
  reconnect: { en: 'Reconnect', it: 'Ricollega', de: 'Erneut verbinden' },
  remove: { en: 'Remove', it: 'Togli', de: 'Entfernen' },
  notConnected: { en: 'not connected', it: 'non collegato', de: 'nicht verbunden' },
  connect: { en: 'Connect', it: 'Collega', de: 'Verbinden' },
  filesLine: {
    en: 'The computer and connected volumes, read-only',
    it: 'Il computer e i volumi collegati, in sola lettura',
    de: 'Der Computer und angeschlossene Laufwerke, nur lesend'
  },
  yourFolders: { en: 'your folders', it: 'le tue cartelle', de: 'Ihre Ordner' },
  networkVolume: { en: 'network volume', it: 'volume di rete', de: 'Netzlaufwerk' },
  volume: { en: 'volume', it: 'volume', de: 'Laufwerk' },
  notMounted: {
    en: 'network volume, not mounted now',
    it: 'volume di rete, non montato ora',
    de: 'Netzlaufwerk, derzeit nicht eingebunden'
  },
  comingSoon: {
    en: (drives: string) => `Coming soon: ${drives}`,
    it: (drives: string) => `In arrivo: ${drives}`,
    de: (drives: string) => `Demnächst: ${drives}`
  }
})

/**
 * The user's connections, by access: each account, server or link with
 * what it brought — the mail, the calendar — how each stands, and what can
 * be done: add the calendar an account can give, sign one in again whose
 * access failed, take one service away, or the whole access. The same in
 * Settings and in the guided setup; a calendar an account can give is a
 * connection of its own (§11.1), so outside the setup it is added through
 * it (`onAddCalendar`, §12.2).
 */
export function ConnectionsList({
  accounts,
  mailStates,
  removingAccountId,
  googleReady,
  microsoftReady,
  aiOn,
  onRemoveMail,
  onAddCalendar,
  connectCalendarOf,
  onConnectCalendarAsked
}: {
  accounts: ReadonlyArray<MailAccount>
  mailStates: Readonly<Record<string, AccountConnectionState | undefined>>
  removingAccountId: string | null
  googleReady: boolean
  microsoftReady: boolean
  /** With the AI on, removing says what becomes of the Segretario's work. */
  aiOn: boolean
  /** Removes a mail connection — and the calendars given — after asking the user. */
  onRemoveMail: (accountId: string, calendars: ReadonlyArray<CalendarConnection>) => void
  /** Outside the setup: adding the calendar of a mailbox opens the setup for it. */
  onAddCalendar?: (mailAccountId: string) => void
  /** The setup opened to add the calendar of this mailbox: asked for at once. */
  connectCalendarOf?: string | null
  onConnectCalendarAsked?: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const accessLabels = useMessages(PROVIDER_NAMES)
  const { connections, setConnections } = useCalendarConnections()
  const { confirm, dialog } = useConfirmDialog()
  const [working, setWorking] = useState<string | null>(null)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const groups = connectionGroups(accounts, connections ?? [])
  const providerReady = (group: ConnectionGroup): boolean =>
    group.kind === 'microsoft' ? microsoftReady : googleReady

  const run = async (key: string, action: () => Promise<CalendarConnection[]>): Promise<void> => {
    setWorking(key)
    setProblems((current) =>
      Object.fromEntries(Object.entries(current).filter(([at]) => at !== key))
    )

    try {
      setConnections(await action())
    } catch (error) {
      setProblems((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : messagesNow(MESSAGES).failed
      }))
    } finally {
      setWorking(null)
    }
  }

  /** The calendar a Google or Microsoft account can give, asked of its provider for that mailbox. */
  const connectCalendar = (group: ConnectionGroup): void => {
    const mail = group.mail

    if (!mail) {
      return
    }

    if (onAddCalendar) {
      onAddCalendar(mail.id)
      return
    }

    void run(group.key, () =>
      group.kind === 'microsoft'
        ? window.calendarApi.connectMicrosoft(mail.id)
        : window.calendarApi.connectGoogle(mail.id)
    )
  }

  // Come to the setup for a mailbox's calendar: its provider is asked once the list knows it.
  const asked = connectCalendarOf
    ? groups.find((group) => group.mail?.id === connectCalendarOf && canAddCalendar(group))
    : undefined

  const askedOnce = useRef(false)

  useEffect(() => {
    // Once, when the mailbox to connect is known: not again as the list changes.
    if (!askedOnce.current && asked && connections !== null) {
      askedOnce.current = true
      onConnectCalendarAsked?.()
      connectCalendar(asked)
    }
  })

  const disconnectCalendar = async (
    group: ConnectionGroup,
    calendar: CalendarConnection
  ): Promise<void> => {
    const confirmed = await confirm({
      title: messagesNow(MESSAGES).disconnectCalendar(calendar.label),
      ...removalWords({ family: 'calendario', aiOn }),
      confirmLabel: messagesNow(MESSAGES).disconnect,
      destructive: true
    })

    if (confirmed) {
      await run(group.key, () => window.calendarApi.disconnect(calendar.id))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.length === 0 && (
        <p className="text-muted-foreground rounded-[10px] border border-dashed px-4 py-3 text-[12.5px]">
          {m.none}
        </p>
      )}
      {groups.map((group) => {
        const busy =
          working === group.key || (group.mail !== null && removingAccountId === group.mail.id)
        const mail = group.mail
        const mailState = mail ? mailStates[mail.id] : undefined
        const refused = mailState?.refused
        const status = mail ? mailStanding(mail, mailState) : null
        const problem = problems[group.key]

        return (
          <section
            key={group.key}
            aria-label={group.title}
            className="bg-card flex flex-col gap-2 rounded-[10px] border px-4 py-3"
          >
            <header className="flex items-center gap-2.5">
              <ProviderLogo provider={group.kind} className="size-4" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{group.title}</span>
                <span className="text-muted-foreground block truncate text-[11.5px]">
                  {accessLabels[group.kind]}
                  {group.mail && group.mail.displayName !== group.mail.email
                    ? ` · ${group.mail.displayName}`
                    : ''}
                </span>
              </span>
              {busy && <LoaderCircle className="text-faint-foreground size-4 animate-spin" />}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive h-7 text-[11.5px]"
                disabled={busy}
                onClick={() => {
                  if (group.mail) {
                    onRemoveMail(group.mail.id, group.calendars)
                  } else if (group.calendars[0]) {
                    void disconnectCalendar(group, group.calendars[0])
                  }
                }}
              >
                {m.disconnect}
              </Button>
            </header>

            <ul className="flex flex-col gap-1 pl-6.5 text-[12px]">
              {group.mail && status && (
                <li className="flex min-w-0 items-center gap-2">
                  <Mail className="text-faint-foreground size-3.5 shrink-0" />
                  <span className="font-medium">{places.mail}</span>
                  <HealthDot health={status.health} className="size-[6px]" />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      status.health === 'attention'
                        ? 'text-destructive-soft-foreground'
                        : 'text-muted-foreground'
                    )}
                    title={status.text}
                  >
                    {status.text}
                  </span>
                  {mail && refused && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      disabled={busy}
                      onClick={() =>
                        showConnectionRefused(
                          mailRefusedNotice(mail, refused, mailState?.errorMessage ?? '')
                        )
                      }
                    >
                      {m.reconnect}
                    </Button>
                  )}
                </li>
              )}
              {group.calendars.map((calendar) => {
                const standing = calendarStanding(calendar)
                return (
                  <li key={calendar.id} className="flex min-w-0 items-center gap-2">
                    <CalendarDays className="text-faint-foreground size-3.5 shrink-0" />
                    <span className="font-medium">{places.calendar}</span>
                    <HealthDot health={standing.health} className="size-[6px]" />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        standing.health === 'attention'
                          ? 'text-destructive-soft-foreground'
                          : 'text-muted-foreground'
                      )}
                      title={standing.text}
                    >
                      {standing.text}
                    </span>
                    {(calendar.refused || canRenewConsent(calendar)) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        disabled={busy || (calendar.provider === 'google' && !googleReady)}
                        onClick={() =>
                          calendar.refused
                            ? showConnectionRefused(
                                calendarRefusedNotice(calendar, calendar.refused)
                              )
                            : void run(group.key, () => window.calendarApi.reconnect(calendar.id))
                        }
                      >
                        {m.reconnect}
                      </Button>
                    )}
                    {group.mail && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground h-6 px-2 text-[11px]"
                        disabled={busy}
                        onClick={() => void disconnectCalendar(group, calendar)}
                      >
                        {m.remove}
                      </Button>
                    )}
                  </li>
                )
              })}
              {canAddCalendar(group) && (
                <li className="flex min-w-0 items-center gap-2">
                  <CalendarDays className="text-faint-foreground size-3.5 shrink-0" />
                  <span className="font-medium">{places.calendar}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {m.notConnected}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={busy || !providerReady(group)}
                    onClick={() => connectCalendar(group)}
                  >
                    {m.connect}
                  </Button>
                </li>
              )}
            </ul>
            {problem && (
              <p className="text-destructive-soft-foreground pl-6.5 text-[11.5px]">{problem}</p>
            )}
          </section>
        )
      })}
      <FileSourcesCard />
      {dialog}
    </div>
  )
}

/**
 * The File family: what the computer holds — the user's folders, the disks
 * plugged in, the network shares — read, never written, and the drives to
 * come. Said without the Segretario, who may be off.
 */
function FileSourcesCard(): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const [sources, setSources] = useState<ReadonlyArray<FileSource> | null>(null)
  const { language } = useLanguage()
  const drives = CONNECTION_FAMILIES.find((family) => family.id === 'files')
    ?.providers.slice(2)
    .map((drive) => localized(drive, language))

  useEffect(() => {
    let current = true
    void window.filesApi
      .sources()
      .then((found) => current && setSources(found))
      .catch(() => current && setSources([]))
    return () => {
      current = false
    }
  }, [])

  return (
    <section
      aria-label={places.files}
      className="bg-card flex flex-col gap-2 rounded-[10px] border px-4 py-3"
    >
      <header className="flex items-center gap-2.5">
        <Files className="text-faint-foreground size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{places.files}</span>
          <span className="text-muted-foreground block truncate text-[11.5px]">{m.filesLine}</span>
        </span>
      </header>
      <ul className="flex flex-col gap-1 pl-6.5 text-[12px]">
        {(sources ?? []).map((source) => {
          const Icon =
            source.kind === 'computer' ? Laptop : source.kind === 'rete' ? Network : HardDrive
          return (
            <li key={source.path} className="flex min-w-0 items-center gap-2">
              <Icon className="text-faint-foreground size-3.5 shrink-0" />
              <span className="font-medium">{source.label}</span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate" title={source.path}>
                {source.kind === 'computer'
                  ? m.yourFolders
                  : source.mounted
                    ? source.kind === 'rete'
                      ? m.networkVolume
                      : m.volume
                    : m.notMounted}
              </span>
            </li>
          )
        })}
        {drives && drives.length > 0 && (
          <li className="text-muted-foreground flex min-w-0 items-center gap-2">
            <Cloud className="text-faint-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{m.comingSoon(drives.join(', '))}</span>
          </li>
        )}
      </ul>
    </section>
  )
}
