import { defineMessages } from '@shared/i18n'

/**
 * What the Segretario's service says to the user (vision §13.5): the errors
 * the page shows, the key's and the credit's state, the lines it writes in
 * the panel and in Oggi — in the interface's language, as they are said.
 */
export const MESSAGES = defineMessages({
  creditTooLow: {
    en: (amount: string) =>
      `The OpenRouter credit left (${amount}) is no longer enough to work: top it up on openrouter.ai to turn the AI features back on.`,
    it: (amount: string) =>
      `Il credito OpenRouter che resta (${amount}) non basta più per lavorare: ricaricalo su openrouter.ai per riaccendere le funzioni AI.`,
    de: (amount: string) =>
      `Das verbleibende OpenRouter-Guthaben (${amount}) reicht nicht mehr zum Arbeiten: Laden Sie es auf openrouter.ai auf, um die KI-Funktionen wieder einzuschalten.`
  },
  creditGone: {
    en: 'Your OpenRouter credit has run out: top it up on openrouter.ai to turn the AI features back on.',
    it: 'Il credito OpenRouter è finito: ricaricalo su openrouter.ai per riaccendere le funzioni AI.',
    de: 'Ihr OpenRouter-Guthaben ist aufgebraucht: Laden Sie es auf openrouter.ai auf, um die KI-Funktionen wieder einzuschalten.'
  },
  interruptedByQuit: {
    en: 'Stopped: SIEVER Mail was closed while I was working. Write to me to pick up again.',
    it: 'Interrotto: SIEVER Mail è stato chiuso mentre lavoravo. Scrivimi per riprendere.',
    de: 'Unterbrochen: SIEVER Mail wurde geschlossen, während ich arbeitete. Schreiben Sie mir, um fortzufahren.'
  },
  notReady: {
    en: 'The Segretario isn’t ready yet.',
    it: 'Il Segretario non è ancora pronto.',
    de: 'Der Segretario ist noch nicht bereit.'
  },
  notAKey: {
    en: 'This doesn’t look like an OpenRouter key: it starts with “sk-or-”.',
    it: 'Questa non sembra una chiave OpenRouter: inizia con «sk-or-».',
    de: 'Das sieht nicht nach einem OpenRouter-Schlüssel aus: Er beginnt mit „sk-or-“.'
  },
  keyUnknown: {
    en: 'OpenRouter doesn’t recognise this key: check you copied all of it.',
    it: 'OpenRouter non riconosce questa chiave: controlla di averla copiata intera.',
    de: 'OpenRouter erkennt diesen Schlüssel nicht: Prüfen Sie, ob Sie ihn vollständig kopiert haben.'
  },
  noContextLength: {
    en: 'OpenRouter doesn’t say how many tokens the model reads.',
    it: 'OpenRouter non dice quanti token legge il modello.',
    de: 'OpenRouter gibt nicht an, wie viele Tokens das Modell liest.'
  },
  noKey: {
    en: 'To work I need an OpenRouter key: enter it in Settings › Segretario.',
    it: 'Per lavorare mi serve una chiave OpenRouter: inseriscila in Impostazioni › Segretario.',
    de: 'Zum Arbeiten brauche ich einen OpenRouter-Schlüssel: Geben Sie ihn unter Einstellungen › Segretario ein.'
  },
  creditGoneTurnOn: {
    en: 'Your OpenRouter credit has run out: top it up on openrouter.ai, then turn the AI features back on.',
    it: 'Il credito OpenRouter è finito: ricaricalo su openrouter.ai, poi riaccendi le funzioni AI.',
    de: 'Ihr OpenRouter-Guthaben ist aufgebraucht: Laden Sie es auf openrouter.ai auf und schalten Sie dann die KI-Funktionen wieder ein.'
  },
  keyRefused: {
    en: 'OpenRouter doesn’t accept the key: enter a valid one, then turn the AI back on.',
    it: 'OpenRouter non accetta la chiave: inseriscine una valida, poi riaccendi.',
    de: 'OpenRouter akzeptiert den Schlüssel nicht: Geben Sie einen gültigen ein und schalten Sie die KI dann wieder ein.'
  },
  noteChangedMeanwhile: {
    en: 'The Segretario changed this note while you were writing it: open it again, see how it is now and redo your change.',
    it: 'Il Segretario ha cambiato questa nota mentre la scrivevi: riaprila, guarda com’è ora e rifai la tua modifica.',
    de: 'Der Segretario hat diese Notiz geändert, während Sie sie bearbeitet haben: Öffnen Sie sie erneut, sehen Sie sich den aktuellen Stand an und wiederholen Sie Ihre Änderung.'
  },
  noConnections: {
    en: 'There are no connections to get to know.',
    it: 'Non ci sono connessioni da conoscere.',
    de: 'Es gibt keine Verbindungen zum Kennenlernen.'
  },
  /** The user's line that opens Conoscimi, in the panel. */
  getToKnowMe: { en: 'Get to know me', it: 'Fatti conoscere', de: 'Lerne mich kennen' },
  nothingToUndo: {
    en: 'There’s nothing to undo.',
    it: 'Non c’è niente da annullare.',
    de: 'Es gibt nichts rückgängig zu machen.'
  },
  messageGone: {
    en: 'The message is no longer in your mail.',
    it: 'Il messaggio non è più nella posta.',
    de: 'Die Nachricht ist nicht mehr in Ihren E-Mails.'
  },
  eventGone: {
    en: 'The event is no longer in the calendar.',
    it: 'L’evento non è più nel calendario.',
    de: 'Der Termin ist nicht mehr im Kalender.'
  },
  eventNotThere: {
    en: 'The event isn’t in the calendar any more.',
    it: 'L’evento non c’è più nel calendario.',
    de: 'Den Termin gibt es im Kalender nicht mehr.'
  },
  /** Why what the user marked handled is done: kept with it, and shown. */
  markedHandled: {
    en: 'Marked as handled.',
    it: 'Segnata come gestita.',
    de: 'Als erledigt markiert.'
  },
  changeGone: {
    en: 'This change is no longer there.',
    it: 'Questa modifica non c’è più.',
    de: 'Diese Änderung ist nicht mehr vorhanden.'
  },
  changeNotUndoable: {
    en: 'This change can’t be undone from here.',
    it: 'Questa modifica non si può annullare da qui.',
    de: 'Diese Änderung lässt sich hier nicht rückgängig machen.'
  },
  changeUndone: {
    en: 'This change has already been undone.',
    it: 'Questa modifica è già stata annullata.',
    de: 'Diese Änderung wurde bereits rückgängig gemacht.'
  },
  proposalDeciding: {
    en: 'This proposal is already being decided.',
    it: 'Questa proposta si sta già decidendo.',
    de: 'Über diesen Vorschlag wird bereits entschieden.'
  },
  proposalNotWaiting: {
    en: 'This proposal is no longer waiting.',
    it: 'Questa proposta non è più in attesa.',
    de: 'Dieser Vorschlag steht nicht mehr aus.'
  },
  proposalChanged: {
    en: 'The proposal has changed since you saw it: look at it again.',
    it: 'La proposta è cambiata da quando l’hai vista: guardala di nuovo.',
    de: 'Der Vorschlag hat sich geändert, seit Sie ihn gesehen haben: Sehen Sie ihn sich erneut an.'
  },
  noCalendar: {
    en: 'No connected calendar to put it in: connect one in Settings › Connections.',
    it: 'Nessun calendario collegato in cui metterlo: collegalo in Impostazioni › Connessioni.',
    de: 'Kein verbundener Kalender, in den er eingetragen werden kann: Verbinden Sie einen unter Einstellungen › Verbindungen.'
  },
  /** Who wrote a message, when it is the user: a line of the day says so. */
  you: { en: 'You', it: 'Tu', de: 'Sie' },
  noProjectFolder: {
    en: 'This project has no linked folder.',
    it: 'Questo progetto non ha una cartella collegata.',
    de: 'Dieses Projekt hat keinen verknüpften Ordner.'
  },
  reviewMissing: {
    en: 'Give the outcome with `revisione`.',
    it: 'Dai l’esito con `revisione`.',
    de: 'Das Ergebnis mit `revisione` angeben.'
  },
  searchMissing: {
    en: 'Show the search with `mostra` (`ricerca`).',
    it: 'Mostra la ricerca con `mostra` (`ricerca`).',
    de: 'Die Suche mit `mostra` (`ricerca`) zeigen.'
  },
  stopped: { en: 'Stopped.', it: 'Interrotto.', de: 'Unterbrochen.' },
  searchNotUnderstood: {
    en: 'I couldn’t work out what to search for.',
    it: 'Non sono riuscito a capire cosa cercare.',
    de: 'Ich konnte nicht herausfinden, wonach gesucht werden soll.'
  },
  searchGone: {
    en: 'This search is no longer there: ask for it again to keep it.',
    it: 'Questa ricerca non c’è più: chiedila di nuovo per tenerla.',
    de: 'Diese Suche ist nicht mehr vorhanden: Stellen Sie sie erneut, um sie zu behalten.'
  },
  stillWorking: {
    en: 'I’m still working on this: wait for me to finish, or stop me.',
    it: 'Sto ancora lavorando su questo: aspetta che finisca o fermami.',
    de: 'Ich arbeite noch daran: Warten Sie, bis ich fertig bin, oder halten Sie mich an.'
  },
  workGone: {
    en: 'This task no longer exists.',
    it: 'Questo lavoro non esiste più.',
    de: 'Diese Aufgabe gibt es nicht mehr.'
  },
  notRetryable: {
    en: 'This task isn’t one to try again.',
    it: 'Questo lavoro non è da riprovare.',
    de: 'Diese Aufgabe lässt sich nicht erneut versuchen.'
  }
})

