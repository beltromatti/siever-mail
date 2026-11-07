/**
 * The two arrangements the workspace can wear, plus the expanded reading
 * mode both share.
 *
 * All three are fed identical props and use the same components — the folder
 * tree, the toolbar, the reading pane. Only the geometry differs, and which
 * list shell fills the message slot:
 *
 *   apple   — folders / list / reading pane side by side.
 *   outlook — folders on the left, a dense table on top and the reading pane
 *             underneath it.
 *
 * Every dimension here is a `clamp()` rather than a fixed size or a bare
 * percentage. A fixed size wastes a 27" display and breaks a 13" one; a bare
 * percentage lets the message list grow to 700px of whitespace on a wide
 * screen while the message itself stays cramped. The clamps below express
 * the actual intent — "roughly this share of the width, never below what the
 * pane needs to work, never past the point where more is wasted" — so the
 * layout stays right from the 1180×700 minimum up to 4K without a single
 * breakpoint.
 *
 * In the two layouts those clamps are where the message list and the
 * reading pane start: the divider between them can be dragged
 * (`ResizableSplit`) within the minimums below, and snaps back onto the
 * default. A dragged size is not kept: a new layout, expanded reading, or
 * the next launch start from the default again. Expanded reading keeps its
 * fixed strip.
 */
import { isValidElement, type ReactNode } from 'react'

import { ASSISTANT_WIDTH } from './assistant-width'

import { ErrorBoundary } from '@renderer/components/error-boundary'
import { ResizableSplit } from '@renderer/components/ui/resizable-split'
import {
  MESSAGE_TABLE_MAX_SPLIT_SHARE,
  MESSAGE_TABLE_MAX_VISIBLE_ROWS,
  MESSAGE_TABLE_MIN_VISIBLE_ROWS,
  messageTablePaneHeight
} from '@renderer/features/mail/message-list-metrics'

/**
 * Folder column. Wide enough for the longest real folder names with their
 * unread counts, and it stops growing early — a folder tree gains nothing
 * from extra width.
 */
const SIDEBAR_WIDTH = 'clamp(204px, 15%, 248px)'

/**
 * Message list beside the reading pane. The list is a scanning column, the
 * message is the thing being read, so the message gets the larger share. The lower bound
 * is what a three-line row needs before sender and subject start colliding;
 * the upper bound is where a wider list stops adding information.
 */
const APPLE_LIST_WIDTH = 'clamp(300px, 29%, 420px)'

/**
 * Same column in expanded reading, where the list is a navigation strip
 * rather than the main surface, so it gives up more room to the message.
 */
const EXPANDED_LIST_WIDTH = 'clamp(260px, 22%, 360px)'

/**
 * How far the divider gives: the list keeps its sender, date and the start
 * of the subject; the message keeps its header actions on one or two lines
 * and room to read.
 */
const LIST_MIN_WIDTH = 240
const READER_MIN_WIDTH = 420
const READER_MIN_HEIGHT = 200
const RESIZE_LABEL = "Ridimensiona l'elenco e il messaggio"

/**
 * Height of the dense table above the reading pane, expressed in rows
 * rather than pixels: never fewer than triage needs at a glance, never
 * more than is useful, and a proportional target in between. Everything
 * left over goes to the message — which is the point of the whole change.
 *
 * The outer `min()` is the safety valve. On a short window the row floor
 * would otherwise win and leave the reading pane with nothing but its own
 * header, so the table gives up rows instead of starving the message.
 */
const OUTLOOK_TABLE_HEIGHT = `min(clamp(${messageTablePaneHeight(
  MESSAGE_TABLE_MIN_VISIBLE_ROWS
)}px, 48%, ${messageTablePaneHeight(
  MESSAGE_TABLE_MAX_VISIBLE_ROWS
)}px), ${MESSAGE_TABLE_MAX_SPLIT_SHARE})`

/** Rows the table keeps when the divider is dragged up as far as it goes. */
const MESSAGE_TABLE_MIN_DRAGGED_ROWS = 3

export interface WorkspaceLayoutProps {
  mode: 'apple' | 'outlook'
  /** The column on the window's edge: the app's places, sync, Settings. */
  rail: ReactNode
  /** Account, "Scrivi" and the folders. */
  sidebar: ReactNode
  messageList: ReactNode
  reader: ReactNode
  /** The message the reader shows: another one draws afresh, after a broken one. */
  readerKey: string | null
  /** Error banner, rendered above the reader when present. */
  notice: ReactNode
  /** The Segretario's panel, on the right edge when it is open. */
  assistant: ReactNode
  /**
   * Another app in the place of the mail — Oggi, the Calendario, the ones
   * to come — with its own columns: only the rail and the Segretario's
   * panel stay.
   */
  app?: ReactNode
  /**
   * Reading pane takes the whole workspace: the folder tree steps aside and
   * the message list moves into the side column.
   */
  readerExpanded: boolean
}

