import { describe, expect, it } from 'vitest'

import {
  chordToAccelerator,
  formatChordKeys,
  matchesChord,
  readShortcutEvent,
  validateChord,
  type ShortcutKeyEvent
} from './shortcuts'

function press(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    code: 'KeyR',
    key: 'r',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides
  }
}

describe('formatChordKeys', () => {
  it("draws a chord in each platform's vocabulary and order", () => {
    expect(formatChordKeys('Mod+Shift+KeyR', true)).toEqual(['⇧', '⌘', 'R'])
    expect(formatChordKeys('Mod+Shift+KeyR', false)).toEqual(['Ctrl', 'Shift', 'R'])
    expect(formatChordKeys('Mod+Enter', true)).toEqual(['⌘', '↩'])
    expect(formatChordKeys('Mod+Enter', false)).toEqual(['Ctrl', 'Invio'])
  })
})

describe('matchesChord', () => {
  it('reads Mod as ⌘ on macOS and Ctrl elsewhere', () => {
    const mac = press({ metaKey: true, shiftKey: true })
    const pc = press({ ctrlKey: true, shiftKey: true })

    expect(matchesChord(mac, 'Mod+Shift+KeyR', true)).toBe(true)
    expect(matchesChord(pc, 'Mod+Shift+KeyR', false)).toBe(true)
    expect(matchesChord(pc, 'Mod+Shift+KeyR', true)).toBe(false)
    expect(matchesChord(mac, 'Mod+Shift+KeyR', false)).toBe(false)
  })

  it('matches the physical key, not the character a layout or ⌥ produces', () => {
    expect(
      matchesChord(press({ metaKey: true, altKey: true, key: '®' }), 'Mod+Alt+KeyR', true)
    ).toBe(true)
  })

  it('takes the keypad Enter for Enter', () => {
    expect(matchesChord(press({ ctrlKey: true, code: 'NumpadEnter' }), 'Mod+Enter', false)).toBe(
      true
    )
  })

  it('requires the exact modifier set', () => {
    expect(matchesChord(press({ ctrlKey: true }), 'Mod+Shift+KeyR', false)).toBe(false)
    expect(
      matchesChord(press({ ctrlKey: true, shiftKey: true, altKey: true }), 'Mod+Shift+KeyR', false)
    ).toBe(false)
  })
})

describe('validateChord', () => {
  it('refuses chords without Ctrl/⌘ or Alt, which would fire while typing', () => {
    expect(validateChord('Shift+KeyS', 'main')).toEqual({ ok: false, reason: 'modifier' })
    expect(validateChord('KeyS', 'main')).toEqual({ ok: false, reason: 'modifier' })
  })

  it('accepts a function key alone, which types nothing', () => {
    expect(validateChord('F9', 'main')).toEqual({ ok: true, value: 'F9' })
  })

  it('refuses chords text editing or the OS already use, everywhere', () => {
    for (const taken of ['Mod+KeyA', 'Mod+KeyC', 'Mod+KeyQ', 'Mod+Comma', 'Alt+F4']) {
      expect(validateChord(taken, 'main')).toEqual({ ok: false, reason: 'reserved' })
    }
  })

  it("keeps the editor's own chords for the composer only", () => {
    expect(validateChord('Mod+KeyB', 'composer')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateChord('Mod+KeyB', 'main')).toEqual({ ok: true, value: 'Mod+KeyB' })
  })

  it('normalises modifier order so equal chords compare equal', () => {
    expect(validateChord('Shift+Mod+KeyE', 'main')).toEqual({ ok: true, value: 'Mod+Shift+KeyE' })
  })

  it('rejects malformed input', () => {
    for (const bad of ['', 'Mod+', 'Mod+Mod+KeyS', 'Ctrl+KeyS', 'Mod+Shift+s', 'Mod+Tab']) {
      expect(validateChord(bad, 'main')).toEqual({ ok: false, reason: 'format' })
    }
  })
})

describe('readShortcutEvent', () => {
  it('reports held modifiers so the recorder can preview them', () => {
    expect(
      readShortcutEvent(press({ code: 'ShiftLeft', ctrlKey: true, shiftKey: true }), false)
    ).toEqual({ kind: 'modifiers-only', keys: ['Ctrl', 'Shift'] })
  })

  it("refuses the platform's foreign modifier", () => {
    expect(readShortcutEvent(press({ ctrlKey: true }), true)).toEqual({
      kind: 'unsupported-modifier'
    })
    expect(readShortcutEvent(press({ metaKey: true }), false)).toEqual({
      kind: 'unsupported-modifier'
    })
  })

  it('turns a full chord into storage form', () => {
    expect(readShortcutEvent(press({ metaKey: true, code: 'KeyE' }), true)).toEqual({
      kind: 'combo',
      value: 'Mod+KeyE'
    })
  })
})

describe('chordToAccelerator', () => {
  it('writes the menu bar form Electron takes', () => {
    expect(chordToAccelerator('Mod+Shift+KeyR')).toBe('CommandOrControl+Shift+R')
    expect(chordToAccelerator('Mod+Enter')).toBe('CommandOrControl+Return')
    expect(chordToAccelerator('Mod+Comma')).toBe('CommandOrControl+,')
  })
})
