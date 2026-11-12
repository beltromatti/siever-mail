import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  Clock,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plus,
  Sparkles
} from 'lucide-react'

import { toast } from 'sonner'

import { AddConnection } from '@renderer/features/connections/add-connection'
import { accessOfCalendar, accessOfMail } from '@renderer/features/connections/connection-groups'
import { ConnectionName } from '@renderer/features/connections/connection-name'
import { showConnectionRefused } from '@renderer/features/connections/connection-refused'
import { ConnectionsList } from '@renderer/features/connections/connections-list'
import { ActivityThread } from '@renderer/features/segretario/segretario-panel'
import { LanguageStep } from '@renderer/features/onboarding/language-step'
import { StepFrame } from '@renderer/features/onboarding/step-frame'
import type { SegretarioState } from '@renderer/features/segretario/use-segretario'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { Input } from '@renderer/components/ui/input'
import { messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, type Messages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import { calendarRefusedNotice, type CalendarConnection } from '@shared/calendar'
import {
  mailRefusedNotice,
  REFUSAL_LINES,
  type AccountConnectionState,
  type ConnectionRefusedNotice,
  type MailAccount
} from '@shared/models'
import {
  OPENROUTER_CREDITS_URL,
  OPENROUTER_KEYS_URL,
  setupReadingAccountIds,
  setupTurnsAiOn,
  type ConnectionLearning,
  type EngineState,
  type OnboardingCase,
  type OnboardingState,
  type OnboardingStep,
  type ReadingStatus
} from '@shared/segretario'

import { MESSAGES } from './onboarding-wizard.messages'

/** What an OpenRouter key looks like: the same in every language. */
const KEY_PLACEHOLDER = 'sk-or-v1-…'

/** How often the preparation and the reading are looked at again while the user waits. */
const POLL_MS = 2500

/** Every step a case can have, in order; which apply is decided as the user goes (`applies`). */
const CASE_STEPS: Readonly<Record<OnboardingCase, ReadonlyArray<OnboardingStep>>> = {
  'primo-avvio': [
    'lingua',
    'connessioni',
    'segretario',
    'preparazione',
    'conoscimi',
    'lettura',
    'entra'
  ],
  'nuova-connessione': [
    'connessioni',
    'segretario',
    'preparazione',
    'conoscimi',
    'lettura',
    'entra'
  ],
  'ai-prima-volta': ['segretario', 'preparazione', 'conoscimi', 'lettura', 'entra'],
  'ai-riaccesa': ['segretario', 'preparazione', 'conoscimi', 'lettura', 'entra'],
  conoscimi: ['conoscimi', 'entra']
}

/** A new setup of this case, from its first step. */
export function newOnboarding(
  setupCase: OnboardingCase,
  accountIds: string[] = []
): OnboardingState {
  return {
    case: setupCase,
    step: CASE_STEPS[setupCase][0],
    accountIds,
    conoscimiId: null,
    startedAt: Date.now()
  }
}

const STEP_LABELS = defineMessages({
  lingua: { en: 'Language', it: 'Lingua', de: 'Sprache' },
  connessioni: PLACES.connections,
  segretario: PLACES.segretario,
  preparazione: { en: 'Preparation', it: 'Preparazione', de: 'Vorbereitung' },
  conoscimi: PLACES.conoscimi,
  lettura: PLACES.alPasso,
  entra: { en: 'Enter', it: 'Entra', de: 'Start' }
}) satisfies Record<OnboardingStep, unknown>

/**
 * Whether a step is for this setup: asking for the AI only when it is
 * off — a connection added with it on goes straight to its preparation —
 * Conoscimi only with it on, and the reading with it on and something to
 * read: mail, or a calendar's events.
 */
function applies(
  step: OnboardingStep,
  setupCase: OnboardingCase,
  aiOn: boolean,
  hasReading: boolean
): boolean {
  switch (step) {
    case 'segretario':
      return setupCase !== 'nuova-connessione' || !aiOn
    case 'conoscimi':
      return aiOn
    case 'lettura':
      return aiOn && hasReading
    default:
      return true
  }
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim() ? error.message : undefined
}

/**
 * Step 1: the connections — each mailbox and each calendar on its own, by
 * the access that brought them — and adding more, the way Settings adds them.
 * One of any family is enough.
 */
function ConnectionsStep({
  accounts,
  calendarConnections,
  setupCase,
  mailStates,
  removingAccountId,
  googleReady,
  microsoftReady,
  aiOn,
  connectCalendarOf,
  onConnectCalendarAsked,
  onAccountCreated,
  onRemoveMail,
  onNext,
  onCancel
}: {
  accounts: ReadonlyArray<MailAccount>
  calendarConnections: ReadonlyArray<CalendarConnection>
  setupCase: OnboardingCase
  mailStates: Readonly<Record<string, AccountConnectionState | undefined>>
  removingAccountId: string | null
  googleReady: boolean
  microsoftReady: boolean
  aiOn: boolean
  /** Come to add the calendar of this mailbox: its provider is asked at once. */
  connectCalendarOf: string | null
  onConnectCalendarAsked: () => void
  onAccountCreated: (account: MailAccount) => void
  onRemoveMail: (accountId: string, calendars: ReadonlyArray<CalendarConnection>) => void
  onNext: () => void
  /** From inside SIEVER Mail, before anything is added: the user may go back. */
  onCancel: (() => void) | null
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const hasConnection = accounts.length > 0 || calendarConnections.length > 0
  // Opened by itself when there is nothing yet, and when the user came to add one — not a
  // mailbox's calendar, asked for in the list.
  const [adding, setAdding] = useState(
    !hasConnection || (setupCase === 'nuova-connessione' && connectCalendarOf === null)
  )
  // The calendars there when the step opened: one added since is something added here.
  const [calendarsBefore] = useState(() => new Set(calendarConnections.map(({ id }) => id)))
  const calendarAdded = calendarConnections.some(({ id }) => !calendarsBefore.has(id))

  return (
    <StepFrame
      title={m.connectionsTitle}
      lead={m.connectionsLead}
      actions={
        <>
          {onCancel && !calendarAdded && (
            <Button variant="ghost" size="lg" onClick={onCancel}>
              {m.cancel}
            </Button>
          )}
          <Button size="lg" disabled={!hasConnection} onClick={onNext}>
            {m.continue}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {hasConnection && (
          <ConnectionsList
            accounts={accounts}
            mailStates={mailStates}
            removingAccountId={removingAccountId}
            googleReady={googleReady}
            microsoftReady={microsoftReady}
            aiOn={aiOn}
            onRemoveMail={onRemoveMail}
            connectCalendarOf={connectCalendarOf}
            onConnectCalendarAsked={onConnectCalendarAsked}
          />
        )}
        {adding ? (
          <AddConnection
            googleReady={googleReady}
            microsoftReady={microsoftReady}
            onMailAdded={onAccountCreated}
            onDone={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 flex items-center gap-2.5 rounded-[10px] border border-dashed px-4 py-3 text-left text-[13px] font-medium outline-none focus-visible:ring-2"
          >
            <Plus className="size-4 shrink-0" />
            {hasConnection ? m.addConnection : m.firstConnection}
          </button>
        )}
      </div>
    </StepFrame>
  )
}

/**
 * Step 2: the Segretario — the user's own OpenRouter key, checked, and the
 * AI turned on; or not now, and SIEVER Mail is its apps without it.
 */
function SegretarioStep({
  segretario,
  setupCase,
  onEnable,
  onSkip,
  onCancel
}: {
  segretario: SegretarioState
  setupCase: OnboardingCase
  onEnable: () => Promise<void>
  onSkip: (() => void) | null
  onCancel: (() => void) | null
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { formatLocale } = useLanguage()
  const [key, setKey] = useState('')
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const status = segretario.status
  const hasKey = status !== null && status.keyState !== 'missing' && status.keyState !== 'invalid'
  // The credit gave out: topped up and checked again, the AI can be turned on.
  const exhausted = status?.keyState === 'exhausted'

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setWorking(true)
    setProblem(null)

    try {
      await action()
    } catch (error) {
      setProblem(errorText(error) ?? messagesNow(MESSAGES).failed)
    } finally {
      setWorking(false)
    }
  }

  return (
    <StepFrame
      title={setupCase === 'ai-riaccesa' ? m.segretarioAgain : m.segretarioTitle}
      lead={m.segretarioLead}
      actions={
        <>
          {onCancel && (
            <Button variant="ghost" size="lg" disabled={working} onClick={onCancel}>
              {m.cancel}
            </Button>
          )}
          {onSkip && (
            <Button variant="ghost" size="lg" disabled={working} onClick={onSkip}>
              {m.notNow}
            </Button>
          )}
          <Button
            size="lg"
            disabled={!hasKey || exhausted || working}
            onClick={() => void run(onEnable)}
          >
            {working ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {m.turnOnAi}
          </Button>
        </>
      }
    >
      {exhausted ? (
        <div className="bg-destructive/10 flex flex-col gap-3 rounded-[10px] px-4 py-3 text-[13px]">
          <span className="text-destructive-soft-foreground">{m.creditExhausted}</span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void window.mailApi.openExternalUrl(OPENROUTER_CREDITS_URL)}
            >
              <ExternalLink className="size-3.5" />
              {m.topUp}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={working}
              onClick={() =>
                void run(async () => {
                  if ((await window.segretarioApi.checkKey()).keyState === 'exhausted') {
                    throw new Error(messagesNow(MESSAGES).stillExhausted)
                  }
                })
              }
            >
              {working && <LoaderCircle className="size-3.5 animate-spin" />}
              {m.toppedUp}
            </Button>
          </div>
        </div>
      ) : hasKey ? (
        <div className="bg-hover flex items-center gap-2.5 rounded-[10px] px-4 py-3 text-[13px]">
          <Check className="text-status-online size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {m.keyConnected}
            {status?.keyLabel ? ` · ${status.keyLabel}` : ''}
            {status?.credit && (
              <span className="text-muted-foreground">
                {' · '}
                {m.credit(
                  status.credit.available.toLocaleString(formatLocale, {
                    style: 'currency',
                    currency: 'USD'
                  })
                )}
              </span>
            )}
          </span>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              await window.segretarioApi.saveKey(key)
              await segretario.refreshStatus()
              setKey('')
            })
          }}
        >
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={KEY_PLACEHOLDER}
              aria-label={m.keyLabel}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              className="tabular"
              autoFocus
            />
            <Button type="submit" disabled={!key.trim() || working}>
              {working ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              {m.check}
            </Button>
          </div>
          <p className="text-muted-foreground text-[12px]">
            {m.noKey}{' '}
            <button
              type="button"
              className="text-foreground inline-flex items-center gap-1 underline underline-offset-2"
              onClick={() => void window.mailApi.openExternalUrl(OPENROUTER_KEYS_URL)}
            >
              {m.openOpenRouter}
              <ExternalLink className="size-3" />
            </button>
          </p>
        </form>
      )}
      {(problem ?? (status?.keyState === 'invalid' ? status.problem : null)) && (
        <p className="text-destructive-soft-foreground text-[12.5px]">
          {problem ?? status?.problem}
        </p>
      )}
    </StepFrame>
  )
}

/**
 * Where a connection stands in the preparation (§14): ready; at work —
 * downloading, reading; waiting for a server that does not answer, or for
 * the network, which it retries by itself; or turned down, which only the
 * user puts right: "Ricollega", or "Togli".
 */
type Preparation =
  | { stage: 'ready' | 'working' | 'waiting'; line: string }
  | { stage: 'refused'; line: string; notice: ConnectionRefusedNotice }

function preparationOf(
  m: Messages<typeof MESSAGES>,
  account: MailAccount,
  state: AccountConnectionState | undefined,
  recentMailIndexed: boolean | undefined,
  aiOn: boolean
): Preparation {
  if (state?.refused) {
    return {
      stage: 'refused',
      line: messagesNow(REFUSAL_LINES)[state.refused],
      notice: mailRefusedNotice(account, state.refused, state.errorMessage ?? '')
    }
  }

  if (state?.status === 'offline') {
    return { stage: 'waiting', line: m.offline }
  }

  if (state?.status === 'error') {
    return { stage: 'waiting', line: m.serverDown }
  }

  if (!state || state.status !== 'connected' || state.syncing || !state.index) {
    return {
      stage: 'working',
      line: state?.status === 'reconnecting' ? m.reconnecting : m.downloadingMail
    }
  }

  if (aiOn && !recentMailIndexed) {
    const { total, indexed } = state.index
    return {
      stage: 'working',
      line: m.readingRecent(total > 0 ? Math.round((indexed / total) * 100) : null)
    }
  }

  return { stage: 'ready', line: m.mailboxReady }
}

/**
 * Where a calendar connection stands in the preparation: read once — even
 * with a calendar of it that could not be, which it says — waiting for its
 * server, or turned down.
 */
function calendarPreparationOf(
  m: Messages<typeof MESSAGES>,
  connection: CalendarConnection
): Preparation {
  if (connection.refused) {
    return {
      stage: 'refused',
      line: messagesNow(REFUSAL_LINES)[connection.refused],
      notice: calendarRefusedNotice(connection, connection.refused)
    }
  }

  if (connection.lastSyncAt !== null) {
    return { stage: 'ready', line: connection.problem ?? m.calendarReady }
  }

  return connection.problem
    ? { stage: 'waiting', line: m.retriesAlone(connection.problem) }
    : { stage: 'working', line: m.downloadingEvents }
}

/**
 * Step 3: every connection synced — each mailbox, with the AI its recent
 * mail read by the index, and each calendar. A connection that does not
 * work does not go on (§14), with or without the AI: the user puts it
 * right, waits for its server, or takes it away and adds it again later.
 */
function PreparationStep({
  accounts,
  calendarConnections,
  connections,
  aiOn,
  onRemoveAccount,
  onNext
}: {
  accounts: ReadonlyArray<MailAccount>
  calendarConnections: ReadonlyArray<CalendarConnection>
  connections: Readonly<Record<string, AccountConnectionState>>
  aiOn: boolean
  onRemoveAccount: (accountId: string) => void
  onNext: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [indexed, setIndexed] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const { confirm, dialog } = useConfirmDialog()
  // As Settings does: asked first, and a removal that fails says so.
  const removeCalendar = async (connection: CalendarConnection): Promise<void> => {
    const confirmed = await confirm({
      title: m.disconnectCalendar(connection.label),
      description: m.disconnectCalendarText,
      confirmLabel: m.disconnect,
      destructive: true
    })

    if (confirmed) {
      await window.calendarApi.disconnect(connection.id).catch((error: unknown) =>
        toast.error(messagesNow(MESSAGES).calendarNotDisconnected, {
          description: errorText(error)
        })
      )
    }
  }
  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts])

  useEffect(() => {
    if (!aiOn) {
      return
    }

    let current = true
    const load = (): void =>
      void window.segretarioApi
        .connectionReadiness(accountIds)
        .then(
          (readiness) =>
            current &&
            setIndexed(
              new Map(readiness.map((entry) => [entry.accountId, entry.recentMailIndexed]))
            )
        )
        .catch(() => undefined)

    load()
    const timer = window.setInterval(load, POLL_MS)

    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [accountIds, aiOn])

  const rows = [
    ...accounts.map((account) => ({
      key: `mail:${account.id}`,
      name: account.email,
      provider: accessOfMail(account),
      remove: () => onRemoveAccount(account.id),
      ...preparationOf(m, account, connections[account.id], indexed.get(account.id), aiOn)
    })),
    ...calendarConnections.map((connection) => ({
      key: `calendar:${connection.id}`,
      name: m.calendarsOf(connection.label),
      provider: accessOfCalendar(connection),
      remove: () => void removeCalendar(connection),
      ...calendarPreparationOf(m, connection)
    }))
  ]
  const ready = rows.length > 0 && rows.every((row) => row.stage === 'ready')
  const refused = rows.filter((row) => row.stage === 'refused').length
  const waiting = rows.filter((row) => row.stage === 'waiting').length
  const hasMail = accounts.length > 0
  const retryNow = (): void => {
    void window.mailApi.checkMailNow()
    void window.calendarApi.syncNow().catch(() => undefined)
  }

  return (
    <StepFrame
      title={m.preparationTitle}
      lead={
        !hasMail
          ? m.preparationCalendars
          : aiOn
            ? m.preparationWithAi(calendarConnections.length > 0)
            : m.preparationWithoutAi(calendarConnections.length > 0)
      }
      actions={
        <>
          {waiting > 0 && (
            <Button variant="ghost" size="lg" onClick={retryNow}>
              {m.retryNow}
            </Button>
          )}
          <Button size="lg" disabled={!ready} onClick={onNext}>
            {!ready && refused === 0 && <LoaderCircle className="size-4 animate-spin" />}
            {m.continue}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.key} className="bg-hover flex items-center gap-3 rounded-[10px] px-4 py-3">
            <span className="grid size-4 shrink-0 place-items-center">
              {row.stage === 'ready' ? (
                <Check className="text-status-online size-4" />
              ) : row.stage === 'refused' ? (
                <AlertCircle className="text-destructive size-4" />
              ) : row.stage === 'waiting' ? (
                <Clock className="text-muted-foreground size-4" />
              ) : (
                <LoaderCircle className="text-ai size-4 animate-spin" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <ConnectionName provider={row.provider} className="text-[13px] font-semibold">
                {row.name}
              </ConnectionName>
              <span
                className={cn(
                  'block text-[12px]',
                  row.stage === 'refused'
                    ? 'text-destructive-soft-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {row.line}
              </span>
            </span>
            {(row.stage === 'refused' || row.stage === 'waiting') && (
              <Button variant="ghost" size="sm" onClick={row.remove}>
                {m.remove}
              </Button>
            )}
            {row.stage === 'refused' && (
              <Button variant="outline" size="sm" onClick={() => showConnectionRefused(row.notice)}>
                {m.reconnect}
              </Button>
            )}
          </div>
        ))}
        {(refused > 0 || waiting > 0) && (
          <p className="text-muted-foreground text-[12px] leading-[1.45]">
            {refused > 0 ? m.refusedNote(refused) : m.waitingNote(waiting)}
          </p>
        )}
      </div>
      {dialog}
    </StepFrame>
  )
}

/**
 * Step 4: Conoscimi. The user presses the button — it cannot be skipped
 * the first time — and watches the Segretario read, understand and take
 * notes, in its own words.
 */
function ConoscimiStep({
  segretario,
  state,
  learning,
  onStarted,
  onNext,
  onCancel,
  onContinueWithoutAi
}: {
  segretario: SegretarioState
  state: OnboardingState
  learning: ReadonlyArray<ConnectionLearning> | null
  onStarted: (activityId: string) => void
  onNext: () => void
  /**
   * Asked from Settings, it can be left before it starts — nothing is spent —
   * or after it stops: what was known before stays known.
   */
  onCancel: (() => void) | null
  /** Turning the AI on: where Conoscimi does not finish, the setup ends without the AI. */
  onContinueWithoutAi: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const [starting, setStarting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { select } = segretario
  const run = segretario.activities.find((activity) => activity.id === state.conoscimiId) ?? null
  const unknown = (learning ?? []).filter((connection) => connection.state !== 'done')
  // Every connection known already — the AI on again: it is done all the same, on all of them; it
  // updates what it knows, and where nothing changed it has little to do.
  const again = state.case !== 'conoscimi' && learning !== null && unknown.length === 0
  // Known already, with connections it does not know yet — added, or whose reading failed.
  const adding =
    state.case !== 'conoscimi' &&
    learning !== null &&
    unknown.length > 0 &&
    unknown.length < learning.length
  const failed = run?.status === 'failed' || run?.status === 'cancelled'
  // OpenRouter not answering: Conoscimi waits for it and goes on; the user may not want to wait.
  const waiting = useEngineWaiting()

  useEffect(() => {
    if (state.conoscimiId) {
      select(state.conoscimiId)
    }
  }, [select, state.conoscimiId])

  // Done: the reading starts at once, at the setup's pace — it does not wait for the user to go
  // on to its page (§12.2), which then shows it under way. Conoscimi alone has no reading.
  const finished = run?.status === 'done'

  useEffect(() => {
    if (finished && state.case !== 'conoscimi') {
      void window.segretarioApi.setPreparing(true)
    }
  }, [finished, state.case])

  const start = async (): Promise<void> => {
    setStarting(true)
    setProblem(null)

    try {
      const keys =
        state.case === 'conoscimi' || unknown.length === 0
          ? (learning ?? []).map((connection) => connection.key)
          : unknown.map((connection) => connection.key)
      const activity = await window.segretarioApi.startConoscimi(keys)
      onStarted(activity.id)
    } catch (error) {
      setProblem(
        errorText(error) ?? messagesNow(MESSAGES).conoscimiNotStarted(messagesNow(PLACES).conoscimi)
      )
    } finally {
      setStarting(false)
    }
  }

  if (!state.conoscimiId) {
    return (
      <StepFrame
        title={m.introduce}
        lead={
          again
            ? m.conoscimiAgain
            : adding
              ? m.conoscimiAdding(
                  unknown.length,
                  unknown.map((connection) => connection.label).join(', ')
                )
              : m.conoscimiFirst
        }
        actions={
          <>
            {onCancel && (
              <Button variant="ghost" size="lg" disabled={starting} onClick={onCancel}>
                {m.cancel}
              </Button>
            )}
            <Button
              size="lg"
              variant="seal"
              disabled={starting || learning === null}
              onClick={() => void start()}
            >
              {starting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CompassStar className="size-4" />
              )}
              {m.introduce}
            </Button>
          </>
        }
      >
        {problem && <p className="text-destructive-soft-foreground text-[12.5px]">{problem}</p>}
      </StepFrame>
    )
  }

  // Until its first word reaches the page, the run just started is at work.
  const done = run?.status === 'done'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <CompassStar className="text-ai-star size-5" />
        <h1 className="display-title text-[22px]">{places.conoscimi}</h1>
        <span className="text-muted-foreground text-[12.5px]">
          {done ? m.done : failed ? m.stopped : m.atWork}
        </span>
      </div>
      <div className="sheet flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px]">
        <ActivityThread
          state={segretario}
          onOpen={() => undefined}
          onApprove={() => undefined}
          onOpenDraft={() => undefined}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {failed ? (
          <>
            <span className="text-destructive-soft-foreground mr-auto text-[12.5px]">
              {problem ??
                (onCancel
                  ? m.conoscimiStoppedKept(places.conoscimi)
                  : m.conoscimiStopped(places.conoscimi))}
            </span>
            {onCancel ? (
              <Button variant="ghost" size="lg" onClick={onCancel}>
                {m.close}
              </Button>
            ) : (
              <Button variant="ghost" size="lg" onClick={onContinueWithoutAi}>
                {m.continueWithoutAi}
              </Button>
            )}
            <Button size="lg" disabled={starting} onClick={() => void start()}>
              {m.retry}
            </Button>
          </>
        ) : (
          !done &&
          waiting && (
            <>
              <span className="text-muted-foreground mr-auto flex items-start gap-2 text-[12.5px]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {waiting} {m.conoscimiResumes(places.conoscimi)}
                </span>
              </span>
              {!onCancel && (
                <Button variant="ghost" size="lg" onClick={onContinueWithoutAi}>
                  {m.continueWithoutAi}
                </Button>
              )}
            </>
          )
        )}
        {done && (
          <Button size="lg" onClick={onNext}>
            {m.continue}
          </Button>
        )}
      </div>
    </div>
  )
}

/** What the engine waits for now — OpenRouter not answering — as it says it, or null. */
function useEngineWaiting(): string | null {
  const [waiting, setWaiting] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void window.segretarioApi
      .getEngineState()
      .then((state) => current && setWaiting(state.waiting))
      .catch(() => undefined)
    const unsubscribe = window.segretarioApi.onEngineChanged(
      (state) => current && setWaiting(state.waiting)
    )

    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  return waiting
}

/** "about 3 minutes", "less than a minute": what is left, said plainly. */
function remaining(m: Messages<typeof MESSAGES>, milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000)
  return minutes < 1 ? m.lessThanMinute : minutes === 1 ? m.aboutMinute : m.aboutMinutes(minutes)
}

/**
 * Step 5: the Segretario gets up to date — each connection as far back as
 * Conoscimi decided, the mail message by message as if each had just come,
 * the calendars' events in chunks, many at once: of the connections a setup
 * adds, when it adds some with the AI on already — the rest is read
 * already — else of all. What fails is listed at the end of the bar, to try
 * again — only that — as often as the user wants, or to go on without the
 * AI: nothing passes for read.
 */
function ReadingStep({
  accountIds,
  onNext,
  onContinueWithoutAi
}: {
  accountIds: string[] | undefined
  onNext: () => void
  onContinueWithoutAi: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { formatLocale } = useLanguage()
  const [retrying, setRetrying] = useState(false)
  const [status, setStatus] = useState<ReadingStatus | null>(null)
  const [engine, setEngine] = useState<EngineState | null>(null)
  const started = useRef<{ at: number; read: number } | null>(null)

  // The accounts as a value: a new array of the same ones does not start the watch again.
  const accountKey = accountIds?.join('\u0000') ?? null

  useEffect(() => {
    void window.segretarioApi.setPreparing(true)
    let current = true
    const ofAccounts = accountKey === null ? undefined : accountKey.split('\u0000')
    const load = (): void =>
      void window.segretarioApi
        .getReadingStatus(ofAccounts)
        .then((loaded) => {
          if (!current) {
            return
          }

          started.current ??= { at: Date.now(), read: loaded.read }
          setStatus(loaded)
        })
        .catch(() => undefined)

    load()
    void window.segretarioApi.getEngineState().then((state) => current && setEngine(state))
    const timer = window.setInterval(load, POLL_MS)
    const unsubscribe = window.segretarioApi.onEngineChanged((state) => current && setEngine(state))

    return () => {
      current = false
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [accountKey])

  const all = status ? status.total + status.events.total : 0
  const progress = status && all > 0 ? (status.read + status.events.looked) / all : 0
  const elapsed = started.current ? Date.now() - started.current.at : 0
  const readSince = status && started.current ? status.read - started.current.read : 0
  const estimate =
    status && readSince > 0 && elapsed > 20_000
      ? ((status.total - status.read) * elapsed) / readSince
      : null
  // OpenRouter not answering: the reading waits for it and goes on by itself.
  const waiting = engine?.waiting ?? null
  const done = status?.done ?? false
  const failures = status?.failed.length ?? 0
  const retry = async (): Promise<void> => {
    setRetrying(true)

    try {
      await window.segretarioApi.retryReading(accountIds)
      setStatus(await window.segretarioApi.getReadingStatus(accountIds))
    } catch (error) {
      toast.error(messagesNow(MESSAGES).retryFailed, { description: errorText(error) })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <StepFrame
      title={m.readingTitle}
      lead={m.readingLead}
      actions={
        done && failures > 0 ? (
          <>
            <Button variant="ghost" size="lg" onClick={onContinueWithoutAi}>
              {m.continueWithoutAi}
            </Button>
            <Button size="lg" disabled={retrying} onClick={() => void retry()}>
              {retrying && <LoaderCircle className="size-4 animate-spin" />}
              {m.retry}
            </Button>
          </>
        ) : (
          <>
            {!done && waiting && (
              <Button variant="ghost" size="lg" onClick={onContinueWithoutAi}>
                {m.continueWithoutAi}
              </Button>
            )}
            <Button size="lg" disabled={!done} onClick={onNext}>
              {!done && <LoaderCircle className="size-4 animate-spin" />}
              {done ? m.continue : m.reading}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-2">
        <div className="bg-hover h-2 overflow-hidden rounded-full">
          <div
            className="bg-ai h-full rounded-full transition-[width] duration-700"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <p className="text-muted-foreground flex flex-wrap justify-between gap-2 text-[12.5px]">
          <span>
            {status
              ? [
                  status.total > 0
                    ? m.messagesRead(
                        status.read.toLocaleString(formatLocale),
                        status.total.toLocaleString(formatLocale)
                      )
                    : null,
                  status.events.total > 0
                    ? m.eventsLooked(
                        status.events.looked.toLocaleString(formatLocale),
                        status.events.total.toLocaleString(formatLocale)
                      )
                    : null
                ]
                  .filter(Boolean)
                  .join(' · ') || m.nothingToRead
              : m.counting}
          </span>
          {estimate !== null && !done && <span>{m.left(remaining(m, estimate))}</span>}
        </p>
        {status && status.downloading && (
          <p className="text-muted-foreground text-[12.5px]">{m.stillDownloading}</p>
        )}
        {status && status.horizons.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
            {status.horizons.map((horizon) => (
              <li key={horizon.key} className="flex flex-col">
                <span>
                  <span className="font-semibold">
                    {horizon.kind === 'calendario' ? m.calendarNamed(horizon.label) : horizon.label}
                  </span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {horizon.kind === 'calendario'
                      ? m.calendarHorizon(horizon.days)
                      : m.mailHorizon(horizon.days)}
                  </span>
                </span>
                {horizon.reason && (
                  <span className="text-muted-foreground voice">{horizon.reason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {waiting && (
          <p className="text-muted-foreground flex items-start gap-2 text-[12.5px]">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {waiting} {m.segretarioResumes}
            </span>
          </p>
        )}
        {status && status.failed.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <p className="text-[12.5px] font-semibold">{m.readingsFailed(status.failed.length)}</p>
            <ul className="text-muted-foreground flex flex-col gap-0.5 text-[12px]">
              {status.failed.slice(0, 6).map((failure, index) => (
                <li key={index} className="truncate">
                  {failure.title}
                  {failure.error ? ` — ${failure.error}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </StepFrame>
  )
}

/** The last step: ready, and in. */
function EnterStep({ aiOn, onEnter }: { aiOn: boolean; onEnter: () => void }): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)

  return (
    <StepFrame
      title={m.ready}
      lead={
        aiOn ? m.enterWithAi(places.today) : m.enterWithoutAi(places.settings, places.segretario)
      }
      actions={
        <Button size="lg" onClick={onEnter}>
          {m.enter}
        </Button>
      }
    />
  )
}

/**
 * The guided setup: one screen, used for the first launch, for
 * connections added, for the AI turned on the first time or again, and
 * for Conoscimi done again — each case taking the steps it needs, in
 * order. It is kept as it goes, so a quit brings the user back where they
 * were.
 */
export function OnboardingWizard({
  state,
  accounts,
  calendarConnections,
  connections,
  removingAccountId,
  canUseGoogle,
  canUseMicrosoft,
  segretario,
  aiOn,
  connectCalendarOf = null,
  onConnectCalendarAsked,
  onAccountCreated,
  onRemoveAccount,
  onChange,
  onFinish
}: {
  state: OnboardingState
  accounts: ReadonlyArray<MailAccount>
  calendarConnections: ReadonlyArray<CalendarConnection>
  connections: Readonly<Record<string, AccountConnectionState>>
  removingAccountId: string | null
  canUseGoogle: boolean
  canUseMicrosoft: boolean
  segretario: SegretarioState
  aiOn: boolean
  /**
   * Opened to add the calendar of this mailbox (Settings' «Collega»): its
   * provider is asked at once, at the connections step — a connection of
   * its own, added as every one is (§12.2).
   */
  connectCalendarOf?: string | null
  onConnectCalendarAsked?: () => void
  onAccountCreated: (account: MailAccount) => void
  /** Removes a mail connection and the calendars given, after asking the user. */
  onRemoveAccount: (accountId: string, calendars: ReadonlyArray<CalendarConnection>) => void
  /** The setup moved on: kept, and the engine told. */
  onChange: (state: OnboardingState) => void
  /** Over — finished, or given up before the AI was turned on. */
  onFinish: (entered: boolean) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const stepLabels = useMessages(STEP_LABELS)
  const [learning, setLearning] = useState<ConnectionLearning[] | null>(null)
  // Before the AI is decided on, the way shown is the whole of it.
  const all = CASE_STEPS[state.case]
  const undecided =
    all.includes('segretario') && all.indexOf(state.step) <= all.indexOf('segretario')
  // What to read: a connection added with the AI on already brings its own mail; else any there
  // is — and the calendars, whose events are looked at too.
  const hasReading =
    (state.case === 'nuova-connessione' && aiOn && !setupTurnsAiOn(state)
      ? state.accountIds.length > 0
      : accounts.length > 0) || calendarConnections.length > 0
  const steps = all.filter((step) => applies(step, state.case, aiOn || undecided, hasReading))

  // The connections to know, read again as they come — a mailbox or a calendar added here.
  const connectionIds = [
    ...accounts.map(({ id }) => id),
    ...calendarConnections.map(({ id }) => id)
  ].join('\u0000')

  useEffect(() => {
    let current = true
    void window.segretarioApi.listLearning().then((loaded) => current && setLearning(loaded))
    return () => {
      current = false
    }
  }, [connectionIds, state.conoscimiId])

  /** The next step that applies — `aiOn` as it is now, after this step perhaps turned it on. */
  const next = useCallback(
    (aiOnNow = aiOn, change: Partial<OnboardingState> = {}): void => {
      const all = CASE_STEPS[state.case]
      const following = all
        .slice(all.indexOf(state.step) + 1)
        .find((step) => applies(step, state.case, aiOnNow, hasReading))

      onChange({ ...state, ...change, step: following ?? 'entra' })
    },
    [aiOn, hasReading, onChange, state]
  )

  // The key or the credit gave out while the AI worked here — or was being prepared for — and it
  // went off: the setup goes back to turning it on, which says why; Conoscimi done again from
  // Settings ends.
  const known = segretario.status !== null && segretario.preferences !== null
  const workingWithAi =
    state.step === 'conoscimi' ||
    state.step === 'lettura' ||
    (state.step === 'preparazione' && state.turnsAiOn === true)

  useEffect(() => {
    if (!known || aiOn || !workingWithAi) {
      return
    }

    if (CASE_STEPS[state.case].includes('segretario')) {
      onChange({ ...state, step: 'segretario', conoscimiId: null, turnsAiOn: false })
    } else {
      onFinish(true)
    }
  }, [aiOn, known, onChange, onFinish, state, workingWithAi])

  // Every connection taken away in the preparation: nothing is left to prepare. The setup goes
  // back to adding one; turning the AI on, which has none to add, ends — the app asks for one.
  const nothingToPrepare =
    state.step === 'preparazione' && accounts.length === 0 && calendarConnections.length === 0

  useEffect(() => {
    if (!nothingToPrepare) {
      return
    }

    if (CASE_STEPS[state.case].includes('connessioni')) {
      onChange({ ...state, step: 'connessioni' })
    } else {
      onFinish(true)
    }
  }, [nothingToPrepare, onChange, onFinish, state])

  // Where the Segretario's work does not go — Conoscimi, a reading — the user may end the setup
  // without the AI: it goes off, as in a setup that never turned it on, and nothing is left half
  // known; on again, it starts from what it does not know yet. A connection is not its work: one
  // that does not work is put right or taken away, with or without the AI (§14).
  const continueWithoutAi = async (): Promise<void> => {
    onChange({ ...state, step: 'entra', conoscimiId: null, turnsAiOn: false })
    await window.segretarioApi.setPreferences({ enabled: false })
  }

  // Turned on here, the AI starts with every connection: their reading waits for Conoscimi.
  const enable = async (): Promise<void> => {
    await window.segretarioApi.setPreferences({ enabled: true })
    next(true, { accountIds: [], turnsAiOn: true })
  }

  // Conoscimi is watched as it writes: its page takes the window's height and its thread
  // scrolls inside, following the newest step. Every other step grows with what it holds.
  const watching = state.step === 'conoscimi' && state.conoscimiId !== null

  return (
    <div className="paper flex h-full min-h-0 flex-col">
      {/* The window's handle, as the workspace's title bars: a band of the page, above what
          scrolls, so nothing to click ever passes under it. */}
      <div className="window-drag-region h-[52px] shrink-0" aria-hidden />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            'mx-auto flex w-full max-w-[720px] shrink-0 flex-col gap-8 px-6 pb-10',
            watching ? 'h-full' : 'min-h-full'
          )}
        >
          <nav aria-label={m.steps} className="flex items-center gap-3">
            <CompassStar className="text-ai-star size-5 shrink-0" />
            <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
              {steps.map((step, index) => {
                const position = steps.indexOf(state.step)

                return (
                  <li
                    key={step}
                    className={cn(
                      'flex items-center gap-1.5',
                      index === position
                        ? 'text-foreground font-semibold'
                        : index < position
                          ? 'text-muted-foreground'
                          : 'text-faint-foreground'
                    )}
                  >
                    {index > 0 && <span className="text-faint-foreground">·</span>}
                    {stepLabels[step]}
                  </li>
                )
              })}
            </ol>
          </nav>

          <article
            className={cn(
              'letter flex flex-col rounded-[14px] px-8 py-8 sm:px-12',
              watching ? 'min-h-[420px] flex-1' : 'min-h-[360px] shrink-0'
            )}
          >
            {state.step === 'lingua' && <LanguageStep onNext={() => next()} />}
            {state.step === 'connessioni' && (
              <ConnectionsStep
                accounts={accounts}
                calendarConnections={calendarConnections}
                setupCase={state.case}
                mailStates={connections}
                removingAccountId={removingAccountId}
                googleReady={canUseGoogle}
                microsoftReady={canUseMicrosoft}
                aiOn={aiOn}
                connectCalendarOf={connectCalendarOf}
                onConnectCalendarAsked={() => onConnectCalendarAsked?.()}
                onRemoveMail={onRemoveAccount}
                onAccountCreated={(account) => {
                  onAccountCreated(account)
                  onChange({
                    ...state,
                    accountIds: [...new Set([...state.accountIds, account.id])]
                  })
                }}
                onNext={() => next()}
                onCancel={
                  state.case === 'nuova-connessione' && state.accountIds.length === 0
                    ? () => onFinish(false)
                    : null
                }
              />
            )}
            {state.step === 'segretario' && (
              <SegretarioStep
                segretario={segretario}
                setupCase={state.case}
                onEnable={enable}
                onSkip={
                  state.case === 'primo-avvio' || state.case === 'nuova-connessione'
                    ? () => next(false)
                    : null
                }
                onCancel={
                  state.case === 'ai-prima-volta' || state.case === 'ai-riaccesa'
                    ? () => onFinish(false)
                    : null
                }
              />
            )}
            {state.step === 'preparazione' && (
              <PreparationStep
                accounts={accounts}
                calendarConnections={calendarConnections}
                connections={connections}
                aiOn={aiOn}
                onRemoveAccount={(accountId) => onRemoveAccount(accountId, [])}
                onNext={() => next()}
              />
            )}
            {state.step === 'conoscimi' && (
              <ConoscimiStep
                segretario={segretario}
                state={state}
                learning={learning}
                onStarted={(conoscimiId) => onChange({ ...state, conoscimiId })}
                onNext={() => next()}
                onCancel={state.case === 'conoscimi' ? () => onFinish(true) : null}
                onContinueWithoutAi={() => void continueWithoutAi()}
              />
            )}
            {state.step === 'lettura' && (
              <ReadingStep
                accountIds={setupReadingAccountIds(state)}
                onNext={() => next()}
                onContinueWithoutAi={() => void continueWithoutAi()}
              />
            )}
            {state.step === 'entra' && <EnterStep aiOn={aiOn} onEnter={() => onFinish(true)} />}
          </article>
        </div>
      </div>
    </div>
  )
}
