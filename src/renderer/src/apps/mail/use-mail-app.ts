/**
 * The Posta: its state, its effects and what it does — the folders and the
 * accounts, the list with its search, filters and selection, the reading
 * pane, the actions on messages, its keys and its commands.
 *
 * Called by the shell (`App`), so the mail keeps its place while another app
 * is in front, and what the shell needs of it — opening a message or a
 * folder from anywhere, what the user is looking at for the Segretario, the
 * accounts' state for the settings — comes back with the rest. The panes
 * draw from the same value (`MailSidebar`, `MailMessageList`, `MailReader`,
 * `MailNotice`, `MailDialogs`).
 */
import {
  type ComponentProps,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState
} from 'react'

import { toast } from 'sonner'

import type {
  FolderDropTarget,
  FolderMenuTarget,
  FolderSidebar
} from '@renderer/features/mail/folder-sidebar'
import { draftToInitialData, type ComposerInitialData } from '@renderer/features/mail/mail-composer'
import {
  EMPTY_MESSAGE_HIGHLIGHT_TERMS,
  type MessageHighlightTerms,
  type PrimaryAddressMode
} from '@renderer/features/mail/message-list-shared'
import { summarizeSyncStatus, type SyncSummary } from '@renderer/features/workspace/sync-status'
import { rowWorkKey, savedOnly, useRowWork } from '@renderer/features/segretario/row-work'
import { useConversationProjectTags } from '@renderer/features/segretario/conversation-projects'
import type { CalendarConnection } from '@shared/calendar'
import type { AskedMail, MessageRowWork, Project, SavedSearch } from '@shared/segretario'
import extensionRenderer from '@app/extension/renderer'
import type { ExtensionSelectionContext, ExtensionHostHooks } from '@app/extension/types'
import type { AddressActions } from '@renderer/features/mail/address-tokens'
import {
  useAttachmentActions,
  type AttachmentActions
} from '@renderer/features/mail/use-attachment-actions'
import type { ConfirmOptions } from '@renderer/components/ui/confirm-dialog'
import { usePromptDialog } from '@renderer/components/ui/prompt-dialog'
import {
  folderDisplayName,
  folderRole,
  folderRoleLabel,
  unifiedFolderPath,
  unifiedFolderRole,
  isAcrossAccounts,
  isSegretarioList,
  segretarioSearch,
  segretarioSearchPath,
  segretarioProject,
  segretarioProjectPath,
  segretarioView,
  segretarioViewLabel,
  type FolderRole,
  type SegretarioView
} from '@shared/folders'
import { startMessageDrag } from '@renderer/lib/message-drag'
import { foldSearchText } from '@shared/search'
import { buildMessageSections, type MessageSection } from '@renderer/lib/message-sections'
import { commandForKeyEvent, IS_MAC } from '@renderer/lib/command-shortcuts'
import { buildFolderTree, folderNodeLabel, type FolderTreeNode } from '@renderer/lib/folder-tree'
import { READER_ZOOM_RESET, steppedReaderZoom } from '@renderer/lib/reader-zoom'
import {
  applySelectionIntent,
  EMPTY_MESSAGE_SELECTION,
  isSameMessageRef,
  messageRefKey,
  moveSelectionCursor,
  reconcileSelection,
  reconcileWithNeighbour,
  selectAllMessages,
  summaryToMessageRef,
  uniqueMessageRefs,
  type MessageSelectionState,
  type SelectionIntent
} from '@renderer/lib/message-selection'
import {
  DEFAULT_MESSAGE_LIST_FILTER,
  MAX_MESSAGES_PER_ACTION,
  MESSAGE_LIST_PAGE_SIZE
} from '@shared/models'
import { commandChord, COMMANDS, findCommand, type HostCommandId } from '@shared/commands'
import type { ContextMenuItem, ContextMenuRequest } from '@shared/context-menu'
import { replyRecipients, replyReferences } from '@shared/reply'
import { forwardSubject, replySubject } from '@shared/subject'
import { highlightTermsForField, parseSearchQuery } from '@shared/search'
import type {
  AccountConnectionState,
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
  UnifiedFolderSummary
} from '@shared/models'

import { buildForwardQuoteHtml, buildReplyQuoteHtml } from './reply-quote'

const ALL_ACCOUNTS_LABEL = 'tutti gli account'
/** A draft that takes longer than this to open says it is opening. */
const DRAFT_OPEN_FEEDBACK_DELAY_MS = 300
/** The rows around the one being read whose bodies are fetched ahead. */
const PREFETCHED_NEIGHBOUR_OFFSETS = [1, -1, 2, -2]
/** How long sync events gather before the list is read again for them. */
const LIST_REFRESH_COALESCE_MS = 300
/** Mail coming and going moves the views' counts: gathered longer, as a sync brings it in bursts. */
const VIEW_COUNTS_AFTER_MAIL_MS = 1_500
/** How long a search rests before the servers are asked too: not at every keystroke. */
const SERVER_SEARCH_DELAY_MS = 450
/** How long a message stays in the pane before its neighbours are fetched: skimming past fetches nothing. */
const PREFETCH_DWELL_MS = 300

/** Folders whose rows are about the recipient rather than the sender. */
const RECIPIENT_ORIENTED_SPECIAL_USES = new Set(['\\Sent', '\\Drafts'])

/** The most messages a request to the Segretario carries along. */
const SEGRETARIO_CONTEXT_LIMIT = 200
/** Conversations marked handled per request: a selection of any size goes in these. */
const MARK_HANDLED_BATCH = 1000

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

