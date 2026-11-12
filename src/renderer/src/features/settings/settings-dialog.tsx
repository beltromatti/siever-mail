import { Fragment, useEffect, useState, type ComponentType } from 'react'
import {
  AtSign,
  Bell,
  Blocks,
  Database,
  Keyboard,
  NotebookPen,
  Plus,
  Puzzle,
  Signature,
  SlidersHorizontal
} from 'lucide-react'

import extensionRenderer from '@app/extension/renderer'
import extensionShared from '@app/extension/shared'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { ConnectionsList } from '@renderer/features/connections/connections-list'
import { DataSection } from '@renderer/features/settings/data-section'
import { ExtensionSection } from '@renderer/features/settings/extension-section'
import { MemorySection } from '@renderer/features/settings/memory-section'
import { NotificationsSection } from '@renderer/features/settings/notifications-section'
import { PreferencesSection } from '@renderer/features/settings/preferences-section'
import { SegretarioSection } from '@renderer/features/settings/segretario-section'
import { ShortcutsSection } from '@renderer/features/settings/shortcuts-section'
import { SignaturesSection } from '@renderer/features/settings/signatures-section'
import { AppEdition } from '@renderer/features/workspace/app-edition'
import { uiLog } from '@renderer/lib/diagnostics'
import { useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarConnection } from '@shared/calendar'
import { defineMessages, localized, type Language, type Messages } from '@shared/i18n'
import type { AccountConnectionState, MailAccount, UiPreferences } from '@shared/models'
import { PLACES } from '@shared/places'

const MESSAGES = defineMessages({
  accountsText: {
    en: 'The mail, calendars and files SIEVER Mail reaches, as equals: each a connection of its own, grouped by sign-in.',
    it: 'La posta, i calendari e i file che SIEVER Mail raggiunge, alla pari: ognuno una connessione a sé, raggruppati per accesso.',
    de: 'Die E-Mails, Kalender und Dateien, die SIEVER Mail erreicht, gleichrangig: jede eine eigene Verbindung, nach Zugang gruppiert.'
  },
  segretarioText: {
    en: 'Whether it works for you, with which key, and how much it spends.',
    it: 'Se lavora per te, con quale chiave, e quanto spende.',
    de: 'Ob er für Sie arbeitet, mit welchem Schlüssel und wie viel er ausgibt.'
  },
  memoryText: {
    en: 'How the Segretario knows you, and its notes: read them and correct them.',
    it: 'Come il Segretario ti conosce, e le sue note: leggile e correggile.',
    de: 'Wie der Segretario Sie kennt, und seine Notizen: Lesen und korrigieren Sie sie.'
  },
  preferencesText: {
    en: 'How SIEVER Mail looks, and how its apps work.',
    it: 'Come si presenta SIEVER Mail, e come lavorano le sue app.',
    de: 'Wie SIEVER Mail aussieht und wie seine Apps arbeiten.'
  },
  notificationsText: {
    en: 'What interrupts you, app by app, and the number on the icon.',
    it: "Ciò che ti interrompe, app per app, e il numero sull'icona.",
    de: 'Was Sie unterbricht, App für App, und die Zahl auf dem Symbol.'
  },
  shortcutsTitle: {
    en: 'Keyboard shortcuts',
    it: 'Scorciatoie da tastiera',
    de: 'Tastenkürzel'
  },
  shortcutsText: {
    en: 'The keys that run each command, app by app.',
    it: 'I tasti che eseguono ogni comando, app per app.',
    de: 'Die Tasten, die jeden Befehl ausführen, App für App.'
  },
  signaturesText: {
    en: 'What each mailbox puts at the top and bottom of the messages you write from it.',
    it: 'Ciò che ogni casella mette in cima e in fondo ai messaggi che scrivi da lì.',
    de: 'Was jedes Postfach an den Anfang und das Ende der Nachrichten setzt, die Sie von dort schreiben.'
  },
  dataText: {
    en: 'What SIEVER Mail keeps on this computer, and what you can remove.',
    it: 'Ciò che SIEVER Mail tiene su questo computer, e ciò che puoi togliere.',
    de: 'Was SIEVER Mail auf diesem Computer aufbewahrt, und was Sie entfernen können.'
  },
  editionFor: {
    en: (name: string) => `SIEVER Mail’s edition for ${name}`,
    it: (name: string) => `L’edizione di SIEVER Mail per ${name}`,
    de: (name: string) => `Die Ausgabe von SIEVER Mail für ${name}`
  },
  extensionText: {
    en: 'SIEVER Mail tailored to an organization.',
    it: 'SIEVER Mail su misura per un’organizzazione.',
    de: 'SIEVER Mail, zugeschnitten auf eine Organisation.'
  },
  summary: {
    en: 'SIEVER Mail’s connections, Segretario, preferences, notifications and data.',
    it: 'Connessioni, Segretario, preferenze, notifiche e dati di SIEVER Mail.',
    de: 'Verbindungen, Segretario, Einstellungen, Benachrichtigungen und Daten von SIEVER Mail.'
  },
  addConnection: {
    en: 'Add a connection',
    it: 'Aggiungi una connessione',
    de: 'Verbindung hinzufügen'
  }
})

