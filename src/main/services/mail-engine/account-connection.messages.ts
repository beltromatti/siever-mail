import { defineMessages } from '@shared/i18n'

/** What a mailbox's connection says to the user: its errors, as the page shows them. */
export const MESSAGES = defineMessages({
  mailboxGone: {
    en: 'This mailbox is no longer connected.',
    it: 'Questa casella non è più collegata.',
    de: 'Dieses Postfach ist nicht mehr verbunden.'
  },
  messageUnavailable: {
    en: 'Message not available on the server.',
    it: 'Messaggio non disponibile sul server.',
    de: 'Nachricht auf dem Server nicht verfügbar.'
  },
  messagesNotUpdated: {
    en: 'The server didn’t update the messages.',
    it: 'Il server non ha aggiornato i messaggi.',
    de: 'Der Server hat die Nachrichten nicht aktualisiert.'
  },
  draftNotSaved: {
    en: 'The server didn’t save the draft.',
    it: 'Il server non ha salvato la bozza.',
    de: 'Der Server hat den Entwurf nicht gespeichert.'
  },
  markedDeleted: {
    en: 'Marked as deleted: the server will remove them when the folder is cleaned up. Another program has marked other messages there as deleted too, which SIEVER Mail doesn’t delete in its place.',
    it: 'Segnati come eliminati: il server li toglierà quando la cartella verrà ripulita. Un altro programma vi ha segnato come eliminati anche altri messaggi, che SIEVER Mail non elimina al suo posto.',
    de: 'Als gelöscht markiert: Der Server entfernt sie, wenn der Ordner bereinigt wird. Ein anderes Programm hat dort auch weitere Nachrichten als gelöscht markiert, die SIEVER Mail nicht an seiner Stelle löscht.'
  },
  noRoleFolder: {
    en: (email: string, folder: string) => `${email} has no “${folder}” folder.`,
    it: (email: string, folder: string) => `${email} non ha una cartella «${folder}».`,
    de: (email: string, folder: string) => `${email} hat keinen Ordner „${folder}“.`
  },
  messageMovedElsewhere: {
    en: 'The message is no longer in this folder: it was moved or deleted elsewhere.',
    it: 'Il messaggio non è più in questa cartella: è stato spostato o eliminato altrove.',
    de: 'Die Nachricht ist nicht mehr in diesem Ordner: Sie wurde anderswo verschoben oder gelöscht.'
  },
  noInbox: {
    en: (email: string) => `${email} has no Inbox.`,
    it: (email: string) => `${email} non ha una Posta in arrivo.`,
    de: (email: string) => `${email} hat keinen Posteingang.`
  },
  backInInbox: {
    en: 'The message went back to the Inbox, but the server didn’t say where: archive it from there.',
    it: 'Il messaggio è tornato nella Posta in arrivo, ma il server non ha detto dove: archivialo da lì.',
    de: 'Die Nachricht ist wieder im Posteingang, aber der Server hat nicht mitgeteilt, wo: Archivieren Sie sie von dort.'
  },
  folderGone: {
    en: 'The folder is no longer on the server.',
    it: 'La cartella non è più sul server.',
    de: 'Der Ordner ist nicht mehr auf dem Server.'
  },
  folderNameDelimiter: {
    en: (delimiter: string) => `A folder’s name can’t contain “${delimiter}”.`,
    it: (delimiter: string) => `Il nome di una cartella non può contenere «${delimiter}».`,
    de: (delimiter: string) => `Der Name eines Ordners darf „${delimiter}“ nicht enthalten.`
  },
  folderNotRenamed: {
    en: (name: string) => `The server didn’t rename the folder to “${name}”.`,
    it: (name: string) => `Il server non ha rinominato la cartella in «${name}».`,
    de: (name: string) => `Der Server hat den Ordner nicht in „${name}“ umbenannt.`
  },
  folderNotShown: {
    en: (name: string) => `The server doesn’t show the folder “${name}”.`,
    it: (name: string) => `Il server non mostra la cartella «${name}».`,
    de: (name: string) => `Der Server zeigt den Ordner „${name}“ nicht an.`
  },
  parentGone: {
    en: 'The folder to create it in is no longer on the server.',
    it: 'La cartella in cui crearla non è più sul server.',
    de: 'Der Ordner, in dem er erstellt werden soll, ist nicht mehr auf dem Server.'
  },
  folderNotCreated: {
    en: (name: string) => `The server didn’t create the folder “${name}”.`,
    it: (name: string) => `Il server non ha creato la cartella «${name}».`,
    de: (name: string) => `Der Server hat den Ordner „${name}“ nicht erstellt.`
  },
  createdNotShown: {
    en: (name: string) => `The server doesn’t show the folder “${name}” it just created.`,
    it: (name: string) => `Il server non mostra la cartella «${name}» appena creata.`,
    de: (name: string) => `Der Server zeigt den soeben erstellten Ordner „${name}“ nicht an.`
  },
  attachmentUnavailable: {
    en: 'Attachment not available for this message.',
    it: 'Allegato non disponibile per questo messaggio.',
    de: 'Anhang für diese Nachricht nicht verfügbar.'
  },
  imapUnavailable: {
    en: 'IMAP connection not available.',
    it: 'Connessione IMAP non disponibile.',
    de: 'IMAP-Verbindung nicht verfügbar.'
  },
  syncUnavailable: {
    en: 'IMAP sync connection not available.',
    it: 'Connessione IMAP di sync non disponibile.',
    de: 'IMAP-Synchronisierungsverbindung nicht verfügbar.'
  },
  notListed: {
    en: (folder: string) => `The server didn’t list the messages of “${folder}”.`,
    it: (folder: string) => `Il server non ha elencato i messaggi di «${folder}».`,
    de: (folder: string) => `Der Server hat die Nachrichten von „${folder}“ nicht aufgelistet.`
  },
  refusedMessages: {
    en: (count: number, folder: string) =>
      `The server refused ${count} ${count === 1 ? 'message' : 'messages'} of “${folder}”: ${count === 1 ? 'it' : 'they'} will be asked for again.`,
    it: (count: number, folder: string) =>
      `Il server ha rifiutato ${count} messaggi di «${folder}»: verranno chiesti di nuovo.`,
    de: (count: number, folder: string) =>
      `Der Server hat ${count} ${count === 1 ? 'Nachricht' : 'Nachrichten'} von „${folder}“ abgelehnt: Sie werden erneut angefordert.`
  },
  mailboxStopped: {
    en: (email: string, because: string) =>
      `The mailbox ${email} is stopped: ${because}. Reconnect it from Settings › Connections.`,
    it: (email: string, because: string) =>
      `La casella ${email} è ferma: ${because}. Ricollegala da Impostazioni › Connessioni.`,
    de: (email: string, because: string) =>
      `Das Postfach ${email} ist angehalten: ${because}. Verbinden Sie es unter Einstellungen › Verbindungen erneut.`
  },
  offline: {
    en: 'No internet connection: not done.',
    it: 'Nessuna connessione a internet: operazione non eseguita.',
    de: 'Keine Internetverbindung: Vorgang nicht ausgeführt.'
  },
  serverNotAnswering: {
    en: (email: string) => `The server of ${email} isn’t answering: not done.`,
    it: (email: string) => `Il server di ${email} non risponde: operazione non eseguita.`,
    de: (email: string) => `Der Server von ${email} antwortet nicht: Vorgang nicht ausgeführt.`
  }
})
