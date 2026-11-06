import { useEffect, useRef } from 'react'

import {
  commandForKeyEvent,
  isOverlaySurfaceOpen,
  useShortcutOverrides
} from '@renderer/lib/command-shortcuts'
import type { HostCommandId } from '@shared/commands'

/** The fields the keyboard writes in — not a checkbox, nor a button. */
const TEXT_FIELDS =
  'textarea, select, input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"])'

/** Whether a key goes into what is written: there it is a letter, not a command. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches(TEXT_FIELDS))
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

      const command = commandForKeyEvent(event, 'calendar', overrides)

      if (command && runRef.current(command.id as HostCommandId)) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, overrides])
}