export type SettingsSectionId =
  | 'accounts'
  | 'preferences'
  | 'segretario'
  | 'memoria'
  | 'notifications'
  | 'shortcuts'
  | 'data'
  | 'signatures'
  | 'extension'
  | (string & {})

interface SettingsSection {
  id: SettingsSectionId
  label: string
  title: string
  description: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The section to show as it opens; without one it opens where it was left. */
  initialSectionId?: SettingsSectionId | null
  accounts: MailAccount[]
  /** How each mail connection stands. */
  mailStates: Readonly<Record<string, AccountConnectionState | undefined>>
  googleReady: boolean
  microsoftReady: boolean
  selectedAccountId: string | null
  removingAccountId: string | null
  clearingAccountDataId: string | null
  clearingDatabaseData: boolean
  /** Every persisted view preference, as the workspace currently has it. */
  uiPreferences: UiPreferences
  /** Persists a subset of the preferences and adopts the stored result. */
  onUiPreferencesChange: (patch: Partial<UiPreferences>) => void
  /** Removes a mail connection and the calendars given, after asking the user. */
  onRemoveAccount: (accountId: string, calendars: ReadonlyArray<CalendarConnection>) => void
  onClearAccountData: (accountId: string) => void
  onClearDatabaseData: () => void
  onAddAccount: () => void
  /** The calendar a mailbox's account can give: a connection of its own, added in the guided setup. */
  onAddCalendar: (mailAccountId: string) => void
  /** Whether the AI is on: what removing a connection says follows it. */
  aiOn: boolean
  /** The AI switched on: the guided setup takes it from there. */
  onEnableAi: () => void
  /** Conoscimi asked again: the guided setup runs it. */
  onRedoConoscimi: () => void
  /** The mailboxes «Tutte le caselle» gathers changed. */
  onUnifiedPreferencesChanged: () => void
}

/**
 * The pages, in three groups as the rail's apps are (§13.1, §13.2): what
 * SIEVER Mail is for the user — what it reaches, and whether the
 * Segretario works for them —; how it looks and behaves, app by app; what
 * it keeps, and whose edition it is. Named in the interface's language.
 */
