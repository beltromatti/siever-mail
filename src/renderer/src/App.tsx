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
  LogIn,
  Mail,
  Minus,
  Plus,
  Square,
  Sun,
  X,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'

import appLogo from '@renderer/assets/logo.png'
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
import { COMPOSE_DOCK_HEIGHT, ComposeDock } from '@renderer/features/mail/compose-dock'
import { AppRail } from '@renderer/features/workspace/app-rail'
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
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useTaskbarBadge } from '@renderer/lib/taskbar-badge'
import { cn, formatAppVersion } from '@renderer/lib/utils'
import { segretarioProjectPath } from '@shared/folders'
import { CommandShortcutsProvider, isOverlaySurfaceOpen } from '@renderer/lib/command-shortcuts'
import { buildOutgoingMailHtml } from '@renderer/lib/outgoing-mail-html'
import { summaryToMessageRef } from '@renderer/lib/message-selection'
import { clampReaderZoom, DEFAULT_UI_PREFERENCES } from '@shared/models'
import { findCommand, type HostCommandId } from '@shared/commands'
import { replyRecipients, replyReferences } from '@shared/reply'
import { forwardSubject, replySubject } from '@shared/subject'
import type {
  AppCapabilities,
  ComposeMailInput,
  DraftStatus,
  MailAccount,
  MailAddress,
  MessageRef,
  UiPreferences,
  WindowControlsState
} from '@shared/models'

/** How long a notice offering "Annulla" stays, as Gmail leaves its own. */
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

/**
 * The apps of the rail, in their groups (see `WORKSPACE_APPS`). Oggi is the
 * Segretario's, there only with the AI on.
 */
const RAIL_ITEMS: ReadonlyArray<RailItem & { id: AppId }> = WORKSPACE_APPS.map((app) => ({
  id: app.id,
  label: app.label,
  icon: APP_ICONS[app.id],
  group: app.group,
  soon: !app.available
}))

