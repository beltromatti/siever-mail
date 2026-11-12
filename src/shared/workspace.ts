/**
 * The shape of the workspace, declared once. SIEVER Mail is a personal
 * operating system: its sources — Posta, Calendario, File, and those to
 * come — are peers, each with its family of connections, its objects and its
 * app; the derived apps — Contatti, Progetti — gather what the sources hold,
 * owning nothing; Oggi is the Segretario's desk, over all of them. The rail,
 * the settings and the Segretario read the families and the apps from here.
 */

import type { Localized, Message } from './i18n'
import { PLACES } from './places'

/** A family of connections: one per source, each a peer of the others. */
export type ConnectionFamily = 'mail' | 'calendar' | 'files'

export interface ConnectionFamilyInfo {
  id: ConnectionFamily
  /** Its name in every language: the app's (`PLACES`). */
  label: Message<string>
  /** What connects to it, in the user's words: a brand as it is, the rest in every language. */
  providers: ReadonlyArray<Localized>
  /** False while the family is announced and not here yet. */
  available: boolean
}

export const CONNECTION_FAMILIES: ReadonlyArray<ConnectionFamilyInfo> = [
  {
    id: 'mail',
    label: PLACES.mail,
    providers: [
      'Gmail',
      {
        en: 'Microsoft 365 and Outlook.com',
        it: 'Microsoft 365 e Outlook.com',
        de: 'Microsoft 365 und Outlook.com'
      },
      'iCloud',
      'IMAP',
      'PEC'
    ],
    available: true
  },
  {
    id: 'calendar',
    label: PLACES.calendar,
    providers: [
      'Google Calendar',
      'Microsoft 365',
      { en: 'iCloud and CalDAV', it: 'iCloud e CalDAV', de: 'iCloud und CalDAV' },
      {
        en: 'Calendars from a link (ICS)',
        it: 'Calendari da link (ICS)',
        de: 'Kalender über einen Link (ICS)'
      }
    ],
    available: true
  },
  {
    // A whole volume or a whole drive, never a folder picked inside it.
    id: 'files',
    label: PLACES.files,
    providers: [
      {
        en: 'The computer’s volumes',
        it: 'I volumi del computer',
        de: 'Die Laufwerke des Computers'
      },
      { en: 'Network volumes', it: 'I volumi di rete', de: 'Netzlaufwerke' },
      'Google Drive',
      { en: 'OneDrive and SharePoint', it: 'OneDrive e SharePoint', de: 'OneDrive und SharePoint' },
      'Dropbox',
      'iCloud Drive'
    ],
    available: false
  }
]

export type AppId = 'oggi' | 'mail' | 'calendar' | 'files' | 'contacts' | 'projects'

/**
 * Where an app stands among the others: the Segretario's desk, a source
 * with connections of its own, or a view derived from the sources.
 */
export type AppGroup = 'desk' | 'source' | 'derived'

export interface WorkspaceApp {
  id: AppId
  /** Its name in every language: the app's (`PLACES`). */
  label: Message<string>
  group: AppGroup
  /** A source's family of connections. */
  family?: ConnectionFamily
  /** False while the app is announced and not here yet. */
  available: boolean
}

/** The apps in the rail's order, grouped: Oggi | Posta, Calendario, File | Contatti, Progetti. */
export const WORKSPACE_APPS: ReadonlyArray<WorkspaceApp> = [
  { id: 'oggi', label: PLACES.today, group: 'desk', available: true },
  { id: 'mail', label: PLACES.mail, group: 'source', family: 'mail', available: true },
  { id: 'calendar', label: PLACES.calendar, group: 'source', family: 'calendar', available: true },
  { id: 'files', label: PLACES.files, group: 'source', family: 'files', available: false },
  { id: 'contacts', label: PLACES.contacts, group: 'derived', available: false },
  { id: 'projects', label: PLACES.projects, group: 'derived', available: false }
]
