import { useEffect, useState } from 'react'
import {
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import {
  OPENROUTER_CREDITS_URL,
  OPENROUTER_KEYS_URL,
  TASK_LABELS,
  type EngineState,
  type SegretarioKeyState,
  type SegretarioPreferences,
  type SegretarioSpending,
  type SegretarioStatus,
  type TaskKind
} from '@shared/segretario'

const DOLLARS = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const CHECKED_AT = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

const LIMIT_RESET: Readonly<Record<string, string>> = {
  daily: 'al giorno',
  weekly: 'alla settimana',
  monthly: 'al mese'
}

const KEY_STATE: Readonly<Record<SegretarioKeyState, { label: string; tone: string }>> = {
  missing: { label: 'Nessuna chiave', tone: 'bg-faint-foreground' },
  ready: { label: 'Collegata', tone: 'bg-status-online' },
  invalid: { label: 'Non valida', tone: 'bg-destructive' },
  exhausted: { label: 'Credito esaurito', tone: 'bg-urgent' },
  unchecked: { label: 'Non verificata', tone: 'bg-warning' }
}

function dollars(amount: number): string {
  return amount > 0 && amount < 0.01 ? `meno di ${DOLLARS.format(0.01)}` : DOLLARS.format(amount)
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim() ? error.message : undefined
}

function openExternal(url: string): void {
  void window.mailApi.openExternalUrl(url)
}

/** Where the Segretario's own work stands: what it has read, what waits. */
function EngineLine({ engine }: { engine: EngineState }): React.JSX.Element {
  const busy = (Object.entries(engine.running) as Array<[TaskKind, number]>).filter(
    ([, count]) => count > 0
  )
  const waiting = Object.values(engine.queued).reduce((total, count) => total + (count ?? 0), 0)

  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-[11.5px]">
      {engine.waiting && (
        <p className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{engine.waiting}</span>
        </p>
      )}
      <p>
        Posta da leggere, fin dove si legge ogni connessione: letti{' '}
        <span className="text-foreground tabular font-medium">
          {engine.reading.read.toLocaleString('it-IT')}
        </span>{' '}
        messaggi su {engine.reading.total.toLocaleString('it-IT')}.
      </p>
      {(busy.length > 0 || waiting > 0) && (
        <p>
          {busy.length > 0 &&
            `Al lavoro: ${busy.map(([task, count]) => `${TASK_LABELS[task].toLowerCase()}${count > 1 ? ` (${count})` : ''}`).join(', ')}. `}
          {waiting > 0 && `${waiting.toLocaleString('it-IT')} in coda.`}
        </p>
      )}
    </div>
  )
}

/**
 * Impostazioni › Segretario: the user's own OpenRouter key — checked when
 * given, kept encrypted like the accounts' passwords — what is left of the
 * credit, what the Segretario has cost, and what happens to the mail it
 * reads. The model is not a choice: SIEVER Mail follows the newest one.
 */
