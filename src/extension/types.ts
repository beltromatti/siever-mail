/**
 * The extension contract.
 *
 * SIEVER Mail is for everyone, and works on its own. An extension makes it
 * the edition of one organisation — a company, a practice, a professional —
 * without changing what the app is: it tells the Segretario how that
 * organisation works, gives it tools of its own, adds actions to the
 * interface, and keeps its own data. One extension per build, chosen at
 * build time: the Vite aliases `@app/extension/{main,renderer,preload,shared}`
 * point at the checkout in `extension/` when `LOAD_EXTENSION=1`, and at the
 * no-op stubs in this folder otherwise (`electron.vite.config.ts`).
 *
 * An extension is named after the legal name of the entity it is for, and
 * its id is that name in lower case with dashes ("Acme S.r.l." is
 * `acme-srl`). The id keeps its things apart from the host's and from any
 * other extension's: its IPC channels carry it, and its tables start with it
 * (`acme_srl_…`).
 *
 * The surface is this file and the kit (`kit/main.ts`, `kit/renderer.ts`,
 * plus the interface's components in `@renderer/components/ui/*`, and the
 * shared model in `@shared/*`): nothing else of the host is for extensions,
 * and the lint says so. A need the surface does not meet is met by widening
 * it here, generically, never by reaching into the host.
 */
import type { BrowserWindow } from 'electron'
import type { ParsedMail } from 'mailparser'
import type { ComponentType, ReactNode } from 'react'

import type { DiagnosticFields } from '@shared/diagnostics'
import type { Language, Localized } from '@shared/i18n'
import type { MailFontOption } from '@shared/mail-fonts'
import type { MarkedBefore } from '@shared/message-marks'
import type { MailMessageSummary, MessageRef, MessagesActionResult } from '@shared/models'

/* ────────────────────────── both processes ────────────────────────── */

/** Who the build is for: shown in Settings › Estensione, and the key of what it keeps. */
export interface ExtensionIdentity {
  /** The legal name in lower case with dashes: `acme-srl`. */
  id: string
  /** The legal name of the entity: "Acme S.r.l.". */
  name: string
  /** What it adds to SIEVER Mail, in a sentence or two, for the user: one string, or one per language. */
  description: Localized
}

export interface TextColorOption {
  value: string
  /** Its name: one string, or one per language (vision §13.5). */
  label: Localized
}

/**
 * How mail is written in a build: the fonts offered and started in, and the
 * text colours offered. Resolved through `@app/extension/shared`, which both
 * processes load — the renderer draws the editor, the main process upgrades
 * stored signatures to full font stacks.
 */
export interface ExtensionComposition {
  /** Offered before the host's fonts; each value a full cross-platform stack. */
  fonts: ReadonlyArray<MailFontOption>
  /** The stack new text starts in. The host's own default when omitted. */
  defaultFontFamily?: string
  /** Offered before the host's colours in the text colour menu. */
  textColors: ReadonlyArray<TextColorOption>
  /**
   * Further stacks the extension's own content uses — a wordmark face in a
   * default signature, say — so stored HTML that names only their first
   * family is upgraded to the whole chain, like any font in the menu.
   */
  extraFontStacks: ReadonlyArray<string>
}

/**
 * A command the extension adds, with the chord it answers to by default.
 * It acts on the main window's selection; the user can change its chord in
 * Settings › Scorciatoie like any of the host's, and on macOS it is listed
 * in the menu bar. The renderer side runs it (`ExtensionRenderer.runCommand`).
 */
export interface ExtensionCommandDefinition {
  /** Namespaced by the extension's id, e.g. `acme-srl.publish`, so it never collides with the host's. */
  id: string
  /** One string, or one per language (vision §13.5). */
  label: Localized
  description: Localized
  /** Platform-neutral chord, `Mod` being ⌘ on macOS and Ctrl elsewhere. */
  defaultChord: string
}

/** What both processes load from `@app/extension/shared`. */
export interface ExtensionShared {
  /** Who the build is for; null in the public build, which has no extension. */
  identity: ExtensionIdentity | null
  /**
   * The language a first start opens in for the organisation, before the
   * guided setup asks (vision §13.5); English when not given.
   */
  defaultLanguage?: Language
  composition: ExtensionComposition
  commands: ReadonlyArray<ExtensionCommandDefinition>
}

/* ────────────────────────── main process ────────────────────────── */

