import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plus,
  Sparkles
} from 'lucide-react'

import { AddConnection } from '@renderer/features/connections/add-connection'
import { ConnectionsList } from '@renderer/features/connections/connections-list'
import { ActivityThread } from '@renderer/features/segretario/segretario-panel'
import type { SegretarioState } from '@renderer/features/segretario/use-segretario'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import type { CalendarConnection } from '@shared/calendar'
import type { AccountConnectionState, MailAccount } from '@shared/models'
import type {
  ConnectionLearning,
  EngineState,
  OnboardingCase,
  OnboardingState,
  OnboardingStep,
  ReadingStatus
} from '@shared/segretario'

const KEYS_URL = 'https://openrouter.ai/settings/keys'
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
  lettura: 'La posta',
  entra: 'Entra'
}

/**
 * Whether a step is for this setup: asking for the AI only when it is
 * off — a connection added with it on goes straight to its preparation —
 * and Conoscimi and the reading only with it on.
 */
function applies(step: OnboardingStep, setupCase: OnboardingCase, aiOn: boolean): boolean {
  switch (step) {
    case 'segretario':
      return setupCase !== 'nuova-connessione' || !aiOn
    case 'conoscimi':
    case 'lettura':
      return aiOn
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
 */
function ConnectionsStep({
  accounts,
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
  mailStates: Readonly<Record<string, AccountConnectionState | undefined>>
  removingAccountId: string | null
  googleReady: boolean
  microsoftReady: boolean
  onAccountCreated: (account: MailAccount) => void
  onRemoveMail: (accountId: string, calendars: ReadonlyArray<CalendarConnection>) => void
  onNext: () => void
  /** Nothing added yet, from inside SIEVER Mail: the user may go back. */
  onCancel: (() => void) | null
}): React.JSX.Element {
  // Opened by itself the first time, when there is nothing yet.
  const [adding, setAdding] = useState(accounts.length === 0)

  return (
    <StepFrame
      title="Le tue connessioni"
      lead="Collega la posta che usi, e i calendari: ogni casella e ogni calendario è una connessione a sé. Ne serve almeno una di posta."
      actions={
        <>
          {onCancel && (
            <Button variant="ghost" size="lg" onClick={onCancel}>
              Annulla
            </Button>
          )}
          <Button size="lg" disabled={accounts.length === 0} onClick={onNext}>
            Continua
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {accounts.length > 0 && (
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
            {accounts.length === 0 ? 'Collega la tua posta' : 'Aggiungi una connessione'}
          </button>
        )}
      </div>
    </StepFrame>
  )
}

/**
 * Step 2: the Segretario — the user's own OpenRouter key, checked, and the
 * AI turned on; or not now, and SIEVER Mail is a mail and calendar client.
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
          Il Segretario legge la tua posta mentre arriva, tiene il conto di quello che ti chiedono,
          di quello che hai promesso e di quello che aspetti, riconosce i tuoi progetti, prepara le
          risposte e la tua giornata. Lavora con un modello linguistico che usi con il tuo account
          OpenRouter: paghi solo quello che fa.
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
          <Button size="lg" disabled={!hasKey || working} onClick={() => void run(onEnable)}>
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
      {hasKey ? (
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
              onClick={() => void window.mailApi.openExternalUrl(KEYS_URL)}
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

/** Where a connection stands in the preparation, in words, and whether it is ready. */
function preparationOf(
  state: AccountConnectionState | undefined,
  recentMailIndexed: boolean | undefined,
  aiOn: boolean
): { ready: boolean; failed: boolean; line: string } {
  if (state?.status === 'error' || state?.authFailed) {
    return {
      ready: false,
      failed: true,
      line: state.errorMessage
        ? `Non riesco a collegarmi: ${state.errorMessage}`
        : 'Non riesco a collegarmi.'
    }
  }

  if (!state || state.status === 'connecting' || state.syncing || !state.index) {
    return { ready: false, failed: false, line: 'Scarico la posta…' }
  }

  if (aiOn && !recentMailIndexed) {
    const { total, indexed } = state.index
    return {
      ready: false,
      failed: false,
      line: `Leggo il testo dei messaggi recenti…${total > 0 ? ` ${Math.round((indexed / total) * 100)}%` : ''}`
    }
  }

  return { ready: true, failed: false, line: 'Pronta' }
}

/** Step 3: every connection synced — and, with the AI, its recent mail read by the index. */
function PreparationStep({
  accounts,
  connections,
  aiOn,
  onRemoveAccount,
  onNext
}: {
  accounts: ReadonlyArray<MailAccount>
  connections: Readonly<Record<string, AccountConnectionState>>
  aiOn: boolean
  onRemoveAccount: (accountId: string) => void
  onNext: () => void
}): React.JSX.Element {
  const [indexed, setIndexed] = useState<ReadonlyMap<string, boolean>>(() => new Map())
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

  const rows = accounts.map((account) => ({
    account,
    ...preparationOf(connections[account.id], indexed.get(account.id), aiOn)
  }))
  const ready = rows.length > 0 && rows.every((row) => row.ready)

  return (
    <StepFrame
      title="Preparo la posta"
      lead={
        aiOn
          ? 'Scarico la posta di ogni connessione e leggo il testo dei messaggi recenti: è da lì che il Segretario comincia.'
          : 'Scarico la posta di ogni connessione. Il resto dei messaggi più vecchi continua ad arrivare mentre lavori.'
      }
      actions={
        <Button size="lg" disabled={!ready} onClick={onNext}>
          {!ready && <LoaderCircle className="size-4 animate-spin" />}
          Continua
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        {rows.map(({ account, ready: rowReady, failed, line }) => (
          <div
            key={account.id}
            className="bg-hover flex items-center gap-3 rounded-[10px] px-4 py-3"
          >
            <span className="grid size-4 shrink-0 place-items-center">
              {rowReady ? (
                <Check className="text-status-online size-4" />
              ) : failed ? (
                <AlertCircle className="text-destructive size-4" />
              ) : (
                <LoaderCircle className="text-ai size-4 animate-spin" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{account.email}</span>
              <span
                className={cn(
                  'block text-[12px]',
                  failed ? 'text-destructive-soft-foreground' : 'text-muted-foreground'
                )}
              >
                {line}
              </span>
            </span>
            {failed && (
              <Button variant="ghost" size="sm" onClick={() => onRemoveAccount(account.id)}>
                Togli
              </Button>
            )}
          </div>
        ))}
      </div>
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
  onNext
}: {
  segretario: SegretarioState
  state: OnboardingState
  learning: ReadonlyArray<ConnectionLearning> | null
  onStarted: (activityId: string) => void
  onNext: () => void
}): React.JSX.Element {
  const [starting, setStarting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { select } = segretario
  const run = segretario.activities.find((activity) => activity.id === state.conoscimiId) ?? null
  const unknown = (learning ?? []).filter((connection) => connection.state !== 'done')
  // Doing it again is the user's choice when every connection is known: it updates, it does not start over.
  const optional = state.case !== 'conoscimi' && learning !== null && unknown.length === 0
  const failed = run?.status === 'failed' || run?.status === 'cancelled'

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
            : 'Prima di cominciare, il Segretario legge la tua posta, i calendari e le tue cartelle per capire chi sei, come lavori, con chi e su cosa. Prende appunti che potrai leggere e correggere. Puoi guardarlo mentre lavora.'
        }
        actions={
          <>
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
        {failed && (
          <>
            <span className="text-destructive-soft-foreground mr-auto text-[12.5px]">
              {problem ?? 'Conoscimi si è fermato prima della fine.'}
            </span>
            <Button variant="ghost" size="lg" onClick={onNext}>
              Continua senza
            </Button>
            <Button size="lg" disabled={starting} onClick={() => void start()}>
              Riprova
            </Button>
          </>
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
 * Step 5: the Segretario's mail — the last thirty days read as if each
 * message had just come, many at once. What fails is listed and tried
 * again later: the user enters anyway, nothing passes for read.
 */
function ReadingStep({ onNext }: { onNext: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<ReadingStatus | null>(null)
  const [engine, setEngine] = useState<EngineState | null>(null)
  const started = useRef<{ at: number; read: number } | null>(null)

  useEffect(() => {
    void window.segretarioApi.setPreparing(true)
    let current = true
    const load = (): void =>
      void window.segretarioApi
        .getReadingStatus()
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
  }, [])

  const progress = status && status.total > 0 ? status.read / status.total : 0
  const elapsed = started.current ? Date.now() - started.current.at : 0
  const readSince = status && started.current ? status.read - started.current.read : 0
  const estimate =
    status && readSince > 0 && elapsed > 20_000
      ? ((status.total - status.read) * elapsed) / readSince
      : null
  const paused = engine?.paused ?? null
  const done = status?.done ?? false

  return (
    <StepFrame
      title="Il Segretario legge la tua posta"
      lead="Legge i messaggi degli ultimi trenta giorni, uno per uno, come se fossero appena arrivati: annota cosa ti chiedono, apre le cose da fare, riconosce i progetti, prepara le risposte che servono."
      actions={
        <Button size="lg" disabled={!done && !paused} onClick={onNext}>
          {!done && !paused && <LoaderCircle className="size-4 animate-spin" />}
          {done ? 'Continua' : paused ? 'Entra comunque' : 'Sto leggendo…'}
        </Button>
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
              ? `Letti ${status.read.toLocaleString('it-IT')} messaggi su ${status.total.toLocaleString('it-IT')}`
              : 'Conto i messaggi…'}
          </span>
          {estimate !== null && !done && <span>Manca {remaining(estimate)}</span>}
        </p>
        {paused && (
          <p className="text-destructive-soft-foreground flex items-start gap-2 text-[12.5px]">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Il Segretario si è fermato: {paused} Riprenderà da solo quando sarà risolto; intanto
              puoi entrare.
            </span>
          </p>
        )}
        {status && status.failed.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <p className="text-[12.5px] font-semibold">
              {status.failed.length === 1
                ? 'Una conversazione non sono riuscito a leggerla: ci riprovo più tardi.'
                : `${status.failed.length} conversazioni non sono riuscito a leggerle: ci riprovo più tardi.`}
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
          ? 'Il Segretario ha letto la tua posta: trovi la giornata in Oggi, le cose da gestire, quelle che aspetti, le risposte pronte e i tuoi progetti. Da qui in poi legge quello che arriva.'
          : 'La tua posta è qui. Puoi accendere il Segretario quando vuoi, da Impostazioni › Segretario.'
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
  const steps = all.filter((step) => applies(step, state.case, aiOn || undecided))

  useEffect(() => {
    let current = true
    void window.segretarioApi.listLearning().then((loaded) => current && setLearning(loaded))
    return () => {
      current = false
    }
  }, [accounts, state.conoscimiId])

  /** The next step that applies — `aiOn` as it is now, after this step perhaps turned it on. */
  const next = useCallback(
    (aiOnNow = aiOn, change: Partial<OnboardingState> = {}): void => {
      const all = CASE_STEPS[state.case]
      const following = all
        .slice(all.indexOf(state.step) + 1)
        .find((step) => applies(step, state.case, aiOnNow))

      onChange({ ...state, ...change, step: following ?? 'entra' })
    },
    [aiOn, onChange, state]
  )

  // Turned on here, the AI starts with every connection: their reading waits for Conoscimi.
  const enable = async (): Promise<void> => {
    await window.segretarioApi.setPreferences({ enabled: true })
    next(true, { accountIds: [] })
  }

  return (
    <div className="paper flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[720px] shrink-0 flex-col gap-8 px-6 py-10">
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
            'letter flex shrink-0 flex-col rounded-[14px] px-8 py-8 sm:px-12',
            // Conoscimi is watched as it writes: its page takes the room there is.
            state.step === 'conoscimi' && state.conoscimiId
              ? 'min-h-[560px] flex-1'
              : 'min-h-[360px]'
          )}
        >
          {state.step === 'connessioni' && (
            <ConnectionsStep
              accounts={accounts}
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
            />
          )}
          {state.step === 'lettura' && <ReadingStep onNext={() => next()} />}
          {state.step === 'entra' && <EnterStep aiOn={aiOn} onEnter={() => onFinish(true)} />}
        </article>
      </div>
    </div>
  )
}
