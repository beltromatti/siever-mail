import { defineMessages } from '@shared/i18n'

/** What the mail service says to the user: its errors, its dialogs, its notifications. */
export const MESSAGES = defineMessages({
  invalidAddress: {
    en: (address: string) => `“${address}” isn’t a valid email address.`,
    it: (address: string) => `«${address}» non è un indirizzo email valido.`,
    de: (address: string) => `„${address}“ ist keine gültige E-Mail-Adresse.`
  },
  addRecipient: {
    en: 'Add at least one recipient.',
    it: 'Aggiungi almeno un destinatario.',
    de: 'Fügen Sie mindestens einen Empfänger hinzu.'
  },
  attachedToMessage: {
    en: 'Attached to a message',
    it: 'Allegato a un messaggio',
    de: 'An eine Nachricht angehängt'
  },
  savedFromMessage: {
    en: 'Saved from a message',
    it: 'Salvato da un messaggio',
    de: 'Aus einer Nachricht gespeichert'
  },
  interrupted: { en: 'Interrupted.', it: 'Interrotto.', de: 'Abgebrochen.' },
  messageNotInFolder: {
    en: 'The message is no longer in this folder.',
    it: 'Il messaggio non è più in questa cartella.',
    de: 'Die Nachricht ist nicht mehr in diesem Ordner.'
  },
  attachmentUnavailable: {
    en: 'Attachment not available for this message.',
    it: 'Allegato non disponibile per questo messaggio.',
    de: 'Anhang für diese Nachricht nicht verfügbar.'
  },
  notPasswordMailbox: {
    en: 'This mailbox doesn’t connect with a password.',
    it: 'Questa casella non si collega con una password.',
    de: 'Dieses Postfach wird nicht mit einem Passwort verbunden.'
  },
  passwordRefused: {
    en: (email: string) =>
      `The server doesn’t accept this password for ${email}: check it and try again.`,
    it: (email: string) =>
      `Il server non accetta questa password per ${email}: controllala e riprova.`,
    de: (email: string) =>
      `Der Server akzeptiert dieses Passwort für ${email} nicht: Prüfen Sie es und versuchen Sie es erneut.`
  },
  notProviderMailbox: {
    en: 'This mailbox doesn’t connect through a provider.',
    it: 'Questa casella non si collega con un fornitore.',
    de: 'Dieses Postfach wird nicht über einen Anbieter verbunden.'
  },
  googleImapOff: {
    en: (mailbox: string, said: string) =>
      `Google gave its consent, but the mailbox ${mailbox} doesn’t open over IMAP: check that IMAP is on in Gmail’s settings, then try again. The server said: ${said}`,
    it: (mailbox: string, said: string) =>
      `Google ha dato il consenso, ma la casella ${mailbox} non si apre via IMAP: controlla che l’IMAP sia attivo nelle impostazioni di Gmail, poi riprova. Il server ha detto: ${said}`,
    de: (mailbox: string, said: string) =>
      `Google hat zugestimmt, aber das Postfach ${mailbox} lässt sich nicht über IMAP öffnen: Prüfen Sie, ob IMAP in den Gmail-Einstellungen aktiviert ist, und versuchen Sie es dann erneut. Der Server hat gemeldet: ${said}`
  },
  microsoftImapOff: {
    en: (mailbox: string, said: string) =>
      `Microsoft gave its consent, but the mailbox ${mailbox} doesn’t open over IMAP: for a work account, the administrator may have turned it off. The server said: ${said}`,
    it: (mailbox: string, said: string) =>
      `Microsoft ha dato il consenso, ma la casella ${mailbox} non si apre via IMAP: per un account di lavoro può averlo spento l’amministratore. Il server ha detto: ${said}`,
    de: (mailbox: string, said: string) =>
      `Microsoft hat zugestimmt, aber das Postfach ${mailbox} lässt sich nicht über IMAP öffnen: Bei einem Arbeitskonto hat es möglicherweise der Administrator deaktiviert. Der Server hat gemeldet: ${said}`
  },
  accountNotFound: {
    en: 'Account not found.',
    it: 'Account non trovato.',
    de: 'Konto nicht gefunden.'
  },
  leavingOutbox: {
    en: 'This message is leaving the Outbox: look in Sent in a moment.',
    it: 'Questo messaggio sta partendo dalla posta in uscita: guarda in Posta inviata tra un momento.',
    de: 'Diese Nachricht wird gerade aus dem Postausgang gesendet: Sehen Sie gleich unter Gesendet nach.'
  },
  mailboxStopped: {
    en: (email: string, because: string) =>
      `The mailbox ${email} is stopped: ${because}. Reconnect it from Settings › Connections, then send.`,
    it: (email: string, because: string) =>
      `La casella ${email} è ferma: ${because}. Ricollegala da Impostazioni › Connessioni, poi invia.`,
    de: (email: string, because: string) =>
      `Das Postfach ${email} ist angehalten: ${because}. Verbinden Sie es unter Einstellungen › Verbindungen erneut und senden Sie dann.`
  },
  pecNoBcc: {
    en: 'PEC doesn’t allow blind copies: the provider would refuse the message. Move the Bcc addresses to To or Cc, or remove them.',
    it: 'La PEC non ammette la copia nascosta: il gestore rifiuterebbe il messaggio. Sposta gli indirizzi della Ccn in A o in Cc, o toglili.',
    de: 'PEC erlaubt keine Blindkopie: Der Anbieter würde die Nachricht ablehnen. Verschieben Sie die Bcc-Adressen nach An oder Cc, oder entfernen Sie sie.'
  },
  sendingBrokenOff: {
    en: (reason: string) =>
      `Sending was interrupted while the message was leaving: it may have arrived. Check in Sent before sending it again. (${reason})`,
    it: (reason: string) =>
      `L’invio si è interrotto mentre partiva: il messaggio potrebbe essere arrivato. Controlla in Posta inviata prima di rimandarlo. (${reason})`,
    de: (reason: string) =>
      `Das Senden wurde unterbrochen, während die Nachricht unterwegs war: Sie ist möglicherweise angekommen. Sehen Sie unter Gesendet nach, bevor Sie sie erneut senden. (${reason})`
  },
  notSentTitle: {
    en: 'Message not sent',
    it: 'Messaggio non partito',
    de: 'Nachricht nicht gesendet'
  },
  notSentConcealed: {
    en: 'An outgoing message wasn’t sent: it’s in Drafts.',
    it: 'Un messaggio in uscita non è partito: è in Bozze.',
    de: 'Eine ausgehende Nachricht wurde nicht gesendet: Sie liegt in den Entwürfen.'
  },
  notSent: {
    en: (subject: string, reason: string) => `“${subject || 'No subject'}” wasn’t sent: ${reason}`,
    it: (subject: string, reason: string) =>
      `«${subject || 'Senza oggetto'}» non è partito: ${reason}`,
    de: (subject: string, reason: string) =>
      `„${subject || 'Kein Betreff'}“ wurde nicht gesendet: ${reason}`
  },
  outboxBrokenOff: {
    en: (subject: string) =>
      `Sending “${subject || 'no subject'}” was interrupted while it was leaving: it may have arrived. Check in Sent before sending it again; the draft is in Drafts.`,
    it: (subject: string) =>
      `L’invio di «${subject || 'senza oggetto'}» si è interrotto mentre partiva: potrebbe essere arrivato. Controlla in Posta inviata prima di rimandarlo; la bozza è in Bozze.`,
    de: (subject: string) =>
      `Das Senden von „${subject || 'kein Betreff'}“ wurde unterbrochen, während die Nachricht unterwegs war: Sie ist möglicherweise angekommen. Sehen Sie unter Gesendet nach, bevor Sie sie erneut senden; der Entwurf liegt in den Entwürfen.`
  },
  microsoftNotSent: {
    en: (status: number, said: string) => `Microsoft didn’t send the message (${status}): ${said}`,
    it: (status: number, said: string) =>
      `Microsoft non ha inviato il messaggio (${status}): ${said}`,
    de: (status: number, said: string) =>
      `Microsoft hat die Nachricht nicht gesendet (${status}): ${said}`
  },
  attachFiles: { en: 'Attach files', it: 'Allega file', de: 'Dateien anhängen' },
  attach: { en: 'Attach', it: 'Allega', de: 'Anhängen' },
  attachmentFileName: { en: 'attachment', it: 'allegato', de: 'Anhang' },
  saveAttachment: { en: 'Save attachment', it: 'Salva allegato', de: 'Anhang speichern' },
  save: { en: 'Save', it: 'Salva', de: 'Speichern' },
  saveAllAttachments: {
    en: 'Save all attachments',
    it: 'Salva tutti gli allegati',
    de: 'Alle Anhänge speichern'
  },
  saveHere: { en: 'Save here', it: 'Salva qui', de: 'Hier speichern' },
  messageMoved: {
    en: 'The message is no longer in its folder: it was moved in the meantime.',
    it: 'Il messaggio non è più nella sua cartella: si è spostato nel frattempo.',
    de: 'Die Nachricht ist nicht mehr in ihrem Ordner: Sie wurde inzwischen verschoben.'
  },
  fileGone: {
    en: (name: string) => `${name} is no longer available.`,
    it: (name: string) => `${name} non è più disponibile.`,
    de: (name: string) => `${name} ist nicht mehr verfügbar.`
  },
  folderNotFile: {
    en: (name: string) => `${name} is a folder: only files can be attached.`,
    it: (name: string) => `${name} è una cartella: si possono allegare solo file.`,
    de: (name: string) => `${name} ist ein Ordner: Nur Dateien können angehängt werden.`
  },
  invitationGone: {
    en: 'The invitation is no longer there.',
    it: 'L’invito non c’è più.',
    de: 'Die Einladung ist nicht mehr vorhanden.'
  },
  mailboxLeaving: {
    en: 'This mailbox is being disconnected.',
    it: 'Questa casella si sta scollegando.',
    de: 'Dieses Postfach wird gerade getrennt.'
  },
  mailboxGone: {
    en: 'This mailbox is no longer connected.',
    it: 'Questa casella non è più collegata.',
    de: 'Dieses Postfach ist nicht mehr verbunden.'
  }
})

