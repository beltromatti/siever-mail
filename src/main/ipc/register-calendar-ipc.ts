import { ipcMain } from 'electron'
import { z } from 'zod'

import type { CalendarService } from '@main/calendar/calendar-service'
import { logMainError } from '@main/utils/error-utils'
import { CALENDAR_IPC, type CalendarResponse, type MessageInvitation } from '@shared/calendar'
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
const searchSchema = z
  .object({
    text: z.string().max(500),
    fromIso: isoSchema.optional(),
    toIso: isoSchema.optional(),
    calendarKeys: z.array(keySchema).max(1000).optional(),
    limit: z.number().int().min(1).max(200).optional()
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
  invitations: {
    of: (ref: MessageRef) => Promise<MessageInvitation | null>
    respondByMail: (
      ref: MessageRef,
      response: Exclude<CalendarResponse, 'needsAction'>
    ) => Promise<void>
  },
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
  handle(CALENDAR_IPC.connectGoogle, (mailAccountId: unknown) =>
    calendar.connectGoogle(idSchema.nullable().parse(mailAccountId))
  )
  handle(CALENDAR_IPC.connectMicrosoft, (mailAccountId: unknown) =>
    calendar.connectMicrosoft(idSchema.nullable().parse(mailAccountId))
  )
  handle(CALENDAR_IPC.addIcs, (link: unknown, name: unknown) =>
    calendar.addIcs(
      z.string().trim().min(1).max(4000).parse(link),
      z.string().trim().max(200).nullable().parse(name)
    )
  )
  handle(CALENDAR_IPC.addCalDav, (input: unknown) =>
    calendar.addCalDav(
      z
        .object({
          serverUrl: z.string().trim().url().max(2000),
          username: z.string().trim().min(1).max(320),
          password: z.string().min(1).max(1000),
          label: z.string().trim().max(320)
        })
        .strict()
        .parse(input)
    )
  )
  handle(CALENDAR_IPC.disconnect, (connectionId: unknown) =>
    calendar.disconnect(idSchema.parse(connectionId))
  )
  handle(CALENDAR_IPC.events, (fromIso: unknown, toIso: unknown) =>
    calendar.events(isoSchema.parse(fromIso), isoSchema.parse(toIso))
  )
  handle(CALENDAR_IPC.search, (query: unknown) => calendar.search(searchSchema.parse(query)))
  handle(CALENDAR_IPC.event, (key: unknown) => calendar.event(keySchema.parse(key)))
  handle(CALENDAR_IPC.eventByUid, (iCalUid: unknown, mailAccountId: unknown) =>
    calendar.eventByUid(
      z.string().min(1).max(1000).parse(iCalUid),
      idSchema.nullable().parse(mailAccountId)
    )
  )
  handle(CALENDAR_IPC.invitation, (ref: unknown) => invitations.of(messageRefSchema.parse(ref)))
  handle(CALENDAR_IPC.respondByMail, (ref: unknown, response: unknown) =>
    invitations.respondByMail(messageRefSchema.parse(ref), responseSchema.parse(response))
  )
  // What the user does here is theirs: noted for the Segretario, as a change made elsewhere is.
  handle(CALENDAR_IPC.respond, (key: unknown, response: unknown, options: unknown) =>
    calendar.respond(z.string().min(1).max(2000).parse(key), responseSchema.parse(response), {
      ...z.object({ series: z.boolean().optional() }).strict().optional().parse(options),
      byUser: true
    })
  )
  handle(CALENDAR_IPC.calendars, () => calendar.calendars())
  handle(CALENDAR_IPC.setCalendarHidden, (key: unknown, hidden: unknown) =>
    calendar.setCalendarHidden(keySchema.parse(key), z.boolean().parse(hidden))
  )
  handle(CALENDAR_IPC.create, (event: unknown) =>
    calendar.create(newEventSchema.parse(event), { byUser: true })
  )
  handle(CALENDAR_IPC.update, (key: unknown, change: unknown) =>
    calendar.update(keySchema.parse(key), eventChangeSchema.parse(change), { byUser: true })
  )
  handle(CALENDAR_IPC.remove, (key: unknown) =>
    calendar.remove(keySchema.parse(key), { byUser: true })
  )
  handle(CALENDAR_IPC.syncNow, () => calendar.syncAll())
}
