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
import { hourStyle, languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { Messages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import {
  OPENROUTER_CREDITS_URL,
  OPENROUTER_KEYS_URL,
  type EngineState,
  type SegretarioKeyState,
  type SegretarioPreferences,
  type SegretarioSpending,
  type SegretarioStatus
} from '@shared/segretario'

import { KEY_STATE, LIMIT_RESET, MESSAGES } from './segretario-section.messages'

/** What an OpenRouter key looks like: the same in every language. */
const KEY_PLACEHOLDER = 'sk-or-v1-…'

/** Each state of the key's dot. */
const KEY_TONE: Readonly<Record<SegretarioKeyState, string>> = {
  missing: 'bg-faint-foreground',
  ready: 'bg-status-online',
  invalid: 'bg-destructive',
  exhausted: 'bg-urgent',
  unchecked: 'bg-warning'
}

/** An amount in dollars, as the region writes money; a fraction of a cent, said so. */
function dollars(m: Messages<typeof MESSAGES>, amount: number): string {
  const format = new Intl.NumberFormat(languageNow().formatLocale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  return amount > 0 && amount < 0.01 ? m.lessThan(format.format(0.01)) : format.format(amount)
}

/** When the key was last checked: the day and the time, as the region writes them. */
function checkedWords(at: number): string {
  return new Intl.DateTimeFormat(languageNow().formatLocale, {
    day: 'numeric',
    month: 'short',
    hour: hourStyle(),
    minute: '2-digit'
  }).format(at)
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
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const keyStates = useMessages(KEY_STATE)
  const limitResets: Readonly<Record<string, string | undefined>> = useMessages(LIMIT_RESET)
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
          setLoadError(errorText(error) ?? messagesNow(MESSAGES).unreadable)
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
        toast.warning(messagesNow(MESSAGES).keyUnchecked, {
          description: saved.problem ?? undefined
        })
      }
    } catch (error) {
      setKeyError(errorText(error) ?? messagesNow(MESSAGES).keyNotSaved)
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
      toast.error(messagesNow(MESSAGES).notSaved, { description: errorText(error) })
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
      toast.error(messagesNow(MESSAGES).checkFailed, { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const removeKey = async (): Promise<void> => {
    const confirmed = await confirm({
      title: m.removeKeyTitle,
      description: m.removeKeyText,
      confirmLabel: m.removeKey,
      cancelLabel: m.cancel,
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
      toast.error(messagesNow(MESSAGES).keyNotRemoved, { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const forgetAll = async (): Promise<void> => {
    const confirmed = await confirm({
      title: m.forgetTitle,
      description: m.forgetConfirmText,
      confirmLabel: places.forgetEverything,
      cancelLabel: m.cancel,
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
      toast(messagesNow(MESSAGES).forgotten)
    } catch (error) {
      toast.error(messagesNow(MESSAGES).failed, { description: errorText(error) })
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
    return <SettingsLoading>{m.loading}</SettingsLoading>
  }

  const hasKey = status.keyState !== 'missing'
  const state = { label: keyStates[status.keyState], tone: KEY_TONE[status.keyState] }
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
          <span className="display-title block text-[15px]">{on ? m.on : m.off}</span>
          <span className="text-muted-foreground mt-0.5 block text-[11.5px] leading-[1.45]">
            {on ? m.onText : m.offText}
          </span>
        </span>
        <Switch
          id="segretario-enabled"
          checked={on}
          disabled={busy !== null || !preferences}
          aria-label={m.switchLabel}
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
        <SettingsGroup title={m.key} description={m.keyText}>
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
                {m.credit}{' '}
                <span className="tabular font-medium">{dollars(m, credit.available)}</span>
                {credit.keyLimit !== null && (
                  <span className="text-muted-foreground">
                    {' · '}
                    {m.keyLimit(dollars(m, credit.keyLimit))}
                    {credit.keyLimitReset && limitResets[credit.keyLimitReset]
                      ? ` ${limitResets[credit.keyLimitReset]}`
                      : ''}
                  </span>
                )}
              </p>
            )}
            {status.modelName && (
              <p className="text-muted-foreground">{m.model(status.modelName)}</p>
            )}
            {status.checkedAt && (
              <p className="text-faint-foreground text-[11px]">
                {m.checkedAt(checkedWords(status.checkedAt))}
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
                  placeholder={KEY_PLACEHOLDER}
                  aria-label={m.key}
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
                  {m.connect}
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
                    {m.cancel}
                  </Button>
                )}
              </div>
              {keyError && (
                <p className="text-destructive-soft-foreground text-[12px]">{keyError}</p>
              )}
              <p className="text-muted-foreground text-[11px]">
                {m.noKey}{' '}
                <button
                  type="button"
                  className="text-foreground inline-flex items-center gap-1 underline underline-offset-2"
                  onClick={() => openExternal(OPENROUTER_KEYS_URL)}
                >
                  {m.openOpenRouter}
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
                {m.checkAgain}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => setReplacing(true)}
              >
                <KeyRound className="size-3.5" />
                {m.replace}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openExternal(OPENROUTER_CREDITS_URL)}
              >
                <ExternalLink className="size-3.5" />
                {m.topUp}
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
                {m.remove}
              </Button>
            </div>
          )}
        </SettingsGroup>
      )}

      {spending && (on || hasKey || spending.thisMonth > 0 || spending.byFunction.length > 0) && (
        <div className="settings-group flex flex-col gap-2">
          <p className="eyebrow">{m.spending}</p>
          <div className="flex gap-8 text-[12px]">
            <p>
              <span className="text-muted-foreground block text-[11px]">{m.today}</span>
              <span className="tabular text-[15px] font-medium">{dollars(m, spending.today)}</span>
            </p>
            <p>
              <span className="text-muted-foreground block text-[11px]">{m.thisMonth}</span>
              <span className="tabular text-[15px] font-medium">
                {dollars(m, spending.thisMonth)}
              </span>
            </p>
          </div>
          {spending.byFunction.length > 0 && (
            <ul className="text-muted-foreground flex flex-col gap-0.5 text-[11.5px]">
              {spending.byFunction.slice(0, 8).map((entry) => (
                <li key={entry.purpose} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{entry.label}</span>
                  <span className="tabular shrink-0">{dollars(m, entry.cost)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-[11px]">{m.spendingText}</p>
        </div>
      )}

      <div className="settings-group flex flex-col gap-2">
        <p className="eyebrow">{m.privacy}</p>
        <p className="text-[12px] leading-[1.5]">{m.privacyText}</p>
      </div>

      {(hasKey || keepsAnything) && (
        <div className="border-destructive/35 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3">
          <p className="eyebrow">{places.forgetEverything}</p>
          <p className="text-muted-foreground text-[11.5px] leading-[1.5]">{m.forgetText}</p>
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
            {places.forgetEverything}
          </Button>
        </div>
      )}

      {confirmDialog}
    </SettingsPage>
  )
}
