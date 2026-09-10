import { describe, expect, it } from 'vitest'

import {
  applySelectionIntent,
  EMPTY_MESSAGE_SELECTION,
  messageRefKey,
  moveSelectionCursor,
  reconcileSelection,
  selectAllMessages,
  type MessageSelectionState
} from './message-selection'
import type { MessageRef } from '@shared/models'

const refs: MessageRef[] = [1, 2, 3, 4, 5].map((uid) => ({
  accountId: 'acc',
  folderPath: 'INBOX',
  uid
}))

function keys(state: MessageSelectionState): number[] {
  return state.selectedRefs.map((ref) => ref.uid)
}

function selectionOf(selected: number[], cursor: number, anchor: number): MessageSelectionState {
  return {
    selectedRefs: selected.map((uid) => refs[uid - 1]),
    cursorRef: refs[cursor - 1],
    anchorRef: refs[anchor - 1]
  }
}

describe('applySelectionIntent', () => {
  it('replaces the selection on a plain click', () => {
    const next = applySelectionIntent(selectionOf([1, 2, 3], 3, 1), refs, refs[4], 'replace')
    expect(keys(next)).toEqual([5])
    expect(next.cursorRef?.uid).toBe(5)
    expect(next.anchorRef?.uid).toBe(5)
  })

  it('adds an unselected row on toggle', () => {
    const next = applySelectionIntent(selectionOf([1], 1, 1), refs, refs[2], 'toggle')
    expect(keys(next)).toEqual([1, 3])
    expect(next.cursorRef?.uid).toBe(3)
  })

  it('removes a selected row on toggle and moves the cursor onto it', () => {
    // The regression from the field report: the row came out of the
    // selection but kept the selected highlight because the cursor landed
    // on it. Cursor and selection are separate now, so the renderer can
    // paint the difference.
    const next = applySelectionIntent(selectionOf([1, 2, 3], 3, 1), refs, refs[1], 'toggle')
    expect(keys(next)).toEqual([1, 3])
    expect(next.cursorRef?.uid).toBe(2)
    expect(next.selectedRefs.some((ref) => messageRefKey(ref) === messageRefKey(refs[1]))).toBe(
      false
    )
  })

  it('selects an inclusive range on shift, in either direction', () => {
    expect(keys(applySelectionIntent(selectionOf([2], 2, 2), refs, refs[3], 'range'))).toEqual([
      2, 3, 4
    ])
    expect(keys(applySelectionIntent(selectionOf([4], 4, 4), refs, refs[1], 'range'))).toEqual([
      2, 3, 4
    ])
  })

  it('keeps the anchor across successive shift clicks', () => {
    const first = applySelectionIntent(selectionOf([2], 2, 2), refs, refs[4], 'range')
    expect(keys(first)).toEqual([2, 3, 4, 5])

    const second = applySelectionIntent(first, refs, refs[2], 'range')
    expect(keys(second)).toEqual([2, 3])
    expect(second.anchorRef?.uid).toBe(2)
  })

  it('falls back to a single selection when the anchor is gone', () => {
    const orphaned: MessageSelectionState = {
      selectedRefs: [],
      cursorRef: null,
      anchorRef: { accountId: 'acc', folderPath: 'INBOX', uid: 99 }
    }
    expect(keys(applySelectionIntent(orphaned, refs, refs[2], 'range'))).toEqual([3])
  })
})

describe('moveSelectionCursor', () => {
  it('collapses onto the next row without shift', () => {
    const next = moveSelectionCursor(selectionOf([1, 2, 3], 2, 1), refs, 1, false)
    expect(keys(next)).toEqual([3])
    expect(next.cursorRef?.uid).toBe(3)
  })

  it('extends from the anchor with shift', () => {
    const next = moveSelectionCursor(selectionOf([2], 2, 2), refs, 1, true)
    expect(keys(next)).toEqual([2, 3])

    const further = moveSelectionCursor(next, refs, 1, true)
    expect(keys(further)).toEqual([2, 3, 4])
  })

  it('shrinks the range when shift reverses direction', () => {
    const grown = moveSelectionCursor(
      moveSelectionCursor(selectionOf([2], 2, 2), refs, 1, true),
      refs,
      1,
      true
    )
    expect(keys(grown)).toEqual([2, 3, 4])

    const shrunk = moveSelectionCursor(grown, refs, -1, true)
    expect(keys(shrunk)).toEqual([2, 3])
  })

  it('stops at the edges instead of wrapping', () => {
    expect(keys(moveSelectionCursor(selectionOf([5], 5, 5), refs, 1, false))).toEqual([5])
    expect(keys(moveSelectionCursor(selectionOf([1], 1, 1), refs, -1, false))).toEqual([1])
  })

  it('lands on the newest message when there is no cursor yet', () => {
    expect(keys(moveSelectionCursor(EMPTY_MESSAGE_SELECTION, refs, 1, false))).toEqual([1])
  })

  it('is a no-op on an empty list', () => {
    expect(moveSelectionCursor(EMPTY_MESSAGE_SELECTION, [], 1, false)).toBe(EMPTY_MESSAGE_SELECTION)
  })
})

describe('selectAllMessages', () => {
  it('selects everything and keeps the cursor put', () => {
    const next = selectAllMessages(selectionOf([3], 3, 3), refs)
    expect(keys(next)).toEqual([1, 2, 3, 4, 5])
    expect(next.cursorRef?.uid).toBe(3)
  })
})

describe('reconcileSelection', () => {
  it('drops refs that left the page and re-homes the cursor', () => {
    const remaining = [refs[0], refs[2]]
    const next = reconcileSelection(selectionOf([1, 2, 3], 2, 1), remaining)
    expect(keys(next)).toEqual([1, 3])
    expect(next.cursorRef?.uid).toBe(3)
  })

  it('clears everything when nothing survives', () => {
    const next = reconcileSelection(selectionOf([1, 2], 2, 1), [])
    expect(next.selectedRefs).toEqual([])
    expect(next.cursorRef).toBeNull()
    expect(next.anchorRef).toBeNull()
  })

  it('returns the same object when nothing changed, so React can bail out', () => {
    const state = selectionOf([1, 2], 2, 1)
    expect(reconcileSelection(state, refs)).toBe(state)
  })
})
