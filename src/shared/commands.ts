import extensionShared from '@app/extension/shared'

import {
  normalizeChord,
  scopesListenTogether,
  validateChord,
  type ShortcutScope
} from './shortcuts'

/**
 * Everything the app can be told to do from the keyboard or the macOS menu
 * bar, with the chord it answers to.
 *
 * One list for both processes: the renderer matches key presses and draws
 * the Settings page from it, the main process builds the menu bar from it,
 * and the extension adds its own commands through `@app/extension/shared`.
 * The user may change any chord marked `editable`; the rest are the
 * platform's own (select all, settings, zoom) and are shown, not changed.
 */

export type CommandGroup = 'messages' | 'navigation' | 'writing' | 'view' | 'calendar'

export const COMMAND_GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
  messages: 'Messaggi',
  navigation: 'Navigazione',
  writing: 'Scrittura',
  view: 'Vista',
  calendar: 'Calendario'
}

export interface CommandDefinition {
  id: string
  label: string
  description: string
  group: CommandGroup
  scope: ShortcutScope
  /** Platform-neutral chord (see `shared/shortcuts.ts`). */
  defaultChord: string
  editable: boolean
  /** Added by the extension; the renderer extension runs it. */
  fromExtension?: boolean
}

const HOST_COMMANDS = [
  {
    id: 'compose',
    label: 'Nuovo messaggio',
    description: "Scrive un messaggio dall'account selezionato.",
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+KeyN',
    editable: true
  },
  {
    id: 'reply',
    label: 'Rispondi',
    description: 'Risponde al mittente del messaggio aperto.',
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+KeyR',
    editable: true
  },
  {
    id: 'reply-all',
    label: 'Rispondi a tutti',
    description: 'Risponde al mittente e a tutti i destinatari.',
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyR',
    editable: true
  },
  {
    id: 'forward',
    label: 'Inoltra',
    description: 'Inoltra il messaggio aperto con i suoi allegati.',
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyF',
    editable: true
  },
  {
    id: 'archive',
    label: 'Archivia',
    description: "Sposta la selezione nell'archivio del suo account.",
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyA',
    editable: true
  },
  {
    id: 'move',
    label: 'Sposta in una cartella…',
    description: 'Sceglie la cartella in cui spostare la selezione.',
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyV',
    editable: true
  },
  {
    id: 'toggle-read',
    label: 'Segna come letto / non letto',
    description: 'Cambia lo stato di lettura della selezione.',
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyU',
    editable: true
  },
  {
    id: 'toggle-flag',
    label: 'Contrassegna',
    description: 'Mette o toglie il contrassegno alla selezione.',
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyL',
    editable: true
  },
  {
    id: 'mark-handled',
    label: 'Segna come gestito',
    description:
      'Il Segretario non conta più le conversazioni selezionate tra quelle da gestire, e chiude ciò che ti chiedevano.',
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyE',
    editable: true
  },
  {
    id: 'search',
    label: 'Cerca',
    description: 'Porta il cursore nella ricerca.',
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+KeyF',
    editable: true
  },
  {
    id: 'go-inbox',
    label: 'Vai alla Posta in arrivo',
    description: "Apre la Posta in arrivo: di tutti gli account, o dell'unico.",
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+Digit1',
    editable: true
  },
  {
    id: 'go-to-folder',
    label: 'Vai a una cartella…',
    description: "Cerca una cartella dell'account e la apre.",
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyG',
    editable: true
  },
  {
    id: 'check-mail',
    label: 'Controlla nuova posta',
    description: 'Chiede subito a ogni account se è arrivato qualcosa.',
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyN',
    editable: true
  },
  {
    id: 'send',
    label: 'Invia',
    description: 'Invia il messaggio che stai scrivendo.',
    group: 'writing',
    scope: 'composer',
    defaultChord: 'Mod+Enter',
    editable: true
  },
  {
    id: 'attach',
    label: 'Allega file…',
    description: 'Sceglie i file da allegare al messaggio.',
    group: 'writing',
    scope: 'composer',
    defaultChord: 'Mod+Shift+KeyA',
    editable: true
  },
  {
    id: 'segretario-write',
    label: 'Scrivi con il Segretario',
    description: 'Chiede al Segretario di scrivere o riscrivere il messaggio che stai scrivendo.',
    group: 'writing',
    scope: 'composer',
    defaultChord: 'Mod+KeyJ',
    editable: true
  },
  {
    id: 'show-cc',
    label: 'Mostra Cc e Ccn',
    description: 'Apre i campi per le copie e le copie nascoste.',
    group: 'writing',
    scope: 'composer',
    defaultChord: 'Mod+Shift+KeyC',
    editable: true
  },
  {
    id: 'segretario',
    label: 'Segretario',
    description: 'Apre e chiude il pannello del Segretario.',
    group: 'view',
    scope: 'main',
    defaultChord: 'Mod+KeyJ',
    editable: true
  },
  {
    id: 'settings',
    label: 'Impostazioni',
    description: 'Apre le impostazioni.',
    group: 'view',
    scope: 'main',
    defaultChord: 'Mod+Comma',
    editable: false
  },
  {
    id: 'reader-zoom-in',
    label: 'Ingrandisci messaggio',
    description: 'Ingrandisce il testo del messaggio aperto.',
    group: 'view',
    scope: 'main',
    defaultChord: 'Mod+Equal',
    editable: false
  },
  {
    id: 'reader-zoom-out',
    label: 'Riduci messaggio',
    description: 'Rimpicciolisce il testo del messaggio aperto.',
    group: 'view',
    scope: 'main',
    defaultChord: 'Mod+Minus',
    editable: false
  },
  {
    id: 'reader-zoom-reset',
    label: 'Dimensioni reali',
    description: 'Riporta il messaggio aperto al 100%.',
    group: 'view',
    scope: 'main',
    defaultChord: 'Mod+Digit0',
    editable: false
  },
  // The Calendario's, a key on its own as in Google Calendar: they listen only while it is in
  // front and nothing is typed in a field.
  {
    id: 'calendar-today',
    label: 'Vai a oggi',
    description: 'Porta il calendario al giorno di oggi.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyT',
    editable: true
  },
  {
    id: 'calendar-previous',
    label: 'Periodo precedente',
    description: 'Il giorno, la settimana, il mese o i giorni dell’agenda prima.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyK',
    editable: true
  },
  {
    id: 'calendar-next',
    label: 'Periodo successivo',
    description: 'Il giorno, la settimana, il mese o i giorni dell’agenda dopo.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyJ',
    editable: true
  },
  {
    id: 'calendar-view-agenda',
    label: 'Vista Agenda',
    description: 'Mostra i giorni che vengono in elenco, con le scadenze.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyA',
    editable: true
  },
  {
    id: 'calendar-view-day',
    label: 'Vista Giorno',
    description: 'Mostra un giorno, ora per ora.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyD',
    editable: true
  },
  {
    id: 'calendar-view-week',
    label: 'Vista Settimana',
    description: 'Mostra la settimana, da lunedì a domenica.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyW',
    editable: true
  },
  {
    id: 'calendar-view-month',
    label: 'Vista Mese',
    description: 'Mostra il mese intero.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyM',
    editable: true
  },
  {
    id: 'calendar-new-event',
    label: 'Nuovo evento',
    description: 'Apre un evento nuovo nel giorno che stai guardando.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyC',
    editable: true
  },
  {
    id: 'calendar-close-event',
    label: 'Chiudi l’evento',
    description: 'Chiude il pannello dell’evento aperto.',
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'Escape',
    editable: true
  }
] as const satisfies ReadonlyArray<CommandDefinition>

