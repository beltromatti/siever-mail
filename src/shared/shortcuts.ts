/**
 * Keyboard shortcuts: how one is written down, checked, matched against a
 * key press and drawn.
 *
 * Pure on purpose — no Electron, no DOM globals — so the main process can
 * check what it stores and build the macOS menu from the same rules the
 * renderer matches with.
 *
 * A chord is stored platform-neutral, e.g. `Mod+Shift+KeyR`. `Mod` is ⌘ on
 * macOS and Ctrl everywhere else, so one stored value is the same gesture
 * on every machine. The key is recorded by its physical `code`, not the
 * character it types: on an Italian layout, or on macOS where ⌥ turns R
 * into ®, `event.key` is not the key the user pressed.
 */

/** Where a shortcut works: the main window, or a message being written. */
export type ShortcutScope = 'main' | 'composer'

export interface ShortcutKeyEvent {
  code: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

interface ChordParts {
  mod: boolean
  alt: boolean
  shift: boolean
  code: string
}

const KEY_CODE_PATTERN =
  /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Period|Comma|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Backquote|Enter|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/

const FUNCTION_KEY_PATTERN = /^F(?:[1-9]|1[0-2])$/

/** Codes that name the same key twice on a full keyboard. */
const EQUIVALENT_CODES: Readonly<Record<string, string>> = {
  NumpadEnter: 'Enter'
}

const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'CapsLock',
  'OSLeft',
  'OSRight'
])

/**
 * Chords spoken for everywhere — by text editing, by the operating system,
 * by the window — or kept fixed by the app (select all, settings, zoom).
 * Binding a command to one would either never fire or take something away
 * the user relies on.
 */
const RESERVED_EVERYWHERE: ReadonlySet<string> = new Set([
  'Mod+KeyA',
  'Mod+KeyC',
  'Mod+KeyV',
  'Mod+KeyX',
  'Mod+KeyZ',
  'Mod+Shift+KeyZ',
  'Mod+KeyY',
  'Mod+KeyQ',
  'Mod+KeyW',
  'Mod+KeyM',
  'Mod+KeyH',
  'Mod+Alt+KeyH',
  'Mod+Shift+KeyI',
  'Mod+Alt+KeyI',
  'Mod+Equal',
  'Mod+Shift+Equal',
  'Mod+Minus',
  'Mod+Digit0',
  'Mod+Comma',
  'Mod+Backquote',
  'Alt+F4'
])

/** What the editor does with Ctrl/⌘ while a message is written. */
const RESERVED_IN_COMPOSER: ReadonlySet<string> = new Set([
  'Mod+KeyB',
  'Mod+KeyI',
  'Mod+KeyU',
  'Mod+KeyD',
  'Mod+Shift+Digit5',
  'Mod+Shift+Digit6',
  'Mod+Shift+Digit7',
  'Mod+Shift+Digit8',
  'Mod+Shift+Digit9',
  'Mod+BracketLeft',
  'Mod+BracketRight',
  'Mod+Backspace',
  'Mod+Delete',
  'Mod+ArrowLeft',
  'Mod+ArrowRight',
  'Mod+ArrowUp',
  'Mod+ArrowDown',
  'Mod+Shift+ArrowLeft',
  'Mod+Shift+ArrowRight',
  'Mod+Shift+ArrowUp',
  'Mod+Shift+ArrowDown',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
  'Alt+Shift+ArrowLeft',
  'Alt+Shift+ArrowRight',
  'Alt+Backspace',
  'Alt+Delete'
])

function parseChord(value: string): ChordParts | null {
  const segments = value.split('+')
  const code = segments.pop()

  if (!code || !KEY_CODE_PATTERN.test(code)) {
    return null
  }

  const modifiers = new Set(segments)

  if (
    modifiers.size !== segments.length ||
    [...modifiers].some((m) => m !== 'Mod' && m !== 'Alt' && m !== 'Shift')
  ) {
    return null
  }

  return {
    mod: modifiers.has('Mod'),
    alt: modifiers.has('Alt'),
    shift: modifiers.has('Shift'),
    code
  }
}

function serializeChord(parts: ChordParts): string {
  return [parts.mod && 'Mod', parts.alt && 'Alt', parts.shift && 'Shift', parts.code]
    .filter(Boolean)
    .join('+')
}

/** A chord in its one canonical spelling, or null when it is not one. */
export function normalizeChord(value: string): string | null {
  const parts = parseChord(value)
  return parts ? serializeChord(parts) : null
}

export type ShortcutValidation =
  { ok: true; value: string } | { ok: false; reason: 'format' | 'modifier' | 'reserved' }

/**
 * Whether a chord may be bound to a command of `scope`. It needs Ctrl/⌘ or
 * Alt — Shift alone only changes what a key types, so it would fire while
 * the user writes a capital — unless the key types nothing at all (F1–F12).
 */
