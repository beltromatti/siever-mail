import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { uiLog } from '@renderer/lib/diagnostics'
import { languageNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import type { MemoryNote } from '@shared/segretario'

import {
  aboutYouNote,
  arrivalSentences,
  greetingName,
  letterState,
  type LetterState
} from './arrival-script'

const MESSAGES = defineMessages({
  greeting: {
    en: (name: string | null) => (name ? `Hi, ${name}.` : 'Hi.'),
    it: (name: string | null) => (name ? `Ciao, ${name}.` : 'Ciao.'),
    de: (name: string | null) => (name ? `Hallo, ${name}.` : 'Hallo.')
  },
  preparing: {
    en: 'I’m putting the finishing touches on your workspace…',
    it: 'Sto finendo di preparare il tuo ambiente…',
    de: 'Ich richte gerade Ihre Arbeitsumgebung ein…'
  },
  closing: { en: 'Here’s your day.', it: 'Ecco la tua giornata.', de: 'Hier ist Ihr Tag.' }
})

/**
 * The arrival's pace, in milliseconds — the animations' own lengths in
 * globals.css match it. With reduced motion the fades are plain and shorter.
 * `least`: how long the night stays even with the letter ready — the
 * greeting, and a sentence of the memory when there is one.
 */
interface Pace {
  fall: number
  out: number
  beat: number
  greeting: number
  preparing: number
  closing: number
  lift: number
  least: number
}

const PACE: Readonly<Record<'full' | 'reduced', Pace>> = {
  full: {
    fall: 1100,
    out: 800,
    beat: 300,
    greeting: 4400,
    preparing: 3400,
    closing: 2400,
    lift: 1500,
    least: 8500
  },
  reduced: {
    fall: 400,
    out: 350,
    beat: 200,
    greeting: 3400,
    preparing: 2800,
    closing: 1800,
    lift: 500,
    least: 6000
  }
}

/** How long the night waits past its fall for the memory to be read, before it speaks without it. */
const MEMORY_WAIT_MS = 1500
/** How often the letter is asked for besides when the work changes: what fails says nothing. */
const LETTER_POLL_MS = 4000
const TICK_MS = 100

/** A sentence of the memory stays as long as it takes to read it, within a breath or two. */
function sentenceMs(sentence: string): number {
  return Math.min(5600, Math.max(3400, 2400 + sentence.length * 22))
}

/**
 * What is said: the greeting — the work going on under it —, the work going
 * on alone, a sentence of the memory (its index), the day.
 */
type Words = 'greeting' | 'preparing' | 'closing' | number

/** The line at a place of the script: the greeting, the work going on, then the memory. */
function wordsAt(at: number): Words {
  return at === 0 ? 'greeting' : at === 1 ? 'preparing' : at - 2
}

/**
 * The place after this one: from the greeting, which says the work is going
 * on, the memory; after its last sentence, the work going on again, and the
 * memory once more. Nothing, when there is no memory: the line stays.
 */
function following(at: number, sentences: number): number | null {
  if (sentences === 0) {
    return null
  }

  return at === 0 ? 2 : at < sentences + 1 ? at + 1 : 1
}

/** Where the arrival is, and since when (`performance.now`). */
type Stage =
  | { kind: 'fall'; since: number }
  | { kind: 'line'; at: number; leaving: boolean; since: number }
  | { kind: 'closing'; since: number }
  | { kind: 'lift'; since: number }

/** How the arrival ended, for the diagnostics. */
type Ending = 'letter' | 'no-letter' | 'shown' | 'ai-off'

/** The words of the night, once it has fallen: whom it greets, what it shows of the memory. */
interface Script {
  name: string | null
  sentences: string[]
}

/** Today's letter as it stands, followed as the work changes — as Oggi follows it. */
function useLetter(): LetterState {
  const [state, setState] = useState<LetterState>('coming')

  useEffect(() => {
    let current = true
    let soon: number | null = null
    const load = (): void =>
      void window.segretarioApi
        .getToday()
        .then((page) => current && setState(letterState(page)))
        .catch(() => undefined)
    const later = (): void => {
      if (soon !== null) {
        window.clearTimeout(soon)
      }

      soon = window.setTimeout(() => {
        soon = null
        load()
      }, 500)
    }

    load()
    const poll = window.setInterval(load, LETTER_POLL_MS)
    const offWork = window.segretarioApi.onWorkChanged(later)
    const offEngine = window.segretarioApi.onEngineChanged(later)

    return () => {
      current = false
      window.clearInterval(poll)

      if (soon !== null) {
        window.clearTimeout(soon)
      }

      offWork()
      offEngine()
    }
  }, [])

  return state
}

/** How each kind of line is set: the greeting and the day large, the work going on quiet. */
const LINE_STYLE: Record<'greeting' | 'preparing' | 'closing' | 'memory', string> = {
  greeting: 'text-[clamp(34px,4.4vw,54px)] leading-[1.12]',
  closing: 'text-[clamp(34px,4.4vw,54px)] leading-[1.12]',
  preparing: 'text-muted-foreground text-[clamp(20px,2.3vw,27px)] italic',
  memory: 'max-w-[min(36ch,86vw)] text-[clamp(22px,2.6vw,32px)] leading-[1.34]'
}

/**
 * Newsreader's optical size for each — the display cut for the large lines —
 * and their spacing: over the Segretario's voice (`.voice`), which sets both
 * for running text.
 */
const LINE_TYPE: Record<keyof typeof LINE_STYLE, CSSProperties> = {
  greeting: { fontVariationSettings: "'opsz' 72", letterSpacing: '-0.012em' },
  closing: { fontVariationSettings: "'opsz' 72", letterSpacing: '-0.012em' },
  preparing: { fontVariationSettings: "'opsz' 36" },
  memory: { fontVariationSettings: "'opsz' 48", letterSpacing: '-0.004em' }
}

/**
 * The arrival (vision §12.2): after «Entra» of a setup that ran Conoscimi
 * with the AI on, a veil of the page's own colour — the "night" of the
 * code, light or dark as the theme is — falls over the setup, the
 * Segretario greets the user and says it is finishing, and sentences of
 * what it has just learned come and go while today's letter is written.
 * When the letter is there — and the night has lasted a little, even if it
 * was there already — «Here's your day», and the night lifts over Oggi,
 * rendered underneath with the letter. It is the letter that opens the
 * way; with none coming, or the AI gone, straight in.
 *
 * It lies over the workspace as the setup does (§13.1). `onNight` is the
 * night down: the setup ends under it, and the workspace — built at the
 * first start — is there when it lifts. `leave`: something asked to be seen,
 * and the night lifts at once. `onDone`: lifted, gone.
 */
export function Arrival({
  accounts,
  aiOn,
  leave,
  onNight,
  onDone
}: {
  accounts: ReadonlyArray<{ displayName: string }>
  aiOn: boolean
  leave: boolean
  onNight: () => void
  onDone: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const [reduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  )
  const [phase, setPhase] = useState<'fall' | 'night' | 'closing' | 'lift'>('fall')
  const [line, setLine] = useState<{ words: Words; key: number; leaving: boolean } | null>(null)
  const [script, setScript] = useState<Script>({ name: null, sentences: [] })
  const letter = useLetter()
  // What the clock reads as it goes, as it is now.
  const live = useRef({ accounts, aiOn, leave, letter, onNight, onDone })

  useEffect(() => {
    live.current = { accounts, aiOn, leave, letter, onNight, onDone }
  })

  // The clock: one beat every tenth of a second moves the night on when its time comes. The
  // letter, the AI and what asks to be seen can change at any moment; the lines keep their time.
  useEffect(() => {
    const pace = reduced ? PACE.reduced : PACE.full
    const started = performance.now()
    let stage: Stage = { kind: 'fall', since: started }
    let memory: MemoryNote[] | null = null
    let written: Script | null = null
    let nightAt = started
    let shown = 0
    let over = false

    void window.segretarioApi
      .listMemory()
      .then((notes) => {
        memory = notes
      })
      .catch(() => {
        memory = []
      })

    // The night is down: its words are written, and the setup ends under it.
    const night = (): Script => {
      if (written) {
        return written
      }

      const notes = memory ?? []
      written = {
        name: greetingName(live.current.accounts, aboutYouNote(notes)?.content ?? null),
        sentences: arrivalSentences(notes, languageNow().language)
      }
      nightAt = performance.now()
      setScript(written)
      setPhase('night')
      live.current.onNight()
      return written
    }

    const show = (at: number, now: number): void => {
      stage = { kind: 'line', at, leaving: false, since: now }
      shown += 1
      setLine({ words: wordsAt(at), key: shown, leaving: false })
    }

    const lift = (end: Ending, now: number): void => {
      night()
      stage = { kind: 'lift', since: now }
      setPhase('lift')
      uiLog.info('arrival.end', { end, ms: Math.round(now - started) })
      // Lifting onto Oggi: the first introduction, held while this played, is said now.
      void window.notificationsApi?.arrived()
    }

    const beat = (): void => {
      const now = performance.now()
      const elapsed = now - stage.since
      const { aiOn, leave, letter } = live.current

      if (stage.kind === 'lift') {
        if (!over && elapsed >= pace.lift) {
          over = true
          live.current.onDone()
        }

        return
      }

      // Something to be seen, or the AI gone: in, now.
      if (leave || !aiOn) {
        lift(leave ? 'shown' : 'ai-off', now)
        return
      }

      if (stage.kind === 'fall') {
        if (elapsed >= pace.fall && (memory !== null || elapsed >= pace.fall + MEMORY_WAIT_MS)) {
          night()
          show(0, now)
        }

        return
      }

      const lasted = now - nightAt
      // Once the night has lasted long enough, the letter decides: the day, or in without it.
      const ending =
        lasted < pace.least
          ? null
          : letter === 'ready'
            ? 'closing'
            : letter === 'none'
              ? 'in'
              : null

      if (stage.kind === 'closing') {
        if (elapsed >= pace.closing) {
          lift('letter', now)
        }

        return
      }

      const { sentences } = night()
      const next = following(stage.at, sentences.length)

      if (!stage.leaving) {
        const words = wordsAt(stage.at)
        const due =
          words === 'greeting'
            ? pace.greeting
            : words === 'preparing'
              ? pace.preparing
              : sentenceMs(sentences[stage.at - 2] ?? '')

        // A line with nothing after it stays until there is somewhere to go.
        if (elapsed >= due && (ending !== null || next !== null)) {
          stage = { ...stage, leaving: true, since: now }
          setLine((current) => current && { ...current, leaving: true })
        }

        return
      }

      if (elapsed < pace.out + pace.beat) {
        return
      }

      if (ending === 'closing') {
        stage = { kind: 'closing', since: now }
        shown += 1
        setPhase('closing')
        setLine({ words: 'closing', key: shown, leaving: false })
      } else if (ending === 'in') {
        lift('no-letter', now)
      } else {
        show(next ?? stage.at, now)
      }
    }

    const clock = window.setInterval(beat, TICK_MS)
    return () => window.clearInterval(clock)
  }, [reduced])

  const kind = line === null ? null : typeof line.words === 'number' ? 'memory' : line.words
  const text =
    line === null
      ? null
      : line.words === 'greeting'
        ? m.greeting(script.name)
        : line.words === 'preparing'
          ? m.preparing
          : line.words === 'closing'
            ? m.closing
            : (script.sentences[line.words] ?? null)
  const waiting = phase === 'night'

  return (
    // A moment, not a page: nothing to select, and the whole of it the window's handle.
    <div className="window-drag-region text-foreground absolute inset-0 overflow-hidden select-none">
      <div
        aria-hidden
        className={cn(
          'arrival-night absolute inset-0',
          phase === 'fall' && 'arrival-fall',
          phase === 'lift' && 'arrival-lift'
        )}
      />
      {phase !== 'fall' && (
        <div
          aria-hidden
          className={cn(
            'arrival-glow absolute inset-0',
            phase === 'lift' ? 'arrival-glow-lift' : 'arrival-line-in'
          )}
        />
      )}
      {phase !== 'fall' && (
        <div className={cn('absolute inset-0', phase === 'lift' && 'arrival-words-lift')}>
          <div
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center px-10 pb-16"
          >
            {line && kind && text && (
              <div
                key={line.key}
                className={cn(
                  'flex flex-col items-center gap-5 text-center',
                  line.leaving ? 'arrival-line-out' : 'arrival-line-in'
                )}
              >
                <p style={LINE_TYPE[kind]} className={cn('voice text-balance', LINE_STYLE[kind])}>
                  {text}
                </p>
                {/* Under the greeting, a moment later, what is going on. */}
                {kind === 'greeting' && (
                  <p
                    style={{ ...LINE_TYPE.preparing, animationDelay: reduced ? '500ms' : '1100ms' }}
                    className={cn('voice arrival-line-in text-balance', LINE_STYLE.preparing)}
                  >
                    {m.preparing}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="arrival-line-in absolute inset-x-0 bottom-10 flex flex-col items-center gap-3">
            <CompassStar className={cn('text-ai-star size-4', waiting && 'regenerating')} />
            <span
              className={cn(
                'text-faint-foreground text-[10.5px] font-semibold tracking-[0.16em] uppercase transition-opacity duration-700',
                kind === 'memory' && !line?.leaving ? 'opacity-100' : 'opacity-0'
              )}
            >
              {places.aboutYou}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