export function SegretarioSection({
  onEnableAi
}: {
  /** Turning the AI on goes through the guided setup: Conoscimi, then the reading. */
  onEnableAi: () => void
}): React.JSX.Element {
  const [status, setStatus] = useState<SegretarioStatus | null>(null)
  const [spending, setSpending] = useState<SegretarioSpending | null>(null)
  const [preferences, setPreferences] = useState<SegretarioPreferences | null>(null)
  const [engine, setEngine] = useState<EngineState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState<'save' | 'check' | 'remove' | 'forget' | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  useEffect(() => {
    let current = true

    Promise.all([
      window.segretarioApi.getStatus(),
      window.segretarioApi.getSpending(),
      window.segretarioApi.getPreferences(),
      window.segretarioApi.getEngineState()
    ])
      .then(([storedStatus, storedSpending, storedPreferences, engineState]) => {
        if (current) {
          setStatus(storedStatus)
          setSpending(storedSpending)
          setPreferences(storedPreferences)
          setEngine(engineState)
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setLoadError(errorText(error) ?? 'Impossibile leggere le impostazioni del Segretario.')
        }
      })

    const unsubscribe = window.segretarioApi.onStatusChanged(setStatus)
    const unsubscribeEngine = window.segretarioApi.onEngineChanged(setEngine)
    // The AI goes off by itself when the key or the credit gives out: the switch follows.
    const unsubscribePreferences = window.segretarioApi.onPreferencesChanged(setPreferences)

    return () => {
      current = false
      unsubscribe()
      unsubscribeEngine()
      unsubscribePreferences()
    }
  }, [])

  const saveKey = async (): Promise<void> => {
    setBusy('save')
    setKeyError(null)

    try {
      const saved = await window.segretarioApi.saveKey(keyInput)
      setStatus(saved)
      setKeyInput('')
      setReplacing(false)

      if (saved.keyState === 'unchecked') {
        toast.warning('Chiave salvata, ma non verificata', {
          description: saved.problem ?? undefined
        })
      }
    } catch (error) {
      setKeyError(errorText(error) ?? 'La chiave non è stata salvata.')
    } finally {
      setBusy(null)
    }
  }

  const changePreferences = async (patch: Partial<SegretarioPreferences>): Promise<void> => {
    if (!preferences) {
      return
    }

    try {
      setPreferences(await window.segretarioApi.setPreferences({ ...preferences, ...patch }))
    } catch (error) {
      toast.error('Impostazione non salvata', { description: errorText(error) })
    }
  }

  const checkKey = async (): Promise<void> => {
    setBusy('check')

    try {
      const [checked, latestSpending] = await Promise.all([
        window.segretarioApi.checkKey(),
        window.segretarioApi.getSpending()
      ])
      setStatus(checked)
      setSpending(latestSpending)
    } catch (error) {
      toast.error('Verifica non riuscita', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const removeKey = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Togliere la chiave OpenRouter?',
      description:
        'Il Segretario si ferma finché non ne inserisci un’altra. Quello che ha imparato e i lavori fatti restano.',
      confirmLabel: 'Togli la chiave',
      cancelLabel: 'Annulla',
      destructive: true
    })

    if (!confirmed) {
      return
    }

    setBusy('remove')

    try {
      setStatus(await window.segretarioApi.removeKey())
      setReplacing(false)
    } catch (error) {
      toast.error('Chiave non tolta', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const forgetAll = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Far dimenticare tutto al Segretario?',
      description:
        'Memoria, note, cose aperte, progetti, risposte pronte e diario si cancellano, e non tornano. La posta e i calendari non cambiano; la chiave resta.',
      confirmLabel: 'Dimentica tutto',
      cancelLabel: 'Annulla',
      destructive: true
    })

    if (!confirmed) {
      return
    }

    setBusy('forget')

    try {
      await window.segretarioApi.forgetAll()
      setPreferences(await window.segretarioApi.getPreferences())
      setSpending(await window.segretarioApi.getSpending())
      toast('Il Segretario ha dimenticato tutto.')
    } catch (error) {
      toast.error('Non è andata', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  if (loadError) {
    return (
      <div className="text-destructive-soft-foreground border-destructive/35 bg-destructive/10 mt-4 rounded-md border px-3 py-2 text-[12px]">
        {loadError}
      </div>
    )
  }

  if (!status) {
    return (
      <div className="text-muted-foreground mt-4 flex items-center gap-2 text-[12px]">
        <LoaderCircle className="size-4 animate-spin" />
        Caricamento delle impostazioni…
      </div>
    )
  }

  const hasKey = status.keyState !== 'missing'
  const askingForKey = !hasKey || replacing
  const state = KEY_STATE[status.keyState]
  const credit = status.credit

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div className="settings-group flex flex-col gap-3">
        <div>
          <p className="eyebrow">Chiave OpenRouter</p>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Il Segretario lavora con un modello linguistico che usi attraverso il tuo account
            OpenRouter: paghi a consumo solo quello che fa, senza abbonamenti. La chiave resta su
            questo computer, cifrata come le password degli account.
          </p>
        </div>

        {hasKey && (
          <div className="flex flex-col gap-1.5 text-[12px]">
            <div className="flex items-center gap-2">
              <span className={cn('size-2 shrink-0 rounded-full', state.tone)} />
              <span className="font-medium">{state.label}</span>
              {status.keyLabel && (
                <span className="text-muted-foreground tabular truncate">{status.keyLabel}</span>
              )}
            </div>
            {status.problem && (
              <div className="text-destructive-soft-foreground flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">{status.problem}</span>
              </div>
            )}
            {credit && (
              <p>
                Credito disponibile:{' '}
                <span className="tabular font-medium">{dollars(credit.available)}</span>
                {credit.keyLimit !== null && (
                  <span className="text-muted-foreground">
                    {' '}
                    · limite della chiave {dollars(credit.keyLimit)}
                    {credit.keyLimitReset && LIMIT_RESET[credit.keyLimitReset]
                      ? ` ${LIMIT_RESET[credit.keyLimitReset]}`
                      : ''}
                  </span>
                )}
              </p>
            )}
            {status.modelName && (
              <p className="text-muted-foreground">
                Modello: {status.modelName} — SIEVER Mail passa da solo alla versione più recente.
              </p>
            )}
            {status.checkedAt && (
              <p className="text-faint-foreground text-[11px]">
                Verificata {CHECKED_AT.format(status.checkedAt)}
              </p>
            )}
          </div>
        )}

        {askingForKey ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void saveKey()
            }}
          >
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-or-v1-…"
                aria-label="Chiave OpenRouter"
                value={keyInput}
                onChange={(event) => {
                  setKeyInput(event.target.value)
                  setKeyError(null)
                }}
                className="tabular"
                autoFocus={replacing}
              />
              <Button type="submit" size="sm" disabled={!keyInput.trim() || busy !== null}>
                {busy === 'save' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <KeyRound className="size-3.5" />
                )}
                Collega
              </Button>
              {replacing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => {
                    setReplacing(false)
                    setKeyInput('')
                    setKeyError(null)
                  }}
                >
                  Annulla
                </Button>
              )}
            </div>
            {keyError && <p className="text-destructive-soft-foreground text-[12px]">{keyError}</p>}
            <p className="text-muted-foreground text-[11px]">
              Non hai una chiave? Crea un account su OpenRouter, aggiungi qualche dollaro di credito
              e genera una chiave.{' '}
              <button
                type="button"
                className="text-foreground inline-flex items-center gap-1 underline underline-offset-2"
                onClick={() => openExternal(OPENROUTER_KEYS_URL)}
              >
                Apri openrouter.ai
                <ExternalLink className="size-3" />
              </button>
            </p>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void checkKey()}
            >
              {busy === 'check' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Verifica di nuovo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setReplacing(true)}
            >
              <KeyRound className="size-3.5" />
              Sostituisci
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openExternal(OPENROUTER_CREDITS_URL)}
            >
              <ExternalLink className="size-3.5" />
              Ricarica il credito
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy !== null}
              onClick={() => void removeKey()}
            >
              {busy === 'remove' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Togli
            </Button>
          </div>
        )}
      </div>

      {spending && (
        <div className="settings-group flex flex-col gap-2">
          <p className="eyebrow">Spesa</p>
          <div className="flex gap-8 text-[12px]">
            <p>
              <span className="text-muted-foreground block text-[11px]">Oggi</span>
              <span className="tabular text-[15px] font-medium">{dollars(spending.today)}</span>
            </p>
            <p>
              <span className="text-muted-foreground block text-[11px]">Questo mese</span>
              <span className="tabular text-[15px] font-medium">{dollars(spending.thisMonth)}</span>
            </p>
          </div>
          {spending.byFunction.length > 0 && (
            <ul className="text-muted-foreground flex flex-col gap-0.5 text-[11.5px]">
              {spending.byFunction.slice(0, 8).map((entry) => (
                <li key={entry.purpose} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{entry.label}</span>
                  <span className="tabular shrink-0">{dollars(entry.cost)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-[11px]">
            Quello che OpenRouter ha addebitato per il lavoro del Segretario su questo computer; per
            funzione, negli ultimi trenta giorni.
          </p>
        </div>
      )}

      {hasKey && preferences && (
        <div className="settings-group flex flex-col gap-3">
          <label
            htmlFor="segretario-enabled"
            className="flex cursor-pointer items-center justify-between gap-3"
          >
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Funzioni AI</span>
              <span className="text-muted-foreground block text-[11px]">
                Il Segretario segue la posta e i calendari mentre cambiano, tiene il conto di cosa
                ti chiedono, cosa hai promesso e cosa aspetti, riconosce i progetti, prepara le
                risposte e gli incontri, scrive la giornata e rilegge i messaggi prima che partano.
                Spente, restano le app senza Segretario: quello che ha imparato resta. Si spengono
                da sole se il credito OpenRouter finisce o la chiave viene rifiutata: le riaccendi
                da qui, dopo aver ricaricato.
              </span>
            </span>
            <Switch
              id="segretario-enabled"
              checked={preferences.enabled}
              onCheckedChange={(enabled) =>
                enabled ? onEnableAi() : void changePreferences({ enabled })
              }
            />
          </label>

          {preferences.enabled && engine && <EngineLine engine={engine} />}
        </div>
      )}

      <div className="settings-group flex flex-col gap-2">
        <p className="eyebrow">Riservatezza</p>
        <p className="text-[12px] leading-[1.5]">
          Il Segretario manda al modello solo quello che gli serve per il lavoro che sta facendo, e
          solo a fornitori che non conservano i dati e non li usano per addestrare i modelli (Zero
          Data Retention). La posta, i file e quello che impara di te restano su questo computer.
          Legge i tuoi file senza mai modificarli, e nessun messaggio parte senza la tua conferma.
        </p>
      </div>

      <div className="settings-group flex flex-col gap-2">
        <p className="eyebrow">Dimentica tutto</p>
        <p className="text-muted-foreground text-[11.5px] leading-[1.5]">
          Cancella quello che il Segretario sa e ha fatto: memoria, note, cose aperte, progetti,
          risposte pronte, diario e spese. Restano la chiave e le copie archiviate su disco. Le
          funzioni AI si spengono: riaccese, ripartono da capo, da Conoscimi.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive-soft-foreground w-fit"
          disabled={busy !== null}
          onClick={() => void forgetAll()}
        >
          {busy === 'forget' ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          Dimentica tutto
        </Button>
      </div>

      {confirmDialog}
    </div>
  )
}
