import { defineMessages } from './i18n'

/**
 * The names of SIEVER Mail's places — its apps, its views, the pages of
 * its Settings, the things the Segretario keeps — in every language
 * (vision §13.5). One list for the interface, which shows them, and for the
 * Segretario, which is told how the user sees them when it names one: the
 * two never call the same place by two names.
 */
export const PLACES = defineMessages({
  today: { en: 'Today', it: 'Oggi', de: 'Heute' },
  mail: { en: 'Mail', it: 'Posta', de: 'E-Mail' },
  calendar: { en: 'Calendar', it: 'Calendario', de: 'Kalender' },
  files: { en: 'Files', it: 'File', de: 'Dateien' },
  contacts: { en: 'Contacts', it: 'Contatti', de: 'Kontakte' },
  projects: { en: 'Projects', it: 'Progetti', de: 'Projekte' },
  settings: { en: 'Settings', it: 'Impostazioni', de: 'Einstellungen' },
  inbox: { en: 'Inbox', it: 'Posta in arrivo', de: 'Posteingang' },
  toHandle: { en: 'To handle', it: 'Da gestire', de: 'Zu erledigen' },
  waiting: { en: 'Waiting', it: 'In attesa', de: 'Ausstehend' },
  readyReplies: { en: 'Ready replies', it: 'Risposte pronte', de: 'Fertige Antworten' },
  openItems: { en: 'Open items', it: 'Cose aperte', de: 'Offene Punkte' },
  whereItStands: { en: 'Where it stands', it: 'Il punto', de: 'Stand der Dinge' },
  letter: { en: 'the letter', it: 'la lettera', de: 'der Brief' },
  connections: { en: 'Connections', it: 'Connessioni', de: 'Verbindungen' },
  segretario: { en: 'Segretario', it: 'Segretario', de: 'Segretario' },
  aboutYou: { en: 'What I know about you', it: 'Cosa so di te', de: 'Was ich über Sie weiß' },
  preferences: { en: 'Preferences', it: 'Preferenze', de: 'Allgemein' },
  notifications: { en: 'Notifications', it: 'Notifiche', de: 'Benachrichtigungen' },
  shortcuts: { en: 'Shortcuts', it: 'Scorciatoie', de: 'Tastenkürzel' },
  letterhead: {
    en: 'Letterhead & signature',
    it: 'Intestazione e firma',
    de: 'Briefkopf und Signatur'
  },
  data: { en: 'Data', it: 'Dati', de: 'Daten' },
  extension: { en: 'Extension', it: 'Estensione', de: 'Erweiterung' },
  conoscimi: { en: 'Get to know me', it: 'Conoscimi', de: 'Lerne mich kennen' },
  alPasso: { en: 'Catch up', it: 'Al passo', de: 'Aufholen' },
  guidedSetup: { en: 'guided setup', it: 'procedura guidata', de: 'Einrichtung' },
  forgetEverything: { en: 'Forget everything', it: 'Dimentica tutto', de: 'Alles vergessen' },
  deleteAllData: { en: 'Delete all data', it: 'Elimina tutti i dati', de: 'Alle Daten löschen' }
})
