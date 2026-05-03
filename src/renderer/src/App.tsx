import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AlertTriangle, LoaderCircle, LogIn, Minus, Plus, Square, X } from 'lucide-react'

import appLogo from '@renderer/assets/logo.png'
import { AddAccountDialog } from '@renderer/features/accounts/add-account-dialog'
import { AccountSwitcher } from '@renderer/features/accounts/account-switcher'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { FolderSidebar } from '@renderer/features/mail/folder-sidebar'
import {
  MailComposerDialog,
  type ComposerInitialData,
  type ComposerRetryDraft
} from '@renderer/features/mail/mail-composer-dialog'
import { MessageList } from '@renderer/features/mail/message-list'
import extensionRenderer from '@app/extension/renderer'
import type { ExtensionSelectionContext, ExtensionHostHooks } from '@app/extension/types'
import { MessageViewer } from '@renderer/features/mail/message-viewer'
import { MailToolbar } from '@renderer/features/mail/mail-toolbar'
import { SettingsDialog } from '@renderer/features/settings/settings-dialog'
import { Button } from '@renderer/components/ui/button'
import { cn, formatAppVersion } from '@renderer/lib/utils'
import { ALL_INBOX_FOLDER_PATH, MESSAGE_LIST_PAGE_SIZE } from '@shared/models'
import type {
  AccountConnectionStatus,
  AppCapabilities,
  ComposeMailInput,
  ListMessagesOptions,
  MailAccount,
  MailFolder,
  MailMessageDetail,
  MailMessageListPage,
  MailMessageSummary,
  MessageRef,
  UnifiedInboxSummary,
  WindowControlsState
} from '@shared/models'
const ALL_INBOX_FOLDER_LABEL = 'TUTTI'
const GMAIL_QUOTE_BLOCK_STYLE = 'margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex'

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

