import type { CalendarRole } from '@shared/calendar'

import type { Sql } from '../sql'

/** A calendar's role as the Segretario decided it (§7.4). */
export interface DecidedRole {
  role: CalendarRole
  reason: string | null
  runId: string | null
  setAt: number
}

/** Whether an event is the user's, as the Segretario found it — or the user said, against it. */
export interface EventMark {
  eventKey: string
  /** Its series, by `seriesKey`: the mark is every instance's. */
  seriesKey: string | null
  yours: boolean
  setBy: 'segretario' | 'utente'
  reason: string | null
  setAt: number
}

/**
 * Whose things are, as the Segretario found them (vision §7.4): the
 * calendars whose role it decided — Conoscimi, or the look at a calendar
 * that came after —, and the events it found the user's in a calendar
 * shared that does not say so. The user's own word on an event is kept here
 * too, so that a run in the background does not overturn it; theirs on a
 * calendar is the calendar's (`CalendarService.setCalendarRole`).
 */
export class OwnershipStore {
  constructor(private readonly sql: Sql) {}

  async roles(): Promise<Map<string, DecidedRole>> {
    const rows = await this.sql.all<{
      calendar_key: string
      role: CalendarRole
      reason: string | null
      run_id: string | null
      set_at: number
    }>('SELECT calendar_key, role, reason, run_id, set_at FROM ai_calendar_roles')

    return new Map(
      rows.map((row) => [
        row.calendar_key,
        { role: row.role, reason: row.reason, runId: row.run_id, setAt: Number(row.set_at) }
      ])
    )
  }

  async role(calendarKey: string): Promise<DecidedRole | null> {
    return (await this.roles()).get(calendarKey) ?? null
  }

  async setRole(
    calendarKey: string,
    role: CalendarRole | null,
    reason: string | null,
    runId: string | null
  ): Promise<void> {
    if (role === null) {
      await this.sql.run('DELETE FROM ai_calendar_roles WHERE calendar_key = ?', calendarKey)
      return
    }

    await this.sql.run(
      `INSERT INTO ai_calendar_roles (calendar_key, role, reason, run_id, set_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(calendar_key) DO UPDATE SET role = excluded.role, reason = excluded.reason,
         run_id = excluded.run_id, set_at = excluded.set_at`,
      calendarKey,
      role,
      reason,
      runId,
      Date.now()
    )
  }

  async marks(): Promise<EventMark[]> {
    const rows = await this.sql.all<{
      event_key: string
      series_key: string | null
      yours: number
      set_by: 'segretario' | 'utente'
      reason: string | null
      set_at: number
    }>('SELECT event_key, series_key, yours, set_by, reason, set_at FROM ai_own_events')

    return rows.map((row) => ({
      eventKey: row.event_key,
      seriesKey: row.series_key,
      yours: Number(row.yours) === 1,
      setBy: row.set_by,
      reason: row.reason,
      setAt: Number(row.set_at)
    }))
  }

  /** The mark an event has — its own, or its series'. */
  async markOf(eventKey: string, seriesKey: string | null): Promise<EventMark | null> {
    const marks = await this.marks()
    return (
      marks.find((mark) => mark.eventKey === eventKey) ??
      (seriesKey ? marks.find((mark) => mark.seriesKey === seriesKey) : undefined) ??
      null
    )
  }

  /** Marks an event — and its series — the user's or not; a mark of the Segretario's taken back goes. */
  async mark(
    mark: Omit<EventMark, 'setAt'> & { runId: string | null },
    previous: EventMark | null
  ): Promise<void> {
    if (previous && previous.eventKey !== mark.eventKey) {
      await this.sql.run('DELETE FROM ai_own_events WHERE event_key = ?', previous.eventKey)
    }

    if (!mark.yours && mark.setBy === 'segretario') {
      await this.sql.run('DELETE FROM ai_own_events WHERE event_key = ?', mark.eventKey)
      return
    }

    await this.sql.run(
      `INSERT INTO ai_own_events (event_key, series_key, yours, set_by, reason, run_id, set_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_key) DO UPDATE SET series_key = excluded.series_key, yours = excluded.yours,
         set_by = excluded.set_by, reason = excluded.reason, run_id = excluded.run_id,
         set_at = excluded.set_at`,
      mark.eventKey,
      mark.seriesKey,
      mark.yours ? 1 : 0,
      mark.setBy,
      mark.reason,
      mark.runId,
      Date.now()
    )
  }
}