export interface ExtensionMain {
  /**
   * HTML used as the default signature for the very first account a
   * user adds. Empty in public builds; an extension can override this
   * with a corporate or template signature.
   */
  readonly defaultAccountSignatureHtml: string
  /**
   * HTML used as the default letterhead of that same first account: what
   * heads every message written from it, above the lines the user writes
   * on (vision §6.6). Empty, or left out, for none.
   */
  readonly defaultAccountHeaderHtml?: string
  /**
   * Brings up to date a mailbox's letterhead and signature that the
   * extension set itself in an earlier shape — a letterhead kept inside
   * the signature, before there were two. Called as they are read; null
   * (or the same) when there is nothing to change. Whatever the user wrote
   * that is not the extension's own must come back untouched.
   */
  upgradeAccountSignature?(stored: {
    html: string
    headerHtml: string
  }): { html: string; headerHtml: string } | null
  /**
   * Its tables, its channels, its startup work. Called once at startup, as
   * soon as the database is open and before the sources connect, so they
   * are there before anything asks for them.
   */
  install(context: ExtensionMainContext): Promise<void> | void
  /**
   * Deletes what the extension stores for the user, as part of the
   * settings' "Elimina tutti i dati" — after the host has emptied its own
   * tables, while the mail's connections are stopped. Preferences may stay,
   * the way the host keeps its layout and sorting.
   */
  clearData(): Promise<void>
  /**
   * Optional teardown hook invoked when the app stops, before the host's
   * own pieces do.
   */
  uninstall?(): Promise<void> | void
  /**
   * What the extension adds to the Segretario, SIEVER Mail's agent: what
   * it must know of the organisation the build is for, in the words of the
   * host's own prompts (Italian, written as text). Absent in public builds.
   */
  readonly assistant?: ExtensionAssistant
  /**
   * What the extension adds to an export of the diagnostics (vision
   * §14.4), beside what it writes through `context.diagnostics`: its state
   * — under its id in the export's `stato.json` — and files of its own,
   * under `estensione/`. Never a secret.
   */
  readonly diagnostics?: ExtensionDiagnosticsExport
}

export interface ExtensionDiagnosticsExport {
  /** How the extension stands now: its settings, what it holds. */
  state?(): Promise<Record<string, unknown>> | Record<string, unknown>
  /** Files to add, from a moment on (epoch ms): text as it is, anything else as JSON. */
  files?(sinceMs: number): Promise<ReadonlyArray<{ name: string; content: unknown }>>
}

/**
 * Where the extension writes what happens in it (vision §14.4): the same
 * log as the app's, under its area (`ext:<id>`), each event a short name
 * (`archive.saved`) with its fields. `by`, `run`, `conn`, `ms` tie it to
 * the rest: who did it, the Segretario's run, the connection, how long.
 */
export interface ExtensionDiagnostics {
  info(ev: string, fields?: DiagnosticFields): void
  warn(ev: string, fields?: DiagnosticFields): void
  error(ev: string, error?: unknown, fields?: DiagnosticFields): void
}

export interface ExtensionAssistant {
  /**
   * What the Segretario must know of the organisation the build is for —
   * how its work and its projects are organised and named, where it keeps
   * its documents — in Italian, in the words of the host's prompts. Joined
   * to the Segretario's identity in every run, so it is read when a run
   * starts: it may say what the user configured (a folder). These are the
   * organisation's real conventions, where the host's prompts only give
   * examples. Never the projects themselves: the Segretario finds those, as
   * in the public build.
   */
  instructions?(): Promise<string>
  /**
   * Tools the extension gives the Segretario, after the host's: what only
   * it can do — file a message into the organisation's archive, say. Each
   * says, in its description, in Italian, what it does and how it is called.
   */
  readonly tools?: ReadonlyArray<ExtensionAssistantTool>
}

export interface ExtensionAssistantTool {
  /** Its name for the model: lower case, words joined by `_`. */
  readonly name: string
  readonly description: string
  /** JSON Schema of its arguments. */
  readonly parameters: Record<string, unknown>
  /**
   * The line the user sees while it runs, from its arguments: in the
   * interface's language of the moment (`messages` of the kit), as every
   * word below the user reads — where `description` and what the model
   * reads stay in Italian.
   */
  running(args: Record<string, unknown>): string
  /**
   * Whether this call only reads — looks, without writing anything: it then
   * runs together with the other reads of the same step. Without it, it
   * runs on its own, in order.
   */
  readsOnly?(args: Record<string, unknown>): boolean
  execute(
    args: Record<string, unknown>,
    context: ExtensionToolContext
  ): Promise<ExtensionToolResult>
}

