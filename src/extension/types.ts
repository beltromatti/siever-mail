/**
 * SIEVER Mail extension contract.
 *
 * The application reserves a single optional extension slot resolved at
 * build time by the Vite aliases `@app/extension/{main,renderer,preload,shared}`.
 * The default resolution points at the no-op stubs shipped with the
 * public source tree under `src/extension/`. A custom build can supply
 * its own implementation through those aliases (see
 * `electron.vite.config.ts` for the resolution policy gated by
 * `LOAD_EXTENSION=1`).
 *
 * The contract is intentionally generic: any extension can add toolbar
 * actions, settings tabs and an app-level primary dialog on the
 * renderer side, plus IPC handlers and custom DDL on the main side.
 * Its scope is therefore not limited to "archive" or any specific
 * business domain — it is a canonical extension surface that any future
 * customisation can plug into without ever touching the public source
 * tree.
 */
import type { App, BrowserWindow, IpcMain, IpcRenderer } from 'electron'
import type { ParsedMail } from 'mailparser'
import type { ComponentType, ReactNode } from 'react'

import type { MailFontOption } from '@shared/mail-fonts'
import type { MailMessageSummary, MessageRef } from '@shared/models'

/* ────────────────────────── both processes ────────────────────────── */

export interface TextColorOption {
  value: string
  label: string
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

/* ────────────────────────── main process ────────────────────────── */

export interface ExtensionMain {
  /** Stable identifier exposed for diagnostics (build-variant correlation). */
  readonly id: string
  /** Human-readable name shown in diagnostics. */
  readonly displayName: string
  /**
   * HTML used as the default signature for the very first account a
   * user adds. Empty in public builds; an extension can override this
   * with a corporate or template signature.
   */
  readonly defaultAccountSignatureHtml: string
  /**
   * Wire IPC handlers, run DDL, kick off any startup logic. Called once
   * after the host's mail service is ready. Idempotent across hot
   * re-installs.
   */
  install(context: ExtensionMainContext): Promise<void> | void
  /**
   * Deletes what the extension stores for the user, as part of the
   * settings' "Elimina tutti i dati" — after the host has emptied its own
   * tables, with every account still connected. Preferences may stay, the
   * way the host keeps its layout and sorting.
   */
  clearData(): Promise<void>
  /**
   * Optional teardown hook invoked when the mail service stops.
   */
  uninstall?(): Promise<void> | void
}

export interface ExtensionMainContext {
  app: App
  ipcMain: IpcMain
  userDataDirectoryPath: string
  database: ExtensionDatabaseHandle
  mailEngine: ExtensionMailEngineHandle
  getMainWindow(): BrowserWindow | null
  /**
   * Offers files the extension wrote back to the user as the newest
   * entries of the composer's "Allega" menu, labelled with what happened
   * to them (e.g. "Salvato in …"). Files that are gone by the time the
   * menu opens are left out.
   */
  recordRecentFiles(paths: ReadonlyArray<string>, activity: string): Promise<void>
}

/**
 * Minimal database surface offered to extensions. The host owns the
 * SQLite connection; extensions get a thin promise-based wrapper that
 * lets them apply DDL idempotently and run typed queries against tables
 * they manage. The host guarantees the same SQLite connection is shared,
 * so transactions are safe to mix with the rest of the application.
 */
export interface ExtensionDatabaseHandle {
  applyDdl(sql: string): Promise<void>
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<void>
}

/**
 * Minimal mail-engine surface offered to extensions. Lets the extension
 * fetch a message's raw RFC 822 source (plus a parsed envelope) and
 * dispose of the source message via the host's IMAP plumbing without
 * coupling to its internals. Extensions only depend on this contract.
 */
export interface ExtensionMailEngineHandle {
  /**
   * Raw RFC 822 source plus a parsed view of it.
   *
   * The parse deliberately leaves `cid:` references in the HTML alone rather
   * than rewriting them into inline `data:` URIs, so a consumer can tell the
   * sender's attachments apart from the images the body renders and
   * reconstruct the message faithfully. Use `partitionMessageAttachments`
   * from `@main/services/mail-engine/message-parts` to make that split.
   */
  fetchMessageRawSource(ref: MessageRef): Promise<{
    source: Buffer
    parsed: ParsedMail
    internalDate: string
  }>
  /**
   * Moves the message to the account's trash folder, optionally marking
   * it as seen first. Used by archive/cleanup flows that consume the
   * source message after persisting it elsewhere. Resolves with the IMAP
   * source/destination folder names so the caller can log or surface the
   * outcome; rejects if the engine cannot reach the account or perform
   * the move.
   */
  moveMessageToTrash(
    ref: MessageRef,
    options?: { markAsSeenBeforeMove?: boolean }
  ): Promise<{ sourceFolder: string; destinationFolder?: string }>
}

/* ────────────────────────── renderer ────────────────────────── */

export interface ExtensionRenderer {
  readonly id: string
  readonly displayName: string
  /**
   * Buttons rendered inline in the primary toolbar, immediately after
   * the built-in "Nuovo messaggio" action. Each receives the current
   * selection and a host-managed callback to trigger the primary
   * action dialog (if any).
   */
  readonly toolbarActions: ReadonlyArray<ToolbarActionDescriptor>
  /**
   * Tabs appended after the host's core tabs in the Settings dialog.
   */
  readonly settingsTabs: ReadonlyArray<SettingsTabDescriptor>
  /**
   * Optional dialog component mounted at the renderer root and driven
   * by host-managed open/close state. Toolbar actions request it via
   * `openPrimaryActionDialog()`.
   */
  readonly PrimaryActionDialog: ComponentType<PrimaryActionDialogProps> | null
  /**
   * `@font-face` rules for fonts the extension bundles, applied to the app
   * and to every message frame so they render the same on every machine.
   * Empty when it bundles none.
   */
  readonly fontFaceCss: string
  /**
   * What `clearData` deletes, as it reads in the list the settings show
   * under "Elimina tutti i dati" — e.g. "i modelli salvati". Empty when
   * nothing.
   */
  readonly localDataLabel: string
}

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
}

export interface SettingsTabDescriptor {
  id: string
  label: string
  title: string
  description: string
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
 * Host-provided helpers handed to extension renderers so they can
 * leverage the host's optimistic-UI machinery without re-implementing
 * it. Currently exposes a single primitive — the message-removal
 * wrapper — used by archive / delete / move-style flows. Future
 * additions are expected to be additive.
 */
export interface ExtensionHostHooks {
  /**
   * Wraps an IPC mutation with optimistic removal of the message from
   * the visible list. Re-inserts the message if `work()` rejects so the
   * UI stays in sync with the truth.
   */
  optimisticallyRemoveMessage<T>(
    ref: MessageRef,
    work: () => Promise<T>,
    fallbackErrorMessage: string
  ): Promise<T>
}

/* ────────────────────────── preload ────────────────────────── */

/**
 * Preload-side hook. Called by the host preload script with the local
 * `ipcRenderer`; the returned object is merged into the bridge surface
 * exposed on `window.mailApi`. Public builds return an empty object, so
 * `window.mailApi` carries only the host's own API in the public bundle.
 *
 * The return type is `object` rather than `Record<string, unknown>` on
 * purpose: an extension naturally declares its bridge as a named interface,
 * and TypeScript refuses to assign an interface to an index-signature type.
 * The host only ever spreads the result, so the wider type costs nothing.
 */
export type ExtensionPreloadInstaller = (ipcRenderer: IpcRenderer) => object
