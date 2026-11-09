import { localDay } from './log'

/**
 * The summary at the top of an export (vision §14.4): what the log says at
 * a glance, before reading it line by line — the launches, how long the
 * window was in front each day, how often each thing happened, the errors
 * grouped by kind, the Segretario's runs by task with how they ended, what
 * took long. Counted from the log itself, so it never says more than the
 * log does.
 */

interface LogLine {
  t?: string
  s?: string
  lvl?: string
  area?: string
  ev?: string
  ms?: number
  err?: { message?: string; name?: string }
  /** A line of a count: how many more times its event came, in its minute. */
  repeated?: number
  /** What a line of a count was about. */
  said?: string
  [key: string]: unknown
}

interface Grouped {
  area: string
  ev: string
  /** The page's channel, when it is one of its calls that failed. */
  channel?: string
  message: string
  count: number
  first: string
  last: string
}

interface RunStats {
  count: number
  ended: Record<string, number>
  ms: number[]
  cost: number
  tools: number
  toolErrors: number
  argsInvalid: number
}

export interface DiagnosticSummary {
  period: { from: string | null; to: string | null }
  lines: number
  unreadable: number
  launches: Array<Record<string, unknown>>
  /**
   * How long the window was in front, each day (from its focus to its blur,
   * its hiding, the screen locked, the computer's sleep or the app's
   * quitting; a span past midnight counts on each of its days): the time
   * spent before the app, which it exists to cut (§0).
   */
  inFront: Array<{ day: string; minutes: number; times: number }>
  byLevel: Record<string, number>
  /** How many times each thing happened, area · event, the most frequent first. */
  events: Array<{ event: string; count: number }>
  errors: Grouped[]
  warnings: Grouped[]
  segretario: Record<
    string,
    {
      runs: number
      ended: Record<string, number>
      msMedian: number | null
      msP95: number | null
      cost: number
      toolCalls: number
      toolErrors: number
      argsInvalid: number
    }
  >
  /**
   * How the user answered the Segretario's work: the proposals accepted or
   * declined, the ready replies taken or discarded, the open things by how
   * they were closed, the changes undone, the memory corrected — whether it
   * helps, in numbers.
   */
  answers: {
    proposals: { accepted: number; declined: number }
    replies: { taken: number; discarded: number }
    commitments: Record<string, number>
    changesUndone: number
    memoryCorrected: number
  }
  slow: Array<{ channel: string; count: number; msMedian: number; msMax: number }>
}

const KEPT_EVENTS = 150
const KEPT_GROUPS = 60

/** What ends the window's time in front: it lost the focus, or nobody can be at it. */
const LEAVES_FRONT = new Set([
  'ui · window.blur',
  'ui · window.hide',
  'app · system.sleep',
  'app · system.lock',
  'app · app.quit'
])

/**
 * Counts the log a line at a time — an export reads it as a stream, never
 * whole — and gives the summary at the end.
 */
export class SummaryCounter {
  // The first and last moment of the lines: empty until a line has one.
  private from = ''
  private to = ''
  private count = 0
  private unreadable = 0
  private readonly launches: Array<Record<string, unknown>> = []
  private readonly byLevel: Record<string, number> = {}
  private readonly events = new Map<string, number>()
  private readonly errors = new Map<string, Grouped>()
  private readonly warnings = new Map<string, Grouped>()
  private readonly runs = new Map<string, RunStats>()
  private readonly slow = new Map<string, number[]>()
  private readonly inFront = new Map<string, { ms: number; times: number }>()
  private readonly answers: DiagnosticSummary['answers'] = {
    proposals: { accepted: 0, declined: 0 },
    replies: { taken: 0, discarded: 0 },
    commitments: {},
    changesUndone: 0,
    memoryCorrected: 0
  }
  private focused: { at: number; session: string } | null = null

  /** One line of the log, as written (JSON). */
  add(text: string): void {
    if (!text.trim()) {
      return
    }

    let line: LogLine

    try {
      line = JSON.parse(text) as LogLine
    } catch {
      this.unreadable += 1
      return
    }

    this.count += 1
    const at = line.t ?? ''

    if (at && (!this.from || at < this.from)) {
      this.from = at
    }

    if (at > this.to) {
      this.to = at
    }

    const level = line.lvl ?? 'info'
    // A line of a count stands for the times it counts; any other, for once.
    const times = typeof line.repeated === 'number' ? line.repeated : 1
    this.byLevel[level] = (this.byLevel[level] ?? 0) + times
    const key = `${line.area ?? '?'} · ${line.ev ?? '?'}`
    this.events.set(key, (this.events.get(key) ?? 0) + times)

    if (key === 'ui · window.focus' && at) {
      this.leftFront(at, line.s)
      this.focused = { at: Date.parse(at), session: line.s ?? '' }
    } else if (LEAVES_FRONT.has(key) && at) {
      this.leftFront(at, line.s)
    }

    if (key === 'app · app.start') {
      // A launch after one that ended without a word (a crash, the power) does not count its time.
      this.focused = null
      this.launches.push({
        at: line.t,
        session: line.s,
        version: line.version,
        edition: line.edition,
        profile: line.profile,
        os: line.os
      })
    }

    if (level === 'error' || level === 'warn') {
      this.group(level === 'error' ? this.errors : this.warnings, line, at, times)
    }

    if (key === 'segretario · run.end' && typeof line.task === 'string') {
      this.countRun(line, line.task)
    }

    if (line.area === 'segretario' && line.by === 'user') {
      answer(this.answers, line)
    }

    if (line.ev === 'ipc.slow' && typeof line.channel === 'string') {
      const times = this.slow.get(line.channel) ?? []
      times.push(numberOf(line.ms))
      this.slow.set(line.channel, times)
    }
  }

