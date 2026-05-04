/**
 * SIEVER Mail extension contract.
 *
 * The application reserves a single optional extension slot resolved at
 * build time by the Vite aliases `@app/extension/{main,renderer,preload}`.
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

import type { MailMessageSummary, MessageRef } from '@shared/models'

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
   * Default signature mirrored on the renderer side so the composer can
   * surface it without round-tripping to the main process.
   */
  readonly defaultAccountSignatureHtml: string
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
 */
export type ExtensionPreloadInstaller = (ipcRenderer: IpcRenderer) => Record<string, unknown>
