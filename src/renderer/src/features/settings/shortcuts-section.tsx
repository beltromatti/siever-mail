import { useEffect, useState } from 'react'
import { Keyboard, Lock, RotateCcw } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { IS_MAC } from '@renderer/lib/command-shortcuts'
import { messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, localized, messagesIn, type Language, type Messages } from '@shared/i18n'
import {
  COMMAND_GROUP_LABELS,
  commandChord,
  COMMANDS,
  findChordConflict,
  type CommandDefinition,
  type CommandGroup,
  type ShortcutOverrides
} from '@shared/commands'
import {
  formatChordKeys,
  KEY_CAPS,
  readShortcutEvent,
  validateChord,
  type ShortcutValidation
} from '@shared/shortcuts'
import { PLACES } from '@shared/places'

const MESSAGES = defineMessages({
  needsModifier: {
    en: (first: string, second: string) =>
      `It needs ${first} or ${second} with the key, or it would fire while you type.`,
    it: (first: string, second: string) =>
      `Serve ${first} o ${second} insieme al tasto, altrimenti scatterebbe mentre scrivi.`,
    de: (first: string, second: string) =>
      `Es braucht ${first} oder ${second} zusammen mit der Taste, sonst würde es beim Schreiben auslösen.`
  },
  reserved: {
    en: 'This combination already belongs to the system, to text editing or to SIEVER Mail.',
    it: 'Questa combinazione è già del sistema, della modifica del testo o di SIEVER Mail.',
    de: 'Diese Kombination ist bereits vom System, von der Textbearbeitung oder von SIEVER Mail belegt.'
  },
  format: {
    en: (enter: string) =>
      `This key can’t be used: choose a letter, a number, an F key or ${enter}.`,
    it: (enter: string) =>
      `Questo tasto non si può usare: scegli una lettera, un numero, un tasto F o ${enter}.`,
    de: (enter: string) =>
      `Diese Taste lässt sich nicht verwenden: Wählen Sie einen Buchstaben, eine Zahl, eine F-Taste oder ${enter}.`
  },
  macControl: {
    en: 'On a Mac, shortcuts use ⌘, not the Control key.',
    it: 'Su Mac le scorciatoie usano ⌘, non il tasto Control.',
    de: 'Auf dem Mac verwenden Tastenkürzel ⌘, nicht die Control-Taste.'
  },
  windowsKey: {
    en: (ctrl: string) => `The Windows key is reserved for the system: use ${ctrl} or Alt.`,
    it: (ctrl: string) => `Il tasto Windows è riservato al sistema: usa ${ctrl} o Alt.`,
    de: (ctrl: string) =>
      `Die Windows-Taste ist dem System vorbehalten: Verwenden Sie ${ctrl} oder Alt.`
  },
  conflict: {
    en: (label: string) => `It’s already the shortcut for “${label}”: change that one first.`,
    it: (label: string) => `È già la scorciatoia di «${label}»: cambia prima quella.`,
    de: (label: string) =>
      `Das ist bereits das Tastenkürzel für „${label}“: Ändern Sie zuerst dieses.`
  },
  selectAll: {
    en: 'Select all messages',
    it: 'Seleziona tutti i messaggi',
    de: 'Alle Nachrichten auswählen'
  },
  previousNext: {
    en: 'Previous / next message',
    it: 'Messaggio precedente / successivo',
    de: 'Vorherige / nächste Nachricht'
  },
  extendSelection: {
    en: 'Extend the selection',
    it: 'Estendi la selezione',
    de: 'Auswahl erweitern'
  },
  toggleSelection: {
    en: 'Add or remove a message from the selection',
    it: 'Aggiungi o togli un messaggio dalla selezione',
    de: 'Nachricht zur Auswahl hinzufügen oder daraus entfernen'
  },
  click: { en: 'click', it: 'clic', de: 'Klick' },
  openMessage: { en: 'Open the message', it: 'Apri il messaggio', de: 'Nachricht öffnen' },
  deleteSelection: {
    en: 'Delete the selection',
    it: 'Elimina la selezione',
    de: 'Auswahl löschen'
  },
  back: {
    en: 'Back: expanded reading, multiple selection, search',
    it: 'Indietro: lettura estesa, selezione multipla, ricerca',
    de: 'Zurück: erweiterte Ansicht, Mehrfachauswahl, Suche'
  },
  formatting: {
    en: 'Bold, italic, underline',
    it: 'Grassetto, corsivo, sottolineato',
    de: 'Fett, kursiv, unterstrichen'
  },
  undoRedo: { en: 'Undo / Redo', it: 'Annulla / Ripeti', de: 'Rückgängig / Wiederholen' },
  intro: {
    en: (mac: boolean) =>
      `Click a combination and press the new keys. They work across the whole window, even while you read a message${mac ? ', and appear in the menu bar' : ''}.`,
    it: (mac: boolean) =>
      `Clicca una combinazione e premi i tasti nuovi. Funzionano in tutta la finestra, anche mentre leggi un messaggio${mac ? ', e compaiono nella barra dei menu' : ''}.`,
    de: (mac: boolean) =>
      `Klicken Sie auf eine Kombination und drücken Sie die neuen Tasten. Sie funktionieren im ganzen Fenster, auch während Sie eine Nachricht lesen${mac ? ', und erscheinen in der Menüleiste' : ''}.`
  },
  restoreAll: { en: 'Restore all', it: 'Ripristina tutte', de: 'Alle zurücksetzen' },
  fixedKeys: {
    en: (mail: string) => `${mail} · Fixed keys`,
    it: (mail: string) => `${mail} · Tasti fissi`,
    de: (mail: string) => `${mail} · Feste Tasten`
  },
  recordingLabel: {
    en: (command: string) => `Recording the shortcut for ${command}`,
    it: (command: string) => `Registrazione della scorciatoia di ${command}`,
    de: (command: string) => `Tastenkürzel für ${command} wird aufgenommen`
  },
  changeLabel: {
    en: (command: string) => `Change the shortcut for ${command}`,
    it: (command: string) => `Cambia la scorciatoia di ${command}`,
    de: (command: string) => `Tastenkürzel für ${command} ändern`
  },
  pressKeys: {
    en: 'Press the keys… (Esc cancels)',
    it: 'Premi i tasti… (Esc annulla)',
    de: 'Tasten drücken… (Esc bricht ab)'
  }
})