export function validateChord(value: string, scope: ShortcutScope): ShortcutValidation {
  const parts = parseChord(value)

  if (!parts) {
    return { ok: false, reason: 'format' }
  }

  if (!parts.mod && !parts.alt && !FUNCTION_KEY_PATTERN.test(parts.code)) {
    return { ok: false, reason: 'modifier' }
  }

  const normalized = serializeChord(parts)

  if (
    RESERVED_EVERYWHERE.has(normalized) ||
    (scope === 'composer' && RESERVED_IN_COMPOSER.has(normalized))
  ) {
    return { ok: false, reason: 'reserved' }
  }

  return { ok: true, value: normalized }
}

export type ShortcutReading =
  | { kind: 'modifiers-only'; keys: string[] }
  | { kind: 'unsupported-modifier' }
  | { kind: 'combo'; value: string }

function keyEventCode(event: ShortcutKeyEvent): string {
  return EQUIVALENT_CODES[event.code] ?? event.code
}

/**
 * What a key press means to a shortcut recorder: still holding modifiers,
 * a modifier this platform does not use for shortcuts, or a complete chord
 * in storage form (not yet validated).
 */
export function readShortcutEvent(event: ShortcutKeyEvent, isMac: boolean): ShortcutReading {
  // macOS shortcuts use ⌘; its Control key is a separate modifier we do not
  // bind. On Windows and Linux the Windows/Super key belongs to the OS.
  const foreignModifier = isMac ? event.ctrlKey : event.metaKey

  if (foreignModifier) {
    return { kind: 'unsupported-modifier' }
  }

  const parts: ChordParts = {
    mod: isMac ? event.metaKey : event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    code: keyEventCode(event)
  }

  if (MODIFIER_CODES.has(event.code)) {
    return { kind: 'modifiers-only', keys: modifierKeyLabels(parts, isMac) }
  }

  return { kind: 'combo', value: serializeChord(parts) }
}

export function matchesChord(event: ShortcutKeyEvent, value: string, isMac: boolean): boolean {
  const parts = parseChord(value)

  if (!parts) {
    return false
  }

  const mod = isMac ? event.metaKey : event.ctrlKey
  const foreignModifier = isMac ? event.ctrlKey : event.metaKey

  return (
    !foreignModifier &&
    mod === parts.mod &&
    event.altKey === parts.alt &&
    event.shiftKey === parts.shift &&
    keyEventCode(event) === parts.code
  )
}

const PUNCTUATION_LABELS: Readonly<Record<string, string>> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`'
}

const NAMED_KEY_LABELS: Readonly<Record<string, { mac: string; other: string }>> = {
  Enter: { mac: '↩', other: 'Invio' },
  Backspace: { mac: '⌫', other: 'Backspace' },
  Delete: { mac: '⌦', other: 'Canc' },
  ArrowUp: { mac: '↑', other: '↑' },
  ArrowDown: { mac: '↓', other: '↓' },
  ArrowLeft: { mac: '←', other: '←' },
  ArrowRight: { mac: '→', other: '→' }
}

function keyCodeLabel(code: string, isMac: boolean): string {
  if (code.startsWith('Key')) {
    return code.slice(3)
  }

  if (code.startsWith('Digit')) {
    return code.slice(5)
  }

  const named = NAMED_KEY_LABELS[code]

  if (named) {
    return isMac ? named.mac : named.other
  }

  return PUNCTUATION_LABELS[code] ?? code
}

function modifierKeyLabels(parts: ChordParts, isMac: boolean): string[] {
  // Each platform's own order: macOS prints ⌥⇧⌘, Windows prints Ctrl+Alt+Shift.
  return isMac
    ? [parts.alt && '⌥', parts.shift && '⇧', parts.mod && '⌘'].filter((k): k is string => !!k)
    : [parts.mod && 'Ctrl', parts.alt && 'Alt', parts.shift && 'Shift'].filter(
        (k): k is string => !!k
      )
}

/** Key caps to draw for a chord, in the platform's own vocabulary. */
export function formatChordKeys(value: string, isMac: boolean): string[] {
  const parts = parseChord(value)
  return parts ? [...modifierKeyLabels(parts, isMac), keyCodeLabel(parts.code, isMac)] : []
}

const ACCELERATOR_KEYS: Readonly<Record<string, string>> = {
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

/** The chord as an Electron accelerator, for the macOS menu bar. */
export function chordToAccelerator(value: string): string | null {
  const parts = parseChord(value)

  if (!parts) {
    return null
  }

  const key = ACCELERATOR_KEYS[parts.code] ?? keyCodeLabel(parts.code, false)

  return [parts.mod && 'CommandOrControl', parts.alt && 'Alt', parts.shift && 'Shift', key]
    .filter(Boolean)
    .join('+')
}

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform)
}
