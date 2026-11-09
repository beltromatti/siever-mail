import type { CalendarApi } from '@shared/calendar'
import type { DiagnosticsApi } from '@shared/diagnostics'
import type { FilesApi } from '@shared/files'
import type { NotificationsApi } from '@shared/notifications'
import type { DesktopMailApi } from '@shared/ipc'
import type { SegretarioApi } from '@shared/segretario'

declare global {
  interface Window {
    mailApi: DesktopMailApi
    segretarioApi: SegretarioApi
    calendarApi: CalendarApi
    filesApi: FilesApi
    diagnosticsApi: DiagnosticsApi
    notificationsApi: NotificationsApi
    /** The bridge of the extension built in, its own to type (`ExtensionPreloadInstaller`); absent in the public build. */
    extensionApi?: unknown
  }
}
