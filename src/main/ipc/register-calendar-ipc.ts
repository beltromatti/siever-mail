import { ipcMain } from 'electron'
import { z } from 'zod'

import type { CalendarService } from '@main/calendar/calendar-service'
import { logMainError } from '@main/utils/error-utils'
import { CALENDAR_IPC, type MessageInvitation } from '@shared/calendar'
import type { MessageRef } from '@shared/models'

const idSchema = z.string().min(1).max(200)
const messageRefSchema = z.object({
  accountId: idSchema,
  folderPath: z.string().min(1),
  uid: z.number().int().nonnegative()
})
const isoSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Data non valida.')
const responseSchema = z.enum(['accepted', 'tentative', 'declined'])

/** The calendars' channels; each waits for them to be open and checks what the page sends. */
export function registerCalendarIpc(
  calendar: CalendarService,
  invitationOf: (ref: MessageRef) => Promise<MessageInvitation | null>,
  whenReady: () => Promise<void>
): void {
  const handle = <Args extends unknown[], Result>(
    channel: string,
    handler: (...args: Args) => Promise<Result> | Result
  ): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, ...args: Args) => {
      try {
        await whenReady()
        return await handler(...args)
      } catch (error) {
        logMainError(`IPC handler failed: ${channel}`, error, { channel })
        throw error instanceof z.ZodError
          ? new Error([...new Set(error.issues.map((issue) => issue.message))].join(' '))
          : error
      }
    })
  }

  handle(CALENDAR_IPC.listConnections, () => calendar.listConnections())
  handle(CALENDAR_IPC.connect, (accountId: unknown) => calendar.connect(idSchema.parse(accountId)))
  handle(CALENDAR_IPC.disconnect, (accountId: unknown) =>
    calendar.disconnect(idSchema.parse(accountId))
  )
  handle(CALENDAR_IPC.events, (fromIso: unknown, toIso: unknown) =>
    calendar.events(isoSchema.parse(fromIso), isoSchema.parse(toIso))
  )
  handle(CALENDAR_IPC.eventByUid, (accountId: unknown, iCalUid: unknown) =>
    calendar.eventByUid(idSchema.parse(accountId), z.string().min(1).max(1000).parse(iCalUid))
  )
  handle(CALENDAR_IPC.invitation, (ref: unknown) => invitationOf(messageRefSchema.parse(ref)))
  handle(CALENDAR_IPC.respond, (key: unknown, response: unknown) =>
    calendar.respond(z.string().min(1).max(2000).parse(key), responseSchema.parse(response))
  )
  handle(CALENDAR_IPC.syncNow, () => calendar.syncAll())
}
