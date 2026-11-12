import extensionShared from '@app/extension/shared'

import { defineMessages, type Localized } from './i18n'
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

/** Where a command belongs, app by app as the rail has them (§13.1): SIEVER Mail's own, then each app's. */
export type CommandGroup = 'app' | 'messages' | 'navigation' | 'writing' | 'reading' | 'calendar'

export const COMMAND_GROUP_LABELS = defineMessages({
  app: { en: 'SIEVER Mail', it: 'SIEVER Mail', de: 'SIEVER Mail' },
  messages: { en: 'Mail · Messages', it: 'Posta · Messaggi', de: 'E-Mail · Nachrichten' },
  navigation: { en: 'Mail · Navigation', it: 'Posta · Navigazione', de: 'E-Mail · Navigation' },
  writing: { en: 'Mail · Writing', it: 'Posta · Scrittura', de: 'E-Mail · Verfassen' },
  reading: { en: 'Mail · Reading', it: 'Posta · Lettura', de: 'E-Mail · Lesen' },
  calendar: { en: 'Calendar', it: 'Calendario', de: 'Kalender' }
}) satisfies Record<CommandGroup, unknown>

export interface CommandDefinition {
  id: string
  /** In every language: the app's own words, or an extension's (one string, or one per language). */
  label: Localized
  description: Localized
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
    label: { en: 'New message', it: 'Nuovo messaggio', de: 'Neue Nachricht' },
    description: {
      en: 'Writes a message from the mailbox in front of you.',
      it: 'Scrive un messaggio dalla casella che hai davanti.',
      de: 'Schreibt eine Nachricht aus dem Postfach, das Sie gerade vor sich haben.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+KeyN',
    editable: true
  },
  {
    id: 'reply',
    label: { en: 'Reply', it: 'Rispondi', de: 'Antworten' },
    description: {
      en: 'Replies to the sender of the open message.',
      it: 'Risponde al mittente del messaggio aperto.',
      de: 'Antwortet dem Absender der geöffneten Nachricht.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+KeyR',
    editable: true
  },
  {
    id: 'reply-all',
    label: { en: 'Reply all', it: 'Rispondi a tutti', de: 'Allen antworten' },
    description: {
      en: 'Replies to the sender and to every recipient.',
      it: 'Risponde al mittente e a tutti i destinatari.',
      de: 'Antwortet dem Absender und allen Empfängern.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyR',
    editable: true
  },
  {
    id: 'forward',
    label: { en: 'Forward', it: 'Inoltra', de: 'Weiterleiten' },
    description: {
      en: 'Forwards the open message with its attachments.',
      it: 'Inoltra il messaggio aperto con i suoi allegati.',
      de: 'Leitet die geöffnete Nachricht mit ihren Anhängen weiter.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyF',
    editable: true
  },
  {
    id: 'archive',
    label: { en: 'Archive', it: 'Archivia', de: 'Archivieren' },
    description: {
      en: 'Archives the selection, each message in its own mailbox.',
      it: 'Archivia la selezione, ogni messaggio nella sua casella.',
      de: 'Archiviert die Auswahl, jede Nachricht in ihrem eigenen Postfach.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyA',
    editable: true
  },
  {
    id: 'move',
    label: {
      en: 'Move to a folder…',
      it: 'Sposta in una cartella…',
      de: 'In einen Ordner verschieben…'
    },
    description: {
      en: 'Chooses the folder to move the selection to.',
      it: 'Sceglie la cartella in cui spostare la selezione.',
      de: 'Wählt den Ordner, in den die Auswahl verschoben wird.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyV',
    editable: true
  },
  {
    id: 'toggle-read',
    label: {
      en: 'Mark as read / unread',
      it: 'Segna come letto / non letto',
      de: 'Als gelesen / ungelesen markieren'
    },
    description: {
      en: 'Changes whether the selection is read.',
      it: 'Cambia lo stato di lettura della selezione.',
      de: 'Ändert den Lesestatus der Auswahl.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyU',
    editable: true
  },
  {
    id: 'toggle-flag',
    label: { en: 'Flag', it: 'Contrassegna', de: 'Markieren' },
    description: {
      en: 'Flags or unflags the selection.',
      it: 'Mette o toglie il contrassegno alla selezione.',
      de: 'Setzt oder entfernt die Markierung der Auswahl.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyL',
    editable: true
  },
  {
    id: 'mark-handled',
    label: { en: 'Mark as handled', it: 'Segna come gestito', de: 'Als erledigt markieren' },
    description: {
      en: 'The Segretario no longer counts the selected conversations among those to handle, and closes what you were asked.',
      it: 'Il Segretario non conta più le conversazioni selezionate tra quelle da gestire, e chiude ciò che ti chiedevano.',
      de: 'Der Segretario zählt die ausgewählten Unterhaltungen nicht mehr zu denen, die zu erledigen sind, und schließt ab, worum Sie gebeten wurden.'
    },
    group: 'messages',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyE',
    editable: true
  },
  {
    id: 'search',
    label: { en: 'Search', it: 'Cerca', de: 'Suchen' },
    description: {
      en: 'Puts the cursor in the search of the app in front of you.',
      it: 'Porta il cursore nella ricerca dell’app che hai davanti.',
      de: 'Setzt den Cursor in die Suche der App, die Sie gerade vor sich haben.'
    },
    group: 'app',
    scope: 'main',
    defaultChord: 'Mod+KeyF',
    editable: true
  },
  {
    id: 'go-inbox',
    label: { en: 'Go to Inbox', it: 'Vai alla Posta in arrivo', de: 'Zum Posteingang' },
    description: {
      en: 'Opens the Inbox: of every mailbox, or of the only one.',
      it: "Apre la Posta in arrivo: di tutte le caselle, o dell'unica.",
      de: 'Öffnet den Posteingang: aller Postfächer oder des einzigen.'
    },
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+Digit1',
    editable: true
  },
  {
    id: 'go-to-folder',
    label: { en: 'Go to a folder…', it: 'Vai a una cartella…', de: 'Zu einem Ordner…' },
    description: {
      en: 'Finds a folder of the mailbox and opens it.',
      it: 'Cerca una cartella della casella e la apre.',
      de: 'Sucht einen Ordner des Postfachs und öffnet ihn.'
    },
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyG',
    editable: true
  },
  {
    id: 'check-mail',
    label: { en: 'Check for new mail', it: 'Controlla nuova posta', de: 'Neue E-Mails abrufen' },
    description: {
      en: 'Asks every mailbox at once whether something has arrived.',
      it: 'Chiede subito a ogni casella se è arrivato qualcosa.',
      de: 'Fragt sofort jedes Postfach, ob etwas angekommen ist.'
    },
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+Shift+KeyN',
    editable: true
  },
  {
    id: 'next-tab',
    label: { en: 'Next tab', it: 'Scheda successiva', de: 'Nächster Tab' },
    description: {
      en: 'In the reading pane, goes from the message you are reading to the ones you are writing, one after the other.',
      it: 'Nel riquadro di lettura, passa dal messaggio letto a quelli che stai scrivendo, uno dopo l’altro.',
      de: 'Wechselt im Lesebereich von der gelesenen Nachricht zu denen, die Sie schreiben, eine nach der anderen.'
    },
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+Shift+BracketRight',
    editable: true
  },
  {
    id: 'previous-tab',
    label: { en: 'Previous tab', it: 'Scheda precedente', de: 'Vorheriger Tab' },
    description: {
      en: 'In the reading pane, goes back to the tab before.',
      it: 'Nel riquadro di lettura, torna alla scheda prima.',
      de: 'Kehrt im Lesebereich zum vorherigen Tab zurück.'
    },
    group: 'navigation',
    scope: 'main',
    defaultChord: 'Mod+Shift+BracketLeft',
    editable: true
  },
  {
    id: 'send',
    label: { en: 'Send', it: 'Invia', de: 'Senden' },
    description: {
      en: 'Sends the message you are writing.',
      it: 'Invia il messaggio che stai scrivendo.',
      de: 'Sendet die Nachricht, die Sie schreiben.'
    },
    group: 'writing',
    scope: 'composer',
    defaultChord: 'Mod+Enter',
    editable: true
  },
  {
    id: 'attach',
    label: { en: 'Attach files…', it: 'Allega file…', de: 'Dateien anhängen…' },
    description: {
      en: 'Chooses the files to attach to the message.',
      it: 'Sceglie i file da allegare al messaggio.',
      de: 'Wählt die Dateien, die an die Nachricht angehängt werden.'
    },
    group: 'writing',
    scope: 'composer',
    defaultChord: 'Mod+Shift+KeyA',
    editable: true
  },
  {
    id: 'show-cc',
    label: { en: 'Show Cc and Bcc', it: 'Mostra Cc e Ccn', de: 'Cc und Bcc anzeigen' },
    description: {
      en: 'Opens the fields for copies and blind copies.',
      it: 'Apre i campi per le copie e le copie nascoste.',
      de: 'Öffnet die Felder für Kopien und Blindkopien.'
    },
    group: 'writing',
    scope: 'composer',
    defaultChord: 'Mod+Shift+KeyC',
    editable: true
  },
  {
    id: 'segretario',
    label: { en: 'Segretario', it: 'Segretario', de: 'Segretario' },
    description: {
      en: 'Opens and closes the Segretario’s panel; while you write a message, hands it over, with the message in view.',
      it: 'Apre e chiude il pannello del Segretario; mentre scrivi un messaggio, gli passa la parola, con il messaggio davanti.',
      de: 'Öffnet und schließt das Panel des Segretario; während Sie eine Nachricht schreiben, übergibt es ihm das Wort, mit der Nachricht vor Augen.'
    },
    group: 'app',
    scope: 'main',
    defaultChord: 'Mod+KeyJ',
    editable: true
  },
  {
    id: 'settings',
    label: { en: 'Settings', it: 'Impostazioni', de: 'Einstellungen' },
    description: {
      en: 'Opens the settings.',
      it: 'Apre le impostazioni.',
      de: 'Öffnet die Einstellungen.'
    },
    group: 'app',
    scope: 'main',
    defaultChord: 'Mod+Comma',
    editable: false
  },
  {
    id: 'reader-zoom-in',
    label: { en: 'Zoom in on message', it: 'Ingrandisci messaggio', de: 'Nachricht vergrößern' },
    description: {
      en: 'Enlarges the text of the open message.',
      it: 'Ingrandisce il testo del messaggio aperto.',
      de: 'Vergrößert den Text der geöffneten Nachricht.'
    },
    group: 'reading',
    scope: 'main',
    defaultChord: 'Mod+Equal',
    editable: false
  },
  {
    id: 'reader-zoom-out',
    label: { en: 'Zoom out on message', it: 'Riduci messaggio', de: 'Nachricht verkleinern' },
    description: {
      en: 'Shrinks the text of the open message.',
      it: 'Rimpicciolisce il testo del messaggio aperto.',
      de: 'Verkleinert den Text der geöffneten Nachricht.'
    },
    group: 'reading',
    scope: 'main',
    defaultChord: 'Mod+Minus',
    editable: false
  },
  {
    id: 'reader-zoom-reset',
    label: { en: 'Actual size', it: 'Dimensioni reali', de: 'Originalgröße' },
    description: {
      en: 'Brings the open message back to 100%.',
      it: 'Riporta il messaggio aperto al 100%.',
      de: 'Setzt die geöffnete Nachricht auf 100 % zurück.'
    },
    group: 'reading',
    scope: 'main',
    defaultChord: 'Mod+Digit0',
    editable: false
  },
  // The Calendario's, a key on its own as in Google Calendar: they listen only while it is in
  // front and nothing is typed in a field.
  {
    id: 'calendar-today',
    label: { en: 'Go to today', it: 'Vai a oggi', de: 'Zu heute' },
    description: {
      en: 'Brings the calendar to today.',
      it: 'Porta il calendario al giorno di oggi.',
      de: 'Bringt den Kalender zum heutigen Tag.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyT',
    editable: true
  },
  {
    id: 'calendar-previous',
    label: { en: 'Previous period', it: 'Periodo precedente', de: 'Vorheriger Zeitraum' },
    description: {
      en: 'The day, week, month or agenda days before.',
      it: 'Il giorno, la settimana, il mese o i giorni dell’agenda prima.',
      de: 'Der Tag, die Woche, der Monat oder die Agenda-Tage davor.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyK',
    editable: true
  },
  {
    id: 'calendar-next',
    label: { en: 'Next period', it: 'Periodo successivo', de: 'Nächster Zeitraum' },
    description: {
      en: 'The day, week, month or agenda days after.',
      it: 'Il giorno, la settimana, il mese o i giorni dell’agenda dopo.',
      de: 'Der Tag, die Woche, der Monat oder die Agenda-Tage danach.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyJ',
    editable: true
  },
  {
    id: 'calendar-view-agenda',
    label: { en: 'Agenda view', it: 'Vista Agenda', de: 'Agenda-Ansicht' },
    description: {
      en: 'Shows the coming days as a list, with the deadlines.',
      it: 'Mostra i giorni che vengono in elenco, con le scadenze.',
      de: 'Zeigt die kommenden Tage als Liste, mit den Fristen.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyA',
    editable: true
  },
  {
    id: 'calendar-view-day',
    label: { en: 'Day view', it: 'Vista Giorno', de: 'Tagesansicht' },
    description: {
      en: 'Shows a day, hour by hour.',
      it: 'Mostra un giorno, ora per ora.',
      de: 'Zeigt einen Tag, Stunde für Stunde.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyD',
    editable: true
  },
  {
    id: 'calendar-view-week',
    label: { en: 'Week view', it: 'Vista Settimana', de: 'Wochenansicht' },
    description: {
      en: 'Shows the whole week.',
      it: 'Mostra la settimana intera.',
      de: 'Zeigt die ganze Woche.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyW',
    editable: true
  },
  {
    id: 'calendar-view-month',
    label: { en: 'Month view', it: 'Vista Mese', de: 'Monatsansicht' },
    description: {
      en: 'Shows the whole month.',
      it: 'Mostra il mese intero.',
      de: 'Zeigt den ganzen Monat.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyM',
    editable: true
  },
  {
    id: 'calendar-new-event',
    label: { en: 'New event', it: 'Nuovo evento', de: 'Neuer Termin' },
    description: {
      en: 'Opens a new event on the day you are looking at.',
      it: 'Apre un evento nuovo nel giorno che stai guardando.',
      de: 'Öffnet einen neuen Termin an dem Tag, den Sie gerade ansehen.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyC',
    editable: true
  },
  {
    id: 'calendar-close-event',
    label: { en: 'Close the event', it: 'Chiudi l’evento', de: 'Termin schließen' },
    description: {
      en: 'Closes the panel of the open event.',
      it: 'Chiude il pannello dell’evento aperto.',
      de: 'Schließt das Panel des geöffneten Termins.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'Escape',
    editable: true
  },
  {
    id: 'calendar-edit-event',
    label: { en: 'Edit the event', it: 'Modifica l’evento', de: 'Termin bearbeiten' },
    description: {
      en: 'Opens the open event in the editor.',
      it: 'Apre nell’editor l’evento aperto.',
      de: 'Öffnet den geöffneten Termin im Editor.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'KeyE',
    editable: true
  },
  {
    id: 'calendar-duplicate-event',
    label: { en: 'Duplicate the event', it: 'Duplica l’evento', de: 'Termin duplizieren' },
    description: {
      en: 'Opens a new event with everything of the open one, to change what differs.',
      it: 'Apre un evento nuovo con tutto quello aperto, per cambiare ciò che è diverso.',
      de: 'Öffnet einen neuen Termin mit allem des geöffneten, um zu ändern, was anders ist.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'Mod+KeyD',
    editable: true
  },
  // Backspace, the delete key of a Mac keyboard; the Delete key does the same while it is the chord.
  {
    id: 'calendar-delete-event',
    label: { en: 'Delete the event', it: 'Elimina l’evento', de: 'Termin löschen' },
    description: {
      en: 'Deletes the open event, after asking; of a recurring one, this event or the whole series.',
      it: 'Elimina l’evento aperto, dopo averlo chiesto; di uno che si ripete, questo o tutta la serie.',
      de: 'Löscht den geöffneten Termin nach Rückfrage; bei einem wiederkehrenden diesen oder die ganze Serie.'
    },
    group: 'calendar',
    scope: 'calendar',
    defaultChord: 'Backspace',
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
