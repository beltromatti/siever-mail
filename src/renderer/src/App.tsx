import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState
} from 'react'

import { AlertTriangle, LoaderCircle, LogIn, Minus, Plus, Square, X } from 'lucide-react'
import { toast } from 'sonner'

import appLogo from '@renderer/assets/logo.png'
import { AddAccountDialog } from '@renderer/features/accounts/add-account-dialog'
import { AccountSwitcher } from '@renderer/features/accounts/account-switcher'
import {
  FolderSidebar,
  type FolderDropTarget,
  type FolderMenuTarget
} from '@renderer/features/mail/folder-sidebar'
import {
  MailComposer,
  draftToInitialData,
  type ComposerInitialData,
  type ComposerOutcome,
  type ComposerSession,
  type ComposerSummary,
  type MailComposerHandle
} from '@renderer/features/mail/mail-composer'
import { COMPOSE_DOCK_HEIGHT, ComposeDock } from '@renderer/features/mail/compose-dock'
import { MessageList } from '@renderer/features/mail/message-list'
import { MessageTable } from '@renderer/features/mail/message-table'
import type { MessageListEmptyState } from '@renderer/features/mail/message-list-empty'
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
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { usePromptDialog } from '@renderer/components/ui/prompt-dialog'
import { FolderPicker } from '@renderer/features/mail/folder-picker'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useTaskbarBadge } from '@renderer/lib/taskbar-badge'
import { cn, formatAppVersion, formatCount } from '@renderer/lib/utils'
import {
  folderDisplayName,
  folderRole,
  folderRoleLabel,
  unifiedFolderPath,
  unifiedFolderRole,
  type FolderRole
} from '@shared/folders'
import { startMessageDrag } from '@renderer/lib/message-drag'
import { foldSearchText } from '@shared/search'
import { buildMessageSections } from '@renderer/lib/message-sections'
import {
  CommandShortcutsProvider,
  commandForKeyEvent,
  IS_MAC,
  isOverlaySurfaceOpen
} from '@renderer/lib/command-shortcuts'
import { buildFolderTree, folderNodeLabel, type FolderTreeNode } from '@renderer/lib/folder-tree'
import { inlineMessageStyles } from '@renderer/lib/inline-message-styles'
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
  clampReaderZoom,
  DEFAULT_MESSAGE_LIST_FILTER,
  DEFAULT_UI_PREFERENCES,
  MAX_MESSAGES_PER_ACTION,
  MESSAGE_LIST_PAGE_SIZE
} from '@shared/models'
import { commandChord, COMMANDS, findCommand, type HostCommandId } from '@shared/commands'
import type { ContextMenuItem, ContextMenuRequest } from '@shared/context-menu'
import { replyRecipients, replyReferences } from '@shared/reply'
import { highlightTermsForField, parseSearchQuery } from '@shared/search'
import type {
  AccountConnectionState,
  AppCapabilities,
  ComposeMailInput,
  DraftStatus,
  ListMessagesOptions,
  MailAccount,
  MailFolder,
  MailMessageDetail,
  MailMessageListPage,
  MailMessageListSort,
  MailMessageSummary,
  MessagesActionResult,
  MessageGroupingMode,
  MessageListFilter,
  MessageRef,
  UiPreferences,
  UnifiedFolderSummary,
  WindowControlsState
} from '@shared/models'

const ALL_ACCOUNTS_LABEL = 'tutti gli account'
/** How long a notice offering "Annulla" stays, as Gmail leaves its own. */
const UNDO_TOAST_DURATION_MS = 10_000
/** A draft that takes longer than this to open says it is opening. */
const DRAFT_OPEN_FEEDBACK_DELAY_MS = 300
const GMAIL_QUOTE_BLOCK_STYLE = 'margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex'
const READER_ZOOM_SAVE_DELAY_MS = 400
/** The rows around the one being read whose bodies are fetched ahead. */
const PREFETCHED_NEIGHBOUR_OFFSETS = [1, -1, 2, -2]
/** How long sync events gather before the list is read again for them. */
const LIST_REFRESH_COALESCE_MS = 300
/** How long a search rests before the servers are asked too: not at every keystroke. */
const SERVER_SEARCH_DELAY_MS = 450
/** How long a message stays in the pane before its neighbours are fetched: skimming past fetches nothing. */
const PREFETCH_DWELL_MS = 300

/** Folders whose rows are about the recipient rather than the sender. */
const RECIPIENT_ORIENTED_SPECIAL_USES = new Set(['\\Sent', '\\Drafts'])

/**
 * Where a search that found nothing looked, in so many words — the answer
 * to "is that all, or were there more to load?".
 */
function searchedScopeLine(count: number, viewLabel: string, withServer: boolean): string {
  const where =
    count === 1
      ? `nell'unico messaggio di «${viewLabel}»`
      : `in tutti i ${count.toLocaleString('it-IT')} messaggi di «${viewLabel}»`

  return withServer
    ? `Cercato ${where}: mittente, destinatari, oggetto e testo.`
    : `Cercato ${where} scaricati su questo computer: la ricerca nel testo sul server non è riuscita.`
}

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

/**
 * The message as the reader shows it, ready to quote: its style sheets
 * written onto its elements (see `inlineMessageStyles`), so the composer
 * shows it as it was read and it goes out that way.
 */
async function quotedMessageBody(message: MailMessageDetail): Promise<string> {
  return message.html ? inlineMessageStyles(message.html) : htmlFromText(message.text || '')
}

async function buildReplyQuoteHtml(message: MailMessageDetail): Promise<string> {
  const sender = message.from[0]
  const senderLabel = sender ? formatQuotedAddress(sender) : 'Mittente sconosciuto'
  const attributionLine = `Il giorno ${formatQuotedDate(message.date)} ${senderLabel} ha scritto:`
  const quotedBody = await quotedMessageBody(message)

  return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${attributionLine}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
}

async function buildForwardQuoteHtml(message: MailMessageDetail): Promise<string> {
  const quotedBody = await quotedMessageBody(message)
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
 * What Tutti gli account calls each account on its rows: the display name when no other
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
  onCloseWindow,
  inert = false,
  dock,
  dockVisible = false
}: {
  children: ReactNode
  windowControlsState: WindowControlsState
  onMinimizeWindow: () => void
  onToggleMaximizeWindow: () => void
  onCloseWindow: () => void
  /** A message is being written in front: the app behind takes neither focus nor clicks. */
  inert?: boolean
  /** The messages being written that are put aside, outside what `inert` stills. */
  dock?: ReactNode
  /** Whether the dock shows: the notices rise above it. */
  dockVisible?: boolean
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
        <div className="h-full min-h-0" inert={inert}>
          {children}
        </div>
      </div>
      {dock}
      {/* In front of a message being written, notices come in at the top: at
          the bottom they would sit on its Invia. */}
      <Toaster
        position={inert ? 'top-center' : 'bottom-right'}
        offset={!inert && dockVisible ? { bottom: 16 + COMPOSE_DOCK_HEIGHT, right: 16 } : 16}
      />
    </TooltipProvider>
  )
}