/** How a list asked in words searches, part by part: the line under its title. */
export const HOW = defineMessages({
  text: {
    en: (text: string) => `“${text}”`,
    it: (text: string) => `«${text}»`,
    de: (text: string) => `„${text}“`
  },
  folder: {
    en: (folder: string) => `in ${folder}`,
    it: (folder: string) => `in ${folder}`,
    de: (folder: string) => `in ${folder}`
  },
  account: {
    en: (account: string) => `in ${account}`,
    it: (account: string) => `di ${account}`,
    de: (account: string) => `in ${account}`
  },
  fromTo: {
    en: (from: string, to: string) => `from ${from} to ${to}`,
    it: (from: string, to: string) => `dal ${from} al ${to}`,
    de: (from: string, to: string) => `vom ${from} bis ${to}`
  },
  from: {
    en: (from: string) => `from ${from}`,
    it: (from: string) => `dal ${from}`,
    de: (from: string) => `ab ${from}`
  },
  until: {
    en: (to: string) => `until ${to}`,
    it: (to: string) => `fino al ${to}`,
    de: (to: string) => `bis ${to}`
  },
  unread: { en: 'unread', it: 'non letti', de: 'ungelesen' },
  withAttachments: { en: 'with attachments', it: 'con allegati', de: 'mit Anhängen' }
})

