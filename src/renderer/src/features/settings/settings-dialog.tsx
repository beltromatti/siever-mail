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
import { cn } from '@renderer/lib/utils'
import type { CalendarConnection } from '@shared/calendar'
import type { AccountConnectionState, MailAccount, UiPreferences } from '@shared/models'

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
 * it keeps, and whose edition it is.
 */
const CORE_SETTINGS_GROUPS: SettingsSection[][] = [
  [
    {
      id: 'accounts',
      label: 'Connessioni',
      title: 'Connessioni',
      description:
        'La posta, i calendari e i file che SIEVER Mail raggiunge, alla pari: ognuno una connessione a sé, raggruppati per accesso.',
      icon: AtSign
    },
    {
      id: 'segretario',
      label: 'Segretario',
      title: 'Segretario',
      description: 'Se lavora per te, con quale chiave, e quanto spende.',
      icon: CompassStar
    },
    {
      id: 'memoria',
      label: 'Cosa so di te',
      title: 'Cosa so di te',
      description: 'Come il Segretario ti conosce, e le sue note: leggile e correggile.',
      icon: NotebookPen
    }
  ],
  [
    {
      id: 'preferences',
      label: 'Preferenze',
      title: 'Preferenze',
      description: 'Come si presenta SIEVER Mail, e come lavorano le sue app.',
      icon: SlidersHorizontal
    },
    {
      id: 'notifications',
      label: 'Notifiche',
      title: 'Notifiche',
      description: "Ciò che ti interrompe, app per app, e il numero sull'icona.",
      icon: Bell
    },
    {
      id: 'shortcuts',
      label: 'Scorciatoie',
      title: 'Scorciatoie da tastiera',
      description: 'I tasti che eseguono ogni comando, app per app.',
      icon: Keyboard
    },
    {
      id: 'signatures',
      label: 'Intestazione e firma',
      title: 'Intestazione e firma',
      description: 'Ciò che ogni casella mette in cima e in fondo ai messaggi che scrivi da lì.',
      icon: Signature
    }
  ],
  [
    {
      id: 'data',
      label: 'Dati',
      title: 'Dati',
      description: 'Ciò che SIEVER Mail tiene su questo computer, e ciò che puoi togliere.',
      icon: Database
    },
    {
      id: 'extension',
      label: 'Estensione',
      title: 'Estensione',
      // A legal name may end with its own full stop ("S.r.l."): the sentence does not add another.
      description: extensionShared.identity
        ? `L’edizione di SIEVER Mail per ${extensionShared.identity.name}`.replace(/\.?$/, '.')
        : 'SIEVER Mail su misura per un’organizzazione.',
      icon: Puzzle
    },
    // The extension's own pages follow its own, under "Estensione"; the public build has none.
    ...extensionRenderer.settingsTabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      title: tab.title,
      description: tab.description,
      icon: tab.icon ?? Blocks
    }))
  ]
]
const SETTINGS_SECTIONS = CORE_SETTINGS_GROUPS.flat()

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
  const activeSection =
    SETTINGS_SECTIONS.find((section) => section.id === activeSectionId) ?? SETTINGS_SECTIONS[0]

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
              <DialogTitle className="display-title text-[17px]">Impostazioni</DialogTitle>
              <DialogDescription className="sr-only">
                Connessioni, Segretario, preferenze, notifiche e dati di SIEVER Mail.
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-col overflow-y-auto">
              {CORE_SETTINGS_GROUPS.map((group, index) => (
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
                  Aggiungi una connessione
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
              <MemorySection onRedoConoscimi={onRedoConoscimi} />
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
