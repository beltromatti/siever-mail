import { useEffect, useState } from 'react'
import { Keyboard, Lock, RotateCcw } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { IS_MAC } from '@renderer/lib/command-shortcuts'
import { cn } from '@renderer/lib/utils'
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
  readShortcutEvent,
  validateChord,
  type ShortcutValidation
} from '@shared/shortcuts'

const REJECTION_MESSAGES: Record<Exclude<ShortcutValidation, { ok: true }>['reason'], string> = {
  modifier: IS_MAC
    ? 'Serve ⌘ o ⌥ insieme al tasto, altrimenti scatterebbe mentre scrivi.'
    : 'Serve Ctrl o Alt insieme al tasto, altrimenti scatterebbe mentre scrivi.',
  reserved: 'Questa combinazione è già del sistema, della modifica del testo o di SIEVER Mail.',
  format: 'Questo tasto non si può usare: scegli una lettera, un numero, un tasto F o Invio.'
}

const GROUP_ORDER: ReadonlyArray<CommandGroup> = ['messages', 'navigation', 'writing', 'view']

/** Keys that always do the same thing, listed so they can be found here too. */
const FIXED_KEYS: ReadonlyArray<{ label: string; keys: string[][] }> = [
  { label: 'Seleziona tutti i messaggi', keys: [formatChordKeys('Mod+KeyA', IS_MAC)] },
  {
    label: 'Messaggio precedente / successivo',
    keys: [formatChordKeys('ArrowUp', IS_MAC), formatChordKeys('ArrowDown', IS_MAC)]
  },
  {
    label: 'Estendi la selezione',
    keys: [
      [IS_MAC ? '⇧' : 'Shift', '↑'],
      [IS_MAC ? '⇧' : 'Shift', '↓']
    ]
  },
  {
    label: 'Aggiungi o togli un messaggio dalla selezione',
    keys: [[IS_MAC ? '⌘' : 'Ctrl', 'clic']]
  },
  { label: 'Apri il messaggio', keys: [formatChordKeys('Enter', IS_MAC)] },
  {
    label: 'Elimina la selezione',
    keys: [formatChordKeys('Delete', IS_MAC), formatChordKeys('Backspace', IS_MAC)]
  },
  { label: 'Indietro: lettura estesa, selezione multipla, ricerca', keys: [['Esc']] },
  {
    label: 'Grassetto, corsivo, sottolineato',
    keys: [
      formatChordKeys('Mod+KeyB', IS_MAC),
      formatChordKeys('Mod+KeyI', IS_MAC),
      formatChordKeys('Mod+KeyU', IS_MAC)
    ]
  },
  {
    label: 'Annulla / Ripeti',
    keys: [
      formatChordKeys('Mod+KeyZ', IS_MAC),
      formatChordKeys(IS_MAC ? 'Mod+Shift+KeyZ' : 'Mod+KeyY', IS_MAC)
    ]
  }
]

interface ShortcutsSectionProps {
  overrides: ShortcutOverrides
  onChange: (overrides: ShortcutOverrides) => void
}

/**
 * Settings › Scorciatoie: every command with the keys it answers to, and a
 * recorder to change them. The extension's commands are listed with the
 * host's. Changes apply at once, to the window, the composer and the menu
 * bar alike.
 */
export function ShortcutsSection({
  overrides,
  onChange
}: ShortcutsSectionProps): React.JSX.Element {
  const [recordingId, setRecordingId] = useState<string | null>(null)
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
        <p className="text-muted-foreground text-[11px]">
          Clicca una combinazione e premi i tasti nuovi. Funzionano in tutta la finestra, anche
          mentre leggi un messaggio{IS_MAC ? ', e compaiono nella barra dei menu' : ''}.
        </p>
        {hasOverrides && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 text-[11.5px]"
            onClick={() => onChange({})}
          >
            <RotateCcw className="size-3.5" />
            Ripristina tutte
          </Button>
        )}
      </div>

      {GROUP_ORDER.map((group) => {
        const commands = COMMANDS.filter((command) => command.group === group)

        if (commands.length === 0) {
          return null
        }

        return (
          <div key={group} className="border-border bg-card/55 rounded-md border">
            <p className="text-muted-foreground border-border/60 border-b px-3 py-2 text-[11px] tracking-[0.08em] uppercase">
              {COMMAND_GROUP_LABELS[group]}
            </p>
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

      <div className="border-border bg-card/55 rounded-md border">
        <p className="text-muted-foreground border-border/60 border-b px-3 py-2 text-[11px] tracking-[0.08em] uppercase">
          Sempre disponibili
        </p>
        <ul className="divide-border/50 divide-y">
          {FIXED_KEYS.map((entry) => (
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

      const reading = readShortcutEvent(event, IS_MAC)

      if (reading.kind === 'modifiers-only') {
        setPreview(reading.keys)
        return
      }

      if (reading.kind === 'unsupported-modifier') {
        setError(
          IS_MAC
            ? 'Su Mac le scorciatoie usano ⌘, non il tasto Control.'
            : 'Il tasto Windows è riservato al sistema: usa Ctrl o Alt.'
        )
        return
      }

      const validation = validateChord(reading.value, command.scope)

      if (!validation.ok) {
        setPreview(formatChordKeys(reading.value, IS_MAC))
        setError(REJECTION_MESSAGES[validation.reason])
        return
      }

      const conflict = findChordConflict(command.id, validation.value, command.scope, overrides)

      if (conflict) {
        setPreview(formatChordKeys(validation.value, IS_MAC))
        setError(`È già la scorciatoia di «${conflict.label}»: cambia prima quella.`)
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
  }, [command, onAssign, onRecordingChange, overrides, recording])

  return (
    <li className="px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium">{command.label}</p>
          <p className="text-muted-foreground text-[11px]">{command.description}</p>
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
                  <ShortcutKeys keys={formatChordKeys(command.defaultChord, IS_MAC)} />
                </Button>
              )}
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setPreview(null)
                  onRecordingChange(!recording)
                }}
                aria-label={
                  recording
                    ? `Registrazione della scorciatoia di ${command.label}`
                    : `Cambia la scorciatoia di ${command.label}`
                }
                className={cn(
                  'border-input bg-input/45 hover:bg-input/70 focus-visible:ring-ring/60 flex h-7 min-w-36 items-center justify-center gap-2 rounded-md border px-2.5 text-[11.5px] outline-none focus-visible:ring-2',
                  recording && 'border-primary/70 ring-primary/35 ring-2'
                )}
              >
                {recording && !preview ? (
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Keyboard className="size-3.5" />
                    Premi i tasti… (Esc annulla)
                  </span>
                ) : (
                  <ShortcutKeys keys={preview ?? formatChordKeys(chord, IS_MAC)} />
                )}
              </button>
            </>
          ) : (
            <span className="text-muted-foreground flex h-7 min-w-36 items-center justify-center gap-2 px-2.5 text-[11px]">
              <Lock className="size-3" />
              <ShortcutKeys keys={formatChordKeys(chord, IS_MAC)} />
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-destructive mt-1 text-right text-[11px]">{error}</p>}
    </li>
  )
}
