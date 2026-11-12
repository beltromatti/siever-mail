import { defineMessages } from '@shared/i18n'

/** What the guided setup says, step by step. */
export const MESSAGES = defineMessages({
  steps: { en: 'Steps', it: 'Passi', de: 'Schritte' },
  cancel: { en: 'Cancel', it: 'Annulla', de: 'Abbrechen' },
  continue: { en: 'Continue', it: 'Continua', de: 'Weiter' },
  close: { en: 'Close', it: 'Chiudi', de: 'Schließen' },
  retry: { en: 'Try again', it: 'Riprova', de: 'Erneut versuchen' },
  continueWithoutAi: {
    en: 'Continue without AI',
    it: 'Continua senza AI',
    de: 'Ohne KI fortfahren'
  },

  connectionsTitle: { en: 'Your connections', it: 'Le tue connessioni', de: 'Ihre Verbindungen' },
  connectionsLead: {
    en: 'Connect the mail and calendars you use: each mailbox and each calendar is a connection of its own, and soon the volumes and drives of your files too. One is enough, of any kind.',
    it: 'Collega la posta e i calendari che usi: ogni casella e ogni calendario è una connessione a sé, e presto anche i volumi e i drive dei tuoi file. Ne basta una, di qualunque tipo.',
    de: 'Verbinden Sie die E-Mail-Konten und Kalender, die Sie nutzen: Jedes Postfach und jeder Kalender ist eine eigene Verbindung, bald auch die Laufwerke und Cloud-Speicher Ihrer Dateien. Eine genügt, gleich welcher Art.'
  },
  addConnection: {
    en: 'Add a connection',
    it: 'Aggiungi una connessione',
    de: 'Verbindung hinzufügen'
  },
  firstConnection: {
    en: 'Add your first connection',
    it: 'Collega la prima connessione',
    de: 'Erste Verbindung hinzufügen'
  },

  failed: { en: 'It didn’t work.', it: 'Non è andata.', de: 'Das hat nicht geklappt.' },
  segretarioAgain: {
    en: 'Turn the Segretario back on',
    it: 'Riaccendi il Segretario',
    de: 'Den Segretario wieder einschalten'
  },
  segretarioTitle: { en: 'The Segretario', it: 'Il Segretario', de: 'Der Segretario' },
  segretarioLead: {
    en: 'The Segretario follows your mail and calendars as they change, keeps track of what is asked of you, what you promised and what you’re waiting for, recognizes your projects, and prepares replies, meetings and your day. It works with a language model you use through your own OpenRouter account: you pay only for what it does.',
    it: 'Il Segretario segue la tua posta e i tuoi calendari mentre cambiano, tiene il conto di quello che ti chiedono, di quello che hai promesso e di quello che aspetti, riconosce i tuoi progetti, prepara le risposte, gli incontri e la tua giornata. Lavora con un modello linguistico che usi con il tuo account OpenRouter: paghi solo quello che fa.',
    de: 'Der Segretario verfolgt Ihre E-Mails und Kalender, während sie sich ändern, behält im Blick, was an Sie gerichtet ist, was Sie zugesagt haben und worauf Sie warten, erkennt Ihre Projekte und bereitet Antworten, Besprechungen und Ihren Tag vor. Er arbeitet mit einem Sprachmodell, das Sie über Ihr eigenes OpenRouter-Konto nutzen: Sie zahlen nur für das, was er tut.'
  },
  notNow: { en: 'Not now', it: 'Non ora', de: 'Nicht jetzt' },
  turnOnAi: {
    en: 'Turn on AI features',
    it: 'Accendi le funzioni AI',
    de: 'KI-Funktionen einschalten'
  },
  creditExhausted: {
    en: 'Your OpenRouter credit has run out, or the key has reached its spending limit: the AI features can be turned back on once there is credit again.',
    it: "Il credito OpenRouter è finito, o la chiave ha raggiunto il suo limite di spesa: le funzioni AI si possono riaccendere quando c'è di nuovo credito.",
    de: 'Ihr OpenRouter-Guthaben ist aufgebraucht, oder der Schlüssel hat sein Ausgabenlimit erreicht: Die KI-Funktionen lassen sich wieder einschalten, sobald wieder Guthaben vorhanden ist.'
  },
  topUp: {
    en: 'Top up on OpenRouter',
    it: 'Ricarica su OpenRouter',
    de: 'Bei OpenRouter aufladen'
  },
  stillExhausted: {
    en: 'The credit still shows as used up: if you just topped up, try again in a moment.',
    it: 'Il credito risulta ancora finito: se hai appena ricaricato, riprova tra qualche istante.',
    de: 'Das Guthaben ist weiterhin aufgebraucht: Wenn Sie gerade aufgeladen haben, versuchen Sie es gleich noch einmal.'
  },
  toppedUp: {
    en: 'I’ve topped up, check',
    it: 'Ho ricaricato, verifica',
    de: 'Aufgeladen, prüfen'
  },
  keyConnected: {
    en: 'OpenRouter key connected',
    it: 'Chiave OpenRouter collegata',
    de: 'OpenRouter-Schlüssel verbunden'
  },
  credit: {
    en: (amount: string) => `credit ${amount}`,
    it: (amount: string) => `credito ${amount}`,
    de: (amount: string) => `Guthaben ${amount}`
  },
  keyLabel: { en: 'OpenRouter key', it: 'Chiave OpenRouter', de: 'OpenRouter-Schlüssel' },
  check: { en: 'Check', it: 'Verifica', de: 'Prüfen' },
  noKey: {
    en: 'No key? Create an account on OpenRouter, add a few dollars of credit and generate a key.',
    it: 'Non hai una chiave? Crea un account su OpenRouter, aggiungi qualche dollaro di credito e genera una chiave.',
    de: 'Kein Schlüssel? Erstellen Sie ein Konto bei OpenRouter, laden Sie ein paar Dollar Guthaben auf und erzeugen Sie einen Schlüssel.'
  },
  openOpenRouter: {
    en: 'Open openrouter.ai',
    it: 'Apri openrouter.ai',
    de: 'openrouter.ai öffnen'
  },

  offline: {
    en: 'No network: it resumes by itself as soon as it’s back.',
    it: 'Senza rete: riprende da sola appena torna.',
    de: 'Kein Netzwerk: Es geht von selbst weiter, sobald es wieder da ist.'
  },
  serverDown: {
    en: 'The server isn’t answering: it tries again by itself.',
    it: 'Il server non risponde: riprova da sola.',
    de: 'Der Server antwortet nicht: Es wird von selbst erneut versucht.'
  },
  reconnecting: { en: 'Reconnecting…', it: 'Si ricollega…', de: 'Verbindet sich erneut…' },
  downloadingMail: {
    en: 'Downloading the mail…',
    it: 'Scarico la posta…',
    de: 'E-Mails werden geladen…'
  },
  readingRecent: {
    en: (percent: number | null) =>
      `Reading the text of recent messages…${percent === null ? '' : ` ${percent}%`}`,
    it: (percent: number | null) =>
      `Leggo il testo dei messaggi recenti…${percent === null ? '' : ` ${percent}%`}`,
    de: (percent: number | null) =>
      `Der Text der neuesten Nachrichten wird gelesen…${percent === null ? '' : ` ${percent} %`}`
  },
  mailboxReady: { en: 'Ready', it: 'Pronta', de: 'Bereit' },
  calendarReady: { en: 'Ready', it: 'Pronto', de: 'Bereit' },
  retriesAlone: {
    en: (problem: string) => `${problem} It tries again by itself.`,
    it: (problem: string) => `${problem} Riprova da solo.`,
    de: (problem: string) => `${problem} Es wird von selbst erneut versucht.`
  },
  downloadingEvents: {
    en: 'Downloading the events…',
    it: 'Scarico gli eventi…',
    de: 'Termine werden geladen…'
  },
  disconnectCalendar: {
    en: (label: string) => `Disconnect the calendar of ${label}?`,
    it: (label: string) => `Scollegare il calendario di ${label}?`,
    de: (label: string) => `Den Kalender von ${label} trennen?`
  },
  disconnectCalendarText: {
    en: 'Its events disappear from SIEVER Mail; in the calendar they stay as they are. You can reconnect it whenever you like.',
    it: 'I suoi eventi spariscono da SIEVER Mail; nel calendario restano come sono. Puoi ricollegarlo quando vuoi.',
    de: 'Seine Termine verschwinden aus SIEVER Mail; im Kalender bleiben sie, wie sie sind. Sie können ihn jederzeit wieder verbinden.'
  },
  disconnect: { en: 'Disconnect', it: 'Scollega', de: 'Trennen' },
  calendarNotDisconnected: {
    en: 'The calendar was not disconnected',
    it: 'Il calendario non si è scollegato',
    de: 'Der Kalender wurde nicht getrennt'
  },
  calendarsOf: {
    en: (label: string) => `${label} · calendars`,
    it: (label: string) => `${label} · calendari`,
    de: (label: string) => `${label} · Kalender`
  },
  preparationTitle: {
    en: 'Preparing your connections',
    it: 'Preparo le connessioni',
    de: 'Verbindungen werden vorbereitet'
  },
  preparationCalendars: {
    en: 'Downloading the events of every calendar.',
    it: 'Scarico gli eventi di ogni calendario.',
    de: 'Die Termine jedes Kalenders werden geladen.'
  },
  preparationWithAi: {
    en: (calendars: boolean) =>
      `Downloading the mail${calendars ? ' and calendars' : ''} of every connection and reading the text of recent messages: that’s where the Segretario starts.`,
    it: (calendars: boolean) =>
      `Scarico la posta${calendars ? ' e i calendari' : ''} di ogni connessione e leggo il testo dei messaggi recenti: è da lì che il Segretario comincia.`,
    de: (calendars: boolean) =>
      `Die E-Mails${calendars ? ' und Kalender' : ''} jeder Verbindung werden geladen und der Text der neuesten Nachrichten gelesen: Dort beginnt der Segretario.`
  },
  preparationWithoutAi: {
    en: (calendars: boolean) =>
      `Downloading the mail${calendars ? ' and calendars' : ''} of every connection. Older messages keep arriving while you work.`,
    it: (calendars: boolean) =>
      `Scarico la posta${calendars ? ' e i calendari' : ''} di ogni connessione. I messaggi più vecchi continuano ad arrivare mentre lavori.`,
    de: (calendars: boolean) =>
      `Die E-Mails${calendars ? ' und Kalender' : ''} jeder Verbindung werden geladen. Ältere Nachrichten kommen weiter an, während Sie arbeiten.`
  },
  retryNow: { en: 'Try again now', it: 'Riprova ora', de: 'Jetzt erneut versuchen' },
  remove: { en: 'Remove', it: 'Togli', de: 'Entfernen' },
  reconnect: { en: 'Reconnect', it: 'Ricollega', de: 'Erneut verbinden' },
  refusedNote: {
    en: (count: number) =>
      count === 1
        ? 'One connection isn’t working, and a connection that isn’t working can’t be set up: reconnect it, or remove it and add it when it’s fixed.'
        : `${count} connections aren’t working, and a connection that isn’t working can’t be set up: reconnect them, or remove them and add them when they’re fixed.`,
    it: (count: number) =>
      `${count === 1 ? 'Una connessione non funziona' : `${count} connessioni non funzionano`}, e una connessione che non funziona non si collega: ricollega${count === 1 ? 'la' : 'le'}, o togli${count === 1 ? 'la' : 'le'} e aggiungi${count === 1 ? 'la' : 'le'} quando è a posto.`,
    de: (count: number) =>
      count === 1
        ? 'Eine Verbindung funktioniert nicht, und eine Verbindung, die nicht funktioniert, wird nicht eingerichtet: Verbinden Sie sie erneut, oder entfernen Sie sie und fügen Sie sie wieder hinzu, wenn sie in Ordnung ist.'
        : `${count} Verbindungen funktionieren nicht, und eine Verbindung, die nicht funktioniert, wird nicht eingerichtet: Verbinden Sie sie erneut, oder entfernen Sie sie und fügen Sie sie wieder hinzu, wenn sie in Ordnung sind.`
  },
  waitingNote: {
    en: (count: number) =>
      `${count === 1 ? 'A server isn’t answering' : `${count} servers aren’t answering`}: SIEVER Mail tries again by itself, and you go on as soon as ${count === 1 ? 'it answers' : 'they answer'}. If you don’t want to wait, remove the connection and add it later.`,
    it: (count: number) =>
      `${count === 1 ? 'Un server non risponde' : `${count} server non rispondono`}: SIEVER Mail riprova da solo, e si va avanti appena ${count === 1 ? 'risponde' : 'rispondono'}. Se non vuoi aspettare, togli la connessione e aggiungila più tardi.`,
    de: (count: number) =>
      `${count === 1 ? 'Ein Server antwortet nicht' : `${count} Server antworten nicht`}: SIEVER Mail versucht es von selbst erneut, und es geht weiter, sobald ${count === 1 ? 'er antwortet' : 'sie antworten'}. Wenn Sie nicht warten möchten, entfernen Sie die Verbindung und fügen Sie sie später hinzu.`
  },

  conoscimiNotStarted: {
    en: (name: string) => `“${name}” didn’t start.`,
    it: (name: string) => `${name} non è partito.`,
    de: (name: string) => `„${name}“ ist nicht gestartet.`
  },
  introduce: { en: 'Introduce yourself', it: 'Fatti conoscere', de: 'Stellen Sie sich vor' },
  conoscimiAgain: {
    en: 'The Segretario already knows you: it rereads your connections and updates what it knows, without erasing it. If not much has changed meanwhile, it won’t take long.',
    it: 'Il Segretario ti conosce già: rilegge le tue connessioni e aggiorna quello che sa, senza cancellarlo. Se nel frattempo non è cambiato molto, ci mette poco.',
    de: 'Der Segretario kennt Sie bereits: Er liest Ihre Verbindungen erneut und ergänzt, was er weiß, ohne es zu löschen. Hat sich inzwischen wenig geändert, geht es schnell.'
  },
  conoscimiAdding: {
    en: (count: number, labels: string) =>
      `The Segretario already knows you: now it reads ${count === 1 ? 'the connection it doesn’t know yet' : 'the connections it doesn’t know yet'} — ${labels} — and ties ${count === 1 ? 'it' : 'them'} to what it knows about you, your work and the people. It takes notes you can read and correct. You can watch it while it works.`,
    it: (count: number, labels: string) =>
      `Il Segretario ti conosce già: ora legge ${count === 1 ? 'la connessione che non conosce ancora' : 'le connessioni che non conosce ancora'} — ${labels} — e ${count === 1 ? 'la lega' : 'le lega'} a quello che sa di te, del tuo lavoro e delle persone. Prende appunti che potrai leggere e correggere. Puoi guardarlo mentre lavora.`,
    de: (count: number, labels: string) =>
      `Der Segretario kennt Sie bereits: Jetzt liest er ${count === 1 ? 'die Verbindung, die er noch nicht kennt' : 'die Verbindungen, die er noch nicht kennt'} – ${labels} – und verknüpft sie mit dem, was er über Sie, Ihre Arbeit und die Menschen weiß. Er macht sich Notizen, die Sie lesen und korrigieren können. Sie können ihm bei der Arbeit zusehen.`
  },
  conoscimiFirst: {
    en: 'Before starting, the Segretario reads your mail, calendars and folders to understand who you are, how you work, with whom and on what. It takes notes you can read and correct. You can watch it while it works.',
    it: 'Prima di cominciare, il Segretario legge la tua posta, i calendari e le tue cartelle per capire chi sei, come lavori, con chi e su cosa. Prende appunti che potrai leggere e correggere. Puoi guardarlo mentre lavora.',
    de: 'Bevor er beginnt, liest der Segretario Ihre E-Mails, Kalender und Ordner, um zu verstehen, wer Sie sind, wie Sie arbeiten, mit wem und woran. Er macht sich Notizen, die Sie lesen und korrigieren können. Sie können ihm bei der Arbeit zusehen.'
  },
  done: { en: 'Done', it: 'Fatto', de: 'Fertig' },
  stopped: { en: 'Stopped', it: 'Interrotto', de: 'Unterbrochen' },
  atWork: { en: 'At work…', it: 'Al lavoro…', de: 'Bei der Arbeit…' },
  conoscimiStoppedKept: {
    en: (name: string) => `“${name}” stopped before the end: what it knew before stays.`,
    it: (name: string) => `${name} si è fermato prima della fine: quello che sapeva prima resta.`,
    de: (name: string) =>
      `„${name}“ wurde vor dem Ende angehalten: Was der Segretario vorher wusste, bleibt.`
  },
  conoscimiStopped: {
    en: (name: string) =>
      `“${name}” stopped before the end. The Segretario doesn’t start without knowing you: try again, or continue without AI and turn it back on whenever you like.`,
    it: (name: string) =>
      `${name} si è fermato prima della fine. Senza conoscerti il Segretario non comincia: riprova, o continua senza AI e riaccendila quando vuoi.`,
    de: (name: string) =>
      `„${name}“ wurde vor dem Ende angehalten. Ohne Sie zu kennen, beginnt der Segretario nicht: Versuchen Sie es erneut, oder fahren Sie ohne KI fort und schalten Sie sie wieder ein, wann Sie möchten.`
  },
  conoscimiResumes: {
    en: (name: string) => `“${name}” picks up by itself where it left off.`,
    it: (name: string) => `${name} riprende da solo da dove era.`,
    de: (name: string) => `„${name}“ macht von selbst dort weiter, wo es aufgehört hat.`
  },

  lessThanMinute: {
    en: 'less than a minute',
    it: 'meno di un minuto',
    de: 'weniger als eine Minute'
  },
  aboutMinute: { en: 'about a minute', it: 'circa un minuto', de: 'etwa eine Minute' },
  aboutMinutes: {
    en: (minutes: number) => `about ${minutes} minutes`,
    it: (minutes: number) => `circa ${minutes} minuti`,
    de: (minutes: number) => `etwa ${minutes} Minuten`
  },
  left: {
    en: (time: string) => `${time} left`,
    it: (time: string) => `Manca ${time}`,
    de: (time: string) => `Noch ${time}`
  },
  retryFailed: {
    en: 'I can’t try again',
    it: 'Non riesco a riprovare',
    de: 'Erneuter Versuch nicht möglich'
  },
  readingTitle: {
    en: 'The Segretario catches up',
    it: 'Il Segretario si mette al passo',
    de: 'Der Segretario holt auf'
  },
  readingLead: {
    en: 'It reads each connection as far back as it decided while getting to know you: the messages one by one, as if they had just arrived, and the calendar’s appointments. It notes what is asked of you, opens the things to do, recognizes the projects, prepares the replies that are needed.',
    it: 'Legge ogni connessione fin dove ha deciso conoscendoti: i messaggi uno per uno, come se fossero appena arrivati, e gli impegni del calendario. Annota cosa ti chiedono, apre le cose da fare, riconosce i progetti, prepara le risposte che servono.',
    de: 'Er liest jede Verbindung so weit zurück, wie er beim Kennenlernen entschieden hat: die Nachrichten eine nach der anderen, als wären sie gerade angekommen, und die Termine im Kalender. Er notiert, was an Sie gerichtet ist, legt an, was zu tun ist, erkennt die Projekte und bereitet die nötigen Antworten vor.'
  },
  reading: { en: 'Reading…', it: 'Sto leggendo…', de: 'Wird gelesen…' },
  messagesRead: {
    en: (read: string, total: string) => `Read ${read} of ${total} messages`,
    it: (read: string, total: string) => `Letti ${read} messaggi su ${total}`,
    de: (read: string, total: string) => `${read} von ${total} Nachrichten gelesen`
  },
  eventsLooked: {
    en: (looked: string, total: string) => `looked at ${looked} of ${total} events`,
    it: (looked: string, total: string) => `guardati ${looked} eventi su ${total}`,
    de: (looked: string, total: string) => `${looked} von ${total} Terminen angesehen`
  },
  nothingToRead: { en: 'Nothing to read', it: 'Niente da leggere', de: 'Nichts zu lesen' },
  counting: {
    en: 'Counting the messages…',
    it: 'Conto i messaggi…',
    de: 'Nachrichten werden gezählt…'
  },
  stillDownloading: {
    en: 'Still downloading older mail: I read it as it arrives.',
    it: 'Scarico ancora la posta più vecchia: la leggo man mano che arriva.',
    de: 'Ältere E-Mails werden noch geladen: Ich lese sie, sobald sie ankommen.'
  },
  calendarNamed: {
    en: (label: string) => `Calendar ${label}`,
    it: (label: string) => `Calendario ${label}`,
    de: (label: string) => `Kalender ${label}`
  },
  calendarHorizon: {
    en: (days: number) => `everything: from ${days} days ago to a year ahead`,
    it: (days: number) => `tutto: da ${days} giorni fa a un anno avanti`,
    de: (days: number) => `alles: von vor ${days} Tagen bis ein Jahr voraus`
  },
  mailHorizon: {
    en: (days: number) => `last ${days} days`,
    it: (days: number) => `ultimi ${days} giorni`,
    de: (days: number) => `letzte ${days} Tage`
  },
  segretarioResumes: {
    en: 'The Segretario picks up by itself where it left off; if the problem persists, you can continue without AI.',
    it: 'Il Segretario riprende da solo da dove era; se il problema resta, puoi continuare senza AI.',
    de: 'Der Segretario macht von selbst dort weiter, wo er aufgehört hat; wenn das Problem bleibt, können Sie ohne KI fortfahren.'
  },
  readingsFailed: {
    en: (count: number) =>
      count === 1
        ? 'One reading failed: try it again, or continue without AI.'
        : `${count} readings failed: try them again, or continue without AI.`,
    it: (count: number) =>
      count === 1
        ? 'Una lettura non è riuscita: riprovala, o continua senza AI.'
        : `${count} letture non sono riuscite: riprovale, o continua senza AI.`,
    de: (count: number) =>
      count === 1
        ? 'Ein Lesevorgang ist fehlgeschlagen: Wiederholen Sie ihn, oder fahren Sie ohne KI fort.'
        : `${count} Lesevorgänge sind fehlgeschlagen: Wiederholen Sie sie, oder fahren Sie ohne KI fort.`
  },

  ready: { en: 'Ready', it: 'Pronto', de: 'Bereit' },
  enterWithAi: {
    en: (today: string) =>
      `The Segretario is caught up: you’ll find your day in ${today}, with what to handle, what you’re waiting for, the ready replies and your projects. From here on it follows what changes.`,
    it: (today: string) =>
      `Il Segretario è al passo: trovi la giornata in ${today}, con le cose da gestire, quelle che aspetti, le risposte pronte e i tuoi progetti. Da qui in poi segue quello che cambia.`,
    de: (today: string) =>
      `Der Segretario ist auf dem Laufenden: Ihren Tag finden Sie unter ${today}, mit dem, was zu erledigen ist, worauf Sie warten, den fertigen Antworten und Ihren Projekten. Von nun an verfolgt er, was sich ändert.`
  },
  enterWithoutAi: {
    en: (settings: string, segretario: string) =>
      `Your apps are ready. You can turn on the Segretario whenever you like, from ${settings} › ${segretario}.`,
    it: (settings: string, segretario: string) =>
      `Le tue app sono pronte. Puoi accendere il Segretario quando vuoi, da ${settings} › ${segretario}.`,
    de: (settings: string, segretario: string) =>
      `Ihre Apps sind bereit. Sie können den Segretario jederzeit einschalten, unter ${settings} › ${segretario}.`
  },
  enter: { en: 'Enter SIEVER Mail', it: 'Entra in SIEVER Mail', de: 'SIEVER Mail öffnen' }
})
