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
import { showConnectionRefused } from '@renderer/features/connections/connection-refused'
import { ConnectionsList } from '@renderer/features/connections/connections-list'
import { ActivityThread } from '@renderer/features/segretario/segretario-panel'
import type { SegretarioState } from '@renderer/features/segretario/use-segretario'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
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
  setupTurnsAiOn,
  type ConnectionLearning,
  type EngineState,
  type OnboardingCase,
  type OnboardingState,
  type OnboardingStep,
  type ReadingStatus
} from '@shared/segretario'

/** How often the preparation and the reading are looked at again while the user waits. */
const POLL_MS = 2500

/** Every step a case can have, in order; which apply is decided as the user goes (`applies`). */
const CASE_STEPS: Readonly<Record<OnboardingCase, ReadonlyArray<OnboardingStep>>> = {
  'primo-avvio': ['connessioni', 'segretario', 'preparazione', 'conoscimi', 'lettura', 'entra'],
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

const STEP_LABELS: Readonly<Record<OnboardingStep, string>> = {
  connessioni: 'Connessioni',
  segretario: 'Segretario',
  preparazione: 'Preparazione',
  conoscimi: 'Conoscimi',
  lettura: 'Al passo',
  entra: 'Entra'
}

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

/** A step's frame: its title in the house's voice, what it is for, and its buttons at the bottom. */
function StepFrame({
  title,
  lead,
  children,
  actions
}: {
  title: string
  lead: React.ReactNode
  children?: React.ReactNode
  actions: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="display-title text-[30px] leading-tight">{title}</h1>
        <p className="voice text-muted-foreground text-[16px] leading-[1.5]">{lead}</p>
      </div>
      {children}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-2">{actions}</div>
    </div>
  )
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
  onAccountCreated: (account: MailAccount) => void
  onRemoveMail: (accountId: string, calendars: ReadonlyArray<CalendarConnection>) => void
  onNext: () => void
  /** From inside SIEVER Mail, before anything is added: the user may go back. */
  onCancel: (() => void) | null
}): React.JSX.Element {
  const hasConnection = accounts.length > 0 || calendarConnections.length > 0
  // Opened by itself when there is nothing yet, and when the user came to add one.
  const [adding, setAdding] = useState(!hasConnection || setupCase === 'nuova-connessione')
  // The calendars there when the step opened: one added since is something added here.
  const [calendarsBefore] = useState(() => new Set(calendarConnections.map(({ id }) => id)))
  const calendarAdded = calendarConnections.some(({ id }) => !calendarsBefore.has(id))

  return (
    <StepFrame
      title="Le tue connessioni"
      lead="Collega la posta e i calendari che usi: ogni casella e ogni calendario è una connessione a sé, e presto anche i volumi e i drive dei tuoi file. Ne basta una, di qualunque tipo."
      actions={
        <>
          {onCancel && !calendarAdded && (
            <Button variant="ghost" size="lg" onClick={onCancel}>
              Annulla
            </Button>
          )}
          <Button size="lg" disabled={!hasConnection} onClick={onNext}>
            Continua
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
            onRemoveMail={onRemoveMail}
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
            {hasConnection ? 'Aggiungi una connessione' : 'Collega la prima connessione'}
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
      setProblem(errorText(error) ?? 'Non è andata.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <StepFrame
      title={setupCase === 'ai-riaccesa' ? 'Riaccendi il Segretario' : 'Il Segretario'}
      lead={
        <>
          Il Segretario segue la tua posta e i tuoi calendari mentre cambiano, tiene il conto di
          quello che ti chiedono, di quello che hai promesso e di quello che aspetti, riconosce i
          tuoi progetti, prepara le risposte, gli incontri e la tua giornata. Lavora con un modello
          linguistico che usi con il tuo account OpenRouter: paghi solo quello che fa.
        </>
      }
      actions={
        <>
          {onCancel && (
            <Button variant="ghost" size="lg" disabled={working} onClick={onCancel}>
              Annulla
            </Button>
          )}
          {onSkip && (
            <Button variant="ghost" size="lg" disabled={working} onClick={onSkip}>
              Non ora
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
            Accendi le funzioni AI
          </Button>
        </>
      }
    >
      {exhausted ? (
        <div className="bg-destructive/10 flex flex-col gap-3 rounded-[10px] px-4 py-3 text-[13px]">
          <span className="text-destructive-soft-foreground">
            Il credito OpenRouter è finito, o la chiave ha raggiunto il suo limite di spesa: le
            funzioni AI si possono riaccendere quando c&apos;è di nuovo credito.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void window.mailApi.openExternalUrl(OPENROUTER_CREDITS_URL)}
            >
              <ExternalLink className="size-3.5" />
              Ricarica su OpenRouter
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={working}
              onClick={() =>
                void run(async () => {
                  if ((await window.segretarioApi.checkKey()).keyState === 'exhausted') {
                    throw new Error(
                      'Il credito risulta ancora finito: se hai appena ricaricato, riprova tra qualche istante.'
                    )
                  }
                })
              }
            >
              {working && <LoaderCircle className="size-3.5 animate-spin" />}
              Ho ricaricato, verifica
            </Button>
          </div>
        </div>
      ) : hasKey ? (
        <div className="bg-hover flex items-center gap-2.5 rounded-[10px] px-4 py-3 text-[13px]">
          <Check className="text-status-online size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Chiave OpenRouter collegata{status?.keyLabel ? ` · ${status.keyLabel}` : ''}
            {status?.credit && (
              <span className="text-muted-foreground">
                {' '}
                · credito{' '}
                {status.credit.available.toLocaleString('it-IT', {
                  style: 'currency',
                  currency: 'USD'
                })}
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
              placeholder="sk-or-v1-…"
              aria-label="Chiave OpenRouter"
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
              Verifica
            </Button>
          </div>
          <p className="text-muted-foreground text-[12px]">
            Non hai una chiave? Crea un account su OpenRouter, aggiungi qualche dollaro di credito e
            genera una chiave.{' '}
            <button
              type="button"
              className="text-foreground inline-flex items-center gap-1 underline underline-offset-2"
              onClick={() => void window.mailApi.openExternalUrl(OPENROUTER_KEYS_URL)}
            >
              Apri openrouter.ai
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
 * Where a connection stands in the preparation (§13ter): ready; at work —
 * downloading, reading; waiting for a server that does not answer, or for
 * the network, which it retries by itself; or turned down, which only the
 * user puts right: "Ricollega", or "Togli".
 */
type Preparation =
  | { stage: 'ready' | 'working' | 'waiting'; line: string }
  | { stage: 'refused'; line: string; notice: ConnectionRefusedNotice }

function preparationOf(
  account: MailAccount,
  state: AccountConnectionState | undefined,
  recentMailIndexed: boolean | undefined,
  aiOn: boolean
): Preparation {
  if (state?.refused) {
    return {
      stage: 'refused',
      line: REFUSAL_LINES[state.refused],
      notice: mailRefusedNotice(account, state.refused, state.errorMessage ?? '')
    }
  }

  if (state?.status === 'offline') {
    return { stage: 'waiting', line: 'Senza rete: riprende da sola appena torna.' }
  }

  if (state?.status === 'error') {
    return { stage: 'waiting', line: 'Il server non risponde: riprova da sola.' }
  }

  if (!state || state.status !== 'connected' || state.syncing || !state.index) {
    return {
      stage: 'working',
      line: state?.status === 'reconnecting' ? 'Si ricollega…' : 'Scarico la posta…'
    }
  }

  if (aiOn && !recentMailIndexed) {
    const { total, indexed } = state.index
    return {
      stage: 'working',
      line: `Leggo il testo dei messaggi recenti…${total > 0 ? ` ${Math.round((indexed / total) * 100)}%` : ''}`
    }
  }

  return { stage: 'ready', line: 'Pronta' }
}

/**
 * Where a calendar connection stands in the preparation: read once — even
 * with a calendar of it that could not be, which it says — waiting for its
 * server, or turned down.
 */
function calendarPreparationOf(connection: CalendarConnection): Preparation {
  if (connection.refused) {
    return {
      stage: 'refused',
      line: REFUSAL_LINES[connection.refused],
      notice: calendarRefusedNotice(connection, connection.refused)
    }
  }

  if (connection.lastSyncAt !== null) {
    return { stage: 'ready', line: connection.problem ?? 'Pronto' }
  }

  return connection.problem
    ? { stage: 'waiting', line: `${connection.problem} Riprova da solo.` }
    : { stage: 'working', line: 'Scarico gli eventi…' }
}

/**
 * Step 3: every connection synced — each mailbox, with the AI its recent
 * mail read by the index, and each calendar. A connection that does not
 * work does not go on (§13ter), with or without the AI: the user puts it
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
  const [indexed, setIndexed] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const { confirm, dialog } = useConfirmDialog()
  // As Settings does: asked first, and a removal that fails says so.
  const removeCalendar = async (connection: CalendarConnection): Promise<void> => {
    const confirmed = await confirm({
      title: `Scollegare il calendario di ${connection.label}?`,
      description:
        'I suoi eventi spariscono da SIEVER Mail; nel calendario restano come sono. Puoi ricollegarlo quando vuoi.',
      confirmLabel: 'Scollega',
      destructive: true
    })

    if (confirmed) {
      await window.calendarApi
        .disconnect(connection.id)
        .catch((error: unknown) =>
          toast.error('Il calendario non si è scollegato', { description: errorText(error) })
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
      remove: () => onRemoveAccount(account.id),
      ...preparationOf(account, connections[account.id], indexed.get(account.id), aiOn)
    })),
    ...calendarConnections.map((connection) => ({
      key: `calendar:${connection.id}`,
      name: `${connection.label} · calendari`,
      remove: () => void removeCalendar(connection),
      ...calendarPreparationOf(connection)
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
      title="Preparo le connessioni"
      lead={
        !hasMail
          ? 'Scarico gli eventi di ogni calendario.'
          : aiOn
            ? `Scarico la posta${calendarConnections.length > 0 ? ' e i calendari' : ''} di ogni connessione e leggo il testo dei messaggi recenti: è da lì che il Segretario comincia.`
            : `Scarico la posta${calendarConnections.length > 0 ? ' e i calendari' : ''} di ogni connessione. I messaggi più vecchi continuano ad arrivare mentre lavori.`
      }
      actions={
        <>
          {waiting > 0 && (
            <Button variant="ghost" size="lg" onClick={retryNow}>
              Riprova ora
            </Button>
          )}
          <Button size="lg" disabled={!ready} onClick={onNext}>
            {!ready && refused === 0 && <LoaderCircle className="size-4 animate-spin" />}
            Continua
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
              <span className="block truncate text-[13px] font-semibold">{row.name}</span>
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
                Togli
              </Button>
            )}
            {row.stage === 'refused' && (
              <Button variant="outline" size="sm" onClick={() => showConnectionRefused(row.notice)}>
                Ricollega
              </Button>
            )}
          </div>
        ))}
        {(refused > 0 || waiting > 0) && (
          <p className="text-muted-foreground text-[12px] leading-[1.45]">
            {refused > 0
              ? `${refused === 1 ? 'Una connessione non funziona' : `${refused} connessioni non funzionano`}, e una connessione che non funziona non si collega: ricollega${refused === 1 ? 'la' : 'le'}, o togli${refused === 1 ? 'la' : 'le'} e aggiungi${refused === 1 ? 'la' : 'le'} quando è a posto.`
              : `${waiting === 1 ? 'Un server non risponde' : `${waiting} server non rispondono`}: SIEVER Mail riprova da solo, e si va avanti appena ${waiting === 1 ? 'risponde' : 'rispondono'}. Se non vuoi aspettare, togli la connessione e aggiungila più tardi.`}
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
  const [starting, setStarting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { select } = segretario
  const run = segretario.activities.find((activity) => activity.id === state.conoscimiId) ?? null
  const unknown = (learning ?? []).filter((connection) => connection.state !== 'done')
  // Doing it again is the user's choice when every connection is known: it updates, it does not start over.
  const optional = state.case !== 'conoscimi' && learning !== null && unknown.length === 0
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
      setProblem(errorText(error) ?? 'Conoscimi non è partito.')
    } finally {
      setStarting(false)
    }
  }

  if (!state.conoscimiId) {
    return (
      <StepFrame
        title="Fatti conoscere"
        lead={
          optional
            ? 'Il Segretario ti conosce già. Rifarlo è consigliato: rilegge le tue connessioni e aggiorna quello che sa, senza cancellarlo.'
            : adding
              ? `Il Segretario ti conosce già: ora legge ${unknown.length === 1 ? 'la connessione che non conosce ancora' : 'le connessioni che non conosce ancora'} — ${unknown.map((connection) => connection.label).join(', ')} — e ${unknown.length === 1 ? 'la lega' : 'le lega'} a quello che sa di te, del tuo lavoro e delle persone. Prende appunti che potrai leggere e correggere. Puoi guardarlo mentre lavora.`
              : 'Prima di cominciare, il Segretario legge la tua posta, i calendari e le tue cartelle per capire chi sei, come lavori, con chi e su cosa. Prende appunti che potrai leggere e correggere. Puoi guardarlo mentre lavora.'
        }
        actions={
          <>
            {onCancel && (
              <Button variant="ghost" size="lg" disabled={starting} onClick={onCancel}>
                Annulla
              </Button>
            )}
            {optional && (
              <Button variant="ghost" size="lg" disabled={starting} onClick={onNext}>
                Salta
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
              {optional ? 'Rifallo' : 'Fatti conoscere'}
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
        <h1 className="display-title text-[22px]">Conoscimi</h1>
        <span className="text-muted-foreground text-[12.5px]">
          {done ? 'Fatto' : failed ? 'Interrotto' : 'Al lavoro…'}
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
                  ? 'Conoscimi si è fermato prima della fine: quello che sapeva prima resta.'
                  : 'Conoscimi si è fermato prima della fine. Senza conoscerti il Segretario non comincia: riprova, o continua senza AI e riaccendila quando vuoi.')}
            </span>
            {onCancel ? (
              <Button variant="ghost" size="lg" onClick={onCancel}>
                Chiudi
              </Button>
            ) : (
              <Button variant="ghost" size="lg" onClick={onContinueWithoutAi}>
                Continua senza AI
              </Button>
            )}
            <Button size="lg" disabled={starting} onClick={() => void start()}>
              Riprova
            </Button>
          </>
        ) : (
          !done &&
          waiting && (
            <>
              <span className="text-muted-foreground mr-auto flex items-start gap-2 text-[12.5px]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{waiting} Conoscimi riprende da solo da dove era.</span>
              </span>
              {!onCancel && (
                <Button variant="ghost" size="lg" onClick={onContinueWithoutAi}>
                  Continua senza AI
                </Button>
              )}
            </>
          )
        )}
        {done && (
          <Button size="lg" onClick={onNext}>
            Continua
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

/** "3 minuti", "meno di un minuto": what is left, said plainly. */
function remaining(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000)
  return minutes < 1
    ? 'meno di un minuto'
    : minutes === 1
      ? 'circa un minuto'
      : `circa ${minutes} minuti`
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
      toast.error('Non riesco a riprovare', { description: errorText(error) })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <StepFrame
      title="Il Segretario si mette al passo"
      lead="Legge ogni connessione fin dove ha deciso conoscendoti: i messaggi uno per uno, come se fossero appena arrivati, e gli impegni del calendario. Annota cosa ti chiedono, apre le cose da fare, riconosce i progetti, prepara le risposte che servono."
      actions={
        done && failures > 0 ? (
          <>
            <Button variant="ghost" size="lg" onClick={onContinueWithoutAi}>
              Continua senza AI
            </Button>
            <Button size="lg" disabled={retrying} onClick={() => void retry()}>
              {retrying && <LoaderCircle className="size-4 animate-spin" />}
              Riprova
            </Button>
          </>
        ) : (
          <>
            {!done && waiting && (
              <Button variant="ghost" size="lg" onClick={onContinueWithoutAi}>
                Continua senza AI
              </Button>
            )}
            <Button size="lg" disabled={!done} onClick={onNext}>
              {!done && <LoaderCircle className="size-4 animate-spin" />}
              {done ? 'Continua' : 'Sto leggendo…'}
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
                    ? `Letti ${status.read.toLocaleString('it-IT')} messaggi su ${status.total.toLocaleString('it-IT')}`
                    : null,
                  status.events.total > 0
                    ? `guardati ${status.events.looked.toLocaleString('it-IT')} eventi su ${status.events.total.toLocaleString('it-IT')}`
                    : null
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Niente da leggere'
              : 'Conto i messaggi…'}
          </span>
          {estimate !== null && !done && <span>Manca {remaining(estimate)}</span>}
        </p>
        {status && status.downloading && (
          <p className="text-muted-foreground text-[12.5px]">
            Scarico ancora la posta più vecchia: la leggo man mano che arriva.
          </p>
        )}
        {status && status.horizons.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
            {status.horizons.map((horizon) => (
              <li key={horizon.key} className="flex flex-col">
                <span>
                  <span className="font-semibold">
                    {horizon.kind === 'calendario' ? `Calendario ${horizon.label}` : horizon.label}
                  </span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {horizon.kind === 'calendario'
                      ? `da ${horizon.days} giorni fa ai prossimi due mesi`
                      : `ultimi ${horizon.days} giorni`}
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
              {waiting} Il Segretario riprende da solo da dove era; se il problema resta, puoi
              continuare senza AI.
            </span>
          </p>
        )}
        {status && status.failed.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <p className="text-[12.5px] font-semibold">
              {status.failed.length === 1
                ? 'Una lettura non è riuscita: riprovala, o continua senza AI.'
                : `${status.failed.length} letture non sono riuscite: riprovale, o continua senza AI.`}
            </p>
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
  return (
    <StepFrame
      title="Pronto"
      lead={
        aiOn
          ? 'Il Segretario è al passo: trovi la giornata in Oggi, con le cose da gestire, quelle che aspetti, le risposte pronte e i tuoi progetti. Da qui in poi segue quello che cambia.'
          : 'Le tue app sono pronte. Puoi accendere il Segretario quando vuoi, da Impostazioni › Segretario.'
      }
      actions={
        <Button size="lg" onClick={onEnter}>
          Entra in SIEVER Mail
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
  onAccountCreated: (account: MailAccount) => void
  /** Removes a mail connection and the calendars given, after asking the user. */
  onRemoveAccount: (accountId: string, calendars: ReadonlyArray<CalendarConnection>) => void
  /** The setup moved on: kept, and the engine told. */
  onChange: (state: OnboardingState) => void
  /** Over — finished, or given up before the AI was turned on. */
  onFinish: (entered: boolean) => void
}): React.JSX.Element {
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
  // that does not work is put right or taken away, with or without the AI (§13ter).
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
    <div className="paper flex h-full min-h-0 flex-col overflow-y-auto">
      <div
        className={cn(
          'mx-auto flex w-full max-w-[720px] shrink-0 flex-col gap-8 px-6 py-10',
          watching ? 'h-full' : 'min-h-full'
        )}
      >
        <nav aria-label="Passi" className="flex items-center gap-3">
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
                  {STEP_LABELS[step]}
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
          {state.step === 'connessioni' && (
            <ConnectionsStep
              accounts={accounts}
              calendarConnections={calendarConnections}
              setupCase={state.case}
              mailStates={connections}
              removingAccountId={removingAccountId}
              googleReady={canUseGoogle}
              microsoftReady={canUseMicrosoft}
              onRemoveMail={onRemoveAccount}
              onAccountCreated={(account) => {
                onAccountCreated(account)
                onChange({ ...state, accountIds: [...new Set([...state.accountIds, account.id])] })
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
              accountIds={
                // A connection added with the AI already on: its reading, not the others'.
                state.case === 'nuova-connessione' &&
                !setupTurnsAiOn(state) &&
                state.accountIds.length > 0
                  ? state.accountIds
                  : undefined
              }
              onNext={() => next()}
              onContinueWithoutAi={() => void continueWithoutAi()}
            />
          )}
          {state.step === 'entra' && <EnterStep aiOn={aiOn} onEnter={() => onFinish(true)} />}
        </article>
      </div>
    </div>
  )
}