/** What the shell gives the mail. */
export interface MailHost {
  /** The accounts, as the shell's bootstrap has them. */
  accounts: MailAccount[]
  setAccounts: Dispatch<SetStateAction<MailAccount[]>>
  /** The AI on: the Segretario's views, work, filter and projects show in the mail. */
  aiOn: boolean
  /**
   * The mail is the app in front: the folder in sight is the one the engine
   * watches live, and the keys of the list and Escape are the mail's.
   */
  active: boolean
  /** Brings the mail to the front, from wherever the user is. */
  show: () => void
  uiPreferences: UiPreferences
  /** The preferences as they are at event time, a pinch of the reader's zoom included. */
  uiPreferencesRef: RefObject<UiPreferences>
  updateUiPreferences: (patch: Partial<UiPreferences>) => void
  changeReaderZoom: (next: number) => void
  /** The shell's question, asked the way `window.confirm` is. */
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /**
   * Every address the user writes from: a reply to all leaves them out, and
   * a reply to their own message goes to the people it went to.
   */
  ownAddresses: ReadonlySet<string>
  /** Brings a message to write in front (the composer is the shell's: the Segretario writes too). */
  openComposer: (data: ComposerInitialData, draft?: { status?: DraftStatus }) => void
  /**
   * Something of the shell's is open in front — a message being written, a
   * failed send, a question, the guided setup, the settings: the mail's keys
   * and commands rest.
   */
  shellModalOpen: boolean
  /** Runs any command of the app, as the menu bar and the chords do (see `runAppCommand` in `App`). */
  runAppCommandRef: RefObject<(commandId: string) => boolean>
}

/**
 * What the mail shows, for the Segretario to know what the user is looking
 * at (as `CalendarSight` is for the calendar).
 */
export interface MailSight {
  /** The messages selected, as many as a request to the Segretario carries along. */
  messages: MessageRef[]
  selectionCount: number
  /** The account in the sidebar. */
  accountId: string | null
  /** What the view is called: the folder, a folder of "Tutti gli account", a view or project of the Segretario's. */
  viewLabel: string
  /** What the context says: the selection, the message being read, or the view. */
  label: string
  /** What the Segretario has on the message being read. */
  work: MessageRowWork | null
  messageOpen: boolean
  /** The project whose list is open, by name. */
  project: string | null
}

/** What the mail gives the shell: the way into it from anywhere, what it shows, its accounts' state. */
export interface MailForShell {
  /** The account the sidebar shows. */
  selectedAccountId: string | null
  setSelectedAccountId: Dispatch<SetStateAction<string | null>>
  /** Each account's connection, as the engine reports it. */
  accountConnections: Record<string, AccountConnectionState>
  /** The sync state of the accounts on screen, for the rail. */
  syncSummary: SyncSummary | null
  removingAccountId: string | null
  clearingAccountDataId: string | null
  clearingDatabaseData: boolean
  /** A mail connection taken away — with the calendars given, the whole access — once the user says so. */
  removeAccount: (
    accountId: string,
    calendars?: ReadonlyArray<CalendarConnection>,
    options?: { confirmed?: boolean }
  ) => Promise<void>
  clearAccountData: (accountId: string) => Promise<void>
  clearAllDataKeepAccounts: () => Promise<void>
  /** "Tutti gli account" now gathers other accounts: its folders, counts and list follow. */
  handleUnifiedPreferencesChanged: () => void
  /** Shows a message in its own folder, selected, the mail in front. */
  openMessage: (ref: MessageRef) => void
  /** Opens a folder — of the account, of "Tutti gli account", a view, a project — the mail in front. */
  selectFolder: (folderPath: string) => void
  /** Opens the list of a search asked in words. */
  openAskedSearch: (asked: AskedMail) => void
  /** The reading pane takes the workspace, the list beside it. */
  isMessageExpanded: boolean
  /** A dialog or the composer is in front, of the shell's or the mail's: commands rest. */
  isModalSurfaceOpen: boolean
  /** Runs a command of the mail's — or of the extension, on the selection. Returns whether it applied. */
  runCommand: (commandId: string) => boolean
  sight: MailSight
}

