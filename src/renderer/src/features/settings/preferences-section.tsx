import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'

import {
  ChoiceRow,
  OptionsRow,
  SettingRow,
  SettingsEmpty,
  SettingsGroup,
  SettingsNotice,
  SettingsPage
} from '@renderer/components/ui/settings'
import { useCalendarList } from '@renderer/features/calendar/use-calendar'
import { GROUPING_OPTIONS } from '@renderer/features/mail/message-list-shared'
import { IS_MAC } from '@renderer/lib/command-shortcuts'
import { READER_ZOOM_STEPS } from '@renderer/lib/reader-zoom'
import { cn } from '@renderer/lib/utils'
import {
  NEW_EVENT_MINUTES,
  type MailAccount,
  type MailLayoutMode,
  type MessageGroupingMode,
  type OpenAtLogin,
  type ThemeMode,
  type UiPreferences
} from '@shared/models'

const THEME_OPTIONS = [
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'light', label: 'Chiaro', icon: Sun },
  { value: 'dark', label: 'Scuro', icon: Moon }
] as const satisfies ReadonlyArray<{ value: ThemeMode; label: string; icon: typeof Monitor }>

const LAYOUT_OPTIONS: ReadonlyArray<{ mode: MailLayoutMode; label: string; description: string }> =
  [
    {
      mode: 'apple',
      label: 'Affiancata',
      description: 'Cartelle, elenco e messaggio uno accanto all’altro.'
    },
    {
      mode: 'outlook',
      label: 'In colonna',
      description: 'L’elenco denso in alto, il messaggio sotto.'
    }
  ]

/** The calendar new events go to when the user has not chosen one: the principal one. */
const PRINCIPAL = '__principale__'

function minutesWords(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minuti`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours === 1 ? '1 ora' : `${hours} ore`}${rest ? ` e ${rest} minuti` : ''}`
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim() ? error.message : undefined
}

/** A sketch of each arrangement of the mail: where the message ends up, at a glance. */
function LayoutPreview({
  mode,
  active
}: {
  mode: MailLayoutMode
  active: boolean
}): React.JSX.Element {
  const pane = active ? 'bg-primary/35' : 'bg-muted-foreground/25'
  const accent = active ? 'bg-primary/60' : 'bg-muted-foreground/40'

  return (
    <div
      aria-hidden
      className="border-border/70 bg-background/60 flex h-12 w-full gap-1 rounded border p-1"
    >
      <div className={cn('w-1/5 rounded-[2px]', pane)} />
      {mode === 'outlook' ? (
        <div className="flex flex-1 flex-col gap-1">
          <div className={cn('h-2/5 rounded-[2px]', accent)} />
          <div className={cn('flex-1 rounded-[2px]', pane)} />
        </div>
      ) : (
        <div className="flex flex-1 gap-1">
          <div className={cn('w-2/5 rounded-[2px]', accent)} />
          <div className={cn('flex-1 rounded-[2px]', pane)} />
        </div>
      )}
    </div>
  )
}

/**
 * Impostazioni › Preferenze: how SIEVER Mail looks and behaves — its own,
 * then each app's, in the order of the rail, as Notifiche is (§13.2). An
 * app with nothing connected has nothing to set.
 */
