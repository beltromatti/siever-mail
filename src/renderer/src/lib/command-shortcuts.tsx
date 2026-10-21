import { createContext, useContext, type ReactNode } from 'react'

import {
  commandChord,
  COMMANDS,
  findCommand,
  type CommandDefinition,
  type ShortcutOverrides
} from '@shared/commands'
import {
  formatChordKeys,
  isMacPlatform,
  matchesChord,
  type ShortcutKeyEvent,
  type ShortcutScope
} from '@shared/shortcuts'

/** ⌘ or Ctrl: which one this machine's shortcuts are drawn and matched with. */
export const IS_MAC = isMacPlatform(navigator.platform)

const CommandShortcutsContext = createContext<ShortcutOverrides>({})

/** Hands the user's chords to every tooltip, menu and key handler below. */
export function CommandShortcutsProvider({
  overrides,
  children
}: {
  overrides: ShortcutOverrides
  children: ReactNode
}): React.JSX.Element {
  return (
    <CommandShortcutsContext.Provider value={overrides}>
      {children}
    </CommandShortcutsContext.Provider>
  )
}

export function useShortcutOverrides(): ShortcutOverrides {
  return useContext(CommandShortcutsContext)
}

/** The key caps a command answers to now, or null for an unknown command. */
export function useCommandKeys(commandId: string): string[] | null {
  const overrides = useShortcutOverrides()
  const command = findCommand(commandId)
  return command ? formatChordKeys(commandChord(command, overrides), IS_MAC) : null
}

/** The command of `scope` a key press asks for, if any. */
export function commandForKeyEvent(
  event: ShortcutKeyEvent,
  scope: ShortcutScope,
  overrides: ShortcutOverrides
): CommandDefinition | undefined {
  // A bare key, Shift aside, is typing — unless it is a function key.
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !/^F\d{1,2}$/.test(event.code)) {
    return undefined
  }

  return COMMANDS.find(
    (command) =>
      command.scope === scope && matchesChord(event, commandChord(command, overrides), IS_MAC)
  )
}

/**
 * True while something is layered over the window — a dialog, a
 * confirmation, an open menu or list. The window's commands act on its
 * selection, so they wait until it is closed.
 */
export function isOverlaySurfaceOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]'
    )
  )
}
