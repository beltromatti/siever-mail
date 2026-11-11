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
import { CompassStar } from '@renderer/components/ui/compass-star'
import {
  SettingsGroup,
  SettingsLoading,
  SettingsNotice,
  SettingsPage
} from '@renderer/components/ui/settings'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import {
  OPENROUTER_CREDITS_URL,
  OPENROUTER_KEYS_URL,
  type EngineState,
  type SegretarioKeyState,
  type SegretarioPreferences,
  type SegretarioSpending,
  type SegretarioStatus
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

/**
 * Impostazioni › Segretario (vision §12.1, §13.2): first the switch that
 * makes SIEVER Mail intelligent or a set of plain apps — on, through the
 * guided setup; then the user's own OpenRouter key — checked when given,
 * kept encrypted like the connections' passwords —, the credit, what the
 * Segretario has cost, where the data goes; last, «Dimentica tutto», as if
 * it had never been on. The model is not a choice: SIEVER Mail follows the
 * newest one.
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
  // Whether «Dimentica tutto» has anything to take — the same the Dati page says.
  const [keepsAnything, setKeepsAnything] = useState(false)
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
      window.segretarioApi.getEngineState(),
      window.segretarioApi.keepsAnything()
    ])
      .then(([storedStatus, storedSpending, storedPreferences, engineState, keeps]) => {
        if (current) {
          setStatus(storedStatus)
          setSpending(storedSpending)
          setPreferences(storedPreferences)
          setEngine(engineState)
          setKeepsAnything(keeps)
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setLoadError(errorText(error) ?? 'Impossibile leggere le impostazioni del Segretario.')
        }
      })

    const unsubscribe = window.segretarioApi.onStatusChanged(setStatus)
    // Only for when it waits on OpenRouter: the rest of its work is told where it is done.
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
        'Il Segretario si spegne: per riaccenderlo, la procedura guidata ti chiederà una chiave. Ciò che ha imparato e il lavoro fatto restano.',
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
      setKeepsAnything(await window.segretarioApi.keepsAnything())
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
        'Si cancellano la memoria, le note, le cose aperte, i progetti, le risposte pronte, il diario, le spese e la chiave, e le funzioni AI si spengono: come se non fossero mai state accese. La posta, i calendari e i file restano come sono.',
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
      const [nextStatus, nextPreferences, nextSpending] = await Promise.all([
        window.segretarioApi.getStatus(),
        window.segretarioApi.getPreferences(),
        window.segretarioApi.getSpending()
      ])
      setStatus(nextStatus)
      setPreferences(nextPreferences)
      setSpending(nextSpending)
      setKeepsAnything(false)
      setReplacing(false)
      toast('Il Segretario ha dimenticato tutto.')
    } catch (error) {
      toast.error('Non è andata', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  if (loadError) {
    return (
      <SettingsPage>
        <SettingsNotice tone="error">{loadError}</SettingsNotice>
      </SettingsPage>
    )
  }

  if (!status) {
    return <SettingsLoading>Caricamento delle impostazioni…</SettingsLoading>
  }

  const hasKey = status.keyState !== 'missing'
  const state = KEY_STATE[status.keyState]
  const credit = status.credit

  // On is the switch up and a key given (§12.1): without the key, turning it on asks for one.
  const on = Boolean(preferences?.enabled && hasKey)
  const waiting = on ? engine?.waiting : null

  return (
    <SettingsPage>
      <label
        htmlFor="segretario-enabled"
        className={cn(
          'flex cursor-pointer items-center gap-4 rounded-lg border px-4 py-3.5 transition-colors',
          on ? 'border-ai-line/45 bg-ai-soft' : 'border-border bg-hover'
        )}
      >
        <CompassStar
          className={cn('size-6 shrink-0', on ? 'text-ai-star' : 'text-faint-foreground')}
          strokeWidth={1.6}
        />
        <span className="min-w-0 flex-1">
          <span className="display-title block text-[15px]">
            {on ? 'Il Segretario lavora per te' : 'Il Segretario è spento'}
          </span>
          <span className="text-muted-foreground mt-0.5 block text-[11.5px] leading-[1.45]">
            {on
              ? 'Segue la posta e i calendari mentre cambiano, tiene il conto di ciò che ti chiedono, che hai promesso e che aspetti, e prepara risposte e incontri.'
              : 'SIEVER Mail è un insieme di app, senza intelligenza. Accendilo: una procedura guidata lo collega e gli fa conoscere il tuo lavoro.'}
          </span>
        </span>
        <Switch
          id="segretario-enabled"
          checked={on}
          disabled={busy !== null || !preferences}
          aria-label="Segretario acceso"
          onCheckedChange={(enabled) =>
            enabled ? onEnableAi() : void changePreferences({ enabled })
          }
        />
      </label>
      {waiting && (
        <p className="text-muted-foreground -mt-1 flex items-start gap-2 text-[11.5px]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{waiting}</span>
        </p>
      )}

      {hasKey && (
        <SettingsGroup
          title="Chiave OpenRouter"
          description="Il Segretario lavora con un modello che usi dal tuo account OpenRouter: paghi solo quello che fa, senza abbonamenti. La chiave resta su questo computer, cifrata."
        >
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

          {replacing ? (
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
                  autoFocus
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
              {keyError && (
                <p className="text-destructive-soft-foreground text-[12px]">{keyError}</p>
              )}
              <p className="text-muted-foreground text-[11px]">
                Non hai una chiave? Crea un account su OpenRouter, aggiungi qualche dollaro di
                credito e genera una chiave.{' '}
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
        </SettingsGroup>
      )}

      {spending && (on || hasKey || spending.thisMonth > 0 || spending.byFunction.length > 0) && (
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

      <div className="settings-group flex flex-col gap-2">
        <p className="eyebrow">Riservatezza</p>
        <p className="text-[12px] leading-[1.5]">
          Il Segretario manda al modello solo quello che gli serve per il lavoro che sta facendo, e
          solo a fornitori che non conservano i dati e non li usano per addestrare i modelli (Zero
          Data Retention). La posta, i file e quello che impara di te restano su questo computer.
          Legge i tuoi file senza mai modificarli, e nessun messaggio parte senza la tua conferma.
        </p>
      </div>

      {(hasKey || keepsAnything) && (
        <div className="border-destructive/35 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3">
          <p className="eyebrow">Dimentica tutto</p>
          <p className="text-muted-foreground text-[11.5px] leading-[1.5]">
            Come se il Segretario non fosse mai stato acceso: si cancellano ciò che sa e ciò che ha
            fatto — memoria, note, cose aperte, progetti, risposte pronte, diario e spese — e la
            chiave. Riacceso, riparte dalla procedura guidata. La posta, i calendari e i file
            restano come sono.
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
      )}

      {confirmDialog}
    </SettingsPage>
  )
}