/**
 * The panes lie edge to edge on the desk, a hairline between each, the way
 * a mail client a professional lives in is drawn — not as cards floating on
 * a grey canvas, which spends a gutter of every side on nothing.
 */
export function WorkspaceLayout({
  mode,
  rail,
  sidebar,
  messageList,
  reader,
  readerKey,
  notice,
  assistant,
  app,
  readerExpanded
}: WorkspaceLayoutProps): React.JSX.Element {
  const assistantTrack = assistant ? ` ${ASSISTANT_WIDTH}` : ''
  // Each pane breaks on its own: the others stay, and the user goes on (§13ter.3).
  const sidebarPane = <ErrorBoundary>{sidebar}</ErrorBoundary>
  const listPane = <ErrorBoundary>{messageList}</ErrorBoundary>
  const readerPane = <ErrorBoundary resetKey={readerKey}>{reader}</ErrorBoundary>
  const assistantPane = assistant && (
    <div className="min-h-0 min-w-0">
      <ErrorBoundary className="border-l">{assistant}</ErrorBoundary>
    </div>
  )

  if (app) {
    return (
      <div
        className="grid h-full min-h-0"
        style={{ gridTemplateColumns: `auto minmax(0, 1fr)${assistantTrack}` }}
      >
        {rail}
        <div className="flex min-h-0 min-w-0 flex-col">
          {notice}
          <div className="min-h-0 flex-1">
            {/* Another app in its place draws afresh. */}
            <ErrorBoundary resetKey={isValidElement(app) ? app.type : null}>{app}</ErrorBoundary>
          </div>
        </div>
        {assistantPane}
      </div>
    )
  }

  // Expanded reading keeps the message list reachable: people read in this
  // mode and move through messages and delete without leaving it. Hiding the
  // list here would throw them out of it at every step.
  //
  // `minmax(0, …)` on every track is what keeps a long subject or a wide
  // marketing email from pushing a pane past the window instead of
  // scrolling inside it — CSS grid tracks default to `min-content`, which
  // refuses to shrink below their content.
  if (readerExpanded) {
    return (
      <div
        className="grid h-full min-h-0"
        style={{
          gridTemplateColumns: `auto ${EXPANDED_LIST_WIDTH} minmax(0, 1fr)${assistantTrack}`
        }}
      >
        {rail}
        {/*
          `min-w-0` is not optional here: a grid item defaults to its
          min-content width, and a message row's min-content is a long
          unbroken subject. Without it the list panel grew past its track
          and slid under the reading pane instead of truncating.
        */}
        <div className="min-h-0 min-w-0 border-r">{listPane}</div>
        <div className="flex min-h-0 min-w-0 flex-col">
          {notice}
          <div className="min-h-0 flex-1">{readerPane}</div>
        </div>
        {assistantPane}
      </div>
    )
  }

  // The column is declared as `minmax(0, 1fr)` for the same reason: an
  // implicit grid column is `auto`, which grows to the widest unbreakable
  // line inside it. A message addressed to seventeen people put a
  // single-line recipient list in the reading header, and that line
  // stretched the table and the message past the right edge of the window.
  return (
    <div
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: `auto ${SIDEBAR_WIDTH} minmax(0, 1fr)${assistantTrack}` }}
    >
      {rail}
      <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r">
        {sidebarPane}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        {notice}
        {mode === 'outlook' ? (
          <ResizableSplit
            key="outlook"
            orientation="vertical"
            defaultSize={OUTLOOK_TABLE_HEIGHT}
            minFirst={messageTablePaneHeight(MESSAGE_TABLE_MIN_DRAGGED_ROWS)}
            minSecond={READER_MIN_HEIGHT}
            label={RESIZE_LABEL}
            className="flex-1"
            first={listPane}
            second={readerPane}
          />
        ) : (
          <ResizableSplit
            key="apple"
            orientation="horizontal"
            defaultSize={APPLE_LIST_WIDTH}
            minFirst={LIST_MIN_WIDTH}
            minSecond={READER_MIN_WIDTH}
            label={RESIZE_LABEL}
            className="flex-1"
            first={listPane}
            second={readerPane}
          />
        )}
      </div>
      {assistantPane}
    </div>
  )
}