/**
 * An answer to an invitation as calendars say it — its subject's start and
 * its line, from who answers —, in the interface's language: it goes to the
 * organizer as Outlook sends it, in the language of who answers.
 */
export const INVITATION_ANSWERS = defineMessages({
  acceptedSubject: { en: 'Accepted', it: 'Accettato', de: 'Zugesagt' },
  acceptedBody: {
    en: (name: string, summary: string) => `${name} has accepted the invitation “${summary}”.`,
    it: (name: string, summary: string) => `${name} ha accettato l’invito «${summary}».`,
    de: (name: string, summary: string) => `${name} hat die Einladung „${summary}“ angenommen.`
  },
  tentativeSubject: {
    en: 'Tentative',
    it: 'Accettato provvisoriamente',
    de: 'Mit Vorbehalt angenommen'
  },
  tentativeBody: {
    en: (name: string, summary: string) =>
      `${name} has tentatively accepted the invitation “${summary}”.`,
    it: (name: string, summary: string) =>
      `${name} ha accettato provvisoriamente l’invito «${summary}».`,
    de: (name: string, summary: string) =>
      `${name} hat die Einladung „${summary}“ mit Vorbehalt angenommen.`
  },
  declinedSubject: { en: 'Declined', it: 'Rifiutato', de: 'Abgelehnt' },
  declinedBody: {
    en: (name: string, summary: string) => `${name} has declined the invitation “${summary}”.`,
    it: (name: string, summary: string) => `${name} ha rifiutato l’invito «${summary}».`,
    de: (name: string, summary: string) => `${name} hat die Einladung „${summary}“ abgelehnt.`
  }
})
