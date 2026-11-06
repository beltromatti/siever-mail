import { describe, expect, it } from 'vitest'

import {
  commandChord,
  COMMANDS,
  findChordConflict,
  findCommand,
  sanitizeShortcutOverrides
} from './commands'
import { validateChord } from './shortcuts'

describe('the default chords', () => {
  it('are valid for their scope and unique within it', () => {
    for (const command of COMMANDS.filter((entry) => entry.editable)) {
      expect(validateChord(command.defaultChord, command.scope)).toEqual({
        ok: true,
        value: command.defaultChord
      })
      expect(findChordConflict(command.id, command.defaultChord, command.scope, {})).toBeUndefined()
    }
  })
})

describe('findChordConflict', () => {
  it("counts the Calendario's commands along with the window's, which listen at the same time", () => {
    expect(findChordConflict('calendar-today', 'Mod+KeyN', 'calendar', {})?.id).toBe('compose')
    expect(findChordConflict('compose', 'KeyT', 'main', {})?.id).toBe('calendar-today')
    expect(findChordConflict('calendar-today', 'KeyJ', 'calendar', {})?.id).toBe('calendar-next')
  })

  it('leaves a message being written on its own, as its dialog is over everything', () => {
    expect(findChordConflict('attach', 'KeyT', 'composer', {})).toBeUndefined()
    expect(findChordConflict('calendar-today', 'Mod+KeyJ', 'calendar', {})?.id).toBe('segretario')
  })
})

describe('sanitizeShortcutOverrides', () => {
  it('keeps a valid chord and drops what would equal the default', () => {
    expect(sanitizeShortcutOverrides({ reply: 'Mod+Alt+KeyR', forward: 'Mod+Shift+KeyF' })).toEqual(
      { reply: 'Mod+Alt+KeyR' }
    )
  })

  it('drops reserved chords, clashes and fixed commands', () => {
    expect(
      sanitizeShortcutOverrides({
        reply: 'Mod+KeyC',
        forward: 'Mod+Shift+KeyR',
        settings: 'Mod+Alt+KeyS'
      })
    ).toEqual({})
  })

  it('keeps a command this build does not have, so switching builds loses nothing', () => {
    expect(sanitizeShortcutOverrides({ 'acme.publish': 'Shift+Mod+KeyP' })).toEqual({
      'acme.publish': 'Mod+Shift+KeyP'
    })
  })
})

describe('commandChord', () => {
  it("is the user's chord when they chose one, the default otherwise", () => {
    const reply = findCommand('reply')!

    expect(commandChord(reply, {})).toBe('Mod+KeyR')
    expect(commandChord(reply, { reply: 'Mod+Alt+KeyR' })).toBe('Mod+Alt+KeyR')
  })
})
