import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, LogOut, Mail, Plus, Save, Trash2 } from 'lucide-react'

import extensionRenderer from '@app/extension/renderer'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { RichTextEditor } from '@renderer/features/mail/rich-text-editor'
import { cn } from '@renderer/lib/utils'
import type { DataStorageBreakdown, MailAccount } from '@shared/models'

type SettingsSectionId = 'accounts' | 'preferences' | 'data' | 'signatures' | string

interface SettingsSection {
  id: SettingsSectionId
  label: string
  title: string
  description: string
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: MailAccount[]
  selectedAccountId: string | null
  removingAccountId: string | null
  clearingAccountDataId: string | null
  clearingDatabaseData: boolean
  onRemoveAccount: (accountId: string) => void
  onClearAccountData: (accountId: string) => void
  onClearDatabaseData: () => void
  onAddAccount: () => void
  onUnifiedInboxPreferencesChanged: () => void
}

const CORE_SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'accounts',
    label: 'Accounts',
    title: 'Accounts',
    description: 'Configura e gestisci gli account email collegati.'
  },
  {
    id: 'preferences',
    label: 'Preferenze',
    title: 'Preferenze',
    description: "Configura le preferenze generali dell'applicazione."
  },
  {
    id: 'data',
    label: 'Dati',
    title: 'Dati',
    description: 'Gestisci archiviazione locale, cache e preferenze dati.'
  },
  {
    id: 'signatures',
    label: 'Firme',
    title: 'Firme',
    description: 'Configura firme per gli account e per la composizione messaggi.'
  }
]

// The active extension contributes additional tabs after the core ones. In
// the public build `extensionRenderer.settingsTabs` is an empty array, so
// the dialog renders exactly the core tabs without any extension residue.
const SETTINGS_SECTIONS: SettingsSection[] = [
  ...CORE_SETTINGS_SECTIONS,
  ...extensionRenderer.settingsTabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    title: tab.title,
    description: tab.description
  }))
]

const ACCOUNT_SEGMENT_COLOR_CLASSES = [
  'bg-primary',
  'bg-accent',
  'bg-secondary',
  'bg-primary/70',
  'bg-accent/70',
  'bg-secondary/70'
]
const GLOBAL_SEGMENT_COLOR_CLASS = 'bg-muted-foreground'

function formatMegabytes(sizeBytes: number): string {
  const megabytes = Math.max(0, sizeBytes) / (1024 * 1024)

  if (megabytes >= 100) {
    return `${megabytes.toFixed(0)} MB`
  }

  if (megabytes >= 10) {
    return `${megabytes.toFixed(1)} MB`
  }

  return `${megabytes.toFixed(2)} MB`
}

function normalizeSignatureHtmlForComparison(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()

  if (!trimmed) {
    return ''
  }

  const hasEmbeddedMedia = /<(?:img|svg|video|audio)\b/i.test(trimmed)
  const visibleText = trimmed
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!visibleText && !hasEmbeddedMedia) {
    return ''
  }

  return trimmed
}

