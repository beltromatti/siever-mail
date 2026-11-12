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
import { chooseLanguage, messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { READER_ZOOM_STEPS } from '@renderer/lib/reader-zoom'
import { cn } from '@renderer/lib/utils'
import { defineMessages, LANGUAGE_NAMES, LANGUAGES, type Messages } from '@shared/i18n'
import {
  NEW_EVENT_MINUTES,
  type MailAccount,
  type MailLayoutMode,
  type MessageGroupingMode,
  type OpenAtLogin,
  type ThemeMode,
  type UiPreferences
} from '@shared/models'
import { PLACES } from '@shared/places'

const MESSAGES = defineMessages({
  themeSystem: { en: 'System', it: 'Sistema', de: 'System' },
  themeLight: { en: 'Light', it: 'Chiaro', de: 'Hell' },
  themeDark: { en: 'Dark', it: 'Scuro', de: 'Dunkel' },
  layoutSide: { en: 'Side by side', it: 'Affiancata', de: 'Nebeneinander' },
  layoutSideText: {
    en: 'Folders, list and message next to one another.',
    it: 'Cartelle, elenco e messaggio uno accanto all’altro.',
    de: 'Ordner, Liste und Nachricht nebeneinander.'
  },
  layoutColumn: { en: 'In a column', it: 'In colonna', de: 'Untereinander' },
  layoutColumnText: {
    en: 'The dense list on top, the message below.',
    it: 'L’elenco denso in alto, il messaggio sotto.',
    de: 'Die dichte Liste oben, die Nachricht darunter.'
  },
  minutes: {
    en: (minutes: number) => `${minutes} minutes`,
    it: (minutes: number) => `${minutes} minuti`,
    de: (minutes: number) => `${minutes} Minuten`
  },
  hoursAndMinutes: {
    en: (hours: number, minutes: number) =>
      `${hours === 1 ? '1 hour' : `${hours} hours`}${minutes ? ` ${minutes} minutes` : ''}`,
    it: (hours: number, minutes: number) =>
      `${hours === 1 ? '1 ora' : `${hours} ore`}${minutes ? ` e ${minutes} minuti` : ''}`,
    de: (hours: number, minutes: number) =>
      `${hours === 1 ? '1 Stunde' : `${hours} Stunden`}${minutes ? ` ${minutes} Minuten` : ''}`
  },
  unifiedUnreadable: {
    en: 'The included mailboxes cannot be read.',
    it: 'Le caselle incluse non si leggono.',
    de: 'Die einbezogenen Postfächer lassen sich nicht lesen.'
  },
  unifiedNotSaved: {
    en: 'The included mailboxes were not saved.',
    it: 'Le caselle incluse non sono state salvate.',
    de: 'Die einbezogenen Postfächer wurden nicht gespeichert.'
  },
  notSaved: {
    en: 'Setting not saved',
    it: 'Impostazione non salvata',
    de: 'Einstellung nicht gespeichert'
  },
  language: { en: 'Language', it: 'Lingua', de: 'Sprache' },
  languageText: {
    en: 'The language SIEVER Mail speaks to you in. Dates and numbers are written as your computer’s region writes them. The Segretario writes to you in your own language, even if it is another.',
    it: 'La lingua in cui SIEVER Mail ti parla. Date e numeri si scrivono come li scrive la regione del computer. Il Segretario ti scrive nella tua lingua, anche se è un’altra.',
    de: 'Die Sprache, in der SIEVER Mail mit Ihnen spricht. Datum und Zahlen werden so geschrieben, wie die Region Ihres Computers sie schreibt. Der Segretario schreibt Ihnen in Ihrer eigenen Sprache, auch wenn es eine andere ist.'
  },
  appearance: { en: 'Appearance', it: 'Aspetto', de: 'Erscheinungsbild' },
  appearanceText: {
    en: 'System follows the computer, also when it changes during the day. Messages stay on a white page, as they are written.',
    it: 'Sistema segue il computer, anche quando cambia nel corso della giornata. I messaggi restano su pagina bianca, come si scrivono.',
    de: 'System folgt dem Computer, auch wenn er sich im Laufe des Tages ändert. Nachrichten bleiben auf weißem Grund, so wie sie geschrieben werden.'
  },
  openAtLogin: {
    en: 'Open at login',
    it: 'Apri all’accesso al computer',
    de: 'Bei der Anmeldung öffnen'
  },
  openAtLoginInstalled: {
    en: 'Chosen in the installed app.',
    it: 'Si sceglie nell’app installata.',
    de: 'Wird in der installierten App gewählt.'
  },
  openAtLoginApproval: {
    en: 'The system is waiting for you to allow it: System Settings › General › Login Items.',
    it: 'Il sistema aspetta che lo consenta tu: Impostazioni di Sistema › Generali › Elementi login.',
    de: 'Das System wartet auf Ihre Erlaubnis: Systemeinstellungen › Allgemein › Anmeldeobjekte.'
  },
  openAtLoginText: {
    en: 'So what arrives finds you even before you open it: the notifications, and the Segretario’s work.',
    it: 'Così ciò che arriva ti trova anche prima che tu lo apra: le notifiche, e il lavoro del Segretario.',
    de: 'So erreicht Sie, was ankommt, schon bevor Sie die App öffnen: die Benachrichtigungen und die Arbeit des Segretario.'
  },
  layout: { en: 'Layout', it: 'Disposizione', de: 'Anordnung' },
  layoutLabel: { en: 'Mail layout', it: 'Disposizione della Posta', de: 'Anordnung der E-Mail' },
  order: { en: 'List order', it: 'Ordine dell’elenco', de: 'Reihenfolge der Liste' },
  orderText: {
    en: 'From the bottom, like a chat: the newest messages at the bottom, and you scroll up to go back.',
    it: 'Dal fondo, come una chat: i messaggi più recenti in basso, e si sale per andare indietro.',
    de: 'Von unten, wie in einem Chat: die neuesten Nachrichten unten, und man scrollt nach oben, um zurückzugehen.'
  },
  fromTop: { en: 'From the top', it: 'Dall’alto', de: 'Von oben' },
  fromBottom: { en: 'From the bottom', it: 'Dal fondo', de: 'Von unten' },
  grouping: { en: 'Grouping', it: 'Raggruppamento', de: 'Gruppierung' },
  groupingText: {
    en: 'Automatic follows the sorting: by day if you sort by date, by sender if you sort by sender.',
    it: 'Automatico segue l’ordinamento: per giorno se ordini per data, per mittente se ordini per mittente.',
    de: 'Automatisch folgt der Sortierung: nach Tag, wenn Sie nach Datum sortieren, nach Absender, wenn Sie nach Absender sortieren.'
  },
  groupingLabel: {
    en: 'Grouping of the list',
    it: 'Raggruppamento dell’elenco',
    de: 'Gruppierung der Liste'
  },
  messageSize: { en: 'Message size', it: 'Dimensione dei messaggi', de: 'Nachrichtengröße' },
  messageSizeText: {
    en: (modifier: string) => `Also with ${modifier} and the scroll wheel, on the message.`,
    it: (modifier: string) => `Anche con ${modifier} e la rotella, sul messaggio.`,
    de: (modifier: string) => `Auch mit ${modifier} und dem Mausrad, auf der Nachricht.`
  },
  unifiedText: {
    en: '“All mailboxes”, in the Mail sidebar, gathers into one list the mail of the mailboxes switched on here: Inbox, Sent, Drafts, Archive, Spam and Trash. One left out stays in its own section.',
    it: '«Tutte le caselle», nella barra della Posta, riunisce in un elenco solo la posta delle caselle accese qui: Posta in arrivo, Inviata, Bozze, Archivio, Spam e Cestino. Una esclusa resta nella sua sezione.',
    de: '„Alle Postfächer“ in der Seitenleiste der E-Mail fasst die E-Mails der hier eingeschalteten Postfächer in einer Liste zusammen: Posteingang, Gesendet, Entwürfe, Archiv, Spam und Papierkorb. Ein ausgeschlossenes bleibt in seinem eigenen Bereich.'
  },
  noneIncluded: {
    en: 'No mailbox included: “All mailboxes” does not appear.',
    it: 'Nessuna casella inclusa: «Tutte le caselle» non compare.',
    de: 'Kein Postfach einbezogen: „Alle Postfächer“ erscheint nicht.'
  },
  newEventCalendar: {
    en: 'Calendar for new events',
    it: 'Calendario dei nuovi eventi',
    de: 'Kalender für neue Termine'
  },
  newEventCalendarText: {
    en: 'Where an event you create in the Calendar goes; you can change it event by event too.',
    it: 'Dove va un evento che crei nel Calendario; lo cambi anche evento per evento.',
    de: 'Wohin ein Termin geht, den Sie im Kalender erstellen; Sie können ihn auch Termin für Termin ändern.'
  },
  principal: { en: 'The main one', it: 'Il principale', de: 'Der Hauptkalender' },
  newEventLength: {
    en: 'Length of a new event',
    it: 'Durata di un evento nuovo',
    de: 'Dauer eines neuen Termins'
  },
  newEventLengthText: {
    en: 'With a click on the calendar, or with “New event”. When you drag, it is what you draw.',
    it: 'Con un clic sul calendario, o con «Nuovo evento». Trascinando, è quella che disegni.',
    de: 'Mit einem Klick in den Kalender oder mit „Neuer Termin“. Beim Ziehen ist es die, die Sie zeichnen.'
  }
})

/** The calendar new events go to when the user has not chosen one: the principal one. */
const PRINCIPAL = '__principale__'

function minutesWords(m: Messages<typeof MESSAGES>, minutes: number): string {
  return minutes < 60
    ? m.minutes(minutes)
    : m.hoursAndMinutes(Math.floor(minutes / 60), minutes % 60)
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
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const { language } = useLanguage()
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
          setUnifiedError(errorText(error) ?? messagesNow(MESSAGES).unifiedUnreadable)
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
      toast.error(m.notSaved, { description: errorText(error) })
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
      setUnifiedError(errorText(error) ?? m.unifiedNotSaved)
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
  const themeOptions = [
    { value: 'system', label: m.themeSystem, icon: Monitor },
    { value: 'light', label: m.themeLight, icon: Sun },
    { value: 'dark', label: m.themeDark, icon: Moon }
  ] as const satisfies ReadonlyArray<{ value: ThemeMode; label: string; icon: typeof Monitor }>
  const layoutOptions: ReadonlyArray<{ mode: MailLayoutMode; label: string; description: string }> =
    [
      { mode: 'apple', label: m.layoutSide, description: m.layoutSideText },
      { mode: 'outlook', label: m.layoutColumn, description: m.layoutColumnText }
    ]
  const zoomSteps = [
    ...new Set<number>([...READER_ZOOM_STEPS.filter((step) => step >= 75), preferences.readerZoom])
  ].sort((a, b) => a - b)

  return (
    <SettingsPage>
      <SettingsGroup title="SIEVER Mail">
        <ChoiceRow
          title={m.language}
          description={m.languageText}
          value={language}
          options={LANGUAGES}
          words={(option) => LANGUAGE_NAMES[option]}
          label={m.language}
          width="w-36"
          onChange={(chosen) => void chooseLanguage(chosen)}
        />
        <OptionsRow
          title={m.appearance}
          description={m.appearanceText}
          value={preferences.themeMode}
          options={themeOptions}
          label={m.appearance}
          onChange={(themeMode) => onChange({ themeMode })}
        />
        {loginRow && (
          <SettingRow
            id="preferences-open-at-login"
            title={m.openAtLogin}
            description={
              !openAtLogin.supported
                ? m.openAtLoginInstalled
                : openAtLogin.needsApproval
                  ? m.openAtLoginApproval
                  : m.openAtLoginText
            }
            checked={openAtLogin.enabled || openAtLogin.needsApproval}
            disabled={!openAtLogin.supported}
            onCheckedChange={(enabled) => void changeOpenAtLogin(enabled)}
          />
        )}
      </SettingsGroup>

      {accounts.length > 0 && (
        <SettingsGroup title={places.mail}>
          <div className="bg-hover flex flex-col gap-2 rounded-md px-3 py-2">
            <span className="text-[12px] font-medium">{m.layout}</span>
            <div role="radiogroup" aria-label={m.layoutLabel} className="grid grid-cols-2 gap-2">
              {layoutOptions.map((option) => {
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
            title={m.order}
            description={m.orderText}
            value={preferences.invertMessageListOrder ? 'fondo' : 'alto'}
            options={[
              { value: 'alto', label: m.fromTop },
              { value: 'fondo', label: m.fromBottom }
            ]}
            label={m.order}
            onChange={(order) => onChange({ invertMessageListOrder: order === 'fondo' })}
          />
          <OptionsRow
            title={m.grouping}
            description={m.groupingText}
            value={preferences.messageGrouping}
            options={GROUPING_OPTIONS.map((option) => ({
              value: option.mode,
              label: option.label[language]
            }))}
            label={m.groupingLabel}
            onChange={(messageGrouping: MessageGroupingMode) => onChange({ messageGrouping })}
          />
          <ChoiceRow
            title={m.messageSize}
            description={m.messageSizeText(IS_MAC ? '⌘' : 'Ctrl')}
            value={String(preferences.readerZoom)}
            options={zoomSteps.map(String)}
            words={(zoom) => `${zoom}%`}
            label={m.messageSize}
            width="w-24"
            onChange={(zoom) => onChange({ readerZoom: Number(zoom) })}
          />

          {accounts.length > 1 && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground mt-1 text-[11px]">{m.unifiedText}</p>
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
              {unified?.length === 0 && <SettingsEmpty>{m.noneIncluded}</SettingsEmpty>}
              {unifiedError && <SettingsNotice tone="error">{unifiedError}</SettingsNotice>}
            </div>
          )}
        </SettingsGroup>
      )}

      {writable.length > 0 && (
        <SettingsGroup title={places.calendar}>
          <ChoiceRow
            title={m.newEventCalendar}
            description={m.newEventCalendarText}
            value={chosenCalendar}
            options={[PRINCIPAL, ...writable.map((calendar) => calendar.key)]}
            words={(key) => {
              if (key === PRINCIPAL) {
                return m.principal
              }

              const calendar = writable.find((candidate) => candidate.key === key)
              return calendar ? `${calendar.name} · ${calendar.connection}` : key
            }}
            label={m.newEventCalendar}
            width="w-60"
            onChange={(key) => onChange({ newEventCalendarKey: key === PRINCIPAL ? null : key })}
          />
          <ChoiceRow
            title={m.newEventLength}
            description={m.newEventLengthText}
            value={String(preferences.newEventMinutes)}
            options={NEW_EVENT_MINUTES.map(String)}
            words={(minutes) => minutesWords(m, Number(minutes))}
            label={m.newEventLength}
            width="w-44"
            onChange={(minutes) => onChange({ newEventMinutes: Number(minutes) })}
          />
        </SettingsGroup>
      )}
    </SettingsPage>
  )
}