/** A message as an extension's tool knows it: where it is, what it is, who wrote it. */
export interface ExtensionMessage {
  ref: MessageRef
  /** Its stable key in its account (see `message-identity.ts`). */
  messageKey: string
  threadId: string
  subject: string
  dateIso: string
  /** Who wrote it, lower case. */
  fromAddress: string | null
}

export interface ExtensionToolContext {
  /** The message a short name the model wrote (`m4`) stands for; null when it names none. */
  message(handle: string): Promise<ExtensionMessage | null>
  /**
   * The Segretario is working on its own, nobody at the screen: it may
   * look and propose, never act on what others share — `confirm` is not
   * there to ask; `propose` is.
   */
  background: boolean
  /**
   * Asks the user, on the Segretario's card, before it is done: what will
   * happen, a line each, and the word on the button, in the interface's
   * language. Resolves with the answer; always false in the background.
   */
  confirm(request: { title: string; details: string[]; confirmLabel: string }): Promise<boolean>
  /**
   * Leaves the user a proposal on a message: one click away, in the
   * reader and in Oggi, and the extension's own to carry out (see
   * `ExtensionRenderer.proposalActions`). Proposing again on the same
   * message and kind updates it. Its `title` is kept as written: in the
   * interface's language of that moment.
   */
  propose(input: {
    kind: string
    title: string
    payload: Record<string, unknown>
    message: ExtensionMessage
  }): Promise<void>
  /** The marks this extension left lately, the newest first, with their messages: the user's habits. */
  recentMarks(limit: number): Promise<
    ReadonlyArray<{
      label: string
      place: string | null
      subject: string
      fromAddress: string | null
      markedAt: number
    }>
  >
  signal: AbortSignal
}

export interface ExtensionToolResult {
  /** What the model reads. */
  content: string
  /** The line the user sees, in the interface's language: "Archived 3 messages". */
  summary: string
  /** It did not do what was asked: the content says why, the line shows it. */
  failed?: boolean
}

/**
 * The extension's own channels between its main and renderer sides. Names
 * are its own: the host keeps them apart, under the extension's id, from
 * its channels and from any other's.
 */
export interface ExtensionMainIpc {
  /**
   * Answers `invoke(name, …args)` from the renderer side; a throw rejects it
   * with the message. `untimed`: its time is the user's — a dialog it opens
   * — and is never written down as slow (vision §14.4).
   */
  handle(
    name: string,
    listener: (...args: never[]) => unknown,
    options?: { untimed?: boolean }
  ): void
  /** Tells the main window's renderer side, which listens with `on(name, …)`. */
  send(name: string, payload: unknown): void
}

export interface ExtensionMainContext {
  database: ExtensionDatabaseHandle
  mailEngine: ExtensionMailEngineHandle
  ipc: ExtensionMainIpc
  /** The window dialogs belong to; null while there is none. */
  getMainWindow(): BrowserWindow | null
  /** Where it writes what happens in it: the app's diagnostics, under its own area. */
  diagnostics: ExtensionDiagnostics
  /**
   * Offers files the extension wrote back to the user as the newest
   * entries of the composer's "Allega" menu, labelled with what happened
   * to them (e.g. "Salvato in …"). Files that are gone by the time the
   * menu opens are left out.
   */
  recordRecentFiles(paths: ReadonlyArray<string>, activity: string): Promise<void>
  marks: ExtensionMarks
  /**
   * A folder the extension keeps things under moved — its root, to where
   * the user says it is now: what the app keeps under the old place (its
   * marks' places, projects' folders, recent files) is kept under the new
   * one, and the Segretario learns of it, to put its memory right.
   * Resolves with how many were kept anew.
   */
  relocatePaths(from: string, to: string): Promise<number>
  /**
   * What the user did with one of the extension's proposals: accepted,
   * with what they changed (to learn from), or set aside.
   */
  proposalDecided(
    id: string,
    accepted: boolean,
    result: Record<string, unknown> | null
  ): Promise<void>
}

/**
 * The marks the extension leaves on messages (`MessageMark`): facts of
 * what it did with them outside the mail — "Archiviato in Acme",
 * "Protocollato" —, kept by the app with the mail. They follow each message
 * wherever it goes, show on its row and in the reader, with the AI off too,
 * and the Segretario reads them with the message.
 */