function AppFrame({
  children,
  windowControlsState,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow,
  inert = false,
  dock,
  dockVisible = false,
  rightInset = 0,
  framed = false,
  onNoticeOpenChange
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
  /** What takes the window's right edge — the Segretario's column — in px: the notices keep clear of it. */
  rightInset?: number
  /** The workspace: its panes' headers are the title bar the window is dragged by. */
  framed?: boolean
  /** A notice about the AI shown, or gone (`AiNotice`). */
  onNoticeOpenChange: (open: boolean) => void
}): React.JSX.Element {
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
        {windowControlsState.enabled && (
          <div className="window-no-drag fixed top-0 right-0 z-[10000] flex">
            <button
              type="button"
              className="text-muted-foreground hover:bg-hover hover:text-foreground inline-flex h-8 w-10 items-center justify-center transition-colors"
              onClick={onMinimizeWindow}
              aria-label="Minimizza finestra"
              title="Minimizza"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:bg-hover hover:text-foreground inline-flex h-8 w-10 items-center justify-center transition-colors"
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
              className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground inline-flex h-8 w-10 items-center justify-center transition-colors"
              onClick={onCloseWindow}
              aria-label="Chiudi finestra"
              title="Chiudi"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="h-full min-h-0" inert={inert}>
          {/* Screens without panes are dragged by their top edge. */}
          {!framed && windowControlsState.dragTopRegionEnabled && (
            <div className="window-drag-edge" aria-hidden />
          )}
          {children}
        </div>
      </div>
      {dock}
      <AiNotice onOpenChange={onNoticeOpenChange} />
      {/* In front of a message being written, notices come in at the top: at
          the bottom they would sit on its Invia. */}
      <Toaster
        position={inert ? 'top-center' : 'bottom-right'}
        offset={
          inert
            ? 16
            : { bottom: 16 + (dockVisible ? COMPOSE_DOCK_HEIGHT : 0), right: 16 + rightInset }
        }
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

  const { uiPreferences, uiPreferencesRef, updateUiPreferences, changeReaderZoom } =
    useUiPreferences()

  /** The messages being written: one in front at most, the others parked in the dock. */
  const [composeSessions, setComposeSessions] = useState<ComposerSession[]>([])
  const [activeComposeId, setActiveComposeId] = useState<string | null>(null)
  const [composeSummaries, setComposeSummaries] = useState<Record<string, ComposerSummary>>({})
  const composerHandlesRef = useRef(new Map<string, MailComposerHandle>())
  const composerOpen = activeComposeId !== null
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
  // The app in front. The calendar opens where it is asked to.
  const [activeApp, setActiveApp] = useState<AppId>('mail')
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
  // With the AI off there is no trace of the Segretario (vision §10.1): it is turned on from
  // Settings › Segretario, which leads to the guided setup.
  const segretarioOffered = aiOn
  // Oggi is the Segretario's: with the AI off the rail goes without it, and the first source
  // takes its place.
  const railItems = aiOn ? RAIL_ITEMS : RAIL_ITEMS.filter((item) => item.id !== 'oggi')
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
        toast.error('L’evento non è più nel calendario.')
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSegretarioOpen(false)
    }
  }, [segretarioOffered])

  // Sends that failed, oldest first. Each is offered back once no composer
  // is open, so retrying never replaces a message being written.
  const [failedSends, setFailedSends] = useState<
    ReadonlyArray<{ id: number; draft: ComposerInitialData; message: string }>
  >([])
  const failedSendIdRef = useRef(0)
  const { confirm, dialog: confirmDialog, open: confirmOpen } = useConfirmDialog()
  // The guided setup under way, as the main process keeps it; undefined until read.
  const [onboarding, setOnboarding] = useState<OnboardingState | null | undefined>(undefined)

  // A setup a quit interrupted takes the user back to its step.
  useEffect(() => {
    let current = true
    void window.segretarioApi
      .getOnboarding()
      .then((stored) => current && setOnboarding(stored))
      .catch(() => current && setOnboarding(null))

    return () => {
      current = false
    }
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  // A notice about the AI waits for an answer: the app's keys rest meanwhile.
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null)
  const [showWelcomeGate, setShowWelcomeGate] = useState(true)
  const [emptyStateIntroStep, setEmptyStateIntroStep] = useState<'logo' | 'text' | 'button'>('logo')
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

  // The failed send offered back right now, once no composer is open.
  const failedSend = composerOpen ? null : (failedSends[0] ?? null)

  // What the shell has open in front: the mail's keys and commands rest under it too.
  const shellModalOpen =
    composerOpen ||
    failedSend !== null ||
    confirmOpen ||
    noticeOpen ||
    Boolean(onboarding) ||
    settingsOpen

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
        toast.warning('Bozza non ancora in Bozze', {
          description:
            `È al sicuro su questo computer e ci andrà appena possibile. ${status.message ?? ''}`.trim()
        })
      }),
    [removeComposeSession]
  )

  // Set once the handlers below exist; the menu bar and the keyboard both
  // reach the commands through it.
  const runAppCommandRef = useRef<(commandId: string) => boolean>(() => false)

  useEffect(
    () => window.mailApi.onAppMenuCommand((command) => void runAppCommandRef.current(command)),
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
        setActiveComposeId(draftId)
        return
      }

      const stored = await window.mailApi.getStoredDraft(draftId)

      if (stored) {
        openComposer(draftToInitialData(stored.content), { status: stored.status })
      } else {
        toast.error('Bozza non più disponibile', {
          description: 'È stata inviata o scartata.'
        })
      }
    },
    [composeSessions, openComposer]
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
          subject: forwardSubject(message.subject),
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
        subject: replySubject(message.subject),
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

  // The Segretario writes a draft: it opens in a composer parked in the dock,
  // is kept and filed in Bozze like any draft, and the Segretario hears its id
  // once the first save has landed.
  useEffect(
    () =>
      window.segretarioApi.onComposeRequest(({ requestId, spec }) => {
        void (async () => {
          try {
            if (spec.draftId) {
              removeComposeSession(spec.draftId)
              await window.mailApi.discardDraft(spec.draftId).catch(() => undefined)
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
            await saved
            await window.segretarioApi.completeCompose(requestId, { draftId: id })
          } catch (error) {
            await window.segretarioApi.completeCompose(requestId, {
              error: error instanceof Error ? error.message : 'La bozza non si è aperta.'
            })
          }
        })()
      }),
    [composerDataFor, removeComposeSession]
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
          toast.error('Il messaggio non c’è più', {
            description: 'È stato spostato fuori dalla posta o eliminato.'
          })
          return
        }

        const data = await composerDataFor({ kind: 'reply', source, text })
        const id = crypto.randomUUID()

        setComposeSessions((current) => [
          ...current,
          { id, initialData: { ...data, draftId: id }, existing: false }
        ])
        setActiveComposeId(id)
        await window.segretarioApi.takeUpReply(accountId, messageKey, id)
      } catch (error) {
        toast.error('La risposta non si è aperta', {
          description: error instanceof Error ? error.message : undefined
        })
      }
    },
    [composerDataFor]
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
        await startSegretario(`Prepara un sollecito: ${commitment.text}`, {
          messages: ref ? [ref] : [],
          accountId: source.kind === 'message' ? source.accountId : null,
          folderLabel: null
        })
      } catch (error) {
        toast.error('Il sollecito non è partito', {
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
   * same checks and the same layout — and the Segretario hears how it went.
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
        setActiveComposeId(draftId)
        await resolve({
          sent: false,
          error: 'L’invio si è fermato per un controllo: la bozza è aperta per correggerla.'
        })
      }
    },
    [composerHandleFor, segretario]
  )

  const showMail = useCallback((): void => setActiveApp('mail'), [])
  const mail = useMailApp({
    accounts,
    setAccounts,
    aiOn,
    // In sight: in front, with a mailbox, past the welcome screen — its keys act on nothing else.
    active: shownApp === 'mail' && accounts.length > 0 && !showWelcomeGate,
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
    (ref: MessageRef): void => {
      setShowWelcomeGate(false)
      openMailMessage(ref)
    },
    [openMailMessage]
  )

  useEffect(() => window.mailApi.onOpenMessageFromNotification(openMessageRef), [openMessageRef])

  useEffect(() => {
    const shouldAnimateWelcome = !hasConnections || showWelcomeGate

    if (!shouldAnimateWelcome) {
      // Back to the logo, for the intro to play again whenever the welcome screen returns.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [hasConnections, showWelcomeGate])

  // The Segretario shows the user something: a message, a search, a draft.
  useEffect(
    () =>
      window.segretarioApi.onShowRequest((request) => {
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
      }),
    [
      aiOn,
      openAskedSearch,
      openCalendar,
      openCalendarEvent,
      openDraftById,
      openMessageRef,
      openProject
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
            toast.error('Il messaggio non c’è più', {
              description: 'È stato spostato fuori dalla posta o eliminato.'
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
              toast.error('Non c’è più', {
                description: 'Il messaggio o l’evento da cui veniva è stato eliminato.'
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

        setSegretarioOpen((open) => !open)
        return true
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
        if (shownApp !== 'mail' && actsOnMailShown(commandId)) {
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
        const sendingToast = toast.loading('Invio in corso…')

        try {
          await window.mailApi.sendMail({
            ...payload,
            html: await buildOutgoingMailHtml(payload.html)
          })
          toast.success('Messaggio inviato', { id: sendingToast })
          settleSegretarioSend(payload.draftId, { sent: true })

          // What the user wrote, for the Segretario to compare with a draft of its own.
          if (payload.draftId) {
            void window.segretarioApi
              .draftSent(payload.draftId, writtenText(payload.html))
              .catch(() => undefined)
          }
        } catch (caughtError) {
          toast.dismiss(sendingToast)
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
    // Signing in again to an account already here (to add its calendar) gives that account back.
    setAccounts((current) => [...current.filter((existing) => existing.id !== account.id), account])
    setSelectedAccountId(account.id)
    setShowWelcomeGate(false)
  }

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
    setShowWelcomeGate(false)
    // The day opens on what the Segretario saw in it; without it, on the first source.
    setActiveApp(aiOn ? 'oggi' : firstSourceApp)
  }, [aiOn, accounts, firstSourceApp, hasConnections, setSelectedAccountId])

  /** Starts the guided setup of a case, kept as it goes. */
  function startOnboarding(setupCase: OnboardingCase): void {
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
    setOnboarding(next)
    void window.segretarioApi.setOnboarding(next).catch((error: unknown) =>
      toast.error('La configurazione non è stata salvata', {
        description: error instanceof Error ? error.message : undefined
      })
    )
  }

  // What failed to start says so, with a way to try again, before anything else waits.
  if (!bootstrapLoading && bootstrapError) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
        onNoticeOpenChange={setNoticeOpen}
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

  // The calendars are known before the first screen: one connected is enough to go in.
  if (bootstrapLoading || onboarding === undefined || calendarConnections === null) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
        onNoticeOpenChange={setNoticeOpen}
      >
        <div className="flex h-full items-center justify-center">
          <div className="border-border bg-card/70 flex items-center gap-3 rounded-xl border px-5 py-4 text-sm">
            <LoaderCircle className="text-primary size-5 animate-spin" />
            Avvio di SIEVER Mail…
          </div>
        </div>
      </AppFrame>
    )
  }

  if (onboarding) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
        onNoticeOpenChange={setNoticeOpen}
      >
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
          onAccountCreated={onAccountCreated}
          onRemoveAccount={(accountId, calendars) => void mail.removeAccount(accountId, calendars)}
          onChange={saveOnboarding}
          onFinish={(entered) => {
            saveOnboarding(null)

            if (entered) {
              enterWorkspace()
            }
          }}
        />
        {confirmDialog}
      </AppFrame>
    )
  }

  if (!hasConnections || showWelcomeGate) {
    return (
      <AppFrame
        windowControlsState={windowControlsState}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onCloseWindow={handleCloseWindow}
        onNoticeOpenChange={setNoticeOpen}
      >
        <div className="relative mx-auto h-full w-full max-w-5xl px-6 py-12">
          <div className="flex h-full items-center justify-center">
            <div
              className={cn(
                'flex items-center justify-center transition-[gap] duration-[1800ms] ease-out',
                emptyStateIntroStep === 'logo' ? 'gap-0' : 'gap-4 lg:gap-5'
              )}
            >
              <span className="relative grid shrink-0 place-items-center">
                {/* The logo's two colours, as a glow behind it. */}
                <span
                  aria-hidden
                  className="absolute -inset-16 rounded-full"
                  style={{
                    backgroundImage:
                      'radial-gradient(closest-side, hsl(var(--ai-star) / 0.16), hsl(var(--primary) / 0.1) 55%, transparent)'
                  }}
                />
                <img
                  src={appLogo}
                  alt="Logo SIEVER Mail"
                  className="relative size-[5.5rem] select-none lg:size-[6.5rem]"
                  draggable={false}
                />
              </span>
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
                  <span className="text-muted-foreground mt-2 block font-serif text-2xl leading-tight font-normal tracking-normal whitespace-nowrap italic">
                    Il tuo lavoro, con un segretario.
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
              {hasConnections ? (
                <>
                  <Button
                    className="w-56 gap-2 rounded-lg text-sm"
                    size="lg"
                    onClick={enterWorkspace}
                  >
                    <LogIn className="size-4" />
                    Entra
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-56 gap-2 rounded-lg text-sm"
                    size="lg"
                    onClick={() => startOnboarding('nuova-connessione')}
                  >
                    <Plus className="size-4" />
                    Aggiungi una connessione
                  </Button>
                </>
              ) : (
                <Button
                  className="w-56 gap-2 rounded-lg text-sm"
                  size="lg"
                  onClick={() => startOnboarding('primo-avvio')}
                >
                  <LogIn className="size-4" />
                  Inizia
                </Button>
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

  // Another app than the mail is what the user looks at, not the selection left in the mail.
  const shownPage =
    shownApp === 'mail' ? null : (RAIL_ITEMS.find((item) => item.id === shownApp)?.label ?? null)
  const mailSight = mail.sight
  // In the calendar, what it shows: the days, and the event open.
  const calendarInSight = shownApp === 'calendar' ? calendarSight : null
  // What the user is looking at goes along with what they ask the Segretario.
  const segretarioContext: SegretarioContextChip = {
    context: {
      messages: shownPage ? [] : mailSight.messages,
      accountId: mailSight.accountId,
      folderLabel: calendarInSight?.label ?? shownPage ?? mailSight.viewLabel,
      eventKey: calendarInSight?.event?.key ?? null
    },
    label: calendarInSight
      ? calendarInSight.event
        ? `«${calendarInSight.event.title}»`
        : calendarInSight.label
      : shownPage
        ? shownPage
        : mailSight.label
  }
  const segretarioSuggestionList = segretarioSuggestions({
    selectionCount: shownPage ? 0 : mailSight.selectionCount,
    work: shownPage ? null : mailSight.work,
    messageOpen: !shownPage && mailSight.messageOpen,
    project: shownPage ? null : mailSight.project,
    calendarConnected,
    calendar: calendarInSight ? { eventOpen: calendarInSight.event !== null } : null
  })

  return (
    <CommandShortcutsProvider overrides={uiPreferences.shortcutOverrides}>
      <SegretarioLinkProvider value={openSegretarioHandle}>
        <AppFrame
          windowControlsState={windowControlsState}
          onMinimizeWindow={handleMinimizeWindow}
          onToggleMaximizeWindow={handleToggleMaximizeWindow}
          onCloseWindow={handleCloseWindow}
          onNoticeOpenChange={setNoticeOpen}
          inert={composerOpen}
          framed
          dockVisible={!composerOpen && composeSessions.length > 0}
          rightInset={assistantInset}
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
              rightInset={assistantInset}
              onRestore={setActiveComposeId}
              onClose={(id) => void composerHandlesRef.current.get(id)?.close()}
            />
          }
        >
          <WorkspaceLayout
            mode={uiPreferences.layoutMode}
            readerExpanded={mail.isMessageExpanded}
            rail={
              <AppRail
                items={railItems}
                activeItemId={shownApp}
                onSelectItem={(id) => {
                  const app = railItems.find((item) => item.id === id)

                  if (app) {
                    setActiveApp(app.id)
                  }
                }}
                syncSummary={mail.syncSummary}
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
                showTitle={!windowControlsState.dragTopRegionEnabled || windowControlsState.enabled}
                onAddAccount={() => startOnboarding('nuova-connessione')}
              />
            }
            messageList={
              <MailMessageList
                mail={mail}
                segretarioOpen={segretarioOpen}
                canWrite={segretario.status?.keyState === 'ready'}
                onRemind={remindAbout}
              />
            }
            notice={<MailNotice mail={mail} />}
            reader={
              <MailReader
                mail={mail}
                segretarioOpen={segretarioOpen}
                onRemind={(commitment) => void remindAbout(commitment)}
                onTakeUpReply={takeUpReply}
              />
            }
            app={
              shownApp === 'mail' && accounts.length === 0 ? (
                <AppPlaceholder
                  title="Posta"
                  icon={Mail}
                  atWindowTopRight={!segretarioOpen}
                  lead="Nessuna casella collegata. Le altre app funzionano anche così; con una casella, la posta arriva qui."
                  points={[
                    'Ogni casella è una connessione a sé: Gmail, Microsoft, iCloud, o qualunque altra con IMAP.',
                    ...(aiOn
                      ? [
                          'Il Segretario la legge come legge i calendari: le cose aperte, i progetti e la giornata la comprendono.'
                        ]
                      : [])
                  ]}
                  action={{
                    label: 'Collega una casella',
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
                  focus={calendarFocus?.focus}
                  onSight={setCalendarSight}
                  searchInputRef={calendarSearchRef}
                  keysEnabled={!shellModalOpen}
                  atWindowTopRight={!segretarioOpen}
                  onOpenMessage={openMessageRef}
                  onOpenConnections={() => startOnboarding('nuova-connessione')}
                />
              ) : shownApp === 'files' ? (
                <AppPlaceholder
                  title="File"
                  icon={Files}
                  badge="In arrivo"
                  atWindowTopRight={!segretarioOpen}
                  lead="I tuoi documenti, ovunque siano: il computer, i dischi di rete, i drive. Una fonte come la posta e il calendario."
                  points={[
                    'Ogni volume del computer o di rete, e ogni drive — Google Drive, OneDrive e SharePoint, Dropbox, iCloud Drive — è una connessione, come una casella o un calendario.',
                    'Una ricerca sola su tutti, e il documento si apre dov’è: niente copie, niente sincronizzazione.',
                    'Per ogni file, i progetti, le conversazioni e gli appuntamenti a cui appartiene.',
                    ...(aiOn
                      ? [
                          'Il Segretario legge già i file del computer e dei dischi di rete collegati, solo in lettura.'
                        ]
                      : [])
                  ]}
                />
              ) : shownApp === 'contacts' ? (
                <AppPlaceholder
                  title="Contatti"
                  icon={BookUser}
                  badge="In arrivo"
                  atWindowTopRight={!segretarioOpen}
                  lead="Le persone e gli enti con cui lavori, in un posto solo, con quello che il Segretario sa di ciascuno."
                  points={[
                    'Da tutte le fonti: chi ti scrive, chi incontri, le rubriche delle connessioni.',
                    'Per ognuno: le conversazioni, gli appuntamenti, i progetti in comune e le cose aperte.',
                    'Quello che il Segretario ha capito di loro, scritto da lui e corretto da te.'
                  ]}
                />
              ) : shownApp === 'projects' ? (
                <AppPlaceholder
                  title="Progetti"
                  icon={Briefcase}
                  badge="In arrivo"
                  atWindowTopRight={!segretarioOpen}
                  lead="Ogni progetto con tutto ciò che gli appartiene, da ogni fonte, nello stesso posto."
                  points={[
                    'Le conversazioni, gli appuntamenti, le cartelle e i documenti, le persone e le cose aperte del progetto, insieme.',
                    'Uno spazio di lavoro, non un altro archivio: ogni cosa resta dov’è, e un file usato da tre progetti è un file solo.',
                    'Un progetto è un contesto che dura — una pratica, un cliente, un viaggio, l’università —: il Segretario li riconosce e tu li correggi.',
                    ...(aiOn && accounts.length > 0
                      ? ['Intanto i progetti del Segretario sono nella barra laterale della Posta.']
                      : [])
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
                />
              ) : null
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
              canAskSegretario={
                aiOn &&
                (segretario.status?.keyState === 'ready' ||
                  segretario.status?.keyState === 'unchecked')
              }
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
        </AppFrame>
      </SegretarioLinkProvider>
    </CommandShortcutsProvider>
  )
}

export default App
