import { useEffect, useRef } from 'react'

import {
  commandForKeyEvent,
  isOverlaySurfaceOpen,
  useShortcutOverrides
} from '@renderer/lib/command-shortcuts'
import { uiLog } from '@renderer/lib/diagnostics'
import { commandChord, findCommand, type HostCommandId } from '@shared/commands'

/** The fields the keyboard writes in — not a checkbox, nor a button. */
const TEXT_FIELDS =
  'textarea, select, input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"])'

/** Whether a key goes into what is written: there it is a letter, not a command. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches(TEXT_FIELDS))
}

/**
 * The Delete key, alone, as the delete command while that answers to
 * Backspace — the delete key of a Mac keyboard —: on every keyboard either
 * key takes an event away, as in the Posta.
 */
function deleteKeyCommand(
  event: KeyboardEvent,
  overrides: ReturnType<typeof useShortcutOverrides>
): HostCommandId | undefined {
  const command = findCommand('calendar-delete-event')

  return command &&
    event.code === 'Delete' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    commandChord(command, overrides) === 'Backspace'
    ? 'calendar-delete-event'
    : undefined
}

/**
 * The Calendario's commands from their keys (Settings › Scorciatoie): only
 * while it is in front — it is mounted only then — with nothing over it
 * (`enabled`: no message being written, no dialog of the shell), and no
 * field taking what is typed. `run` says whether the command applied, and
 * so whether the key is spent.
 */
export function useCalendarKeys(
  run: (commandId: HostCommandId) => boolean,
  enabled: boolean
): void {
  const overrides = useShortcutOverrides()
  const runRef = useRef(run)

  useEffect(() => {
    runRef.current = run
  })

  useEffect(() => {
    if (!enabled) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isTyping(event.target) ||
        isOverlaySurfaceOpen()
      ) {
        return
      }

      const id =
        commandForKeyEvent(event, 'calendar', overrides)?.id ?? deleteKeyCommand(event, overrides)

      if (id && runRef.current(id as HostCommandId)) {
        event.preventDefault()
        uiLog.info('command', { id, via: 'keyboard' })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, overrides])
}
