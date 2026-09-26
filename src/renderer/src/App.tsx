import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AlertTriangle, LoaderCircle, LogIn, Minus, Plus, Square, X } from 'lucide-react'
import { toast } from 'sonner'

import appLogo from '@renderer/assets/logo.png'
import { AddAccountDialog } from '@renderer/features/accounts/add-account-dialog'
import { AccountSwitcher } from '@renderer/features/accounts/account-switcher'
import { FolderSidebar } from '@renderer/features/mail/folder-sidebar'
import {
  MailComposerDialog,
  type ComposerInitialData
} from '@renderer/features/mail/mail-composer-dialog'
import { MessageList } from '@renderer/features/mail/message-list'
import { MessageTable } from '@renderer/features/mail/message-table'
import type { MessageListViewProps } from '@renderer/features/mail/message-list-view'
import {
  EMPTY_MESSAGE_HIGHLIGHT_TERMS,
  type MessageHighlightTerms,
  type PrimaryAddressMode
} from '@renderer/features/mail/message-list-shared'
import { SyncStatusIndicator, summarizeSyncStatus } from '@renderer/features/workspace/sync-status'
import { WorkspaceLayout } from '@renderer/features/workspace/workspace-layout'
import extensionRenderer from '@app/extension/renderer'
import type { ExtensionSelectionContext, ExtensionHostHooks } from '@app/extension/types'
import { MessageViewer } from '@renderer/features/mail/message-viewer'
import type { AddressActions } from '@renderer/features/mail/address-tokens'
import { MailToolbar } from '@renderer/features/mail/mail-toolbar'
import { useAttachmentActions } from '@renderer/features/mail/use-attachment-actions'
import { SettingsDialog } from '@renderer/features/settings/settings-dialog'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog, useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { cn, formatAppVersion } from '@renderer/lib/utils'
import { buildMessageSections } from '@renderer/lib/message-sections'
import { buildOutgoingMailHtml } from '@renderer/lib/outgoing-mail-html'
import { READER_ZOOM_RESET, steppedReaderZoom } from '@renderer/lib/reader-zoom'
import {
  applySelectionIntent,
  EMPTY_MESSAGE_SELECTION,
  isSameMessageRef,
  messageRefKey,
  moveSelectionCursor,
  reconcileSelection,
  selectAllMessages,
  summaryToMessageRef,
  uniqueMessageRefs,
  type MessageSelectionState,
  type SelectionIntent
} from '@renderer/lib/message-selection'
import {
  ALL_INBOX_FOLDER_PATH,
  clampReaderZoom,
  DEFAULT_MESSAGE_LIST_FILTER,
  DEFAULT_UI_PREFERENCES,
  MESSAGE_LIST_PAGE_SIZE
} from '@shared/models'
import { highlightTermsForField, parseSearchQuery } from '@shared/search'
import type {
  AccountConnectionState,
  AppCapabilities,
  AppMenuCommand,
  ComposeMailInput,
  ListMessagesOptions,
  MailAccount,
  MailFolder,
  MailMessageDetail,
  MailMessageListPage,
  MailMessageListSort,
  MailMessageSummary,
  MessageGroupingMode,
  MessageListFilter,
  MessageRef,
  UiPreferences,
  UnifiedInboxSummary,
  WindowControlsState
} from '@shared/models'

const ALL_INBOX_FOLDER_LABEL = 'TUTTI'
const GMAIL_QUOTE_BLOCK_STYLE = 'margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex'
const READER_ZOOM_SAVE_DELAY_MS = 400

/** ⌘/Ctrl + key → command. `=` is the unshifted `+` on US keyboards. */
const APP_SHORTCUT_COMMANDS: Readonly<Record<string, AppMenuCommand>> = {
  n: 'compose',
  N: 'compose',
  ',': 'settings',
  '+': 'reader-zoom-in',
  '=': 'reader-zoom-in',
  '-': 'reader-zoom-out',
  '0': 'reader-zoom-reset'
}

/** Folders whose rows are about the recipient rather than the sender. */
const RECIPIENT_ORIENTED_SPECIAL_USES = new Set(['\\Sent', '\\Drafts'])

function htmlFromText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br />')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatQuotedAddress(address: { name?: string; address: string }): string {
  const email = escapeHtml(address.address.trim())
  const displayName = (address.name ?? '').trim()

  if (!displayName) {
    return email
  }

  return `${escapeHtml(displayName)} &lt;${email}&gt;`
}

function formatQuotedAddressList(addresses: Array<{ name?: string; address: string }>): string {
  return addresses.map(formatQuotedAddress).join(', ')
}