export function PreferencesSection({
  preferences,
  onChange,
  accounts,
  busy,
  onUnifiedChanged
}: {
  preferences: UiPreferences
  onChange: (patch: Partial<UiPreferences>) => void
  accounts: ReadonlyArray<MailAccount>
  /** A connection is being removed or emptied: what depends on the mailboxes waits. */
  busy: boolean
  /** The mailboxes «Tutte le caselle» gathers changed. */
  onUnifiedChanged: () => void
}): React.JSX.Element {
  const { calendars } = useCalendarList()
  const [openAtLogin, setOpenAtLogin] = useState<OpenAtLogin | null>(null)
  const [unified, setUnified] = useState<string[] | null>(null)
  const [unifiedError, setUnifiedError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let current = true

    window.mailApi
      .getOpenAtLogin()
      .then((state) => current && setOpenAtLogin(state))
      .catch(
        () => current && setOpenAtLogin({ supported: false, enabled: false, needsApproval: false })
      )

    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    let current = true

    if (accounts.length < 2) {
      return
    }

    window.mailApi
      .getUnifiedPreferences()
      .then((stored) => {
        if (current) {
          setUnified(stored.includedAccountIds)
          setUnifiedError(null)
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setUnifiedError(errorText(error) ?? 'Le caselle incluse non si leggono.')
        }
      })

    return () => {
      current = false
    }
  }, [accounts])

  const changeOpenAtLogin = async (enabled: boolean): Promise<void> => {
    try {
      setOpenAtLogin(await window.mailApi.setOpenAtLogin(enabled))
    } catch (error) {
      toast.error('Impostazione non salvata', { description: errorText(error) })
    }
  }

  const include = async (accountId: string, included: boolean): Promise<void> => {
    if (!unified || saving || busy) {
      return
    }

    setSaving(true)
    setUnifiedError(null)

    try {
      const saved = await window.mailApi.setUnifiedIncludedAccounts(
        included
          ? [...new Set([...unified, accountId])]
          : unified.filter((included) => included !== accountId)
      )
      setUnified(saved.includedAccountIds)
      onUnifiedChanged()
    } catch (error) {
      setUnifiedError(errorText(error) ?? 'Le caselle incluse non sono state salvate.')
    } finally {
      setSaving(false)
    }
  }

  // Set from the installed app only: in development it shows, unset, where it would be.
  const loginRow =
    openAtLogin &&
    (openAtLogin.supported || (import.meta.env.DEV && /mac|win/i.test(navigator.platform)))
  const writable = (calendars ?? []).filter((calendar) => calendar.writable && !calendar.hidden)
  const chosenCalendar = writable.some(
    (calendar) => calendar.key === preferences.newEventCalendarKey
  )
    ? (preferences.newEventCalendarKey as string)
    : PRINCIPAL
  const zoomSteps = [
    ...new Set<number>([...READER_ZOOM_STEPS.filter((step) => step >= 75), preferences.readerZoom])
  ].sort((a, b) => a - b)

  return (
    <SettingsPage>
      <SettingsGroup title="SIEVER Mail">
        <OptionsRow
          title="Aspetto"
          description="Sistema segue il computer, anche quando cambia nel corso della giornata. I messaggi restano su pagina bianca, come si scrivono."
          value={preferences.themeMode}
          options={THEME_OPTIONS}
          label="Aspetto"
          onChange={(themeMode) => onChange({ themeMode })}
        />
        {loginRow && (
          <SettingRow
            id="preferences-open-at-login"
            title="Apri all’accesso al computer"
            description={
              !openAtLogin.supported
                ? 'Si sceglie nell’app installata.'
                : openAtLogin.needsApproval
                  ? 'Il sistema aspetta che lo consenta tu: Impostazioni di Sistema › Generali › Elementi login.'
                  : 'Così ciò che arriva ti trova anche prima che tu lo apra: le notifiche, e il lavoro del Segretario.'
            }
            checked={openAtLogin.enabled || openAtLogin.needsApproval}
            disabled={!openAtLogin.supported}
            onCheckedChange={(enabled) => void changeOpenAtLogin(enabled)}
          />
        )}
      </SettingsGroup>

      {accounts.length > 0 && (
        <SettingsGroup title="Posta">
          <div className="bg-hover flex flex-col gap-2 rounded-md px-3 py-2">
            <span className="text-[12px] font-medium">Disposizione</span>
            <div
              role="radiogroup"
              aria-label="Disposizione della Posta"
              className="grid grid-cols-2 gap-2"
            >
              {LAYOUT_OPTIONS.map((option) => {
                const active = preferences.layoutMode === option.mode

                return (
                  <button
                    key={option.mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onChange({ layoutMode: option.mode })}
                    className={cn(
                      'focus-visible:ring-ring/70 flex flex-col gap-1.5 rounded-md border p-2 text-left transition-colors outline-none focus-visible:ring-2',
                      active
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-border bg-background/40 hover:bg-secondary/40'
                    )}
                  >
                    <LayoutPreview mode={option.mode} active={active} />
                    <span
                      className={cn(
                        'text-[12px] font-semibold',
                        active ? 'text-primary-text' : 'text-foreground'
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="text-muted-foreground text-[11px]">{option.description}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <OptionsRow
            title="Ordine dell’elenco"
            description="Dal fondo, come una chat: i messaggi più recenti in basso, e si sale per andare indietro."
            value={preferences.invertMessageListOrder ? 'fondo' : 'alto'}
            options={[
              { value: 'alto', label: 'Dall’alto' },
              { value: 'fondo', label: 'Dal fondo' }
            ]}
            label="Ordine dell’elenco"
            onChange={(order) => onChange({ invertMessageListOrder: order === 'fondo' })}
          />
          <OptionsRow
            title="Raggruppamento"
            description="Automatico segue l’ordinamento: per giorno se ordini per data, per mittente se ordini per mittente."
            value={preferences.messageGrouping}
            options={GROUPING_OPTIONS.map((option) => ({
              value: option.mode,
              label: option.label
            }))}
            label="Raggruppamento dell’elenco"
            onChange={(messageGrouping: MessageGroupingMode) => onChange({ messageGrouping })}
          />
          <ChoiceRow
            title="Dimensione dei messaggi"
            description={`Anche con ${IS_MAC ? '⌘' : 'Ctrl'} e la rotella, sul messaggio.`}
            value={String(preferences.readerZoom)}
            options={zoomSteps.map(String)}
            words={(zoom) => `${zoom}%`}
            label="Dimensione dei messaggi"
            width="w-24"
            onChange={(zoom) => onChange({ readerZoom: Number(zoom) })}
          />

          {accounts.length > 1 && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground mt-1 text-[11px]">
                «Tutte le caselle», nella barra della Posta, riunisce in un elenco solo la posta
                delle caselle accese qui: Posta in arrivo, Inviata, Bozze, Archivio, Spam e Cestino.
                Una esclusa resta nella sua sezione.
              </p>
              {accounts.map((account) => (
                <SettingRow
                  key={account.id}
                  id={`preferences-unified-${account.id}`}
                  title={account.email}
                  description={account.displayName || undefined}
                  checked={unified?.includes(account.id) ?? false}
                  disabled={unified === null || saving || busy}
                  onCheckedChange={(included) => void include(account.id, included)}
                />
              ))}
              {unified?.length === 0 && (
                <SettingsEmpty>
                  Nessuna casella inclusa: «Tutte le caselle» non compare.
                </SettingsEmpty>
              )}
              {unifiedError && <SettingsNotice tone="error">{unifiedError}</SettingsNotice>}
            </div>
          )}
        </SettingsGroup>
      )}

      {writable.length > 0 && (
        <SettingsGroup title="Calendario">
          <ChoiceRow
            title="Calendario dei nuovi eventi"
            description="Dove va un evento che crei nel Calendario; lo cambi anche evento per evento."
            value={chosenCalendar}
            options={[PRINCIPAL, ...writable.map((calendar) => calendar.key)]}
            words={(key) => {
              if (key === PRINCIPAL) {
                return 'Il principale'
              }

              const calendar = writable.find((candidate) => candidate.key === key)
              return calendar ? `${calendar.name} · ${calendar.connection}` : key
            }}
            label="Calendario dei nuovi eventi"
            width="w-60"
            onChange={(key) => onChange({ newEventCalendarKey: key === PRINCIPAL ? null : key })}
          />
          <ChoiceRow
            title="Durata di un evento nuovo"
            description="Con un clic sul calendario, o con «Nuovo evento». Trascinando, è quella che disegni."
            value={String(preferences.newEventMinutes)}
            options={NEW_EVENT_MINUTES.map(String)}
            words={(minutes) => minutesWords(Number(minutes))}
            label="Durata di un evento nuovo"
            width="w-44"
            onChange={(minutes) => onChange({ newEventMinutes: Number(minutes) })}
          />
        </SettingsGroup>
      )}
    </SettingsPage>
  )
}