function settingsGroups(
  m: Messages<typeof MESSAGES>,
  places: Messages<typeof PLACES>,
  language: Language
): SettingsSection[][] {
  return [
    [
      {
        id: 'accounts',
        label: places.connections,
        title: places.connections,
        description: m.accountsText,
        icon: AtSign
      },
      {
        id: 'segretario',
        label: places.segretario,
        title: places.segretario,
        description: m.segretarioText,
        icon: CompassStar
      },
      {
        id: 'memoria',
        label: places.aboutYou,
        title: places.aboutYou,
        description: m.memoryText,
        icon: NotebookPen
      }
    ],
    [
      {
        id: 'preferences',
        label: places.preferences,
        title: places.preferences,
        description: m.preferencesText,
        icon: SlidersHorizontal
      },
      {
        id: 'notifications',
        label: places.notifications,
        title: places.notifications,
        description: m.notificationsText,
        icon: Bell
      },
      {
        id: 'shortcuts',
        label: places.shortcuts,
        title: m.shortcutsTitle,
        description: m.shortcutsText,
        icon: Keyboard
      },
      {
        id: 'signatures',
        label: places.letterhead,
        title: places.letterhead,
        description: m.signaturesText,
        icon: Signature
      }
    ],
    [
      {
        id: 'data',
        label: places.data,
        title: places.data,
        description: m.dataText,
        icon: Database
      },
      {
        id: 'extension',
        label: places.extension,
        title: places.extension,
        // A legal name may end with its own full stop ("S.r.l."): the sentence does not add another.
        description: extensionShared.identity
          ? m.editionFor(extensionShared.identity.name).replace(/\.?$/, '.')
          : m.extensionText,
        icon: Puzzle
      },
      // The extension's own pages follow its own, under "Extension"; the public build has none.
      ...extensionRenderer.settingsTabs.map((tab) => ({
        id: tab.id,
        label: localized(tab.label, language),
        title: localized(tab.title, language),
        description: localized(tab.description, language),
        icon: tab.icon ?? Blocks
      }))
    ]
  ]
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialSectionId,
  accounts,
  mailStates,
  googleReady,
  microsoftReady,
  selectedAccountId,
  removingAccountId,
  clearingAccountDataId,
  clearingDatabaseData,
  uiPreferences,
  onUiPreferencesChange,
  onRemoveAccount,
  onClearAccountData,
  onClearDatabaseData,
  onAddAccount,
  onAddCalendar,
  aiOn,
  onEnableAi,
  onRedoConoscimi,
  onUnifiedPreferencesChanged
}: SettingsDialogProps): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const { language } = useLanguage()
  const groups = settingsGroups(m, places, language)
  const sections = groups.flat()
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(
    initialSectionId ?? 'accounts'
  )
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)

    if (open && initialSectionId) {
      setActiveSectionId(initialSectionId)
    }
  }
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0]

  // Where the user goes in Settings (§14.4).
  useEffect(() => {
    if (open) {
      uiLog.info('settings.open', { section: activeSectionId })
    }
  }, [activeSectionId, open])

  const anyAccountMutationInFlight = Boolean(
    removingAccountId || clearingAccountDataId || clearingDatabaseData
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(700px,calc(100vh-3rem))] w-[min(1000px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0">
        <div className="grid h-full min-h-0 grid-cols-[210px_minmax(0,1fr)]">
          {/* The desk the sections sit on: the same tone as the app's sidebar. */}
          <nav className="bg-background flex h-full min-h-0 flex-col border-r px-3 pt-5 pb-3">
            <DialogHeader className="px-2 pb-4">
              <DialogTitle className="display-title text-[17px]">{places.settings}</DialogTitle>
              <DialogDescription className="sr-only">{m.summary}</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-col overflow-y-auto">
              {groups.map((group, index) => (
                <Fragment key={group[0].id}>
                  {index > 0 && <div aria-hidden className="bg-border mx-2.5 my-2 h-px" />}
                  <ul className="flex flex-col gap-0.5">
                    {group.map((section) => {
                      const Icon = section.icon
                      const active = section.id === activeSectionId

                      return (
                        <li key={section.id}>
                          <button
                            type="button"
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'focus-visible:ring-ring/60 flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-2',
                              active
                                ? 'bg-selected text-foreground'
                                : 'text-muted-foreground hover:bg-hover hover:text-foreground'
                            )}
                            onClick={() => setActiveSectionId(section.id)}
                          >
                            <Icon
                              className={cn(
                                'size-[15px] shrink-0',
                                active
                                  ? section.id === 'segretario'
                                    ? 'text-ai-star'
                                    : 'text-primary-text'
                                  : 'text-faint-foreground'
                              )}
                              strokeWidth={1.8}
                            />
                            <span className="min-w-0 truncate">{section.label}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </Fragment>
              ))}
            </div>
            <AppEdition className="text-faint-foreground mt-auto px-2 pt-3 text-[11px] leading-snug" />
          </nav>

          <section className="page flex h-full min-h-0 flex-col px-7 pt-6 pb-5">
            <h3 className="display-title pr-8 text-[19px] leading-tight">{activeSection.title}</h3>
            <p className="text-muted-foreground mt-1 text-[12.5px]">{activeSection.description}</p>
            {activeSectionId === 'accounts' ? (
              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2.5">
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <ConnectionsList
                    accounts={accounts}
                    mailStates={mailStates}
                    removingAccountId={removingAccountId}
                    googleReady={googleReady}
                    microsoftReady={microsoftReady}
                    aiOn={aiOn}
                    onRemoveMail={onRemoveAccount}
                    onAddCalendar={onAddCalendar}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit gap-2"
                  disabled={anyAccountMutationInFlight}
                  onClick={onAddAccount}
                >
                  <Plus className="size-4" />
                  {m.addConnection}
                </Button>
              </div>
            ) : activeSectionId === 'preferences' ? (
              <PreferencesSection
                preferences={uiPreferences}
                onChange={onUiPreferencesChange}
                accounts={accounts}
                busy={anyAccountMutationInFlight}
                onUnifiedChanged={onUnifiedPreferencesChanged}
              />
            ) : activeSectionId === 'segretario' ? (
              <SegretarioSection onEnableAi={onEnableAi} />
            ) : activeSectionId === 'memoria' ? (
              <MemorySection accounts={accounts} onRedoConoscimi={onRedoConoscimi} />
            ) : activeSectionId === 'notifications' ? (
              <NotificationsSection accounts={accounts} aiOn={aiOn} />
            ) : activeSectionId === 'shortcuts' ? (
              <ShortcutsSection
                overrides={uiPreferences.shortcutOverrides}
                onChange={(shortcutOverrides) => onUiPreferencesChange({ shortcutOverrides })}
              />
            ) : activeSectionId === 'data' ? (
              <DataSection
                aiOn={aiOn}
                clearingMailboxId={clearingAccountDataId}
                clearingAll={clearingDatabaseData}
                busy={anyAccountMutationInFlight}
                onClearMailbox={onClearAccountData}
                onClearAll={onClearDatabaseData}
                onOpenSegretario={() => setActiveSectionId('segretario')}
              />
            ) : activeSectionId === 'signatures' ? (
              <SignaturesSection
                accounts={accounts}
                selectedAccountId={selectedAccountId}
                busy={anyAccountMutationInFlight}
              />
            ) : activeSectionId === 'extension' ? (
              <ExtensionSection />
            ) : (
              (extensionRenderer.settingsTabs
                .find((tab) => tab.id === activeSectionId)
                ?.render({ active: true, open }) ?? null)
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