export interface ExtensionMarks {
  /**
   * Marks messages still where `ref` says: what the mark says (`label`),
   * where what it stands for is (`place`, a folder) and the files written
   * there. One per message and place: marking again is the same mark, as it
   * says now — `label` is kept as written, in the interface's language of
   * that moment. Rejects when the marks could not be kept — what they stand for
   * is then not done. `proposals`: the extension's proposals the user
   * followed for that message, with what they chose, accepted once it is
   * marked; `answers`: the kind of proposal the marks answer — those still
   * open on the messages are set aside.
   */
  record(
    entries: ReadonlyArray<{
      ref: MessageRef
      label: string
      place?: string
      files?: string[]
      proposals?: ReadonlyArray<{ id: string; result: Record<string, unknown> }>
    }>,
    options?: { answers?: string }
  ): Promise<void>
  /**
   * The marks the extension left on these messages, each by its `ref` as
   * given. Rejects rather than know none: a mark not known would be left
   * again.
   */
  of(refs: ReadonlyArray<MessageRef>): Promise<
    Array<{
      ref: MessageRef
      label: string
      place: string | null
      files: string[]
      markedAt: number
    }>
  >
}

/**
 * The database, shared with the host: the extension creates and reads its
 * own tables, named after its id (`acme_srl_…`), idempotently — `CREATE …
 * IF NOT EXISTS`, columns added as they come. The host keeps them across
 * updates and failed updates like its own.
 */
export interface ExtensionDatabaseHandle {
  applyDdl(sql: string): Promise<void>
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<void>
}

/**
 * Minimal mail-engine surface offered to extensions: the raw messages, for
 * what an extension does with them outside the mail, and archiving them
 * after, as the provider means it. The extension depends on this contract only, never on the engine itself.
 */
export interface ExtensionMailEngineHandle {
  /**
   * The raw RFC 822 source of each message of `refs`, with a parsed view
   * of it, handed to `onMessage` as it arrives: a few messages download at
   * a time, in one command, while the ones before are handled. Resolves
   * with the messages no longer on their server and those not read — a
   * folder or an account that failed, each on its own while the others go
   * on. A rejection of `onMessage` stops the rest of its folder, so it
   * should settle each message itself.
   *
   * The parse leaves `cid:` references in the HTML alone rather than
   * rewriting them into `data:` URIs, so the sender's attachments can be
   * told apart from the images the body renders (`partitionMessageAttachments`,
   * in the kit).
   */
  fetchMessageRawSources(
    refs: ReadonlyArray<MessageRef>,
    onMessage: (
      ref: MessageRef,
      message: { source: Buffer; parsed: ParsedMail; internalDate: string }
    ) => Promise<void>
  ): Promise<{
    /** No longer on the server. */
    missing: MessageRef[]
    /** Not read: their account or folder failed — each folder on its own, the others go on. */
    unread: Array<{ ref: MessageRef; message: string }>
  }>
  /**
   * Archives messages as their provider means it, by what they are rather
   * than where they are shown: on Gmail they leave the inbox (their labels
   * stay), elsewhere they go to the archive folder. A message archived
   * already is no failure. Resolves with the ones that could not be archived.
   */
  archiveMessages(refs: ReadonlyArray<MessageRef>): Promise<MessagesActionResult>
}

/* ────────────────────────── renderer ────────────────────────── */

export interface ExtensionRenderer {
  /**
   * Buttons rendered in the reading pane's header, before the host's own
   * reply actions. Each receives the current selection and a host-managed
   * callback to trigger the primary action dialog (if any).
   */
  readonly toolbarActions: ReadonlyArray<ToolbarActionDescriptor>
  /**
   * Tabs appended after the host's core tabs in the Settings dialog.
   */
  readonly settingsTabs: ReadonlyArray<SettingsTabDescriptor>
  /**
   * Optional dialog the mail app mounts, driven by host-managed open/close
   * state: toolbar actions and commands open it on the mail's selection
   * (`openPrimaryActionDialog()`).
   */
  readonly PrimaryActionDialog: ComponentType<PrimaryActionDialogProps> | null
  /**
   * `@font-face` rules for fonts the extension bundles, applied to the app
   * and to every message frame so they render the same on every machine.
   * Empty when it bundles none.
   */
  readonly fontFaceCss: string
  /**
   * What the extension keeps in SIEVER Mail, as Impostazioni › Dati names it
   * beside its tables' size and in what "Elimina tutti i dati" takes
   * (`clearData`) — e.g. "i modelli salvati". Only that: what it wrote out of
   * the app (an archive on a share) is not SIEVER Mail's, and stays where it
   * is. Empty when nothing. One string, or one per language (vision §13.5).
   */
  readonly localDataLabel: Localized
  /**
   * Runs one of the commands the extension declares in
   * `ExtensionShared.commands`, when its chord is pressed or it is chosen
   * from the menu bar. Returns whether it did anything, so a chord that
   * did nothing is left to whatever else wants the key. Absent when the
   * extension declares no commands.
   */
  runCommand?(commandId: string, context: ExtensionCommandContext): boolean
  /**
   * The Segretario's proposals the extension acts on, by kind (the one it
   * gave `propose`): what the button on the proposal says — one string, or
   * one per language —, and the command it runs on the message the proposal
   * is for — whose dialog fills itself in from `selection.proposals`.
   */
  readonly proposalActions?: Readonly<Record<string, { label: Localized; commandId: string }>>
  /** The icon of each of its tools (`ExtensionAssistant.tools`) where the Segretario's work is shown, by name. */
  readonly toolIcons?: Readonly<Record<string, ComponentType<{ className?: string }>>>
}

