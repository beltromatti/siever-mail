import type { MailMessageSummary, MessageRef } from '@shared/models'

/**
 * Selection algebra for the message list.
 *
 * The list follows the convention every file manager and mail client shares
 * — plain click replaces, Ctrl/Cmd click toggles, Shift click extends from
 * an anchor — and keeps two distinct notions apart:
 *
 *   • the SELECTION: every row an action applies to.
 *   • the CURSOR: the row the keyboard is on and the pivot Shift measures
 *     ranges from.
 *
 * Conflating the two is what produced the bug the SIEVER team reported:
 * Ctrl-clicking a selected row removed it from the selection but left it
 * looking selected, because the same highlight was painted for "current"
 * and for "selected". Keeping them separate here lets the renderer paint
 * them differently.
 */

export function messageRefKey(ref: MessageRef): string {
  return `${ref.accountId}:${ref.folderPath}:${ref.uid}`
}

export function isSameMessageRef(left: MessageRef, right: MessageRef): boolean {
  return (
    left.accountId === right.accountId &&
    left.folderPath === right.folderPath &&
    left.uid === right.uid
  )
}

export function summaryToMessageRef(summary: MailMessageSummary): MessageRef {
  return {
    accountId: summary.accountId,
    folderPath: summary.folderPath,
    uid: summary.uid
  }
}

export function uniqueMessageRefs(refs: ReadonlyArray<MessageRef>): MessageRef[] {
  const seen = new Set<string>()

  return refs.filter((ref) => {
    const key = messageRefKey(ref)

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

export interface MessageSelectionState {
  /** Rows every toolbar action applies to. */
  selectedRefs: MessageRef[]
  /** Row the keyboard is on; also the reading pane's subject when alone. */
  cursorRef: MessageRef | null
  /** Pivot a Shift range is measured from. */
  anchorRef: MessageRef | null
}

export const EMPTY_MESSAGE_SELECTION: MessageSelectionState = {
  selectedRefs: [],
  cursorRef: null,
  anchorRef: null
}

/** Which modifier the platform uses for "add to selection". */
export type SelectionIntent = 'replace' | 'toggle' | 'range'

export function resolveSelectionIntent(event: {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): SelectionIntent {
  if (event.shiftKey) {
    return 'range'
  }

  // Cmd on macOS, Ctrl everywhere else — matching Finder and Explorer.
  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform)

  return (isMac ? event.metaKey : event.ctrlKey) ? 'toggle' : 'replace'
}

function indexOfRef(orderedRefs: ReadonlyArray<MessageRef>, ref: MessageRef | null): number {
  if (!ref) {
    return -1
  }

  const key = messageRefKey(ref)
  return orderedRefs.findIndex((candidate) => messageRefKey(candidate) === key)
}

/**
 * Applies a click (or a keyboard activation) to the current selection.
 * `orderedRefs` is the list exactly as rendered, so a Shift range covers
 * what the user visually swept over.
 */
export function applySelectionIntent(
  current: MessageSelectionState,
  orderedRefs: ReadonlyArray<MessageRef>,
  target: MessageRef,
  intent: SelectionIntent
): MessageSelectionState {
  const targetKey = messageRefKey(target)

  if (intent === 'range') {
    const anchor = current.anchorRef ?? current.cursorRef ?? target
    const anchorIndex = indexOfRef(orderedRefs, anchor)
    const targetIndex = indexOfRef(orderedRefs, target)

    if (anchorIndex < 0 || targetIndex < 0) {
      return { selectedRefs: [target], cursorRef: target, anchorRef: target }
    }

    const [from, to] =
      anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]

    return {
      selectedRefs: orderedRefs.slice(from, to + 1).map((ref) => ({ ...ref })),
      cursorRef: target,
      // The anchor survives a range so dragging the shift-click around keeps
      // measuring from the same pivot, exactly like Explorer.
      anchorRef: anchor
    }
  }

  if (intent === 'toggle') {
    const isSelected = current.selectedRefs.some((ref) => messageRefKey(ref) === targetKey)
    const selectedRefs = isSelected
      ? current.selectedRefs.filter((ref) => messageRefKey(ref) !== targetKey)
      : [...current.selectedRefs, target]

    return { selectedRefs, cursorRef: target, anchorRef: target }
  }

  return { selectedRefs: [target], cursorRef: target, anchorRef: target }
}

/**
 * Moves the cursor by `delta` positions in the rendered order. With
 * `extend`, the selection grows from the anchor to the new cursor instead of
 * collapsing onto it — the Shift+Arrow behaviour.
 */
export function moveSelectionCursor(
  current: MessageSelectionState,
  orderedRefs: ReadonlyArray<MessageRef>,
  delta: number,
  extend: boolean
): MessageSelectionState {
  if (orderedRefs.length === 0) {
    return current
  }

  const currentIndex = indexOfRef(orderedRefs, current.cursorRef)
  // No cursor yet: the first press lands on the newest message rather than
  // stepping from nowhere.
  const nextIndex =
    currentIndex < 0
      ? delta > 0
        ? 0
        : orderedRefs.length - 1
      : Math.min(orderedRefs.length - 1, Math.max(0, currentIndex + delta))

  const target = orderedRefs[nextIndex]

  if (!target) {
    return current
  }

  return applySelectionIntent(current, orderedRefs, target, extend ? 'range' : 'replace')
}

/** Selects everything currently rendered, keeping the cursor where it is. */
export function selectAllMessages(
  current: MessageSelectionState,
  orderedRefs: ReadonlyArray<MessageRef>
): MessageSelectionState {
  if (orderedRefs.length === 0) {
    return current
  }

  return {
    selectedRefs: orderedRefs.map((ref) => ({ ...ref })),
    cursorRef: current.cursorRef ?? orderedRefs[0],
    anchorRef: current.anchorRef ?? orderedRefs[0]
  }
}

/**
 * Drops refs that are no longer on the page (deleted, moved, filtered out by
 * a new search) so the selection can never act on a message that is gone.
 */
export function reconcileSelection(
  current: MessageSelectionState,
  orderedRefs: ReadonlyArray<MessageRef>
): MessageSelectionState {
  const availableKeys = new Set(orderedRefs.map(messageRefKey))
  const selectedRefs = current.selectedRefs.filter((ref) => availableKeys.has(messageRefKey(ref)))
  const cursorRef =
    current.cursorRef && availableKeys.has(messageRefKey(current.cursorRef))
      ? current.cursorRef
      : (selectedRefs[selectedRefs.length - 1] ?? null)
  const anchorRef =
    current.anchorRef && availableKeys.has(messageRefKey(current.anchorRef))
      ? current.anchorRef
      : cursorRef

  if (
    selectedRefs.length === current.selectedRefs.length &&
    cursorRef === current.cursorRef &&
    anchorRef === current.anchorRef
  ) {
    return current
  }

  return { selectedRefs, cursorRef, anchorRef }
}
