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
import { cn } from '@renderer/lib/utils'
import type { SegretarioKeyState, SegretarioSpending, SegretarioStatus } from '@shared/segretario'

const KEYS_URL = 'https://openrouter.ai/settings/keys'
const CREDITS_URL = 'https://openrouter.ai/settings/credits'

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
  exhausted: { label: 'Credito esaurito', tone: 'bg-seal' },
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
 * Impostazioni › Segretario: the user's own OpenRouter key — checked when
 * given, kept encrypted like the accounts' passwords — what is left of the
 * credit, what the Segretario has cost, and what happens to the mail it
 * reads. The model is not a choice: SIEVER Mail follows the newest one.
 */
export function SegretarioSection(): React.JSX.Element {
  const [status, setStatus] = useState<SegretarioStatus | null>(null)
  const [spending, setSpending] = useState<SegretarioSpending | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState<'save' | 'check' | 'remove' | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  useEffect(() => {
    let current = true

    Promise.all([window.segretarioApi.getStatus(), window.segretarioApi.getSpending()])
      .then(([storedStatus, storedSpending]) => {
        if (current) {
          setStatus(storedStatus)
          setSpending(storedSpending)
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setLoadError(errorText(error) ?? 'Impossibile leggere le impostazioni del Segretario.')
        }
      })

    const unsubscribe = window.segretarioApi.onStatusChanged(setStatus)

    return () => {
      current = false
      unsubscribe()
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
      <div className="border-border bg-card/55 flex flex-col gap-3 rounded-md border p-3">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
            Chiave OpenRouter
          </p>
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
                onClick={() => openExternal(KEYS_URL)}
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
              onClick={() => openExternal(CREDITS_URL)}
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
        <div className="border-border bg-card/55 flex flex-col gap-2 rounded-md border p-3">
          <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">Spesa</p>
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
          <p className="text-muted-foreground text-[11px]">
            Quello che OpenRouter ha addebitato per il lavoro del Segretario su questo computer.
          </p>
        </div>
      )}

      <div className="border-border bg-card/55 flex flex-col gap-2 rounded-md border p-3">
        <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
          Riservatezza
        </p>
        <p className="text-[12px] leading-[1.5]">
          Il Segretario manda al modello solo quello che gli serve per il lavoro che sta facendo, e
          solo a fornitori che non conservano i dati e non li usano per addestrare i modelli (Zero
          Data Retention). La posta, i file e quello che impara di te restano su questo computer.
          Legge i tuoi file senza mai modificarli, e nessun messaggio parte senza la tua conferma.
        </p>
      </div>

      {confirmDialog}
    </div>
  )
}