function formatQuotedDate(dateIso: string): string {
  const date = new Date(dateIso)

  if (Number.isNaN(date.valueOf())) {
    return dateIso
  }

  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function buildReplyQuoteHtml(message: MailMessageDetail): string {
  const sender = message.from[0]
  const senderLabel = sender ? formatQuotedAddress(sender) : 'Mittente sconosciuto'
  const attributionLine = `Il giorno ${formatQuotedDate(message.date)} ${senderLabel} ha scritto:`
  const quotedBody = message.html ? message.html : htmlFromText(message.text || '')

  return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${attributionLine}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
}

function buildForwardQuoteHtml(message: MailMessageDetail): string {
  const quotedBody = message.html ? message.html : htmlFromText(message.text || '')
  const fromHeader = message.from.length > 0 ? formatQuotedAddressList(message.from) : 'N/D'
  const toHeader = message.to.length > 0 ? formatQuotedAddressList(message.to) : 'N/D'
  const ccHeader = message.cc.length > 0 ? `<br>Cc: ${formatQuotedAddressList(message.cc)}` : ''

  return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Messaggio inoltrato ----------<br>Da: ${fromHeader}<br>Data: ${escapeHtml(formatQuotedDate(message.date))}<br>Oggetto: ${escapeHtml(message.subject)}<br>A: ${toHeader}${ccHeader}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
}

function ensureReplySubject(subject: string): string {
  if (/^re:/i.test(subject.trim())) {
    return subject
  }

  return `Re: ${subject}`
}

function ensureForwardSubject(subject: string): string {
  if (/^fwd:/i.test(subject.trim())) {
    return subject
  }

  return `Fwd: ${subject}`
}

/**
 * Adds or removes one IMAP keyword in a local flag array. Optimistic UI runs
 * through here so a read toggle never drops the flag keyword, mirroring what
 * the database does server-side.
 */
function patchFlag(flags: string[], keyword: string, present: boolean): string[] {
  const withoutKeyword = flags.filter((flag) => flag !== keyword)
  return present ? [...withoutKeyword, keyword] : withoutKeyword
}

function moveAccountToFront(accounts: MailAccount[], accountId: string): MailAccount[] {
  const targetIndex = accounts.findIndex((account) => account.id === accountId)

  if (targetIndex <= 0) {
    return accounts
  }

  const nextAccounts = [...accounts]
  const [targetAccount] = nextAccounts.splice(targetIndex, 1)

  if (!targetAccount) {
    return accounts
  }

  nextAccounts.unshift(targetAccount)
  return nextAccounts
}

/**
 * What TUTTI calls each account on its rows: the display name when no other
 * account in the view shares it, the address otherwise.
 */
function buildAccountLabels(accounts: MailAccount[]): ReadonlyMap<string, string> {
  const nameCounts = new Map<string, number>()

  for (const account of accounts) {
    const name = account.displayName.trim().toLowerCase()

    if (name) {
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
    }
  }

  return new Map(
    accounts.map((account) => {
      const name = account.displayName.trim()
      return [account.id, name && nameCounts.get(name.toLowerCase()) === 1 ? name : account.email]
    })
  )
}

function formatList(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

function useMailBootstrap(): {
  accounts: MailAccount[]
  capabilities: AppCapabilities
  loading: boolean
  error: string | null
  setAccounts: React.Dispatch<React.SetStateAction<MailAccount[]>>
  reload: () => Promise<void>
} {
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [capabilities, setCapabilities] = useState<AppCapabilities>({ googleOAuthReady: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const payload = await window.mailApi.bootstrap()
      setAccounts(payload.accounts)
      setCapabilities(payload.capabilities)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Bootstrap applicazione non riuscito.'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { accounts, capabilities, loading, error, setAccounts, reload }
}

function AppFrame({
  children,
  windowControlsState,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow
}: {
  children: ReactNode
  windowControlsState: WindowControlsState
  onMinimizeWindow: () => void
  onToggleMaximizeWindow: () => void
  onCloseWindow: () => void
}): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={140} skipDelayDuration={300}>
      <div className={cn('h-screen overflow-hidden p-2.5', windowControlsState.enabled && 'pt-9')}>
        {windowControlsState.dragTopRegionEnabled && (
          <div className="window-drag-edge" aria-hidden />
        )}
        {windowControlsState.enabled && (
          <div className="window-no-drag border-border bg-card/90 fixed top-0 right-0 z-[10000] flex overflow-hidden rounded-bl-md border-b border-l backdrop-blur">
            <button
              type="button"
              className="hover:bg-secondary/70 inline-flex h-8 w-10 items-center justify-center transition-colors"
              onClick={onMinimizeWindow}
              aria-label="Minimizza finestra"
              title="Minimizza"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              className="hover:bg-secondary/70 inline-flex h-8 w-10 items-center justify-center transition-colors"
              onClick={onToggleMaximizeWindow}
              aria-label={
                windowControlsState.maximized ? 'Riduci finestra' : 'Ingrandisci finestra'
              }
              title={windowControlsState.maximized ? 'Riduci' : 'Ingrandisci'}
            >
              <Square className="size-3" />
            </button>
            <button
              type="button"
              className="hover:bg-destructive/80 hover:text-destructive-foreground inline-flex h-8 w-10 items-center justify-center transition-colors"
              onClick={onCloseWindow}
              aria-label="Chiudi finestra"
              title="Chiudi"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="h-full min-h-0">{children}</div>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}

function App(): React.JSX.Element {
  const {
    accounts,
    capabilities,
    loading: bootstrapLoading,
    error: bootstrapError,
    setAccounts,
    reload: reloadBootstrap
  } = useMailBootstrap()

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const [messages, setMessages] = useState<MailMessageSummary[]>([])
  const [messageLimit, setMessageLimit] = useState(MESSAGE_LIST_PAGE_SIZE)
  const [totalMessagesInFolder, setTotalMessagesInFolder] = useState(0)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [accountConnections, setAccountConnections] = useState<
    Record<string, AccountConnectionState>
  >({})

  // Selection and cursor are one value so every mutation stays atomic — a
  // Ctrl-click that removes the cursor's row from the selection has to move
  // both in the same commit or the UI shows a state that never existed.
  const [selection, setSelection] = useState<MessageSelectionState>(EMPTY_MESSAGE_SELECTION)
  const [selectedMessage, setSelectedMessage] = useState<MailMessageDetail | null>(null)
  const [isMessageExpanded, setIsMessageExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [messageFilter, setMessageFilter] = useState<MessageListFilter>(DEFAULT_MESSAGE_LIST_FILTER)
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES)

  const [loadingFolders, setLoadingFolders] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false)
  const [loadingMessageDetail, setLoadingMessageDetail] = useState(false)
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null)
  const [clearingAccountDataId, setClearingAccountDataId] = useState<string | null>(null)
  const [clearingDatabaseData, setClearingDatabaseData] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)

  const folderRequestIdRef = useRef(0)
  const loadingFoldersRequestIdRef = useRef<number | null>(null)
  const messageRequestIdRef = useRef(0)
  const loadingMessagesRequestIdRef = useRef<number | null>(null)
  const messageDetailRequestIdRef = useRef(0)
  const toggleFlagExecutionIdRef = useRef(0)
  const activeSearchQueryRef = useRef('')
  const pendingNotificationMessageRef = useRef<MessageRef | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const [composerOpen, setComposerOpen] = useState(false)
  const [composerInitial, setComposerInitial] = useState<ComposerInitialData | undefined>(undefined)
  // Sends that failed, oldest first. Each is offered back once no composer
  // is open, so retrying never replaces a message being written.
  const [failedSends, setFailedSends] = useState<
    ReadonlyArray<{ id: number; draft: ComposerInitialData; message: string }>
  >([])
  const failedSendIdRef = useRef(0)
  const { confirm, dialog: confirmDialog, open: confirmOpen } = useConfirmDialog()
  const [addAccountDialogOpen, setAddAccountDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extensionPrimaryDialogOpen, setExtensionPrimaryDialogOpen] = useState(false)
  const [showWelcomeGate, setShowWelcomeGate] = useState(true)
  const [allInboxesSummary, setAllInboxesSummary] = useState<UnifiedInboxSummary | null>(null)
  // The accounts TUTTI gathers, so its rows can say which one each is from.
  const [unifiedAccountIds, setUnifiedAccountIds] = useState<readonly string[]>([])
  const [emptyStateIntroStep, setEmptyStateIntroStep] = useState<'logo' | 'text' | 'button'>('logo')
  const [windowControlsState, setWindowControlsState] = useState<WindowControlsState>({
    enabled: false,
    maximized: false,
    dragTopRegionEnabled: false
  })

  useEffect(() => {
    activeSearchQueryRef.current = search.trim()
  }, [search])

  // One-shot read of every persisted view preference. Falls back silently to
  // the defaults — a preferences row must never be able to stop the
  // workspace from opening.
  useEffect(() => {
    let disposed = false

    void window.mailApi
      .getUiPreferences()
      .then((preferences) => {
        if (!disposed) {
          setUiPreferences(preferences)
        }
      })
      .catch(() => undefined)

    return () => {
      disposed = true
    }
  }, [])

  /**
   * Persists a preference change immediately and adopts whatever the main
   * process echoes back, so an invalid value can never linger in the UI.
   * Optimistic locally so the layout switch feels instant.
   */
  const uiPreferencesRef = useRef(uiPreferences)

  useEffect(() => {
    uiPreferencesRef.current = uiPreferences
  }, [uiPreferences])

  const updateUiPreferences = useCallback((patch: Partial<UiPreferences>): void => {
    // Computed from a ref rather than inside a state updater: updaters must
    // stay pure (React may invoke them more than once), and the IPC write
    // below is very much not.
    const next = { ...uiPreferencesRef.current, ...patch }
    uiPreferencesRef.current = next
    setUiPreferences(next)

    void window.mailApi
      .setUiPreferences(next)
      .then((persisted) => {
        uiPreferencesRef.current = persisted
        setUiPreferences(persisted)
      })
      .catch(() => undefined)
  }, [])

  const handleMessageListSortChange = useCallback(
    (next: MailMessageListSort): void => {
      updateUiPreferences({ messageListSort: next })
    },
    [updateUiPreferences]
  )

  // The reader zoom changes on every wheel event of a pinch. It is shown at
  // once and stored when the gesture settles, instead of once per event.
  const readerZoomSaveTimerRef = useRef<number | null>(null)
  const changeReaderZoom = useCallback((next: number): void => {
    const zoom = clampReaderZoom(next)

    if (zoom === uiPreferencesRef.current.readerZoom) {
      return
    }

    uiPreferencesRef.current = { ...uiPreferencesRef.current, readerZoom: zoom }
    setUiPreferences(uiPreferencesRef.current)

    if (readerZoomSaveTimerRef.current !== null) {
      window.clearTimeout(readerZoomSaveTimerRef.current)
    }

    readerZoomSaveTimerRef.current = window.setTimeout(() => {
      readerZoomSaveTimerRef.current = null
      void window.mailApi.setUiPreferences(uiPreferencesRef.current).catch(() => undefined)
    }, READER_ZOOM_SAVE_DELAY_MS)
  }, [])

  const handleMessageGroupingChange = useCallback(
    (next: MessageGroupingMode): void => {
      updateUiPreferences({ messageGrouping: next })
    },
    [updateUiPreferences]
  )

  useEffect(() => {
    let disposed = false

    void window.mailApi
      .getWindowControlsState()
      .then((state) => {
        if (!disposed) {
          setWindowControlsState(state)
        }
      })
      .catch(() => undefined)

    const unsubscribe = window.mailApi.onWindowControlsStateChanged((state) => {
      setWindowControlsState(state)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const handleMinimizeWindow = useCallback((): void => {
    void window.mailApi.minimizeWindow()
  }, [])

  const handleToggleMaximizeWindow = useCallback((): void => {
    void window.mailApi
      .toggleMaximizeWindow()
      .then((state) => setWindowControlsState(state))
      .catch(() => undefined)
  }, [])

  const handleCloseWindow = useCallback((): void => {
    void window.mailApi.closeWindow()
  }, [])

  const requestDesktopNotificationPermission = useCallback((): void => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return
    }

    if (window.Notification.permission !== 'default') {
      return
    }

    void window.Notification.requestPermission().catch(() => undefined)
  }, [])

  const syncSummary = useMemo(() => {
    const accountsOnScreen =
      selectedFolderPath === ALL_INBOX_FOLDER_PATH
        ? accounts
        : accounts.filter((account) => account.id === selectedAccountId)

    return summarizeSyncStatus(accountsOnScreen, accountConnections)
  }, [accountConnections, accounts, selectedAccountId, selectedFolderPath])

  const refreshUnifiedInboxSummary = useCallback(async (): Promise<void> => {
    if (accounts.length === 0) {
      setAllInboxesSummary(null)
      return
    }

    try {
      const summary = await window.mailApi.getUnifiedInboxSummary()
      setAllInboxesSummary(summary)
    } catch {
      return
    }
  }, [accounts.length])

  const refreshUnifiedAccountIds = useCallback(async (): Promise<void> => {
    try {
      const preferences = await window.mailApi.getUnifiedInboxPreferences()
      setUnifiedAccountIds(preferences.includedAccountIds)
    } catch {
      return
    }
  }, [])

  useEffect(() => {
    void refreshUnifiedAccountIds()
  }, [accounts.length, refreshUnifiedAccountIds])

  const allInboxesFolder = useMemo(() => {
    if (accounts.length === 0) {
      return undefined
    }

    return {
      path: ALL_INBOX_FOLDER_PATH,
      name: ALL_INBOX_FOLDER_LABEL,
      messageCount: allInboxesSummary?.messageCount ?? 0,
      unseenCount: allInboxesSummary?.unseenCount ?? 0
    }
  }, [accounts.length, allInboxesSummary?.messageCount, allInboxesSummary?.unseenCount])

  const clearSelection = useCallback((): void => {
    setSelection(EMPTY_MESSAGE_SELECTION)
  }, [])

  const cancelInFlightWork = useCallback(() => {
    folderRequestIdRef.current += 1
    messageRequestIdRef.current += 1
    loadingFoldersRequestIdRef.current = null
    loadingMessagesRequestIdRef.current = null
    messageDetailRequestIdRef.current += 1
    setLoadingFolders(false)
    setLoadingMessages(false)
    setLoadingMoreMessages(false)
    setLoadingMessageDetail(false)
  }, [])

  const loadFolders = useCallback(
    async (
      accountId: string,
      options?: { requestId?: number; withSidebarLoader?: boolean }
    ): Promise<MailFolder[] | null> => {
      const requestId = options?.requestId ?? folderRequestIdRef.current
      const withSidebarLoader = options?.withSidebarLoader ?? true

      if (withSidebarLoader) {
        loadingFoldersRequestIdRef.current = requestId
        setLoadingFolders(true)
      }

      setViewError(null)

      try {
        const fetchedFolders = await window.mailApi.listFolders(accountId)

        if (requestId !== folderRequestIdRef.current) {
          return null
        }

        setFolders(fetchedFolders)
        void refreshUnifiedInboxSummary()

        setSelectedFolderPath((currentFolderPath) => {
          if (currentFolderPath === ALL_INBOX_FOLDER_PATH) {
            return currentFolderPath
          }

          if (
            currentFolderPath &&
            fetchedFolders.some((folder) => folder.path === currentFolderPath)
          ) {
            return currentFolderPath
          }

          return (
            fetchedFolders.find((folder) => folder.specialUse === '\\Inbox')?.path ||
            fetchedFolders[0]?.path ||
            null
          )
        })

        return fetchedFolders
      } catch (caughtError) {
        if (requestId !== folderRequestIdRef.current) {
          return null
        }

        if (withSidebarLoader) {
          setViewError(
            caughtError instanceof Error ? caughtError.message : 'Errore nel caricamento cartelle.'
          )
          setFolders([])
          setSelectedFolderPath(null)
        }

        return null
      } finally {
        if (withSidebarLoader && loadingFoldersRequestIdRef.current === requestId) {
          loadingFoldersRequestIdRef.current = null
          setLoadingFolders(false)
        }
      }
    },
    [refreshUnifiedInboxSummary]
  )

  const loadMessages = useCallback(
    async (
      accountId: string,
      folderPath: string,
      options?: ListMessagesOptions & { withPanelLoader?: boolean; requestId?: number }
    ): Promise<MailMessageListPage | null> => {
      const requestId = options?.requestId ?? messageRequestIdRef.current
      const requestedQuery = (options?.query || '').trim()
      const targetLimit = Math.max(
        MESSAGE_LIST_PAGE_SIZE,
        Math.floor(options?.limit || MESSAGE_LIST_PAGE_SIZE)
      )
      const withPanelLoader = options?.withPanelLoader ?? true

      if (withPanelLoader) {
        loadingMessagesRequestIdRef.current = requestId
        setLoadingMessages(true)
      }

      setViewError(null)

      try {
        const fetchedPage = await window.mailApi.listMessages(accountId, folderPath, {
          limit: targetLimit,
          query: options?.query,
          sort: options?.sort,
          grouping: options?.grouping,
          filter: options?.filter
        })

        if (requestId !== messageRequestIdRef.current) {
          return null
        }

        if (requestedQuery !== activeSearchQueryRef.current) {
          return null
        }

        if (loadingMessagesRequestIdRef.current !== null) {
          loadingMessagesRequestIdRef.current = null
          setLoadingMessages(false)
        }

        setMessages(fetchedPage.messages)
        setMessageLimit(fetchedPage.limit)
        setTotalMessagesInFolder(fetchedPage.total)
        setHasMoreMessages(fetchedPage.hasMore)

        setSelection((current) => {
          const availableRefs = fetchedPage.messages.map(summaryToMessageRef)
          const availableKeys = new Set(availableRefs.map(messageRefKey))
          const pendingNotificationRef = pendingNotificationMessageRef.current

          // A message opened from a desktop notification wins over whatever
          // was selected, but only once the page that contains it lands.
          if (pendingNotificationRef && availableKeys.has(messageRefKey(pendingNotificationRef))) {
            pendingNotificationMessageRef.current = null
            return {
              selectedRefs: [pendingNotificationRef],
              cursorRef: pendingNotificationRef,
              anchorRef: pendingNotificationRef
            }
          }

          const reconciled = reconcileSelection(current, availableRefs)

          if (reconciled.selectedRefs.length > 0) {
            return reconciled
          }

          const firstMessage = availableRefs[0]

          if (!firstMessage) {
            return EMPTY_MESSAGE_SELECTION
          }

          return {
            selectedRefs: [firstMessage],
            cursorRef: firstMessage,
            anchorRef: firstMessage
          }
        })

        if (folderPath === ALL_INBOX_FOLDER_PATH) {
          void refreshUnifiedInboxSummary()
        }

        return fetchedPage
      } catch (caughtError) {
        if (requestId !== messageRequestIdRef.current) {
          return null
        }

        if (!withPanelLoader) {
          return null
        }

        setViewError(
          caughtError instanceof Error ? caughtError.message : 'Errore nel caricamento email.'
        )
        setMessages([])
        setTotalMessagesInFolder(0)
        setHasMoreMessages(false)
        clearSelection()
        return null
      } finally {
        if (withPanelLoader && loadingMessagesRequestIdRef.current === requestId) {
          loadingMessagesRequestIdRef.current = null
          setLoadingMessages(false)
        }
      }
    },
    [clearSelection, refreshUnifiedInboxSummary]
  )

  useEffect(() => {
    void refreshUnifiedInboxSummary()
  }, [refreshUnifiedInboxSummary])

  const loadMessageDetail = useCallback(async (ref: MessageRef) => {
    const requestId = ++messageDetailRequestIdRef.current
    setLoadingMessageDetail(true)
    setSelectedMessage(null)

    try {
      const detail = await window.mailApi.getMessage(ref)

      if (requestId !== messageDetailRequestIdRef.current) {
        return
      }

      setSelectedMessage(detail)
    } catch (caughtError) {
      if (requestId !== messageDetailRequestIdRef.current) {
        return
      }

      setViewError(
        caughtError instanceof Error ? caughtError.message : 'Errore nel caricamento messaggio.'
      )
      setSelectedMessage(null)
    } finally {
      if (requestId === messageDetailRequestIdRef.current) {
        setLoadingMessageDetail(false)
      }
    }
  }, [])

  /**
   * Everything the current view asks of `listMessages`, kept in a ref.
   *
   * Background refreshes are driven by IMAP sync events, and a callback that
   * *captured* these values could still be holding the previous ones when an
   * event fires — the subscription only picks up a new closure on the next
   * render. A refresh started in that window would fetch with the old sort
   * or grouping and, landing after the deliberate reload, overwrite it: the
   * list stayed date-ordered after switching to "raggruppa per mittente"
   * until something else forced a refetch. Reading the options at call time
   * removes the window entirely, and lets `refreshCurrentFolder` keep a
   * stable identity so the IMAP listener stops re-subscribing on every
   * preference change.
   */
  const listOptionsRef = useRef<ListMessagesOptions>({
    limit: MESSAGE_LIST_PAGE_SIZE,
    sort: uiPreferences.messageListSort,
    grouping: uiPreferences.messageGrouping,
    filter: messageFilter
  })

  useEffect(() => {
    listOptionsRef.current = {
      limit: messageLimit,
      query: search.trim() || undefined,
      sort: uiPreferences.messageListSort,
      grouping: uiPreferences.messageGrouping,
      filter: messageFilter
    }
  }, [
    messageFilter,
    messageLimit,
    search,
    uiPreferences.messageGrouping,
    uiPreferences.messageListSort
  ])

  const refreshCurrentFolder = useCallback(
    async (accountId: string, folderPath: string) => {
      const options = listOptionsRef.current
      const requestId = ++messageRequestIdRef.current

      await loadMessages(accountId, folderPath, {
        ...options,
        limit: Math.max(
          MESSAGE_LIST_PAGE_SIZE,
          Math.floor(options.limit || MESSAGE_LIST_PAGE_SIZE)
        ),
        withPanelLoader: false,
        requestId
      })
    },
    [loadMessages]
  )

  const removeAccount = useCallback(
    async (accountId: string): Promise<void> => {
      if (removingAccountId) {
        return
      }

      const account = accounts.find((entry) => entry.id === accountId)
      const confirmed = await confirm({
        title: `Disconnettere ${account?.email ?? "l'account"}?`,
        description:
          'SIEVER Mail smette di ricevere e inviare con questo account e toglie dal computer la sua posta e la sua firma. Sul server non cambia nulla: puoi ricollegarlo quando vuoi.',
        confirmLabel: 'Disconnetti',
        destructive: true
      })

      if (!confirmed) {
        return
      }

      setViewError(null)
      setRemovingAccountId(accountId)

      try {
        await window.mailApi.removeAccount(accountId)
        cancelInFlightWork()
        setAllInboxesSummary(null)
        setSelectedAccountId((current) => (current === accountId ? null : current))
        setAccounts((current) => current.filter((account) => account.id !== accountId))
      } catch (caughtError) {
        setViewError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Disconnessione account non riuscita.'
        )
      } finally {
        setRemovingAccountId((current) => (current === accountId ? null : current))
      }
    },
    [accounts, cancelInFlightWork, confirm, removingAccountId, setAccounts]
  )

  const resetMailboxView = useCallback((): void => {
    setMessages([])
    setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
    setTotalMessagesInFolder(0)
    setHasMoreMessages(false)
    clearSelection()
    setSelectedMessage(null)
    setIsMessageExpanded(false)
  }, [clearSelection])

  const clearAccountData = useCallback(
    async (accountId: string): Promise<void> => {
      if (removingAccountId || clearingAccountDataId || clearingDatabaseData) {
        return
      }

      setViewError(null)
      setClearingAccountDataId(accountId)

      try {
        await window.mailApi.clearAccountData(accountId)
        setAllInboxesSummary(null)

        if (selectedAccountId === accountId) {
          cancelInFlightWork()
          setFolders([])
          setSelectedFolderPath(null)
          resetMailboxView()

          const requestId = ++folderRequestIdRef.current
          void loadFolders(accountId, { requestId })
        } else {
          void refreshUnifiedInboxSummary()
        }
      } catch (caughtError) {
        setViewError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Cancellazione dati account non riuscita.'
        )
      } finally {
        setClearingAccountDataId((current) => (current === accountId ? null : current))
      }
    },
    [
      cancelInFlightWork,
      clearingAccountDataId,
      clearingDatabaseData,
      loadFolders,
      refreshUnifiedInboxSummary,
      removingAccountId,
      resetMailboxView,
      selectedAccountId
    ]
  )

  const clearAllDataKeepAccounts = useCallback(async (): Promise<void> => {
    if (removingAccountId || clearingAccountDataId || clearingDatabaseData) {
      return
    }

    setViewError(null)
    setClearingDatabaseData(true)

    try {
      await window.mailApi.clearAllDataKeepAccounts()

      cancelInFlightWork()
      setAllInboxesSummary(null)
      setFolders([])
      setSelectedFolderPath(null)
      resetMailboxView()

      if (selectedAccountId) {
        const requestId = ++folderRequestIdRef.current
        void loadFolders(selectedAccountId, { requestId })
      }
    } catch (caughtError) {
      setViewError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Cancellazione totale database non riuscita.'
      )
    } finally {
      setClearingDatabaseData(false)
    }
  }, [
    cancelInFlightWork,
    clearingAccountDataId,
    clearingDatabaseData,
    loadFolders,
    removingAccountId,
    resetMailboxView,
    selectedAccountId
  ])

  const handleUnifiedInboxPreferencesChanged = useCallback((): void => {
    void refreshUnifiedInboxSummary()
    void refreshUnifiedAccountIds()

    if (!selectedAccountId || selectedFolderPath !== ALL_INBOX_FOLDER_PATH) {
      return
    }

    void refreshCurrentFolder(selectedAccountId, ALL_INBOX_FOLDER_PATH)
  }, [
    refreshCurrentFolder,
    refreshUnifiedAccountIds,
    refreshUnifiedInboxSummary,
    selectedAccountId,
    selectedFolderPath
  ])

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedAccountId(null)
      return
    }

    setSelectedAccountId((current) => {
      if (current && accounts.some((account) => account.id === current)) {
        return current
      }

      return accounts[0].id
    })
  }, [accounts])

  useEffect(() => {
    if (!selectedAccountId) {
      return
    }

    setAccounts((current) => moveAccountToFront(current, selectedAccountId))
    void window.mailApi.markAccountLastViewed(selectedAccountId).catch(() => undefined)
  }, [selectedAccountId, setAccounts])

  useEffect(() => {
    if (!selectedAccountId) {
      folderRequestIdRef.current += 1
      messageRequestIdRef.current += 1
      loadingFoldersRequestIdRef.current = null
      loadingMessagesRequestIdRef.current = null
      setLoadingFolders(false)
      setLoadingMessages(false)
      setLoadingMoreMessages(false)
      setLoadingMessageDetail(false)
      setFolders([])
      setSelectedFolderPath(null)
      resetMailboxView()
      return
    }

    const requestId = ++folderRequestIdRef.current
    void loadFolders(selectedAccountId, { requestId })
  }, [loadFolders, resetMailboxView, selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId || !selectedFolderPath) {
      messageRequestIdRef.current += 1
      loadingMessagesRequestIdRef.current = null
      setLoadingMessages(false)
      setLoadingMoreMessages(false)
      resetMailboxView()
      return
    }

    const requestId = ++messageRequestIdRef.current
    void loadMessages(selectedAccountId, selectedFolderPath, {
      limit: messageLimit,
      query: search.trim() || undefined,
      sort: uiPreferences.messageListSort,
      grouping: uiPreferences.messageGrouping,
      filter: messageFilter,
      withPanelLoader: true,
      requestId
    })
  }, [
    loadMessages,
    messageFilter,
    messageLimit,
    resetMailboxView,
    search,
    selectedAccountId,
    selectedFolderPath,
    uiPreferences.messageGrouping,
    uiPreferences.messageListSort
  ])

  // The reading pane follows a selection of exactly one. Above that the pane
  // shows a summary instead, so there is nothing to fetch.
  const readingRef = selection.selectedRefs.length === 1 ? selection.selectedRefs[0] : null
  const readingKey = readingRef ? messageRefKey(readingRef) : null

  useEffect(() => {
    if (!readingRef) {
      messageDetailRequestIdRef.current += 1
      setSelectedMessage(null)
      setIsMessageExpanded(false)
      return
    }

    void loadMessageDetail(readingRef)
    // `readingKey` is the stable identity of `readingRef`; depending on the
    // object itself would refetch on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMessageDetail, readingKey])

  const clearSearch = useCallback((): void => {
    setSearch('')
    setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
  }, [])

  // Escape steps back one level at a time: the expanded reader collapses, a
  // multi-selection narrows to the cursor, and then a running search ends.
  // Menus, dialogs and fields that used the key already default-prevented
  // it — Radix layers do, and so does the search field.
  const hasActiveSearch = search.trim().length > 0

  useEffect(() => {
    const hasMultiSelection = selection.selectedRefs.length > 1

    if (!isMessageExpanded && !hasMultiSelection && !hasActiveSearch) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }

      const target = event.target as HTMLElement | null

      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return
      }

      if (isMessageExpanded) {
        setIsMessageExpanded(false)
        return
      }

      if (hasMultiSelection) {
        // Collapse a multi-selection down to the cursor rather than clearing
        // it outright — Escape in a file manager narrows, it does not empty.
        setSelection((current) =>
          current.cursorRef
            ? {
                selectedRefs: [current.cursorRef],
                cursorRef: current.cursorRef,
                anchorRef: current.cursorRef
              }
            : EMPTY_MESSAGE_SELECTION
        )
        return
      }

      clearSearch()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [clearSearch, hasActiveSearch, isMessageExpanded, selection.selectedRefs.length])

  useEffect(() => {
    if (!selectedAccountId || !selectedFolderPath || selectedFolderPath === ALL_INBOX_FOLDER_PATH) {
      void window.mailApi.setActiveMailboxContext(null)
      return
    }

    void window.mailApi.setActiveMailboxContext({
      accountId: selectedAccountId,
      folderPath: selectedFolderPath
    })
  }, [selectedAccountId, selectedFolderPath])

  useEffect(() => {
    const unsubscribeMessages = window.mailApi.onMessagesChanged((event) => {
      // Folder count updates piggyback on messagesChanged. Apply them to the
      // sidebar regardless of which folder/account the user is currently
      // viewing — counters must stay in sync everywhere, not just on focus.
      if (event.folder) {
        const update = event.folder
        setFolders((current) => {
          let mutated = false
          const next = current.map((folder) => {
            if (folder.accountId !== update.accountId || folder.path !== update.folderPath) {
              return folder
            }
            if (
              folder.messageCount === update.messageCount &&
              folder.unseenCount === update.unseenCount
            ) {
              return folder
            }
            mutated = true
            return {
              ...folder,
              messageCount: update.messageCount,
              unseenCount: update.unseenCount
            }
          })
          return mutated ? next : current
        })
      }

      if (!selectedAccountId || !selectedFolderPath) {
        return
      }

      const hasMessageDelta =
        event.added.length > 0 || event.updated.length > 0 || event.removedUids.length > 0

      if (selectedFolderPath === ALL_INBOX_FOLDER_PATH) {
        if (!hasMessageDelta) {
          return
        }

        void refreshCurrentFolder(selectedAccountId, ALL_INBOX_FOLDER_PATH)
        return
      }

      if (event.accountId !== selectedAccountId || event.folderPath !== selectedFolderPath) {
        return
      }

      void refreshCurrentFolder(selectedAccountId, selectedFolderPath)
    })

    const unsubscribeFolders = window.mailApi.onFoldersChanged((event) => {
      if (!selectedAccountId || event.accountId !== selectedAccountId) {
        return
      }

      setFolders(event.folders)
    })

    const unsubscribeUnified = window.mailApi.onUnifiedInboxChanged((event) => {
      setAllInboxesSummary(event.summary)
    })

    const unsubscribeConnection = window.mailApi.onAccountConnectionChanged((state) => {
      setAccountConnections((current) => ({ ...current, [state.accountId]: state }))
    })

    // Seed the connection map with the engine's current view of every
    // account. The `onAccountConnectionChanged` stream above only carries
    // STATE TRANSITIONS, so any burst that already happened before this
    // subscription was bound (typically the initial connection during
    // bootstrap) would otherwise stay invisible — and the badge would sit on
    // "Connessione persa" until a real disconnect/reconnect cycle fired a
    // transition. Requested AFTER subscribing so an event landing between
    // the two calls is captured by the listener, not lost in the gap; the
    // merge is fill-only so it never clobbers a fresher live value.
    let snapshotDisposed = false
    void window.mailApi
      .getAccountConnectionStates()
      .then((states) => {
        if (snapshotDisposed) {
          return
        }

        setAccountConnections((current) => {
          let mutated = false
          const next: typeof current = { ...current }

          for (const state of states) {
            if (next[state.accountId] === undefined) {
              next[state.accountId] = state
              mutated = true
            }
          }

          return mutated ? next : current
        })
      })
      .catch(() => undefined)

    return () => {
      snapshotDisposed = true
      unsubscribeMessages()
      unsubscribeFolders()
      unsubscribeUnified()
      unsubscribeConnection()
    }
  }, [refreshCurrentFolder, selectedAccountId, selectedFolderPath])

  useEffect(() => {
    return window.mailApi.onOpenMessageFromNotification((ref) => {
      pendingNotificationMessageRef.current = ref
      setShowWelcomeGate(false)
      cancelInFlightWork()
      setViewError(null)
      setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
      setTotalMessagesInFolder(0)
      setHasMoreMessages(false)
      setSelection({ selectedRefs: [ref], cursorRef: ref, anchorRef: ref })
      setSelectedMessage(null)
      setIsMessageExpanded(false)
      setMessageFilter(DEFAULT_MESSAGE_LIST_FILTER)
      setSelectedAccountId(ref.accountId)
      setSelectedFolderPath(ref.folderPath)
    })
  }, [cancelInFlightWork])

  useEffect(() => {
    const shouldAnimateWelcome = accounts.length === 0 || showWelcomeGate

    if (!shouldAnimateWelcome) {
      setEmptyStateIntroStep('logo')
      return
    }

    setEmptyStateIntroStep('logo')
    const textRevealTimer = window.setTimeout(() => setEmptyStateIntroStep('text'), 1400)
    const buttonRevealTimer = window.setTimeout(() => setEmptyStateIntroStep('button'), 2300)

    return () => {
      window.clearTimeout(textRevealTimer)
      window.clearTimeout(buttonRevealTimer)
    }
  }, [accounts.length, showWelcomeGate])

  // Parsed once with the SAME parser the main process uses to build the
  // WHERE, so the user never sees a "highlighted but not returned" or
  // "returned but not highlighted" mismatch. Scoped terms only light up the
  // field they were scoped to.
  const highlightTerms = useMemo<MessageHighlightTerms>(() => {
    const trimmed = search.trim()

    if (!trimmed) {
      return EMPTY_MESSAGE_HIGHLIGHT_TERMS
    }

    const parsed = parseSearchQuery(trimmed)

    return {
      sender: highlightTermsForField(parsed, 'sender'),
      recipients: highlightTermsForField(parsed, 'recipients'),
      subject: highlightTermsForField(parsed, 'subject'),
      body: highlightTermsForField(parsed, 'body')
    }
  }, [search])

  const messageSections = useMemo(
    () =>
      buildMessageSections(
        messages,
        uiPreferences.messageGrouping,
        uiPreferences.messageListSort.field
      ),
    [messages, uiPreferences.messageGrouping, uiPreferences.messageListSort.field]
  )

  const orderedMessageRefs = useMemo(() => messages.map(summaryToMessageRef), [messages])

  const currentFolder = useMemo(
    () => folders.find((folder) => folder.path === selectedFolderPath) ?? null,
    [folders, selectedFolderPath]
  )

  const primaryAddressMode: PrimaryAddressMode = RECIPIENT_ORIENTED_SPECIAL_USES.has(
    currentFolder?.specialUse ?? ''
  )
    ? 'recipient'
    : 'sender'

  // Panel-level loader state. Two distinct reasons to show a loader instead
  // of the message list:
  //   1. our local DB read is in flight and we have nothing to show yet;
  //   2. the engine knows the server has messages here but the sync worker
  //      has not landed the envelopes yet — otherwise the UI would show an
  //      empty list under a counter that says "2800 messaggi".
  const isNarrowedView = Boolean(search.trim()) || messageFilter !== 'all'
  const isFolderAwaitingSync = !isNarrowedView && messages.length === 0 && totalMessagesInFolder > 0
  const isInitialFolderLoad = loadingMessages && !isNarrowedView && messages.length === 0
  const showMessagePanelLoader = isFolderAwaitingSync || isInitialFolderLoad
  const messagePanelLoaderText = isFolderAwaitingSync
    ? 'Sincronizzazione in corso…'
    : 'Caricamento messaggi…'

  useEffect(() => {
    setSelection((current) => reconcileSelection(current, orderedMessageRefs))
  }, [orderedMessageRefs])

  const loadMoreMessages = useCallback(async () => {
    if (
      !selectedAccountId ||
      !selectedFolderPath ||
      loadingMoreMessages ||
      loadingMessages ||
      !hasMoreMessages
    ) {
      return
    }

    setLoadingMoreMessages(true)

    try {
      const requestId = ++messageRequestIdRef.current
      await loadMessages(selectedAccountId, selectedFolderPath, {
        limit: messageLimit + MESSAGE_LIST_PAGE_SIZE,
        query: search.trim() || undefined,
        sort: uiPreferences.messageListSort,
        grouping: uiPreferences.messageGrouping,
        filter: messageFilter,
        withPanelLoader: false,
        requestId
      })
    } finally {
      setLoadingMoreMessages(false)
    }
  }, [
    hasMoreMessages,
    loadMessages,
    loadingMessages,
    loadingMoreMessages,
    messageFilter,
    messageLimit,
    search,
    selectedAccountId,
    selectedFolderPath,
    uiPreferences.messageGrouping,
    uiPreferences.messageListSort
  ])

  const handleActivateRow = useCallback(
    (ref: MessageRef, intent: SelectionIntent): void => {
      setSelection((current) => applySelectionIntent(current, orderedMessageRefs, ref, intent))
    },
    [orderedMessageRefs]
  )

  const handleSelectAll = useCallback((): void => {
    setSelection((current) => selectAllMessages(current, orderedMessageRefs))
  }, [orderedMessageRefs])

  /**
   * Selecting a whole section is what makes grouping useful for filing mail
   * — group by sender, click the heading, act on the lot in one pass.
   */
  const handleSelectSection = useCallback((section: { messages: MailMessageSummary[] }): void => {
    const sectionRefs = section.messages.map(summaryToMessageRef)

    if (sectionRefs.length === 0) {
      return
    }

    setSelection({
      selectedRefs: sectionRefs,
      cursorRef: sectionRefs[0],
      anchorRef: sectionRefs[0]
    })
  }, [])

  /**
   * The messages taken out of the list ahead of the server, as one burst
   * however many actions started it — "Elimina" on a selection, an archive
   * of several — and the selection before the first of them went. If the
   * server refuses some, they come back, and once the burst is over so does
   * that selection, less what did go: the list had moved on to a neighbour
   * only because of them. A selection the user made meanwhile stands.
   */
  const removalBurstRef = useRef<{
    leaving: Set<string>
    selectionBefore: MessageSelectionState
    advancedTo: MessageRef[]
    removed: MessageRef[]
    refused: MessageRef[]
  } | null>(null)

  const removeMessageOptimistically = useCallback(
    (ref: MessageRef) => {
      const removedIndex = messages.findIndex((message) =>
        isSameMessageRef(summaryToMessageRef(message), ref)
      )

      if (removedIndex < 0) {
        return null
      }

      const burst = (removalBurstRef.current ??= {
        leaving: new Set(),
        selectionBefore: selection,
        advancedTo: [],
        removed: [],
        refused: []
      })
      burst.leaving.add(messageRefKey(ref))

      const isLeaving = (message: MailMessageSummary): boolean =>
        burst.leaving.has(messageRefKey(summaryToMessageRef(message)))
      // The neighbour the reading pane moves on to — never one leaving in the
      // same burst — so it stays populated and an expanded view does not
      // collapse back to the split layout under the user.
      const neighbour =
        messages.slice(removedIndex + 1).find((message) => !isLeaving(message)) ??
        messages
          .slice(0, removedIndex)
          .reverse()
          .find((message) => !isLeaving(message)) ??
        null
      const neighbourRef = neighbour ? summaryToMessageRef(neighbour) : null
      const selectionEmptied = selection.selectedRefs.every((selectedRef) =>
        burst.leaving.has(messageRefKey(selectedRef))
      )

      if (selectionEmptied && neighbourRef) {
        burst.advancedTo.push(neighbourRef)
      }

      setMessages((current) =>
        current.filter((message) => !isSameMessageRef(summaryToMessageRef(message), ref))
      )
      setTotalMessagesInFolder((current) => Math.max(0, current - 1))

      setSelection((current) => {
        const remainingRefs = current.selectedRefs.filter(
          (selectedRef) => !isSameMessageRef(selectedRef, ref)
        )

        if (remainingRefs.length > 0) {
          return {
            selectedRefs: remainingRefs,
            cursorRef: remainingRefs[remainingRefs.length - 1],
            anchorRef: remainingRefs[remainingRefs.length - 1]
          }
        }

        return neighbourRef
          ? { selectedRefs: [neighbourRef], cursorRef: neighbourRef, anchorRef: neighbourRef }
          : EMPTY_MESSAGE_SELECTION
      })

      return { ref, removedIndex, removedMessage: messages[removedIndex] }
    },
    [messages, selection]
  )

  const rollbackRemovedMessage = useCallback(
    (snapshot: {
      ref: MessageRef
      removedIndex: number
      removedMessage: MailMessageSummary
    }): void => {
      setMessages((current) => {
        if (
          current.some((message) => isSameMessageRef(summaryToMessageRef(message), snapshot.ref))
        ) {
          return current
        }

        const safeIndex = Math.max(0, Math.min(snapshot.removedIndex, current.length))

        return [
          ...current.slice(0, safeIndex),
          snapshot.removedMessage,
          ...current.slice(safeIndex)
        ]
      })
      setTotalMessagesInFolder((current) => current + 1)
    },
    []
  )

  const settleRemoval = useCallback((ref: MessageRef, removed: boolean): void => {
    const burst = removalBurstRef.current

    if (!burst?.leaving.delete(messageRefKey(ref))) {
      return
    }

    ;(removed ? burst.removed : burst.refused).push(ref)

    if (burst.leaving.size > 0) {
      return
    }

    removalBurstRef.current = null

    if (burst.refused.length === 0) {
      return
    }

    const listMovedTo = [...burst.selectionBefore.selectedRefs, ...burst.advancedTo]
    const selectedRefs = burst.selectionBefore.selectedRefs.filter(
      (selectedRef) =>
        !burst.removed.some((removedRef) => isSameMessageRef(removedRef, selectedRef))
    )

    if (selectedRefs.length === 0) {
      return
    }

    const kept = (candidate: MessageRef | null): MessageRef =>
      candidate && selectedRefs.some((selectedRef) => isSameMessageRef(selectedRef, candidate))
        ? candidate
        : selectedRefs[selectedRefs.length - 1]

    setSelection((current) =>
      current.selectedRefs.every((currentRef) =>
        listMovedTo.some((candidate) => isSameMessageRef(candidate, currentRef))
      )
        ? {
            selectedRefs,
            cursorRef: kept(burst.selectionBefore.cursorRef),
            anchorRef: kept(burst.selectionBefore.anchorRef)
          }
        : current
    )
  }, [])

  const runOptimisticMessageRemoval = useCallback(
    async <T,>(
      ref: MessageRef,
      operation: () => Promise<T>,
      fallbackErrorMessage: string,
      options?: { suppressError?: boolean }
    ): Promise<T> => {
      const snapshot = removeMessageOptimistically(ref)
      setViewError(null)

      try {
        const result = await operation()
        settleRemoval(ref, true)
        return result
      } catch (caughtError) {
        if (snapshot) {
          rollbackRemovedMessage(snapshot)
        }

        settleRemoval(ref, false)

        if (!options?.suppressError) {
          setViewError(
            caughtError instanceof Error && caughtError.message.trim()
              ? caughtError.message
              : fallbackErrorMessage
          )
        }

        throw caughtError
      }
    },
    [removeMessageOptimistically, rollbackRemovedMessage, settleRemoval]
  )

  const runMessageRemovalAction = useCallback(
    async (
      refs: ReadonlyArray<MessageRef>,
      action: (ref: MessageRef) => Promise<void>,
      fallbackErrorMessage: string
    ): Promise<void> => {
      const targetRefs = uniqueMessageRefs(refs)

      if (targetRefs.length === 0) {
        return
      }

      setViewError(null)
      const results = await Promise.all(
        targetRefs.map(async (ref) => {
          try {
            await runOptimisticMessageRemoval(
              ref,
              async () => {
                await action(ref)
              },
              fallbackErrorMessage,
              { suppressError: true }
            )
            return { ok: true as const, error: null }
          } catch (caughtError) {
            return { ok: false as const, error: caughtError }
          }
        })
      )

      const failures = results.filter((result) => !result.ok)
      const firstFailure = failures[0]

      if (failures.length === 0) {
        return
      }

      const firstErrorMessage =
        firstFailure?.error instanceof Error && firstFailure.error.message.trim()
          ? firstFailure.error.message
          : fallbackErrorMessage

      setViewError(
        failures.length === 1
          ? firstErrorMessage
          : `${firstErrorMessage} (${failures.length} operazioni non riuscite)`
      )
    },
    [runOptimisticMessageRemoval]
  )

  const selectedSummaries = useMemo(() => {
    const messageByKey = new Map(
      messages.map((message) => [messageRefKey(summaryToMessageRef(message)), message])
    )

    return selection.selectedRefs
      .map((ref) => messageByKey.get(messageRefKey(ref)))
      .filter((summary): summary is MailMessageSummary => Boolean(summary))
  }, [messages, selection.selectedRefs])

  const readingSummary = useMemo(
    () => (readingKey ? (selectedSummaries[0] ?? null) : null),
    [readingKey, selectedSummaries]
  )

  // The list row is the freshest source of read/flag state (optimistic
  // updates land there first), so the detail adopts it rather than showing a
  // stale header while the refetch is in flight.
  const messageForViewer = useMemo(() => {
    if (!selectedMessage) {
      return null
    }

    if (!readingSummary) {
      return selectedMessage
    }

    if (
      selectedMessage.isRead === readingSummary.isRead &&
      selectedMessage.isFlagged === readingSummary.isFlagged
    ) {
      return selectedMessage
    }

    return {
      ...selectedMessage,
      isRead: readingSummary.isRead,
      isFlagged: readingSummary.isFlagged,
      flags: patchFlag(
        patchFlag(selectedMessage.flags, '\\Seen', readingSummary.isRead),
        '\\Flagged',
        readingSummary.isFlagged
      )
    }
  }, [readingSummary, selectedMessage])

  const shouldMarkSelectionAsRead =
    selectedSummaries.length > 0 && selectedSummaries.some((message) => !message.isRead)
  const toggleSeenLabel = shouldMarkSelectionAsRead ? 'Segna letta' : 'Segna non letta'
  const selectionFlagged =
    selectedSummaries.length > 0 && selectedSummaries.every((message) => message.isFlagged)

  const extensionSelection = useMemo<ExtensionSelectionContext>(
    () => ({
      refs: selection.selectedRefs,
      summaries: selectedSummaries,
      multiSelectActive: selection.selectedRefs.length > 1
    }),
    [selectedSummaries, selection.selectedRefs]
  )

  const extensionHostHooks = useMemo<ExtensionHostHooks>(
    () => ({
      optimisticallyRemoveMessage: (ref, work, fallbackErrorMessage) =>
        runOptimisticMessageRemoval(ref, work, fallbackErrorMessage)
    }),
    [runOptimisticMessageRemoval]
  )

  /**
   * Applies a keyword change to the list row and, when it is the one being
   * read, to the open detail. One helper for both keywords so the two can
   * never drift — the previous code path rewrote the whole flag array and
   * silently dropped `\Flagged` whenever a message was marked read.
   */
  const applyOptimisticFlagState = useCallback(
    (ref: MessageRef, keyword: '\\Seen' | '\\Flagged', present: boolean): void => {
      const patchSummary = (message: MailMessageSummary): MailMessageSummary => ({
        ...message,
        isRead: keyword === '\\Seen' ? present : message.isRead,
        isFlagged: keyword === '\\Flagged' ? present : message.isFlagged,
        flags: patchFlag(message.flags, keyword, present)
      })

      setMessages((current) =>
        current.map((message) =>
          isSameMessageRef(summaryToMessageRef(message), ref) ? patchSummary(message) : message
        )
      )

      setSelectedMessage((current) => {
        if (!current || !isSameMessageRef(current, ref)) {
          return current
        }

        return { ...current, ...patchSummary(current) }
      })
    },
    []
  )

  const getMessageKeywordState = useCallback(
    (ref: MessageRef, keyword: '\\Seen' | '\\Flagged'): boolean => {
      const summary = messages.find((message) =>
        isSameMessageRef(summaryToMessageRef(message), ref)
      )

      if (summary) {
        return keyword === '\\Seen' ? summary.isRead : summary.isFlagged
      }

      if (selectedMessage && isSameMessageRef(selectedMessage, ref)) {
        return keyword === '\\Seen' ? selectedMessage.isRead : selectedMessage.isFlagged
      }

      return keyword === '\\Seen'
    },
    [messages, selectedMessage]
  )

  const setMessageKeyword = useCallback(
    async (ref: MessageRef, keyword: '\\Seen' | '\\Flagged', present: boolean): Promise<void> => {
      const previous = getMessageKeywordState(ref, keyword)

      if (previous === present) {
        return
      }

      const executionId = ++toggleFlagExecutionIdRef.current
      setViewError(null)
      applyOptimisticFlagState(ref, keyword, present)

      try {
        if (keyword === '\\Seen') {
          await window.mailApi.toggleSeen({ ...ref, seen: present })
        } else {
          await window.mailApi.toggleFlagged({ ...ref, flagged: present })
        }
      } catch (caughtError) {
        if (executionId === toggleFlagExecutionIdRef.current) {
          applyOptimisticFlagState(ref, keyword, previous)
        }

        setViewError(
          caughtError instanceof Error
            ? caughtError.message
            : keyword === '\\Seen'
              ? 'Aggiornamento stato letto/non letto non riuscito.'
              : 'Aggiornamento contrassegno non riuscito.'
        )
      }
    },
    [applyOptimisticFlagState, getMessageKeywordState]
  )

  const handleOpenRow = useCallback(
    (ref: MessageRef): void => {
      setSelection({ selectedRefs: [ref], cursorRef: ref, anchorRef: ref })
      setIsMessageExpanded(true)
      void setMessageKeyword(ref, '\\Seen', true)
    },
    [setMessageKeyword]
  )

  const handleToggleRowFlag = useCallback(
    (ref: MessageRef, flagged: boolean): void => {
      void setMessageKeyword(ref, '\\Flagged', flagged)
    },
    [setMessageKeyword]
  )

  const setSelectionSeen = useCallback(async (): Promise<void> => {
    const targetSeenState = shouldMarkSelectionAsRead

    for (const ref of selection.selectedRefs) {
      await setMessageKeyword(ref, '\\Seen', targetSeenState)
    }
  }, [selection.selectedRefs, setMessageKeyword, shouldMarkSelectionAsRead])

  const setSelectionFlagged = useCallback(async (): Promise<void> => {
    const targetFlaggedState = !selectionFlagged

    for (const ref of selection.selectedRefs) {
      await setMessageKeyword(ref, '\\Flagged', targetFlaggedState)
    }
  }, [selection.selectedRefs, selectionFlagged, setMessageKeyword])

  const runSelectionRemovalAction = useCallback(
    async (
      action: (ref: MessageRef) => Promise<void>,
      fallbackErrorMessage: string
    ): Promise<void> => {
      await runMessageRemovalAction(selection.selectedRefs, action, fallbackErrorMessage)
    },
    [runMessageRemovalAction, selection.selectedRefs]
  )

  // Folders belong to one account, so where a selection can move depends on
  // whose messages it holds — under TUTTI, not necessarily the account in
  // the sidebar.
  const selectionAccountIds = useMemo(
    () => Array.from(new Set(selection.selectedRefs.map((ref) => ref.accountId))),
    [selection.selectedRefs]
  )
  const moveAccountId = selectionAccountIds.length === 1 ? selectionAccountIds[0] : null
  const [otherAccountFolders, setOtherAccountFolders] = useState<{
    accountId: string
    folders: MailFolder[]
  } | null>(null)

  useEffect(() => {
    if (!moveAccountId || moveAccountId === selectedAccountId) {
      return
    }

    let disposed = false

    void window.mailApi
      .listFolders(moveAccountId)
      .then((accountFolders) => {
        if (!disposed) {
          setOtherAccountFolders({ accountId: moveAccountId, folders: accountFolders })
        }
      })
      .catch((caughtError: unknown) => {
        if (!disposed) {
          setViewError(
            caughtError instanceof Error
              ? caughtError.message
              : "Cartelle dell'account non disponibili."
          )
        }
      })

    const unsubscribe = window.mailApi.onFoldersChanged((event) => {
      if (event.accountId === moveAccountId) {
        setOtherAccountFolders({ accountId: moveAccountId, folders: event.folders })
      }
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [moveAccountId, selectedAccountId])

  const moveTargets = useMemo(() => {
    const accountFolders =
      moveAccountId === selectedAccountId
        ? folders
        : otherAccountFolders?.accountId === moveAccountId
          ? otherAccountFolders.folders
          : []
    const [firstRef] = selection.selectedRefs
    // Not offered: the folder the whole selection already sits in.
    const sharedFolderPath =
      firstRef && selection.selectedRefs.every((ref) => ref.folderPath === firstRef.folderPath)
        ? firstRef.folderPath
        : null

    return accountFolders.filter((folder) => folder.path !== sharedFolderPath)
  }, [folders, moveAccountId, otherAccountFolders, selectedAccountId, selection.selectedRefs])

  /**
   * "Sposta" on messages of several accounts: no folder can take them all,
   * so it says so and offers to keep only those of the account last clicked.
   */
  const explainMixedAccountMove = useCallback(async (): Promise<void> => {
    const keptAccountId = selection.cursorRef?.accountId ?? selectionAccountIds[0]
    const keptAccount = accounts.find((account) => account.id === keptAccountId)

    if (!keptAccount) {
      return
    }

    const involved = selectionAccountIds.map(
      (accountId) => accounts.find((account) => account.id === accountId)?.email ?? accountId
    )
    const confirmed = await confirm({
      title: 'Messaggi di account diversi',
      description: `La selezione comprende messaggi di ${formatList(involved)}. Ogni cartella appartiene a un solo account, quindi si spostano i messaggi di un account alla volta: vuoi tenere selezionati solo quelli di ${keptAccount.email}?`,
      confirmLabel: 'Seleziona solo quelli'
    })

    if (!confirmed) {
      return
    }

    setSelection((current) => {
      const keptRefs = current.selectedRefs.filter((ref) => ref.accountId === keptAccount.id)
      const cursorRef =
        current.cursorRef?.accountId === keptAccount.id
          ? current.cursorRef
          : (keptRefs[keptRefs.length - 1] ?? null)

      return { selectedRefs: keptRefs, cursorRef, anchorRef: cursorRef }
    })
  }, [accounts, confirm, selection.cursorRef?.accountId, selectionAccountIds])

  const accountLabels = useMemo(() => {
    if (selectedFolderPath !== ALL_INBOX_FOLDER_PATH || unifiedAccountIds.length < 2) {
      return null
    }

    return buildAccountLabels(accounts.filter((account) => unifiedAccountIds.includes(account.id)))
  }, [accounts, selectedFolderPath, unifiedAccountIds])

  // Refs the global key handler reads at event time. Keeping them in refs
  // avoids rebinding the window listener on every selection change.
  const orderedMessageRefsRef = useRef(orderedMessageRefs)
  const selectionRef = useRef(selection)
  const invertVisualOrderRef = useRef(uiPreferences.invertMessageListOrder)

  useEffect(() => {
    orderedMessageRefsRef.current = orderedMessageRefs
  }, [orderedMessageRefs])

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    invertVisualOrderRef.current = uiPreferences.invertMessageListOrder
  }, [uiPreferences.invertMessageListOrder])

  // The failed send offered back right now, once no composer is open.
  const failedSend = composerOpen ? null : (failedSends[0] ?? null)

  const isModalSurfaceOpen =
    composerOpen ||
    failedSend !== null ||
    confirmOpen ||
    addAccountDialogOpen ||
    settingsOpen ||
    extensionPrimaryDialogOpen

  const openComposer = useCallback((data: ComposerInitialData): void => {
    setComposerInitial(data)
    setComposerOpen(true)
  }, [])

  /**
   * Runs a command from the menu bar or its shortcut. Nothing happens over
   * an open dialog, and the zoom commands need a message to zoom. Returns
   * whether the command applied, so a shortcut that did nothing is left to
   * whatever else wants the key.
   */
  const runAppCommand = useCallback(
    (command: AppMenuCommand): boolean => {
      if (isModalSurfaceOpen) {
        return false
      }

      switch (command) {
        case 'compose':
          if (!selectedAccountId) {
            return false
          }

          openComposer({ kind: 'new', accountId: selectedAccountId })
          return true
        case 'settings':
          setSettingsOpen(true)
          return true
        default: {
          if (!selectedMessage) {
            return false
          }

          const current = uiPreferencesRef.current.readerZoom
          changeReaderZoom(
            command === 'reader-zoom-reset'
              ? READER_ZOOM_RESET
              : steppedReaderZoom(current, command === 'reader-zoom-in' ? 1 : -1)
          )
          return true
        }
      }
    },
    [changeReaderZoom, isModalSurfaceOpen, openComposer, selectedAccountId, selectedMessage]
  )
  const runAppCommandRef = useRef(runAppCommand)

  useEffect(() => {
    runAppCommandRef.current = runAppCommand
  }, [runAppCommand])

  useEffect(
    () => window.mailApi.onAppMenuCommand((command) => void runAppCommandRef.current(command)),
    []
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isModalSurfaceOpen) {
        return
      }

      const target = event.target as HTMLElement | null
      const isTypingSurface = Boolean(
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      )

      const isCommandModifier = event.metaKey || event.ctrlKey

      // Focus the search field from anywhere, including while typing
      // somewhere else — the one shortcut that has to win over the guard.
      if (isCommandModifier && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }

      // The commands the macOS menu lists, handled here so they work the same
      // on Windows and Linux, where there is no menu bar.
      const appCommand =
        isCommandModifier && !event.altKey ? APP_SHORTCUT_COMMANDS[event.key] : null

      if (appCommand && runAppCommandRef.current(appCommand)) {
        event.preventDefault()
        return
      }

      if (isTypingSurface) {
        return
      }

      if (isCommandModifier && !event.altKey && event.key.toLowerCase() === 'a') {
        if (orderedMessageRefsRef.current.length === 0) {
          return
        }

        event.preventDefault()
        handleSelectAll()
        return
      }

      if (event.altKey || isCommandModifier) {
        return
      }

      const orderedRefs = orderedMessageRefsRef.current

      if (orderedRefs.length === 0) {
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()

        // Arrows navigate by VISUAL direction. Under the inverted-list
        // preference the DOM order is unchanged but the rows are mirrored,
        // so "visually down" maps to the previous array index.
        const goVisuallyDown = (event.key === 'ArrowDown') !== invertVisualOrderRef.current
        setSelection((current) =>
          moveSelectionCursor(
            current,
            orderedMessageRefsRef.current,
            goVisuallyDown ? 1 : -1,
            event.shiftKey
          )
        )
        return
      }

      if (event.key === 'Enter') {
        const cursorRef = selectionRef.current.cursorRef

        if (!cursorRef) {
          return
        }

        event.preventDefault()
        handleOpenRow(cursorRef)
        return
      }

      // Forward-Delete on PC/Mac AND Backspace (the de-facto delete key on
      // Mac laptops without a forward-delete) both remove the selection.
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const refsToDelete = selectionRef.current.selectedRefs

        if (refsToDelete.length === 0) {
          return
        }

        event.preventDefault()
        void runMessageRemovalAction(
          refsToDelete,
          async (ref) => {
            await window.mailApi.deleteMessage(ref)
          },
          'Eliminazione email non riuscita.'
        )
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [handleOpenRow, handleSelectAll, isModalSurfaceOpen, runMessageRemovalAction])

  const attachmentActions = useAttachmentActions(readingRef)

  // A reply or forward goes out from the account that received the message
  // — which, under TUTTI, is not necessarily the one in the sidebar — and
  // knows the message, for its attachments.
  const openReplyComposer = useCallback((): void => {
    if (!selectedMessage) {
      return
    }

    openComposer({
      kind: 'reply',
      accountId: selectedMessage.accountId,
      sourceAccountId: selectedMessage.accountId,
      to: selectedMessage.from.map((address) => address.address),
      subject: ensureReplySubject(selectedMessage.subject),
      quoteHtml: buildReplyQuoteHtml(selectedMessage),
      inReplyTo: selectedMessage.messageId,
      references: selectedMessage.messageId ? [selectedMessage.messageId] : undefined,
      original: {
        ref: summaryToMessageRef(selectedMessage),
        attachments: selectedMessage.attachments
      }
    })
  }, [openComposer, selectedMessage])

  const openForwardComposer = useCallback((): void => {
    if (!selectedMessage) {
      return
    }

    openComposer({
      kind: 'forward',
      accountId: selectedMessage.accountId,
      sourceAccountId: selectedMessage.accountId,
      subject: ensureForwardSubject(selectedMessage.subject),
      quoteHtml: buildForwardQuoteHtml(selectedMessage),
      original: {
        ref: summaryToMessageRef(selectedMessage),
        attachments: selectedMessage.attachments
      }
    })
  }, [openComposer, selectedMessage])

  const addressActions = useMemo<AddressActions>(
    () => ({
      // Writing to someone from a message starts from the account that got it.
      onCompose: (address) => {
        const accountId = selectedMessage?.accountId ?? selectedAccountId

        if (accountId) {
          openComposer({ kind: 'new', accountId, to: [address.address] })
        }
      },
      onSearch: (address) => {
        setSearch(address.address)
        setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
      }
    }),
    [openComposer, selectedAccountId, selectedMessage?.accountId]
  )

  const handleComposerSendRequested = useCallback(
    (payload: ComposeMailInput, draft: ComposerInitialData): void => {
      setComposerOpen(false)

      void (async () => {
        const sendingToast = toast.loading('Invio in corso…')

        try {
          await window.mailApi.sendMail({
            ...payload,
            html: await buildOutgoingMailHtml(payload.html)
          })
          toast.success('Messaggio inviato', { id: sendingToast })
        } catch (caughtError) {
          toast.dismiss(sendingToast)
          const failure = {
            id: ++failedSendIdRef.current,
            draft,
            message:
              caughtError instanceof Error && caughtError.message.trim()
                ? caughtError.message
                : 'Invio email non riuscito.'
          }
          setFailedSends((current) => [...current, failure])
        }
      })()
    },
    []
  )

  const settleFailedSend = useCallback(
    (retry: boolean): void => {
      if (!failedSend) {
        return
      }

      setFailedSends((current) => current.filter((entry) => entry.id !== failedSend.id))

      if (retry) {
        openComposer(failedSend.draft)
      }
    },
    [failedSend, openComposer]
  )

  const onAccountCreated = (account: MailAccount): void => {
    requestDesktopNotificationPermission()
    setAccounts((current) => [...current, account])
    setSelectedAccountId(account.id)
    setShowWelcomeGate(false)
  }

  const enterWorkspace = useCallback((): void => {
    if (accounts.length === 0) {
      return
    }

    requestDesktopNotificationPermission()

    setSelectedAccountId((current) => {
      if (current && accounts.some((account) => account.id === current)) {
        return current
      }

      return accounts[0]?.id ?? null
    })
    setShowWelcomeGate(false)
  }, [accounts, requestDesktopNotificationPermission])

  if (bootstrapLoading) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
      >
        <div className="flex h-full items-center justify-center">
          <div className="border-border bg-card/70 flex items-center gap-3 rounded-xl border px-5 py-4 text-sm">
            <LoaderCircle className="text-primary size-5 animate-spin" />
            Avvio client email…
          </div>
        </div>
      </AppFrame>
    )
  }

  if (bootstrapError) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
      >
        <div className="mx-auto flex h-full max-w-xl items-center px-6">
          <div className="border-destructive/40 bg-destructive/15 w-full rounded-xl border p-6">
            <p className="display-title text-2xl">Errore inizializzazione</p>
            <p className="text-destructive-soft-foreground mt-2 text-sm">{bootstrapError}</p>
            <Button className="window-no-drag mt-5" onClick={() => void reloadBootstrap()}>
              Riprova
            </Button>
          </div>
        </div>
      </AppFrame>
    )
  }

  if (accounts.length === 0 || showWelcomeGate) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
      >
        <div className="relative mx-auto h-full w-full max-w-5xl px-6 py-12">
          <div className="flex h-full items-center justify-center">
            <div
              className={cn(
                'flex items-center justify-center transition-[gap] duration-[1800ms] ease-out',
                emptyStateIntroStep === 'logo' ? 'gap-0' : 'gap-4 lg:gap-5'
              )}
            >
              <img
                src={appLogo}
                alt="Logo SIEVER Mail"
                className="size-[5.5rem] shrink-0 select-none lg:size-[6.5rem]"
                draggable={false}
              />
              <div
                className={cn(
                  'overflow-hidden transition-all duration-[1800ms] ease-out',
                  emptyStateIntroStep === 'logo' ? 'max-w-0 opacity-0' : 'max-w-[760px] opacity-100'
                )}
              >
                <h1
                  className={cn(
                    'display-title text-6xl leading-none font-black tracking-tight whitespace-nowrap transition-transform duration-[1800ms] ease-out lg:text-7xl',
                    emptyStateIntroStep === 'logo' ? 'translate-x-6' : 'translate-x-0'
                  )}
                >
                  SIEVER Mail
                  <span className="text-primary mt-2 block text-2xl leading-tight font-semibold whitespace-nowrap">
                    Lightweight IMAP/SMTP Client
                  </span>
                </h1>
              </div>
            </div>
          </div>

          <div
            className={cn(
              'absolute inset-x-0 bottom-8 flex justify-center transition-all duration-[900ms]',
              emptyStateIntroStep === 'button'
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none translate-y-2 opacity-0'
            )}
          >
            <div className="flex flex-col items-center gap-3">
              {accounts.length > 0 ? (
                <>
                  <Button
                    className="w-56 gap-2 rounded-lg text-sm"
                    size="lg"
                    onClick={enterWorkspace}
                  >
                    <LogIn className="size-4" />
                    Entra
                  </Button>
                  <AddAccountDialog
                    canUseGoogle={capabilities.googleOAuthReady}
                    onAccountCreated={onAccountCreated}
                    trigger={
                      <Button
                        variant="secondary"
                        className="w-56 gap-2 rounded-lg text-sm"
                        size="lg"
                      >
                        <Plus className="size-4" />
                        Aggiungi account
                      </Button>
                    }
                  />
                </>
              ) : (
                <AddAccountDialog
                  canUseGoogle={capabilities.googleOAuthReady}
                  onAccountCreated={onAccountCreated}
                />
              )}
              <p className="text-muted-foreground pt-1 text-xs tracking-[0.14em] uppercase">
                Versione {formatAppVersion(__APP_VERSION__)}
              </p>
            </div>
          </div>
        </div>
      </AppFrame>
    )
  }

  const listViewProps: MessageListViewProps = {
    title: 'Conversazioni',
    searchQuery: search.trim(),
    onClearSearch: clearSearch,
    messages,
    sections: messageSections,
    totalCount: totalMessagesInFolder,
    selection,
    highlightTerms,
    sort: uiPreferences.messageListSort,
    onSortChange: handleMessageListSortChange,
    grouping: uiPreferences.messageGrouping,
    onGroupingChange: handleMessageGroupingChange,
    invertVisualOrder: uiPreferences.invertMessageListOrder,
    primaryAddressMode,
    accountLabels,
    canLoadMoreMessages: hasMoreMessages && messages.length >= MESSAGE_LIST_PAGE_SIZE,
    loadingMoreMessages,
    onLoadMoreMessages: () => void loadMoreMessages(),
    onActivateRow: handleActivateRow,
    onOpenRow: handleOpenRow,
    onToggleFlag: handleToggleRowFlag,
    onSelectSection: handleSelectSection,
    onSelectAll: handleSelectAll,
    onClearSelection: clearSelection
  }

  const messageListSlot = showMessagePanelLoader ? (
    <div className="glass-panel flex h-full flex-col items-center justify-center gap-2.5 rounded-lg">
      <LoaderCircle className="text-primary size-5 animate-spin" />
      <p className="text-muted-foreground text-xs">{messagePanelLoaderText}</p>
    </div>
  ) : // The expanded reader turns the list into a 260-360px spine in both
  // layouts, and a five-column table cannot live there: it kept Da, A and
  // a sliver of Oggetto and dropped the date. The expanded view is meant to
  // be the same screen whichever layout you came from, so it always uses
  // the stacked rows that were designed for a narrow column.
  uiPreferences.layoutMode === 'outlook' && !isMessageExpanded ? (
    <MessageTable {...listViewProps} />
  ) : (
    <MessageList {...listViewProps} />
  )

  return (
    <AppFrame
      windowControlsState={windowControlsState}
      onMinimizeWindow={handleMinimizeWindow}
      onToggleMaximizeWindow={handleToggleMaximizeWindow}
      onCloseWindow={handleCloseWindow}
    >
      <WorkspaceLayout
        mode={uiPreferences.layoutMode}
        readerExpanded={isMessageExpanded}
        header={
          <div className="glass-panel flex items-center gap-2 rounded-lg px-2.5 py-2">
            <img
              src={appLogo}
              alt="Logo SIEVER Mail"
              className="size-8 shrink-0 select-none"
              draggable={false}
            />
            <div className="min-w-0">
              <h1 className="display-title truncate text-[15px] leading-tight">SIEVER Mail</h1>
              <p className="text-muted-foreground flex items-center gap-1.5 text-[10px] leading-tight">
                <span>{formatAppVersion(__APP_VERSION__)}</span>
                {syncSummary && <SyncStatusIndicator summary={syncSummary} />}
              </p>
            </div>
          </div>
        }
        accountSwitcher={
          <AccountSwitcher
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            removingAccountId={removingAccountId}
            onSelectAccount={(accountId) => {
              cancelInFlightWork()
              setSelectedAccountId(accountId)
              setMessageFilter(DEFAULT_MESSAGE_LIST_FILTER)
              resetMailboxView()
            }}
            onRemoveAccount={(accountId) => void removeAccount(accountId)}
            onAddAccount={() => setAddAccountDialogOpen(true)}
          />
        }
        folders={
          loadingFolders ? (
            <div className="glass-panel text-muted-foreground flex h-full items-center gap-2 rounded-lg p-3 text-xs">
              <LoaderCircle className="size-3.5 animate-spin" /> Caricamento cartelle…
            </div>
          ) : (
            <FolderSidebar
              folders={folders}
              allInboxesFolder={allInboxesFolder}
              selectedFolderPath={selectedFolderPath}
              onSelectFolder={(folderPath) => {
                cancelInFlightWork()
                setSelectedFolderPath(folderPath)
                setMessageFilter(DEFAULT_MESSAGE_LIST_FILTER)
                resetMailboxView()
              }}
            />
          )
        }
        toolbar={
          <MailToolbar
            moveTargets={moveTargets}
            onMoveAcrossAccounts={
              selectionAccountIds.length > 1 ? () => void explainMixedAccountMove() : undefined
            }
            search={search}
            searchInputRef={searchInputRef}
            onSearchChange={(value) => {
              setSearch(value)
              setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
            }}
            filter={messageFilter}
            onFilterChange={(next) => {
              setMessageFilter(next)
              setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
            }}
            selectedCount={selection.selectedRefs.length}
            toggleSeenLabel={toggleSeenLabel}
            selectionFlagged={selectionFlagged}
            extensionToolbarActions={extensionRenderer.toolbarActions}
            extensionSelection={extensionSelection}
            extensionHostHooks={extensionHostHooks}
            onActivateExtensionPrimaryAction={() => setExtensionPrimaryDialogOpen(true)}
            onCompose={() => {
              if (selectedAccountId) {
                openComposer({ kind: 'new', accountId: selectedAccountId })
              }
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onArchiveClassic={() =>
              void runSelectionRemovalAction(async (ref) => {
                await window.mailApi.archiveMessage(ref)
              }, 'Archiviazione email non riuscita.')
            }
            onMoveToFolder={(destinationFolderPath) =>
              void runSelectionRemovalAction(async (ref) => {
                await window.mailApi.moveMessage({ ...ref, destinationFolderPath })
              }, 'Spostamento email non riuscito.')
            }
            onDelete={() =>
              void runSelectionRemovalAction(async (ref) => {
                await window.mailApi.deleteMessage(ref)
              }, 'Eliminazione email non riuscita.')
            }
            onToggleSeen={() => void setSelectionSeen()}
            onToggleFlagged={() => void setSelectionFlagged()}
            onClearSelection={clearSelection}
          />
        }
        messageList={messageListSlot}
        notice={
          viewError ? (
            <div className="border-destructive/35 bg-destructive/10 text-destructive-soft-foreground flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{viewError}</span>
              <button
                type="button"
                onClick={() => setViewError(null)}
                aria-label="Chiudi avviso"
                className="hover:text-foreground shrink-0"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null
        }
        reader={
          <MessageViewer
            moveTargets={moveTargets}
            message={messageForViewer}
            loading={loadingMessageDetail}
            isExpanded={isMessageExpanded}
            selectedCount={selection.selectedRefs.length}
            onReply={openReplyComposer}
            onForward={openForwardComposer}
            onArchive={() =>
              void runSelectionRemovalAction(async (ref) => {
                await window.mailApi.archiveMessage(ref)
              }, 'Archiviazione email non riuscita.')
            }
            onDelete={() =>
              void runSelectionRemovalAction(async (ref) => {
                await window.mailApi.deleteMessage(ref)
              }, 'Eliminazione email non riuscita.')
            }
            onMoveToFolder={(destinationFolderPath) =>
              void runSelectionRemovalAction(async (ref) => {
                await window.mailApi.moveMessage({ ...ref, destinationFolderPath })
              }, 'Spostamento email non riuscito.')
            }
            onToggleExpanded={() => {
              if (!readingRef) {
                return
              }

              setIsMessageExpanded((current) => !current)
            }}
            onToggleSeen={(seen) => {
              if (readingRef) {
                void setMessageKeyword(readingRef, '\\Seen', seen)
              }
            }}
            onToggleFlagged={(flagged) => {
              if (readingRef) {
                void setMessageKeyword(readingRef, '\\Flagged', flagged)
              }
            }}
            attachmentActions={attachmentActions}
            zoom={uiPreferences.readerZoom}
            onZoomChange={changeReaderZoom}
            addressActions={addressActions}
          />
        }
      />

      <MailComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        accounts={accounts}
        initialData={composerInitial}
        onSendRequested={handleComposerSendRequested}
      />

      <ConfirmDialog
        open={failedSend !== null}
        title="Invio non riuscito"
        description={failedSend?.message}
        details={
          failedSend && (
            <div className="border-destructive/35 bg-destructive/10 flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px]">
              <AlertTriangle className="text-destructive size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {failedSend.draft.subject
                  ? `Il messaggio non è partito: «${failedSend.draft.subject}»`
                  : 'Il messaggio non è partito.'}
              </span>
            </div>
          )
        }
        confirmLabel="Riapri e riprova"
        cancelLabel="Scarta"
        initialFocus="confirm"
        onConfirm={() => settleFailedSend(true)}
        onCancel={() => settleFailedSend(false)}
      />

      {confirmDialog}

      <AddAccountDialog
        canUseGoogle={capabilities.googleOAuthReady}
        onAccountCreated={onAccountCreated}
        open={addAccountDialogOpen}
        onOpenChange={setAddAccountDialogOpen}
        trigger={null}
      />

      {extensionRenderer.PrimaryActionDialog && (
        <extensionRenderer.PrimaryActionDialog
          open={extensionPrimaryDialogOpen}
          onOpenChange={setExtensionPrimaryDialogOpen}
          selection={extensionSelection}
          hostHooks={extensionHostHooks}
        />
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        removingAccountId={removingAccountId}
        clearingAccountDataId={clearingAccountDataId}
        clearingDatabaseData={clearingDatabaseData}
        uiPreferences={uiPreferences}
        onUiPreferencesChange={updateUiPreferences}
        onRemoveAccount={(accountId) => void removeAccount(accountId)}
        onClearAccountData={(accountId) => void clearAccountData(accountId)}
        onClearDatabaseData={() => void clearAllDataKeepAccounts()}
        onAddAccount={() => setAddAccountDialogOpen(true)}
        onUnifiedInboxPreferencesChanged={handleUnifiedInboxPreferencesChanged}
      />
    </AppFrame>
  )
}

export default App
