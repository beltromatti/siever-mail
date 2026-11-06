import { useEffect, useState } from 'react'
import {
  CalendarDays,
  Cloud,
  Files,
  HardDrive,
  Laptop,
  Link2,
  LoaderCircle,
  Mail,
  Network,
  Server,
  type LucideIcon
} from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { useCalendarConnections } from '@renderer/features/calendar/use-calendar'
import { cn } from '@renderer/lib/utils'
import type { CalendarConnection } from '@shared/calendar'
import type { FileSource } from '@shared/files'
import { CONNECTION_FAMILIES } from '@shared/workspace'
import type { AccountConnectionState, MailAccount } from '@shared/models'

import {
  ACCESS_LABELS,
  canAddCalendar,
  canReconnect,
  connectionGroups,
  type AccessKind,
  type ConnectionGroup
} from './connection-groups'

const SYNCED_AT = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

const ACCESS_ICONS: Readonly<Record<AccessKind, LucideIcon>> = {
  google: Mail,
  microsoft: Mail,
  icloud: Cloud,
  imap: Mail,
  caldav: Server,
  ics: Link2
}

/** How a mail connection stands, in a few words. */
function mailStatus(state: AccountConnectionState | undefined): { text: string; problem: boolean } {
  switch (state?.status) {
    case 'connected':
      return { text: state.syncing ? 'Connessa · scarica la posta' : 'Connessa', problem: false }
    case 'connecting':
    case 'reconnecting':
      return { text: 'Si connette…', problem: false }
    case 'offline':
      return { text: 'Senza rete: riprova da sola', problem: false }
    case 'error':
      return {
        text: state.authFailed
          ? 'Il server non accetta più l’accesso: ricollegala'
          : (state.errorMessage ?? 'Non riesce a connettersi'),
        problem: true
      }
    default:
      return { text: 'In attesa', problem: false }
  }
}

function calendarStatus(connection: CalendarConnection): string {
  const count = connection.calendars.length
  const calendars =
    count === 0 ? 'nessun calendario' : count === 1 ? '1 calendario' : `${count} calendari`
  return connection.lastSyncAt
    ? `${calendars} · letti ${SYNCED_AT.format(new Date(connection.lastSyncAt))}`
    : `${calendars} · li legge ora`
}

/**
 * The user's connections, by access: each account, server or link with
 * what it brought — the mail, the calendar — how each stands, and what can
 * be done: add the calendar an account can give, sign one in again whose
 * access failed, take one service away, or the whole access. The same in
 * Settings and in the guided setup.
 */
export function ConnectionsList({
  accounts,
  mailStates,
  removingAccountId,
  googleReady,
  onRemoveMail
}: {
  accounts: ReadonlyArray<MailAccount>
  mailStates: Readonly<Record<string, AccountConnectionState | undefined>>
  removingAccountId: string | null
  googleReady: boolean
  /** Removes a mail connection — and the calendars given — after asking the user. */
  onRemoveMail: (accountId: string, calendars: ReadonlyArray<CalendarConnection>) => void
}): React.JSX.Element {
  const { connections, setConnections } = useCalendarConnections()
  const { confirm, dialog } = useConfirmDialog()
  const [working, setWorking] = useState<string | null>(null)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const groups = connectionGroups(accounts, connections ?? [])

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
        [key]: error instanceof Error ? error.message : 'Non è andata.'
      }))
    } finally {
      setWorking(null)
    }
  }

  const disconnectCalendar = async (
    group: ConnectionGroup,
    calendar: CalendarConnection
  ): Promise<void> => {
    const confirmed = await confirm({
      title: `Scollegare il calendario di ${calendar.label}?`,
      description:
        'I suoi eventi spariscono da SIEVER Mail; nel calendario restano come sono. Puoi ricollegarlo quando vuoi.',
      confirmLabel: 'Scollega',
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
          Nessuna connessione, per ora.
        </p>
      )}
      {groups.map((group) => {
        const Icon = ACCESS_ICONS[group.kind]
        const busy =
          working === group.key || (group.mail !== null && removingAccountId === group.mail.id)
        const status = group.mail ? mailStatus(mailStates[group.mail.id]) : null
        const problem = problems[group.key]

        return (
          <section
            key={group.key}
            aria-label={group.title}
            className="bg-card flex flex-col gap-2 rounded-[10px] border px-4 py-3"
          >
            <header className="flex items-center gap-2.5">
              <Icon className="text-faint-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{group.title}</span>
                <span className="text-muted-foreground block truncate text-[11.5px]">
                  {ACCESS_LABELS[group.kind]}
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
                Scollega
              </Button>
            </header>

            <ul className="flex flex-col gap-1 pl-6.5 text-[12px]">
              {group.mail && status && (
                <li className="flex min-w-0 items-center gap-2">
                  <Mail className="text-faint-foreground size-3.5 shrink-0" />
                  <span className="font-medium">Posta</span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      status.problem ? 'text-destructive-soft-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {status.text}
                  </span>
                </li>
              )}
              {group.calendars.map((calendar) => (
                <li key={calendar.id} className="flex min-w-0 items-center gap-2">
                  <CalendarDays className="text-faint-foreground size-3.5 shrink-0" />
                  <span className="font-medium">Calendario</span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      calendar.problem
                        ? 'text-destructive-soft-foreground'
                        : 'text-muted-foreground'
                    )}
                    title={calendar.problem ?? undefined}
                  >
                    {calendar.problem ?? calendarStatus(calendar)}
                  </span>
                  {canReconnect(calendar) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      disabled={busy || (calendar.provider === 'google' && !googleReady)}
                      onClick={() =>
                        void run(group.key, () =>
                          calendar.provider === 'google'
                            ? window.calendarApi.connectGoogle(calendar.mailAccountId)
                            : window.calendarApi.connectMicrosoft(calendar.mailAccountId)
                        )
                      }
                    >
                      Ricollega
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
                      Togli
                    </Button>
                  )}
                </li>
              ))}
              {canAddCalendar(group) && (
                <li className="flex min-w-0 items-center gap-2">
                  <CalendarDays className="text-faint-foreground size-3.5 shrink-0" />
                  <span className="font-medium">Calendario</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    non collegato
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={busy || !googleReady}
                    onClick={() =>
                      group.mail &&
                      void run(group.key, () => window.calendarApi.connectGoogle(group.mail!.id))
                    }
                  >
                    Collega
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
 * plugged in, the network shares — which the Segretario reads already, and
 * the drives to come.
 */
function FileSourcesCard(): React.JSX.Element {
  const [sources, setSources] = useState<ReadonlyArray<FileSource> | null>(null)
  const drives = CONNECTION_FAMILIES.find((family) => family.id === 'files')?.providers.slice(2)

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
      aria-label="File"
      className="bg-card flex flex-col gap-2 rounded-[10px] border px-4 py-3"
    >
      <header className="flex items-center gap-2.5">
        <Files className="text-faint-foreground size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">File</span>
          <span className="text-muted-foreground block truncate text-[11.5px]">
            Il computer e i volumi collegati, in sola lettura per il Segretario
          </span>
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
                  ? 'le tue cartelle'
                  : source.mounted
                    ? source.kind === 'rete'
                      ? 'volume di rete'
                      : 'volume'
                    : 'volume di rete, non montato ora'}
              </span>
            </li>
          )
        })}
        {drives && drives.length > 0 && (
          <li className="text-muted-foreground flex min-w-0 items-center gap-2">
            <Cloud className="text-faint-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">In arrivo: {drives.join(', ')}</span>
          </li>
        )}
      </ul>
    </section>
  )
}