/** Why a chord cannot be taken, in the interface's language. */
function rejection(
  reason: Exclude<ShortcutValidation, { ok: true }>['reason'],
  language: Language
): string {
  const m = messagesNow(MESSAGES)
  const caps = messagesIn(KEY_CAPS, language)

  switch (reason) {
    case 'modifier':
      return IS_MAC ? m.needsModifier('⌘', '⌥') : m.needsModifier(caps.ctrl, caps.alt)
    case 'reserved':
      return m.reserved
    case 'format':
      return m.format(caps.enter)
  }
}

const GROUP_ORDER: ReadonlyArray<CommandGroup> = [
  'app',
  'messages',
  'navigation',
  'writing',
  'reading',
  'calendar'
]

/** What a group's keys need, where it is not the whole window. */
const GROUP_NOTES = defineMessages({
  calendar: {
    en: 'In the Calendar, when you’re not typing in a field: the key alone is enough.',
    it: 'Nel Calendario, quando non stai scrivendo in un campo: basta il tasto.',
    de: 'Im Kalender, wenn Sie nicht gerade in ein Feld schreiben: Die Taste allein genügt.'
  }
}) satisfies Partial<Record<CommandGroup, unknown>>

/** Keys that always do the same thing, listed so they can be found here too, in the keyboard's language. */
function fixedKeys(
  m: Messages<typeof MESSAGES>,
  language: Language
): ReadonlyArray<{ label: string; keys: string[][] }> {
  return [
    { label: m.selectAll, keys: [formatChordKeys('Mod+KeyA', IS_MAC, language)] },
    {
      label: m.previousNext,
      keys: [
        formatChordKeys('ArrowUp', IS_MAC, language),
        formatChordKeys('ArrowDown', IS_MAC, language)
      ]
    },
    {
      label: m.extendSelection,
      keys: [
        [IS_MAC ? '⇧' : messagesIn(KEY_CAPS, language).shift, '↑'],
        [IS_MAC ? '⇧' : messagesIn(KEY_CAPS, language).shift, '↓']
      ]
    },
    {
      label: m.toggleSelection,
      keys: [[IS_MAC ? '⌘' : messagesIn(KEY_CAPS, language).ctrl, m.click]]
    },
    { label: m.openMessage, keys: [formatChordKeys('Enter', IS_MAC, language)] },
    {
      label: m.deleteSelection,
      keys: [
        formatChordKeys('Delete', IS_MAC, language),
        formatChordKeys('Backspace', IS_MAC, language)
      ]
    },
    { label: m.back, keys: [['Esc']] },
    {
      label: m.formatting,
      keys: [
        formatChordKeys('Mod+KeyB', IS_MAC, language),
        formatChordKeys('Mod+KeyI', IS_MAC, language),
        formatChordKeys('Mod+KeyU', IS_MAC, language)
      ]
    },
    {
      label: m.undoRedo,
      keys: [
        formatChordKeys('Mod+KeyZ', IS_MAC, language),
        formatChordKeys(IS_MAC ? 'Mod+Shift+KeyZ' : 'Mod+KeyY', IS_MAC, language)
      ]
    }
  ]
}