export type HostCommandId = (typeof HOST_COMMANDS)[number]['id']

/** The host's commands, then the extension's — which act on the main window. */
export const COMMANDS: ReadonlyArray<CommandDefinition> = [
  ...HOST_COMMANDS,
  ...extensionShared.commands.map((command) => ({
    ...command,
    group: 'messages' as const,
    scope: 'main' as const,
    editable: true,
    fromExtension: true
  }))
]

const COMMANDS_BY_ID: ReadonlyMap<string, CommandDefinition> = new Map(
  COMMANDS.map((command) => [command.id, command])
)

export function findCommand(id: string): CommandDefinition | undefined {
  return COMMANDS_BY_ID.get(id)
}

/** The chords the user chose, by command id, over the defaults. */
export type ShortcutOverrides = Readonly<Record<string, string>>

/** The chord a command answers to now. */
export function commandChord(command: CommandDefinition, overrides: ShortcutOverrides): string {
  return (command.editable && overrides[command.id]) || command.defaultChord
}

/**
 * The command listening alongside `scope` (`scopesListenTogether`) that
 * already answers to `chord`, other than `commandId` — two commands on one
 * chord would leave one never firing, or both firing at once.
 */
export function findChordConflict(
  commandId: string,
  chord: string,
  scope: ShortcutScope,
  overrides: ShortcutOverrides
): CommandDefinition | undefined {
  return COMMANDS.find(
    (command) =>
      command.id !== commandId &&
      scopesListenTogether(command.scope, scope) &&
      commandChord(command, overrides) === chord
  )
}

/**
 * Overrides as they may be stored: each one a valid chord for its command's
 * scope, different from the default (which needs no override), clashing
 * with no other command. Chords for commands this build does not have — an
 * extension's, in a build without it — are kept as written, so switching
 * builds loses nothing.
 */
export function sanitizeShortcutOverrides(overrides: Record<string, unknown>): ShortcutOverrides {
  const result: Record<string, string> = {}

  for (const [commandId, value] of Object.entries(overrides)) {
    if (typeof value !== 'string') {
      continue
    }

    const command = findCommand(commandId)

    if (!command) {
      const chord = normalizeChord(value)

      if (chord) {
        result[commandId] = chord
      }
      continue
    }

    const validation = validateChord(value, command.scope)

    if (command.editable && validation.ok && validation.value !== command.defaultChord) {
      result[commandId] = validation.value
    }
  }

  for (const commandId of Object.keys(result)) {
    const command = findCommand(commandId)

    if (command && findChordConflict(commandId, result[commandId], command.scope, result)) {
      delete result[commandId]
    }
  }

  return result
}