/** What an extension command acts on: the same as a toolbar action. */
export type ExtensionCommandContext = ToolbarActionRenderProps

export interface ToolbarActionDescriptor {
  id: string
  render(props: ToolbarActionRenderProps): ReactNode
}

export interface ToolbarActionRenderProps {
  selection: ExtensionSelectionContext
  /** Triggers the extension's PrimaryActionDialog. No-op if none is provided. */
  openPrimaryActionDialog(): void
  /** Host-side helper that wraps mutations with optimistic UI removal. */
  hostHooks: ExtensionHostHooks
}

export interface ExtensionSelectionContext {
  /** Refs the toolbar action should operate on. */
  refs: ReadonlyArray<MessageRef>
  /** Resolved summaries for each ref (subjects, dates, etc. — for UI hints). */
  summaries: ReadonlyArray<MailMessageSummary>
  /** Whether multi-select mode is currently active. */
  multiSelectActive: boolean
  /**
   * Where the extension last marked, with a place, an earlier message of
   * the selected conversations — or, for a new conversation, one from the
   * same sender, which `from` says. Null without one.
   */
  markedBefore: MarkedBefore | null
  /**
   * The folders linked to the projects the selected conversations are in —
   * where their work is kept, as the Segretario or the user linked them.
   * Empty without, and with the AI off.
   */
  projectFolders: ReadonlyArray<string>
  /**
   * The Segretario's proposals open on the selected messages, every kind:
   * the extension takes its own (one it made with `propose`) to fill its
   * dialog in. Empty with the AI off.
   */
  proposals: ReadonlyArray<ExtensionProposal>
}

/** A proposal of the Segretario's on a message, as the extension's dialog reads it. */
export interface ExtensionProposal {
  id: string
  kind: string
  payload: Record<string, unknown>
  messageKey: string | null
}

export interface SettingsTabDescriptor {
  id: string
  /** Its words: each one string, or one per language (vision §13.5). */
  label: Localized
  title: Localized
  description: Localized
  /** Its icon in the list of sections; a generic one without. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>
  render(props: SettingsTabRenderProps): ReactNode
}

export interface SettingsTabRenderProps {
  /** Whether this tab is the currently active one. */
  active: boolean
  /** Whether the parent settings dialog is currently open. */
  open: boolean
}

export interface PrimaryActionDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  selection: ExtensionSelectionContext
  hostHooks: ExtensionHostHooks
}

/**
 * Host-provided helpers handed to extension renderers so they can lean on
 * the host's optimistic-UI machinery instead of re-implementing it.
 */
export interface ExtensionHostHooks {
  /**
   * Takes `refs` out of the visible list at once and runs `action` on
   * them: the ones it reports failed come back where they were, and its
   * error is shown — as the host's own Archivia and Elimina do; those it
   * reports `kept` come back too, done.
   */
  optimisticallyRemoveMessages(
    refs: ReadonlyArray<MessageRef>,
    action: (refs: MessageRef[]) => Promise<MessagesActionResult>,
    fallbackErrorMessage: string
  ): Promise<void>
}

/* ────────────────────────── preload ────────────────────────── */

/** The renderer side of the extension's own channels (`ExtensionMainIpc`). */
export interface ExtensionRendererIpc {
  /** Asks the main side's `handle(name, …)`; rejects with its message when it throws. */
  invoke<T>(name: string, ...args: unknown[]): Promise<T>
  /** Listens to the main side's `send(name, …)`; returns how to stop. */
  on<T>(name: string, listener: (payload: T) => void): () => void
}

/**
 * Builds the extension's bridge in the preload, over its own channels: the
 * object the renderer reads as `window.extensionApi`, apart from the host's
 * APIs. The public build has none.
 */
export type ExtensionPreloadInstaller = (ipc: ExtensionRendererIpc) => object
