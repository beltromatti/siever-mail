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
const keySchema = z.string().min(1).max(2000)
/** An instant with its time, or — all day — a day, AAAA-MM-GG. */
const whenSchema = z
  .string()
  .max(40)
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isNaN(Date.parse(value)),
    'Data non valida.'
  )
const titleSchema = z.string().trim().min(1, 'Dai un titolo all’evento.').max(500)
const attendeesSchema = z
  .array(z.string().trim().email('Un invitato non ha un indirizzo valido.'))
  .max(200)
const newEventSchema = z
  .object({
    calendarKey: keySchema,
    title: titleSchema,
    start: whenSchema,
    end: whenSchema,
    allDay: z.boolean(),
    location: z.string().max(1000).nullable(),
    description: z.string().max(20_000).nullable(),
    attendees: attendeesSchema
  })
  .strict()
const eventChangeSchema = z
  .object({
    title: titleSchema.optional(),
    start: whenSchema.optional(),
    end: whenSchema.optional(),
    allDay: z.boolean().optional(),
    location: z.string().max(1000).nullable().optional(),
    description: z.string().max(20_000).nullable().optional(),
    attendees: attendeesSchema.optional()
  })
  .strict()

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
  handle(CALENDAR_IPC.event, (key: unknown) => calendar.event(keySchema.parse(key)))
  handle(CALENDAR_IPC.eventByUid, (accountId: unknown, iCalUid: unknown) =>
    calendar.eventByUid(idSchema.parse(accountId), z.string().min(1).max(1000).parse(iCalUid))
  )
  handle(CALENDAR_IPC.invitation, (ref: unknown) => invitationOf(messageRefSchema.parse(ref)))
  handle(CALENDAR_IPC.respond, (key: unknown, response: unknown) =>
    calendar.respond(z.string().min(1).max(2000).parse(key), responseSchema.parse(response))
  )
  handle(CALENDAR_IPC.calendars, () => calendar.calendars())
  handle(CALENDAR_IPC.setCalendarHidden, (key: unknown, hidden: unknown) =>
    calendar.setCalendarHidden(keySchema.parse(key), z.boolean().parse(hidden))
  )
  handle(CALENDAR_IPC.create, (event: unknown) => calendar.create(newEventSchema.parse(event)))
  handle(CALENDAR_IPC.update, (key: unknown, change: unknown) =>
    calendar.update(keySchema.parse(key), eventChangeSchema.parse(change))
  )
  handle(CALENDAR_IPC.remove, (key: unknown) => calendar.remove(keySchema.parse(key)))
  handle(CALENDAR_IPC.syncNow, () => calendar.syncAll())
}
