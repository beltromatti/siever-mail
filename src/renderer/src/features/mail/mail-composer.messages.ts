import { defineMessages } from '@shared/i18n'

/** What a message being written is called: its tab, its region. */
export const COMPOSER_TITLES = defineMessages({
  new: { en: 'New message', it: 'Nuovo messaggio', de: 'Neue Nachricht' },
  reply: { en: 'Reply', it: 'Rispondi', de: 'Antworten' },
  forward: { en: 'Forward message', it: 'Inoltra messaggio', de: 'Nachricht weiterleiten' }
})

/** What the composer says: its band, its envelope, where its draft stands, what stops a send. */
export const MESSAGES = defineMessages({
  savingToDrafts: {
    en: 'Saving to Drafts…',
    it: 'Salvataggio in Bozze…',
    de: 'Wird in Entwürfen gespeichert…'
  },
  savedOnComputer: {
    en: 'Saved on this computer',
    it: 'Salvata su questo computer',
    de: 'Auf diesem Computer gespeichert'
  },
  notInDraftsYet: {
    en: (reason: string) => `Not in Drafts yet: ${reason}. I’ll try again on my own.`,
    it: (reason: string) => `Non ancora in Bozze: ${reason}. Riprovo da solo.`,
    de: (reason: string) => `Noch nicht in den Entwürfen: ${reason}. Ich versuche es selbst erneut.`
  },
  serverNotAnswering: {
    en: 'the server isn’t answering',
    it: 'il server non risponde',
    de: 'der Server antwortet nicht'
  },
  savedInDraftsAt: {
    en: (time: string) => `Saved in Drafts at ${time}`,
    it: (time: string) => `Salvata in Bozze alle ${time}`,
    de: (time: string) => `Um ${time} in Entwürfen gespeichert`
  },
  saved: { en: 'Saved', it: 'Salvata', de: 'Gespeichert' },
  pendingHint: {
    en: 'The latest changes are on this computer and go to Drafts in a few seconds.',
    it: 'Le ultime modifiche sono su questo computer e vanno in Bozze tra pochi secondi.',
    de: 'Die letzten Änderungen liegen auf diesem Computer und kommen in wenigen Sekunden in die Entwürfe.'
  },
  signatureUnavailable: {
    en: 'Signature not available',
    it: 'Firma non disponibile',
    de: 'Signatur nicht verfügbar'
  },
  signatureOfUnavailable: {
    en: (email: string) => `Signature of ${email} not available`,
    it: (email: string) => `Firma di ${email} non disponibile`,
    de: (email: string) => `Signatur von ${email} nicht verfügbar`
  },
  originalAttachmentsUnavailable: {
    en: 'Attachments of the original message not available',
    it: 'Allegati del messaggio originale non disponibili',
    de: 'Anhänge der ursprünglichen Nachricht nicht verfügbar'
  },
  draftNotSaved: {
    en: 'Draft not saved',
    it: 'Bozza non salvata',
    de: 'Entwurf nicht gespeichert'
  },
  discardTitle: {
    en: 'Discard the message?',
    it: 'Scartare il messaggio?',
    de: 'Nachricht verwerfen?'
  },
  mailboxGoneChoose: {
    en: 'The mailbox you were writing it from is no longer connected: to keep it, choose which one to send it from.',
    it: 'La casella da cui lo scrivevi non è più collegata: per tenerlo, scegli da quale inviarlo.',
    de: 'Das Postfach, aus dem Sie sie geschrieben haben, ist nicht mehr verbunden: Um sie zu behalten, wählen Sie, aus welchem sie gesendet wird.'
  },
  mailboxGoneNoOther: {
    en: 'The mailbox you were writing it from is no longer connected, and there’s no other one to send it from.',
    it: 'La casella da cui lo scrivevi non è più collegata, e non ce n’è un’altra da cui inviarlo.',
    de: 'Das Postfach, aus dem Sie sie geschrieben haben, ist nicht mehr verbunden, und es gibt kein anderes, aus dem sie gesendet werden kann.'
  },
  discard: { en: 'Discard', it: 'Scarta', de: 'Verwerfen' },
  replyFromOtherTitle: {
    en: 'Reply from another mailbox?',
    it: 'Rispondere da un’altra casella?',
    de: 'Aus einem anderen Postfach antworten?'
  },
  forwardFromOtherTitle: {
    en: 'Forward from another mailbox?',
    it: 'Inoltrare da un’altra casella?',
    de: 'Aus einem anderen Postfach weiterleiten?'
  },
  replyFromOtherText: {
    en: (source: string, next: string) =>
      `The message arrived at ${source}. If you reply from another mailbox, the person who wrote to you gets the reply from a different address than the one they wrote to, and the sent copy stays in the mail of ${next}.`,
    it: (source: string, next: string) =>
      `Il messaggio è arrivato a ${source}. Rispondendo da un’altra casella, chi ti ha scritto riceve la risposta da un indirizzo diverso da quello a cui ha scritto e la copia inviata resta nella posta di ${next}.`,
    de: (source: string, next: string) =>
      `Die Nachricht ist bei ${source} eingegangen. Wenn Sie aus einem anderen Postfach antworten, erhält der Absender die Antwort von einer anderen Adresse als der, an die er geschrieben hat, und die gesendete Kopie bleibt in den E-Mails von ${next}.`
  },
  forwardFromOtherText: {
    en: (source: string, next: string) =>
      `The message arrived at ${source}. If you forward it from another mailbox, it leaves from a different address than the one that received it, and the sent copy stays in the mail of ${next}.`,
    it: (source: string, next: string) =>
      `Il messaggio è arrivato a ${source}. Inoltrandolo da un’altra casella, parte da un indirizzo diverso da quello che lo ha ricevuto e la copia inviata resta nella posta di ${next}.`,
    de: (source: string, next: string) =>
      `Die Nachricht ist bei ${source} eingegangen. Wenn Sie sie aus einem anderen Postfach weiterleiten, geht sie von einer anderen Adresse aus als der, die sie empfangen hat, und die gesendete Kopie bleibt in den E-Mails von ${next}.`
  },
  changeMailbox: { en: 'Change mailbox', it: 'Cambia casella', de: 'Postfach wechseln' },
  cc: { en: 'Cc', it: 'Cc', de: 'Cc' },
  ccBcc: { en: 'Cc/Bcc', it: 'Cc/Ccn', de: 'Cc/Bcc' },
  cannotOpenHere: {
    en: (name: string) => `${name} can’t be opened from here`,
    it: (name: string) => `${name} non si apre da qui`,
    de: (name: string) => `${name} lässt sich hier nicht öffnen`
  },
  cannotOpenHereText: {
    en: 'Files that start programs open only from their folder.',
    it: 'I file che avviano programmi si aprono solo dalla loro cartella.',
    de: 'Dateien, die Programme starten, lassen sich nur aus ihrem Ordner öffnen.'
  },
  noApplication: {
    en: (name: string) => `No app opens ${name}`,
    it: (name: string) => `Nessuna applicazione apre ${name}`,
    de: (name: string) => `Keine App öffnet ${name}`
  },
  noApplicationText: {
    en: 'There’s no program for this type of file on this computer.',
    it: "Su questo computer non c'è un programma per questo tipo di file.",
    de: 'Auf diesem Computer gibt es kein Programm für diesen Dateityp.'
  },
  cannotOpen: {
    en: (name: string) => `Couldn’t open ${name}`,
    it: (name: string) => `Impossibile aprire ${name}`,
    de: (name: string) => `${name} konnte nicht geöffnet werden`
  },
  open: { en: 'Open', it: 'Apri', de: 'Öffnen' },
  retryDownload: {
    en: 'Try downloading it again',
    it: 'Riprova a scaricarlo',
    de: 'Erneut herunterladen'
  },
  remove: { en: 'Remove', it: 'Rimuovi', de: 'Entfernen' },
  cannotAttachFiles: {
    en: 'Couldn’t attach the files',
    it: 'Impossibile allegare i file',
    de: 'Die Dateien konnten nicht angehängt werden'
  },
  cannotAttachFile: {
    en: 'Couldn’t attach the file',
    it: 'Impossibile allegare il file',
    de: 'Die Datei konnte nicht angehängt werden'
  },
  pecNoBcc: {
    en: 'PEC doesn’t allow blind copies',
    it: 'La PEC non ammette la copia nascosta',
    de: 'PEC erlaubt keine Blindkopie'
  },
  pecNoBccText: {
    en: 'The provider would refuse the message: move the Bcc addresses to To or Cc, or remove them.',
    it: 'Il gestore rifiuterebbe il messaggio: sposta gli indirizzi in Ccn in A o in Cc, o toglili.',
    de: 'Der Anbieter würde die Nachricht ablehnen: Verschieben Sie die Bcc-Adressen nach An oder Cc, oder entfernen Sie sie.'
  },
  invalidAddress: {
    en: (address: string) => `“${address}” isn’t a valid address`,
    it: (address: string) => `«${address}» non è un indirizzo valido`,
    de: (address: string) => `„${address}“ ist keine gültige Adresse`
  },
  invalidAddresses: {
    en: (count: number) => `${count} addresses aren’t valid`,
    it: (count: number) => `${count} indirizzi non sono validi`,
    de: (count: number) => `${count} Adressen sind ungültig`
  },
  invalidAddressesText: {
    en: 'Correct or remove the recipients in red, then send.',
    it: 'Correggi o togli i destinatari in rosso, poi invia.',
    de: 'Korrigieren oder entfernen Sie die rot markierten Empfänger und senden Sie dann.'
  },
  noSubjectTitle: {
    en: 'Send without a subject?',
    it: 'Inviare senza oggetto?',
    de: 'Ohne Betreff senden?'
  },
  noSubjectText: {
    en: 'Whoever receives the message won’t know what it’s about until they open it, and it will be harder to find.',
    it: 'Chi riceve il messaggio non saprà di cosa tratta finché non lo apre, e cercarlo sarà più difficile.',
    de: 'Wer die Nachricht erhält, weiß erst beim Öffnen, worum es geht, und sie ist schwerer zu finden.'
  },
  sendWithoutSubject: {
    en: 'Send without subject',
    it: 'Invia senza oggetto',
    de: 'Ohne Betreff senden'
  },
  writeSubject: { en: 'Write the subject', it: 'Scrivi l’oggetto', de: 'Betreff eingeben' },
  dropToAttach: { en: 'Drop to attach', it: 'Rilascia per allegare', de: 'Zum Anhängen loslassen' },
  rereadingSendNow: {
    en: 'I’m rereading the message before it goes: send without waiting',
    it: 'Rileggo il messaggio prima che parta: invia senza aspettare',
    de: 'Ich lese die Nachricht vor dem Versand noch einmal: ohne Warten senden'
  },
  sendMessage: { en: 'Send the message', it: 'Invia il messaggio', de: 'Nachricht senden' },
  sendNow: { en: 'Send now', it: 'Invia subito', de: 'Sofort senden' },
  send: { en: 'Send', it: 'Invia', de: 'Senden' },
  beforeSending: { en: 'Before sending', it: 'Prima di inviare', de: 'Vor dem Senden' },
  correct: { en: 'Correct', it: 'Correggi', de: 'Korrigieren' },
  sendAnyway: { en: 'Send anyway', it: 'Invia comunque', de: 'Trotzdem senden' },
  askSegretario: {
    en: 'Ask the Segretario to write it with you',
    it: 'Chiedi al Segretario di scriverlo con te',
    de: 'Den Segretario bitten, sie mit Ihnen zu schreiben'
  },
  deleteDraft: { en: 'Delete draft', it: 'Elimina bozza', de: 'Entwurf löschen' },
  discardMessage: { en: 'Discard message', it: 'Scarta messaggio', de: 'Nachricht verwerfen' },
  shrink: {
    en: 'Make the writing space smaller',
    it: 'Riduci lo spazio di scrittura',
    de: 'Schreibbereich verkleinern'
  },
  expand: {
    en: 'Write in the whole window',
    it: 'Scrivi a tutta finestra',
    de: 'Im ganzen Fenster schreiben'
  },
  closeKeepInDrafts: {
    en: 'Close and keep in Drafts',
    it: 'Chiudi e tieni in Bozze',
    de: 'Schließen und in Entwürfen behalten'
  },
  close: { en: 'Close', it: 'Chiudi', de: 'Schließen' },
  from: { en: 'From', it: 'Da', de: 'Von' },
  chooseMailbox: { en: 'Choose the mailbox', it: 'Scegli la casella', de: 'Postfach wählen' },
  receivedTheMessage: {
    en: 'received the message',
    it: 'ha ricevuto il messaggio',
    de: 'hat die Nachricht empfangen'
  },
  toPlaceholder: {
    en: 'Name or email address',
    it: 'Nome o indirizzo email',
    de: 'Name oder E-Mail-Adresse'
  },
  ccPlaceholder: { en: 'Carbon copy', it: 'Copia per conoscenza', de: 'Kopie' },
  bccPlaceholder: { en: 'Blind copy', it: 'Copia nascosta', de: 'Blindkopie' },
  subject: { en: 'Subject', it: 'Oggetto', de: 'Betreff' },
  subjectPlaceholder: { en: 'Add a subject', it: 'Inserisci oggetto', de: 'Betreff eingeben' },
  notDownloaded: {
    en: 'not downloaded from the original message',
    it: 'non scaricato dal messaggio originale',
    de: 'nicht aus der ursprünglichen Nachricht geladen'
  },
  downloading: {
    en: 'downloading from the original message…',
    it: 'scaricamento dal messaggio originale…',
    de: 'wird aus der ursprünglichen Nachricht geladen…'
  },
  clickToOpen: { en: 'Click to open', it: 'Clic per aprire', de: 'Zum Öffnen klicken' },
  retryDownloadOf: {
    en: (name: string) => `Try downloading ${name} again`,
    it: (name: string) => `Riprova a scaricare ${name}`,
    de: (name: string) => `${name} erneut herunterladen`
  },
  removeNamed: {
    en: (name: string) => `Remove ${name}`,
    it: (name: string) => `Rimuovi ${name}`,
    de: (name: string) => `${name} entfernen`
  }
})