  result(): DiagnosticSummary {
    const byCount = (groups: Map<string, Grouped>): Grouped[] =>
      [...groups.values()].sort((a, b) => b.count - a.count).slice(0, KEPT_GROUPS)

    return {
      period: { from: this.from || null, to: this.to || null },
      lines: this.count,
      unreadable: this.unreadable,
      launches: this.launches,
      inFront: [...this.inFront]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, spent]) => ({
          day,
          minutes: Math.round(spent.ms / 60_000),
          times: spent.times
        })),
      byLevel: this.byLevel,
      events: [...this.events]
        .sort((a, b) => b[1] - a[1])
        .slice(0, KEPT_EVENTS)
        .map(([event, times]) => ({ event, count: times })),
      errors: byCount(this.errors),
      warnings: byCount(this.warnings),
      segretario: Object.fromEntries(
        [...this.runs].map(([task, stats]) => [
          task,
          {
            runs: stats.count,
            ended: stats.ended,
            msMedian: percentile(stats.ms, 0.5),
            msP95: percentile(stats.ms, 0.95),
            cost: Math.round(stats.cost * 10_000) / 10_000,
            toolCalls: stats.tools,
            toolErrors: stats.toolErrors,
            argsInvalid: stats.argsInvalid
          }
        ])
      ),
      answers: this.answers,
      slow: [...this.slow]
        .map(([channel, times]) => ({
          channel,
          count: times.length,
          msMedian: percentile(times, 0.5) ?? 0,
          msMax: Math.max(...times)
        }))
        .sort((a, b) => b.count - a.count)
    }
  }

  /** The window's time in front ends: counted on each local day it spans. */
  private leftFront(at: string, session: string | undefined): void {
    const end = Date.parse(at)
    const focused = this.focused
    this.focused = null

    if (!focused || focused.session !== (session ?? '') || end <= focused.at) {
      return
    }

    let start = focused.at
    let first = true

    while (start < end) {
      const next = new Date(start)
      next.setHours(24, 0, 0, 0)
      const until = Math.min(end, next.getTime())
      const day = localDay(new Date(start))
      const spent = this.inFront.get(day) ?? { ms: 0, times: 0 }
      spent.ms += until - start
      spent.times += first ? 1 : 0
      this.inFront.set(day, spent)
      first = false
      start = until
    }
  }

  /** A warning or an error, with the others of its kind: the same message with other numbers is one. */
  private group(groups: Map<string, Grouped>, line: LogLine, at: string, times: number): void {
    // What it said: the error's message, what a count was about, or what was printed.
    const message =
      line.err?.message ??
      (typeof line.said === 'string' ? line.said : undefined) ??
      (typeof line.text === 'string' ? line.text : '')
    const channel = typeof line.channel === 'string' ? line.channel : undefined
    const groupKey = `${line.area}\u0000${line.ev}\u0000${channel}\u0000${normalized(message)}`
    const group = groups.get(groupKey)

    if (group) {
      group.count += times
      group.last = at
    } else {
      groups.set(groupKey, {
        area: line.area ?? '?',
        ev: line.ev ?? '?',
        ...(channel ? { channel } : {}),
        message,
        count: times,
        first: at,
        last: at
      })
    }
  }

  private countRun(line: LogLine, task: string): void {
    const stats = this.runs.get(task) ?? {
      count: 0,
      ended: {},
      ms: [],
      cost: 0,
      tools: 0,
      toolErrors: 0,
      argsInvalid: 0
    }
    const ended = typeof line.status === 'string' ? line.status : '?'
    stats.count += 1
    stats.ended[ended] = (stats.ended[ended] ?? 0) + 1
    stats.ms.push(numberOf(line.ms))
    stats.cost += numberOf(line.cost)
    stats.tools += numberOf(line.tools)
    stats.toolErrors += numberOf(line.toolErrors)
    stats.argsInvalid += numberOf(line.argsInvalid)
    this.runs.set(task, stats)
  }
}

/** The summary of these log lines (JSON, one per line). */
export function summarize(lines: Iterable<string>): DiagnosticSummary {
  const counter = new SummaryCounter()

  for (const line of lines) {
    counter.add(line)
  }

  return counter.result()
}

/** A user's answer to the Segretario's work, counted where it belongs. */
function answer(answers: DiagnosticSummary['answers'], line: LogLine): void {
  switch (line.ev) {
    case 'proposal.decided':
      answers.proposals[line.accepted === true ? 'accepted' : 'declined'] += 1
      return
    case 'reply.taken':
      answers.replies.taken += 1
      return
    case 'reply.discarded':
      answers.replies.discarded += 1
      return
    case 'commitment.status': {
      const status = typeof line.status === 'string' ? line.status : '?'
      answers.commitments[status] = (answers.commitments[status] ?? 0) + 1
      return
    }
    case 'change.undone':
      answers.changesUndone += 1
      return
    case 'memory.edited':
    case 'memory.deleted':
    case 'memory.restored':
      answers.memoryCorrected += 1
  }
}

/** A message with its numbers, ids and quoted parts as placeholders: the same error, grouped once. */
function normalized(message: string): string {
  return message
    .replace(/«[^»]*»|"[^"]*"|'[^']*'/g, '…')
    .replace(/[0-9a-f]{8,}|\d+/gi, '#')
    .slice(0, 200)
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The nearest-rank percentile: the smallest value with at least that share of the others at or under it. */
function percentile(values: ReadonlyArray<number>, rank: number): number | null {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(rank * sorted.length) - 1)]
}
