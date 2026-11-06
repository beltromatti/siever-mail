/**
 * The shape of the workspace, declared once. SIEVER Mail is a personal
 * operating system: its sources — Posta, Calendario, File, and those to
 * come — are peers, each with its family of connections, its objects and its
 * app; the derived apps — Contatti, Progetti — gather what the sources hold,
 * owning nothing; Oggi is the Segretario's desk, over all of them. The rail,
 * the settings and the Segretario read the families and the apps from here.
 */

/** A family of connections: one per source, each a peer of the others. */
export type ConnectionFamily = 'mail' | 'calendar' | 'files'

export interface ConnectionFamilyInfo {
  id: ConnectionFamily
  label: string
  /** What connects to it, in the user's words. */
  providers: ReadonlyArray<string>
  /** False while the family is announced and not here yet. */
  available: boolean
}

export const CONNECTION_FAMILIES: ReadonlyArray<ConnectionFamilyInfo> = [
  {
    id: 'mail',
    label: 'Posta',
    providers: ['Gmail', 'Microsoft 365 e Outlook.com', 'iCloud', 'IMAP', 'PEC'],
    available: true
  },
  {
    id: 'calendar',
    label: 'Calendario',
    providers: ['Google Calendar', 'Microsoft 365', 'iCloud e CalDAV', 'Calendari da link (ICS)'],
    available: true
  },
  {
    // A whole volume or a whole drive, never a folder picked inside it.
    id: 'files',
    label: 'File',
    providers: [
      'I volumi del computer',
      'I volumi di rete',
      'Google Drive',
      'OneDrive e SharePoint',
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
  label: string
  group: AppGroup
  /** A source's family of connections. */
  family?: ConnectionFamily
  /** False while the app is announced and not here yet. */
  available: boolean
}

/** The apps in the rail's order, grouped: Oggi | Posta, Calendario, File | Contatti, Progetti. */
export const WORKSPACE_APPS: ReadonlyArray<WorkspaceApp> = [
  { id: 'oggi', label: 'Oggi', group: 'desk', available: true },
  { id: 'mail', label: 'Posta', group: 'source', family: 'mail', available: true },
  { id: 'calendar', label: 'Calendario', group: 'source', family: 'calendar', available: true },
  { id: 'files', label: 'File', group: 'source', family: 'files', available: false },
  { id: 'contacts', label: 'Contatti', group: 'derived', available: false },
  { id: 'projects', label: 'Progetti', group: 'derived', available: false }
]
