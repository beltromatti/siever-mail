import { defineMessages } from '@shared/i18n'

/** What the app's shell says: the window, the notices about mail being written and sent, the apps to come. */
export const MESSAGES = defineMessages({
  bootstrapFailed: {
    en: 'SIEVER Mail could not start.',
    it: 'Bootstrap applicazione non riuscito.',
    de: 'SIEVER Mail konnte nicht starten.'
  },
  minimizeWindow: { en: 'Minimize window', it: 'Minimizza finestra', de: 'Fenster minimieren' },
  minimize: { en: 'Minimize', it: 'Minimizza', de: 'Minimieren' },
  restoreWindow: { en: 'Restore window', it: 'Riduci finestra', de: 'Fenster wiederherstellen' },
  maximizeWindow: { en: 'Maximize window', it: 'Ingrandisci finestra', de: 'Fenster maximieren' },
  restore: { en: 'Restore', it: 'Riduci', de: 'Wiederherstellen' },
  maximize: { en: 'Maximize', it: 'Ingrandisci', de: 'Maximieren' },
  closeWindow: { en: 'Close window', it: 'Chiudi finestra', de: 'Fenster schließen' },
  close: { en: 'Close', it: 'Chiudi', de: 'Schließen' },
  eventGone: {
    en: 'The event is no longer in the calendar.',
    it: 'L’evento non è più nel calendario.',
    de: 'Der Termin ist nicht mehr im Kalender.'
  },
  takenBack: {
    en: 'No longer in the outbox',
    it: 'Non è più in uscita',
    de: 'Nicht mehr im Postausgang'
  },
  takenBackText: {
    en: 'The message is back in your hands: send it when it’s ready.',
    it: 'Il messaggio è tornato nelle tue mani: invialo quando è pronto.',
    de: 'Die Nachricht liegt wieder bei Ihnen: Senden Sie sie, wenn sie fertig ist.'
  },
  notTakenBack: {
    en: 'It was not taken out of the outbox',
    it: 'Non è stato tolto dalla posta in uscita',
    de: 'Sie wurde nicht aus dem Postausgang genommen'
  },
  draftSaved: {
    en: 'Draft saved in Drafts',
    it: 'Bozza salvata in Bozze',
    de: 'Entwurf unter „Entwürfe“ gespeichert'
  },
  noSubject: { en: '(no subject)', it: '(senza oggetto)', de: '(kein Betreff)' },
  open: { en: 'Open', it: 'Apri', de: 'Öffnen' },
  draftNotDeleted: {
    en: 'Draft not deleted',
    it: 'Bozza non eliminata',
    de: 'Entwurf nicht gelöscht'
  },
  draftDeleted: { en: 'Draft deleted', it: 'Bozza eliminata', de: 'Entwurf gelöscht' },
  undo: { en: 'Undo', it: 'Annulla', de: 'Rückgängig' },
  draftNotRestored: {
    en: 'Draft not restored',
    it: 'Bozza non ripristinata',
    de: 'Entwurf nicht wiederhergestellt'
  },
  draftNotInDrafts: {
    en: 'Draft not in Drafts yet',
    it: 'Bozza non ancora in Bozze',
    de: 'Entwurf noch nicht unter „Entwürfe“'
  },
  draftSafeHere: {
    en: 'It’s safe on this computer and will go there as soon as it can.',
    it: 'È al sicuro su questo computer e ci andrà appena possibile.',
    de: 'Er ist auf diesem Computer sicher und kommt dorthin, sobald es möglich ist.'
  },
  draftUnavailable: {
    en: 'Draft no longer available',
    it: 'Bozza non più disponibile',
    de: 'Entwurf nicht mehr verfügbar'
  },
  draftSentOrDiscarded: {
    en: 'It was sent or discarded.',
    it: 'È stata inviata o scartata.',
    de: 'Er wurde gesendet oder verworfen.'
  },
  messageGone: {
    en: 'The message is gone',
    it: 'Il messaggio non c’è più',
    de: 'Die Nachricht ist nicht mehr da'
  },
  messageGoneText: {
    en: 'It was moved out of the mail or deleted.',
    it: 'È stato spostato fuori dalla posta o eliminato.',
    de: 'Sie wurde aus der E-Mail verschoben oder gelöscht.'
  },
  replyNotOpened: {
    en: 'The reply did not open',
    it: 'La risposta non si è aperta',
    de: 'Die Antwort ließ sich nicht öffnen'
  },
  /** What the user asks the Segretario with the reminder's button, in their words. */
  remindRequest: {
    en: (text: string) => `Prepare a follow-up: ${text}`,
    it: (text: string) => `Prepara un sollecito: ${text}`,
    de: (text: string) => `Nachfassen vorbereiten: ${text}`
  },
  remindFailed: {
    en: 'The follow-up did not start',
    it: 'Il sollecito non è partito',
    de: 'Das Nachfassen wurde nicht gestartet'
  },
  sourceGone: { en: 'It’s gone', it: 'Non c’è più', de: 'Nicht mehr vorhanden' },
  sourceGoneText: {
    en: 'The message or event it came from was deleted.',
    it: 'Il messaggio o l’evento da cui veniva è stato eliminato.',
    de: 'Die Nachricht oder der Termin, aus dem es stammte, wurde gelöscht.'
  },
  sending: { en: 'Sending…', it: 'Invio in corso…', de: 'Wird gesendet…' },
  queued: { en: 'In the outbox', it: 'In uscita', de: 'Im Postausgang' },
  queuedText: {
    en: 'The mail server can’t be reached right now: the message goes by itself as soon as it answers.',
    it: 'Il server della posta ora non si raggiunge: il messaggio parte da solo appena risponde.',
    de: 'Der Mailserver ist gerade nicht erreichbar: Die Nachricht wird von selbst gesendet, sobald er antwortet.'
  },
  sent: { en: 'Message sent', it: 'Messaggio inviato', de: 'Nachricht gesendet' },
  sendFailedText: {
    en: 'The email could not be sent.',
    it: 'Invio email non riuscito.',
    de: 'Die E-Mail konnte nicht gesendet werden.'
  },
  outboxSent: { en: 'Message sent', it: 'Messaggio partito', de: 'Nachricht verschickt' },
  outboxSentText: {
    en: (subject: string) =>
      `“${subject || 'No subject'}” was in the outbox: the server answers now.`,
    it: (subject: string) =>
      `«${subject || 'Senza oggetto'}» era in uscita: il server ora risponde.`,
    de: (subject: string) =>
      `„${subject || 'Kein Betreff'}“ war im Postausgang: Der Server antwortet jetzt.`
  },
  sendFailed: { en: 'Sending failed', it: 'Invio non riuscito', de: 'Senden fehlgeschlagen' },
  setupNotSaved: {
    en: 'The setup was not saved',
    it: 'La configurazione non è stata salvata',
    de: 'Die Einrichtung wurde nicht gespeichert'
  },
  calendarNotDisconnected: {
    en: 'The calendar was not disconnected',
    it: 'Il calendario non si è scollegato',
    de: 'Der Kalender wurde nicht getrennt'
  },
  startupError: {
    en: 'SIEVER Mail did not start',
    it: 'Errore inizializzazione',
    de: 'SIEVER Mail ist nicht gestartet'
  },
  retry: { en: 'Try again', it: 'Riprova', de: 'Erneut versuchen' },
  starting: {
    en: 'Starting SIEVER Mail…',
    it: 'Avvio di SIEVER Mail…',
    de: 'SIEVER Mail wird gestartet…'
  },
  writingSubject: {
    en: (subject: string) => `The message you’re writing: “${subject}”`,
    it: (subject: string) => `Il messaggio che scrivi: «${subject}»`,
    de: (subject: string) => `Die Nachricht, die Sie schreiben: „${subject}“`
  },
  writing: {
    en: 'The message you’re writing',
    it: 'Il messaggio che scrivi',
    de: 'Die Nachricht, die Sie schreiben'
  },
  quoted: {
    en: (title: string) => `“${title}”`,
    it: (title: string) => `«${title}»`,
    de: (title: string) => `„${title}“`
  },
  comingSoon: { en: 'Coming soon', it: 'In arrivo', de: 'Demnächst' },
  mailLead: {
    en: 'No mailbox connected. The other apps work without one; with a mailbox, your mail arrives here.',
    it: 'Nessuna casella collegata. Le altre app funzionano anche così; con una casella, la posta arriva qui.',
    de: 'Kein Postfach verbunden. Die anderen Apps funktionieren auch so; mit einem Postfach kommen Ihre E-Mails hier an.'
  },
  mailEach: {
    en: 'Each mailbox is a connection of its own: Gmail, Microsoft, iCloud, or any other with IMAP.',
    it: 'Ogni casella è una connessione a sé: Gmail, Microsoft, iCloud, o qualunque altra con IMAP.',
    de: 'Jedes Postfach ist eine eigene Verbindung: Gmail, Microsoft, iCloud oder jedes andere mit IMAP.'
  },
  mailSegretario: {
    en: 'The Segretario reads it as it reads the calendars: the open items, the projects and your day take it in.',
    it: 'Il Segretario la legge come legge i calendari: le cose aperte, i progetti e la giornata la comprendono.',
    de: 'Der Segretario liest sie, wie er die Kalender liest: Die offenen Punkte, die Projekte und Ihr Tag beziehen sie ein.'
  },
  connectMailbox: { en: 'Connect a mailbox', it: 'Collega una casella', de: 'Postfach verbinden' },
  filesLead: {
    en: 'Your documents, wherever they are: the computer, network drives, cloud drives. A source like mail and the calendar.',
    it: 'I tuoi documenti, ovunque siano: il computer, i dischi di rete, i drive. Una fonte come la posta e il calendario.',
    de: 'Ihre Dokumente, wo immer sie liegen: auf dem Computer, auf Netzlaufwerken, in Cloud-Speichern. Eine Quelle wie E-Mail und Kalender.'
  },
  filesEach: {
    en: 'Every volume of the computer or the network, and every drive — Google Drive, OneDrive and SharePoint, Dropbox, iCloud Drive — is a connection, like a mailbox or a calendar.',
    it: 'Ogni volume del computer o di rete, e ogni drive — Google Drive, OneDrive e SharePoint, Dropbox, iCloud Drive — è una connessione, come una casella o un calendario.',
    de: 'Jedes Laufwerk des Computers oder im Netzwerk und jeder Cloud-Speicher – Google Drive, OneDrive und SharePoint, Dropbox, iCloud Drive – ist eine Verbindung, wie ein Postfach oder ein Kalender.'
  },
  filesSearch: {
    en: 'One search across them all, and the document opens where it is: no copies, no syncing.',
    it: 'Una ricerca sola su tutti, e il documento si apre dov’è: niente copie, niente sincronizzazione.',
    de: 'Eine Suche über alle, und das Dokument öffnet sich dort, wo es liegt: keine Kopien, keine Synchronisierung.'
  },
  filesBelonging: {
    en: 'For each file, the projects, conversations and appointments it belongs to.',
    it: 'Per ogni file, i progetti, le conversazioni e gli appuntamenti a cui appartiene.',
    de: 'Zu jeder Datei die Projekte, Unterhaltungen und Termine, zu denen sie gehört.'
  },
  filesSegretario: {
    en: 'The Segretario already reads the files on the computer and on connected network drives, read-only.',
    it: 'Il Segretario legge già i file del computer e dei dischi di rete collegati, solo in lettura.',
    de: 'Der Segretario liest bereits die Dateien des Computers und der verbundenen Netzlaufwerke, nur lesend.'
  },
  contactsLead: {
    en: 'The people and organizations you work with, in one place, with what the Segretario knows about each.',
    it: 'Le persone e gli enti con cui lavori, in un posto solo, con quello che il Segretario sa di ciascuno.',
    de: 'Die Personen und Organisationen, mit denen Sie arbeiten, an einem Ort, mit dem, was der Segretario über jede weiß.'
  },
  contactsSources: {
    en: 'From every source: who writes to you, who you meet, the address books of your connections.',
    it: 'Da tutte le fonti: chi ti scrive, chi incontri, le rubriche delle connessioni.',
    de: 'Aus allen Quellen: wer Ihnen schreibt, wen Sie treffen, die Adressbücher Ihrer Verbindungen.'
  },
  contactsEach: {
    en: 'For each: the conversations, appointments, shared projects and open items.',
    it: 'Per ognuno: le conversazioni, gli appuntamenti, i progetti in comune e le cose aperte.',
    de: 'Zu jeder: die Unterhaltungen, Termine, gemeinsamen Projekte und offenen Punkte.'
  },
  contactsSegretario: {
    en: 'What the Segretario has understood about them, written by it and corrected by you.',
    it: 'Quello che il Segretario ha capito di loro, scritto da lui e corretto da te.',
    de: 'Was der Segretario über sie verstanden hat, von ihm geschrieben und von Ihnen korrigiert.'
  },
  projectsLead: {
    en: 'Every project with everything that belongs to it, from every source, in the same place.',
    it: 'Ogni progetto con tutto ciò che gli appartiene, da ogni fonte, nello stesso posto.',
    de: 'Jedes Projekt mit allem, was dazugehört, aus jeder Quelle, an einem Ort.'
  },
  projectsTogether: {
    en: 'The project’s conversations, appointments, folders and documents, people and open items, together.',
    it: 'Le conversazioni, gli appuntamenti, le cartelle e i documenti, le persone e le cose aperte del progetto, insieme.',
    de: 'Die Unterhaltungen, Termine, Ordner und Dokumente, Personen und offenen Punkte des Projekts, beisammen.'
  },
  projectsWorkspace: {
    en: 'A workspace, not another archive: everything stays where it is, and a file used by three projects is one file.',
    it: 'Uno spazio di lavoro, non un altro archivio: ogni cosa resta dov’è, e un file usato da tre progetti è un file solo.',
    de: 'Ein Arbeitsbereich, kein weiteres Archiv: Alles bleibt, wo es ist, und eine Datei, die drei Projekte nutzen, ist eine einzige Datei.'
  },
  projectsContext: {
    en: 'A project is a context that lasts — a client, a job, a trip, the house, university —: the Segretario recognizes them and you correct them.',
    it: 'Un progetto è un contesto che dura — un cliente, un lavoro, un viaggio, la casa, l’università —: il Segretario li riconosce e tu li correggi.',
    de: 'Ein Projekt ist ein Zusammenhang, der andauert – ein Kunde, ein Auftrag, eine Reise, das Haus, das Studium –: Der Segretario erkennt sie, und Sie korrigieren sie.'
  },
  projectsMeanwhile: {
    en: 'Meanwhile, the Segretario’s projects are in the Mail sidebar.',
    it: 'Intanto i progetti del Segretario sono nella barra laterale della Posta.',
    de: 'Bis dahin stehen die Projekte des Segretario in der Seitenleiste der E-Mail.'
  },
  notSent: {
    en: 'The message was not sent.',
    it: 'Il messaggio non è partito.',
    de: 'Die Nachricht wurde nicht gesendet.'
  },
  notSentSubject: {
    en: (subject: string) => `The message was not sent: “${subject}”`,
    it: (subject: string) => `Il messaggio non è partito: «${subject}»`,
    de: (subject: string) => `Die Nachricht wurde nicht gesendet: „${subject}“`
  },
  reopenAndRetry: {
    en: 'Reopen and try again',
    it: 'Riapri e riprova',
    de: 'Öffnen und erneut versuchen'
  },
  leaveInDrafts: { en: 'Leave in Drafts', it: 'Lascia in Bozze', de: 'In „Entwürfe“ lassen' }
})