interface ShortcutsSectionProps {
  overrides: ShortcutOverrides
  onChange: (overrides: ShortcutOverrides) => void
}

/**
 * Settings › Shortcuts: every command with the keys it answers to, and a
 * recorder to change them. The extension's commands are listed with the
 * host's. Changes apply at once, to the window, the composer and the menu
 * bar alike.
 */
export function ShortcutsSection({
  overrides,
  onChange
}: ShortcutsSectionProps): React.JSX.Element {
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const groupNotes: Partial<Record<CommandGroup, string>> = useMessages(GROUP_NOTES)
  const groupLabels = useMessages(COMMAND_GROUP_LABELS)
  const { language } = useLanguage()
  const hasOverrides = Object.keys(overrides).some((id) =>
    COMMANDS.some((command) => command.id === id)
  )

  const assign = (command: CommandDefinition, chord: string | null): void => {
    const next = { ...overrides }

    if (chord === null || chord === command.defaultChord) {
      delete next[command.id]
    } else {
      next[command.id] = chord
    }

    onChange(next)
  }

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-[11px]">{m.intro(IS_MAC)}</p>
        {hasOverrides && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 text-[11.5px]"
            onClick={() => onChange({})}
          >
            <RotateCcw className="size-3.5" />
            {m.restoreAll}
          </Button>
        )}
      </div>

      {GROUP_ORDER.map((group) => {
        const commands = COMMANDS.filter((command) => command.group === group)

        if (commands.length === 0) {
          return null
        }

        return (
          <div key={group} className="bg-hover rounded-md">
            <div className="border-border/60 border-b px-3 py-2">
              <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
                {groupLabels[group]}
              </p>
              {groupNotes[group] && (
                <p className="text-muted-foreground mt-0.5 text-[11px]">{groupNotes[group]}</p>
              )}
            </div>
            <ul className="divide-border/50 divide-y">
              {commands.map((command) => (
                <ShortcutRow
                  key={command.id}
                  command={command}
                  overrides={overrides}
                  recording={recordingId === command.id}
                  onRecordingChange={(recording) => setRecordingId(recording ? command.id : null)}
                  onAssign={(chord) => assign(command, chord)}
                />
              ))}
            </ul>
          </div>
        )
      })}

      <div className="bg-hover rounded-md">
        <p className="text-muted-foreground border-border/60 border-b px-3 py-2 text-[11px] tracking-[0.08em] uppercase">
          {m.fixedKeys(places.mail)}
        </p>
        <ul className="divide-border/50 divide-y">
          {fixedKeys(m, language).map((entry) => (
            <li key={entry.label} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-[12px]">{entry.label}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {entry.keys.map((keys, index) => (
                  <ShortcutKeys key={index} keys={keys} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ShortcutRow({
  command,
  overrides,
  recording,
  onRecordingChange,
  onAssign
}: {
  command: CommandDefinition
  overrides: ShortcutOverrides
  recording: boolean
  onRecordingChange: (recording: boolean) => void
  onAssign: (chord: string | null) => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const m = useMessages(MESSAGES)
  const { language } = useLanguage()
  const label = localized(command.label, language)
  const chord = commandChord(command, overrides)
  const customized = chord !== command.defaultChord

  useEffect(() => {
    if (!recording) {
      return
    }

    const stop = (): void => {
      setPreview(null)
      onRecordingChange(false)
    }

    // Window, capture phase: ahead of everything else that listens for keys.
    // Radix closes Settings on Escape from a capturing listener on the
    // document, and the app's own commands would fire on the chord being
    // recorded — both have to be stopped before they see the event.
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (
        event.key === 'Escape' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        setError(null)
        stop()
        return
      }

      const reading = readShortcutEvent(event, IS_MAC, language)

      if (reading.kind === 'modifiers-only') {
        setPreview(reading.keys)
        return
      }

      if (reading.kind === 'unsupported-modifier') {
        const words = messagesNow(MESSAGES)
        setError(IS_MAC ? words.macControl : words.windowsKey(messagesIn(KEY_CAPS, language).ctrl))
        return
      }

      const validation = validateChord(reading.value, command.scope)

      if (!validation.ok) {
        setPreview(formatChordKeys(reading.value, IS_MAC, language))
        setError(rejection(validation.reason, language))
        return
      }

      const conflict = findChordConflict(command.id, validation.value, command.scope, overrides)

      if (conflict) {
        setPreview(formatChordKeys(validation.value, IS_MAC, language))
        setError(messagesNow(MESSAGES).conflict(localized(conflict.label, language)))
        return
      }

      setError(null)
      stop()
      onAssign(validation.value)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      event.stopPropagation()

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setPreview(null)
      }
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element | null

      if (!target?.closest(`[data-shortcut-recorder="${command.id}"]`)) {
        stop()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [command, language, onAssign, onRecordingChange, overrides, recording])

  return (
    <li className="px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium">{label}</p>
          <p className="text-muted-foreground text-[11px]">
            {localized(command.description, language)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1" data-shortcut-recorder={command.id}>
          {command.editable ? (
            <>
              {customized && !recording && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-7 gap-1 px-2 text-[11px]"
                  onClick={() => onAssign(null)}
                >
                  <RotateCcw className="size-3" />
                  <ShortcutKeys keys={formatChordKeys(command.defaultChord, IS_MAC, language)} />
                </Button>
              )}
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setPreview(null)
                  onRecordingChange(!recording)
                }}
                aria-label={recording ? m.recordingLabel(label) : m.changeLabel(label)}
                className={cn(
                  'border-input bg-input/45 hover:bg-input/70 focus-visible:ring-ring/60 flex h-7 min-w-36 items-center justify-center gap-2 rounded-md border px-2.5 text-[11.5px] outline-none focus-visible:ring-2',
                  recording && 'border-primary/70 ring-primary/35 ring-2'
                )}
              >
                {recording && !preview ? (
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Keyboard className="size-3.5" />
                    {m.pressKeys}
                  </span>
                ) : (
                  <ShortcutKeys keys={preview ?? formatChordKeys(chord, IS_MAC, language)} />
                )}
              </button>
            </>
          ) : (
            <span className="text-muted-foreground flex h-7 min-w-36 items-center justify-center gap-2 px-2.5 text-[11px]">
              <Lock className="size-3" />
              <ShortcutKeys keys={formatChordKeys(chord, IS_MAC, language)} />
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-destructive mt-1 text-right text-[11px]">{error}</p>}
    </li>
  )
}
