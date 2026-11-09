import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { app, net, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'

import extensionShared from '@app/extension/shared'

import type {
  ExtensionDatabaseHandle,
  ExtensionIdentity,
  ExtensionMain,
  ExtensionMailEngineHandle,
  ExtensionMainContext
} from '@app/extension/types'
import { calendarRefusedNotice, type MessageInvitation } from '@shared/calendar'
import { handleIpc } from '@main/ipc/handle'
import { extensionChannel } from '@shared/extension-ipc'
import { IPC_CHANNELS, type AddedAccount } from '@shared/ipc'
import {
  NOTIFICATIONS_IPC,
  type BadgeShown,
  type NotificationPreferences,
  type NotificationStatus
} from '@shared/notifications'
import { setupTurnsAiOn, type OnboardingState } from '@shared/segretario'
import { normalizeExternalHttpUrl } from '@main/utils/external-url'
import {
  mailRefusedNotice,
  refusalWords,
  type ConnectionRefusedNotice,
  type MailAccount,
  type MessageRef
} from '@shared/models'

import { SegretarioService } from './ai/segretario-service'
import { updateAppMenuAi } from './app-menu'
import { getAppWindow } from './app-window'
import { CalendarNotifications } from './calendar/calendar-notifications'
import { CalendarService } from './calendar/calendar-service'
import { AppBadge } from './notifications/badge'
import { instantsOf } from './calendar/reminders'
import { NotificationCenter, notificationPreferencesSchema } from './notifications/center'
import { GOOGLE_CALENDAR_SCOPE } from './calendar/google-calendar'
import { invitationParties, occurrenceIn } from './calendar/icalendar'
import { parseInvitation } from './calendar/ics'
import type { RuntimeConfig } from './config/env'
import { AppDatabase } from './services/database'
import { finalizeUpgradeMigration } from './services/data-migration'
import { GOOGLE_MAIL_SCOPE, GoogleOAuthService } from './services/google-oauth'
import { MailService } from './services/mail-service'
import { MicrosoftOAuthService } from './services/microsoft-oauth'
import { canonicalPath, rememberMountedShares } from './services/network-volumes'
import { movedUnder } from './files/paths'
import { watchSystemSleep } from './services/system-sleep'
import { appDiagnosticState } from '@main/diagnostics/app-state'
import type { BundleFile, DiagnosticsBundleSource } from '@main/diagnostics/export'
import { diagnostics } from '@main/diagnostics/log'
import { diagnosticState, provideDiagnosticState } from '@main/diagnostics/state'

const log = diagnostics('app')
/** The icon's count is counted again at least this often: the day turns, things fall due. */
const BADGE_RECOUNT_MS = 60 * 60_000
/** Changes come in bursts — a reading, a sync —: the icon is counted again once they stop. */
const BADGE_SETTLE_MS = 800

/**
 * The root of the main process. It owns what every app shares — the
 * database, the sign-ins with Google and Microsoft — creates the sources
 * as peers — the mail, the calendars — and the Segretario over them,
 * connects them through ports, and governs their startup and their stop.
 * No source creates another, nor the Segretario.
 */
export class Workspace {
  private readonly database: AppDatabase
  private readonly googleOAuthService: GoogleOAuthService
  private readonly microsoftOAuthService: MicrosoftOAuthService
  readonly mail: MailService
  readonly calendar: CalendarService
  /** SIEVER Mail's agent (see `src/main/ai`). */
  readonly segretario: SegretarioService
  private extension: ExtensionMain | null = null
  private readonly databasePath: string
  private unwatchSleep: (() => void) | null = null
  private storageReady: Promise<void> | null = null
  /** The notifications of every app, the Segretario and the app itself (§13.3). */
  readonly notifications: NotificationCenter
  private readonly calendarNotifications: CalendarNotifications
  /** The number on the app's icon, and what it counts: the unread mail, or the day's work. */
  private readonly badge = new AppBadge(getAppWindow)
  private inboxUnread = 0
  private badgeTimer: NodeJS.Timeout | null = null
  private badgeRecount: NodeJS.Timeout | null = null
  /** Whether the Segretario reads the sources as they change: then it says what to tell. */
  private segretarioReading = false
  /** Stopping: nothing is counted or drawn on the icon any more. */
  private stopped = false

  constructor(config: RuntimeConfig) {
    const userDataPath = app.getPath('userData')
    mkdirSync(userDataPath, { recursive: true })
    this.databasePath = join(userDataPath, 'siever-mail.sqlite')
    this.database = new AppDatabase(this.databasePath)
    this.notifications = new NotificationCenter({
      window: getAppWindow,
      giveOnce: (key) => this.database.giveNotificationOnce(key),
      onStatusChange: (status) =>
        getAppWindow()?.webContents.send(NOTIFICATIONS_IPC.statusChanged, status)
    })
    this.calendarNotifications = new CalendarNotifications({
      center: this.notifications,
      events: (from, to) => this.calendar.remindable(from, to),
      preparation: (eventKey) => this.segretario.preparationLine(eventKey),
      segretarioLooking: () => this.segretarioReading,
      openExternal: (url) => {
        const safe = normalizeExternalHttpUrl(url)

        if (safe) {
          void shell.openExternal(safe)
        }
      }
    })
    this.googleOAuthService = new GoogleOAuthService(config)
    this.microsoftOAuthService = new MicrosoftOAuthService(config)
    this.mail = new MailService({
      database: this.database,
      google: this.googleOAuthService,
      microsoft: this.microsoftOAuthService,
      segretario: {
        viewKeys: (view) => this.segretario.viewKeys(view),
        activeKeys: () => this.segretario.activeKeys(),
        searchRefs: (id) => this.segretario.searchRefs(id),
        projectThreads: (projectId) => this.segretario.projectThreads(projectId)
      },
      onMailChanged: () => this.segretario.mailChanged(),
      onConnectionRefused: (notice) => this.connectionRefused(notice),
      notifications: this.notifications,
      onInboxUnreadChange: (count) => {
        this.inboxUnread = count
        this.countBadge()
      },
      // A mailbox going (§11.4): the Segretario's work that could write about it stops and
      // waits; a calendar that came with the same access stays, on its own. Once it is gone,
      // what the Segretario kept of it goes. Each waits to be open; one that could not open does
      // not keep the mailbox from going.
      onAccountRemoving: async (account) => {
        await this.segretario
          .whenReady()
          .then(() => this.segretario.connectionLeaving({ family: 'posta', id: account.id }))
          .catch((error: unknown) => log.error('The Segretario did not let go of a mailbox', error))
        await this.calendar.whenOpen().then(
          () => this.calendar.mailAccountRemoved(account.id),
          (error: unknown) => log.error('The calendar did not let go of a mailbox', error)
        )
      },
      onAccountRemoved: (account) =>
        this.segretario
          .whenReady()
          .then(() =>
            this.segretario.connectionLeft({
              family: 'posta',
              id: account.id,
              email: account.email,
              pec: account.pec === true,
              since: account.createdAt
            })
          )
          .catch((error: unknown) =>
            log.error('The Segretario could not let go of a mailbox', error)
          )
    })
    this.calendar = new CalendarService({
      database: this.database,
      oauth: this.googleOAuthService,
      microsoft: this.microsoftOAuthService,
      fetch: (input, init) => net.fetch(input, init),
      send: (channel, payload) => getAppWindow()?.webContents.send(channel, payload),
      parentWindow: () => getAppWindow(),
      onRefused: (notice) => this.connectionRefused(notice),
      onEventsChanged: () => this.calendarNotifications.eventsChanged(),
      onChangedByOthers: (calendar, changes) =>
        this.calendarNotifications.changedByOthers(calendar, changes),
      // A calendar connection going (§11.4), as a mailbox.
      onDisconnecting: (connectionId) =>
        this.segretario
          .whenReady()
          .then(() => this.segretario.connectionLeaving({ family: 'calendario', id: connectionId }))
          .catch((error: unknown) =>
            log.error('The Segretario did not let go of a calendar', error)
          ),
      onDisconnected: (connection) =>
        this.segretario
          .whenReady()
          .then(() => this.segretario.connectionLeft({ family: 'calendario', ...connection }))
          .catch((error: unknown) =>
            log.error('The Segretario could not let go of a calendar', error)
          )
    })
    this.segretario = new SegretarioService({
      database: this.database,
      mail: this.mail.segretarioPort(),
      fetch: (input, init) => net.fetch(input, init),
      send: (channel, payload) => getAppWindow()?.webContents.send(channel, payload),
      onReadingChange: (reading) => {
        this.segretarioReading = reading
        this.mail.setSegretarioReading(reading)
      },
      onEnabledChange: (on) => {
        updateAppMenuAi(on)
        this.countBadge()
      },
      onNoteWritten: (note) => this.mail.noteWritten(note),
      notifications: this.notifications,
      onWorkChanged: () => this.countBadge(),
      onSetupEnded: (setup) => this.setupEnded(setup),
      calendar: {
        alert: (eventKey, text) => this.calendarAlert(eventKey, text),
        calendars: () => this.calendar.calendars(),
        connections: () => this.calendar.listConnections(),
        events: (fromIso, toIso) => this.calendar.events(fromIso, toIso),
        search: (query) => this.calendar.search(query),
        event: (eventKey) => this.calendar.event(eventKey),
        create: (event, options) => this.calendar.create(event, options),
        update: (eventKey, change, options) => this.calendar.update(eventKey, change, options),
        remove: (eventKey, options) => this.calendar.remove(eventKey, options),
        respond: (eventKey, response, options) =>
          this.calendar.respond(eventKey, response, options),
        changesSince: (afterId, limit) => this.calendar.changesSince(afterId, limit),
        latestChangeId: () => this.calendar.latestChangeId()
      }
    })
    this.provideDiagnostics()
  }

  /**
   * What each part says of itself when the diagnostics are exported
   * (§14.4): the shell, every source, the Segretario, the extension — each
   * on its own, once it can answer.
   */
  private provideDiagnostics(): void {
    provideDiagnosticState('app', async () => ({
      ...appDiagnosticState({
        edition: extensionShared.identity?.id ?? 'public',
        databasePath: this.databasePath
      }),
      preferences: await this.openStorage().then(async () => ({
        ui: await this.database.getUiPreferences(),
        notifications: await this.database.getNotificationPreferences()
      }))
    }))
    provideDiagnosticState('mail', () => this.openStorage().then(() => this.mail.diagnosticState()))
    provideDiagnosticState('calendar', () => this.calendar.diagnosticState())
    provideDiagnosticState('segretario', () => this.segretario.diagnosticState())
    provideDiagnosticState('extension', async () => {
      const identity = extensionShared.identity

      if (!identity) {
        return null
      }

      return {
        id: identity.id,
        name: identity.name,
        installed: this.extension !== null,
        ...(await this.extension?.diagnostics?.state?.())
      }
    })
  }

  /** What an export of the diagnostics takes besides the log (§14.4). */
  diagnosticsSource(): DiagnosticsBundleSource {
    const identity = extensionShared.identity

    return {
      about: { version: app.getVersion(), edition: identity?.id ?? 'public' },
      state: () => diagnosticState(),
      segretario: (sinceMs) => this.segretario.diagnosticFiles(sinceMs),
      extension: async (sinceMs) => {
        const files = this.extension?.diagnostics?.files

        if (!identity || !files) {
          return []
        }

        try {
          return (await files(sinceMs)).map((file): BundleFile => ({
            name: `${identity.id}/${file.name}`,
            content: file.content
          }))
        } catch (error) {
          log.error("The extension's diagnostics files could not be taken", error)
          return []
        }
      }
    }
  }

  /**
   * Storage and the upgrade migration first, then the extension, then the
   * network. The migration purges the resyncable cache tables, so it has
   * to land on a reconciled schema that no IMAP sync has started writing
   * to yet; the interface's requests wait for it too. The extension's
   * tables and handlers are there before anything asks for them — the
   * Segretario's first run reads its instructions — and neither keeps the
   * other out: a mailbox that cannot connect, an extension that fails. The
   * public build has no extension (`identity` null) and installs nothing.
   */
  async start(extension: ExtensionMain): Promise<void> {
    try {
      await this.openStorage()
      this.notifications.setPreferences(await this.database.getNotificationPreferences())
      this.notifications.onPreferences(() => this.countBadge())
      const identity = extensionShared.identity

      if (identity) {
        await this.installExtension(extension, identity).then(
          () => log.info('extension.installed', { id: identity.id, name: identity.name }),
          (error: unknown) => log.error(`The extension ${identity.name} did not install`, error)
        )
      }

      await this.openSources()
    } catch (error) {
      log.error('The startup failed', error)
      // What waits for the calendar or the Segretario is told, not left waiting.
      this.calendar.abandon(error)
      this.segretario.abandon(error)
    }
  }

  /**
   * Opens the database, reconciles its schema and finishes any upgrade
   * migration on it — purging the resyncable cache, or putting the user
   * data back after a failed upgrade — without touching the network.
   *
   * Everything the interface asks for waits on this (see
   * `register-mail-ipc`): the window loads alongside, and must never read
   * rows the migration is about to purge or restore. The migration runs on
   * the host's own connection on purpose: a second handle to the same file
   * would contend on the WAL and make `VACUUM` fail with SQLITE_BUSY.
   */
  openStorage(): Promise<void> {
    this.storageReady ??= this.database.waitUntilReady().then(() =>
      finalizeUpgradeMigration({
        run: (sql, params) => this.database.runRawSql(sql, params),
        all: (sql, params) => this.database.runRawSqlQuery(sql, params)
      })
    )

    return this.storageReady
  }

  /**
   * The mail connects; the calendars and the Segretario open after it,
   * whatever it did. The computer's sleep is watched for both: a run it
   * would cut short waits for it to wake, and the calendars are read again
   * on waking.
   */
  private async openSources(): Promise<void> {
    void rememberMountedShares().catch((error: unknown) =>
      log.error('Reading the mounted network shares failed', error)
    )
    try {
      // The icon counts what the last session left, before the mail connects and changes it.
      this.inboxUnread = await this.mail.inboxUnreadCount().catch(() => 0)
      await this.mail.start()
    } finally {
      // The calendar and the Segretario open whatever the mail did, so what waits for them
      // never hangs; one failing to open leaves the others working.
      await this.calendar
        .open()
        .then(() => this.calendarNotifications.start())
        .catch((error: unknown) => log.error('The calendar did not open', error))
      this.unwatchSleep = watchSystemSleep((asleep) => {
        log.info(asleep ? 'system.sleep' : 'system.wake')

        if (!asleep) {
          // What came due while asleep, and a day that turned meanwhile.
          this.calendarNotifications.woke()
          this.countBadge()
        }

        // Awake with the window still in front: its time in front starts again (§14.4).
        if (!asleep && getAppWindow()?.isFocused()) {
          diagnostics('ui').info('window.focus')
        }

        this.segretario.setSystemAsleep(asleep)

        if (!asleep) {
          void this.calendar.syncAll()
        }
      })
      await this.segretario
        .open()
        .catch((error: unknown) => log.error('The Segretario did not open', error))
      // Whether it reads the mail as it comes, said even if it did not open: what the launch found waits for this.
      this.mail.setSegretarioReading(this.segretarioReading)
      // What waits for the user today changes with the day too: counted again every hour.
      this.countBadge()
      this.badgeTimer = setInterval(() => this.countBadge(), BADGE_RECOUNT_MS)
    }
  }

  /** Each part stops on its own: one that fails does not keep the others — the database last — running. */
  async stop(): Promise<void> {
    const step = async (what: string, work: () => unknown): Promise<void> => {
      try {
        await work()
      } catch (error) {
        log.error(`${what} did not stop`, error)
      }
    }

    this.stopped = true
    await step('The extension', () => this.extension?.uninstall?.())
    this.calendarNotifications.stop()

    for (const timer of [this.badgeTimer, this.badgeRecount]) {
      if (timer) {
        clearTimeout(timer)
      }
    }

    await step('The calendar', () => this.calendar.stop())
    this.unwatchSleep?.()
    this.unwatchSleep = null
    await step('The Segretario', () => this.segretario.stop())
    await step('The mail', () => this.mail.stop())
    this.notifications.dispose()
    await step('The database', () => this.database.close())
  }

  /* ─────────────────────────────── notifications (§13.3) ─────────────────────────────── */

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    await this.openStorage()
    return this.database.getNotificationPreferences()
  }

  /** Stores the whole record, of mailboxes still there, and puts it into effect. */
  async setNotificationPreferences(input: unknown): Promise<NotificationPreferences> {
    const payload = notificationPreferencesSchema.parse(input)
    await this.openStorage()
    const accounts = new Set((await this.database.getAccounts()).map((account) => account.id))
    const preferences: NotificationPreferences = {
      ...payload,
      mail: {
        ...payload.mail,
        mutedAccountIds: [...new Set(payload.mail.mutedAccountIds)].filter((id) => accounts.has(id))
      }
    }

    await this.database.setNotificationPreferences(preferences)
    this.notifications.setPreferences(preferences)
    return preferences
  }

  notificationStatus(): NotificationStatus {
    return this.notifications.status()
  }

  showTestNotification(): Promise<NotificationStatus> {
    return this.notifications.showTest()
  }

  openNotificationSettings(): Promise<void> {
    return this.notifications.openSystemSettings()
  }

  /** The page drew the icon's badge (Windows): it goes on the taskbar button. */
  setTaskbarBadgeImage(dataUrl: unknown, description: unknown): void {
    this.badge.setOverlayImage(
      z.string().startsWith('data:image/png;base64,').max(200_000).nullable().parse(dataUrl),
      z.string().max(200).parse(description)
    )
  }

  /** The window loaded anew: what only its page can draw is drawn again. */
  windowLoaded(): void {
    this.badge.redraw()
  }

  /**
   * The number on the app's icon (§13.3), counted again once things settle:
   * none; the unread mail of Posta in arrivo; or — with the AI — what waits
   * for the user today, the open things theirs to do, due today or before.
   */
  private countBadge(): void {
    if (this.stopped) {
      return
    }

    if (this.badgeRecount) {
      clearTimeout(this.badgeRecount)
    }

    this.badgeRecount = setTimeout(() => {
      this.badgeRecount = null
      void this.badgeCount()
        .then((badge) => !this.stopped && this.badge.set(badge))
        .catch((error: unknown) => log.failed('badge.not-counted', error))
    }, BADGE_SETTLE_MS)
  }

  private async badgeCount(): Promise<BadgeShown> {
    const unread = (count: number): BadgeShown => ({
      count,
      description: count === 1 ? '1 messaggio non letto' : `${count} messaggi non letti`
    })

    switch (this.notifications.preferences.badge) {
      case 'none':
        return { count: 0, description: '' }
      case 'unread':
        return unread(this.inboxUnread)
      case 'work': {
        // With the AI off, there is no work kept: the unread mail stands in for it.
        const due = await this.segretario.dueTodayCount().catch(() => null)
        return due === null
          ? unread(this.inboxUnread)
          : {
              count: due,
              description: due === 1 ? '1 cosa ti aspetta oggi' : `${due} cose ti aspettano oggi`
            }
      }
    }
  }

  /** The Segretario tells the user now what cannot wait about an event (§13.3). */
  private async calendarAlert(eventKey: string, text: string): Promise<'told' | 'off' | 'unknown'> {
    const kept = await this.calendar.eventAsKept(eventKey)

    if (!kept) {
      return 'unknown'
    }

    return this.calendarNotifications.segretarioAlert(
      { ...kept.event, ...instantsOf(kept.event) },
      text,
      kept.gone
    )
      ? 'told'
      : 'off'
  }

  /**
   * The first setup over: the first notification says, in context, what
   * SIEVER Mail will tell — and it is when macOS asks the user to allow
   * them, rather than hours later on the first one that counts.
   */
  private setupEnded(setup: OnboardingState): void {
    if (setup.case !== 'primo-avvio') {
      return
    }

    const aiOn = setupTurnsAiOn(setup) && this.segretarioReading
    this.notifications.notify({
      family: 'app',
      kind: 'app.introduction',
      key: 'app:introduction',
      title: 'SIEVER Mail è pronta',
      body: aiOn
        ? 'Ti avviserà qui solo di ciò che non può aspettare: la posta che conta, i tuoi appuntamenti, il Segretario quando ti serve.'
        : 'Ti avviserà qui della posta nuova e dei tuoi appuntamenti.',
      target: { kind: 'window' },
      when: 'always'
    })
  }

  /**
   * Builds the host-provided context surface and hands it to the
   * extension's `install()` hook. Called once, as soon as storage is open,
   * so the extension can run its own DDL and answer on its channels, backed
   * by the same SQLite connection; what it asks of the mail it asks later.
   */
  private async installExtension(
    extension: ExtensionMain,
    identity: ExtensionIdentity
  ): Promise<void> {
    const databaseHandle: ExtensionDatabaseHandle = {
      applyDdl: (sql) => this.database.runRawSql(sql),
      query: (sql, params) => this.database.runRawSqlQuery(sql, params),
      execute: async (sql, params) => {
        await this.database.runRawSql(sql, params)
      }
    }

    const mailEngineHandle: ExtensionMailEngineHandle = {
      fetchMessageRawSources: (refs, onMessage) =>
        this.mail.fetchMessageRawSources(refs, onMessage),
      archiveMessages: (refs) => this.mail.archiveMessages(refs)
    }

    const context: ExtensionMainContext = {
      database: databaseHandle,
      mailEngine: mailEngineHandle,
      ipc: {
        handle: (name, listener, options) =>
          handleIpc(
            `ext:${identity.id}`,
            extensionChannel(identity.id, name),
            (...args: unknown[]) => listener(...(args as never[])),
            { untimed: options?.untimed }
          ),
        send: (name, payload) =>
          getAppWindow()?.webContents.send(extensionChannel(identity.id, name), payload)
      },
      getMainWindow: getAppWindow,
      diagnostics: diagnostics(`ext:${identity.id}`),
      recordRecentFiles: (paths, activity) => this.mail.recordRecentFiles(paths, activity),
      marks: {
        // A mark is what keeps what it stands for from being done twice, and from looking undone:
        // one that cannot be kept fails what it marks. The proposals are the Segretario's, answered
        // after: a Segretario that cannot open leaves them open, and the marks stand.
        record: async (entries, options) => {
          let marked: Array<{ ref: MessageRef; messageKey: string }>

          try {
            marked = await this.mail.recordMarks(identity.id, entries)
          } catch (error) {
            log.error("An extension's marks could not be kept", error)
            throw new Error(
              `Il segno sul messaggio non si è potuto registrare. ${error instanceof Error ? error.message : String(error)}`,
              { cause: error }
            )
          }

          await this.segretario
            .whenReady()
            .then(() =>
              this.segretario.marksLeft(
                marked.map((mark, index) => ({
                  accountId: mark.ref.accountId,
                  messageKey: mark.messageKey,
                  proposals: entries[index].proposals ?? []
                })),
                options?.answers ?? null
              )
            )
            .catch((error: unknown) =>
              log.error('The proposals answered by marks could not be settled', error)
            )
        },
        // Not knowing is no answer: what is marked already would be done again.
        of: async (refs) => {
          try {
            return await this.mail.marksOfRefs(identity.id, refs)
          } catch (error) {
            log.error("An extension's marks could not be read", error)
            throw new Error(
              `I segni già lasciati sui messaggi non si possono leggere ora. ${error instanceof Error ? error.message : String(error)}`,
              { cause: error }
            )
          }
        }
      },
      // A folder the extension keeps things under moved: what the app kept under it follows — the
      // marks' places, the recent files, the projects' folders (the Segretario's, when it opens).
      relocatePaths: async (from, to) => {
        const [was, now] = await Promise.all([canonicalPath(from), canonicalPath(to)])
        const moved = movedUnder(was, now)
        const marks = await this.mail.relocateMarks(moved)
        await this.database.relocateRecentFiles(moved)
        const folders = await this.segretario
          .whenReady()
          .then(() => this.segretario.relocatePaths(was, now))
          .catch((error: unknown) => {
            log.error("The projects' folders did not follow a moved folder", error)
            return 0
          })
        return marks + folders
      },
      proposalDecided: async (id, accepted, result) => {
        try {
          await this.segretario.whenReady()
          await this.segretario.decideProposal(id, accepted, result ?? undefined)
        } catch (error) {
          log.error('A proposal decided could not be recorded', error)
        }
      }
    }

    await extension.install(context)
    this.extension = extension
  }

  /**
   * A Google account, in one consent: its mail and — when asked — its
   * calendar, two connections that came with the same access. An account
   * whose mail is here already only adds the calendar.
   */
  async addGoogleAccount(
    parentWindow: BrowserWindow | undefined,
    options: { calendar: boolean }
  ): Promise<AddedAccount> {
    if (!this.googleOAuthService.isConfigured()) {
      throw new Error('Google OAuth is not configured in this environment.')
    }

    const oauthResult = await this.googleOAuthService.authorize(parentWindow, {
      scopes: options.calendar ? [GOOGLE_MAIL_SCOPE, GOOGLE_CALENDAR_SCOPE] : [GOOGLE_MAIL_SCOPE],
      title: options.calendar ? 'Collega la posta e il calendario di Google' : 'Collega Gmail'
    })

    if (!oauthResult.scopes.includes(GOOGLE_MAIL_SCOPE)) {
      throw new Error(
        "Google non ha dato l'accesso alla posta: rifallo lasciando selezionata la casella della posta."
      )
    }

    const known = (await this.database.getAccounts()).find(
      (candidate) => candidate.email.toLowerCase() === oauthResult.email.toLowerCase()
    )
    const withCalendar = options.calendar && oauthResult.scopes.includes(GOOGLE_CALENDAR_SCOPE)

    if (known) {
      if (!withCalendar) {
        throw new Error(`La posta di ${known.email} è già collegata.`)
      }

      await this.calendar.addGoogle(oauthResult.email, oauthResult.refreshToken, oauthResult.scopes)
      return { account: known, calendarProblem: null }
    }

    const account = await this.mail.addGoogleMailbox(oauthResult)

    return {
      account,
      calendarProblem: withCalendar
        ? await this.calendarWithAccount(account, () =>
            this.calendar.addGoogle(oauthResult.email, oauthResult.refreshToken, oauthResult.scopes)
          )
        : null
    }
  }

  /**
   * The calendar that came with a mailbox's consent: a problem reading it is
   * the calendar's, not the mail's — the mailbox stays, and the user is told
   * why the calendar did not come.
   */
  private async calendarWithAccount(
    account: MailAccount,
    add: () => Promise<unknown>
  ): Promise<string | null> {
    try {
      await add()
      return null
    } catch (error) {
      log.failed('calendar.not-connected', error, { conn: account.id })
      return error instanceof Error ? error.message : 'Il calendario non si è collegato.'
    }
  }

  /**
   * A Microsoft account — Microsoft 365, Outlook.com — in one consent: its
   * mailbox over IMAP and SMTP and — when asked — its calendar over Graph.
   * An account whose mail is here already only adds the calendar.
   */
  async addMicrosoftAccount(options: { calendar: boolean }): Promise<AddedAccount> {
    if (!this.microsoftOAuthService.isConfigured()) {
      throw new Error("L'accesso con Microsoft non è attivo in questa versione di SIEVER Mail.")
    }

    // Only the scopes of what is turned on: a mailbox alone does not ask for the calendar.
    const granted = await this.microsoftOAuthService.authorize(undefined, {
      mail: true,
      calendar: options.calendar
    })
    const known = (await this.database.getAccounts()).find(
      (candidate) => candidate.email.toLowerCase() === granted.email.toLowerCase()
    )

    if (known) {
      if (!options.calendar) {
        throw new Error(`La posta di ${known.email} è già collegata.`)
      }

      await this.calendar.addMicrosoft(granted.email, granted.secret)
      return { account: known, calendarProblem: null }
    }

    const account = await this.mail.addMicrosoftMailbox(granted)

    return {
      account,
      calendarProblem: options.calendar
        ? await this.calendarWithAccount(account, () =>
            this.calendar.addMicrosoft(granted.email, granted.secret)
          )
        : null
    }
  }

  /**
   * A connection turned down for good: the user is told now — the window
   * says it, and the system too while the window is behind (§14).
   */
  private connectionRefused(notice: ConnectionRefusedNotice): void {
    // Turned down for good: it does not pass without the user (§14.1).
    log.error('connection.refused', undefined, {
      conn: notice.id,
      family: notice.family,
      refusal: notice.refusal,
      detail: notice.detail
    })
    getAppWindow()?.webContents.send(IPC_CHANNELS.connectionRefused, notice)
    // In the window its notice says it; away from it, the system does too (§14.1).
    const { title, body } = refusalWords(notice)
    this.notifications.notify({
      family: 'app',
      kind: 'app.connection-refused',
      key: `app:refused:${notice.id}`,
      title,
      body,
      target: { kind: 'connections' },
      when: 'away'
    })
  }

  /**
   * The connections turned down now — the mailboxes and the calendars — as
   * their notices: a page just loaded says what it missed, at launch above
   * all, when the first refusals come before the page listens.
   */
  async connectionRefusals(): Promise<ConnectionRefusedNotice[]> {
    const accounts = await this.database.getAccounts()
    const mail = this.mail
      .getAccountConnectionStates()
      .flatMap((state): ConnectionRefusedNotice[] => {
        const account = accounts.find((candidate) => candidate.id === state.accountId)
        return account && state.refused
          ? [mailRefusedNotice(account, state.refused, state.errorMessage ?? '')]
          : []
      })
    const calendars = (await this.calendar.listConnections()).flatMap(
      (connection): ConnectionRefusedNotice[] =>
        connection.refused ? [calendarRefusedNotice(connection, connection.refused)] : []
    )
    return [...mail, ...calendars]
  }

  /**
   * A mailbox stopped for good, put right by the user: its password given
   * again, or the provider's sign-in done again on the same account — the
   * same one, or it is refused — or, for a server's certificate, tried again.
   */
  async reconnectMailAccount(accountId: string, password?: string): Promise<void> {
    const account = (await this.database.getAccounts()).find(
      (candidate) => candidate.id === accountId
    )

    if (!account) {
      throw new Error('Questa casella non è più collegata.')
    }

    const sameAccount = (email: string): void => {
      if (email.toLowerCase() !== account.email.toLowerCase()) {
        throw new Error(
          `Hai fatto l'accesso con ${email}, non con ${account.email}: rifallo con ${account.email}.`
        )
      }
    }

    // A certificate is put right on the server: tried again as it is, whatever it signs in with.
    if (password !== undefined) {
      await this.mail.replacePassword(accountId, password)
    } else if (
      account.authType === 'password' ||
      this.mail.accountRefusal(accountId) === 'certificato'
    ) {
      await this.mail.retryAccount(accountId)
    } else if (account.type === 'gmail') {
      const granted = await this.googleOAuthService.authorize(getAppWindow() ?? undefined, {
        scopes: [GOOGLE_MAIL_SCOPE],
        loginHint: account.email,
        title: `Ricollega ${account.email}`
      })
      sameAccount(granted.email)
      await this.mail.replaceAuthorization(accountId, granted.refreshToken)
    } else {
      const granted = await this.microsoftOAuthService.authorize(account.email, {
        mail: true,
        calendar: false
      })
      sameAccount(granted.email)
      await this.mail.replaceAuthorization(accountId, granted.secret)
    }
  }

  /** Stops waiting for a sign-in left in the browser. */
  cancelSignIn(): void {
    this.microsoftOAuthService.cancelSignIn()
  }

  /**
   * "Elimina tutti i dati": what every app keeps goes — the Segretario's,
   * the mail's, the calendars', the extension's — with the mail's
   * connections stopped meanwhile. The accounts, the calendar connections
   * and the preferences stay. Every app is open first, or nothing goes: a
   * clear that could not reach one would be done by half. The Segretario
   * goes first, so no run reads the mail while it is wiped.
   */
  async clearAllDataKeepAccounts(): Promise<void> {
    await Promise.all([this.segretario.whenReady(), this.calendar.whenOpen()])
    await this.segretario.clearData()
    await this.mail.whileDisconnected(async () => {
      await this.mail.clearData()
      await this.calendar.clearData()
      await this.extension?.clearData()
    })
  }

  /** The calendar invitation a message carries, with its event in any connected calendar. */
  async calendarInvitation(ref: MessageRef): Promise<MessageInvitation | null> {
    const text = await this.mail.invitationText(ref)
    const invitation = text ? parseInvitation(text) : null

    if (!text || !invitation) {
      return null
    }

    const connected = (await this.calendar.listConnections()).length > 0
    // The occurrence the invitation is about (its RECURRENCE-ID), not the series' next one.
    const event = connected
      ? await this.calendar.eventByUid(invitation.uid, ref.accountId, invitation.instance)
      : null
    const { organizer } = invitationParties(text)
    const said = occurrenceIn(text, null, [])
    const own = new Set(
      (await this.database.getAccounts()).map((account) => account.email.toLowerCase())
    )

    return {
      method: invitation.method,
      summary: invitation.summary,
      event,
      calendarConnected: connected,
      organizer,
      when: said
        ? { start: said.start, end: said.end, allDay: said.allDay, location: said.location }
        : null,
      answerByMail:
        !event && invitation.method === 'REQUEST' && organizer !== null && !own.has(organizer),
      series: invitation.series
    }
  }
}