/** The mail as its panes draw it: what the shell has of it, and everything they show and do. */
export interface MailApp
  extends
    MailForShell,
    Pick<
      MailHost,
      | 'accounts'
      | 'aiOn'
      | 'uiPreferences'
      | 'updateUiPreferences'
      | 'changeReaderZoom'
      | 'openComposer'
    > {
  // The sidebar.
  selectAccount: (accountId: string) => void
  loadingFolders: boolean
  folders: MailFolder[]
  unifiedSummaries: UnifiedFolderSummary[]
  selectedFolderPath: string | null
  segretarioViewCounts: Record<SegretarioView, number> | null
  projects: Project[]
  createProject: (title: string) => Promise<void>
  savedSearches: ReadonlyArray<SavedSearch>
  messageDrop: ComponentProps<typeof FolderSidebar>['messageDrop']
  openFolderContextMenu: (target: FolderMenuTarget) => Promise<void>

  // The list.
  showMessagePanelLoader: boolean
  messagePanelLoaderText: string
  currentViewLabel: string
  currentUnifiedRole: FolderRole | null
  currentProjectId: string | null
  currentSearchId: string | null
  currentSaved: SavedSearch | undefined
  currentAsked: AskedMail | SavedSearch | undefined
  conversationProjectTags: ReadonlyMap<string, string>
  askingSegretario: boolean
  askSegretario: (question: string) => void
  /** Stops the search asked in words under way. */
  stopAskingSegretario: () => void
  saveSearch: (searchId: string) => Promise<void>
  removeSavedSearch: (searchId: string) => Promise<void>
  search: string
  setSearch: Dispatch<SetStateAction<string>>
  clearSearch: () => void
  searchInputRef: RefObject<HTMLInputElement | null>
  activeSearchQuery: string
  serverSearchStatus: 'idle' | 'searching' | 'done' | 'failed'
  messageFilter: MessageListFilter
  setMessageFilter: Dispatch<SetStateAction<MessageListFilter>>
  messages: MailMessageSummary[]
  rowWork: ReadonlyMap<string, MessageRowWork>
  messageSections: MessageSection[]
  totalMessagesInFolder: number
  listCounts: { cachedCount: number; serverCount: number }
  loadingMessages: boolean
  selection: MessageSelectionState
  highlightTerms: MessageHighlightTerms
  handleMessageListSortChange: (next: MailMessageListSort) => void
  handleMessageGroupingChange: (next: MessageGroupingMode) => void
  primaryAddressMode: PrimaryAddressMode
  accountLabels: ReadonlyMap<string, string> | null
  hasMoreMessages: boolean
  loadingMoreMessages: boolean
  loadMoreMessagesHandler: () => void
  revealCursorToken: number
  hydratePreviewsInView: (inView: MailMessageSummary[]) => void
  handleActivateRow: (ref: MessageRef, intent: SelectionIntent) => void
  handleOpenRow: (ref: MessageRef) => void
  openMessageContextMenu: (ref: MessageRef) => Promise<void>
  handleRowDragStart: (ref: MessageRef, dataTransfer: DataTransfer) => void
  setDraggedRefs: Dispatch<SetStateAction<MessageRef[] | null>>
  handleToggleRowFlag: (ref: MessageRef, flagged: boolean) => void
  handleSelectSection: (section: { messages: MailMessageSummary[] }) => void
  handleSelectAll: () => void
  clearSelection: () => void

  // The reading pane.
  messageForViewer: MailMessageDetail | null
  readingRef: MessageRef | null
  readerBodyStatus: 'ready' | 'loading' | 'failed'
  loadMessageDetail: (ref: MessageRef) => Promise<void>
  setIsMessageExpanded: Dispatch<SetStateAction<boolean>>
  selectingWholeView: boolean
  selectWholeView: () => Promise<void>
  moveFolders: MailFolder[]
  moveExcludedPath: string | null
  recentMovePaths: string[]
  selectionAccountIds: string[]
  explainMixedAccountMove: () => Promise<void>
  moveMenuOpen: boolean
  changeMoveMenuOpen: (open: boolean) => void
  toggleSeenLabel: string
  selectionFlagged: boolean
  archiveSelection: () => Promise<void>
  moveSelectionTo: (destinationFolderPath: string) => Promise<void>
  createFolderAndMoveSelection: (name: string) => Promise<void>
  setSelectionSeen: () => Promise<void>
  setSelectionFlagged: () => Promise<void>
  deleteMessages: (refs: ReadonlyArray<MessageRef>) => Promise<void>
  openReplyComposer: (mode: 'sender' | 'all', ref?: MessageRef | null) => Promise<void>
  openForwardComposer: (ref?: MessageRef | null) => Promise<void>
  isDraftMessage: (
    message: Pick<MailMessageSummary, 'accountId' | 'folderPath' | 'flags'>
  ) => boolean
  continueDraft: (ref: MessageRef) => Promise<void>
  attachmentActions: AttachmentActions | null
  addressActions: AddressActions
  extensionSelection: ExtensionSelectionContext
  extensionHostHooks: ExtensionHostHooks

  // The notice and the dialogs.
  viewError: string | null
  setViewError: Dispatch<SetStateAction<string | null>>
  promptDialog: React.JSX.Element
  goToFolderOpen: boolean
  setGoToFolderOpen: Dispatch<SetStateAction<boolean>>
  extensionPrimaryDialogOpen: boolean
  setExtensionPrimaryDialogOpen: Dispatch<SetStateAction<boolean>>
}

