import { defineMessages } from '@shared/i18n'
import type { SegretarioKeyState } from '@shared/segretario'

/** What Settings › Segretario says. */
export const MESSAGES = defineMessages({
  lessThan: {
    en: (amount: string) => `less than ${amount}`,
    it: (amount: string) => `meno di ${amount}`,
    de: (amount: string) => `weniger als ${amount}`
  },
  unreadable: {
    en: 'The Segretario’s settings can’t be read.',
    it: 'Impossibile leggere le impostazioni del Segretario.',
    de: 'Die Einstellungen des Segretario lassen sich nicht lesen.'
  },
  keyUnchecked: {
    en: 'Key saved, but not checked',
    it: 'Chiave salvata, ma non verificata',
    de: 'Schlüssel gespeichert, aber nicht geprüft'
  },
  keyNotSaved: {
    en: 'The key was not saved.',
    it: 'La chiave non è stata salvata.',
    de: 'Der Schlüssel wurde nicht gespeichert.'
  },
  notSaved: {
    en: 'Setting not saved',
    it: 'Impostazione non salvata',
    de: 'Einstellung nicht gespeichert'
  },
  checkFailed: { en: 'Check failed', it: 'Verifica non riuscita', de: 'Prüfung fehlgeschlagen' },
  removeKeyTitle: {
    en: 'Remove the OpenRouter key?',
    it: 'Togliere la chiave OpenRouter?',
    de: 'OpenRouter-Schlüssel entfernen?'
  },
  removeKeyText: {
    en: 'The Segretario turns off: to turn it back on, the guided setup will ask you for a key. What it has learned and the work done stay.',
    it: 'Il Segretario si spegne: per riaccenderlo, la procedura guidata ti chiederà una chiave. Ciò che ha imparato e il lavoro fatto restano.',
    de: 'Der Segretario wird ausgeschaltet: Um ihn wieder einzuschalten, fragt die Einrichtung Sie nach einem Schlüssel. Was er gelernt hat und die erledigte Arbeit bleiben.'
  },
  removeKey: { en: 'Remove the key', it: 'Togli la chiave', de: 'Schlüssel entfernen' },
  cancel: { en: 'Cancel', it: 'Annulla', de: 'Abbrechen' },
  keyNotRemoved: { en: 'Key not removed', it: 'Chiave non tolta', de: 'Schlüssel nicht entfernt' },
  forgetTitle: {
    en: 'Make the Segretario forget everything?',
    it: 'Far dimenticare tutto al Segretario?',
    de: 'Den Segretario alles vergessen lassen?'
  },
  forgetConfirmText: {
    en: 'The memory, notes, open items, projects, ready replies, activity, spending and the key are erased, and the AI features turn off: as if they had never been on. The mail, calendars and files stay as they are.',
    it: 'Si cancellano la memoria, le note, le cose aperte, i progetti, le risposte pronte, il diario, le spese e la chiave, e le funzioni AI si spengono: come se non fossero mai state accese. La posta, i calendari e i file restano come sono.',
    de: 'Gedächtnis, Notizen, offene Punkte, Projekte, fertige Antworten, Verlauf, Ausgaben und der Schlüssel werden gelöscht, und die KI-Funktionen werden ausgeschaltet: als wären sie nie eingeschaltet gewesen. E-Mails, Kalender und Dateien bleiben, wie sie sind.'
  },
  forgotten: {
    en: 'The Segretario has forgotten everything.',
    it: 'Il Segretario ha dimenticato tutto.',
    de: 'Der Segretario hat alles vergessen.'
  },
  failed: { en: 'It didn’t work', it: 'Non è andata', de: 'Das hat nicht geklappt' },
  loading: {
    en: 'Loading the settings…',
    it: 'Caricamento delle impostazioni…',
    de: 'Einstellungen werden geladen…'
  },
  on: {
    en: 'The Segretario works for you',
    it: 'Il Segretario lavora per te',
    de: 'Der Segretario arbeitet für Sie'
  },
  off: {
    en: 'The Segretario is off',
    it: 'Il Segretario è spento',
    de: 'Der Segretario ist ausgeschaltet'
  },
  onText: {
    en: 'It follows the mail and calendars as they change, keeps track of what is asked of you, what you promised and what you’re waiting for, and prepares replies and meetings.',
    it: 'Segue la posta e i calendari mentre cambiano, tiene il conto di ciò che ti chiedono, che hai promesso e che aspetti, e prepara risposte e incontri.',
    de: 'Er verfolgt E-Mails und Kalender, während sie sich ändern, behält im Blick, was an Sie gerichtet ist, was Sie zugesagt haben und worauf Sie warten, und bereitet Antworten und Besprechungen vor.'
  },
  offText: {
    en: 'SIEVER Mail is a set of apps, without intelligence. Turn it on: a guided setup connects it and lets it get to know your work.',
    it: 'SIEVER Mail è un insieme di app, senza intelligenza. Accendilo: una procedura guidata lo collega e gli fa conoscere il tuo lavoro.',
    de: 'SIEVER Mail ist eine Sammlung von Apps, ohne Intelligenz. Schalten Sie ihn ein: Eine Einrichtung verbindet ihn und lässt ihn Ihre Arbeit kennenlernen.'
  },
  switchLabel: { en: 'Segretario on', it: 'Segretario acceso', de: 'Segretario eingeschaltet' },
  key: { en: 'OpenRouter key', it: 'Chiave OpenRouter', de: 'OpenRouter-Schlüssel' },
  keyText: {
    en: 'The Segretario works with a model you use from your own OpenRouter account: you pay only for what it does, with no subscription. The key stays on this computer, encrypted.',
    it: 'Il Segretario lavora con un modello che usi dal tuo account OpenRouter: paghi solo quello che fa, senza abbonamenti. La chiave resta su questo computer, cifrata.',
    de: 'Der Segretario arbeitet mit einem Modell, das Sie über Ihr eigenes OpenRouter-Konto nutzen: Sie zahlen nur für das, was er tut, ohne Abonnement. Der Schlüssel bleibt verschlüsselt auf diesem Computer.'
  },
  credit: { en: 'Available credit:', it: 'Credito disponibile:', de: 'Verfügbares Guthaben:' },
  keyLimit: {
    en: (amount: string) => `key limit ${amount}`,
    it: (amount: string) => `limite della chiave ${amount}`,
    de: (amount: string) => `Schlüssellimit ${amount}`
  },
  model: {
    en: (name: string) => `Model: ${name} — SIEVER Mail moves to the newest version by itself.`,
    it: (name: string) => `Modello: ${name} — SIEVER Mail passa da solo alla versione più recente.`,
    de: (name: string) => `Modell: ${name} – SIEVER Mail wechselt von selbst zur neuesten Version.`
  },
  checkedAt: {
    en: (when: string) => `Checked ${when}`,
    it: (when: string) => `Verificata ${when}`,
    de: (when: string) => `Geprüft ${when}`
  },
  connect: { en: 'Connect', it: 'Collega', de: 'Verbinden' },
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
  checkAgain: { en: 'Check again', it: 'Verifica di nuovo', de: 'Erneut prüfen' },
  replace: { en: 'Replace', it: 'Sostituisci', de: 'Ersetzen' },
  topUp: { en: 'Top up credit', it: 'Ricarica il credito', de: 'Guthaben aufladen' },
  remove: { en: 'Remove', it: 'Togli', de: 'Entfernen' },
  spending: { en: 'Spending', it: 'Spesa', de: 'Ausgaben' },
  today: { en: 'Today', it: 'Oggi', de: 'Heute' },
  thisMonth: { en: 'This month', it: 'Questo mese', de: 'Diesen Monat' },
  spendingText: {
    en: 'What OpenRouter has charged for the Segretario’s work on this computer; by function, over the last thirty days.',
    it: 'Quello che OpenRouter ha addebitato per il lavoro del Segretario su questo computer; per funzione, negli ultimi trenta giorni.',
    de: 'Was OpenRouter für die Arbeit des Segretario auf diesem Computer berechnet hat; nach Funktion, in den letzten dreißig Tagen.'
  },
  privacy: { en: 'Privacy', it: 'Riservatezza', de: 'Datenschutz' },
  privacyText: {
    en: 'The Segretario sends the model only what it needs for the work it’s doing, and only to providers that don’t keep the data or use it to train models (Zero Data Retention). The mail, the files and what it learns about you stay on this computer. It reads your files without ever changing them, and no message goes out without your confirmation.',
    it: 'Il Segretario manda al modello solo quello che gli serve per il lavoro che sta facendo, e solo a fornitori che non conservano i dati e non li usano per addestrare i modelli (Zero Data Retention). La posta, i file e quello che impara di te restano su questo computer. Legge i tuoi file senza mai modificarli, e nessun messaggio parte senza la tua conferma.',
    de: 'Der Segretario sendet dem Modell nur, was er für die aktuelle Arbeit braucht, und nur an Anbieter, die die Daten weder speichern noch zum Trainieren von Modellen verwenden (Zero Data Retention). E-Mails, Dateien und was er über Sie lernt, bleiben auf diesem Computer. Er liest Ihre Dateien, ohne sie je zu verändern, und keine Nachricht wird ohne Ihre Bestätigung gesendet.'
  },
  forgetText: {
    en: 'As if the Segretario had never been on: what it knows and what it has done — memory, notes, open items, projects, ready replies, activity and spending — and the key are erased. Turned back on, it starts again from the guided setup. The mail, calendars and files stay as they are.',
    it: 'Come se il Segretario non fosse mai stato acceso: si cancellano ciò che sa e ciò che ha fatto — memoria, note, cose aperte, progetti, risposte pronte, diario e spese — e la chiave. Riacceso, riparte dalla procedura guidata. La posta, i calendari e i file restano come sono.',
    de: 'Als wäre der Segretario nie eingeschaltet gewesen: Was er weiß und was er getan hat – Gedächtnis, Notizen, offene Punkte, Projekte, fertige Antworten, Verlauf und Ausgaben – sowie der Schlüssel werden gelöscht. Wieder eingeschaltet, beginnt er erneut mit der Einrichtung. E-Mails, Kalender und Dateien bleiben, wie sie sind.'
  }
})

/** How often a key's spending limit starts again, after the amount. */
export const LIMIT_RESET = defineMessages({
  daily: { en: 'a day', it: 'al giorno', de: 'pro Tag' },
  weekly: { en: 'a week', it: 'alla settimana', de: 'pro Woche' },
  monthly: { en: 'a month', it: 'al mese', de: 'pro Monat' }
})

/** Where the key stands, in a word. */
export const KEY_STATE = defineMessages({
  missing: { en: 'No key', it: 'Nessuna chiave', de: 'Kein Schlüssel' },
  ready: { en: 'Connected', it: 'Collegata', de: 'Verbunden' },
  invalid: { en: 'Not valid', it: 'Non valida', de: 'Ungültig' },
  exhausted: { en: 'Credit used up', it: 'Credito esaurito', de: 'Guthaben aufgebraucht' },
  unchecked: { en: 'Not checked', it: 'Non verificata', de: 'Nicht geprüft' }
}) satisfies Record<SegretarioKeyState, unknown>
