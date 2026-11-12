import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  AlertTriangle,
  BookUser,
  Briefcase,
  CalendarDays,
  Files,
  LoaderCircle,
  Mail,
  Minus,
  Square,
  Sun,
  X,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'

import { newOnboarding, OnboardingWizard } from '@renderer/features/onboarding/onboarding-wizard'
import {
  MailComposer,
  draftToInitialData,
  type ComposerInitialData,
  type ComposerOutcome,
  type ComposerSession,
  type ComposerSummary,
  type MailComposerHandle
} from '@renderer/features/mail/mail-composer'
import { ComposerLayer, ComposerSlotProvider } from '@renderer/features/mail/composer-layer'
import { AppRail } from '@renderer/features/workspace/app-rail'
import { WelcomeScreen } from '@renderer/features/workspace/welcome-screen'
import {
  SegretarioPanel,
  type SegretarioContextChip
} from '@renderer/features/segretario/segretario-panel'
import { AiNotice } from '@renderer/features/segretario/ai-notice'
import { SegretarioLinkProvider } from '@renderer/features/segretario/segretario-text'
import { useSegretario } from '@renderer/features/segretario/use-segretario'
import { MailDialogs, MailNotice } from '@renderer/apps/mail/mail-app'
import { MailMessageList } from '@renderer/apps/mail/mail-list'
import { MailReader } from '@renderer/apps/mail/mail-reader'
import { MailSidebar } from '@renderer/apps/mail/mail-sidebar'
import { buildForwardQuoteHtml, buildReplyQuoteHtml } from '@renderer/apps/mail/reply-quote'
import { useMailApp } from '@renderer/apps/mail/use-mail-app'
import { TodayPage } from '@renderer/apps/today/today-page'
import {
  CalendarApp,
  type CalendarFocus,
  type CalendarSight
} from '@renderer/apps/calendar/calendar-app'
import type { CalendarMailRequest } from '@renderer/apps/calendar/use-calendar-actions'
import { dayKey, dayOfKey, eventSpan } from '@renderer/features/calendar/calendar-dates'
import { AppPlaceholder } from '@renderer/apps/app-placeholder'
import { WORKSPACE_APPS, type AppId } from '@shared/workspace'
import { useCalendarConnections } from '@renderer/features/calendar/use-calendar'
import { segretarioSuggestions } from '@renderer/features/segretario/suggestions'
import { plainTextToComposerHtml, writtenText } from '@renderer/features/mail/composer-body'
import { parseRecipients } from '@shared/email-address'
import type {
  ApprovalRequest,
  Commitment,
  OnboardingCase,
  OnboardingState,
  ComposeSpec,
  HandleLink,
  SendOutcome
} from '@shared/segretario'
import { WorkspaceLayout } from '@renderer/features/workspace/workspace-layout'
import { useAssistantInset } from '@renderer/features/workspace/assistant-width'
import { SettingsDialog, type SettingsSectionId } from '@renderer/features/settings/settings-dialog'
import { Button } from '@renderer/components/ui/button'
import type { RailItem } from '@renderer/features/workspace/app-rail'
import { ConfirmDialog, useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { connectionsStatus } from '@renderer/features/connections/connection-health'
import { ConnectionRefusedDialog } from '@renderer/features/connections/connection-refused'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useTaskbarBadge } from '@renderer/lib/taskbar-badge'
import { segretarioProjectPath } from '@shared/folders'
import { CommandShortcutsProvider, isOverlaySurfaceOpen } from '@renderer/lib/command-shortcuts'
import { uiLog } from '@renderer/lib/diagnostics'
import { languageNow, messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { buildOutgoingMailHtml } from '@renderer/lib/outgoing-mail-html'
import { messageRefKey, summaryToMessageRef } from '@renderer/lib/message-selection'
import { cn } from '@renderer/lib/utils'
import { clampReaderZoom, DEFAULT_UI_PREFERENCES } from '@shared/models'
import { findCommand, type HostCommandId } from '@shared/commands'
import { PLACES } from '@shared/places'
import { replyRecipients, replyReferences } from '@shared/reply'
import { forwardSubject, replySubject } from '@shared/subject'
import type {
  AppCapabilities,
  ComposeMailInput,
  ConnectionRefusedNotice,
  DraftStatus,
  MailAccount,
  MailAddress,
  MessageRef,
  UiPreferences,
  WindowControlsState
} from '@shared/models'

import { MESSAGES } from './App.messages'

/** How long a notice offering "Undo" stays, as Gmail leaves its own. */
const UNDO_TOAST_DURATION_MS = 10_000
const READER_ZOOM_SAVE_DELAY_MS = 400

function useMailBootstrap(): {
  accounts: MailAccount[]
  capabilities: AppCapabilities
  loading: boolean
  error: string | null
  setAccounts: React.Dispatch<React.SetStateAction<MailAccount[]>>
  reload: () => Promise<void>
} {
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [capabilities, setCapabilities] = useState<AppCapabilities>({
    googleOAuthReady: false,
    microsoftOAuthReady: false
  })
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
        caughtError instanceof Error ? caughtError.message : messagesNow(MESSAGES).bootstrapFailed
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

/**
 * Every view preference the user keeps — the layout, the list's order and
 * grouping, the reader's zoom, the chords — read once and written as it
 * changes. The settings change them, and the mail follows them.
 */
function useUiPreferences(): {
  uiPreferences: UiPreferences
  uiPreferencesRef: RefObject<UiPreferences>
  updateUiPreferences: (patch: Partial<UiPreferences>) => void
  changeReaderZoom: (next: number) => void
} {
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES)

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

  return { uiPreferences, uiPreferencesRef, updateUiPreferences, changeReaderZoom }
}

/** A command on what Mail shows — its selected messages, its reader — rather than on the app. */
function actsOnMailShown(commandId: string): boolean {
  const command = findCommand(commandId)
  return (
    command?.fromExtension === true ||
    (command?.group === 'messages' && commandId !== 'compose') ||
    commandId.startsWith('reader-zoom')
  )
}

const APP_ICONS: Readonly<Record<AppId, LucideIcon>> = {
  oggi: Sun,
  mail: Mail,
  calendar: CalendarDays,
  files: Files,
  contacts: BookUser,
  projects: Briefcase
}

/** Each app by the name of its place, in the interface's language. */
const APP_PLACES: Readonly<Record<AppId, keyof typeof PLACES>> = {
  oggi: 'today',
  mail: 'mail',
  calendar: 'calendar',
  files: 'files',
  contacts: 'contacts',
  projects: 'projects'
}

/**
 * The apps of the rail, in their groups (see `WORKSPACE_APPS`), named where
 * they are drawn. Oggi is the Segretario's, there only with the AI on.
 */
const RAIL_ITEMS: ReadonlyArray<Omit<RailItem, 'label'> & { id: AppId }> = WORKSPACE_APPS.map(
  (app) => ({
    id: app.id,
    icon: APP_ICONS[app.id],
    group: app.group,
    soon: !app.available
  })
)

function AppFrame({
  children,
  windowControlsState,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow,
  rightInset = 0,
  framed = false,
  cover,
  onNoticeOpenChange,
  overlay
}: {
  children: ReactNode
  windowControlsState: WindowControlsState
  onMinimizeWindow: () => void
  onToggleMaximizeWindow: () => void
  onCloseWindow: () => void
  /** What takes the window's right edge — the Segretario's column — in px: the notices keep clear of it. */
  rightInset?: number
  /** The workspace: its panes' headers are the title bar the window is dragged by. */
  framed?: boolean
  /**
   * A screen laid over the workspace — the welcome, the guided setup —: the
   * workspace keeps working under it, out of reach of the pointer, the focus
   * and the drag. With no workspace, it is the whole window.
   */
  cover?: ReactNode
  /** A notice about the AI shown, or gone (`AiNotice`). */
  onNoticeOpenChange: (open: boolean) => void
  /** What asks the user wherever the window stands: a refusal, a confirmation. */
  overlay: ReactNode
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  // Where the window's own chrome sits, for the panes to keep clear of it:
  // macOS draws its three lights in the top left corner of the rail and the
  // sidebar; Windows gets the app's own buttons in the top right.
  const isMac = windowControlsState.dragTopRegionEnabled && !windowControlsState.enabled
  const chromeInsets = {
    '--titlebar-band': isMac ? '52px' : '12px',
    '--titlebar-lights': isMac ? '84px' : '0px',
    '--titlebar-controls': windowControlsState.enabled ? '120px' : '0px'
  } as CSSProperties

  return (
    <TooltipProvider delayDuration={140} skipDelayDuration={300}>
      <div className="h-screen overflow-hidden" style={chromeInsets}>
        <div className="h-full min-h-0" inert={Boolean(cover)}>
          {/* Screens without panes are dragged by their top edge. */}
          {!framed && windowControlsState.dragTopRegionEnabled && (
            <div className="window-drag-edge" aria-hidden />
          )}
          {children}
        </div>
        {cover && (
          <div className="fixed inset-0 z-40">
            {/* After the workspace, so the panes' title bars beneath are no handle through it. A
                leaf: the region is inherited, and the screen's own content would carry it over
                its drag strip. */}
            <div className="window-no-drag absolute inset-0 -z-10" aria-hidden />
            {cover}
            {/* The cover is dragged by its top edge, as the workspace by its panes' title bars:
                last, so nothing of the screen takes it back. */}
            {windowControlsState.dragTopRegionEnabled && (
              <div className="window-drag-edge" aria-hidden />
            )}
          </div>
        )}
        {/* Windows' own buttons come last: no drag region laid after them takes their clicks. */}
        {windowControlsState.enabled && (
          <div className="window-no-drag fixed top-0 right-0 z-[10000] flex">
            <button
              type="button"
              className="text-muted-foreground hover:bg-hover hover:text-foreground inline-flex h-8 w-10 items-center justify-center transition-colors"
              onClick={onMinimizeWindow}
              aria-label={m.minimizeWindow}
              title={m.minimize}
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:bg-hover hover:text-foreground inline-flex h-8 w-10 items-center justify-center transition-colors"
              onClick={onToggleMaximizeWindow}
              aria-label={windowControlsState.maximized ? m.restoreWindow : m.maximizeWindow}
              title={windowControlsState.maximized ? m.restore : m.maximize}
            >
              <Square className="size-3" />
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground inline-flex h-8 w-10 items-center justify-center transition-colors"
              onClick={onCloseWindow}
              aria-label={m.closeWindow}
              title={m.close}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      <AiNotice onOpenChange={onNoticeOpenChange} />
      {overlay}
      <Toaster position="bottom-right" offset={{ bottom: 16, right: 16 + rightInset }} />
    </TooltipProvider>
  )
}

function App(): React.JSX.Element {
  // The whole window redraws in the interface's language when it changes (§13.5).
  const { language } = useLanguage()
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  useTaskbarBadge()
  const {
    accounts,
    capabilities,
    loading: bootstrapLoading,
    error: bootstrapError,
    setAccounts,
    reload: reloadBootstrap
  } = useMailBootstrap()

  const { uiPreferences, uiPreferencesRef, updateUiPreferences, changeReaderZoom } =
    useUiPreferences()

  /**
   * The messages being written, each a tab of the reading pane (vision
   * §6.6): the one in front, or none — the message being read.
   */
  const [composeSessions, setComposeSessions] = useState<ComposerSession[]>([])
  const [activeComposeId, setActiveComposeId] = useState<string | null>(null)
  // The message brought in front by the Segretario, which does not take the keyboard.
  const [quietComposeId, setQuietComposeId] = useState<string | null>(null)
  const [composeSummaries, setComposeSummaries] = useState<Record<string, ComposerSummary>>({})
  const composerHandlesRef = useRef(new Map<string, MailComposerHandle>())
  // The reading pane's place for the message in front, where the composers' layer lies.
  const [composerSlot, setComposerSlot] = useState<HTMLElement | null>(null)
  // Asked to the Segretario from a message being written: its panel takes the words.
  const [segretarioFocusRequest, setSegretarioFocusRequest] = useState(0)
  /** Sends the Segretario asked for, waiting to hear how they went, by draft. */
  const segretarioSendWaitersRef = useRef(new Map<string, (outcome: SendOutcome) => void>())
  const [segretarioOpen, setSegretarioOpen] = useState(false)
  // Whether any calendar is connected: what the Segretario suggests knows it.
  const { connections: calendarConnections } = useCalendarConnections()
  const calendarConnected = Boolean(calendarConnections?.length)
  // A connection of any family is enough to work: a mailbox, a calendar.
  const hasConnections = accounts.length > 0 || calendarConnected
  // The source the workspace opens on without Oggi: the mail when there is a mailbox, else the
  // calendar.
  const firstSourceApp: AppId = accounts.length > 0 || !calendarConnected ? 'mail' : 'calendar'
  // The app in front. The workspace is born on Oggi — with the AI off, the first source stands in
  // for it —, so the launch's "Entra" finds the day; from then on it stays where the user leaves
  // it. The calendar opens where it is asked to.
  const [activeApp, setActiveApp] = useState<AppId>('oggi')
  const [calendarFocus, setCalendarFocus] = useState<{ focus: CalendarFocus; at: number } | null>(
    null
  )
  const [calendarSight, setCalendarSight] = useState<CalendarSight | null>(null)
  // The calendar's search, for "Cerca" with the calendar in front.
  const calendarSearchRef = useRef<HTMLInputElement>(null)
  const segretario = useSegretario(segretarioOpen)
  const assistantInset = useAssistantInset(segretarioOpen)
  // The AI on: a key, and the one switch up. Off, nothing of the Segretario shows.
  const aiOn = Boolean(
    segretario.status && segretario.status.keyState !== 'missing' && segretario.preferences?.enabled
  )
  // The panel is there with the AI on — and, before a key is given, to ask for one.
  // With the AI off there is no trace of the Segretario (vision §12.1): it is turned on from
  // Settings › Segretario, which leads to the guided setup.
  const segretarioOffered = aiOn
  // Oggi is the Segretario's: with the AI off the rail goes without it, and the first source
  // takes its place.
  const railItems = (aiOn ? RAIL_ITEMS : RAIL_ITEMS.filter((item) => item.id !== 'oggi')).map(
    (item) => ({ ...item, label: places[APP_PLACES[item.id]] })
  )
  const shownApp: AppId = activeApp === 'oggi' && !aiOn ? firstSourceApp : activeApp

  /** The calendar, opened on a day — and on an event of it, its panel open. */
  const openCalendar = useCallback((focus: CalendarFocus): void => {
    setCalendarFocus({ focus, at: Date.now() })
    setActiveApp('calendar')
  }, [])

  /** The calendar on an event the Segretario points to, as the calendar has it now. */
  const openCalendarEvent = useCallback(
    async (eventKey: string): Promise<void> => {
      const event = await window.calendarApi.event(eventKey)

      if (!event) {
        toast.error(messagesNow(MESSAGES).eventGone)
        openCalendar({ day: new Date() })
        return
      }

      openCalendar({ day: new Date(eventSpan(event).start), eventKey })
    },
    [openCalendar]
  )
  const startSegretario = segretario.start

  // Switched off, the panel closes: nothing of the Segretario stays on screen.
  useEffect(() => {
    if (!segretarioOffered) {
      // Closed, not hidden: it stays closed when the AI comes back on.
      setSegretarioOpen(false)
    }
  }, [segretarioOffered])

  // Sends that failed, oldest first, each offered back in turn: taken up again, it opens in a
  // tab of its own, beside the messages being written.
  const [failedSends, setFailedSends] = useState<
    ReadonlyArray<{ id: number; draft: ComposerInitialData; message: string }>
  >([])
  const failedSendIdRef = useRef(0)
  const { confirm, dialog: confirmDialog, open: confirmOpen } = useConfirmDialog()
  // The guided setup under way, as the main process keeps it; undefined until read.
  const [onboarding, setOnboarding] = useState<OnboardingState | null | undefined>(undefined)

  // Whether the setup is in front, for what asks to be seen to wait for it (`whenSetupAllows`).
  const setupOpenRef = useRef(false)
  // What asked to be seen while the setup was in front — the last of it —, shown when it closes.
  const afterSetupRef = useRef<(() => void) | null>(null)

  // A setup a quit interrupted takes the user back to its step.
  useEffect(() => {
    let current = true
    void window.segretarioApi
      .getOnboarding()
      .then((stored) => {
        if (current) {
          setupOpenRef.current = stored !== null
          setOnboarding(stored)
        }
      })
      .catch(() => current && setOnboarding(null))

    return () => {
      current = false
    }
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** The mailbox whose calendar the setup was opened to add (Settings' «Collega»), until asked for. */
  const [calendarToConnect, setCalendarToConnect] = useState<string | null>(null)
  // A notice about the AI waits for an answer: the app's keys rest meanwhile.
  const [noticeOpen, setNoticeOpen] = useState(false)
  // A connection turned down for good waits for an answer (`ConnectionRefusedDialog`).
  const [refusedOpen, setRefusedOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null)
  // The welcome screen, in front: at launch, or asked again from the rail's mark — then it fades in
  // over the workspace.
  const [welcome, setWelcome] = useState<'launch' | 'rail' | null>('launch')
  // The workspace: there with a connection, once the first setup — the one that builds it — has
  // been entered; any later setup lies over it (vision §12.2).
  const workspaceExists = hasConnections && onboarding?.case !== 'primo-avvio'
  // The welcome or the setup lies over the workspace, which keeps working under it (vision §13.1);
  // with no workspace, they are all there is.
  const workspaceCovered = welcome !== null || Boolean(onboarding) || !workspaceExists

  // The way through the app (vision §14.4): the app in front, the welcome over it, the
  // Segretario's panel — where the user goes, never what is in it.
  useEffect(() => {
    if (!workspaceCovered) {
      uiLog.info('app.open', { app: shownApp })
    }
  }, [shownApp, workspaceCovered])
  useEffect(() => {
    if (welcome) {
      uiLog.info('welcome.show', { from: welcome })
    }
  }, [welcome])
  const panelSeenRef = useRef(segretarioOpen)
  useEffect(() => {
    if (panelSeenRef.current !== segretarioOpen) {
      panelSeenRef.current = segretarioOpen
      uiLog.info(segretarioOpen ? 'segretario.panel.open' : 'segretario.panel.close')
    }
  }, [segretarioOpen])

  /**
   * Something to be seen — a message from a notification, what the Segretario
   * shows, a message to write —: now, past the welcome screen; with the setup
   * in front, once it closes, as it is left only from itself (vision §12.2).
   */
  const whenSetupAllows = useCallback((show: () => void): void => {
    if (setupOpenRef.current) {
      afterSetupRef.current = show
      return
    }

    show()
  }, [])

  /**
   * A message to write comes in front, in the reading pane of the Posta.
   * `quiet`: brought there by the Segretario, it leaves the keyboard where
   * the user is — writing to the Segretario, most likely.
   */
  const showComposer = useCallback(
    (id: string, options: { quiet?: boolean } = {}): void =>
      whenSetupAllows(() => {
        setActiveComposeId(id)
        setQuietComposeId(options.quiet ? id : null)
        setActiveApp('mail')
        setWelcome(null)
      }),
    [whenSetupAllows]
  )
  const [windowControlsState, setWindowControlsState] = useState<WindowControlsState>({
    enabled: false,
    maximized: false,
    dragTopRegionEnabled: false
  })

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

  // The failed send offered back right now, once the setup is over.
  const failedSend = onboarding ? null : (failedSends[0] ?? null)

  // What the shell has open in front: the mail's keys and commands rest under it too.
  const shellModalOpen =
    workspaceCovered ||
    failedSend !== null ||
    confirmOpen ||
    noticeOpen ||
    refusedOpen ||
    settingsOpen

  /**
   * Brings a message to write in front, in a tab of the reading pane — a new
   * one, or a draft: one already being written comes forward as it was left.
   * What was in front stays in its own tab.
   */
  const openComposer = useCallback(
    (data: ComposerInitialData, draft?: { status?: DraftStatus; quiet?: boolean }): void => {
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
      showComposer(id, { quiet: draft?.quiet })
      uiLog.info('composer.open', { kind: data.kind, draft: data.draftId !== undefined })

      // A draft whose message waits in the outbox is the user's again, opened to change.
      if (data.draftId) {
        window.mailApi
          .takeBackOutgoing(data.draftId)
          .then(
            (taken) =>
              taken &&
              toast.info(messagesNow(MESSAGES).takenBack, {
                description: messagesNow(MESSAGES).takenBackText
              })
          )
          .catch((error: unknown) =>
            toast.error(messagesNow(MESSAGES).notTakenBack, {
              description: error instanceof Error ? error.message : undefined
            })
          )
      }
    },
    [showComposer]
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

      const words = messagesNow(MESSAGES)

      if (outcome.kind === 'saved') {
        const { content } = outcome
        toast.success(words.draftSaved, {
          description: content.subject.trim() || words.noSubject,
          action: {
            label: words.open,
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
        toast.error(messagesNow(MESSAGES).draftNotDeleted, {
          description: error instanceof Error ? error.message : undefined
        })
      )
      toast(words.draftDeleted, {
        description: content.subject.trim() || words.noSubject,
        duration: UNDO_TOAST_DURATION_MS,
        action: {
          label: words.undo,
          onClick: () => {
            // Written again as it was, and back in front.
            window.mailApi
              .saveDraft(content)
              .then((status) => openComposer(draftToInitialData(content), { status }))
              .catch((error: unknown) =>
                toast.error(messagesNow(MESSAGES).draftNotRestored, {
                  description: error instanceof Error ? error.message : undefined
                })
              )
          }
        }
      })
    },
    [openComposer, removeComposeSession]
  )

  // The drafts left open — or not yet in Bozze — when the app last closed come back to their tabs.
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

        // Moved or thrown away from Bozze: its composer goes too, with nothing left to save.
        if (status.state === 'gone') {
          reported.delete(status.id)
          removeComposeSession(status.id)
          return
        }

        if (status.state !== 'error') {
          reported.delete(status.id)
          return
        }

        if (composeSessionIdsRef.current.has(status.id) || reported.has(status.id)) {
          return
        }

        reported.add(status.id)
        const words = messagesNow(MESSAGES)
        toast.warning(words.draftNotInDrafts, {
          description: `${words.draftSafeHere} ${status.message ?? ''}`.trim()
        })
      }),
    [removeComposeSession]
  )

  // Set once the handlers below exist; the menu bar and the keyboard both
  // reach the commands through it.
  const runAppCommandRef = useRef<(commandId: string) => boolean>(() => false)

  useEffect(
    () =>
      window.mailApi.onAppMenuCommand((command) => {
        if (runAppCommandRef.current(command)) {
          uiLog.info('command', { id: command, via: 'menu' })
        }
      }),
    []
  )

  // Every address the user writes from: a reply to all leaves them out, and
  // a reply to their own message goes to the people it went to.
  const ownAddresses = useMemo(
    () => new Set(accounts.map((account) => account.email.trim().toLowerCase())),
    [accounts]
  )

  /** A draft opened by its id: the composer holding it comes forward, or it is taken up again. */
  const openDraftById = useCallback(
    async (draftId: string): Promise<void> => {
      if (composeSessions.some((session) => session.id === draftId)) {
        showComposer(draftId)
        return
      }

      const stored = await window.mailApi.getStoredDraft(draftId)

      if (stored) {
        openComposer(draftToInitialData(stored.content), { status: stored.status })
      } else {
        toast.error(messagesNow(MESSAGES).draftUnavailable, {
          description: messagesNow(MESSAGES).draftSentOrDiscarded
        })
      }
    },
    [composeSessions, openComposer, showComposer]
  )

  /**
   * What the Segretario asks to write, as the composer opens it — exactly
   * as the user's own reply, forward or new message: recipients, quote,
   * thread, the original's files. Its text becomes the written lines.
   */
  const composerDataFor = useCallback(
    async (spec: ComposeSpec): Promise<ComposerInitialData> => {
      const writtenHtml = plainTextToComposerHtml(spec.text)
      const addresses = (list: string[] | undefined): MailAddress[] | undefined =>
        list && list.length > 0 ? parseRecipients(list.join(', ')) : undefined
      const files =
        spec.attachments && spec.attachments.length > 0
          ? await window.mailApi.describeFiles(spec.attachments.map((file) => file.path))
          : []
      const added = files.map((file) => ({ name: file.name, size: file.size, path: file.path }))

      if (spec.kind === 'new') {
        if (!spec.accountId) {
          throw new Error('Manca l’account da cui scrivere.')
        }

        return {
          kind: 'new',
          accountId: spec.accountId,
          to: addresses(spec.to) ?? [],
          cc: addresses(spec.cc),
          bcc: addresses(spec.bcc),
          subject: spec.subject ?? '',
          writtenHtml,
          attachments: added.length > 0 ? added : undefined
        }
      }

      if (!spec.source) {
        throw new Error('Manca il messaggio a cui rispondere.')
      }

      const message = await window.mailApi.getMessage(spec.source)
      const original = { ref: summaryToMessageRef(message), attachments: message.attachments }

      if (spec.kind === 'forward') {
        return {
          kind: 'forward',
          accountId: message.accountId,
          sourceAccountId: message.accountId,
          to: addresses(spec.to),
          cc: addresses(spec.cc),
          bcc: addresses(spec.bcc),
          subject: forwardSubject(message.subject, languageNow().language),
          quoteHtml: await buildForwardQuoteHtml(message),
          original,
          attachments: [
            ...message.attachments.map((attachment) => ({
              name: attachment.fileName,
              size: attachment.size,
              originalId: attachment.id
            })),
            ...added
          ],
          writtenHtml
        }
      }

      const recipients = replyRecipients(
        message,
        ownAddresses,
        spec.kind === 'replyAll' ? 'all' : 'sender'
      )

      return {
        kind: 'reply',
        accountId: message.accountId,
        sourceAccountId: message.accountId,
        to: addresses(spec.to) ?? recipients.to,
        cc: addresses(spec.cc) ?? recipients.cc,
        bcc: addresses(spec.bcc),
        subject: replySubject(message.subject, languageNow().language),
        quoteHtml: await buildReplyQuoteHtml(message),
        inReplyTo: message.messageId,
        references: replyReferences(message),
        original,
        attachments: added.length > 0 ? added : undefined,
        writtenHtml
      }
    },
    [ownAddresses]
  )

  // The Segretario writes a draft. In one open in a tab — the message the user is writing — it
  // writes in place, as a step ⌘Z takes back. Otherwise the draft opens in a tab of its own,
  // kept and filed in Bozze like any draft, and the Segretario hears its id once the first save
  // has landed. What goes wrong is told to the Segretario, as its tool's error: in Italian, the
  // language it works in (vision §13.5).
  useEffect(
    () =>
      window.segretarioApi.onComposeRequest(({ requestId, spec }) => {
        void (async () => {
          try {
            const { draftId } = spec

            if (draftId) {
              let handle = composerHandlesRef.current.get(draftId)

              if (!handle) {
                if (spec.selection) {
                  throw new Error('Il messaggio con il passaggio selezionato non è più aperto.')
                }

                // A draft in Bozze not open: taken up in a tab, with what the user put in it — and,
                // waiting in the outbox, back in their hands, as any draft opened again.
                const stored = await window.mailApi.getStoredDraft(draftId)

                if (!stored) {
                  throw new Error('La bozza non c’è più: è stata inviata o scartata.')
                }

                openComposer(draftToInitialData(stored.content), {
                  status: stored.status,
                  quiet: true
                })

                for (let waited = 0; !handle && waited < 5_000; waited += 50) {
                  await new Promise((resolve) => window.setTimeout(resolve, 50))
                  handle = composerHandlesRef.current.get(draftId)
                }
              }

              if (!handle) {
                throw new Error('La bozza non si è aperta.')
              }

              showComposer(draftId, { quiet: true })
              const problem = await handle.write(spec)
              await window.segretarioApi.completeCompose(
                requestId,
                problem ? { error: problem } : { draftId }
              )
              return
            }

            const data = await composerDataFor(spec)
            const id = crypto.randomUUID()
            const saved = new Promise<void>((resolve, reject) => {
              const timer = window.setTimeout(() => {
                off()
                reject(new Error('La bozza non è stata salvata in tempo.'))
              }, 15_000)
              const off = window.mailApi.onDraftStatusChanged((status) => {
                if (status.id === id) {
                  window.clearTimeout(timer)
                  off()
                  resolve()
                }
              })
            })

            setComposeSessions((current) => [
              ...current,
              { id, initialData: { ...data, draftId: id }, existing: false }
            ])
            // Asked for in the panel, it comes in front: the user is there to read it — the
            // keyboard stays with them, in the panel.
            showComposer(id, { quiet: true })
            uiLog.info('composer.open', { kind: data.kind, by: 'segretario' })
            await saved
            await window.segretarioApi.completeCompose(requestId, { draftId: id })
          } catch (error) {
            await window.segretarioApi.completeCompose(requestId, {
              error: error instanceof Error ? error.message : 'La bozza non si è aperta.'
            })
          }
        })()
      }),
    [composerDataFor, openComposer, removeComposeSession, showComposer]
  )

  /**
   * A reply the Segretario prepared ahead, taken up: it opens in front as a
   * reply to its message, with the prepared lines written in, and from then
   * on it is a draft like the user's own — and learnt from like one.
   */
  const takeUpReply = useCallback(
    async (accountId: string, messageKey: string, text: string): Promise<void> => {
      try {
        const source = await window.segretarioApi.replySource(accountId, messageKey)

        if (!source) {
          toast.error(messagesNow(MESSAGES).messageGone, {
            description: messagesNow(MESSAGES).messageGoneText
          })
          return
        }

        const data = await composerDataFor({ kind: 'reply', source, text })
        const id = crypto.randomUUID()

        setComposeSessions((current) => [
          ...current,
          { id, initialData: { ...data, draftId: id }, existing: false }
        ])
        showComposer(id)
        uiLog.info('composer.open', { kind: 'reply', prepared: true })
        await window.segretarioApi.takeUpReply(accountId, messageKey, id)
      } catch (error) {
        toast.error(messagesNow(MESSAGES).replyNotOpened, {
          description: error instanceof Error ? error.message : undefined
        })
      }
    },
    [composerDataFor, showComposer]
  )

  /**
   * Asks the Segretario, in its panel, for a reminder to whoever is
   * awaited: it reads the conversation and writes the reminder, which the
   * user sends — the same as asking it in words.
   */
  const remindAbout = useCallback(
    async (commitment: Commitment): Promise<void> => {
      try {
        // Awaited in a conversation, the reminder answers it; otherwise the Segretario finds where.
        const { source } = commitment
        const ref =
          source.kind === 'message'
            ? await window.segretarioApi.replySource(source.accountId, source.messageKey)
            : null
        setSegretarioOpen(true)
        await startSegretario(messagesNow(MESSAGES).remindRequest(commitment.text), {
          messages: ref ? [ref] : [],
          accountId: source.kind === 'message' ? source.accountId : null,
          folderLabel: null
        })
      } catch (error) {
        toast.error(messagesNow(MESSAGES).remindFailed, {
          description: error instanceof Error ? error.message : undefined
        })
      }
    },
    [startSegretario]
  )

  /** Waits for the composer of a draft to be mounted, to act on it. */
  const composerHandleFor = useCallback(
    async (draftId: string): Promise<MailComposerHandle | null> => {
      for (let waited = 0; waited < 5_000; waited += 50) {
        const handle = composerHandlesRef.current.get(draftId)

        if (handle) {
          return handle
        }

        await new Promise((resolve) => window.setTimeout(resolve, 50))
      }

      return null
    },
    []
  )

  /**
   * The user's answer to a confirmation the Segretario asked for. A send
   * goes out the way any message goes — through its composer, with the
   * same checks and the same layout — and the Segretario hears how it went,
   * in Italian, the language it works in.
   */
  const answerSegretarioApproval = useCallback(
    async (activityId: string, approval: ApprovalRequest, approved: boolean): Promise<void> => {
      const resolve = (outcome?: SendOutcome): Promise<void> =>
        segretario.resolveApproval(activityId, approval.approvalId, approved, outcome)

      if (!approved || approval.kind !== 'send' || !approval.draft) {
        await resolve()
        return
      }

      const draftId = approval.draft.draftId

      if (!composerHandlesRef.current.has(draftId)) {
        const stored = await window.mailApi.getStoredDraft(draftId)

        if (!stored) {
          await resolve({ sent: false, error: 'La bozza non c’è più: è stata inviata o scartata.' })
          return
        }

        setComposeSessions((current) =>
          current.some((session) => session.id === draftId)
            ? current
            : [
                ...current,
                {
                  id: draftId,
                  initialData: draftToInitialData(stored.content),
                  existing: true,
                  status: stored.status
                }
              ]
        )
      }

      const handle = await composerHandleFor(draftId)

      if (!handle) {
        await resolve({ sent: false, error: 'La bozza non si è aperta.' })
        return
      }

      segretarioSendWaitersRef.current.set(draftId, (outcome) => void resolve(outcome))

      if (!(await handle.send())) {
        segretarioSendWaitersRef.current.delete(draftId)
        showComposer(draftId)
        await resolve({
          sent: false,
          error: 'L’invio si è fermato per un controllo: la bozza è aperta per correggerla.'
        })
      }
    },
    [composerHandleFor, segretario, showComposer]
  )

  const showMail = useCallback((): void => setActiveApp('mail'), [])
  const mail = useMailApp({
    accounts,
    setAccounts,
    aiOn,
    // In sight: in front, with a mailbox, past the welcome screen — its keys act on nothing else.
    active: shownApp === 'mail' && accounts.length > 0 && !workspaceCovered,
    writingInFront: activeComposeId !== null,
    show: showMail,
    uiPreferences,
    uiPreferencesRef,
    updateUiPreferences,
    changeReaderZoom,
    confirm,
    ownAddresses,
    openComposer,
    shellModalOpen,
    runAppCommandRef
  })

  // Writing in the column layout, where the reading pane is a band under the list, takes the
  // workspace — a new message has room to be written in — and gives it back when the message
  // is no longer in front, unless the user chose otherwise meanwhile (vision §6.6).
  const [seenWritingId, setSeenWritingId] = useState(activeComposeId)
  const [expandedForWriting, setExpandedForWriting] = useState(false)

  if (activeComposeId !== seenWritingId) {
    setSeenWritingId(activeComposeId)

    if (activeComposeId !== null && uiPreferences.layoutMode === 'outlook') {
      if (!mail.isMessageExpanded) {
        mail.setIsMessageExpanded(true)
        setExpandedForWriting(true)
      }
    } else if (activeComposeId === null && expandedForWriting) {
      setExpandedForWriting(false)

      if (mail.isMessageExpanded) {
        mail.setIsMessageExpanded(false)
      }
    }
  }

  // How every connection stands — mail and calendars — for the rail's dot, in the interface's
  // language: said again when it changes.
  const connectionStatus = useMemo(
    () => connectionsStatus(accounts, mail.accountConnections, calendarConnections ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the words follow the language
    [accounts, calendarConnections, mail.accountConnections, language]
  )
  const { openMessage: openMailMessage, selectFolder, openAskedSearch, setSelectedAccountId } = mail

  /**
   * A project, where it can be seen today: its list in the Posta — with no
   * mailbox, the Progetti page.
   */
  const openProject = useCallback(
    (projectId: string): void => {
      if (accounts.length === 0) {
        setActiveApp('projects')
        return
      }

      selectFolder(segretarioProjectPath(projectId))
    },
    [accounts.length, selectFolder]
  )

  /**
   * A message opened from anywhere — a notification, a link the Segretario
   * wrote, Oggi, the calendar — shown in its own folder, selected, past the
   * welcome screen.
   */
  const openMessageRef = useCallback(
    (ref: MessageRef): void =>
      whenSetupAllows(() => {
        setWelcome(null)
        // A message asked to be seen comes in front of what is being written, which stays in its tab.
        setActiveComposeId(null)
        openMailMessage(ref)
      }),
    [openMailMessage, whenSetupAllows]
  )

  /**
   * A message to an event's guests, from the Calendario: in the Posta, from
   * the mailbox that came with the event's calendar when there is one, else
   * the one in sight.
   */
  const { selectedAccountId: mailAccountInSight } = mail
  const writeAboutEvent = useCallback(
    ({ to, subject, connectionId }: CalendarMailRequest): void => {
      const own = calendarConnections?.find((connection) => connection.id === connectionId)
      const accountId =
        accounts.find((account) => account.id === own?.mailAccountId)?.id ??
        mailAccountInSight ??
        accounts[0]?.id

      if (accountId) {
        openComposer({ kind: 'new', accountId, to: parseRecipients(to.join(', ')), subject })
      }
    },
    [accounts, calendarConnections, mailAccountInSight, openComposer]
  )

  // A notification clicked opens where it leads (§13.3), as a link of the Segretario would — past
  // the welcome, and once the setup allows it.
  const selectSegretarioActivity = segretario.select
  useEffect(
    () =>
      window.notificationsApi.onOpen((target) => {
        switch (target.kind) {
          case 'message':
            openMessageRef(target.ref)
            return
          case 'window':
            return
        }

        whenSetupAllows(() => {
          setWelcome(null)

          switch (target.kind) {
            case 'event':
              void openCalendarEvent(target.eventKey)
              return
            case 'day':
              openCalendar({ day: new Date(target.day) })
              return
            case 'today':
              setActiveApp(aiOn ? 'oggi' : firstSourceApp)
              return
            case 'activity':
              if (aiOn) {
                selectSegretarioActivity(target.activityId)
                setSegretarioOpen(true)
              }
              return
            case 'draft':
              void openDraftById(target.draftId)
              return
            case 'connections':
              setSettingsSection('accounts')
              setSettingsOpen(true)
              return
          }
        })
      }),
    [
      aiOn,
      firstSourceApp,
      openCalendar,
      openCalendarEvent,
      openDraftById,
      openMessageRef,
      selectSegretarioActivity,
      whenSetupAllows
    ]
  )

  // The Segretario shows the user something: a message, a search, a draft.
  useEffect(
    () =>
      window.segretarioApi.onShowRequest((request) =>
        whenSetupAllows(() => {
          // What the Segretario shows is seen: it comes past the welcome screen.
          setWelcome(null)

          switch (request.kind) {
            case 'message':
              openMessageRef(request.ref)
              return
            case 'draft':
              void openDraftById(request.draftId)
              return
            case 'search':
              openAskedSearch(request.search)
              return
            case 'project':
              openProject(request.projectId)
              return
            case 'event':
              void openCalendarEvent(request.eventKey)
              return
            case 'day':
              if (request.day === dayKey(new Date()) && aiOn) {
                setActiveApp('oggi')
              } else {
                openCalendar({ day: dayOfKey(request.day) })
              }
              return
          }
        })
      ),
    [
      aiOn,
      openAskedSearch,
      openCalendar,
      openCalendarEvent,
      openDraftById,
      openMessageRef,
      openProject,
      whenSetupAllows
    ]
  )

  /** A link the Segretario wrote, followed. */
  const openSegretarioHandle = useCallback(
    (link: HandleLink): void => {
      const openWhereItIs = (found: Promise<MessageRef | null>): void =>
        void found.then((ref) => {
          if (ref) {
            openMessageRef(ref)
          } else {
            toast.error(messagesNow(MESSAGES).messageGone, {
              description: messagesNow(MESSAGES).messageGoneText
            })
          }
        })

      switch (link.kind) {
        case 'message':
          // Archived or moved since it was named, it is opened where it is now.
          if (link.messageKey) {
            openWhereItIs(window.segretarioApi.replySource(link.ref.accountId, link.messageKey))
          } else {
            openMessageRef(link.ref)
          }
          return
        case 'draft':
          void openDraftById(link.draftId)
          return
        case 'file':
          if (link.path) {
            void window.mailApi.openFile(link.path)
          } else if (link.ref && link.attachmentId) {
            void window.mailApi.openAttachment({ ref: link.ref, attachmentId: link.attachmentId })
          }
          return
        case 'project':
          openProject(link.projectId)
          return
        case 'event':
          void openCalendarEvent(link.eventKey)
          return
        case 'commitment':
          // An open thing opens where it comes from: its message, its event — the user's word
          // in its project, or in Oggi.
          void window.segretarioApi.commitmentSource(link.commitmentId).then((source) => {
            if (source?.kind === 'message') {
              openMessageRef(source.ref)
            } else if (source?.kind === 'event') {
              void openCalendarEvent(source.eventKey)
            } else if (source?.kind === 'user' && source.projectId) {
              openProject(source.projectId)
            } else if (source?.kind === 'user') {
              setActiveApp('oggi')
            } else {
              toast.error(messagesNow(MESSAGES).sourceGone, {
                description: messagesNow(MESSAGES).sourceGoneText
              })
            }
          })
      }
    },
    [openCalendarEvent, openDraftById, openMessageRef, openProject]
  )

  /**
   * Runs a command from the menu bar or its chord. Nothing happens over an
   * open dialog or menu, and a command with nothing to act on — a reply with
   * no message open — does nothing. Returns whether it applied, so a chord
   * that did nothing is left to whatever else wants the key.
   */
  const runAppCommand = (commandId: string): boolean => {
    if (mail.isModalSurfaceOpen || isOverlaySurfaceOpen()) {
      return false
    }

    switch (commandId as HostCommandId) {
      case 'settings':
        setSettingsOpen(true)
        return true
      case 'segretario':
        if (!segretarioOffered) {
          return false
        }

        // Open, with the user writing a message: the panel takes the words. Otherwise, and from
        // the panel itself, the key opens and closes it.
        if (
          segretarioOpen &&
          activeComposeId !== null &&
          shownApp === 'mail' &&
          !document.activeElement?.closest('[data-segretario-panel]')
        ) {
          setSegretarioFocusRequest((current) => current + 1)
          return true
        }

        setSegretarioOpen((open) => !open)
        return true
      case 'next-tab':
      case 'previous-tab': {
        // The reading pane's tabs, in turn: the message read, then each being written.
        if (shownApp !== 'mail' || composeSessions.length === 0) {
          return false
        }

        const order = [null, ...composeSessions.map((session) => session.id)]
        const step = commandId === 'next-tab' ? 1 : -1
        const next = order[(order.indexOf(activeComposeId) + step + order.length) % order.length]

        if (next) {
          showComposer(next)
        } else {
          setActiveComposeId(null)
        }

        return true
      }
      case 'search':
        // "Cerca" looks in the app in front that has a search: the calendar its events, the mail
        // its messages. Elsewhere there is nothing to search, and the key is left alone.
        if (shownApp === 'calendar') {
          calendarSearchRef.current?.focus()
          calendarSearchRef.current?.select()
          return true
        }

        return shownApp === 'mail' && accounts.length > 0 && mail.runCommand(commandId)
      default:
        // The others are the mail's — and the extension's, on the mail's selection. What acts on
        // the selected messages or the reader waits for Mail to be in front: nothing is answered,
        // archived or moved unseen. Writing a new message and the way to a folder go anywhere.
        // A message being written in front hides the one read: what would act on it waits too —
        // a chord meant for the text never moves or answers a message out of sight. The zoom is
        // the message being written's as well.
        if (
          actsOnMailShown(commandId) &&
          (shownApp !== 'mail' ||
            (activeComposeId !== null && !commandId.startsWith('reader-zoom')))
        ) {
          return false
        }

        return mail.runCommand(commandId)
    }
  }

  useEffect(() => {
    runAppCommandRef.current = runAppCommand
  })

  /** A send the Segretario asked for went, or did not: it hears how. */
  const settleSegretarioSend = (draftId: string | undefined, outcome: SendOutcome): void => {
    const waiter = draftId ? segretarioSendWaitersRef.current.get(draftId) : undefined

    if (draftId && waiter) {
      segretarioSendWaitersRef.current.delete(draftId)
      waiter(outcome)
    }
  }

  const handleComposerSendRequested = useCallback(
    (payload: ComposeMailInput, draft: ComposerInitialData): void => {
      if (draft.draftId) {
        removeComposeSession(draft.draftId)
      }

      void (async () => {
        const sendingToast = toast.loading(messagesNow(MESSAGES).sending)
        // Who sent it: the user, or the Segretario that asked and waits to hear (§14.4).
        const sent = {
          by:
            payload.draftId && segretarioSendWaitersRef.current.has(payload.draftId)
              ? ('segretario' as const)
              : ('user' as const),
          conn: payload.accountId,
          kind: draft.kind,
          recipients: payload.to.length + payload.cc.length + payload.bcc.length,
          attachments: payload.attachments.length
        }
        const startedAt = Date.now()

        try {
          const { queued } = await window.mailApi.sendMail({
            ...payload,
            html: await buildOutgoingMailHtml(payload.html)
          })
          uiLog.info('composer.send', { ...sent, queued, ms: Date.now() - startedAt })

          if (queued) {
            toast.info(messagesNow(MESSAGES).queued, {
              id: sendingToast,
              description: messagesNow(MESSAGES).queuedText
            })
          } else {
            toast.success(messagesNow(MESSAGES).sent, { id: sendingToast })
          }

          settleSegretarioSend(payload.draftId, { sent: true, queued })

          // What the user wrote, for the Segretario to compare with a draft of its own.
          if (payload.draftId) {
            void window.segretarioApi
              .draftSent(payload.draftId, writtenText(payload.html))
              .catch(() => undefined)
          }
        } catch (caughtError) {
          toast.dismiss(sendingToast)
          uiLog.warn('composer.send.failed', { ...sent, ms: Date.now() - startedAt })
          // The Segretario reads its own words (Italian); the user, theirs.
          settleSegretarioSend(payload.draftId, {
            sent: false,
            error:
              caughtError instanceof Error && caughtError.message.trim()
                ? caughtError.message
                : 'Invio email non riuscito.'
          })
          const failure = {
            id: ++failedSendIdRef.current,
            draft,
            message:
              caughtError instanceof Error && caughtError.message.trim()
                ? caughtError.message
                : messagesNow(MESSAGES).sendFailedText
          }
          setFailedSends((current) => [...current, failure])
        }
      })()
    },
    [removeComposeSession]
  )

  // The outbox: a message that waited for its server went, or gave up — its draft offered back.
  useEffect(() => {
    const offSent = window.mailApi.onOutboxSent(({ subject }) =>
      toast.success(messagesNow(MESSAGES).outboxSent, {
        description: messagesNow(MESSAGES).outboxSentText(subject)
      })
    )
    const offFailed = window.mailApi.onOutboxFailed(({ draftId, message }) => {
      void (async () => {
        const stored = draftId ? await window.mailApi.getStoredDraft(draftId) : null

        if (!stored) {
          toast.error(messagesNow(MESSAGES).sendFailed, {
            description: message,
            duration: Infinity
          })
          return
        }

        setFailedSends((current) => [
          ...current,
          { id: ++failedSendIdRef.current, draft: draftToInitialData(stored.content), message }
        ])
      })()
    })

    return () => {
      offSent()
      offFailed()
    }
  }, [])

  const settleFailedSend = useCallback(
    (retry: boolean): void => {
      if (!failedSend) {
        return
      }

      setFailedSends((current) => current.filter((entry) => entry.id !== failedSend.id))

      if (retry) {
        openComposer(failedSend.draft)
      } else if (failedSend.draft.draftId) {
        // Not reopened now: it waits in Bozze, not in a tab.
        void window.mailApi.closeDraft(failedSend.draft.draftId).catch(() => undefined)
      }
    },
    [failedSend, openComposer]
  )

  const onAccountCreated = (account: MailAccount): void => {
    // Signing in again to an account already here (to add its calendar) gives that account back.
    setAccounts((current) => [...current.filter((existing) => existing.id !== account.id), account])
    setSelectedAccountId(account.id)
    setWelcome(null)
  }

  /**
   * "Entra": the layer over the workspace goes, and the user finds what they
   * were doing — at launch, the app the workspace is born on.
   */
  const enterWorkspace = useCallback((): void => {
    if (!hasConnections) {
      return
    }

    setSelectedAccountId((current) => {
      if (current && accounts.some((account) => account.id === current)) {
        return current
      }

      return accounts[0]?.id ?? null
    })
    setWelcome(null)
  }, [accounts, hasConnections, setSelectedAccountId])

  /** Starts the guided setup of a case, kept as it goes. */
  function startOnboarding(setupCase: OnboardingCase): void {
    // What the user looks at is kept for when it ends — the first source standing in for Oggi with
    // the AI off too, so a setup that turns the AI on does not move them.
    if (workspaceExists && segretario.status) {
      setActiveApp(shownApp)
    }

    saveOnboarding(newOnboarding(setupCase))
  }

  /**
   * The AI turned on: the first time, or again — Conoscimi is the user's to
   * redo then — through the guided setup.
   */
  async function startAiOnboarding(): Promise<void> {
    const [learning, memory] = await Promise.all([
      window.segretarioApi.listLearning(),
      window.segretarioApi.listMemory()
    ])
    const known = learning.some((connection) => connection.state === 'done') || memory.length > 0
    startOnboarding(known ? 'ai-riaccesa' : 'ai-prima-volta')
  }

  function saveOnboarding(next: OnboardingState | null): void {
    setupOpenRef.current = next !== null
    setOnboarding(next)
    void window.segretarioApi.setOnboarding(next).catch((error: unknown) =>
      toast.error(messagesNow(MESSAGES).setupNotSaved, {
        description: error instanceof Error ? error.message : undefined
      })
    )
  }

  // Whether a connection turned down still is, by what the page knows of it: undefined until it
  // knows — at launch the refusals come before the states — false once put right or taken away.
  const isConnectionRefused = useCallback(
    (notice: ConnectionRefusedNotice): boolean | undefined => {
      if (notice.family === 'calendario') {
        return calendarConnections
          ? calendarConnections.some(
              (connection) => connection.id === notice.id && connection.refused
            )
          : undefined
      }

      if (bootstrapLoading) {
        return undefined
      }

      const state = mail.accountConnections[notice.id]
      return accounts.some((account) => account.id === notice.id)
        ? state
          ? state.refused !== undefined
          : undefined
        : false
    },
    [accounts, bootstrapLoading, calendarConnections, mail.accountConnections]
  )

  // What asks the user wherever the window stands — the launch, the setup, the workspace.
  const frameOverlay = (
    <>
      <ConnectionRefusedDialog
        isRefused={isConnectionRefused}
        aiOn={aiOn}
        onOpenChange={setRefusedOpen}
        onReconnect={async (notice, password) => {
          if (notice.family === 'posta') {
            await window.mailApi.reconnectAccount(notice.id, password)
          } else {
            await window.calendarApi.reconnect(notice.id, password)
          }
        }}
        onRemove={(notice) => {
          if (notice.family === 'posta') {
            void mail.removeAccount(notice.id, [], { confirmed: true })
            return
          }

          window.calendarApi.disconnect(notice.id).catch((error: unknown) =>
            toast.error(messagesNow(MESSAGES).calendarNotDisconnected, {
              description: error instanceof Error ? error.message : undefined
            })
          )
        }}
      />
      {confirmDialog}
    </>
  )

  // What failed to start says so, with a way to try again, before anything else waits.
  if (!bootstrapLoading && bootstrapError) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
        onNoticeOpenChange={setNoticeOpen}
        overlay={frameOverlay}
      >
        <div className="mx-auto flex h-full max-w-xl items-center px-6">
          <div className="border-destructive/40 bg-destructive/15 w-full rounded-xl border p-6">
            <p className="display-title text-2xl">{m.startupError}</p>
            <p className="text-destructive-soft-foreground mt-2 text-sm">{bootstrapError}</p>
            <Button className="window-no-drag mt-5" onClick={() => void reloadBootstrap()}>
              {m.retry}
            </Button>
          </div>
        </div>
      </AppFrame>
    )
  }

  // The calendars are known before the first screen: one connected is enough to go in.
  if (bootstrapLoading || onboarding === undefined || calendarConnections === null) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
        onNoticeOpenChange={setNoticeOpen}
        overlay={frameOverlay}
      >
        <div className="flex h-full items-center justify-center">
          <div className="border-border bg-card/70 flex items-center gap-3 rounded-xl border px-5 py-4 text-sm">
            <LoaderCircle className="text-primary size-5 animate-spin" />
            {m.starting}
          </div>
        </div>
      </AppFrame>
    )
  }

  // Another app than the mail is what the user looks at, not the selection left in the mail.
  const shownPage = shownApp === 'mail' ? null : places[APP_PLACES[shownApp]]
  const mailSight = mail.sight
  // In the calendar, what it shows: the days, and the event open.
  const calendarInSight = shownApp === 'calendar' ? calendarSight : null
  // A message being written in front is what the user is looking at: read as they send, with the
  // passage selected then (vision §6.6).
  const composingInFront =
    shownApp === 'mail' && activeComposeId !== null
      ? (composeSessions.find((session) => session.id === activeComposeId) ?? null)
      : null
  const composingSummary = composingInFront ? composeSummaries[composingInFront.id] : undefined
  // What the user is looking at goes along with what they ask the Segretario.
  const segretarioContext: SegretarioContextChip = composingInFront
    ? {
        context: { messages: [], accountId: null, folderLabel: null },
        resolve: () => ({
          messages: [],
          accountId: null,
          folderLabel: null,
          composing: composerHandlesRef.current.get(composingInFront.id)?.describe() ?? null
        }),
        label: composingSummary?.subject.trim()
          ? m.writingSubject(composingSummary.subject.trim())
          : m.writing,
        kind: 'composing'
      }
    : {
        context: {
          messages: shownPage ? [] : mailSight.messages,
          accountId: mailSight.accountId,
          folderLabel: calendarInSight?.label ?? shownPage ?? mailSight.viewLabel,
          eventKey: calendarInSight?.event?.key ?? null
        },
        label: calendarInSight
          ? calendarInSight.event
            ? m.quoted(calendarInSight.event.title)
            : calendarInSight.label
          : shownPage
            ? shownPage
            : mailSight.label,
        kind: calendarInSight ? 'calendar' : shownPage ? 'page' : undefined
      }
  const segretarioSuggestionList = segretarioSuggestions({
    composing: composingInFront
      ? { answering: composingInFront.initialData.kind === 'reply' }
      : null,
    selectionCount: shownPage ? 0 : mailSight.selectionCount,
    work: shownPage ? null : mailSight.work,
    messageOpen: !shownPage && mailSight.messageOpen,
    project: shownPage ? null : mailSight.project,
    calendarConnected,
    calendar: calendarInSight ? { eventOpen: calendarInSight.event !== null } : null
  })

  // Over the workspace — in its place, while there is none —: the setup, or the welcome. One tree
  // for all, so nothing of the setup is lost when the workspace comes or goes under it.
  const cover = onboarding ? (
    <OnboardingWizard
      state={onboarding}
      accounts={accounts}
      calendarConnections={calendarConnections}
      connections={mail.accountConnections}
      removingAccountId={mail.removingAccountId}
      canUseGoogle={capabilities.googleOAuthReady}
      canUseMicrosoft={capabilities.microsoftOAuthReady}
      segretario={segretario}
      aiOn={aiOn}
      connectCalendarOf={calendarToConnect}
      onConnectCalendarAsked={() => setCalendarToConnect(null)}
      onAccountCreated={onAccountCreated}
      onRemoveAccount={(accountId, calendars) => void mail.removeAccount(accountId, calendars)}
      onChange={saveOnboarding}
      onFinish={(entered) => {
        saveOnboarding(null)
        setCalendarToConnect(null)

        if (entered) {
          enterWorkspace()
        }

        // What asked to be seen meanwhile is shown now.
        const show = afterSetupRef.current
        afterSetupRef.current = null
        show?.()
      }}
    />
  ) : welcome !== null || !hasConnections ? (
    <WelcomeScreen
      hasConnections={hasConnections}
      fadeIn={welcome === 'rail'}
      onEnter={enterWorkspace}
      onSetup={startOnboarding}
    />
  ) : undefined

  return (
    <CommandShortcutsProvider overrides={uiPreferences.shortcutOverrides}>
      <SegretarioLinkProvider value={openSegretarioHandle}>
        <AppFrame
          windowControlsState={windowControlsState}
          onMinimizeWindow={handleMinimizeWindow}
          onToggleMaximizeWindow={handleToggleMaximizeWindow}
          onCloseWindow={handleCloseWindow}
          onNoticeOpenChange={setNoticeOpen}
          overlay={frameOverlay}
          framed={workspaceExists}
          cover={cover}
          rightInset={assistantInset}
        >
          {workspaceExists && (
            <ComposerSlotProvider onSlot={setComposerSlot}>
              <WorkspaceLayout
                mode={uiPreferences.layoutMode}
                readerExpanded={mail.isMessageExpanded}
                readerKey={mail.readingRef ? messageRefKey(mail.readingRef) : null}
                rail={
                  <AppRail
                    items={railItems.map((item) =>
                      item.id === 'mail' ? { ...item, writing: composeSessions.length } : item
                    )}
                    activeItemId={shownApp}
                    onSelectItem={(id) => {
                      const app = railItems.find((item) => item.id === id)

                      if (app) {
                        setActiveApp(app.id)
                      }
                    }}
                    onOpenWelcome={() => setWelcome('rail')}
                    connections={connectionStatus}
                    onOpenConnections={() => {
                      setSettingsSection('accounts')
                      setSettingsOpen(true)
                    }}
                    segretario={
                      segretarioOffered
                        ? {
                            open: segretarioOpen,
                            attention: segretario.attention,
                            onToggle: () => setSegretarioOpen((current) => !current)
                          }
                        : null
                    }
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                }
                sidebar={
                  <MailSidebar
                    mail={mail}
                    showTitle={
                      !windowControlsState.dragTopRegionEnabled || windowControlsState.enabled
                    }
                    onAddAccount={() => startOnboarding('nuova-connessione')}
                  />
                }
                messageList={
                  <MailMessageList
                    mail={mail}
                    segretarioOpen={segretarioOpen}
                    canWrite={segretario.status?.keyState === 'ready'}
                    onRemind={remindAbout}
                    onRowActivated={() => setActiveComposeId(null)}
                  />
                }
                notice={<MailNotice mail={mail} />}
                reader={
                  <MailReader
                    mail={mail}
                    segretarioOpen={segretarioOpen}
                    onRemind={(commitment) => void remindAbout(commitment)}
                    onTakeUpReply={takeUpReply}
                    writing={{
                      tabs: composeSessions.map((session) => ({
                        id: session.id,
                        kind: session.initialData.kind,
                        summary: composeSummaries[session.id] ?? null
                      })),
                      activeId: activeComposeId,
                      onSelect: (id) => (id ? showComposer(id) : setActiveComposeId(null)),
                      onClose: (id) => void composerHandlesRef.current.get(id)?.close(),
                      onNew: () => void mail.runCommand('compose')
                    }}
                  />
                }
                app={
                  shownApp === 'mail' && accounts.length === 0 ? (
                    <AppPlaceholder
                      title={places.mail}
                      icon={Mail}
                      atWindowTopRight={!segretarioOpen}
                      lead={m.mailLead}
                      points={[m.mailEach, ...(aiOn ? [m.mailSegretario] : [])]}
                      action={{
                        label: m.connectMailbox,
                        onClick: () => startOnboarding('nuova-connessione')
                      }}
                    />
                  ) : shownApp === 'oggi' ? (
                    <TodayPage
                      canWrite={segretario.status?.keyState === 'ready'}
                      atWindowTopRight={!segretarioOpen}
                      onOpenMessage={openMessageRef}
                      onRemind={(commitment) => void remindAbout(commitment)}
                    />
                  ) : shownApp === 'calendar' ? (
                    <CalendarApp
                      key={calendarFocus?.at}
                      aiOn={aiOn}
                      newEventDefaults={{
                        calendarKey: uiPreferences.newEventCalendarKey,
                        minutes: uiPreferences.newEventMinutes
                      }}
                      focus={calendarFocus?.focus}
                      onSight={setCalendarSight}
                      searchInputRef={calendarSearchRef}
                      keysEnabled={!shellModalOpen}
                      atWindowTopRight={!segretarioOpen}
                      onOpenMessage={openMessageRef}
                      onOpenConnections={() => startOnboarding('nuova-connessione')}
                      onOpenConnectionSettings={() => {
                        setSettingsSection('accounts')
                        setSettingsOpen(true)
                      }}
                      onWriteTo={accounts.length > 0 ? writeAboutEvent : undefined}
                      onRemind={(commitment) => void remindAbout(commitment)}
                      onAskSegretario={
                        segretarioOffered
                          ? () => {
                              setSegretarioOpen(true)
                              setSegretarioFocusRequest((current) => current + 1)
                            }
                          : undefined
                      }
                    />
                  ) : shownApp === 'files' ? (
                    <AppPlaceholder
                      title={places.files}
                      icon={Files}
                      badge={m.comingSoon}
                      atWindowTopRight={!segretarioOpen}
                      lead={m.filesLead}
                      points={[
                        m.filesEach,
                        m.filesSearch,
                        m.filesBelonging,
                        ...(aiOn ? [m.filesSegretario] : [])
                      ]}
                    />
                  ) : shownApp === 'contacts' ? (
                    <AppPlaceholder
                      title={places.contacts}
                      icon={BookUser}
                      badge={m.comingSoon}
                      atWindowTopRight={!segretarioOpen}
                      lead={m.contactsLead}
                      points={[m.contactsSources, m.contactsEach, m.contactsSegretario]}
                    />
                  ) : shownApp === 'projects' ? (
                    <AppPlaceholder
                      title={places.projects}
                      icon={Briefcase}
                      badge={m.comingSoon}
                      atWindowTopRight={!segretarioOpen}
                      lead={m.projectsLead}
                      points={[
                        m.projectsTogether,
                        m.projectsWorkspace,
                        m.projectsContext,
                        ...(aiOn && accounts.length > 0 ? [m.projectsMeanwhile] : [])
                      ]}
                    />
                  ) : undefined
                }
                assistant={
                  segretarioOpen ? (
                    <SegretarioPanel
                      state={segretario}
                      contextChip={segretarioContext}
                      suggestions={segretarioSuggestionList}
                      atWindowTopRight
                      onClose={() => setSegretarioOpen(false)}
                      onOpenHandle={openSegretarioHandle}
                      onApprove={(activityId, approval, approved) =>
                        void answerSegretarioApproval(activityId, approval, approved)
                      }
                      onOpenDraft={(draftId) => void openDraftById(draftId)}
                      focusRequest={segretarioFocusRequest}
                    />
                  ) : null
                }
              />

              {/* Every message being written stays mounted, in the reading pane's place. */}
              <ComposerLayer
                slot={composerSlot}
                hidden={workspaceCovered || shownApp !== 'mail' || activeComposeId === null}
              >
                {composeSessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn('absolute inset-0', session.id !== activeComposeId && 'hidden')}
                  >
                    <MailComposer
                      ref={(handle) => {
                        if (handle) {
                          composerHandlesRef.current.set(session.id, handle)
                        } else {
                          composerHandlesRef.current.delete(session.id)
                        }
                      }}
                      session={session}
                      active={
                        session.id === activeComposeId && shownApp === 'mail' && !workspaceCovered
                      }
                      accounts={accounts}
                      zoom={uiPreferences.readerZoom}
                      onZoomChange={changeReaderZoom}
                      expanded={mail.isMessageExpanded}
                      onToggleExpanded={() => mail.setIsMessageExpanded((current) => !current)}
                      takeFocus={session.id !== quietComposeId}
                      atWindowTopRight={false}
                      onLeave={() =>
                        setActiveComposeId((current) => (current === session.id ? null : current))
                      }
                      onClosed={(outcome) => handleComposerClosed(session.id, outcome)}
                      onSendRequested={handleComposerSendRequested}
                      onSummaryChange={(summary) => updateComposeSummary(session.id, summary)}
                      onAskSegretario={
                        segretarioOffered
                          ? () => {
                              setSegretarioOpen(true)
                              setSegretarioFocusRequest((current) => current + 1)
                            }
                          : undefined
                      }
                    />
                  </div>
                ))}
              </ComposerLayer>

              <ConfirmDialog
                open={failedSend !== null}
                title={m.sendFailed}
                description={failedSend?.message}
                details={
                  failedSend && (
                    <div className="border-destructive/35 bg-destructive/10 flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px]">
                      <AlertTriangle className="text-destructive size-3.5 shrink-0" />
                      <span className="min-w-0 truncate">
                        {failedSend.draft.subject
                          ? m.notSentSubject(failedSend.draft.subject)
                          : m.notSent}
                      </span>
                    </div>
                  )
                }
                confirmLabel={m.reopenAndRetry}
                cancelLabel={m.leaveInDrafts}
                initialFocus="confirm"
                onConfirm={() => settleFailedSend(true)}
                onCancel={() => settleFailedSend(false)}
              />

              <MailDialogs mail={mail} />

              <SettingsDialog
                open={settingsOpen}
                onOpenChange={(open) => {
                  setSettingsOpen(open)

                  if (!open) {
                    setSettingsSection(null)
                  }
                }}
                initialSectionId={settingsSection}
                accounts={accounts}
                mailStates={mail.accountConnections}
                googleReady={capabilities.googleOAuthReady}
                microsoftReady={capabilities.microsoftOAuthReady}
                selectedAccountId={mail.selectedAccountId}
                removingAccountId={mail.removingAccountId}
                clearingAccountDataId={mail.clearingAccountDataId}
                clearingDatabaseData={mail.clearingDatabaseData}
                uiPreferences={uiPreferences}
                onUiPreferencesChange={updateUiPreferences}
                onRemoveAccount={(accountId, calendars) =>
                  void mail.removeAccount(accountId, calendars)
                }
                onClearAccountData={(accountId) => void mail.clearAccountData(accountId)}
                onClearDatabaseData={() => void mail.clearAllDataKeepAccounts()}
                onAddAccount={() => {
                  setSettingsOpen(false)
                  startOnboarding('nuova-connessione')
                }}
                onAddCalendar={(mailAccountId) => {
                  setSettingsOpen(false)
                  setCalendarToConnect(mailAccountId)
                  startOnboarding('nuova-connessione')
                }}
                aiOn={aiOn}
                onEnableAi={() => {
                  setSettingsOpen(false)
                  void startAiOnboarding()
                }}
                onRedoConoscimi={() => {
                  setSettingsOpen(false)

                  // Conoscimi is the Segretario at work: with the AI off, the way to it turns it on.
                  if (aiOn) {
                    startOnboarding('conoscimi')
                  } else {
                    void startAiOnboarding()
                  }
                }}
                onUnifiedPreferencesChanged={mail.handleUnifiedPreferencesChanged}
              />
            </ComposerSlotProvider>
          )}
        </AppFrame>
      </SegretarioLinkProvider>
    </CommandShortcutsProvider>
  )
}

export default App
