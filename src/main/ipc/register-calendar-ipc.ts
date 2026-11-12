import { z } from 'zod'

import type { CalendarService } from '@main/calendar/calendar-service'
import { messages } from '@main/i18n'
import { handleIpc, type HandleOptions } from '@main/ipc/handle'
import {
  CALENDAR_IPC,
  CALENDAR_ROLES,
  type CalendarResponse,
  type MessageInvitation
} from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import type { MessageRef } from '@shared/models'

const MESSAGES = defineMessages({
  invalidDate: { en: 'Not a valid date.', it: 'Data non valida.', de: 'Kein gültiges Datum.' },
  giveTitle: {
    en: 'Give the event a title.',
    it: 'Dai un titolo all’evento.',
    de: 'Geben Sie dem Termin einen Titel.'
  },
  invalidAttendee: {
    en: 'An invitee doesn’t have a valid address.',
    it: 'Un invitato non ha un indirizzo valido.',
    de: 'Eine eingeladene Person hat keine gültige Adresse.'
  },
  enterPassword: {
    en: 'Enter the password.',
    it: 'Scrivi la password.',
    de: 'Geben Sie das Passwort ein.'
  }
})

/** Said when the input is checked, in the interface's language then. */
const invalidDate = { error: () => messages(MESSAGES).invalidDate }

const idSchema = z.string().min(1).max(200)
const messageRefSchema = z.object({
  accountId: idSchema,
  folderPath: z.string().min(1),
  uid: z.number().int().nonnegative()
})
const isoSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), invalidDate)
const responseSchema = z.enum(['accepted', 'tentative', 'declined'])
const keySchema = z.string().min(1).max(2000)
/** An instant with its time, or — all day — a day, AAAA-MM-GG. */
const whenSchema = z
  .string()
  .max(40)
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isNaN(Date.parse(value)),
    invalidDate
  )
const titleSchema = z
  .string()
  .trim()
  .min(1, { error: () => messages(MESSAGES).giveTitle })
  .max(500)
const attendeesSchema = z
  .array(
    z
      .string()
      .trim()
      .email({ error: () => messages(MESSAGES).invalidAttendee })
  )
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
    handler: (...args: Args) => Promise<Result> | Result,
    options?: Pick<HandleOptions, 'untimed'>
  ): void => handleIpc('calendar', channel, handler, { ...options, before: whenReady })

  // A sign-in waits for the user: never written down as slow.
  const forUser = { untimed: true }

  handle(CALENDAR_IPC.listConnections, () => calendar.listConnections())
  handle(
    CALENDAR_IPC.connectGoogle,
    (mailAccountId: unknown) => calendar.connectGoogle(idSchema.nullable().parse(mailAccountId)),
    forUser
  )
  handle(
    CALENDAR_IPC.connectMicrosoft,
    (mailAccountId: unknown) => calendar.connectMicrosoft(idSchema.nullable().parse(mailAccountId)),
    forUser
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
  handle(
    CALENDAR_IPC.reconnect,
    (connectionId: unknown, password: unknown) =>
      calendar.reconnect(
        idSchema.parse(connectionId),
        z
          .string()
          .min(1, { error: () => messages(MESSAGES).enterPassword })
          .max(1000)
          .optional()
          .parse(password)
      ),
    forUser
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
  handle(CALENDAR_IPC.setCalendarRole, (key: unknown, role: unknown) =>
    calendar.setCalendarRole(keySchema.parse(key), z.enum(CALENDAR_ROLES).nullable().parse(role))
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
