/**
 * The two arrangements the workspace can wear.
 *
 * Both are fed identical props and share every component inside them — the
 * folder tree, the toolbar, the reading pane. Only the geometry differs, and
 * which list shell fills the message slot:
 *
 *   apple   — folders / list / reading pane side by side. Same disposition
 *             as the layout SIEVER Mail shipped with, rebuilt at a much
 *             tighter density.
 *   outlook — folders on the left, a dense table on top and the reading pane
 *             underneath it, which is what the team asked for by name.
 *
 * Keeping them here, purely presentational, is what lets the layout be a
 * one-line preference in `App` instead of a fork in the state logic.
 */
import type { ReactNode } from 'react'

import { cn } from '@renderer/lib/utils'

/**
 * How the outlook layout splits its vertical space.
 *
 * Measured against the real thing rather than guessed: at the app's default
 * 940px window the workspace column is ~878px, the table spends 62px on its
 * two header rows and ~24px on a group band, and each row is 26px. 54% of
 * that leaves room for fifteen messages — the working minimum the SIEVER
 * team gave — while the reading pane keeps enough height for a full message
 * header plus the opening paragraphs. Maximised, the same ratio yields
 * around twenty rows.
 */
const OUTLOOK_TABLE_FRACTION = '54fr'
const OUTLOOK_READER_FRACTION = '46fr'

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
   * Reading pane takes the whole workspace: the list is hidden and the
   * sidebar hands its space to the message.
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
  const sidebar = (
    <aside className="flex h-full min-h-0 w-[232px] shrink-0 flex-col gap-2">
      {header}
      {accountSwitcher}
      <div className="min-h-0 flex-1">{folders}</div>
    </aside>
  )

  // Expanded reading is layout-agnostic: the message takes the whole
  // workspace and the sidebar hands its column to the message list.
  //
  // The list has to stay reachable — this is the mode the SIEVER team reads
  // in, and they delete and move through messages without leaving it. Losing
  // the list here would cost them the very workflow that made "la modalità
  // schermo esteso viene persa" worth reporting in the first place.
  if (readerExpanded) {
    return (
      <div className="flex h-full min-h-0 gap-2">
        <aside className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2">
          {header}
          <div className="min-h-0 flex-1">{messageList}</div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {toolbar}
          {notice}
          <div className="min-h-0 flex-1">{reader}</div>
        </div>
      </div>
    )
  }

  if (mode === 'outlook') {
    return (
      <div className="flex h-full min-h-0 gap-2">
        {sidebar}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {toolbar}
          {notice}
          <div
            className="grid min-h-0 flex-1 gap-2"
            style={{
              gridTemplateRows: `minmax(0, ${OUTLOOK_TABLE_FRACTION}) minmax(0, ${OUTLOOK_READER_FRACTION})`
            }}
          >
            <div className="min-h-0">{messageList}</div>
            <div className="min-h-0">{reader}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 gap-2">
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {toolbar}
        {notice}
        <div
          className={cn(
            'grid min-h-0 flex-1 grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)] gap-2'
          )}
        >
          <div className="min-h-0 min-w-0">{messageList}</div>
          <div className="min-h-0 min-w-0">{reader}</div>
        </div>
      </div>
    </div>
  )
}
