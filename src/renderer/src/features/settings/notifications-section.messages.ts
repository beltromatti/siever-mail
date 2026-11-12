import type { CalendarRole } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import type { BadgeCount } from '@shared/notifications'

/** What Settings › Notifications says. */
export const MESSAGES = defineMessages({
  onDockIcon: {
    en: 'on the icon in the Dock',
    it: "sull'icona nel Dock",
    de: 'auf dem Symbol im Dock'
  },
  onTaskbarIcon: {
    en: 'on the icon in the taskbar',
    it: "sull'icona nella barra delle applicazioni",
    de: 'auf dem Symbol in der Taskleiste'
  },
  onAppIcon: { en: 'on the app’s icon', it: "sull'icona dell'app", de: 'auf dem App-Symbol' },
  noReminder: { en: 'No reminder', it: 'Nessun promemoria', de: 'Keine Erinnerung' },
  atStart: { en: 'At the start', it: "All'inizio", de: 'Zu Beginn' },
  hourBefore: { en: '1 hour before', it: '1 ora prima', de: '1 Stunde vorher' },
  minutesBefore: {
    en: (minutes: number) => `${minutes} minutes before`,
    it: (minutes: number) => `${minutes} minuti prima`,
    de: (minutes: number) => `${minutes} Minuten vorher`
  },
  principal: { en: 'the main one', it: 'il principale', de: 'der Hauptkalender' },
  hiddenInCalendar: {
    en: 'hidden in the Calendar',
    it: 'nascosto nel Calendario',
    de: 'im Kalender ausgeblendet'
  },
  chosenByYou: { en: 'chosen by you', it: 'scelto da te', de: 'von Ihnen gewählt' },
  letSegretarioDecide: {
    en: 'let the Segretario decide',
    it: 'lascia decidere al Segretario',
    de: 'den Segretario entscheiden lassen'
  },
  restore: { en: 'go back to how it was', it: 'torna a com’era', de: 'zurücksetzen' },
  decidedBySegretario: {
    en: 'decided by the Segretario',
    it: 'deciso dal Segretario',
    de: 'vom Segretario entschieden'
  },
  unreadable: {
    en: 'The notification settings can’t be read.',
    it: 'Impossibile leggere le impostazioni delle notifiche.',
    de: 'Die Benachrichtigungseinstellungen lassen sich nicht lesen.'
  },
  notSaved: {
    en: 'Setting not saved',
    it: 'Impostazione non salvata',
    de: 'Einstellung nicht gespeichert'
  },
  testNotSent: {
    en: 'Test notification not sent',
    it: 'Notifica di prova non inviata',
    de: 'Testbenachrichtigung nicht gesendet'
  },
  systemSettingsNotOpened: {
    en: 'System settings did not open',
    it: 'Impostazioni di sistema non aperte',
    de: 'Systemeinstellungen nicht geöffnet'
  },
  loading: {
    en: 'Loading the settings…',
    it: 'Caricamento delle impostazioni…',
    de: 'Einstellungen werden geladen…'
  },
  appText: {
    en: 'A notification interrupts what you’re doing: it comes only when knowing now, rather than at your next glance, changes what you do. The rest waits for you where you’ll find it.',
    it: 'Una notifica interrompe ciò che stai facendo: arriva solo quando saperlo adesso, e non alla prossima occhiata, cambia ciò che fai. Il resto ti aspetta dove lo trovi.',
    de: 'Eine Benachrichtigung unterbricht, was Sie gerade tun: Sie kommt nur, wenn es jetzt zu wissen – und nicht erst beim nächsten Blick – etwas an Ihrem Tun ändert. Der Rest wartet dort auf Sie, wo Sie ihn finden.'
  },
  unsupported: {
    en: 'This system doesn’t show desktop notifications.',
    it: 'Questo sistema non mostra notifiche sul desktop.',
    de: 'Dieses System zeigt keine Desktop-Benachrichtigungen an.'
  },
  desktop: {
    en: 'Desktop notifications',
    it: 'Notifiche sul desktop',
    de: 'Desktop-Benachrichtigungen'
  },
  preview: { en: 'Show the content', it: 'Mostra il contenuto', de: 'Inhalt anzeigen' },
  previewText: {
    en: (ai: boolean) =>
      `Who is writing, the subject, the events’ titles${ai ? ', the Segretario’s words' : ''}. Without it, they only say what has arrived.`,
    it: (ai: boolean) =>
      `Chi scrive, l'oggetto, il titolo degli eventi${ai ? ', le parole del Segretario' : ''}. Senza, dicono solo che cosa è arrivato.`,
    de: (ai: boolean) =>
      `Wer schreibt, der Betreff, der Titel der Termine${ai ? ', die Worte des Segretario' : ''}. Ohne sie sagen sie nur, was angekommen ist.`
  },
  sound: { en: 'Sound', it: 'Suono', de: 'Ton' },
  alertsText: {
    en: (ai: boolean) =>
      `SIEVER Mail’s alerts${ai ? ' — the AI features off, ' : ' — '}a connection stopped, a message that wasn’t sent — always come when you’re not in front of the window: they don’t put themselves right without you.`,
    it: (ai: boolean) =>
      `Gli avvisi di SIEVER Mail${ai ? ' — le funzioni AI spente, ' : ' — '}una connessione ferma, un messaggio che non è partito — arrivano sempre quando non sei davanti alla finestra: senza di te non si rimettono a posto.`,
    de: (ai: boolean) =>
      `Die Hinweise von SIEVER Mail${ai ? ' – KI-Funktionen ausgeschaltet, ' : ' – '}eine angehaltene Verbindung, eine nicht gesendete Nachricht – kommen immer, wenn Sie nicht vor dem Fenster sind: Ohne Sie kommt das nicht wieder in Ordnung.`
  },
  needsYou: { en: 'When it needs you', it: 'Quando ti serve', de: 'Wenn er Sie braucht' },
  needsYouText: {
    en: 'When it’s waiting for your confirmation, or has finished what you asked while you were elsewhere.',
    it: 'Quando aspetta una tua conferma, o ha finito ciò che gli hai chiesto mentre eri altrove.',
    de: 'Wenn er auf Ihre Bestätigung wartet oder erledigt hat, worum Sie ihn gebeten haben, während Sie woanders waren.'
  },
  day: { en: 'Your day', it: 'La tua giornata', de: 'Ihr Tag' },
  dayText: {
    en: 'In the morning, the first time it’s ready: how the day looks, without opening SIEVER Mail.',
    it: "Al mattino, la prima volta che è pronta: com'è la giornata, senza aprire SIEVER Mail.",
    de: 'Am Morgen, sobald er bereitsteht: wie Ihr Tag aussieht, ohne SIEVER Mail zu öffnen.'
  },
  newMail: { en: 'New mail', it: 'Posta nuova', de: 'Neue E-Mails' },
  newMailText: {
    en: 'Unread messages arriving in the Inbox, with Mark as read and Archive. They disappear by themselves when you read them, even on another device.',
    it: 'I messaggi non letti che arrivano in Posta in arrivo, con Segna come letta e Archivia. Spariscono da soli quando li leggi, anche da un altro dispositivo.',
    de: 'Ungelesene Nachrichten, die im Posteingang ankommen, mit „Als gelesen markieren“ und „Archivieren“. Sie verschwinden von selbst, wenn Sie sie lesen, auch auf einem anderen Gerät.'
  },
  onlyFlagged: {
    en: 'Only what the Segretario points out',
    it: 'Solo ciò che il Segretario ti segnala',
    de: 'Nur, was der Segretario Ihnen meldet'
  },
  onlyFlaggedMailText: {
    en: 'As it reads the mail, it alerts you only to the messages you need to know about now, telling you what they want. You find the others in the mail, without interruptions.',
    it: 'Mentre legge la posta, ti avvisa solo dei messaggi che devi sapere adesso, dicendoti cosa vogliono. Gli altri li trovi nella posta, senza interruzioni.',
    de: 'Während er die E-Mails liest, meldet er Ihnen nur die Nachrichten, von denen Sie jetzt wissen müssen, und sagt Ihnen, was sie wollen. Die anderen finden Sie ohne Unterbrechung bei den E-Mails.'
  },
  mailboxes: {
    en: 'The mailboxes to notify you about:',
    it: 'Le caselle di cui avvisarti:',
    de: 'Die Postfächer, über die Sie benachrichtigt werden:'
  },
  reminders: { en: 'Reminders', it: 'Promemoria', de: 'Erinnerungen' },
  remindersText: {
    en: 'Before your events, at the times each one has in its calendar. Never for an invitation you declined.',
    it: 'Prima dei tuoi eventi, ai tempi che ognuno ha nel suo calendario. Mai per un invito che hai rifiutato.',
    de: 'Vor Ihren Terminen, zu den Zeiten, die jeder in seinem Kalender hat. Nie für eine Einladung, die Sie abgelehnt haben.'
  },
  defaultLead: {
    en: 'For events without a reminder of their own',
    it: 'Agli eventi senza un promemoria loro',
    de: 'Für Termine ohne eigene Erinnerung'
  },
  defaultLeadText: {
    en: 'Not for all-day ones, like birthdays.',
    it: 'Non a quelli di tutto il giorno, come i compleanni.',
    de: 'Nicht für ganztägige, wie Geburtstage.'
  },
  defaultLeadLabel: {
    en: 'Default reminder',
    it: 'Promemoria predefinito',
    de: 'Standarderinnerung'
  },
  changes: {
    en: 'Invitations and changes',
    it: 'Inviti e cambiamenti',
    de: 'Einladungen und Änderungen'
  },
  changesText: {
    en: 'An event of yours that someone else has in hand: an invitation, one moved or cancelled by its organizer, one put in your calendar by someone else. What also arrives by email, the mail tells you.',
    it: 'Un evento tuo che ha in mano qualcun altro: un invito, uno spostato o annullato da chi lo organizza, uno messo nel tuo calendario da un altro. Ciò che arriva anche per posta te lo dice la posta.',
    de: 'Ein Termin von Ihnen, über den jemand anderes verfügt: eine Einladung, ein vom Organisator verschobener oder abgesagter Termin, einer, den jemand anderes in Ihren Kalender eingetragen hat. Was auch per E-Mail ankommt, meldet Ihnen die E-Mail.'
  },
  onlyFlaggedCalendarText: {
    en: 'As it watches the calendar, it alerts you only to the changes you need to know about now, telling you why. If it hasn’t looked at them within ten minutes, they arrive as they are.',
    it: 'Mentre guarda il calendario, ti avvisa solo dei cambiamenti che devi sapere adesso, dicendoti perché. Se non li ha guardati entro dieci minuti, arrivano come sono.',
    de: 'Während er den Kalender beobachtet, meldet er Ihnen nur die Änderungen, von denen Sie jetzt wissen müssen, und sagt Ihnen, warum. Hat er sie nicht innerhalb von zehn Minuten angesehen, kommen sie so, wie sie sind.'
  },
  whoseText: {
    en: (ai: boolean, today: string) =>
      `Which events are yours: they remind you, their news reaches you${ai ? `, and ${today} shows them in your day` : ''}. In a shared calendar or someone else’s, “only yours” are those you’re invited to, organize or created yourself${ai ? ', and those the Segretario recognizes as yours' : ''}.`,
    it: (ai: boolean, today: string) =>
      `Quali eventi sono tuoi: ti ricordano, te ne arrivano le novità${ai ? ` e ${today} li mostra nella tua giornata` : ''}. In un calendario condiviso o di altri, «solo i tuoi» sono quelli a cui sei invitato, che organizzi o che hai creato tu${ai ? ', e quelli che il Segretario riconosce tuoi' : ''}.`,
    de: (ai: boolean, today: string) =>
      `Welche Termine Ihnen gehören: Sie werden daran erinnert, Neuigkeiten dazu erreichen Sie${ai ? `, und ${today} zeigt sie in Ihrem Tag` : ''}. In einem geteilten oder fremden Kalender sind „nur Ihre“ die, zu denen Sie eingeladen sind, die Sie organisieren oder selbst erstellt haben${ai ? ', und die, die der Segretario als Ihre erkennt' : ''}.`
  },
  whoseLabel: {
    en: (calendar: string) => `Which events of ${calendar} are yours`,
    it: (calendar: string) => `Quali eventi di ${calendar} sono tuoi`,
    de: (calendar: string) => `Welche Termine von ${calendar} Ihnen gehören`
  },
  permission: { en: 'System permission', it: 'Permesso del sistema', de: 'Systemberechtigung' },
  permissionText: {
    en: 'The system decides whether to show SIEVER Mail’s notifications, and in what style. With “Do Not Disturb” or a Focus mode on, it holds them back until you turn it off.',
    it: 'È il sistema a decidere se mostrare le notifiche di SIEVER Mail, e con quale stile. Con «Non disturbare» o una modalità Full immersion attiva le trattiene finché non la disattivi.',
    de: 'Das System entscheidet, ob und in welchem Stil es die Benachrichtigungen von SIEVER Mail anzeigt. Mit „Nicht stören“ oder einem aktiven Fokus hält es sie zurück, bis Sie ihn ausschalten.'
  },
  deliveryFailed: {
    en: (time: string) =>
      `The system didn’t show the last notification (${time}). Allow SIEVER Mail’s notifications in the system settings.`,
    it: (time: string) =>
      `Il sistema non ha mostrato l'ultima notifica (${time}). Consenti le notifiche di SIEVER Mail nelle impostazioni di sistema.`,
    de: (time: string) =>
      `Das System hat die letzte Benachrichtigung (${time}) nicht angezeigt. Erlauben Sie die Benachrichtigungen von SIEVER Mail in den Systemeinstellungen.`
  },
  deliveryShown: {
    en: (time: string) =>
      `Last notification shown ${time}. If you didn’t see it, the system held it back.`,
    it: (time: string) =>
      `Ultima notifica mostrata ${time}. Se non l'hai vista, il sistema l'ha trattenuta.`,
    de: (time: string) =>
      `Letzte Benachrichtigung angezeigt: ${time}. Wenn Sie sie nicht gesehen haben, hat das System sie zurückgehalten.`
  },
  deliveryNone: {
    en: 'No notification shown since you opened SIEVER Mail.',
    it: 'Nessuna notifica mostrata da quando hai aperto SIEVER Mail.',
    de: 'Seit dem Öffnen von SIEVER Mail wurde keine Benachrichtigung angezeigt.'
  },
  sendTest: {
    en: 'Send a test notification',
    it: 'Invia una notifica di prova',
    de: 'Testbenachrichtigung senden'
  },
  openSystemSettings: {
    en: 'Open system settings',
    it: 'Apri le impostazioni di sistema',
    de: 'Systemeinstellungen öffnen'
  },
  appIcon: { en: 'App icon', it: "Icona dell'app", de: 'App-Symbol' },
  appIconText: {
    en: (place: string, mac: boolean) =>
      `The number ${place}${mac ? ': on macOS it appears only if SIEVER Mail’s notifications are allowed' : ''}.`,
    it: (place: string, mac: boolean) =>
      `Il numero ${place}${mac ? ': su macOS compare solo se le notifiche di SIEVER Mail sono consentite' : ''}.`,
    de: (place: string, mac: boolean) =>
      `Die Zahl ${place}${mac ? ': Unter macOS erscheint sie nur, wenn die Benachrichtigungen von SIEVER Mail erlaubt sind' : ''}.`
  },
  counts: { en: 'What it counts', it: 'Che cosa conta', de: 'Was gezählt wird' },
  countsText: {
    en: 'What awaits you today: the open items that are yours, due today or already overdue.',
    it: 'Ciò che ti aspetta oggi: le cose aperte che toccano a te, in scadenza oggi o già scadute.',
    de: 'Was heute auf Sie wartet: die offenen Punkte, die bei Ihnen liegen, heute fällig oder bereits überfällig.'
  },
  countsLabel: {
    en: 'The number on the icon',
    it: "Il numero sull'icona",
    de: 'Die Zahl auf dem Symbol'
  },
  allMailboxes: {
    en: 'From all mailboxes.',
    it: 'Di tutte le caselle.',
    de: 'Aus allen Postfächern.'
  }
})

/** Whose a calendar's events are (§7.4), as the user chooses it. */
export const ROLE_WORDS = defineMessages({
  tutti: { en: 'All events', it: 'Tutti gli eventi', de: 'Alle Termine' },
  propri: { en: 'Only yours', it: 'Solo i tuoi', de: 'Nur Ihre' },
  nessuno: { en: 'None', it: 'Nessuno', de: 'Keine' }
}) satisfies Record<CalendarRole, unknown>

/** What the number on the icon counts. */
export const BADGE_WORDS = defineMessages({
  work: {
    en: 'What awaits you today',
    it: 'Ciò che ti aspetta oggi',
    de: 'Was heute auf Sie wartet'
  },
  unread: {
    en: 'Unread messages in the Inbox',
    it: 'I messaggi non letti in Posta in arrivo',
    de: 'Ungelesene Nachrichten im Posteingang'
  },
  none: { en: 'No number', it: 'Nessun numero', de: 'Keine Zahl' }
}) satisfies Record<BadgeCount, unknown>
