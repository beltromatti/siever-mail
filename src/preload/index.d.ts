import type { CalendarApi } from '@shared/calendar'
import type { DesktopMailApi } from '@shared/ipc'
import type { SegretarioApi } from '@shared/segretario'

declare global {
  interface Window {
    mailApi: DesktopMailApi
    segretarioApi: SegretarioApi
    calendarApi: CalendarApi
  }
}