function App(): React.JSX.Element {
  useTaskbarBadge()
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
  // How many messages the cache holds of the view, and the server: what a
  // search looked through, and what is still on its way.
  const [listCounts, setListCounts] = useState({ cachedCount: 0, serverCount: 0 })
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [accountConnections, setAccountConnections] = useState<
    Record<string, AccountConnectionState>
  >({})

  // Selection and cursor are one value so every mutation stays atomic — a
  // Ctrl-click that removes the cursor's row from the selection has to move
  // both in the same commit or the UI shows a state that never existed.
  const [selection, setSelection] = useState<MessageSelectionState>(EMPTY_MESSAGE_SELECTION)
  // Read at event time by the key handler and by list loads, which must not
  // re-run because the selection moved.
  const selectionRef = useRef(selection)
  // Bumped when the list should bring the selection into view: a folder,
  // order, grouping or filter just shown.
  const [revealCursorToken, setRevealCursorToken] = useState(0)

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])
  const [selectedMessage, setSelectedMessage] = useState<MailMessageDetail | null>(null)
  const [isMessageExpanded, setIsMessageExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [messageFilter, setMessageFilter] = useState<MessageListFilter>(DEFAULT_MESSAGE_LIST_FILTER)
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES)

  const [loadingFolders, setLoadingFolders] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false)
  // The message whose body could not be downloaded, for the pane to offer a retry.
  const [failedMessageDetailKey, setFailedMessageDetailKey] = useState<string | null>(null)
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

  /** The messages being written: one in front at most, the others parked in the dock. */
  const [composeSessions, setComposeSessions] = useState<ComposerSession[]>([])
  const [activeComposeId, setActiveComposeId] = useState<string | null>(null)
  const [composeSummaries, setComposeSummaries] = useState<Record<string, ComposerSummary>>({})
  const composerHandlesRef = useRef(new Map<string, MailComposerHandle>())
  const composerOpen = activeComposeId !== null
  // Sends that failed, oldest first. Each is offered back once no composer
  // is open, so retrying never replaces a message being written.
  const [failedSends, setFailedSends] = useState<
    ReadonlyArray<{ id: number; draft: ComposerInitialData; message: string }>
  >([])
  const failedSendIdRef = useRef(0)
  const { confirm, dialog: confirmDialog, open: confirmOpen } = useConfirmDialog()
  const { prompt, dialog: promptDialog, open: promptOpen } = usePromptDialog()
  const [addAccountDialogOpen, setAddAccountDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extensionPrimaryDialogOpen, setExtensionPrimaryDialogOpen] = useState(false)
  const [showWelcomeGate, setShowWelcomeGate] = useState(true)
  // The folders of "Tutti gli account", one per role, with their counts.
  const [unifiedSummaries, setUnifiedSummaries] = useState<UnifiedFolderSummary[]>([])
  // The folders the list on screen shows (see `MailMessageListPage.mailboxes`):
  // the sync events about them are the ones it follows.
  const viewMailboxesRef = useRef<Array<{ accountId: string; folderPath: string }>>([])
  // The accounts Tutti gli account gathers, so its rows can say which one each is from.
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

  const syncSummary = useMemo(() => {
    const accountsOnScreen = unifiedFolderRole(selectedFolderPath)
      ? accounts
      : accounts.filter((account) => account.id === selectedAccountId)

    return summarizeSyncStatus(accountsOnScreen, accountConnections)
  }, [accountConnections, accounts, selectedAccountId, selectedFolderPath])

  const refreshUnifiedSummaries = useCallback(async (): Promise<void> => {
    if (accounts.length === 0) {
      setUnifiedSummaries([])
      return
    }

    try {
      setUnifiedSummaries(await window.mailApi.getUnifiedFolderSummaries())
    } catch {
      return
    }
  }, [accounts.length])

  const refreshUnifiedAccountIds = useCallback(async (): Promise<void> => {
    try {
      const preferences = await window.mailApi.getUnifiedPreferences()
      setUnifiedAccountIds(preferences.includedAccountIds)
    } catch {
      return
    }
  }, [])

  useEffect(() => {
    void refreshUnifiedAccountIds()
  }, [accounts.length, refreshUnifiedAccountIds])

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
        void refreshUnifiedSummaries()

        setSelectedFolderPath((currentFolderPath) => {
          if (unifiedFolderRole(currentFolderPath)) {
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
    [refreshUnifiedSummaries]
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
          filter: options?.filter,
          includeRef: options?.includeRef,
          serverMatches: options?.serverMatches
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
        viewMailboxesRef.current = fetchedPage.mailboxes
        setTotalMessagesInFolder(fetchedPage.total)
        setListCounts({
          cachedCount: fetchedPage.cachedCount,
          serverCount: fetchedPage.serverCount
        })
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

        if (unifiedFolderRole(folderPath)) {
          void refreshUnifiedSummaries()
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
    [clearSelection, refreshUnifiedSummaries]
  )

  useEffect(() => {
    void refreshUnifiedSummaries()
  }, [refreshUnifiedSummaries])

  const loadMessageDetail = useCallback(async (ref: MessageRef) => {
    const requestId = ++messageDetailRequestIdRef.current
    setFailedMessageDetailKey(null)
    setSelectedMessage(null)

    try {
      const detail = await window.mailApi.readMessage(ref)

      // Null: the pane moved on before this message's turn came.
      if (detail && requestId === messageDetailRequestIdRef.current) {
        setSelectedMessage(detail)
      }
    } catch (caughtError) {
      if (requestId !== messageDetailRequestIdRef.current) {
        return
      }

      setViewError(
        caughtError instanceof Error ? caughtError.message : 'Errore nel caricamento messaggio.'
      )
      setFailedMessageDetailKey(messageRefKey(ref))
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
  // A search also asks the servers, which know the text of every message —
  // the cache holds only those downloaded. The answer is kept per view and
  // query; until it comes, the search is "on the server too".
  const [serverSearchResult, setServerSearchResult] = useState<{
    viewKey: string
    query: string
    outcome: 'done' | 'failed'
    matches: MessageRef[]
  } | null>(null)
  const activeSearchQuery = search.trim()
  const searchViewKey =
    selectedAccountId && selectedFolderPath ? `${selectedAccountId}\u0000${selectedFolderPath}` : ''
  const currentServerSearch =
    serverSearchResult &&
    serverSearchResult.viewKey === searchViewKey &&
    serverSearchResult.query === activeSearchQuery
      ? serverSearchResult
      : null
  const serverSearchStatus: 'idle' | 'searching' | 'done' | 'failed' = !activeSearchQuery
    ? 'idle'
    : (currentServerSearch?.outcome ?? 'searching')
  const serverMatches =
    currentServerSearch?.outcome === 'done' ? currentServerSearch.matches : undefined

  useEffect(() => {
    if (!activeSearchQuery || !selectedAccountId || !selectedFolderPath) {
      return
    }

    const viewKey = `${selectedAccountId}\u0000${selectedFolderPath}`
    const timer = setTimeout(() => {
      window.mailApi.searchOnServer(selectedAccountId, selectedFolderPath, activeSearchQuery).then(
        (matches) => {
          // Null: a later search took this one's place.
          if (matches) {
            setServerSearchResult({ viewKey, query: activeSearchQuery, outcome: 'done', matches })
          }
        },
        () =>
          setServerSearchResult({
            viewKey,
            query: activeSearchQuery,
            outcome: 'failed',
            matches: []
          })
      )
    }, SERVER_SEARCH_DELAY_MS)

    return () => clearTimeout(timer)
  }, [activeSearchQuery, selectedAccountId, selectedFolderPath])

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
      filter: messageFilter,
      serverMatches
    }
  }, [
    messageFilter,
    messageLimit,
    search,
    serverMatches,
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

  // The view a deferred refresh reads, as it is when the refresh runs.
  const currentViewRef = useRef<{ accountId: string; folderPath: string } | null>(null)

  useEffect(() => {
    currentViewRef.current =
      selectedAccountId && selectedFolderPath
        ? { accountId: selectedAccountId, folderPath: selectedFolderPath }
        : null
  }, [selectedAccountId, selectedFolderPath])

  const listRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Reads the list again shortly, once for a burst of sync events: a first
   * sync lands hundreds of batches, and each used to reload the whole list.
   * A view being loaded meanwhile is let finish — the refresh comes after.
   */
  const scheduleListRefresh = useCallback((): void => {
    if (listRefreshTimerRef.current !== null) {
      return
    }

    const run = (): void => {
      if (loadingMessagesRequestIdRef.current !== null) {
        listRefreshTimerRef.current = setTimeout(run, LIST_REFRESH_COALESCE_MS)
        return
      }

      listRefreshTimerRef.current = null
      const view = currentViewRef.current

      if (view) {
        void refreshCurrentFolder(view.accountId, view.folderPath)
      }
    }

    listRefreshTimerRef.current = setTimeout(run, LIST_REFRESH_COALESCE_MS)
  }, [refreshCurrentFolder])

  useEffect(
    () => () => {
      if (listRefreshTimerRef.current !== null) {
        clearTimeout(listRefreshTimerRef.current)
      }
    },
    []
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
        setUnifiedSummaries([])
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
    viewMailboxesRef.current = []
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
        setUnifiedSummaries([])

        if (selectedAccountId === accountId) {
          cancelInFlightWork()
          setFolders([])
          setSelectedFolderPath(null)
          resetMailboxView()

          const requestId = ++folderRequestIdRef.current
          void loadFolders(accountId, { requestId })
        } else {
          void refreshUnifiedSummaries()
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
      refreshUnifiedSummaries,
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
      setUnifiedSummaries([])
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

  const handleUnifiedPreferencesChanged = useCallback((): void => {
    void refreshUnifiedSummaries()
    void refreshUnifiedAccountIds()

    if (!selectedAccountId || !selectedFolderPath || !unifiedFolderRole(selectedFolderPath)) {
      return
    }

    void refreshCurrentFolder(selectedAccountId, selectedFolderPath)
  }, [
    refreshCurrentFolder,
    refreshUnifiedAccountIds,
    refreshUnifiedSummaries,
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

    // A new view starts from its first page — further down when that is
    // where the message the user had selected now sits.
    const requestId = ++messageRequestIdRef.current
    void loadMessages(selectedAccountId, selectedFolderPath, {
      limit: MESSAGE_LIST_PAGE_SIZE,
      query: search.trim() || undefined,
      sort: uiPreferences.messageListSort,
      grouping: uiPreferences.messageGrouping,
      filter: messageFilter,
      includeRef: selectionRef.current.cursorRef ?? undefined,
      serverMatches,
      withPanelLoader: true,
      requestId
    }).then((page) => {
      if (page) {
        setRevealCursorToken((token) => token + 1)
      }
    })
  }, [
    loadMessages,
    messageFilter,
    resetMailboxView,
    search,
    selectedAccountId,
    selectedFolderPath,
    serverMatches,
    uiPreferences.messageGrouping,
    uiPreferences.messageListSort
  ])

  // The mirrored order keeps the selection in view too.
  useEffect(() => {
    setRevealCursorToken((token) => token + 1)
  }, [uiPreferences.invertMessageListOrder])

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
    if (!selectedAccountId || !selectedFolderPath || unifiedFolderRole(selectedFolderPath)) {
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

      // The folders the list shows: one, or those "Tutti gli account"
      // gathers for a role.
      const inView = viewMailboxesRef.current.some(
        (mailbox) =>
          mailbox.accountId === event.accountId && mailbox.folderPath === event.folderPath
      )

      if (!inView) {
        return
      }

      // Changes to rows on screen apply in place — a flag, a preview, a
      // message gone — however many rows the list holds. New mail needs its
      // place in the order, and the counts their update: one read of the
      // list does both, for every event of a burst.
      if (event.updated.length > 0 || event.removedUids.length > 0) {
        const updates = new Map(
          event.updated.map((message) => [messageRefKey(summaryToMessageRef(message)), message])
        )
        const removedUids = new Set(event.removedUids)

        setMessages((current) => {
          let changed = false
          const next = current.flatMap((message) => {
            if (
              removedUids.has(message.uid) &&
              message.accountId === event.accountId &&
              message.folderPath === event.folderPath
            ) {
              changed = true
              return []
            }

            const update = updates.get(messageRefKey(summaryToMessageRef(message)))

            if (update) {
              changed = true
              return [update]
            }

            return [message]
          })

          return changed ? next : current
        })
      }

      if (event.added.length > 0 || event.removedUids.length > 0) {
        scheduleListRefresh()
      }
    })

    const unsubscribeFolders = window.mailApi.onFoldersChanged((event) => {
      if (!selectedAccountId || event.accountId !== selectedAccountId) {
        return
      }

      setFolders(event.folders)
    })

    const unsubscribeUnified = window.mailApi.onUnifiedFoldersChanged((event) => {
      setUnifiedSummaries(event.summaries)
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
  }, [scheduleListRefresh, selectedAccountId, selectedFolderPath])

  useEffect(() => {
    return window.mailApi.onOpenMessageFromNotification((ref) => {
      pendingNotificationMessageRef.current = ref
      setShowWelcomeGate(false)
      cancelInFlightWork()
      setViewError(null)
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

  // Rows in view without a preview yet — older than those a sync fills in
  // ahead — ask for theirs; one already on its way is not fetched twice.
  const hydratePreviewsInView = useCallback((inView: MailMessageSummary[]): void => {
    const missing = inView.filter((message) => !message.previewHydrated).map(summaryToMessageRef)

    if (missing.length > 0) {
      void window.mailApi.hydratePreviews(missing).catch(() => undefined)
    }
  }, [])

  const currentFolder = useMemo(
    () => folders.find((folder) => folder.path === selectedFolderPath) ?? null,
    [folders, selectedFolderPath]
  )
  // The kind of folder the view gathers across accounts, when it is one of
  // "Tutti gli account".
  const currentUnifiedRole = unifiedFolderRole(selectedFolderPath)

  const primaryAddressMode: PrimaryAddressMode = RECIPIENT_ORIENTED_SPECIAL_USES.has(
    (currentFolder ? folderRole(currentFolder) : currentUnifiedRole) ?? ''
  )
    ? 'recipient'
    : 'sender'

  /** A draft is written on, not read: opening one brings it back into a composer. */
  const isDraftMessage = useCallback(
    (message: Pick<MailMessageSummary, 'accountId' | 'folderPath' | 'flags'>): boolean => {
      if (message.flags.includes('\\Draft')) {
        return true
      }

      const folder =
        message.accountId === selectedAccountId
          ? folders.find((candidate) => candidate.path === message.folderPath)
          : undefined
      return (folder ? folderRole(folder) : currentUnifiedRole) === '\\Drafts'
    },
    [currentUnifiedRole, folders, selectedAccountId]
  )

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
        serverMatches,
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
    serverMatches,
    uiPreferences.messageGrouping,
    uiPreferences.messageListSort
  ])

  // One identity for the list, which asks for the next page from an effect.
  const loadMoreMessagesRef = useRef(loadMoreMessages)

  useEffect(() => {
    loadMoreMessagesRef.current = loadMoreMessages
  }, [loadMoreMessages])

  const loadMoreMessagesHandler = useCallback((): void => {
    void loadMoreMessagesRef.current()
  }, [])

  const handleActivateRow = useCallback(
    (ref: MessageRef, intent: SelectionIntent): void => {
      setSelection((current) => applySelectionIntent(current, orderedMessageRefs, ref, intent))
    },
    [orderedMessageRefs]
  )

  const handleSelectAll = useCallback((): void => {
    setSelection((current) => selectAllMessages(current, orderedMessageRefs))
  }, [orderedMessageRefs])

  const [selectingWholeView, setSelectingWholeView] = useState(false)

  /**
   * Selects the whole view — the folder, or what the search and filter
   * leave of it — not only the rows loaded so far: they are loaded, up to
   * what one action takes, and selected.
   */
  const selectWholeView = useCallback(async (): Promise<void> => {
    if (!selectedAccountId || !selectedFolderPath || selectingWholeView) {
      return
    }

    setSelectingWholeView(true)

    try {
      const requestId = ++messageRequestIdRef.current
      const page = await loadMessages(selectedAccountId, selectedFolderPath, {
        limit: Math.min(totalMessagesInFolder, MAX_MESSAGES_PER_ACTION),
        query: search.trim() || undefined,
        sort: uiPreferences.messageListSort,
        grouping: uiPreferences.messageGrouping,
        filter: messageFilter,
        serverMatches,
        withPanelLoader: false,
        requestId
      })

      if (page) {
        setSelection((current) =>
          selectAllMessages(current, page.messages.map(summaryToMessageRef))
        )
      }
    } finally {
      setSelectingWholeView(false)
    }
  }, [
    loadMessages,
    messageFilter,
    search,
    selectedAccountId,
    selectedFolderPath,
    selectingWholeView,
    serverMatches,
    totalMessagesInFolder,
    uiPreferences.messageGrouping,
    uiPreferences.messageListSort
  ])

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
  /**
   * The message shown alone in the reading pane, once its body is on
   * screen — see the read-state rules at `followShownMessage`. `keepState`
   * is set when the user marks it read or unread by hand.
   */
  const shownMessageRef = useRef<{
    ref: MessageRef
    wasUnread: boolean
    keepState: boolean
  } | null>(null)

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

      // Gone from the list, it is not "read and left": it keeps its state.
      if (shownMessageRef.current && isSameMessageRef(shownMessageRef.current.ref, ref)) {
        shownMessageRef.current = null
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

  /**
   * Takes messages out of the list at once and asks the server for all of
   * them in one call — each folder's in one command. What it refuses comes
   * back where it was, and the reason is shown.
   */
  const runMessageRemovalAction = useCallback(
    async (
      refs: ReadonlyArray<MessageRef>,
      action: (refs: MessageRef[]) => Promise<MessagesActionResult>,
      fallbackErrorMessage: string
    ): Promise<void> => {
      const targetRefs = uniqueMessageRefs(refs)

      if (targetRefs.length === 0) {
        return
      }

      setViewError(null)
      const snapshots = targetRefs.map((ref) => ({
        ref,
        snapshot: removeMessageOptimistically(ref)
      }))
      let result: MessagesActionResult

      try {
        result = await action(targetRefs)
      } catch (caughtError) {
        result = {
          failed: targetRefs,
          error: caughtError instanceof Error ? caughtError.message : undefined
        }
      }

      const failedKeys = new Set(result.failed.map(messageRefKey))

      // Back in their places, earliest first, so each index still holds.
      snapshots
        .filter(({ ref, snapshot }) => snapshot && failedKeys.has(messageRefKey(ref)))
        .sort(
          (left, right) => (left.snapshot?.removedIndex ?? 0) - (right.snapshot?.removedIndex ?? 0)
        )
        .forEach(({ snapshot }) => snapshot && rollbackRemovedMessage(snapshot))

      for (const { ref } of snapshots) {
        settleRemoval(ref, !failedKeys.has(messageRefKey(ref)))
      }

      if (failedKeys.size > 0) {
        const message = result.error?.trim() || fallbackErrorMessage
        setViewError(
          failedKeys.size === 1
            ? message
            : `${message} (${failedKeys.size} messaggi restano dov'erano)`
        )
      }
    },
    [removeMessageOptimistically, rollbackRemovedMessage, settleRemoval]
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

  // The body of the message being read, once it has arrived.
  const readingDetail =
    selectedMessage && readingRef && isSameMessageRef(selectedMessage, readingRef)
      ? selectedMessage
      : null

  // Until its body arrives, the pane shows what the list knows of the
  // message at once. Once it has, the list row is still the freshest source
  // of read/flag state (optimistic updates land there first), so the detail
  // adopts it rather than showing a stale header.
  const messageForViewer = useMemo((): MailMessageDetail | null => {
    if (!readingDetail) {
      return readingSummary
        ? { ...readingSummary, bcc: [], replyTo: [], references: [], attachments: [] }
        : null
    }

    if (
      !readingSummary ||
      (readingDetail.isRead === readingSummary.isRead &&
        readingDetail.isFlagged === readingSummary.isFlagged)
    ) {
      return readingDetail
    }

    return {
      ...readingDetail,
      isRead: readingSummary.isRead,
      isFlagged: readingSummary.isFlagged,
      flags: patchFlag(
        patchFlag(readingDetail.flags, '\\Seen', readingSummary.isRead),
        '\\Flagged',
        readingSummary.isFlagged
      )
    }
  }, [readingDetail, readingSummary])

  const readerBodyStatus =
    !readingKey || readingDetail
      ? 'ready'
      : readingKey === failedMessageDetailKey
        ? 'failed'
        : 'loading'

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
      optimisticallyRemoveMessages: (refs, action, fallbackErrorMessage) =>
        runMessageRemovalAction(refs, action, fallbackErrorMessage)
    }),
    [runMessageRemovalAction]
  )

  /**
   * Applies a keyword change to the list row and, when it is the one being
   * read, to the open detail. One helper for both keywords so the two can
   * never drift — the previous code path rewrote the whole flag array and
   * silently dropped `\Flagged` whenever a message was marked read.
   */
  const applyOptimisticFlagState = useCallback(
    (refs: ReadonlyArray<MessageRef>, keyword: '\\Seen' | '\\Flagged', present: boolean): void => {
      const keys = new Set(refs.map(messageRefKey))
      const patchSummary = <T extends MailMessageSummary>(message: T): T => ({
        ...message,
        isRead: keyword === '\\Seen' ? present : message.isRead,
        isFlagged: keyword === '\\Flagged' ? present : message.isFlagged,
        flags: patchFlag(message.flags, keyword, present)
      })

      setMessages((current) =>
        current.map((message) =>
          keys.has(messageRefKey(summaryToMessageRef(message))) ? patchSummary(message) : message
        )
      )

      setSelectedMessage((current) =>
        current && keys.has(messageRefKey(summaryToMessageRef(current)))
          ? patchSummary(current)
          : current
      )
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

  /**
   * Marks messages read or unread, flagged or not: on screen at once, on the
   * server in one call. What the server refuses goes back as it was.
   */
  const setMessagesKeyword = useCallback(
    async (
      refs: ReadonlyArray<MessageRef>,
      keyword: '\\Seen' | '\\Flagged',
      present: boolean
    ): Promise<void> => {
      const changing = uniqueMessageRefs(refs).filter(
        (ref) => getMessageKeywordState(ref, keyword) !== present
      )

      if (changing.length === 0) {
        return
      }

      const executionId = ++toggleFlagExecutionIdRef.current
      setViewError(null)
      applyOptimisticFlagState(changing, keyword, present)

      let result: MessagesActionResult

      try {
        result =
          keyword === '\\Seen'
            ? await window.mailApi.setMessagesSeen({ refs: changing, present })
            : await window.mailApi.setMessagesFlagged({ refs: changing, present })
      } catch (caughtError) {
        result = {
          failed: changing,
          error: caughtError instanceof Error ? caughtError.message : undefined
        }
      }

      if (result.failed.length === 0) {
        return
      }

      if (executionId === toggleFlagExecutionIdRef.current) {
        applyOptimisticFlagState(result.failed, keyword, !present)
      }

      setViewError(
        result.error?.trim() ||
          (keyword === '\\Seen'
            ? 'Aggiornamento stato letto/non letto non riuscito.'
            : 'Aggiornamento contrassegno non riuscito.')
      )
    },
    [applyOptimisticFlagState, getMessageKeywordState]
  )

  /**
   * Read state follows Outlook's default, which Apple Mail, Thunderbird and
   * Gmail agree with where it matters:
   *   • a message shown in the reading pane stays as it is while it is being
   *     read, and is marked read once the pane moves on from it — to another
   *     message, to several, to another folder, account or search;
   *   • opening it — Invio, a double click, the expand button, the next
   *     message in expanded reading — marks it read at once, as opening it in
   *     its own window does;
   *   • a message the user marks read or unread by hand while it is shown
   *     keeps what they chose;
   *   • only a message whose body showed counts, and one that left the list —
   *     archived, moved, deleted — is left as it is.
   * A failure to tell the server is not reported: the user has moved on, and
   * the message only stays unread.
   */
  const shownKey = readingDetail ? readingKey : null

  const followShownMessage = useEffectEvent((): void => {
    const markRead = (ref: MessageRef, wasUnread: boolean): void => {
      const summary = messages.find((message) =>
        isSameMessageRef(summaryToMessageRef(message), ref)
      )

      // Off the page — another folder or search is on screen — the server
      // still hears of it.
      if (
        (summary ? summary.isRead : !wasUnread) ||
        !accounts.some((a) => a.id === ref.accountId)
      ) {
        return
      }

      const executionId = ++toggleFlagExecutionIdRef.current

      if (summary) {
        applyOptimisticFlagState([ref], '\\Seen', true)
      }

      const rollback = (): void => {
        if (summary && executionId === toggleFlagExecutionIdRef.current) {
          applyOptimisticFlagState([ref], '\\Seen', false)
        }
      }

      void window.mailApi
        .setMessagesSeen({ refs: [ref], present: true })
        .then((result) => {
          if (result.failed.length > 0) {
            rollback()
          }
        })
        .catch(rollback)
    }

    const previous = shownMessageRef.current
    const shown = shownKey ? readingRef : null

    if (previous && shown && isSameMessageRef(previous.ref, shown)) {
      if (isMessageExpanded) {
        previous.keepState = false
        markRead(shown, true)
      }

      return
    }

    if (previous && !previous.keepState) {
      markRead(previous.ref, previous.wasUnread)
    }

    // The list row is the freshest read state; the detail may lag behind it.
    shownMessageRef.current = shown
      ? {
          ref: shown,
          wasUnread: !(readingSummary?.isRead ?? selectedMessage?.isRead ?? true),
          keepState: false
        }
      : null

    if (shown && isMessageExpanded) {
      markRead(shown, true)
    }
  })

  useEffect(() => {
    followShownMessage()
  }, [shownKey, isMessageExpanded])

  // The messages either side of the one shown are the likeliest to be read
  // next: their bodies come down while this one is being read.
  const prefetchNeighbours = useEffectEvent((): void => {
    const index = readingRef
      ? orderedMessageRefs.findIndex((ref) => isSameMessageRef(ref, readingRef))
      : -1

    if (index < 0) {
      return
    }

    const neighbours = PREFETCHED_NEIGHBOUR_OFFSETS.map(
      (offset) => orderedMessageRefs[index + offset]
    ).filter((ref): ref is MessageRef => ref !== undefined)

    if (neighbours.length > 0) {
      void window.mailApi.prefetchMessages(neighbours).catch(() => undefined)
    }
  })

  useEffect(() => {
    if (!shownKey) {
      return
    }

    const timer = setTimeout(prefetchNeighbours, PREFETCH_DWELL_MS)
    return () => clearTimeout(timer)
  }, [shownKey])

  /** Read state set by hand stays when the reading pane moves on. */
  const keepShownReadState = useCallback((refs: ReadonlyArray<MessageRef>): void => {
    const shown = shownMessageRef.current

    if (shown && refs.some((ref) => isSameMessageRef(ref, shown.ref))) {
      shown.keepState = true
    }
  }, [])

  const handleToggleRowFlag = useCallback(
    (ref: MessageRef, flagged: boolean): void => {
      void setMessagesKeyword([ref], '\\Flagged', flagged)
    },
    [setMessagesKeyword]
  )

  const setSelectionSeen = useCallback(async (): Promise<void> => {
    const targetSeenState = shouldMarkSelectionAsRead
    keepShownReadState(selection.selectedRefs)
    await setMessagesKeyword(selection.selectedRefs, '\\Seen', targetSeenState)
  }, [keepShownReadState, selection.selectedRefs, setMessagesKeyword, shouldMarkSelectionAsRead])

  const setSelectionFlagged = useCallback(async (): Promise<void> => {
    await setMessagesKeyword(selection.selectedRefs, '\\Flagged', !selectionFlagged)
  }, [selection.selectedRefs, selectionFlagged, setMessagesKeyword])

  const runSelectionRemovalAction = useCallback(
    async (
      action: (refs: MessageRef[]) => Promise<MessagesActionResult>,
      fallbackErrorMessage: string
    ): Promise<void> => {
      await runMessageRemovalAction(selection.selectedRefs, action, fallbackErrorMessage)
    },
    [runMessageRemovalAction, selection.selectedRefs]
  )

  /**
   * "Elimina", from the toolbar, the reader or the keyboard. In the Trash it
   * deletes for good, as every client does there, so it asks first.
   */
  const deleteMessages = useCallback(
    async (refs: ReadonlyArray<MessageRef>): Promise<void> => {
      if (refs.length === 0) {
        return
      }

      const inTrash = currentFolder?.specialUse?.toLowerCase() === '\\trash'

      if (
        inTrash &&
        !(await confirm({
          title:
            refs.length === 1
              ? 'Eliminare definitivamente il messaggio?'
              : `Eliminare definitivamente ${refs.length} messaggi?`,
          description: 'Sono nel Cestino: eliminati da qui non si possono più recuperare.',
          confirmLabel: 'Elimina definitivamente',
          destructive: true
        }))
      ) {
        return
      }

      await runMessageRemovalAction(
        refs,
        (targets) => window.mailApi.deleteMessages(targets),
        'Eliminazione email non riuscita.'
      )
    },
    [confirm, currentFolder?.specialUse, runMessageRemovalAction]
  )

  // Folders belong to one account, so where a selection can move depends on
  // whose messages it holds — in Tutti gli account, not necessarily the account in
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

  // Where "Sposta" can put the selection: the folders of its account, the
  // one it all sits in shown but not offered.
  const moveFolders = useMemo(
    () =>
      moveAccountId === selectedAccountId
        ? folders
        : otherAccountFolders?.accountId === moveAccountId
          ? otherAccountFolders.folders
          : [],
    [folders, moveAccountId, otherAccountFolders, selectedAccountId]
  )
  const moveExcludedPath = useMemo(() => {
    const [firstRef] = selection.selectedRefs
    return firstRef && selection.selectedRefs.every((ref) => ref.folderPath === firstRef.folderPath)
      ? firstRef.folderPath
      : null
  }, [selection.selectedRefs])
  const [recentMovePaths, setRecentMovePaths] = useState<string[]>([])

  /** The account's recent destinations, read as "Sposta" opens. */
  const refreshRecentMovePaths = useCallback((): void => {
    if (!moveAccountId) {
      return
    }

    void window.mailApi
      .listRecentFolders(moveAccountId)
      .then(setRecentMovePaths)
      .catch(() => setRecentMovePaths([]))
  }, [moveAccountId])

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
    if (!unifiedFolderRole(selectedFolderPath) || unifiedAccountIds.length < 2) {
      return null
    }

    return buildAccountLabels(accounts.filter((account) => unifiedAccountIds.includes(account.id)))
  }, [accounts, selectedFolderPath, unifiedAccountIds])

  // Refs the global key handler reads at event time. Keeping them in refs
  // avoids rebinding the window listener on every selection change.
  const orderedMessageRefsRef = useRef(orderedMessageRefs)
  const invertVisualOrderRef = useRef(uiPreferences.invertMessageListOrder)

  useEffect(() => {
    orderedMessageRefsRef.current = orderedMessageRefs
  }, [orderedMessageRefs])

  useEffect(() => {
    invertVisualOrderRef.current = uiPreferences.invertMessageListOrder
  }, [uiPreferences.invertMessageListOrder])

  // The failed send offered back right now, once no composer is open.
  const failedSend = composerOpen ? null : (failedSends[0] ?? null)

  /** Opens a folder — of the account, or of "Tutti gli account" — showing all its messages. */
  const selectFolder = useCallback(
    (folderPath: string): void => {
      setMessageFilter(DEFAULT_MESSAGE_LIST_FILTER)

      // The folder already open stays as it is: emptying it here left the
      // list blank, with nothing to load it again.
      if (folderPath === selectedFolderPath) {
        return
      }

      cancelInFlightWork()
      setSelectedFolderPath(folderPath)
      resetMailboxView()
    },
    [cancelInFlightWork, resetMailboxView, selectedFolderPath]
  )

  const [goToFolderOpen, setGoToFolderOpen] = useState(false)

  /** What can be done with a folder from its right click, native as every menu of the app. */
  const openFolderContextMenu = useCallback(
    async (target: FolderMenuTarget): Promise<void> => {
      const accountId = target.kind === 'folder' ? target.folder.accountId : selectedAccountId

      if (!accountId) {
        return
      }

      const account = accounts.find((candidate) => candidate.id === accountId)
      const folderPath =
        target.kind === 'folder'
          ? target.folder.path
          : target.kind === 'role'
            ? unifiedFolderPath(target.summary.role)
            : null
      const parent =
        target.kind === 'folder'
          ? { path: target.folder.path, name: folderDisplayName(target.folder) }
          : target.kind === 'container'
            ? { path: target.path, name: target.name }
            : null
      const unseenCount =
        target.kind === 'folder'
          ? target.folder.unseenCount
          : target.kind === 'role'
            ? target.summary.unseenCount
            : 0

      const chosen = await window.mailApi.showContextMenu([
        ...(folderPath ? [{ id: 'open', label: 'Apri' }, { type: 'separator' } as const] : []),
        ...(folderPath
          ? [
              { id: 'read', label: 'Segna tutti come letti', enabled: unseenCount > 0 },
              { type: 'separator' } as const
            ]
          : []),
        ...(target.kind === 'role'
          ? []
          : [
              {
                id: 'create',
                label: parent ? `Nuova cartella in «${parent.name}»…` : 'Nuova cartella…'
              }
            ]),
        ...(target.kind === 'folder'
          ? [
              {
                id: 'rename',
                label: 'Rinomina…',
                // A folder with a role is the server's, under the name it gives it.
                enabled: folderRole(target.folder) === null
              }
            ]
          : [])
      ])

      // Names the server would nest, or that a sibling already has.
      const validateName =
        (siblingsOf: string | null, keep?: string) =>
        (name: string): string | null => {
          const delimiter = folders.find((folder) => folder.delimiter)?.delimiter

          if (delimiter && name.includes(delimiter)) {
            return `Il nome di una cartella non può contenere «${delimiter}».`
          }

          const taken = folders.some((folder) => {
            const separator = folder.delimiter ? folder.path.lastIndexOf(folder.delimiter) : -1
            const folderParent = separator >= 0 ? folder.path.slice(0, separator) : null
            return (
              folderParent === siblingsOf &&
              folder.path !== keep &&
              foldSearchText(folder.name) === foldSearchText(name)
            )
          })

          return taken ? 'Esiste già una cartella con questo nome qui.' : null
        }

      try {
        switch (chosen) {
          case 'open':
            if (folderPath) {
              selectFolder(folderPath)
            }
            return
          case 'read':
            if (folderPath) {
              await window.mailApi.markFolderRead(accountId, folderPath)

              if (folderPath === selectedFolderPath) {
                setMessages((current) =>
                  current.map((message) =>
                    message.isRead ? message : { ...message, isRead: true }
                  )
                )
              }
            }
            return
          case 'create': {
            const name = await prompt({
              title: 'Nuova cartella',
              description: parent
                ? `Dentro «${parent.name}».`
                : `Nell'account ${account?.email ?? ''}.`,
              label: 'Nome della cartella',
              confirmLabel: 'Crea',
              validate: validateName(parent?.path ?? null)
            })

            if (name) {
              await window.mailApi.createFolder({ accountId, name, parentPath: parent?.path })
            }
            return
          }
          case 'rename': {
            if (target.kind !== 'folder') {
              return
            }

            const { folder } = target
            const separator = folder.delimiter ? folder.path.lastIndexOf(folder.delimiter) : -1
            const name = await prompt({
              title: `Rinomina «${folder.name}»`,
              label: 'Nuovo nome',
              initialValue: folder.name,
              confirmLabel: 'Rinomina',
              validate: validateName(
                separator >= 0 ? folder.path.slice(0, separator) : null,
                folder.path
              )
            })

            if (name && name !== folder.name) {
              const renamed = await window.mailApi.renameFolder({
                accountId,
                folderPath: folder.path,
                name
              })

              if (selectedFolderPath === folder.path) {
                selectFolder(renamed.path)
              }
            }
            return
          }
        }
      } catch (caughtError) {
        setViewError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Operazione sulla cartella non riuscita.'
        )
      }
    },
    [accounts, folders, prompt, selectFolder, selectedAccountId, selectedFolderPath]
  )

  const isModalSurfaceOpen =
    composerOpen ||
    failedSend !== null ||
    confirmOpen ||
    promptOpen ||
    goToFolderOpen ||
    addAccountDialogOpen ||
    settingsOpen ||
    extensionPrimaryDialogOpen

  /**
   * Brings a message to write in front — a new one, or a draft: one already
   * being written comes forward as it was left. Whatever was in front goes
   * to the dock.
   */
  const openComposer = useCallback(
    (data: ComposerInitialData, draft?: { status?: DraftStatus }): void => {
      const id = data.draftId ?? crypto.randomUUID()

      setComposeSessions((current) =>
        current.some((session) => session.id === id)
          ? current
          : [
              ...current,
              {
                id,
                initialData: { ...data, draftId: id },
                existing: data.draftId !== undefined,
                status: draft?.status
              }
            ]
      )
      setActiveComposeId(id)
    },
    []
  )

  const removeComposeSession = useCallback((id: string): void => {
    composerHandlesRef.current.delete(id)
    setComposeSessions((current) => current.filter((session) => session.id !== id))
    setComposeSummaries((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
    )
    setActiveComposeId((current) => (current === id ? null : current))
  }, [])

  const updateComposeSummary = useCallback((id: string, summary: ComposerSummary): void => {
    setComposeSummaries((current) => ({ ...current, [id]: summary }))
  }, [])

  /** Says what became of a message being written, and offers the way back. */
  const handleComposerClosed = useCallback(
    (id: string, outcome: ComposerOutcome): void => {
      removeComposeSession(id)

      if (outcome.kind === 'saved') {
        const { content } = outcome
        toast.success('Bozza salvata in Bozze', {
          description: content.subject.trim() || '(senza oggetto)',
          action: {
            label: 'Apri',
            onClick: () => openComposer(draftToInitialData(content))
          }
        })
        return
      }

      if (outcome.kind !== 'discarded' || !outcome.content) {
        return
      }

      const { content } = outcome
      window.mailApi.discardDraft(id).catch((error: unknown) =>
        toast.error('Bozza non eliminata', {
          description: error instanceof Error ? error.message : undefined
        })
      )
      toast('Bozza eliminata', {
        description: content.subject.trim() || '(senza oggetto)',
        duration: UNDO_TOAST_DURATION_MS,
        action: {
          label: 'Annulla',
          onClick: () => {
            // Written again as it was, and back in front.
            window.mailApi
              .saveDraft(content)
              .then((status) => openComposer(draftToInitialData(content), { status }))
              .catch((error: unknown) =>
                toast.error('Bozza non ripristinata', {
                  description: error instanceof Error ? error.message : undefined
                })
              )
          }
        }
      })
    },
    [openComposer, removeComposeSession]
  )

  /** A draft in Bozze — of this app or any other client — opened to be written on. */
  const continueDraft = useCallback(
    async (ref: MessageRef): Promise<void> => {
      // One the app does not keep yet comes from the server: a wait worth showing.
      let loadingToast: string | number | null = null
      const slow = window.setTimeout(() => {
        loadingToast = toast.loading('Apertura della bozza…')
      }, DRAFT_OPEN_FEEDBACK_DELAY_MS)

      try {
        const draft = await window.mailApi.openDraftMessage(ref)
        openComposer(draftToInitialData(draft.content), { status: draft.status })
      } catch (error) {
        toast.error('Bozza non apribile', {
          description: error instanceof Error ? error.message : undefined
        })
      } finally {
        window.clearTimeout(slow)

        if (loadingToast !== null) {
          toast.dismiss(loadingToast)
        }
      }
    },
    [openComposer]
  )

  // Opening marks the message read once its body shows (`followShownMessage`);
  // a draft opens in a composer, to be written on.
  const handleOpenRow = useCallback(
    (ref: MessageRef): void => {
      const summary = messages.find((message) => isSameMessageRef(message, ref))

      if (summary && isDraftMessage(summary)) {
        void continueDraft(ref)
        return
      }

      setSelection({ selectedRefs: [ref], cursorRef: ref, anchorRef: ref })
      setIsMessageExpanded(true)
    },
    [continueDraft, isDraftMessage, messages]
  )

  // The drafts left open — or not yet in Bozze — when the app last closed come back to the dock.
  useEffect(() => {
    if (bootstrapLoading) {
      return
    }

    let current = true

    window.mailApi
      .listDockedDrafts()
      .then((drafts) => {
        if (!current || drafts.length === 0) {
          return
        }

        setComposeSessions((sessions) => [
          ...sessions,
          ...drafts
            .filter((draft) => !sessions.some((session) => session.id === draft.content.id))
            .map((draft) => ({
              id: draft.content.id,
              initialData: draftToInitialData(draft.content),
              existing: true,
              status: draft.status
            }))
        ])
      })
      .catch(() => undefined)

    return () => {
      current = false
    }
  }, [bootstrapLoading])

  // A draft no composer holds any more that the server refused is said once:
  // it is safe here, and goes to Bozze by itself later.
  const reportedDraftFailuresRef = useRef(new Set<string>())
  const composeSessionIdsRef = useRef(new Set<string>())

  useEffect(() => {
    composeSessionIdsRef.current = new Set(composeSessions.map((session) => session.id))
  }, [composeSessions])

  useEffect(
    () =>
      window.mailApi.onDraftStatusChanged((status) => {
        const reported = reportedDraftFailuresRef.current

        if (status.state !== 'error') {
          reported.delete(status.id)
          return
        }

        if (composeSessionIdsRef.current.has(status.id) || reported.has(status.id)) {
          return
        }

        reported.add(status.id)
        toast.warning('Bozza non ancora in Bozze', {
          description:
            `È al sicuro su questo computer e ci andrà appena possibile. ${status.message ?? ''}`.trim()
        })
      }),
    []
  )

  // Set once the handlers below exist; the menu bar and the keyboard both
  // reach the commands through it.
  const runAppCommandRef = useRef<(commandId: string) => boolean>(() => false)
  const shortcutOverridesRef = useRef(uiPreferences.shortcutOverrides)

  useEffect(() => {
    shortcutOverridesRef.current = uiPreferences.shortcutOverrides
  }, [uiPreferences.shortcutOverrides])

  useEffect(
    () => window.mailApi.onAppMenuCommand((command) => void runAppCommandRef.current(command)),
    []
  )

  // What a right click on text or a link asks of the window.
  const contextMenuRequestRef = useRef<(request: ContextMenuRequest) => void>(() => undefined)

  useEffect(
    () => window.mailApi.onContextMenuRequest((request) => contextMenuRequestRef.current(request)),
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

      // Every command answers to its chord from anywhere in the window,
      // a field being typed in included — they all need Ctrl/⌘ or Alt, which
      // typing does not. The menu bar lists the same commands on macOS; on
      // Windows and Linux, where there is none, this is how they are reached.
      const command = commandForKeyEvent(event, 'main', shortcutOverridesRef.current)

      if (command) {
        if (!event.repeat && runAppCommandRef.current(command.id)) {
          event.preventDefault()
        }

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
        void deleteMessages(refsToDelete)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [deleteMessages, handleOpenRow, handleSelectAll, isModalSurfaceOpen])

  const attachmentActions = useAttachmentActions(readingRef)

  // A reply or forward goes out from the account that received the message
  // — which, in Tutti gli account, is not necessarily the one in the sidebar — and
  // knows the message, for its attachments.
  // Every address the user writes from: a reply to all leaves them out, and
  // a reply to their own message goes to the people it went to.
  const ownAddresses = useMemo(
    () => new Set(accounts.map((account) => account.email.trim().toLowerCase())),
    [accounts]
  )

  /**
   * The body of a message an action needs: the one in the reading pane, or
   * fetched — joining the download under way when the pane still waits for
   * it. Null, with the reason shown, when it cannot be had.
   */
  const messageDetailFor = useCallback(
    async (ref: MessageRef): Promise<MailMessageDetail | null> => {
      if (readingDetail && isSameMessageRef(readingDetail, ref)) {
        return readingDetail
      }

      try {
        return await window.mailApi.getMessage(ref)
      } catch (caughtError) {
        setViewError(
          caughtError instanceof Error ? caughtError.message : 'Errore nel caricamento messaggio.'
        )
        return null
      }
    },
    [readingDetail]
  )

  const openReplyComposer = useCallback(
    async (mode: 'sender' | 'all', ref: MessageRef | null = readingRef): Promise<void> => {
      const message = ref ? await messageDetailFor(ref) : null

      if (!message) {
        return
      }

      // A draft is not answered: it is written on.
      if (isDraftMessage(message)) {
        await continueDraft(summaryToMessageRef(message))
        return
      }

      const recipients = replyRecipients(message, ownAddresses, mode)

      openComposer({
        kind: 'reply',
        accountId: message.accountId,
        sourceAccountId: message.accountId,
        to: recipients.to,
        cc: recipients.cc,
        subject: ensureReplySubject(message.subject),
        quoteHtml: await buildReplyQuoteHtml(message),
        inReplyTo: message.messageId,
        references: replyReferences(message),
        original: {
          ref: summaryToMessageRef(message),
          attachments: message.attachments
        }
      })
    },
    [continueDraft, isDraftMessage, messageDetailFor, openComposer, ownAddresses, readingRef]
  )

  const openForwardComposer = useCallback(
    async (ref: MessageRef | null = readingRef): Promise<void> => {
      const message = ref ? await messageDetailFor(ref) : null

      if (!message) {
        return
      }

      if (isDraftMessage(message)) {
        await continueDraft(summaryToMessageRef(message))
        return
      }

      openComposer({
        kind: 'forward',
        accountId: message.accountId,
        sourceAccountId: message.accountId,
        subject: ensureForwardSubject(message.subject),
        quoteHtml: await buildForwardQuoteHtml(message),
        original: {
          ref: summaryToMessageRef(message),
          attachments: message.attachments
        }
      })
    },
    [continueDraft, isDraftMessage, messageDetailFor, openComposer, readingRef]
  )

  const addressActions = useMemo<AddressActions>(
    () => ({
      // Writing to someone from a message starts from the account that got it.
      onCompose: (address) => {
        const accountId = readingRef?.accountId ?? selectedAccountId

        if (accountId) {
          openComposer({ kind: 'new', accountId, to: [address] })
        }
      },
      onSearch: (address) => {
        setSearch(address.address)
      }
    }),
    [openComposer, readingRef?.accountId, selectedAccountId]
  )

  const archiveSelection = useCallback(
    (): Promise<void> =>
      runSelectionRemovalAction(
        (refs) => window.mailApi.archiveMessages(refs),
        'Archiviazione email non riuscita.'
      ),
    [runSelectionRemovalAction]
  )

  // "Sposta" opens from its button or from its chord.
  // The messages being dragged towards a folder, while the drag lasts.
  const [draggedRefs, setDraggedRefs] = useState<MessageRef[] | null>(null)

  /** A row dragged takes the selection it is part of, or goes alone and becomes the selection. */
  const handleRowDragStart = useCallback(
    (ref: MessageRef, dataTransfer: DataTransfer): void => {
      const inSelection = selection.selectedRefs.some((selected) => isSameMessageRef(selected, ref))
      const refs = inSelection ? selection.selectedRefs : [ref]

      if (!inSelection) {
        setSelection({ selectedRefs: [ref], cursorRef: ref, anchorRef: ref })
      }

      startMessageDrag(dataTransfer, refs.length, JSON.stringify(refs))
      setDraggedRefs(refs)
    },
    [selection.selectedRefs]
  )

  /**
   * Where dragged messages can land. On a folder of an account: messages of
   * that account, not all of them there already. On a folder of "Tutti gli
   * account": any, each to its own account's folder of that kind — unless
   * they are all in such a folder already.
   */
  const messageDrop = useMemo(() => {
    if (!draggedRefs || draggedRefs.length === 0) {
      return null
    }

    const roleOf = (ref: MessageRef): FolderRole | null => {
      const folder =
        ref.accountId === selectedAccountId
          ? folders.find((candidate) => candidate.path === ref.folderPath)
          : undefined
      return folder ? folderRole(folder) : currentUnifiedRole
    }

    return {
      accepts: (target: FolderDropTarget): boolean =>
        target.kind === 'role'
          ? !draggedRefs.every((ref) => roleOf(ref) === target.role)
          : draggedRefs.every((ref) => ref.accountId === target.accountId) &&
            !draggedRefs.every((ref) => ref.folderPath === target.folderPath),
      onDrop: (target: FolderDropTarget): void => {
        const refs = draggedRefs
        setDraggedRefs(null)

        void runMessageRemovalAction(
          refs,
          target.kind === 'role'
            ? (moving) => window.mailApi.moveMessagesToRole({ refs: moving, role: target.role })
            : (moving) =>
                window.mailApi.moveMessages({
                  refs: moving,
                  destinationFolderPath: target.folderPath
                }),
          'Spostamento email non riuscito.'
        )
      }
    }
  }, [currentUnifiedRole, draggedRefs, folders, runMessageRemovalAction, selectedAccountId])

  const [moveMenuOpen, setMoveMenuOpen] = useState(false)

  const changeMoveMenuOpen = useCallback(
    (open: boolean): void => {
      if (open) {
        refreshRecentMovePaths()
      }

      setMoveMenuOpen(open)
    },
    [refreshRecentMovePaths]
  )

  const moveSelectionTo = useCallback(
    (destinationFolderPath: string): Promise<void> =>
      runSelectionRemovalAction(
        (refs) => window.mailApi.moveMessages({ refs, destinationFolderPath }),
        'Spostamento email non riuscito.'
      ),
    [runSelectionRemovalAction]
  )

  /** "Crea «…» e sposta qui": the folder at the top of the account, then the move. */
  const createFolderAndMoveSelection = useCallback(
    async (name: string): Promise<void> => {
      if (!moveAccountId) {
        return
      }

      try {
        const created = await window.mailApi.createFolder({ accountId: moveAccountId, name })
        await moveSelectionTo(created.path)
      } catch (caughtError) {
        setViewError(
          caughtError instanceof Error ? caughtError.message : 'Creazione cartella non riuscita.'
        )
      }
    },
    [moveAccountId, moveSelectionTo]
  )

  /**
   * Runs a command from the menu bar or its chord. Nothing happens over an
   * open dialog or menu, and a command with nothing to act on — a reply with
   * no message open — does nothing. Returns whether it applied, so a chord
   * that did nothing is left to whatever else wants the key.
   */
  const runAppCommand = (commandId: string): boolean => {
    if (isModalSurfaceOpen || isOverlaySurfaceOpen()) {
      return false
    }

    const hasSelection = selection.selectedRefs.length > 0

    if (findCommand(commandId)?.fromExtension) {
      return (
        extensionRenderer.runCommand?.(commandId, {
          selection: extensionSelection,
          openPrimaryActionDialog: () => setExtensionPrimaryDialogOpen(true),
          hostHooks: extensionHostHooks
        }) ?? false
      )
    }

    switch (commandId as HostCommandId) {
      case 'compose':
        if (!selectedAccountId) {
          return false
        }

        openComposer({ kind: 'new', accountId: selectedAccountId })
        return true
      case 'reply':
      case 'reply-all':
        if (!readingRef) {
          return false
        }

        void openReplyComposer(commandId === 'reply' ? 'sender' : 'all')
        return true
      case 'forward':
        if (!readingRef) {
          return false
        }

        void openForwardComposer()
        return true
      case 'archive':
        if (!hasSelection) {
          return false
        }

        void archiveSelection()
        return true
      case 'move':
        if (!hasSelection) {
          return false
        }

        if (selectionAccountIds.length > 1) {
          void explainMixedAccountMove()
        } else {
          changeMoveMenuOpen(true)
        }
        return true
      case 'toggle-read':
        if (!hasSelection) {
          return false
        }

        void setSelectionSeen()
        return true
      case 'toggle-flag':
        if (!hasSelection) {
          return false
        }

        void setSelectionFlagged()
        return true
      case 'search':
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return true
      case 'check-mail':
        void window.mailApi.checkMailNow()
        return true
      case 'go-inbox': {
        const inboxPath =
          accounts.length > 1
            ? unifiedFolderPath('\\Inbox')
            : folders.find((folder) => folderRole(folder) === '\\Inbox')?.path

        if (!inboxPath) {
          return false
        }

        selectFolder(inboxPath)
        return true
      }
      case 'go-to-folder':
        if (folders.length === 0) {
          return false
        }

        setGoToFolderOpen(true)
        return true
      case 'settings':
        setSettingsOpen(true)
        return true
      case 'reader-zoom-in':
      case 'reader-zoom-out':
      case 'reader-zoom-reset':
        if (!readingRef) {
          return false
        }

        changeReaderZoom(
          commandId === 'reader-zoom-reset'
            ? READER_ZOOM_RESET
            : steppedReaderZoom(
                uiPreferencesRef.current.readerZoom,
                commandId === 'reader-zoom-in' ? 1 : -1
              )
        )
        return true
      default:
        return false
    }
  }

  useEffect(() => {
    runAppCommandRef.current = runAppCommand
    contextMenuRequestRef.current = (request) => {
      if (request.kind === 'search') {
        // Several words are looked for as the phrase they were.
        const text = request.text.replaceAll('"', '').slice(0, 120)
        setSearch(text.includes(' ') ? `"${text}"` : text)
        return
      }

      // Writing to someone from a message starts from the account that got it.
      const accountId = readingRef?.accountId ?? selectedAccountId

      if (accountId && !isModalSurfaceOpen) {
        openComposer({ kind: 'new', accountId, to: [{ address: request.address }] })
      }
    }
  })

  /**
   * The menu of a message in the list, as Outlook has it. A right click on
   * a message outside the selection selects it first, as in Outlook and
   * Finder; on one of several selected, the menu acts on all of them. The
   * commands carry the chords they answer to.
   */
  const openMessageContextMenu = async (ref: MessageRef): Promise<void> => {
    const inSelection = selection.selectedRefs.some((selected) => isSameMessageRef(selected, ref))
    const targets = inSelection ? selection.selectedRefs : [ref]

    if (!inSelection) {
      setSelection({ selectedRefs: [ref], cursorRef: ref, anchorRef: ref })
    }

    const summaries = messages.filter((message) =>
      targets.some((target) => isSameMessageRef(summaryToMessageRef(message), target))
    )
    const single = targets.length === 1 ? (summaries[0] ?? null) : null
    const targetAccountIds = Array.from(new Set(targets.map((target) => target.accountId)))
    const moveAccountFolders =
      targetAccountIds.length !== 1
        ? []
        : targetAccountIds[0] === selectedAccountId
          ? folders
          : await window.mailApi.listFolders(targetAccountIds[0]).catch(() => [])
    const sourcePaths = new Set(targets.map((target) => target.folderPath))
    const onlyFolder = sourcePaths.size === 1 ? [...sourcePaths][0] : null
    const overrides = uiPreferencesRef.current.shortcutOverrides
    const chordOf = (commandId: string): string | undefined => {
      const command = findCommand(commandId)
      return command ? commandChord(command, overrides) : undefined
    }
    const moveItems = (nodes: ReadonlyArray<FolderTreeNode>): ContextMenuItem[] =>
      nodes.map((node) => {
        const own: ContextMenuItem = {
          id: `move:${node.path}`,
          label: folderNodeLabel(node),
          enabled: node.folder !== null && node.path !== onlyFolder
        }

        return node.children.length === 0
          ? own
          : {
              id: `folder:${node.path}`,
              label: folderNodeLabel(node),
              submenu: [
                ...(node.folder ? [own, { type: 'separator' } as const] : []),
                ...moveItems(node.children)
              ]
            }
      })
    const moveTree = buildFolderTree(moveAccountFolders)
    const sender = single?.from[0]
    const singleDraft = single !== null && isDraftMessage(single)

    const chosen = await window.mailApi.showContextMenu([
      ...(single
        ? [{ id: 'open', label: singleDraft ? 'Continua a scrivere' : 'Apri', chord: 'Enter' }]
        : []),
      { type: 'separator' },
      ...(single && !singleDraft
        ? [
            { id: 'reply', label: 'Rispondi', chord: chordOf('reply') },
            { id: 'reply-all', label: 'Rispondi a tutti', chord: chordOf('reply-all') },
            { id: 'forward', label: 'Inoltra', chord: chordOf('forward') },
            { type: 'separator' } as const
          ]
        : []),
      {
        id: 'toggle-read',
        label: summaries.some((message) => !message.isRead)
          ? 'Segna come letto'
          : 'Segna come non letto',
        chord: chordOf('toggle-read')
      },
      {
        id: 'toggle-flag',
        label:
          summaries.length > 0 && summaries.every((message) => message.isFlagged)
            ? 'Rimuovi contrassegno'
            : 'Contrassegna',
        chord: chordOf('toggle-flag')
      },
      { type: 'separator' },
      { id: 'archive', label: 'Archivia', chord: chordOf('archive') },
      targetAccountIds.length === 1 && moveTree.length > 0
        ? { id: 'move', label: 'Sposta in', submenu: moveItems(moveTree) }
        : { id: 'move', label: 'Sposta in', enabled: false },
      ...COMMANDS.filter((command) => command.fromExtension).map((command) => ({
        id: `command:${command.id}`,
        label: command.label,
        chord: chordOf(command.id)
      })),
      { type: 'separator' },
      ...(sender
        ? [
            {
              id: 'sender-messages',
              label: `Mostra i messaggi di ${single?.senderLabel || sender.address}`
            },
            { type: 'separator' } as const
          ]
        : []),
      { id: 'delete', label: 'Elimina', chord: IS_MAC ? 'Backspace' : 'Delete' }
    ])

    if (!chosen) {
      return
    }

    if (chosen.startsWith('move:')) {
      const destinationFolderPath = chosen.slice('move:'.length)
      await runMessageRemovalAction(
        targets,
        (refs) => window.mailApi.moveMessages({ refs, destinationFolderPath }),
        'Spostamento email non riuscito.'
      )
      return
    }

    if (chosen.startsWith('command:')) {
      runAppCommandRef.current(chosen.slice('command:'.length))
      return
    }

    switch (chosen) {
      case 'open':
        handleOpenRow(ref)
        return
      case 'reply':
      case 'reply-all':
      case 'forward':
        if (chosen === 'forward') {
          await openForwardComposer(ref)
        } else {
          await openReplyComposer(chosen === 'reply' ? 'sender' : 'all', ref)
        }
        return
      case 'toggle-read':
      case 'toggle-flag':
      case 'archive':
        runAppCommandRef.current(chosen)
        return
      case 'sender-messages':
        if (sender) {
          setSearch(`da:${sender.address}`)
        }
        return
      case 'delete':
        await deleteMessages(targets)
        return
    }
  }

  const handleComposerSendRequested = useCallback(
    (payload: ComposeMailInput, draft: ComposerInitialData): void => {
      if (draft.draftId) {
        removeComposeSession(draft.draftId)
      }

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
    [removeComposeSession]
  )

  const settleFailedSend = useCallback(
    (retry: boolean): void => {
      if (!failedSend) {
        return
      }

      setFailedSends((current) => current.filter((entry) => entry.id !== failedSend.id))

      if (retry) {
        openComposer(failedSend.draft)
      } else if (failedSend.draft.draftId) {
        // Not reopened now: it waits in Bozze, not in the dock.
        void window.mailApi.closeDraft(failedSend.draft.draftId).catch(() => undefined)
      }
    },
    [failedSend, openComposer]
  )

  const onAccountCreated = (account: MailAccount): void => {
    setAccounts((current) => [...current, account])
    setSelectedAccountId(account.id)
    setShowWelcomeGate(false)
  }

  const enterWorkspace = useCallback((): void => {
    if (accounts.length === 0) {
      return
    }

    setSelectedAccountId((current) => {
      if (current && accounts.some((account) => account.id === current)) {
        return current
      }

      return accounts[0]?.id ?? null
    })
    setShowWelcomeGate(false)
  }, [accounts])

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

  const selectedAccountRecord = accounts.find((account) => account.id === selectedAccountId)
  const selectedAccountLabel =
    selectedAccountRecord?.displayName || selectedAccountRecord?.email || 'Cartelle'

  // What the view is called where it is named: the folder, or a folder of
  // "Tutti gli account".
  const currentViewLabel = currentUnifiedRole
    ? `${folderRoleLabel(currentUnifiedRole)} · ${ALL_ACCOUNTS_LABEL}`
    : currentFolder
      ? folderDisplayName(currentFolder)
      : 'Conversazioni'
  const filterNouns =
    messageFilter === 'unread'
      ? (['messaggio non letto', 'messaggi non letti'] as const)
      : messageFilter === 'flagged'
        ? (['messaggio contrassegnato', 'messaggi contrassegnati'] as const)
        : (['messaggio', 'messaggi'] as const)
  const listCountLabel = activeSearchQuery
    ? formatCount(totalMessagesInFolder, 'risultato', 'risultati') +
      (serverSearchStatus === 'searching' ? ' · cerco anche nel testo…' : '')
    : formatCount(totalMessagesInFolder, filterNouns[0], filterNouns[1])
  const notYetSynced = Math.max(0, listCounts.serverCount - listCounts.cachedCount)
  const listEmptyState: MessageListEmptyState | null = loadingMessages
    ? null
    : activeSearchQuery
      ? serverSearchStatus === 'searching'
        ? {
            kind: 'search',
            title: `Cerco «${activeSearchQuery}»…`,
            lines: [
              `Nessun riscontro tra mittenti, destinatari, oggetti e anteprime di «${currentViewLabel}»: sto cercando nel testo completo dei messaggi sul server.`
            ]
          }
        : {
            kind: 'search',
            title: `Nessun messaggio trovato per «${activeSearchQuery}»`,
            lines: [
              searchedScopeLine(
                listCounts.cachedCount,
                currentViewLabel,
                serverSearchStatus === 'done'
              ),
              ...(messageFilter !== 'all'
                ? [`Solo tra i ${filterNouns[1]}: il filtro in alto è attivo.`]
                : []),
              ...(notYetSynced > 0
                ? [
                    notYetSynced === 1
                      ? 'Un messaggio della cartella è ancora in arrivo dal server e non è compreso.'
                      : `${notYetSynced.toLocaleString('it-IT')} messaggi della cartella sono ancora in arrivo dal server e non sono compresi.`
                  ]
                : [])
            ],
            action: { label: 'Esci dalla ricerca', onClick: clearSearch }
          }
      : messageFilter !== 'all'
        ? {
            kind: 'filter',
            title: `Nessun ${filterNouns[0]} in «${currentViewLabel}»`,
            lines: [],
            action: { label: 'Mostra tutti', onClick: () => setMessageFilter('all') }
          }
        : { kind: 'folder', title: `Nessun messaggio in «${currentViewLabel}»`, lines: [] }

  const listViewProps: MessageListViewProps = {
    title: currentViewLabel,
    searchQuery: search.trim(),
    onClearSearch: clearSearch,
    messages,
    sections: messageSections,
    countLabel: listCountLabel,
    emptyState: listEmptyState,
    selection,
    highlightTerms,
    sort: uiPreferences.messageListSort,
    onSortChange: handleMessageListSortChange,
    grouping: uiPreferences.messageGrouping,
    onGroupingChange: handleMessageGroupingChange,
    invertVisualOrder: uiPreferences.invertMessageListOrder,
    primaryAddressMode,
    accountLabels,
    canLoadMoreMessages: hasMoreMessages,
    loadingMoreMessages,
    onLoadMoreMessages: loadMoreMessagesHandler,
    revealCursorToken,
    onRowsInView: hydratePreviewsInView,
    onActivateRow: handleActivateRow,
    onOpenRow: handleOpenRow,
    onRowContextMenu: (ref) => void openMessageContextMenu(ref),
    onRowDragStart: handleRowDragStart,
    onRowDragEnd: () => setDraggedRefs(null),
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
    <CommandShortcutsProvider overrides={uiPreferences.shortcutOverrides}>
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
        inert={composerOpen}
        dockVisible={!composerOpen && composeSessions.length > 0}
        dock={
          <ComposeDock
            entries={composeSessions
              .filter((session) => session.id !== activeComposeId)
              .map((session) => ({
                id: session.id,
                kind: session.initialData.kind,
                summary: composeSummaries[session.id] ?? null
              }))}
            hidden={composerOpen}
            onRestore={setActiveComposeId}
            onClose={(id) => void composerHandlesRef.current.get(id)?.close()}
          />
        }
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
                accountLabel={selectedAccountLabel}
                folders={folders}
                unifiedFolders={accounts.length > 1 ? unifiedSummaries : []}
                selectedFolderPath={selectedFolderPath}
                messageDrop={messageDrop}
                onSelectFolder={selectFolder}
                onFolderContextMenu={(target) => void openFolderContextMenu(target)}
              />
            )
          }
          toolbar={
            <MailToolbar
              moveFolders={moveFolders}
              moveExcludedPath={moveExcludedPath}
              recentMovePaths={recentMovePaths}
              onMoveAcrossAccounts={
                selectionAccountIds.length > 1 ? () => void explainMixedAccountMove() : undefined
              }
              search={search}
              searchInputRef={searchInputRef}
              searchScopeLabel={
                currentUnifiedRole ? folderRoleLabel(currentUnifiedRole) : currentViewLabel
              }
              onSearchChange={setSearch}
              filter={messageFilter}
              onFilterChange={setMessageFilter}
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
              onArchiveClassic={() => void archiveSelection()}
              moveMenuOpen={moveMenuOpen}
              onMoveMenuOpenChange={changeMoveMenuOpen}
              onMoveToFolder={(destinationFolderPath) =>
                void moveSelectionTo(destinationFolderPath)
              }
              onCreateFolderAndMove={(name) => void createFolderAndMoveSelection(name)}
              onDelete={() => void deleteMessages(selection.selectedRefs)}
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
              moveFolders={moveFolders}
              moveExcludedPath={moveExcludedPath}
              recentMovePaths={recentMovePaths}
              onMovePickerOpen={refreshRecentMovePaths}
              message={messageForViewer}
              bodyStatus={readerBodyStatus}
              onRetryBody={() => {
                if (readingRef) {
                  void loadMessageDetail(readingRef)
                }
              }}
              isExpanded={isMessageExpanded}
              selectedCount={selection.selectedRefs.length}
              wholeViewSelection={
                hasMoreMessages &&
                selection.selectedRefs.length > 1 &&
                selection.selectedRefs.length === messages.length
                  ? {
                      total: totalMessagesInFolder,
                      selecting: selectingWholeView,
                      onSelect: () => void selectWholeView()
                    }
                  : undefined
              }
              onReply={() => void openReplyComposer('sender')}
              onReplyAll={() => void openReplyComposer('all')}
              onForward={() => void openForwardComposer()}
              onContinueDraft={
                readingRef && messageForViewer && isDraftMessage(messageForViewer)
                  ? () => void continueDraft(readingRef)
                  : undefined
              }
              onArchive={() => void archiveSelection()}
              onDelete={() => void deleteMessages(selection.selectedRefs)}
              onMoveToFolder={(destinationFolderPath) =>
                void moveSelectionTo(destinationFolderPath)
              }
              onCreateFolderAndMove={(name) => void createFolderAndMoveSelection(name)}
              onToggleExpanded={() => {
                if (!readingRef) {
                  return
                }

                setIsMessageExpanded((current) => !current)
              }}
              onToggleSeen={(seen) => {
                if (readingRef) {
                  keepShownReadState([readingRef])
                  void setMessagesKeyword([readingRef], '\\Seen', seen)
                }
              }}
              onToggleFlagged={(flagged) => {
                if (readingRef) {
                  void setMessagesKeyword([readingRef], '\\Flagged', flagged)
                }
              }}
              attachmentActions={attachmentActions}
              zoom={uiPreferences.readerZoom}
              onZoomChange={changeReaderZoom}
              detailsOpen={uiPreferences.readerDetailsOpen}
              onDetailsOpenChange={(readerDetailsOpen) =>
                updateUiPreferences({ readerDetailsOpen })
              }
              addressActions={addressActions}
            />
          }
        />

        {composeSessions.map((session) => (
          <MailComposer
            key={session.id}
            ref={(handle) => {
              if (handle) {
                composerHandlesRef.current.set(session.id, handle)
              } else {
                composerHandlesRef.current.delete(session.id)
              }
            }}
            session={session}
            open={session.id === activeComposeId}
            accounts={accounts}
            onMinimize={() =>
              setActiveComposeId((current) => (current === session.id ? null : current))
            }
            onClosed={(outcome) => handleComposerClosed(session.id, outcome)}
            onSendRequested={handleComposerSendRequested}
            onSummaryChange={(summary) => updateComposeSummary(session.id, summary)}
          />
        ))}

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
          cancelLabel="Lascia in Bozze"
          initialFocus="confirm"
          onConfirm={() => settleFailedSend(true)}
          onCancel={() => settleFailedSend(false)}
        />

        {confirmDialog}
        {promptDialog}
        <Dialog open={goToFolderOpen} onOpenChange={setGoToFolderOpen}>
          <DialogContent hideClose className="w-auto gap-0 p-0" aria-describedby={undefined}>
            <DialogTitle className="sr-only">Vai a una cartella</DialogTitle>
            <FolderPicker
              folders={folders}
              recentPaths={[]}
              excludedPath={selectedFolderPath}
              onPick={(folderPath) => {
                setGoToFolderOpen(false)
                selectFolder(folderPath)
              }}
            />
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
          uiPreferences={uiPreferences}
          onUiPreferencesChange={updateUiPreferences}
          onRemoveAccount={(accountId) => void removeAccount(accountId)}
          onClearAccountData={(accountId) => void clearAccountData(accountId)}
          onClearDatabaseData={() => void clearAllDataKeepAccounts()}
          onAddAccount={() => setAddAccountDialogOpen(true)}
          onUnifiedPreferencesChanged={handleUnifiedPreferencesChanged}
        />
      </AppFrame>
    </CommandShortcutsProvider>
  )
}

export default App
