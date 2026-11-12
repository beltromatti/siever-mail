import { defineMessages } from '@shared/i18n'

/** What the Posta says from `useMailApp`: its notices, questions, toasts and menus. */
export const MESSAGES = defineMessages({
  // The view's names.
  allMailboxes: { en: 'all mailboxes', it: 'tutte le caselle', de: 'alle Postfächer' },
  project: { en: 'Project', it: 'Progetto', de: 'Projekt' },
  segretarioSearch: {
    en: 'The Segretario’s search',
    it: 'Ricerca del Segretario',
    de: 'Suche des Segretario'
  },
  conversations: { en: 'Conversations', it: 'Conversazioni', de: 'Unterhaltungen' },

  // What the Segretario is told the user looks at, as its panel shows it.
  firstSelected: {
    en: (limit: number, total: string) => `The first ${limit} of the ${total} messages selected`,
    it: (limit: number, total: string) => `I primi ${limit} dei ${total} messaggi selezionati`,
    de: (limit: number, total: string) =>
      `Die ersten ${limit} der ${total} ausgewählten Nachrichten`
  },
  selected: {
    en: (count: number) => `${count} messages selected`,
    it: (count: number) => `${count} messaggi selezionati`,
    de: (count: number) => `${count} Nachrichten ausgewählt`
  },
  quoted: {
    en: (text: string) => `“${text}”`,
    it: (text: string) => `«${text}»`,
    de: (text: string) => `„${text}“`
  },
  noSubject: { en: 'No subject', it: 'Senza oggetto', de: 'Kein Betreff' },

  // Loading.
  foldersNotLoaded: {
    en: 'The folders could not be loaded.',
    it: 'Errore nel caricamento cartelle.',
    de: 'Die Ordner konnten nicht geladen werden.'
  },
  messagesNotLoaded: {
    en: 'The messages could not be loaded.',
    it: 'Errore nel caricamento email.',
    de: 'Die Nachrichten konnten nicht geladen werden.'
  },
  messageNotLoaded: {
    en: 'The message could not be loaded.',
    it: 'Errore nel caricamento messaggio.',
    de: 'Die Nachricht konnte nicht geladen werden.'
  },
  accountFoldersUnavailable: {
    en: 'The account’s folders are not available.',
    it: "Cartelle dell'account non disponibili.",
    de: 'Die Ordner des Kontos sind nicht verfügbar.'
  },
  syncing: { en: 'Syncing…', it: 'Sincronizzazione in corso…', de: 'Wird synchronisiert…' },
  loadingMessages: {
    en: 'Loading messages…',
    it: 'Caricamento messaggi…',
    de: 'Nachrichten werden geladen…'
  },

  // The accounts.
  disconnectTitle: {
    en: (email: string | null) => `Disconnect ${email ?? 'the mailbox'}?`,
    it: (email: string | null) => `Scollegare ${email ?? 'la casella'}?`,
    de: (email: string | null) => `${email ?? 'Das Postfach'} trennen?`
  },
  disconnect: { en: 'Disconnect', it: 'Scollega', de: 'Trennen' },
  notDisconnected: {
    en: 'The mailbox was not disconnected.',
    it: 'La casella non si è scollegata.',
    de: 'Das Postfach wurde nicht getrennt.'
  },
  accountDataNotCleared: {
    en: 'The account’s data could not be cleared.',
    it: 'Cancellazione dati account non riuscita.',
    de: 'Die Daten des Kontos konnten nicht gelöscht werden.'
  },
  databaseNotCleared: {
    en: 'The database could not be cleared.',
    it: 'Cancellazione totale database non riuscita.',
    de: 'Die Datenbank konnte nicht geleert werden.'
  },

  // Acting on messages.
  stayedWhereTheyWere: {
    en: (message: string, count: number) => `${message} (${count} messages stay where they were)`,
    it: (message: string, count: number) => `${message} (${count} messaggi restano dov'erano)`,
    de: (message: string, count: number) =>
      `${message} (${count} Nachrichten bleiben, wo sie waren)`
  },
  markRead: { en: 'Mark read', it: 'Segna letta', de: 'Als gelesen markieren' },
  markUnread: { en: 'Mark unread', it: 'Segna non letta', de: 'Als ungelesen markieren' },
  readNotUpdated: {
    en: 'Read or unread could not be updated.',
    it: 'Aggiornamento stato letto/non letto non riuscito.',
    de: 'Der Lesestatus konnte nicht aktualisiert werden.'
  },
  flagNotUpdated: {
    en: 'The flag could not be updated.',
    it: 'Aggiornamento contrassegno non riuscito.',
    de: 'Die Markierung konnte nicht aktualisiert werden.'
  },
  nothingToMark: {
    en: 'Nothing to mark: nothing is asked of you in these conversations',
    it: 'Niente da segnare: in queste conversazioni non ti chiedono niente',
    de: 'Nichts zu markieren: In diesen Unterhaltungen wird nichts von Ihnen erwartet'
  },
  handledOne: {
    en: 'Conversation marked as handled',
    it: 'Conversazione segnata come gestita',
    de: 'Unterhaltung als erledigt markiert'
  },
  handledOther: {
    en: (count: string) => `${count} conversations marked as handled`,
    it: (count: string) => `${count} conversazioni segnate come gestite`,
    de: (count: string) => `${count} Unterhaltungen als erledigt markiert`
  },
  notHandled: {
    en: 'Not marked as handled',
    it: 'Non segnate come gestite',
    de: 'Nicht als erledigt markiert'
  },
  deleteForeverOne: {
    en: 'Delete the message for good?',
    it: 'Eliminare definitivamente il messaggio?',
    de: 'Die Nachricht endgültig löschen?'
  },
  deleteForeverOther: {
    en: (count: number) => `Delete ${count} messages for good?`,
    it: (count: number) => `Eliminare definitivamente ${count} messaggi?`,
    de: (count: number) => `${count} Nachrichten endgültig löschen?`
  },
  deleteForeverText: {
    en: 'They are in the Trash: deleted from here, they can no longer be recovered.',
    it: 'Sono nel Cestino: eliminati da qui non si possono più recuperare.',
    de: 'Sie liegen im Papierkorb: Von hier gelöscht, lassen sie sich nicht mehr wiederherstellen.'
  },
  deleteForever: {
    en: 'Delete for good',
    it: 'Elimina definitivamente',
    de: 'Endgültig löschen'
  },
  notDeleted: {
    en: 'The messages could not be deleted.',
    it: 'Eliminazione email non riuscita.',
    de: 'Die Nachrichten konnten nicht gelöscht werden.'
  },
  mixedAccountsTitle: {
    en: 'Messages from different accounts',
    it: 'Messaggi di account diversi',
    de: 'Nachrichten aus verschiedenen Konten'
  },
  mixedAccountsText: {
    en: (accounts: string, kept: string) =>
      `The selection holds messages from ${accounts}. Each folder belongs to one account only, so messages move one account at a time: keep only those from ${kept} selected?`,
    it: (accounts: string, kept: string) =>
      `La selezione comprende messaggi di ${accounts}. Ogni cartella appartiene a un solo account, quindi si spostano i messaggi di un account alla volta: vuoi tenere selezionati solo quelli di ${kept}?`,
    de: (accounts: string, kept: string) =>
      `Die Auswahl enthält Nachrichten von ${accounts}. Jeder Ordner gehört zu genau einem Konto, daher werden die Nachrichten Konto für Konto verschoben: Nur die von ${kept} ausgewählt lassen?`
  },
  selectOnlyThose: {
    en: 'Select only those',
    it: 'Seleziona solo quelli',
    de: 'Nur diese auswählen'
  },
  archivedOne: { en: 'Archived', it: 'Archiviato', de: 'Archiviert' },
  archivedOther: { en: 'Archived', it: 'Archiviati', de: 'Archiviert' },
  archivedKept: {
    en: 'Out of the Inbox; they stay here, with their labels.',
    it: 'Fuori dalla Posta in arrivo; qui restano, con le loro etichette.',
    de: 'Aus dem Posteingang entfernt; hier bleiben sie, mit ihren Labels.'
  },
  notArchived: {
    en: 'The messages could not be archived.',
    it: 'Archiviazione email non riuscita.',
    de: 'Die Nachrichten konnten nicht archiviert werden.'
  },
  notMoved: {
    en: 'The messages could not be moved.',
    it: 'Spostamento email non riuscito.',
    de: 'Die Nachrichten konnten nicht verschoben werden.'
  },
  folderNotCreated: {
    en: 'The folder could not be created.',
    it: 'Creazione cartella non riuscita.',
    de: 'Der Ordner konnte nicht erstellt werden.'
  },
  openingDraft: {
    en: 'Opening the draft…',
    it: 'Apertura della bozza…',
    de: 'Entwurf wird geöffnet…'
  },
  draftNotOpened: {
    en: 'The draft could not be opened',
    it: 'Bozza non apribile',
    de: 'Der Entwurf lässt sich nicht öffnen'
  },

  // Projects.
  open: { en: 'Open', it: 'Apri', de: 'Öffnen' },
  rename: { en: 'Rename…', it: 'Rinomina…', de: 'Umbenennen…' },
  mergeInto: { en: 'Merge into this', it: 'Unisci a questo', de: 'Hiermit zusammenführen' },
  reopen: { en: 'Reopen', it: 'Riapri', de: 'Wieder öffnen' },
  conclude: {
    en: 'Concluded: no longer under way',
    it: 'Concluso: non è più in corso',
    de: 'Abgeschlossen: nicht mehr in Arbeit'
  },
  hide: {
    en: 'Hide: not a project',
    it: 'Nascondi: non è un progetto',
    de: 'Ausblenden: kein Projekt'
  },
  renameProject: {
    en: 'Rename the project',
    it: 'Rinomina il progetto',
    de: 'Projekt umbenennen'
  },
  renameProjectText: {
    en: 'The Segretario will use this name, and won’t change it on its own.',
    it: 'Il Segretario userà questo nome, e non lo cambierà da solo.',
    de: 'Der Segretario verwendet diesen Namen und ändert ihn nicht von sich aus.'
  },
  name: { en: 'Name', it: 'Nome', de: 'Name' },
  renameConfirm: { en: 'Rename', it: 'Rinomina', de: 'Umbenennen' },
  giveName: { en: 'Give it a name.', it: 'Dai un nome.', de: 'Geben Sie einen Namen ein.' },
  merged: {
    en: (other: string, project: string) => `“${other}” is now part of “${project}”`,
    it: (other: string, project: string) => `«${other}» è ora parte di «${project}»`,
    de: (other: string, project: string) => `„${other}“ gehört jetzt zu „${project}“`
  },
  hidden: {
    en: (project: string) => `“${project}” is no longer among the projects`,
    it: (project: string) => `«${project}» non è più tra i progetti`,
    de: (project: string) => `„${project}“ ist nicht mehr unter den Projekten`
  },
  undo: { en: 'Undo', it: 'Annulla', de: 'Rückgängig' },
  projectNotChanged: {
    en: 'The project did not change',
    it: 'Il progetto non è cambiato',
    de: 'Das Projekt wurde nicht geändert'
  },
  projectNotCreated: {
    en: 'The project was not created',
    it: 'Il progetto non è stato creato',
    de: 'Das Projekt wurde nicht erstellt'
  },

  // Folders.
  markAllRead: {
    en: 'Mark all as read',
    it: 'Segna tutti come letti',
    de: 'Alle als gelesen markieren'
  },
  newFolderIn: {
    en: (parent: string) => `New folder in “${parent}”…`,
    it: (parent: string) => `Nuova cartella in «${parent}»…`,
    de: (parent: string) => `Neuer Ordner in „${parent}“…`
  },
  newFolderMenu: { en: 'New folder…', it: 'Nuova cartella…', de: 'Neuer Ordner…' },
  folderNameDelimiter: {
    en: (delimiter: string) => `A folder’s name cannot contain “${delimiter}”.`,
    it: (delimiter: string) => `Il nome di una cartella non può contenere «${delimiter}».`,
    de: (delimiter: string) => `Der Name eines Ordners darf „${delimiter}“ nicht enthalten.`
  },
  folderNameTaken: {
    en: 'There is already a folder with this name here.',
    it: 'Esiste già una cartella con questo nome qui.',
    de: 'Hier gibt es bereits einen Ordner mit diesem Namen.'
  },
  newFolder: { en: 'New folder', it: 'Nuova cartella', de: 'Neuer Ordner' },
  inside: {
    en: (parent: string) => `Inside “${parent}”.`,
    it: (parent: string) => `Dentro «${parent}».`,
    de: (parent: string) => `In „${parent}“.`
  },
  inAccount: {
    en: (email: string) => `In the account ${email}.`,
    it: (email: string) => `Nell'account ${email}.`,
    de: (email: string) => `Im Konto ${email}.`
  },
  folderName: { en: 'Folder name', it: 'Nome della cartella', de: 'Name des Ordners' },
  create: { en: 'Create', it: 'Crea', de: 'Erstellen' },
  renameFolder: {
    en: (name: string) => `Rename “${name}”`,
    it: (name: string) => `Rinomina «${name}»`,
    de: (name: string) => `„${name}“ umbenennen`
  },
  newName: { en: 'New name', it: 'Nuovo nome', de: 'Neuer Name' },
  folderActionFailed: {
    en: 'The folder could not be changed.',
    it: 'Operazione sulla cartella non riuscita.',
    de: 'Der Ordner konnte nicht geändert werden.'
  },

  // A message's menu.
  continueWriting: { en: 'Continue writing', it: 'Continua a scrivere', de: 'Weiterschreiben' },
  reply: { en: 'Reply', it: 'Rispondi', de: 'Antworten' },
  replyAll: { en: 'Reply all', it: 'Rispondi a tutti', de: 'Allen antworten' },
  forward: { en: 'Forward', it: 'Inoltra', de: 'Weiterleiten' },
  markAsRead: { en: 'Mark as read', it: 'Segna come letto', de: 'Als gelesen markieren' },
  markAsUnread: {
    en: 'Mark as unread',
    it: 'Segna come non letto',
    de: 'Als ungelesen markieren'
  },
  unflag: { en: 'Remove flag', it: 'Rimuovi contrassegno', de: 'Markierung entfernen' },
  flag: { en: 'Flag', it: 'Contrassegna', de: 'Markieren' },
  markHandled: { en: 'Mark as handled', it: 'Segna come gestito', de: 'Als erledigt markieren' },
  archive: { en: 'Archive', it: 'Archivia', de: 'Archivieren' },
  moveTo: { en: 'Move to', it: 'Sposta in', de: 'Verschieben nach' },
  senderMessages: {
    en: (sender: string) => `Show messages from ${sender}`,
    it: (sender: string) => `Mostra i messaggi di ${sender}`,
    de: (sender: string) => `Nachrichten von ${sender} anzeigen`
  },
  delete: { en: 'Delete', it: 'Elimina', de: 'Löschen' },

  // The Segretario's searches.
  segretarioDidNotSearch: {
    en: 'The Segretario did not search',
    it: 'Il Segretario non ha cercato',
    de: 'Der Segretario hat nicht gesucht'
  },
  tryAgain: { en: 'Try again', it: 'Riprova', de: 'Erneut versuchen' },
  searchFolderNotCreated: {
    en: 'Folder not created',
    it: 'Cartella non creata',
    de: 'Ordner nicht erstellt'
  }
})