function buildReplyComposerHtml(message: MailMessageDetail): string {
  const sender = message.from[0]
  const senderLabel = sender ? formatQuotedAddress(sender) : 'Mittente sconosciuto'
  const attributionLine = `Il giorno ${formatQuotedDate(message.date)} ${senderLabel} ha scritto:`
  const quotedBody = message.html ? message.html : htmlFromText(message.text || '')

  return `<div dir="ltr"><br></div><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${attributionLine}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
}

function buildForwardComposerHtml(message: MailMessageDetail): string {
  const quotedBody = message.html ? message.html : htmlFromText(message.text || '')
  const fromHeader = message.from.length > 0 ? formatQuotedAddressList(message.from) : 'N/D'
  const toHeader = message.to.length > 0 ? formatQuotedAddressList(message.to) : 'N/D'
  const ccHeader = message.cc.length > 0 ? `<br>Cc: ${formatQuotedAddressList(message.cc)}` : ''

  return `<div dir="ltr"><br><br></div><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Messaggio inoltrato ----------<br>Da: ${fromHeader}<br>Data: ${escapeHtml(formatQuotedDate(message.date))}<br>Oggetto: ${escapeHtml(message.subject)}<br>A: ${toHeader}${ccHeader}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
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

function patchSeenFlag(flags: string[], seen: boolean): string[] {
  const filteredFlags = flags.filter((flag) => flag !== '\\Seen')

  if (!seen) {
    return filteredFlags
  }

  return [...filteredFlags, '\\Seen']
}

function isSameMessageRef(left: MessageRef, right: MessageRef): boolean {
  return (
    left.accountId === right.accountId &&
    left.folderPath === right.folderPath &&
    left.uid === right.uid
  )
}

function summaryToMessageRef(summary: MailMessageSummary): MessageRef {
  return {
    accountId: summary.accountId,
    folderPath: summary.folderPath,
    uid: summary.uid
  }
}

function messageRefKey(ref: MessageRef): string {
  return `${ref.accountId}:${ref.folderPath}:${ref.uid}`
}

function uniqueMessageRefs(refs: MessageRef[]): MessageRef[] {
  const seen = new Set<string>()

  return refs.filter((ref) => {
    const key = messageRefKey(ref)

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
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

  return {
    accounts,
    capabilities,
    loading,
    error,
    setAccounts,
    reload
  }
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
    <div className={cn('h-screen overflow-hidden p-4', windowControlsState.enabled && 'pt-10')}>
      {windowControlsState.dragTopRegionEnabled && <div className="window-drag-edge" aria-hidden />}
      {windowControlsState.enabled && (
        <div className="window-no-drag border-border bg-card/90 fixed top-0 right-0 z-[10000] flex overflow-hidden rounded-bl-md border-b border-l backdrop-blur">
          <button
            type="button"
            className="hover:bg-secondary/70 inline-flex h-9 w-11 items-center justify-center transition-colors"
            onClick={onMinimizeWindow}
            aria-label="Minimizza finestra"
            title="Minimizza"
          >
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            className="hover:bg-secondary/70 inline-flex h-9 w-11 items-center justify-center transition-colors"
            onClick={onToggleMaximizeWindow}
            aria-label={windowControlsState.maximized ? 'Riduci finestra' : 'Ingrandisci finestra'}
            title={windowControlsState.maximized ? 'Riduci' : 'Ingrandisci'}
          >
            <Square className="size-3.5" />
          </button>
          <button
            type="button"
            className="hover:bg-destructive/80 hover:text-destructive-foreground inline-flex h-9 w-11 items-center justify-center transition-colors"
            onClick={onCloseWindow}
            aria-label="Chiudi finestra"
            title="Chiudi"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="h-full min-h-0">{children}</div>
    </div>
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
    Record<string, AccountConnectionStatus>
  >({})
  const [selectedMessageRef, setSelectedMessageRef] = useState<MessageRef | null>(null)
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false)
  const [selectedMessageRefs, setSelectedMessageRefs] = useState<MessageRef[]>([])
  const [selectedMessage, setSelectedMessage] = useState<MailMessageDetail | null>(null)
  const [isMessageExpanded, setIsMessageExpanded] = useState(false)
  const [search, setSearch] = useState('')
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
  const toggleSeenExecutionIdRef = useRef(0)
  const activeSearchQueryRef = useRef('')
  const pendingNotificationMessageRef = useRef<MessageRef | null>(null)

  const [composerOpen, setComposerOpen] = useState(false)
  const [composerInitial, setComposerInitial] = useState<ComposerInitialData | undefined>(undefined)
  const [composerSendError, setComposerSendError] = useState<{
    draft: ComposerRetryDraft
    message: string
  } | null>(null)
  const [addAccountDialogOpen, setAddAccountDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extensionPrimaryDialogOpen, setExtensionPrimaryDialogOpen] = useState(false)
  const [showWelcomeGate, setShowWelcomeGate] = useState(true)
  const [allInboxesSummary, setAllInboxesSummary] = useState<UnifiedInboxSummary | null>(null)
  const [emptyStateIntroStep, setEmptyStateIntroStep] = useState<'logo' | 'text' | 'button'>('logo')
  const [windowControlsState, setWindowControlsState] = useState<WindowControlsState>({
    enabled: false,
    maximized: false,
    dragTopRegionEnabled: false
  })

  useEffect(() => {
    activeSearchQueryRef.current = search.trim()
  }, [search])

  useEffect(() => {
    let disposed = false

    void window.mailApi
      .getWindowControlsState()
      .then((state) => {
        if (disposed) {
          return
        }

        setWindowControlsState(state)
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
      .then((state) => {
        setWindowControlsState(state)
      })
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

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  )
  const connectionStatus = useMemo<'online' | 'offline' | null>(() => {
    if (accounts.length === 0) {
      return null
    }

    const accountIdsToCheck =
      selectedFolderPath === ALL_INBOX_FOLDER_PATH
        ? accounts.map((account) => account.id)
        : selectedAccountId
          ? [selectedAccountId]
          : null

    if (!accountIdsToCheck || accountIdsToCheck.length === 0) {
      return null
    }

    const allOnline = accountIdsToCheck.every((accountId) => {
      const status = accountConnections[accountId]
      return status === 'connected' || status === 'reconnecting'
    })

    return allOnline ? 'online' : 'offline'
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
          query: options?.query
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

        setSelectedMessageRef((currentRef) => {
          const availableMessageRefKeys = new Set(
            fetchedPage.messages.map((message) => messageRefKey(summaryToMessageRef(message)))
          )
          const pendingNotificationRef = pendingNotificationMessageRef.current

          if (
            pendingNotificationRef &&
            availableMessageRefKeys.has(messageRefKey(pendingNotificationRef))
          ) {
            pendingNotificationMessageRef.current = null
            return pendingNotificationRef
          }

          if (currentRef && availableMessageRefKeys.has(messageRefKey(currentRef))) {
            return currentRef
          }

          const firstMessage = fetchedPage.messages[0]

          if (!firstMessage) {
            return null
          }

          return summaryToMessageRef(firstMessage)
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
        setSelectedMessageRef(null)
        return null
      } finally {
        if (withPanelLoader && loadingMessagesRequestIdRef.current === requestId) {
          loadingMessagesRequestIdRef.current = null
          setLoadingMessages(false)
        }
      }

      return null
    },
    [refreshUnifiedInboxSummary]
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

  const refreshCurrentFolder = useCallback(
    async (
      accountId: string,
      folderPath: string,
      options?: {
        limit?: number
        query?: string
      }
    ) => {
      const targetLimit = Math.max(
        MESSAGE_LIST_PAGE_SIZE,
        Math.floor(options?.limit || messageLimit)
      )
      const requestId = ++messageRequestIdRef.current
      await loadMessages(accountId, folderPath, {
        limit: targetLimit,
        query: options?.query ?? (search.trim() || undefined),
        withPanelLoader: false,
        requestId
      })
    },
    [loadMessages, messageLimit, search]
  )

  const removeAccount = useCallback(
    async (accountId: string): Promise<void> => {
      if (removingAccountId) {
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
    [cancelInFlightWork, removingAccountId, setAccounts]
  )

  const clearAccountData = useCallback(
    async (accountId: string): Promise<void> => {
      if (removingAccountId || clearingAccountDataId || clearingDatabaseData) {
        return
      }

      const account = accounts.find((entry) => entry.id === accountId) || null
      const accountLabel = account?.email || account?.displayName || 'questo account'
      const shouldProceed = window.confirm(
        `Vuoi cancellare tutti i dati locali di ${accountLabel} mantenendo il login attivo?`
      )

      if (!shouldProceed) {
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
          setMessages([])
          setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
          setTotalMessagesInFolder(0)
          setHasMoreMessages(false)
          setSelectedMessageRef(null)
          setSelectedMessageRefs([])
          setSelectedMessage(null)
          setIsMessageExpanded(false)

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
      accounts,
      cancelInFlightWork,
      clearingAccountDataId,
      clearingDatabaseData,
      loadFolders,
      refreshUnifiedInboxSummary,
      removingAccountId,
      selectedAccountId
    ]
  )

  const clearAllDataKeepAccounts = useCallback(async (): Promise<void> => {
    if (removingAccountId || clearingAccountDataId || clearingDatabaseData) {
      return
    }

    const shouldProceed = window.confirm(
      'Vuoi cancellare tutti i dati locali dal database mantenendo gli account collegati?'
    )

    if (!shouldProceed) {
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
      setMessages([])
      setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
      setTotalMessagesInFolder(0)
      setHasMoreMessages(false)
      setSelectedMessageRef(null)
      setSelectedMessageRefs([])
      setSelectedMessage(null)
      setIsMessageExpanded(false)

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
    selectedAccountId
  ])

  const handleUnifiedInboxPreferencesChanged = useCallback((): void => {
    void refreshUnifiedInboxSummary()

    if (!selectedAccountId || selectedFolderPath !== ALL_INBOX_FOLDER_PATH) {
      return
    }

    void refreshCurrentFolder(selectedAccountId, ALL_INBOX_FOLDER_PATH, {
      limit: messageLimit,
      query: search.trim() || undefined
    })
  }, [
    messageLimit,
    refreshCurrentFolder,
    refreshUnifiedInboxSummary,
    search,
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
      setMessages([])
      setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
      setTotalMessagesInFolder(0)
      setHasMoreMessages(false)
      setSelectedFolderPath(null)
      setSelectedMessage(null)
      setSelectedMessageRef(null)
      setSelectedMessageRefs([])
      return
    }

    const requestId = ++folderRequestIdRef.current
    void loadFolders(selectedAccountId, { requestId })
  }, [loadFolders, selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId || !selectedFolderPath) {
      messageRequestIdRef.current += 1
      loadingMessagesRequestIdRef.current = null
      setLoadingMessages(false)
      setLoadingMoreMessages(false)
      setMessages([])
      setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
      setTotalMessagesInFolder(0)
      setHasMoreMessages(false)
      setSelectedMessageRef(null)
      setSelectedMessageRefs([])
      setSelectedMessage(null)
      return
    }

    const requestId = ++messageRequestIdRef.current
    const query = search.trim() || undefined
    void loadMessages(selectedAccountId, selectedFolderPath, {
      limit: messageLimit,
      query,
      withPanelLoader: true,
      requestId
    })
  }, [loadMessages, messageLimit, search, selectedAccountId, selectedFolderPath])

  useEffect(() => {
    if (!selectedMessageRef) {
      messageDetailRequestIdRef.current += 1
      setSelectedMessage(null)
      setIsMessageExpanded(false)
      return
    }

    void loadMessageDetail(selectedMessageRef)
  }, [loadMessageDetail, selectedMessageRef])

  const closeMultiSelectSelection = useCallback((): void => {
    setMultiSelectEnabled(false)
    setSelectedMessageRefs([])
  }, [])

  useEffect(() => {
    if (!isMessageExpanded && !multiSelectEnabled) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      if (isMessageExpanded) {
        setIsMessageExpanded(false)
      }

      if (multiSelectEnabled) {
        closeMultiSelectSelection()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeMultiSelectSelection, isMessageExpanded, multiSelectEnabled])

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
      if (!selectedAccountId || !selectedFolderPath) {
        return
      }

      const hasMessageDelta =
        event.added.length > 0 || event.updated.length > 0 || event.removedUids.length > 0

      if (selectedFolderPath === ALL_INBOX_FOLDER_PATH) {
        // Any inbox of any included account can contribute — the DB query already
        // filters on `resolveUnifiedInboxMailboxes()`, so we refresh unconditionally
        // on real message deltas regardless of which account id is on the event.
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
      setAccountConnections((current) => ({ ...current, [state.accountId]: state.status }))

      if (state.status === 'error' && state.errorMessage) {
        setViewError((current) => current ?? state.errorMessage ?? null)
      }
    })

    return () => {
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
      setSelectedMessageRef(ref)
      setSelectedMessageRefs([])
      setSelectedMessage(null)
      setIsMessageExpanded(false)
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
    const textRevealTimer = window.setTimeout(() => {
      setEmptyStateIntroStep('text')
    }, 1400)
    const buttonRevealTimer = window.setTimeout(() => {
      setEmptyStateIntroStep('button')
    }, 2300)

    return () => {
      window.clearTimeout(textRevealTimer)
      window.clearTimeout(buttonRevealTimer)
    }
  }, [accounts.length, showWelcomeGate])

  const filteredMessages = messages
  const messageListTitle = search.trim() ? 'Risultati di Ricerca' : 'Conversazioni'
  // Panel-level loader state. Two distinct reasons to show a loader card instead
  // of the message list:
  //   1. Our local DB read is in flight (loadingMessages) and we have nothing to
  //      show yet — typical during the very first ms after switching folders.
  //   2. The engine knows the server has messages in this folder
  //      (totalMessagesInFolder > 0) but the sync worker hasn't landed the
  //      envelopes yet. Happens during bootstrap of large accounts: folder
  //      counts arrive in ~1s via STATUS, the actual envelopes follow as the
  //      sync queue drains. Without this branch the UI would show an empty list
  //      under a counter that says "6000 messaggi".
  const isFolderAwaitingSync = !search.trim() && messages.length === 0 && totalMessagesInFolder > 0
  const isInitialFolderLoad = loadingMessages && !search.trim() && messages.length === 0
  const showMessagePanelLoader = isFolderAwaitingSync || isInitialFolderLoad
  const messagePanelLoaderText = isFolderAwaitingSync
    ? 'Sincronizzazione in corso…'
    : 'Caricamento messaggi…'

  const filteredMessageRefs = useMemo(
    () => filteredMessages.map(summaryToMessageRef),
    [filteredMessages]
  )
  const selectedMessageRefKeys = useMemo(
    () => new Set(selectedMessageRefs.map((ref) => messageRefKey(ref))),
    [selectedMessageRefs]
  )
  const allVisibleMessagesSelected =
    filteredMessageRefs.length > 0 &&
    filteredMessageRefs.every((ref) => selectedMessageRefKeys.has(messageRefKey(ref)))

  useEffect(() => {
    const availableRefs = new Set(
      messages.map((message) => messageRefKey(summaryToMessageRef(message)))
    )

    setSelectedMessageRefs((current) =>
      current.filter((ref) => availableRefs.has(messageRefKey(ref)))
    )
  }, [messages])

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
      const nextLimit = messageLimit + MESSAGE_LIST_PAGE_SIZE
      const query = search.trim() || undefined

      const requestId = ++messageRequestIdRef.current
      await loadMessages(selectedAccountId, selectedFolderPath, {
        limit: nextLimit,
        query,
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
    messageLimit,
    search,
    selectedAccountId,
    selectedFolderPath
  ])

  const toggleMessageSelection = useCallback((ref: MessageRef): void => {
    setSelectedMessageRefs((current) => {
      const key = messageRefKey(ref)

      if (current.some((selectedRef) => messageRefKey(selectedRef) === key)) {
        return current.filter((selectedRef) => messageRefKey(selectedRef) !== key)
      }

      return [...current, ref]
    })
  }, [])

  const handleMessageListSelect = useCallback(
    (ref: MessageRef, options?: { activateMultiSelect?: boolean }): void => {
      setSelectedMessageRef(ref)

      if (options?.activateMultiSelect && !multiSelectEnabled) {
        setMultiSelectEnabled(true)
      }

      if (multiSelectEnabled || options?.activateMultiSelect) {
        toggleMessageSelection(ref)
      }
    },
    [multiSelectEnabled, toggleMessageSelection]
  )

  const selectAllVisibleMessages = useCallback((): void => {
    setSelectedMessageRefs((current) => uniqueMessageRefs([...current, ...filteredMessageRefs]))
  }, [filteredMessageRefs])

  const toggleMultiSelectMode = useCallback((): void => {
    if (multiSelectEnabled) {
      closeMultiSelectSelection()
      return
    }

    setMultiSelectEnabled(true)
  }, [closeMultiSelectSelection, multiSelectEnabled])

  const removeMessageOptimistically = useCallback(
    (ref: MessageRef) => {
      const removedIndex = messages.findIndex((message) =>
        isSameMessageRef(summaryToMessageRef(message), ref)
      )

      if (removedIndex < 0) {
        return null
      }

      const removedMessage = messages[removedIndex]
      const removedWasSelected = Boolean(
        selectedMessageRef && isSameMessageRef(selectedMessageRef, ref)
      )
      const removedWasMultiSelected = selectedMessageRefs.some((selectedRef) =>
        isSameMessageRef(selectedRef, ref)
      )

      setMessages((current) =>
        current.filter((message) => !isSameMessageRef(summaryToMessageRef(message), ref))
      )
      setSelectedMessageRefs((current) =>
        current.filter((selectedRef) => !isSameMessageRef(selectedRef, ref))
      )
      setTotalMessagesInFolder((current) => Math.max(0, current - 1))

      if (removedWasSelected) {
        setSelectedMessageRef(null)
        setSelectedMessage(null)
      }

      return {
        ref,
        removedIndex,
        removedMessage,
        removedWasSelected,
        removedWasMultiSelected
      }
    },
    [messages, selectedMessageRef, selectedMessageRefs]
  )

  const rollbackRemovedMessage = useCallback(
    (snapshot: {
      ref: MessageRef
      removedIndex: number
      removedMessage: MailMessageSummary
      removedWasSelected: boolean
      removedWasMultiSelected: boolean
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

      if (snapshot.removedWasSelected) {
        setSelectedMessageRef(snapshot.ref)
      }

      if (snapshot.removedWasMultiSelected) {
        setSelectedMessageRefs((current) => {
          if (current.some((selectedRef) => isSameMessageRef(selectedRef, snapshot.ref))) {
            return current
          }

          return [...current, snapshot.ref]
        })
      }
    },
    []
  )

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
        return await operation()
      } catch (caughtError) {
        if (snapshot) {
          rollbackRemovedMessage(snapshot)
        }

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
    [removeMessageOptimistically, rollbackRemovedMessage]
  )

  const runMessageRemovalAction = useCallback(
    async (
      refs: MessageRef[],
      action: (ref: MessageRef) => Promise<void>,
      fallbackErrorMessage: string
    ): Promise<void> => {
      const uniqueRefs = uniqueMessageRefs(refs)

      if (uniqueRefs.length === 0) {
        return
      }

      setViewError(null)
      const results = await Promise.all(
        uniqueRefs.map(async (ref) => {
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
      const failedCount = failures.length
      const firstFailure = failures[0]

      if (failedCount > 0) {
        const firstErrorMessage =
          firstFailure?.error instanceof Error && firstFailure.error.message.trim()
            ? firstFailure.error.message
            : fallbackErrorMessage

        if (failedCount === 1) {
          setViewError(firstErrorMessage || fallbackErrorMessage)
          return
        }

        setViewError(
          `${firstErrorMessage || fallbackErrorMessage} (${failedCount} operazioni non riuscite)`
        )
      }
    },
    [runOptimisticMessageRemoval]
  )

  const runSelectedMessageRemovalAction = useCallback(
    async (
      action: (ref: MessageRef) => Promise<void>,
      fallbackErrorMessage: string
    ): Promise<void> => {
      if (!selectedMessageRef) {
        return
      }

      await runMessageRemovalAction([selectedMessageRef], action, fallbackErrorMessage)
    },
    [runMessageRemovalAction, selectedMessageRef]
  )

  const selectedMessageSummary = useMemo(() => {
    if (!selectedMessageRef) {
      return null
    }

    return (
      messages.find(
        (message) =>
          message.accountId === selectedMessageRef.accountId &&
          message.folderPath === selectedMessageRef.folderPath &&
          message.uid === selectedMessageRef.uid
      ) || null
    )
  }, [messages, selectedMessageRef])

  const selectedMessageIsRead = selectedMessageSummary?.isRead ?? selectedMessage?.isRead ?? true
  const selectedMessageForViewer = useMemo(() => {
    if (!selectedMessage) {
      return null
    }

    if (selectedMessage.isRead === selectedMessageIsRead) {
      return selectedMessage
    }

    return {
      ...selectedMessage,
      isRead: selectedMessageIsRead,
      flags: patchSeenFlag(selectedMessage.flags, selectedMessageIsRead)
    }
  }, [selectedMessage, selectedMessageIsRead])

  const toolbarActionRefs = useMemo(() => {
    if (multiSelectEnabled) {
      return uniqueMessageRefs(selectedMessageRefs)
    }

    return selectedMessageRef ? [selectedMessageRef] : []
  }, [multiSelectEnabled, selectedMessageRef, selectedMessageRefs])

  const toolbarActionMessages = useMemo(() => {
    const messageByKey = new Map(
      messages.map((message) => [messageRefKey(summaryToMessageRef(message)), message])
    )
    const items: MailMessageSummary[] = []

    for (const ref of toolbarActionRefs) {
      const summary = messageByKey.get(messageRefKey(ref))
      if (summary) {
        items.push(summary)
      }
    }

    return items
  }, [messages, toolbarActionRefs])

  const shouldMarkToolbarSelectionAsRead =
    toolbarActionMessages.length > 0 && toolbarActionMessages.some((message) => !message.isRead)
  const toolbarToggleSeenLabel = shouldMarkToolbarSelectionAsRead
    ? 'Segna letta'
    : 'Segna non letta'
  const canActOnToolbarSelection = toolbarActionRefs.length > 0

  const extensionSelection = useMemo<ExtensionSelectionContext>(
    () => ({
      refs: uniqueMessageRefs(toolbarActionRefs),
      summaries: toolbarActionMessages,
      multiSelectActive: multiSelectEnabled
    }),
    [multiSelectEnabled, toolbarActionMessages, toolbarActionRefs]
  )

  const extensionHostHooks = useMemo<ExtensionHostHooks>(
    () => ({
      optimisticallyRemoveMessage: (ref, work, fallbackErrorMessage) =>
        runOptimisticMessageRemoval(ref, work, fallbackErrorMessage)
    }),
    [runOptimisticMessageRemoval]
  )

  const applyOptimisticSeenState = useCallback((ref: MessageRef, seen: boolean): void => {
    setMessages((current) =>
      current.map((message) => {
        if (
          message.accountId !== ref.accountId ||
          message.folderPath !== ref.folderPath ||
          message.uid !== ref.uid
        ) {
          return message
        }

        return {
          ...message,
          isRead: seen,
          flags: patchSeenFlag(message.flags, seen)
        }
      })
    )

    setSelectedMessage((current) => {
      if (
        !current ||
        current.accountId !== ref.accountId ||
        current.folderPath !== ref.folderPath ||
        current.uid !== ref.uid
      ) {
        return current
      }

      return {
        ...current,
        isRead: seen,
        flags: patchSeenFlag(current.flags, seen)
      }
    })
  }, [])

  const getMessageReadState = useCallback(
    (ref: MessageRef): boolean => {
      const summary = messages.find(
        (message) =>
          message.accountId === ref.accountId &&
          message.folderPath === ref.folderPath &&
          message.uid === ref.uid
      )

      if (summary) {
        return summary.isRead
      }

      if (
        selectedMessage &&
        selectedMessage.accountId === ref.accountId &&
        selectedMessage.folderPath === ref.folderPath &&
        selectedMessage.uid === ref.uid
      ) {
        return selectedMessage.isRead
      }

      return true
    },
    [messages, selectedMessage]
  )

  const setMessageSeen = useCallback(
    async (ref: MessageRef, seen: boolean): Promise<void> => {
      const previousSeen = getMessageReadState(ref)

      if (previousSeen === seen) {
        return
      }

      const executionId = ++toggleSeenExecutionIdRef.current
      setViewError(null)
      applyOptimisticSeenState(ref, seen)

      try {
        await window.mailApi.toggleSeen({ ...ref, seen })
      } catch (caughtError) {
        if (executionId === toggleSeenExecutionIdRef.current) {
          applyOptimisticSeenState(ref, previousSeen)
        }

        setViewError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Aggiornamento stato letto/non letto non riuscito.'
        )
      }
    },
    [applyOptimisticSeenState, getMessageReadState]
  )

  const handleMessageListOpen = useCallback(
    (ref: MessageRef): void => {
      setSelectedMessageRef(ref)
      setIsMessageExpanded(true)
      void setMessageSeen(ref, true)
    },
    [setMessageSeen]
  )

  const setSelectedMessageSeen = useCallback(
    async (seen: boolean): Promise<void> => {
      if (!selectedMessageRef) {
        return
      }

      await setMessageSeen(selectedMessageRef, seen)
    },
    [selectedMessageRef, setMessageSeen]
  )

  const setToolbarSelectionSeen = useCallback(async (): Promise<void> => {
    if (toolbarActionRefs.length === 0) {
      return
    }

    const targetSeenState = shouldMarkToolbarSelectionAsRead

    for (const ref of toolbarActionRefs) {
      await setMessageSeen(ref, targetSeenState)
    }
  }, [setMessageSeen, shouldMarkToolbarSelectionAsRead, toolbarActionRefs])

  const runToolbarMessageRemovalAction = useCallback(
    async (
      action: (ref: MessageRef) => Promise<void>,
      fallbackErrorMessage: string
    ): Promise<void> => {
      await runMessageRemovalAction(toolbarActionRefs, action, fallbackErrorMessage)
    },
    [runMessageRemovalAction, toolbarActionRefs]
  )

  const downloadSelectedMessageAttachment = useCallback(
    async (attachmentId: string): Promise<void> => {
      if (!selectedMessageRef) {
        throw new Error('Nessun messaggio selezionato.')
      }

      setViewError(null)

      try {
        await window.mailApi.downloadAttachment({
          ref: selectedMessageRef,
          attachmentId
        })
      } catch (caughtError) {
        const errorMessage =
          caughtError instanceof Error && caughtError.message.trim()
            ? caughtError.message
            : 'Download allegato non riuscito.'
        setViewError(errorMessage)
        throw caughtError
      }
    },
    [selectedMessageRef]
  )

  const openReplyComposer = (): void => {
    if (!selectedMessage) {
      return
    }

    setComposerInitial({
      to: selectedMessage.from.map((address) => address.address),
      subject: ensureReplySubject(selectedMessage.subject),
      html: buildReplyComposerHtml(selectedMessage),
      inReplyTo: selectedMessage.messageId,
      references: selectedMessage.messageId ? [selectedMessage.messageId] : undefined
    })
    setComposerOpen(true)
  }

  const openForwardComposer = (): void => {
    if (!selectedMessage) {
      return
    }

    setComposerInitial({
      subject: ensureForwardSubject(selectedMessage.subject),
      html: buildForwardComposerHtml(selectedMessage)
    })
    setComposerOpen(true)
  }

  const handleComposerSendRequested = useCallback(
    (payload: ComposeMailInput, draft: ComposerRetryDraft): void => {
      setComposerOpen(false)
      setComposerSendError(null)

      void (async () => {
        try {
          await window.mailApi.sendMail(payload)
        } catch (caughtError) {
          const errorMessage =
            caughtError instanceof Error && caughtError.message.trim()
              ? caughtError.message
              : 'Invio email non riuscito.'

          setComposerSendError({
            draft,
            message: errorMessage
          })
        }
      })()
    },
    []
  )

  const handleRetryComposerSend = useCallback((): void => {
    if (!composerSendError) {
      return
    }

    const matchingAccount = accounts.find(
      (account) => account.id === composerSendError.draft.accountId
    )

    if (!matchingAccount) {
      setComposerSendError(null)
      setViewError("Impossibile riaprire l'email: account di invio non disponibile.")
      return
    }

    setComposerSendError(null)
    setSelectedAccountId(matchingAccount.id)
    setComposerInitial(composerSendError.draft.initialData)
    setComposerOpen(true)
  }, [accounts, composerSendError])

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
            Avvio client email...
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
            <p className="text-destructive-foreground mt-2 text-sm">{bootstrapError}</p>
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
                        Aggiungi Account
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
                VERSION {formatAppVersion(__APP_VERSION__)}
              </p>
            </div>
          </div>
        </div>
      </AppFrame>
    )
  }

  return (
    <AppFrame
      windowControlsState={windowControlsState}
      onMinimizeWindow={handleMinimizeWindow}
      onToggleMaximizeWindow={handleToggleMaximizeWindow}
      onCloseWindow={handleCloseWindow}
    >
      <div className="mx-auto grid h-full max-w-[1800px] grid-cols-[340px_minmax(0,1.35fr)_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
        <aside className="row-span-2 flex h-full min-h-0 w-[340px] max-w-[340px] flex-col gap-4">
          <div className="glass-panel rounded-xl p-4">
            <div className="flex items-center gap-3">
              <img
                src={appLogo}
                alt="Logo SIEVER Mail"
                className="size-16 shrink-0 select-none"
                draggable={false}
              />
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs tracking-[0.14em] uppercase">
                  VERSION {formatAppVersion(__APP_VERSION__)}
                </p>
                <h1 className="display-title mt-1 text-4xl whitespace-nowrap">SIEVER Mail</h1>
                {connectionStatus && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        'inline-block size-1.5 rounded-full',
                        connectionStatus === 'online'
                          ? 'bg-status-online shadow-status-online/40 shadow-[0_0_6px]'
                          : 'bg-status-offline shadow-status-offline/40 shadow-[0_0_6px]'
                      )}
                    />
                    <span
                      className={
                        connectionStatus === 'online'
                          ? 'text-muted-foreground'
                          : 'text-status-offline'
                      }
                    >
                      {connectionStatus === 'online' ? 'Sincronizzato' : 'Connessione persa'}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {isMessageExpanded ? (
              showMessagePanelLoader ? (
                <div className="glass-panel flex h-full flex-col items-center justify-center gap-3 rounded-xl">
                  <LoaderCircle className="text-primary size-6 animate-spin" />
                  <p className="text-muted-foreground text-sm">{messagePanelLoaderText}</p>
                </div>
              ) : (
                <MessageList
                  title={messageListTitle}
                  messages={filteredMessages}
                  totalCount={totalMessagesInFolder}
                  selectedMessage={selectedMessageRef}
                  multiSelectEnabled={multiSelectEnabled}
                  selectedMessageRefs={selectedMessageRefs}
                  allVisibleSelected={allVisibleMessagesSelected}
                  canLoadMoreMessages={hasMoreMessages && messages.length >= MESSAGE_LIST_PAGE_SIZE}
                  loadingMoreMessages={loadingMoreMessages}
                  compact
                  onSelectMessage={handleMessageListSelect}
                  onOpenMessage={handleMessageListOpen}
                  onLoadMoreMessages={() => void loadMoreMessages()}
                  onToggleMultiSelect={toggleMultiSelectMode}
                  onSelectAllVisible={selectAllVisibleMessages}
                />
              )
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <AccountSwitcher
                  accounts={accounts}
                  selectedAccountId={selectedAccountId}
                  removingAccountId={removingAccountId}
                  onSelectAccount={(accountId) => {
                    cancelInFlightWork()
                    setSelectedAccountId(accountId)
                    setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
                    setTotalMessagesInFolder(0)
                    setHasMoreMessages(false)
                    setSelectedMessageRef(null)
                    setSelectedMessageRefs([])
                    setSelectedMessage(null)
                    setIsMessageExpanded(false)
                  }}
                  onRemoveAccount={(accountId) => void removeAccount(accountId)}
                  onAddAccount={() => setAddAccountDialogOpen(true)}
                />
                <div className="mt-4 min-h-0 flex-1">
                  {loadingFolders ? (
                    <div className="glass-panel text-muted-foreground flex h-full items-center gap-2 rounded-xl p-3 text-sm">
                      <LoaderCircle className="size-4 animate-spin" /> Caricamento cartelle...
                    </div>
                  ) : (
                    <FolderSidebar
                      folders={folders}
                      allInboxesFolder={allInboxesFolder}
                      selectedFolderPath={selectedFolderPath}
                      onSelectFolder={(folderPath) => {
                        cancelInFlightWork()
                        setSelectedFolderPath(folderPath)
                        setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
                        setTotalMessagesInFolder(0)
                        setHasMoreMessages(false)
                        setSelectedMessageRef(null)
                        setSelectedMessageRefs([])
                        setSelectedMessage(null)
                        setIsMessageExpanded(false)
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="col-start-2 col-end-4 min-w-0">
          <MailToolbar
            folders={folders}
            currentFolderPath={selectedFolderPath}
            search={search}
            onSearchChange={(value) => {
              setSearch(value)
              setMessageLimit(MESSAGE_LIST_PAGE_SIZE)
            }}
            multiSelectEnabled={multiSelectEnabled}
            canActOnMessage={canActOnToolbarSelection}
            toggleSeenLabel={toolbarToggleSeenLabel}
            extensionToolbarActions={extensionRenderer.toolbarActions}
            extensionSelection={extensionSelection}
            extensionHostHooks={extensionHostHooks}
            onActivateExtensionPrimaryAction={() => setExtensionPrimaryDialogOpen(true)}
            onCompose={() => {
              setComposerInitial(undefined)
              setComposerOpen(true)
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onArchiveClassic={() =>
              void runToolbarMessageRemovalAction(async (ref) => {
                await window.mailApi.archiveMessage(ref)
              }, 'Archiviazione email non riuscita.')
            }
            onMoveToFolder={(destinationFolderPath) =>
              void runToolbarMessageRemovalAction(async (ref) => {
                await window.mailApi.moveMessage({ ...ref, destinationFolderPath })
              }, 'Spostamento email non riuscito.')
            }
            onDelete={() =>
              void runToolbarMessageRemovalAction(async (ref) => {
                await window.mailApi.deleteMessage(ref)
              }, 'Eliminazione email non riuscita.')
            }
            onToggleSeen={() => void setToolbarSelectionSeen()}
          />
        </section>

        {!isMessageExpanded && (
          <section className="col-start-2 row-start-2 min-h-0 min-w-0">
            {showMessagePanelLoader ? (
              <div className="glass-panel flex h-full flex-col items-center justify-center gap-3 rounded-xl">
                <LoaderCircle className="text-primary size-6 animate-spin" />
                <p className="text-muted-foreground text-sm">{messagePanelLoaderText}</p>
              </div>
            ) : (
              <MessageList
                title={messageListTitle}
                messages={filteredMessages}
                totalCount={totalMessagesInFolder}
                selectedMessage={selectedMessageRef}
                multiSelectEnabled={multiSelectEnabled}
                selectedMessageRefs={selectedMessageRefs}
                allVisibleSelected={allVisibleMessagesSelected}
                canLoadMoreMessages={hasMoreMessages && messages.length >= MESSAGE_LIST_PAGE_SIZE}
                loadingMoreMessages={loadingMoreMessages}
                onSelectMessage={handleMessageListSelect}
                onOpenMessage={handleMessageListOpen}
                onLoadMoreMessages={() => void loadMoreMessages()}
                onToggleMultiSelect={toggleMultiSelectMode}
                onSelectAllVisible={selectAllVisibleMessages}
              />
            )}
          </section>
        )}

        <main
          className={`${isMessageExpanded ? 'col-start-2 col-end-4' : 'col-start-3'} row-start-2 flex min-h-0 min-w-0 flex-col gap-4`}
        >
          {viewError && (
            <div className="border-destructive/35 bg-destructive/10 text-destructive-foreground rounded-xl border p-3 text-sm">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4" />
                {viewError}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1">
            <MessageViewer
              folders={folders}
              message={selectedMessageForViewer}
              loading={loadingMessageDetail}
              isExpanded={isMessageExpanded}
              onReply={openReplyComposer}
              onForward={openForwardComposer}
              onArchive={() =>
                void runSelectedMessageRemovalAction(async (ref) => {
                  await window.mailApi.archiveMessage(ref)
                }, 'Archiviazione email non riuscita.')
              }
              onDelete={() =>
                void runSelectedMessageRemovalAction(async (ref) => {
                  await window.mailApi.deleteMessage(ref)
                }, 'Eliminazione email non riuscita.')
              }
              onMoveToFolder={(destinationFolderPath) =>
                void runSelectedMessageRemovalAction(async (ref) => {
                  await window.mailApi.moveMessage({ ...ref, destinationFolderPath })
                }, 'Spostamento email non riuscito.')
              }
              onToggleExpanded={() => {
                if (!selectedMessageRef) {
                  return
                }

                setIsMessageExpanded((current) => !current)
              }}
              onToggleSeen={(seen) => void setSelectedMessageSeen(seen)}
              onDownloadAttachment={downloadSelectedMessageAttachment}
            />
          </div>
        </main>
      </div>

      <MailComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        account={selectedAccount}
        initialData={composerInitial}
        onSendRequested={handleComposerSendRequested}
      />
      <Dialog
        open={Boolean(composerSendError)}
        onOpenChange={(nextOpen) => !nextOpen && setComposerSendError(null)}
      >
        <DialogContent className="w-[min(520px,calc(100vw-1.5rem))]">
          <DialogHeader>
            <DialogTitle>Invio email non riuscito</DialogTitle>
            <DialogDescription>
              {composerSendError?.message ||
                "Si e verificato un errore durante l'invio dell'email."}
            </DialogDescription>
          </DialogHeader>

          <div className="border-destructive/35 bg-destructive/10 text-destructive-foreground rounded-xl border p-3 text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4" />
              L&apos;email non e stata inviata.
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setComposerSendError(null)}>
              Chiudi
            </Button>
            <Button onClick={handleRetryComposerSend}>Riprova</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