/** What spending is shown under, beside the tasks: the work that is not a task of its own. */
export const PURPOSES = defineMessages({
  compaction: {
    en: 'Summaries of long work',
    it: 'Riassunti dei lavori lunghi',
    de: 'Zusammenfassungen langer Arbeiten'
  },
  titles: { en: 'Work titles', it: 'Titoli dei lavori', de: 'Titel der Arbeiten' },
  requestsV1: {
    en: 'Requests (first version)',
    it: 'Richieste (prima versione)',
    de: 'Anfragen (erste Version)'
  },
  readingV1: {
    en: 'Reading the mail (first version)',
    it: 'Lettura della posta (prima versione)',
    de: 'E-Mails lesen (erste Version)'
  },
  readyRepliesV1: {
    en: 'Ready replies (first version)',
    it: 'Risposte pronte (prima versione)',
    de: 'Fertige Antworten (erste Version)'
  },
  followUpsV1: {
    en: 'Follow-ups (first version)',
    it: 'Solleciti (prima versione)',
    de: 'Nachfassen (erste Version)'
  },
  dayV1: {
    en: 'The day (first version)',
    it: 'La giornata (prima versione)',
    de: 'Der Tag (erste Version)'
  },
  topicsV1: {
    en: 'Topics (first version)',
    it: 'Argomenti (prima versione)',
    de: 'Themen (erste Version)'
  },
  writingV1: {
    en: 'Writing in the editor (first version)',
    it: 'Scrittura nell’editor (prima versione)',
    de: 'Schreiben im Editor (erste Version)'
  }
})
