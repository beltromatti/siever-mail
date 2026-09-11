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
 */
import type { ReactNode } from 'react'

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
const SIDEBAR_WIDTH = 'clamp(196px, 15%, 256px)'

/**
 * Message list beside the reading pane. Proportioned after the reference
 * the customer sent: the list is a scanning column, the message is the
 * thing being read, so the message gets the larger share. The lower bound
 * is what a three-line row needs before sender and subject start colliding;
 * the upper bound is where a wider list stops adding information.
 */
const APPLE_LIST_WIDTH = 'clamp(288px, 27%, 408px)'

/**
 * Same column in expanded reading, where the list is a navigation strip
 * rather than the main surface, so it gives up more room to the message.
 */
const EXPANDED_LIST_WIDTH = 'clamp(260px, 22%, 360px)'

/**
 * Height of the dense table above the reading pane, expressed in rows
 * rather than pixels: never fewer than the team needs at a glance, never
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

export interface WorkspaceLayoutProps {
  mode: 'apple' | 'outlook'
  /** Brand block plus connection badge. */
  header: ReactNode
  accountSwitcher: ReactNode
  folders: ReactNode
  toolbar: ReactNode
  messageList: ReactNode
  reader: ReactNode
  /** Error banner, rendered above the reader when present. */
  notice: ReactNode
  /**
   * Reading pane takes the whole workspace: the folder tree steps aside and
   * the message list moves into the side column.
   */
  readerExpanded: boolean
}

export function WorkspaceLayout({
  mode,
  header,
  accountSwitcher,
  folders,
  toolbar,
  messageList,
  reader,
  notice,
  readerExpanded
}: WorkspaceLayoutProps): React.JSX.Element {
  /**
   * `minmax(0, …)` on every track is what keeps a long subject or a wide
   * marketing email from pushing a pane past the window instead of
   * scrolling inside it — CSS grid tracks default to `min-content`, which
   * refuses to shrink below their content.
   */
  const shell = (sideColumn: ReactNode, main: ReactNode): React.JSX.Element => (
    <div
      className="grid h-full min-h-0 gap-2"
      style={{ gridTemplateColumns: `${SIDEBAR_WIDTH} minmax(0, 1fr)` }}
    >
      <aside className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
        {sideColumn}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col gap-2">{main}</div>
    </div>
  )

  // Expanded reading keeps the message list reachable: this is the mode the
  // SIEVER team reads in, and they move through messages and delete without
  // leaving it. Hiding the list here would cost them the workflow that made
  // "la modalità schermo esteso viene persa" worth reporting.
  if (readerExpanded) {
    return (
      <div
        className="grid h-full min-h-0 gap-2"
        style={{ gridTemplateColumns: `${EXPANDED_LIST_WIDTH} minmax(0, 1fr)` }}
      >
        <aside className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
          {header}
          {/*
            `min-w-0` is not optional here: a grid item defaults to its
            min-content width, and a message row's min-content is a long
            unbroken subject. Without it the list panel grew past its track
            and slid under the reading pane instead of truncating.
          */}
          <div className="min-h-0 min-w-0">{messageList}</div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          {toolbar}
          {notice}
          <div className="min-h-0 flex-1">{reader}</div>
        </div>
      </div>
    )
  }

  const sideColumn = (
    <>
      {header}
      {accountSwitcher}
      <div className="min-h-0 flex-1">{folders}</div>
    </>
  )

  if (mode === 'outlook') {
    return shell(
      sideColumn,
      <>
        {toolbar}
        {notice}
        <div
          className="grid min-h-0 flex-1 gap-2"
          style={{ gridTemplateRows: `${OUTLOOK_TABLE_HEIGHT} minmax(0, 1fr)` }}
        >
          <div className="min-h-0">{messageList}</div>
          <div className="min-h-0">{reader}</div>
        </div>
      </>
    )
  }

  return shell(
    sideColumn,
    <>
      {toolbar}
      {notice}
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{ gridTemplateColumns: `${APPLE_LIST_WIDTH} minmax(0, 1fr)` }}
      >
        <div className="min-h-0 min-w-0">{messageList}</div>
        <div className="min-h-0 min-w-0">{reader}</div>
      </div>
    </>
  )
}