export function useMailApp({
  accounts,
  setAccounts,
  aiOn,
  active,
  show,
  uiPreferences,
  uiPreferencesRef,
  updateUiPreferences,
  changeReaderZoom,
  confirm,
  ownAddresses,
  openComposer,
  shellModalOpen,
  runAppCommandRef
}: MailHost): MailApp {
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

  const fetchedRowWork = useRowWork(messages)
  // With the AI off the rows keep only what an extension saved: nothing of the Segretario shows.
  const rowWork = useMemo(
    () => (aiOn ? fetchedRowWork : savedOnly(fetchedRowWork)),
    [aiOn, fetchedRowWork]
  )

  // "Attivi" is the Segretario's: with it off, the list shows everything again.
  useEffect(() => {
    if (!aiOn && messageFilter === 'active') {
      setMessageFilter('all')
    }
  }, [aiOn, messageFilter])
  const { prompt, dialog: promptDialog, open: promptOpen } = usePromptDialog()
  const [extensionPrimaryDialogOpen, setExtensionPrimaryDialogOpen] = useState(false)
  // The folders of "Tutti gli account", one per role, with their counts.
  const [unifiedSummaries, setUnifiedSummaries] = useState<UnifiedFolderSummary[]>([])
  // The folders the list on screen shows (see `MailMessageListPage.mailboxes`):
  // the sync events about them are the ones it follows.
  const viewMailboxesRef = useRef<Array<{ accountId: string; folderPath: string }>>([])
  // The accounts Tutti gli account gathers, so its rows can say which one each is from.
  const [unifiedAccountIds, setUnifiedAccountIds] = useState<readonly string[]>([])

  useEffect(() => {
    activeSearchQueryRef.current = search.trim()
  }, [search])

  const handleMessageListSortChange = useCallback(
    (next: MailMessageListSort): void => {
      updateUiPreferences({ messageListSort: next })
    },
    [updateUiPreferences]
  )

  const handleMessageGroupingChange = useCallback(
    (next: MessageGroupingMode): void => {
      updateUiPreferences({ messageGrouping: next })
    },
    [updateUiPreferences]
  )

  const syncSummary = useMemo(() => {
    const accountsOnScreen = isAcrossAccounts(selectedFolderPath)
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

  // How many conversations each view of the Segretario's holds; null until known.
  const [segretarioViewCounts, setSegretarioViewCounts] = useState<Record<
    SegretarioView,
    number
  > | null>(null)

  // The projects the Segretario files conversations into — hidden and concluded ones too, for their names.
  const [projects, setProjects] = useState<Project[]>([])
  const conversationProjectTags = useConversationProjectTags(messages, aiOn)

  const refreshSegretarioViews = useCallback(async (): Promise<void> => {
    try {
      const [counts, nextProjects] = await Promise.all([
        window.mailApi.getSegretarioViewCounts(),
        window.segretarioApi.listProjects({ includeHidden: true })
      ])
      setSegretarioViewCounts(counts)
      setProjects(nextProjects)
    } catch {
      return
    }
  }, [])

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
          if (isAcrossAccounts(currentFolderPath)) {
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

          // The list as it was shown — the ref follows it after each render — tells the neighbour.
          const reconciled = reconcileWithNeighbour(
            current,
            orderedMessageRefsRef.current,
            availableRefs
          )

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
  const messageFilterRef = useRef(messageFilter)

  useEffect(() => {
    messageFilterRef.current = messageFilter
  }, [messageFilter])

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

  // The Segretario's views follow its work: their counts, and the list when one is open. They
  // follow the mail too: a message in the Trash sets aside what is open in it, one put back
  // brings it back, wherever the move was made.
  const viewCountsTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!aiOn) {
      return
    }

    void refreshSegretarioViews()

    const scheduleCounts = (delay: number): void => {
      if (viewCountsTimerRef.current === null) {
        viewCountsTimerRef.current = window.setTimeout(() => {
          viewCountsTimerRef.current = null
          void refreshSegretarioViews()
        }, delay)
      }
    }

    const unsubscribeWork = window.segretarioApi.onWorkChanged(() => {
      // A list made from the work — a view of the Segretario's, or any folder showing the active
      // ones — follows it.
      if (
        isSegretarioList(currentViewRef.current?.folderPath) ||
        messageFilterRef.current === 'active'
      ) {
        scheduleListRefresh()
      }

      scheduleCounts(LIST_REFRESH_COALESCE_MS)
    })
    const unsubscribeMail = window.mailApi.onMessagesChanged((event) => {
      if (event.added.length > 0 || event.removedUids.length > 0) {
        scheduleCounts(VIEW_COUNTS_AFTER_MAIL_MS)
      }
    })

    return () => {
      unsubscribeWork()
      unsubscribeMail()

      if (viewCountsTimerRef.current !== null) {
        window.clearTimeout(viewCountsTimerRef.current)
        viewCountsTimerRef.current = null
      }
    }
  }, [accounts, refreshSegretarioViews, scheduleListRefresh, aiOn])

  useEffect(
    () => () => {
      if (listRefreshTimerRef.current !== null) {
        clearTimeout(listRefreshTimerRef.current)
      }
    },
    []
  )

  /** A mail connection taken away — with the calendars given, the whole access — once the user says so. */
  const removeAccount = useCallback(
    async (
      accountId: string,
      calendars: ReadonlyArray<CalendarConnection> = [],
      options: { confirmed?: boolean } = {}
    ): Promise<void> => {
      if (removingAccountId) {
        return
      }

      const account = accounts.find((entry) => entry.id === accountId)
      // Asked already where the user chose it — a refusal's window — or asked now.
      const confirmed =
        options.confirmed ||
        (await confirm({
          title: `Disconnettere ${account?.email ?? "l'account"}?`,
          description: `SIEVER Mail smette di ricevere e inviare con questo account e toglie dal computer la sua posta, la sua firma e quello che il Segretario aveva annotato su questo account${
            calendars.length > 0 ? ', e i suoi calendari' : ''
          }. Sul server non cambia nulla: puoi ricollegarlo quando vuoi.`,
          confirmLabel: 'Disconnetti',
          destructive: true
        }))

      if (!confirmed) {
        return
      }

      setViewError(null)
      setRemovingAccountId(accountId)

      try {
        for (const calendar of calendars) {
          await window.calendarApi.disconnect(calendar.id)
        }

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
    void refreshSegretarioViews()

    if (!selectedAccountId || !selectedFolderPath || !isAcrossAccounts(selectedFolderPath)) {
      return
    }

    void refreshCurrentFolder(selectedAccountId, selectedFolderPath)
  }, [
    refreshCurrentFolder,
    refreshSegretarioViews,
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
  // it — Radix layers do, and so does the search field. With another app in
  // front the key is that app's: the mail on screen behind nothing is left as it is.
  const hasActiveSearch = search.trim().length > 0

  useEffect(() => {
    const hasMultiSelection = selection.selectedRefs.length > 1

    if (!active || (!isMessageExpanded && !hasMultiSelection && !hasActiveSearch)) {
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
  }, [active, clearSearch, hasActiveSearch, isMessageExpanded, selection.selectedRefs.length])

  // The folder in sight, which the engine watches live; none outside the Posta, so every
  // account watches its Posta in arrivo while the user is in Oggi or the calendar.
  useEffect(() => {
    if (
      !active ||
      !selectedAccountId ||
      !selectedFolderPath ||
      isAcrossAccounts(selectedFolderPath)
    ) {
      void window.mailApi.setActiveMailboxContext(null)
      return
    }

    void window.mailApi.setActiveMailboxContext({
      accountId: selectedAccountId,
      folderPath: selectedFolderPath
    })
  }, [active, selectedAccountId, selectedFolderPath])

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

  /**
   * Shows a message in its own folder, selected — from a notification, or a
   * link the Segretario wrote.
   */
  const openMessage = useCallback(
    (ref: MessageRef): void => {
      pendingNotificationMessageRef.current = ref
      cancelInFlightWork()
      setViewError(null)
      setTotalMessagesInFolder(0)
      setHasMoreMessages(false)
      setSelection({ selectedRefs: [ref], cursorRef: ref, anchorRef: ref })
      setSelectedMessage(null)
      setIsMessageExpanded(false)
      setMessageFilter(DEFAULT_MESSAGE_LIST_FILTER)
      setSearch('')
      setSelectedAccountId(ref.accountId)
      setSelectedFolderPath(ref.folderPath)
      show()
    },
    [cancelInFlightWork, show]
  )

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
   * The message shown alone in the reading pane, once its body is on
   * screen — see the read-state rules at `followShownMessage`. `keepState`
   * is set when the user marks it read or unread by hand.
   */
  const shownMessageRef = useRef<{
    ref: MessageRef
    wasUnread: boolean
    keepState: boolean
  } | null>(null)

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
    ): Promise<MessagesActionResult | null> => {
      const targetRefs = uniqueMessageRefs(refs)

      if (targetRefs.length === 0) {
        return null
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
      // Those the server refused, and those it did but which stay where they were shown.
      const backKeys = new Set([...failedKeys, ...(result.kept ?? []).map(messageRefKey)])

      // Back in their places, earliest first, so each index still holds.
      snapshots
        .filter(({ ref, snapshot }) => snapshot && backKeys.has(messageRefKey(ref)))
        .sort(
          (left, right) => (left.snapshot?.removedIndex ?? 0) - (right.snapshot?.removedIndex ?? 0)
        )
        .forEach(({ snapshot }) => snapshot && rollbackRemovedMessage(snapshot))

      for (const { ref } of snapshots) {
        settleRemoval(ref, !backKeys.has(messageRefKey(ref)))
      }

      if (failedKeys.size > 0) {
        const message = result.error?.trim() || fallbackErrorMessage
        setViewError(
          failedKeys.size === 1
            ? message
            : `${message} (${failedKeys.size} messaggi restano dov'erano)`
        )
      }

      return result
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

  // The searches asked in words this session, by id: their lists' titles.
  const [askedSearches, setAskedSearches] = useState<ReadonlyMap<string, AskedMail>>(
    () => new Map()
  )
  const [askingSegretario, setAskingSegretario] = useState(false)
  // The search asked in words under way, by name: the user may stop it.
  const askingRequestRef = useRef<string | null>(null)
  // The searches kept as folders: in the sidebar, searched again each time they open.
  const [savedSearches, setSavedSearches] = useState<ReadonlyArray<SavedSearch>>([])

  useEffect(() => {
    if (!aiOn) {
      return
    }

    let current = true
    void window.segretarioApi
      .listSavedSearches()
      .then((searches) => current && setSavedSearches(searches))
      .catch(() => undefined)

    return () => {
      current = false
    }
  }, [aiOn])

  // Where the selected messages are likely to be saved outside the mail, and what the Segretario proposes.
  const [selectionFiling, setSelectionFiling] = useState<{
    selection: ReadonlyArray<MailMessageSummary>
    savedBefore: ExtensionSelectionContext['savedBefore']
    projectFolders: ExtensionSelectionContext['projectFolders']
    proposals: ExtensionSelectionContext['proposals']
  } | null>(null)

  useEffect(() => {
    if (selectedSummaries.length === 0 || !aiOn) {
      return
    }

    let current = true

    void window.segretarioApi
      .filingContext(
        selectedSummaries.map((summary) => ({
          accountId: summary.accountId,
          messageKey: summary.messageKey,
          threadId: summary.threadId,
          from: summary.from[0]?.address ?? null
        }))
      )
      .then((filing) => {
        if (current) {
          setSelectionFiling({ selection: selectedSummaries, ...filing })
        }
      })
      .catch(() => undefined)

    return () => {
      current = false
    }
  }, [selectedSummaries, aiOn])

  const extensionSelection = useMemo<ExtensionSelectionContext>(() => {
    const filing = aiOn && selectionFiling?.selection === selectedSummaries ? selectionFiling : null

    return {
      refs: selection.selectedRefs,
      summaries: selectedSummaries,
      multiSelectActive: selection.selectedRefs.length > 1,
      savedBefore: filing?.savedBefore ?? null,
      projectFolders: filing?.projectFolders ?? [],
      proposals: filing?.proposals ?? []
    }
  }, [aiOn, selectedSummaries, selection.selectedRefs, selectionFiling])

  const extensionHostHooks = useMemo<ExtensionHostHooks>(
    () => ({
      optimisticallyRemoveMessages: async (refs, action, fallbackErrorMessage) => {
        await runMessageRemovalAction(refs, action, fallbackErrorMessage)
      }
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

  /** "Segna come gestito": what the conversations of these messages ask of the user is done. */
  const markHandled = useCallback(
    async (summaries: ReadonlyArray<MailMessageSummary>): Promise<void> => {
      // One message per conversation: it is the conversation that is marked, counted once.
      const messages = [
        ...new Map(
          summaries.map(({ accountId, messageKey, threadId }) => [
            `${accountId}\u0000${threadId}`,
            { accountId, messageKey }
          ])
        ).values()
      ]
      let handled = 0

      try {
        for (let start = 0; start < messages.length; start += MARK_HANDLED_BATCH) {
          handled += await window.segretarioApi.markHandled(
            messages.slice(start, start + MARK_HANDLED_BATCH)
          )
        }

        toast(
          handled === 0
            ? 'Niente da segnare: in queste conversazioni non ti chiedono niente'
            : handled === 1
              ? 'Conversazione segnata come gestita'
              : `${handled.toLocaleString('it-IT')} conversazioni segnate come gestite`
        )
      } catch (error) {
        toast.error('Non segnate come gestite', {
          description: error instanceof Error ? error.message : undefined
        })
      }
    },
    []
  )

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
    if (!isAcrossAccounts(selectedFolderPath) || unifiedAccountIds.length < 2) {
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

  /** Opens a folder — of the account, or of "Tutti gli account" — showing all its messages. */
  const selectFolder = useCallback(
    (folderPath: string): void => {
      show()
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
    [cancelInFlightWork, resetMailboxView, selectedFolderPath, show]
  )

  /** A search asked in words — in the list's search, or by the Segretario — opened as its list. */
  const openAskedSearch = useCallback(
    (asked: AskedMail): void => {
      setAskedSearches((current) => new Map(current).set(asked.id, asked))
      setSearch('')
      selectFolder(segretarioSearchPath(asked.id))
    },
    [selectFolder]
  )

  const [goToFolderOpen, setGoToFolderOpen] = useState(false)

  /**
   * A project's menu in the sidebar: the user's word on it — its name,
   * other projects that are the same one, concluded, not a project at all —
   * which the Segretario keeps and learns from.
   */
  const openProjectContextMenu = useCallback(
    async (project: Project): Promise<void> => {
      const others = projects
        .filter((other) => other.id !== project.id && !other.hidden)
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
        .slice(0, 30)
      const chosen = await window.mailApi.showContextMenu([
        { id: 'open', label: 'Apri' },
        { type: 'separator' },
        { id: 'rename', label: 'Rinomina…' },
        ...(others.length > 0
          ? [
              {
                id: 'merge',
                label: 'Unisci a questo',
                submenu: others.map((other) => ({ id: `merge:${other.id}`, label: other.title }))
              }
            ]
          : []),
        { type: 'separator' },
        { id: 'close', label: project.closed ? 'Riapri' : 'Concluso: non è più in corso' },
        { id: 'hide', label: 'Nascondi: non è un progetto' }
      ])

      if (!chosen) {
        return
      }

      try {
        if (chosen === 'open') {
          selectFolder(segretarioProjectPath(project.id))
        } else if (chosen === 'rename') {
          const title = await prompt({
            title: 'Rinomina il progetto',
            description: 'Il Segretario userà questo nome, e non lo cambierà da solo.',
            label: 'Nome',
            initialValue: project.title,
            confirmLabel: 'Rinomina',
            validate: (value) => (value.trim() ? null : 'Dai un nome.')
          })

          if (title?.trim()) {
            await window.segretarioApi.updateProject(project.id, { title: title.trim() })
          }
        } else if (chosen.startsWith('merge:')) {
          const other = others.find((candidate) => `merge:${candidate.id}` === chosen)

          if (other) {
            await window.segretarioApi.mergeProjects(project.id, [other.id])
            toast(`«${other.title}» è ora parte di «${project.title}»`)
          }
        } else if (chosen === 'close') {
          await window.segretarioApi.updateProject(project.id, { closed: !project.closed })
        } else if (chosen === 'hide') {
          await window.segretarioApi.updateProject(project.id, { hidden: true })
          toast(`«${project.title}» non è più tra i progetti`, {
            action: {
              label: 'Annulla',
              onClick: () => void window.segretarioApi.updateProject(project.id, { hidden: false })
            }
          })
        }

        await refreshSegretarioViews()
      } catch (error) {
        toast.error('Il progetto non è cambiato', {
          description: error instanceof Error ? error.message : undefined
        })
      }
    },
    [projects, prompt, refreshSegretarioViews, selectFolder]
  )

  /** What can be done with a folder from its right click, native as every menu of the app. */
  const openFolderContextMenu = useCallback(
    async (target: FolderMenuTarget): Promise<void> => {
      if (target.kind === 'project') {
        await openProjectContextMenu(target.project)
        return
      }

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
    [
      accounts,
      folders,
      openProjectContextMenu,
      prompt,
      selectFolder,
      selectedAccountId,
      selectedFolderPath
    ]
  )

  const isModalSurfaceOpen =
    shellModalOpen || promptOpen || goToFolderOpen || extensionPrimaryDialogOpen

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

  const shortcutOverridesRef = useRef(uiPreferences.shortcutOverrides)

  useEffect(() => {
    shortcutOverridesRef.current = uiPreferences.shortcutOverrides
  }, [uiPreferences.shortcutOverrides])

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

      // The keys of the list — select all, the arrows, Invio, Elimina — are the
      // mail's: with another app in front they are left to it, and only the
      // chords above, the whole app's, answer.
      if (!active) {
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
  }, [active, deleteMessages, handleOpenRow, handleSelectAll, isModalSurfaceOpen, runAppCommandRef])

  const attachmentActions = useAttachmentActions(readingRef)

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

  // A reply or forward goes out from the account that received the message
  // — which, in Tutti gli account, is not necessarily the one in the sidebar — and
  // knows the message, for its attachments.
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
        subject: replySubject(message.subject),
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
        subject: forwardSubject(message.subject),
        quoteHtml: await buildForwardQuoteHtml(message),
        original: {
          ref: summaryToMessageRef(message),
          attachments: message.attachments
        }
      })
    },
    [continueDraft, isDraftMessage, messageDetailFor, openComposer, readingRef]
  )

  /** A project the user made, from the sidebar's search: it opens, empty, to put conversations in. */
  const createProject = useCallback(
    async (title: string): Promise<void> => {
      try {
        const created = await window.segretarioApi.createProject(title)
        await refreshSegretarioViews()
        selectFolder(segretarioProjectPath(created.id))
      } catch (error) {
        toast.error('Il progetto non è stato creato', {
          description: error instanceof Error ? error.message : undefined
        })
      }
    },
    [refreshSegretarioViews, selectFolder]
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

  const archiveSelection = useCallback(async (): Promise<void> => {
    // On Gmail archiving only takes a message out of the inbox: shown under a label, in the
    // sent mail or in Tutti i messaggi, it stays where it is, its labels kept.
    const labelled = folders.some((folder) => folder.specialUse?.toLowerCase() === '\\all')
    const stays = (ref: MessageRef): boolean => {
      if (!labelled || ref.accountId !== selectedAccountId) {
        return false
      }

      const folder = folders.find((candidate) => candidate.path === ref.folderPath)
      const role = folder ? folderRole(folder) : null
      return role !== '\\Inbox' && role !== '\\Trash' && role !== '\\Junk'
    }
    const staying = selection.selectedRefs.filter(stays)
    const leaving = selection.selectedRefs.filter((ref) => !stays(ref))
    const sayKept = (kept: number): void => {
      toast(kept === 1 ? 'Archiviato' : 'Archiviati', {
        description: 'Fuori dalla Posta in arrivo; qui restano, con le loro etichette.'
      })
    }

    if (staying.length > 0) {
      try {
        const result = await window.mailApi.archiveMessages(staying)

        if (result.failed.length > 0) {
          toast.error('Archiviazione email non riuscita.', { description: result.error })
        } else {
          sayKept(staying.length)
        }
      } catch (error) {
        toast.error('Archiviazione email non riuscita.', {
          description: error instanceof Error ? error.message : undefined
        })
      }
    }

    // Seen from "Tutti gli account", a Gmail message is known to stay only once it is archived:
    // its row comes back, said the same way.
    if (leaving.length > 0) {
      const result = await runMessageRemovalAction(
        leaving,
        (refs) => window.mailApi.archiveMessages(refs),
        'Archiviazione email non riuscita.'
      )

      if (result?.kept && result.kept.length > 0) {
        sayKept(result.kept.length)
      }
    }
  }, [folders, runMessageRemovalAction, selectedAccountId, selection.selectedRefs])

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
   * Runs a command of the mail's, from the menu bar or its chord, once the
   * shell has found nothing open over it (see `runAppCommand` in `App`). A
   * command with nothing to act on — a reply with no message open — does
   * nothing. Returns whether it applied.
   */
  const runCommand = (commandId: string): boolean => {
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
      case 'mark-handled':
        if (!hasSelection || !aiOn) {
          return false
        }

        void markHandled(selectedSummaries)
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
      ...(aiOn && summaries.some((message) => rowWork.get(rowWorkKey(message))?.owed)
        ? [{ id: 'mark-handled', label: 'Segna come gestito', chord: chordOf('mark-handled') }]
        : []),
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
      case 'mark-handled':
        await markHandled(summaries)
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

  /** An account picked in the sidebar: its folders, all of their messages shown. */
  const selectAccount = (accountId: string): void => {
    cancelInFlightWork()
    setSelectedAccountId(accountId)
    setMessageFilter(DEFAULT_MESSAGE_LIST_FILTER)
    resetMailboxView()
  }

  /** What is typed in the search, handed to the Segretario to search as it means (⌘↵). */
  const askSegretario = (question: string): void => {
    const requestId = crypto.randomUUID()
    askingRequestRef.current = requestId
    setAskingSegretario(true)
    void window.segretarioApi
      .askMail(question, requestId)
      .then(openAskedSearch)
      .catch((error: unknown) => {
        // Stopped by the user: nothing to say. Else the user waits for it: "Riprova" (§13ter.2).
        if (askingRequestRef.current === requestId) {
          toast.error('Il Segretario non ha cercato', {
            description: error instanceof Error ? error.message : undefined,
            action: { label: 'Riprova', onClick: () => askSegretario(question) }
          })
        }
      })
      .finally(() => {
        if (askingRequestRef.current === requestId) {
          askingRequestRef.current = null
        }

        setAskingSegretario(false)
      })
  }

  const stopAskingSegretario = (): void => {
    const requestId = askingRequestRef.current

    if (requestId) {
      askingRequestRef.current = null
      void window.segretarioApi.stopAsking(requestId)
    }
  }

  /** A search asked in words, kept as a folder in the sidebar. */
  const saveSearch = async (searchId: string): Promise<void> => {
    try {
      setSavedSearches(await window.segretarioApi.saveSearch(searchId))
    } catch (error) {
      toast.error('Cartella non creata', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  /** A search no longer kept as a folder. */
  const removeSavedSearch = async (searchId: string): Promise<void> => {
    setSavedSearches(await window.segretarioApi.removeSavedSearch(searchId))
    // A folder no longer kept has nothing to show: back to the mail.
    runAppCommandRef.current('go-inbox')
  }

  // What the view is called where it is named: the folder, or a folder of
  // "Tutti gli account".
  const currentSegretarioView = segretarioView(selectedFolderPath)
  const currentProjectId = segretarioProject(selectedFolderPath)
  const currentSearchId = segretarioSearch(selectedFolderPath)
  const currentSaved = currentSearchId
    ? savedSearches.find((search) => search.id === currentSearchId)
    : undefined
  const currentAsked = currentSearchId
    ? (askedSearches.get(currentSearchId) ?? currentSaved)
    : undefined
  const currentProject = currentProjectId
    ? projects.find((project) => project.id === currentProjectId)
    : undefined
  const currentViewLabel = currentUnifiedRole
    ? `${folderRoleLabel(currentUnifiedRole)} · ${ALL_ACCOUNTS_LABEL}`
    : currentSegretarioView
      ? segretarioViewLabel(currentSegretarioView)
      : currentProjectId
        ? (currentProject?.title ?? 'Progetto')
        : currentSearchId
          ? (currentAsked?.summary ?? 'Ricerca del Segretario')
          : currentFolder
            ? folderDisplayName(currentFolder)
            : 'Conversazioni'
  // What the user is looking at in the mail goes along with what they ask the Segretario.
  const viewerWork = messageForViewer ? (rowWork.get(rowWorkKey(messageForViewer)) ?? null) : null
  const sight: MailSight = {
    messages: selection.selectedRefs.slice(0, SEGRETARIO_CONTEXT_LIMIT),
    selectionCount: selection.selectedRefs.length,
    accountId: selectedAccountId,
    viewLabel: currentViewLabel,
    label:
      selection.selectedRefs.length > 1
        ? selection.selectedRefs.length > SEGRETARIO_CONTEXT_LIMIT
          ? `I primi ${SEGRETARIO_CONTEXT_LIMIT} dei ${selection.selectedRefs.length.toLocaleString('it-IT')} messaggi selezionati`
          : `${selection.selectedRefs.length} messaggi selezionati`
        : messageForViewer
          ? `«${messageForViewer.subject || 'Senza oggetto'}»${messageForViewer.from[0] ? ` — ${messageForViewer.from[0].name || messageForViewer.from[0].address}` : ''}`
          : currentViewLabel,
    work: viewerWork,
    messageOpen: Boolean(messageForViewer),
    project: currentProject?.title ?? null
  }

  return {
    // The shell's.
    selectedAccountId,
    setSelectedAccountId,
    accountConnections,
    syncSummary,
    removingAccountId,
    clearingAccountDataId,
    clearingDatabaseData,
    removeAccount,
    clearAccountData,
    clearAllDataKeepAccounts,
    handleUnifiedPreferencesChanged,
    openMessage,
    selectFolder,
    openAskedSearch,
    isMessageExpanded,
    isModalSurfaceOpen,
    runCommand,
    sight,

    // What the panes draw from of the shell's.
    accounts,
    aiOn,
    uiPreferences,
    updateUiPreferences,
    changeReaderZoom,
    openComposer,

    // The sidebar.
    selectAccount,
    loadingFolders,
    folders,
    unifiedSummaries,
    selectedFolderPath,
    segretarioViewCounts,
    projects,
    createProject,
    savedSearches,
    messageDrop,
    openFolderContextMenu,

    // The list.
    showMessagePanelLoader,
    messagePanelLoaderText,
    currentViewLabel,
    currentUnifiedRole,
    currentProjectId,
    currentSearchId,
    currentSaved,
    currentAsked,
    conversationProjectTags,
    askingSegretario,
    askSegretario,
    stopAskingSegretario,
    saveSearch,
    removeSavedSearch,
    search,
    setSearch,
    clearSearch,
    searchInputRef,
    activeSearchQuery,
    serverSearchStatus,
    messageFilter,
    setMessageFilter,
    messages,
    rowWork,
    messageSections,
    totalMessagesInFolder,
    listCounts,
    loadingMessages,
    selection,
    highlightTerms,
    handleMessageListSortChange,
    handleMessageGroupingChange,
    primaryAddressMode,
    accountLabels,
    hasMoreMessages,
    loadingMoreMessages,
    loadMoreMessagesHandler,
    revealCursorToken,
    hydratePreviewsInView,
    handleActivateRow,
    handleOpenRow,
    openMessageContextMenu,
    handleRowDragStart,
    setDraggedRefs,
    handleToggleRowFlag,
    handleSelectSection,
    handleSelectAll,
    clearSelection,

    // The reading pane.
    messageForViewer,
    readingRef,
    readerBodyStatus,
    loadMessageDetail,
    setIsMessageExpanded,
    selectingWholeView,
    selectWholeView,
    moveFolders,
    moveExcludedPath,
    recentMovePaths,
    selectionAccountIds,
    explainMixedAccountMove,
    moveMenuOpen,
    changeMoveMenuOpen,
    toggleSeenLabel,
    selectionFlagged,
    archiveSelection,
    moveSelectionTo,
    createFolderAndMoveSelection,
    setSelectionSeen,
    setSelectionFlagged,
    deleteMessages,
    openReplyComposer,
    openForwardComposer,
    isDraftMessage,
    continueDraft,
    attachmentActions,
    addressActions,
    extensionSelection,
    extensionHostHooks,

    // The notice and the dialogs.
    viewError,
    setViewError,
    promptDialog,
    goToFolderOpen,
    setGoToFolderOpen,
    extensionPrimaryDialogOpen,
    setExtensionPrimaryDialogOpen
  }
}