export function SettingsDialog({
  open,
  onOpenChange,
  accounts,
  selectedAccountId,
  removingAccountId,
  clearingAccountDataId,
  clearingDatabaseData,
  onRemoveAccount,
  onClearAccountData,
  onClearDatabaseData,
  onAddAccount,
  onUnifiedInboxPreferencesChanged
}: SettingsDialogProps): React.JSX.Element {
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>('accounts')
  const [dataBreakdown, setDataBreakdown] = useState<DataStorageBreakdown | null>(null)
  const [dataBreakdownLoading, setDataBreakdownLoading] = useState(false)
  const [dataBreakdownError, setDataBreakdownError] = useState<string | null>(null)
  const [signaturesByAccountId, setSignaturesByAccountId] = useState<Record<string, string>>({})
  const [signatureDraftsByAccountId, setSignatureDraftsByAccountId] = useState<
    Record<string, string>
  >({})
  const [signatureAccountId, setSignatureAccountId] = useState<string | null>(null)
  const [signaturesLoading, setSignaturesLoading] = useState(false)
  const [signatureSavingAccountId, setSignatureSavingAccountId] = useState<string | null>(null)
  const [signaturesError, setSignaturesError] = useState<string | null>(null)
  const [signaturesStatusMessage, setSignaturesStatusMessage] = useState<string | null>(null)
  const [unifiedInboxIncludedAccountIds, setUnifiedInboxIncludedAccountIds] = useState<string[]>([])
  const [unifiedInboxDraftIncludedAccountIds, setUnifiedInboxDraftIncludedAccountIds] = useState<
    string[]
  >([])
  const [unifiedInboxPreferencesLoading, setUnifiedInboxPreferencesLoading] = useState(false)
  const [unifiedInboxPreferencesSaving, setUnifiedInboxPreferencesSaving] = useState(false)
  const [unifiedInboxPreferencesError, setUnifiedInboxPreferencesError] = useState<string | null>(
    null
  )
  const [unifiedInboxPreferencesStatusMessage, setUnifiedInboxPreferencesStatusMessage] = useState<
    string | null
  >(null)

  const activeSection =
    SETTINGS_SECTIONS.find((section) => section.id === activeSectionId) ?? SETTINGS_SECTIONS[0]

  useEffect(() => {
    if (!open || activeSectionId !== 'preferences') {
      return
    }

    let disposed = false
    setUnifiedInboxPreferencesLoading(true)
    setUnifiedInboxPreferencesError(null)
    setUnifiedInboxPreferencesStatusMessage(null)

    void window.mailApi
      .getUnifiedInboxPreferences()
      .then((preferences) => {
        if (disposed) {
          return
        }

        const accountIdSet = new Set(accounts.map((account) => account.id))
        const normalizedIncludedAccountIds = Array.from(
          new Set(
            preferences.includedAccountIds
              .map((accountId) => accountId.trim())
              .filter((accountId) => accountIdSet.has(accountId))
          )
        )

        setUnifiedInboxIncludedAccountIds(normalizedIncludedAccountIds)
        setUnifiedInboxDraftIncludedAccountIds(normalizedIncludedAccountIds)
      })
      .catch((caughtError: unknown) => {
        if (disposed) {
          return
        }

        const message =
          caughtError instanceof Error && caughtError.message.trim()
            ? caughtError.message
            : 'Caricamento preferenze TUTTI non riuscito.'
        setUnifiedInboxPreferencesError(message)
      })
      .finally(() => {
        if (!disposed) {
          setUnifiedInboxPreferencesLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [accounts, activeSectionId, open])

  useEffect(() => {
    if (!open || activeSectionId !== 'data') {
      return
    }

    let disposed = false
    setDataBreakdownLoading(true)
    setDataBreakdownError(null)

    void window.mailApi
      .getDataStorageBreakdown()
      .then((payload) => {
        if (disposed) {
          return
        }

        setDataBreakdown(payload)
      })
      .catch((caughtError: unknown) => {
        if (disposed) {
          return
        }

        const message =
          caughtError instanceof Error && caughtError.message.trim()
            ? caughtError.message
            : 'Calcolo ripartizione dati non riuscito.'
        setDataBreakdownError(message)
      })
      .finally(() => {
        if (!disposed) {
          setDataBreakdownLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [
    activeSectionId,
    open,
    accounts.length,
    removingAccountId,
    clearingAccountDataId,
    clearingDatabaseData
  ])

  useEffect(() => {
    if (!open || activeSectionId !== 'signatures') {
      return
    }

    setSignatureAccountId((current) => {
      if (current && accounts.some((account) => account.id === current)) {
        return current
      }

      if (selectedAccountId && accounts.some((account) => account.id === selectedAccountId)) {
        return selectedAccountId
      }

      return accounts[0]?.id ?? null
    })
  }, [accounts, activeSectionId, open, selectedAccountId])

  useEffect(() => {
    if (!open || activeSectionId !== 'signatures') {
      return
    }

    let disposed = false
    setSignaturesLoading(true)
    setSignaturesError(null)
    setSignaturesStatusMessage(null)

    void window.mailApi
      .listAccountSignatures()
      .then((signatures) => {
        if (disposed) {
          return
        }

        const normalizedSignaturesByAccountId: Record<string, string> = {}

        for (const signature of signatures) {
          normalizedSignaturesByAccountId[signature.accountId] = signature.html
        }

        const emptyAwareDrafts: Record<string, string> = {}

        for (const account of accounts) {
          emptyAwareDrafts[account.id] = normalizedSignaturesByAccountId[account.id] ?? ''
        }

        setSignaturesByAccountId(normalizedSignaturesByAccountId)
        setSignatureDraftsByAccountId(emptyAwareDrafts)
      })
      .catch((caughtError: unknown) => {
        if (disposed) {
          return
        }

        const message =
          caughtError instanceof Error && caughtError.message.trim()
            ? caughtError.message
            : 'Caricamento firme non riuscito.'
        setSignaturesError(message)
      })
      .finally(() => {
        if (!disposed) {
          setSignaturesLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [accounts, activeSectionId, open])

  const anyAccountMutationInFlight = Boolean(
    removingAccountId || clearingAccountDataId || clearingDatabaseData
  )
  const selectedSignatureDraft = signatureAccountId
    ? (signatureDraftsByAccountId[signatureAccountId] ?? '')
    : ''
  const selectedSavedSignature = signatureAccountId
    ? (signaturesByAccountId[signatureAccountId] ?? '')
    : ''
  const selectedSignatureDirty =
    normalizeSignatureHtmlForComparison(selectedSignatureDraft) !==
    normalizeSignatureHtmlForComparison(selectedSavedSignature)
  const signatureActionBlocked =
    !signatureAccountId ||
    anyAccountMutationInFlight ||
    signaturesLoading ||
    Boolean(signatureSavingAccountId)

  const saveSignature = async (signatureHtmlOverride?: string): Promise<void> => {
    if (!signatureAccountId || signatureActionBlocked) {
      return
    }

    setSignaturesError(null)
    setSignaturesStatusMessage(null)
    setSignatureSavingAccountId(signatureAccountId)

    try {
      const savedSignature = await window.mailApi.setAccountSignature(
        signatureAccountId,
        signatureHtmlOverride ?? selectedSignatureDraft
      )
      const persistedHtml = savedSignature?.html ?? ''

      setSignaturesByAccountId((current) => ({
        ...current,
        [signatureAccountId]: persistedHtml
      }))
      setSignatureDraftsByAccountId((current) => ({
        ...current,
        [signatureAccountId]: persistedHtml
      }))
      setSignaturesStatusMessage(persistedHtml ? 'Firma salvata.' : 'Firma rimossa.')
    } catch (caughtError) {
      setSignaturesError(
        caughtError instanceof Error ? caughtError.message : 'Salvataggio firma non riuscito.'
      )
    } finally {
      setSignatureSavingAccountId((current) => (current === signatureAccountId ? null : current))
    }
  }

  const clearSignature = async (): Promise<void> => {
    if (!signatureAccountId || signatureActionBlocked) {
      return
    }

    setSignatureDraftsByAccountId((current) => ({
      ...current,
      [signatureAccountId]: ''
    }))

    await saveSignature('')
  }

  const dataSections = useMemo(() => {
    if (!dataBreakdown) {
      return []
    }

    const totalBytes = Math.max(0, dataBreakdown.totalBytes)
    let accountColorIndex = 0

    return dataBreakdown.sections
      .filter((section) => section.sizeBytes > 0)
      .map((section) => {
        const colorClass =
          section.kind === 'global'
            ? GLOBAL_SEGMENT_COLOR_CLASS
            : ACCOUNT_SEGMENT_COLOR_CLASSES[
                accountColorIndex++ % ACCOUNT_SEGMENT_COLOR_CLASSES.length
              ] || ACCOUNT_SEGMENT_COLOR_CLASSES[0]

        return {
          ...section,
          colorClass,
          ratio: totalBytes > 0 ? section.sizeBytes / totalBytes : 0
        }
      })
  }, [dataBreakdown])
  const normalizedUnifiedInboxIncludedAccountIds = useMemo(
    () => Array.from(new Set(unifiedInboxIncludedAccountIds)),
    [unifiedInboxIncludedAccountIds]
  )
  const normalizedUnifiedInboxDraftIncludedAccountIds = useMemo(
    () => Array.from(new Set(unifiedInboxDraftIncludedAccountIds)),
    [unifiedInboxDraftIncludedAccountIds]
  )
  const unifiedInboxPreferencesDirty = useMemo(() => {
    if (
      normalizedUnifiedInboxIncludedAccountIds.length !==
      normalizedUnifiedInboxDraftIncludedAccountIds.length
    ) {
      return true
    }

    const includedAccountIdsSet = new Set(normalizedUnifiedInboxIncludedAccountIds)

    return normalizedUnifiedInboxDraftIncludedAccountIds.some(
      (accountId) => !includedAccountIdsSet.has(accountId)
    )
  }, [normalizedUnifiedInboxDraftIncludedAccountIds, normalizedUnifiedInboxIncludedAccountIds])

  const saveUnifiedInboxPreferences = async (): Promise<void> => {
    if (
      unifiedInboxPreferencesSaving ||
      unifiedInboxPreferencesLoading ||
      anyAccountMutationInFlight
    ) {
      return
    }

    setUnifiedInboxPreferencesError(null)
    setUnifiedInboxPreferencesStatusMessage(null)
    setUnifiedInboxPreferencesSaving(true)

    try {
      const savedPreferences = await window.mailApi.setUnifiedInboxIncludedAccounts(
        normalizedUnifiedInboxDraftIncludedAccountIds
      )
      const normalizedSavedIncludedAccountIds = Array.from(
        new Set(savedPreferences.includedAccountIds.map((accountId) => accountId.trim()))
      )

      setUnifiedInboxIncludedAccountIds(normalizedSavedIncludedAccountIds)
      setUnifiedInboxDraftIncludedAccountIds(normalizedSavedIncludedAccountIds)
      setUnifiedInboxPreferencesStatusMessage('Preferenze TUTTI salvate.')
      onUnifiedInboxPreferencesChanged()
    } catch (caughtError) {
      setUnifiedInboxPreferencesError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Salvataggio preferenze TUTTI non riuscito.'
      )
    } finally {
      setUnifiedInboxPreferencesSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(720px,calc(100vh-2rem))] w-[min(1080px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)] content-start gap-3 overflow-hidden">
        <DialogHeader className="pr-10">
          <DialogTitle>Impostazioni</DialogTitle>
          <DialogDescription>
            Personalizza configurazioni applicazione, account e scrittura email.
          </DialogDescription>
        </DialogHeader>

        <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-4">
          <nav className="border-border bg-card/40 h-full overflow-y-auto rounded-lg border p-2">
            <ul className="space-y-1">
              {SETTINGS_SECTIONS.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    className={cn(
                      'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                      section.id === activeSectionId
                        ? 'bg-primary/18 text-foreground border-primary/45 border'
                        : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground border border-transparent'
                    )}
                    onClick={() => setActiveSectionId(section.id)}
                  >
                    {section.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="border-border bg-card/30 flex h-full min-h-0 flex-col rounded-lg border p-4">
            <h3 className="display-title text-xl">{activeSection.title}</h3>
            <p className="text-muted-foreground mt-1 text-sm">{activeSection.description}</p>
            {activeSectionId === 'accounts' ? (
              <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {accounts.length === 0 ? (
                    <div className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-6 text-sm">
                      Nessun account collegato.
                    </div>
                  ) : (
                    accounts.map((account) => (
                      <div
                        key={account.id}
                        className="border-border bg-card/55 flex items-start gap-3 rounded-md border p-3"
                      >
                        <div className="bg-primary/15 text-primary mt-0.5 rounded-md p-1.5">
                          <Mail className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold">{account.displayName}</p>
                            {account.id === selectedAccountId && (
                              <Badge variant="muted" className="h-5 px-1.5 text-[10px]">
                                Attivo
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground truncate text-xs">{account.email}</p>
                        </div>
                        <TooltipProvider delayDuration={90}>
                          <div className="mt-0.5 flex shrink-0 items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-destructive"
                                    aria-label={`Disconnetti account ${account.email}`}
                                    disabled={anyAccountMutationInFlight}
                                    onClick={() => onRemoveAccount(account.id)}
                                  >
                                    {removingAccountId === account.id ? (
                                      <LoaderCircle className="size-4 animate-spin" />
                                    ) : (
                                      <LogOut className="size-4" />
                                    )}
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">Disconnetti account</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </div>
                    ))
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit gap-2"
                  disabled={anyAccountMutationInFlight}
                  onClick={onAddAccount}
                >
                  <Plus className="size-4" />
                  Aggiungi account
                </Button>
              </div>
            ) : activeSectionId === 'preferences' ? (
              <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                <div className="border-border bg-card/55 rounded-md border p-3">
                  <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">Tema</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Aspetto dell&apos;applicazione. Il tema scuro è quello predefinito.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="gap-2"
                      aria-pressed="true"
                    >
                      Scuro
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => {
                        window.alert('Il tema chiaro sarà disponibile nelle prossime versioni.')
                      }}
                    >
                      Chiaro
                    </Button>
                  </div>
                </div>

                <div className="border-border bg-card/55 flex flex-col rounded-md border p-3">
                  <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">
                    Cartella TUTTI
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Seleziona quali account includere nella cartella TUTTI. Le inbox degli account
                    esclusi non verranno aggregate e non verranno sincronizzate per TUTTI.
                  </p>

                  {accounts.length === 0 ? (
                    <div className="border-border text-muted-foreground mt-3 rounded-md border border-dashed px-3 py-3 text-sm">
                      Collega almeno un account per configurare la cartella TUTTI.
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="space-y-2">
                        {unifiedInboxPreferencesLoading ? (
                          <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-4 py-4 text-sm">
                            <LoaderCircle className="size-4 animate-spin" />
                            Caricamento preferenze TUTTI...
                          </div>
                        ) : (
                          accounts.map((account) => {
                            const included = normalizedUnifiedInboxDraftIncludedAccountIds.includes(
                              account.id
                            )

                            return (
                              <div
                                key={`unified-inbox-preference-${account.id}`}
                                className="border-border/70 bg-card/45 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {account.displayName || account.email}
                                  </p>
                                  <p className="text-muted-foreground truncate text-xs">
                                    {account.email}
                                  </p>
                                </div>

                                <Button
                                  type="button"
                                  variant={included ? 'default' : 'outline'}
                                  size="sm"
                                  className="shrink-0"
                                  disabled={
                                    unifiedInboxPreferencesSaving || anyAccountMutationInFlight
                                  }
                                  onClick={() => {
                                    setUnifiedInboxDraftIncludedAccountIds((current) => {
                                      if (current.includes(account.id)) {
                                        return current.filter(
                                          (includedAccountId) => includedAccountId !== account.id
                                        )
                                      }

                                      return [...current, account.id]
                                    })
                                  }}
                                >
                                  {included ? 'Incluso' : 'Escluso'}
                                </Button>
                              </div>
                            )
                          })
                        )}
                      </div>

                      {normalizedUnifiedInboxDraftIncludedAccountIds.length === 0 && (
                        <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
                          Nessun account incluso: la cartella TUTTI risultera vuota.
                        </div>
                      )}

                      {unifiedInboxPreferencesError && (
                        <div className="text-destructive-foreground border-destructive/35 bg-destructive/10 rounded-md border px-3 py-2 text-sm">
                          {unifiedInboxPreferencesError}
                        </div>
                      )}

                      {unifiedInboxPreferencesStatusMessage && !unifiedInboxPreferencesError && (
                        <div className="border-border bg-card/55 text-muted-foreground rounded-md border px-3 py-2 text-sm">
                          {unifiedInboxPreferencesStatusMessage}
                        </div>
                      )}

                      <div>
                        <Button
                          type="button"
                          className="gap-2"
                          onClick={() => void saveUnifiedInboxPreferences()}
                          disabled={
                            unifiedInboxPreferencesLoading ||
                            unifiedInboxPreferencesSaving ||
                            anyAccountMutationInFlight ||
                            !unifiedInboxPreferencesDirty
                          }
                        >
                          {unifiedInboxPreferencesSaving ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Save className="size-4" />
                          )}
                          Salva preferenze
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : activeSectionId === 'data' ? (
              <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                <div className="border-border bg-card/55 rounded-md border p-3">
                  <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">
                    Totale Database
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatMegabytes(dataBreakdown?.totalBytes ?? 0)}
                  </p>
                </div>

                <div className="border-border bg-card/55 flex flex-col rounded-md border p-3">
                  {dataBreakdownLoading ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                      <LoaderCircle className="size-4 animate-spin" />
                      Calcolo ripartizione dati...
                    </div>
                  ) : dataBreakdownError ? (
                    <div className="text-destructive-foreground border-destructive/35 bg-destructive/10 rounded-md border px-3 py-2 text-sm">
                      {dataBreakdownError}
                    </div>
                  ) : dataSections.length === 0 ? (
                    <div className="text-muted-foreground py-6 text-sm">
                      Nessun dato disponibile da visualizzare.
                    </div>
                  ) : (
                    <>
                      <TooltipProvider delayDuration={90}>
                        <div className="bg-muted/45 flex h-8 w-full overflow-hidden rounded-md">
                          {dataSections.map((section) => (
                            <Tooltip key={section.id}>
                              <TooltipTrigger asChild>
                                <div
                                  className={cn(
                                    'h-full transition-opacity hover:opacity-90',
                                    section.colorClass
                                  )}
                                  style={{ width: `${Math.max(0, section.ratio * 100)}%` }}
                                  aria-label={`${section.label}: ${formatMegabytes(section.sizeBytes)}`}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {section.label}: {formatMegabytes(section.sizeBytes)}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </TooltipProvider>

                      <div className="mt-3 space-y-2">
                        {dataSections.map((section) => (
                          <div
                            key={`legend-${section.id}`}
                            className="border-border/70 bg-card/45 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={cn('size-2.5 shrink-0 rounded-full', section.colorClass)}
                              />
                              <span className="truncate">{section.label}</span>
                            </div>
                            <span className="text-muted-foreground shrink-0">
                              {formatMegabytes(section.sizeBytes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="border-border bg-card/55 rounded-md border p-3">
                  <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">
                    Cancella dati per account
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Reimposta a zero i dati locali di un singolo account mantenendo il login attivo.
                    Il bootstrap riparte come alla prima connessione.
                  </p>
                  {accounts.length === 0 ? (
                    <div className="border-border text-muted-foreground mt-3 rounded-md border border-dashed px-3 py-3 text-sm">
                      Nessun account collegato.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {accounts.map((account) => (
                        <div
                          key={`clear-${account.id}`}
                          className="border-border/70 bg-card/45 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{account.displayName}</p>
                            <p className="text-muted-foreground truncate text-xs">
                              {account.email}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive shrink-0 gap-1.5"
                            disabled={anyAccountMutationInFlight}
                            onClick={() => onClearAccountData(account.id)}
                          >
                            {clearingAccountDataId === account.id ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                            Cancella
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-destructive/35 bg-destructive/5 rounded-md border p-3">
                  <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">
                    Azione nucleare
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Cancella ogni dato locale (email, cartelle, contatti, firme, pratiche,
                    impostazioni archivio). Gli account restano collegati e il bootstrap riparte in
                    parallelo per ognuno.
                  </p>
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="destructive"
                      className="gap-2"
                      disabled={clearingDatabaseData || anyAccountMutationInFlight}
                      onClick={onClearDatabaseData}
                    >
                      {clearingDatabaseData ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Elimina tutti i dati
                    </Button>
                  </div>
                </div>
              </div>
            ) : activeSectionId === 'signatures' ? (
              <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                {accounts.length === 0 ? (
                  <div className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-6 text-sm">
                    Collega almeno un account per configurare le firme.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <div>
                        <p className="text-muted-foreground mb-1 text-xs tracking-[0.08em] uppercase">
                          Account
                        </p>
                        <Select
                          value={signatureAccountId ?? undefined}
                          onValueChange={(nextAccountId) => {
                            setSignatureAccountId(nextAccountId)
                            setSignaturesError(null)
                            setSignaturesStatusMessage(null)
                          }}
                          disabled={signaturesLoading || anyAccountMutationInFlight}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona account" />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.displayName || account.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-2"
                          disabled={
                            signatureActionBlocked ||
                            !normalizeSignatureHtmlForComparison(selectedSignatureDraft)
                          }
                          onClick={() => void clearSignature()}
                        >
                          {signatureSavingAccountId === signatureAccountId ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                          Rimuovi firma
                        </Button>
                        <Button
                          type="button"
                          className="gap-2"
                          disabled={signatureActionBlocked || !selectedSignatureDirty}
                          onClick={() => void saveSignature()}
                        >
                          {signatureSavingAccountId === signatureAccountId ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Save className="size-4" />
                          )}
                          Salva firma
                        </Button>
                      </div>
                    </div>

                    {signaturesLoading ? (
                      <div className="text-muted-foreground flex min-h-0 flex-1 items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm">
                        <LoaderCircle className="size-4 animate-spin" />
                        Caricamento firme...
                      </div>
                    ) : (
                      <div className="min-h-0 flex-1">
                        <RichTextEditor
                          value={selectedSignatureDraft}
                          placeholder="Scrivi la firma per questo account..."
                          disabled={!signatureAccountId || anyAccountMutationInFlight}
                          showExpandToggle={false}
                          onChange={(html) => {
                            if (!signatureAccountId) {
                              return
                            }

                            setSignatureDraftsByAccountId((current) => ({
                              ...current,
                              [signatureAccountId]: html
                            }))
                          }}
                        />
                      </div>
                    )}

                    {signaturesError && (
                      <div className="text-destructive-foreground border-destructive/35 bg-destructive/10 rounded-md border px-3 py-2 text-sm">
                        {signaturesError}
                      </div>
                    )}

                    {signaturesStatusMessage && !signaturesError && (
                      <div className="border-border bg-card/55 text-muted-foreground rounded-md border px-3 py-2 text-sm">
                        {signaturesStatusMessage}
                      </div>
                    )}
                  </>
                )}
              </div>
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
