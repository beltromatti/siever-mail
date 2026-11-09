import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeDiagnosticsBundle, type BundleFile, type DiagnosticsBundleSource } from './export'
import {
  clean,
  diagnostics,
  isProgramError,
  diagnosticsFiles,
  diagnosticsInfo,
  diagnosticsSession,
  errorOf,
  flushDiagnostics,
  localDay,
  resetDiagnosticsForTests,
  startDiagnostics
} from './log'
import { summarize } from './summary'

let folder: string

/** Every line written so far, parsed. */
function lines(): Array<Record<string, unknown>> {
  flushDiagnostics()
  return readdirSync(folder)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) =>
      readFileSync(join(folder, name), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    )
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'diagnostica-'))
  resetDiagnosticsForTests()
})

afterEach(() => {
  resetDiagnosticsForTests()
  vi.useRealTimers()
  rmSync(folder, { recursive: true, force: true })
})

describe('the log', () => {
  it('writes what came before it started, then each event as a line of its area', () => {
    diagnostics('app').info('app.start', { version: '2.0.0' })
    startDiagnostics({ folder, echo: false, catchConsole: false })
    diagnostics('mail').info('messages.archived', { count: 3, by: 'user' })

    const written = lines()
    expect(written.map((line) => [line.area, line.ev])).toEqual([
      ['app', 'app.start'],
      ['mail', 'messages.archived']
    ])
    expect(written[1]).toMatchObject({ lvl: 'info', count: 3, by: 'user', s: diagnosticsSession() })
    expect(Number(written[1].seq)).toBeGreaterThan(Number(written[0].seq))
    expect(readdirSync(folder)).toEqual([`registro-${localDay()}.jsonl`])
  })

  it('never writes a secret, nor text past its length', () => {
    startDiagnostics({ folder, echo: false, catchConsole: false })
    diagnostics('app').info('connection.added', {
      password: 'hunter2',
      promptTokens: 1_200,
      passing: true,
      nested: { accessToken: 'abc', apiKey: 'sk-or-1', kept: 'x'.repeat(2_000) },
      list: Array.from({ length: 40 }, (_, index) => index)
    })

    const [line] = lines()
    expect(line.password).toBe('[tolto]')
    expect(line).toMatchObject({ promptTokens: 1_200, passing: true })
    expect(line.nested).toMatchObject({ accessToken: '[tolto]', apiKey: '[tolto]' })
    expect(String((line.nested as { kept: string }).kept).length).toBeLessThan(700)
    expect((line.list as unknown[]).at(-1)).toBe('… (+10)')
    expect(JSON.stringify(line)).not.toContain('hunter2')
  })

  it('keeps an error as an error, with what the server said', () => {
    const error = Object.assign(new Error('Command failed'), {
      responseText: 'Invalid credentials',
      serverResponseCode: 'AUTHENTICATIONFAILED',
      code: 'NoConnection',
      cause: new Error('socket hang up')
    })

    expect(errorOf(error)).toMatchObject({
      name: 'Error',
      message: 'Command failed',
      response: 'Invalid credentials',
      serverCode: 'AUTHENTICATIONFAILED',
      code: 'NoConnection',
      cause: { message: 'socket hang up' }
    })
    expect(clean({ err: error }, 0)).toMatchObject({ err: { message: 'Command failed' } })
    // A server command keeps its words, never what it was given: a search carries what was searched.
    expect(
      errorOf(
        Object.assign(new Error('BAD'), { executedCommand: '4 UID SEARCH TEXT "fattura brenta"' })
      ).command
    ).toBe('UID SEARCH TEXT')
  })

  it('tells an exception of the program from the answer of the world', () => {
    expect(isProgramError(new TypeError('x is undefined'))).toBe(true)
    expect(isProgramError(Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' }))).toBe(true)
    expect(isProgramError(new TypeError('fetch failed'))).toBe(false)
    expect(isProgramError(new Error('Il server non accetta questa password'))).toBe(false)
  })

  it('counts a warning said again within a minute, and writes the count when it is over', () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T10:00:00'), toFake: ['Date'] })
    startDiagnostics({ folder, echo: false, catchConsole: false })
    const log = diagnostics('mail')

    for (let time = 0; time < 5; time += 1) {
      log.warn('connection.failed', { conn: 'a', err: new Error('ECONNRESET') })
    }

    // Another connection, another event: written.
    log.warn('connection.failed', { conn: 'b', err: new Error('ECONNRESET') })
    vi.setSystemTime(new Date('2026-11-09T10:01:30'))
    log.warn('connection.failed', { conn: 'a', err: new Error('ECONNRESET') })
    log.warn('connection.failed', { conn: 'a', err: new Error('ECONNRESET') })

    // The count still open goes out with the rest, as at quitting.
    const written = lines()
    expect(written.map((line) => [line.conn, line.repeated, line.said])).toEqual([
      ['a', undefined, undefined],
      ['b', undefined, undefined],
      ['a', 4, 'ECONNRESET'],
      ['a', undefined, undefined],
      ['a', 1, 'ECONNRESET']
    ])
    expect(summarize(written.map((line) => JSON.stringify(line))).warnings).toEqual([
      expect.objectContaining({ count: 8, message: 'ECONNRESET' })
    ])
  })

  it('stops the information lines of a day past its size, and still writes what goes wrong', () => {
    writeFileSync(join(folder, `registro-${localDay()}.jsonl`), 'x'.repeat(20 * 1024 * 1024))
    startDiagnostics({ folder, echo: false, catchConsole: false })
    diagnostics('ui').info('app.open', { app: 'mail' })
    diagnostics('ui').info('app.open', { app: 'calendar' })
    diagnostics('mail').warn('connection.failed', { conn: 'a', err: new Error('ECONNRESET') })
    flushDiagnostics()

    const tail = readFileSync(join(folder, `registro-${localDay()}.jsonl`), 'utf8')
      .slice(20 * 1024 * 1024)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(tail.map((line) => line.ev)).toEqual(['log.capped', 'connection.failed'])
  })

  it('catches the console of the process, each text apart', () => {
    // The console as it was, and quiet meanwhile: what it prints is the log's to keep here.
    const original = {
      warn: console.warn,
      error: console.error,
      log: console.log,
      info: console.info
    }
    console.warn = () => undefined
    console.error = () => undefined

    try {
      startDiagnostics({ folder, echo: false })
      console.warn('first thing a library said')
      console.warn('second thing it said')
      // Electron's own line for a failed channel: written by the channel, not again here.
      console.error("Error occurred in handler for 'mail:list':", new Error('gone'))
    } finally {
      Object.assign(console, original)
    }

    expect(lines().map((line) => [line.area, line.lvl, line.text])).toEqual([
      ['console', 'warn', 'first thing a library said'],
      ['console', 'warn', 'second thing it said']
    ])
  })

  it('keeps 21 days, today’s included, and lists them from a day on', () => {
    const daysAgo = (days: number): string => localDay(new Date(Date.now() - days * 86_400_000))
    writeFileSync(join(folder, `registro-${daysAgo(21)}.jsonl`), '{}\n')
    writeFileSync(join(folder, `registro-${daysAgo(20)}.jsonl`), '{}\n')
    writeFileSync(join(folder, 'altro.txt'), 'not the log’s')
    startDiagnostics({ folder, echo: false, catchConsole: false })
    diagnostics('app').info('app.start')
    flushDiagnostics()

    expect(readdirSync(folder).sort()).toEqual(
      ['altro.txt', `registro-${daysAgo(20)}.jsonl`, `registro-${localDay()}.jsonl`].sort()
    )
    expect(diagnosticsFiles(localDay()).map((file) => file.name)).toEqual([
      `registro-${localDay()}.jsonl`
    ])
    expect(diagnosticsInfo()).toMatchObject({ folder, keptDays: 21, since: daysAgo(20) })
  })
})

describe('the summary', () => {
  const line = (fields: Record<string, unknown>): string =>
    JSON.stringify({ s: 's1', lvl: 'info', ...fields })

  it('tells the launches, the time in front, the runs and the errors at a glance', () => {
    const summary = summarize([
      line({ t: '2026-11-09T08:00:00.000Z', area: 'app', ev: 'app.start', version: '2.0.0' }),
      line({ t: '2026-11-09T08:00:10.000Z', area: 'ui', ev: 'window.focus' }),
      line({ t: '2026-11-09T08:10:10.000Z', area: 'ui', ev: 'window.blur' }),
      line({ t: '2026-11-09T08:20:00.000Z', area: 'ui', ev: 'window.focus' }),
      line({ t: '2026-11-09T08:25:00.000Z', area: 'app', ev: 'system.sleep' }),
      line({
        t: '2026-11-09T09:00:00.000Z',
        area: 'segretario',
        ev: 'run.end',
        task: 'lettura',
        status: 'done',
        ms: 4_000,
        cost: 0.0004,
        tools: 3,
        toolErrors: 1,
        argsInvalid: 1
      }),
      line({
        t: '2026-11-09T09:01:00.000Z',
        area: 'segretario',
        ev: 'run.end',
        task: 'lettura',
        status: 'failed',
        lvl: 'warn',
        ms: 9_000,
        cost: 0.0002,
        tools: 2,
        err: { message: 'Mi sono fermato' }
      }),
      line({
        t: '2026-11-09T09:02:00.000Z',
        area: 'mail',
        ev: 'IPC handler failed: mail:list',
        lvl: 'error',
        err: { message: 'Folder 12 not found' }
      }),
      line({
        t: '2026-11-09T09:03:00.000Z',
        area: 'mail',
        ev: 'IPC handler failed: mail:list',
        lvl: 'error',
        err: { message: 'Folder 99 not found' },
        repeated: 2
      }),
      line({
        t: '2026-11-09T09:04:00.000Z',
        area: 'mail',
        ev: 'ipc.slow',
        channel: 'mail:list',
        ms: 2_500
      }),
      line({
        t: '2026-11-09T09:05:00.000Z',
        area: 'segretario',
        ev: 'proposal.decided',
        accepted: true,
        by: 'user'
      }),
      line({
        t: '2026-11-09T09:06:00.000Z',
        area: 'segretario',
        ev: 'proposal.decided',
        accepted: false,
        by: 'user'
      }),
      line({
        t: '2026-11-09T09:07:00.000Z',
        area: 'segretario',
        ev: 'commitment.status',
        status: 'fatta',
        by: 'user'
      }),
      line({ t: '2026-11-09T09:08:00.000Z', area: 'segretario', ev: 'reply.taken', by: 'user' }),
      'not json',
      ''
    ])

    expect(summary.lines).toBe(14)
    expect(summary.answers).toEqual({
      proposals: { accepted: 1, declined: 1 },
      replies: { taken: 1, discarded: 0 },
      commitments: { fatta: 1 },
      changesUndone: 0,
      memoryCorrected: 0
    })
    expect(summary.unreadable).toBe(1)
    expect(summary.launches).toEqual([expect.objectContaining({ version: '2.0.0', session: 's1' })])
    expect(summary.inFront).toEqual([
      { day: localDay(new Date('2026-11-09T08:00:10.000Z')), minutes: 15, times: 2 }
    ])
    expect(summary.segretario.lettura).toMatchObject({
      runs: 2,
      // The nearest rank: of two, the median is the first, the 95th the second.
      msMedian: 4_000,
      msP95: 9_000,
      ended: { done: 1, failed: 1 },
      toolCalls: 5,
      toolErrors: 1,
      argsInvalid: 1,
      cost: 0.0006
    })
    // The same error with other numbers in it is one kind, counted with its repeats.
    expect(summary.errors).toEqual([
      expect.objectContaining({ area: 'mail', count: 3, message: 'Folder 12 not found' })
    ])
    expect(summary.warnings).toEqual([expect.objectContaining({ message: 'Mi sono fermato' })])
    expect(summary.slow).toEqual([
      { channel: 'mail:list', count: 1, msMedian: 2_500, msMax: 2_500 }
    ])
  })

  it('ends the time in front when the screen locks, and counts a night on each of its days', () => {
    const at = (day: number, hours: number, minutes = 0): string =>
      new Date(2026, 10, day, hours, minutes).toISOString()
    const summary = summarize([
      line({ t: at(9, 10), area: 'ui', ev: 'window.focus' }),
      line({ t: at(9, 10, 30), area: 'app', ev: 'system.lock' }),
      line({ t: at(9, 23, 30), area: 'ui', ev: 'window.focus' }),
      line({ t: at(10, 0, 45), area: 'ui', ev: 'window.blur' })
    ])

    expect(summary.inFront).toEqual([
      { day: '2026-11-09', minutes: 60, times: 2 },
      { day: '2026-11-10', minutes: 45, times: 0 }
    ])
  })

  it('does not count the time of a launch that ended without a word', () => {
    const summary = summarize([
      line({ t: '2026-11-09T08:00:00.000Z', area: 'ui', ev: 'window.focus' }),
      line({ t: '2026-11-09T09:00:00.000Z', area: 'app', ev: 'app.start', s: 's2' }),
      line({ t: '2026-11-09T09:05:00.000Z', area: 'ui', ev: 'window.blur', s: 's2' })
    ])

    expect(summary.inFront).toEqual([])
  })
})

describe('the export', () => {
  it('holds what it says, the Segretario only when chosen, and leaves nothing half written', async () => {
    startDiagnostics({ folder, echo: false, catchConsole: false })
    diagnostics('app').info('app.start', { version: '2.0.0' })
    const target = join(folder, 'export.zip')
    const source = (withExtension: boolean): DiagnosticsBundleSource => ({
      about: { version: '2.0.0', edition: 'public' },
      state: async () => ({
        app: { version: '2.0.0' },
        mail: { accounts: [{ id: 'a1', refreshToken: 'r-1', clientSecret: 's-1', messages: 3 }] }
      }),
      segretario: async function* (): AsyncGenerator<BundleFile> {
        yield { name: 'sessioni/2026-11-09 lettura abc.json', content: { task: 'lettura' } }
        yield { name: 'memoria/tu.md', content: '# Tu\n' }
      },
      extension: async () =>
        withExtension ? [{ name: 'acme-srl/stato.json', content: { practices: 3 } }] : []
    })

    const bytes = await writeDiagnosticsBundle(target, { days: 7, segretario: false }, source(true))
    const files = unzipSync(readFileSync(target))
    const names = Object.keys(files).sort()

    expect(bytes).toBe(readFileSync(target).length)
    expect(names).toEqual(
      [
        'LEGGIMI.txt',
        'estensione/acme-srl/stato.json',
        'manifesto.json',
        `registro/registro-${localDay()}.jsonl`,
        'riepilogo.json',
        'stato.json'
      ].sort()
    )
    const manifest = JSON.parse(new TextDecoder().decode(files['manifesto.json'])) as {
      options: unknown
      files: Array<{ name: string }>
    }
    expect(manifest.options).toEqual({ days: 7, segretario: false })
    const state = new TextDecoder().decode(files['stato.json'])
    expect(JSON.parse(state)).toMatchObject({
      mail: {
        accounts: [{ id: 'a1', refreshToken: '[tolto]', clientSecret: '[tolto]', messages: 3 }]
      }
    })
    expect(new TextDecoder().decode(files['LEGGIMI.txt'])).toContain(
      'non è stata mandata a nessuno'
    )

    await writeDiagnosticsBundle(target, { days: 1, segretario: true }, source(false))
    const withSegretario = Object.keys(unzipSync(readFileSync(target)))
    expect(new TextDecoder().decode(unzipSync(readFileSync(target))['LEGGIMI.txt'])).toContain(
      'l’esecuzione del Segretario nel periodo'
    )
    expect(withSegretario).toEqual(
      expect.arrayContaining([
        'segretario/sessioni/2026-11-09 lettura abc.json',
        'segretario/memoria/tu.md'
      ])
    )
    expect(readdirSync(folder).some((name) => name.endsWith('.part'))).toBe(false)

    // A source that fails takes the export down whole: no archive, no part left.
    const failing = join(folder, 'failing.zip')
    await expect(
      writeDiagnosticsBundle(
        failing,
        { days: 1, segretario: false },
        {
          ...source(false),
          state: async () => {
            throw new Error('no state')
          }
        }
      )
    ).rejects.toThrow('no state')
    expect(readdirSync(folder).filter((name) => name.startsWith('failing'))).toEqual([])
  })
})

describe('what a failed call was given', () => {
  it('keeps what tells which thing failed, never the words', async () => {
    const { argsForLog } = await import('@main/ipc/handle')
    const id = '2f6f90f2-365e-487e-81b1-a6e86dd4a451'

    expect(
      argsForLog([
        {
          accountId: 'a1',
          draftId: 'd1',
          folderPath: 'INBOX',
          subject: 'Offerta',
          html: '<p>Buongiorno</p>',
          to: [{ address: 'x@brenta.it' }],
          attachments: [{ path: '/tmp/offerta.pdf', size: 12 }],
          password: 'hunter2'
        },
        id,
        // Given on its own, a password to sign in again or a key: only its length.
        'hunter2',
        'sk-or-v1-0123456789'
      ])
    ).toEqual([
      {
        accountId: 'a1',
        draftId: 'd1',
        folderPath: 'INBOX',
        subject: '[7 caratteri]',
        html: '[17 caratteri]',
        to: [{ address: '[11 caratteri]' }],
        attachments: [{ path: '[16 caratteri]', size: 12 }],
        password: '[tolto]'
      },
      id,
      '[7 caratteri]',
      '[19 caratteri]'
    ])
  })
})
