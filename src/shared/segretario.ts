import { defineMessages, messagesIn, type LanguageState } from './i18n'
import type { MessageRef } from './models'
import { PLACES } from './places'

/**
 * The Segretario: SIEVER Mail's agent. What the main process and the page
 * say to each other about it — the key and the switch, the user's work as
 * the Segretario keeps it (notes, commitments, projects, replies,
 * proposals), its runs and what happens in them.
 */

/* ──────────────────────────────── key and switch ──────────────────────────────── */

/** Where the OpenRouter key stands, as the last check found it. */
export type SegretarioKeyState =
  /** No key saved: the AI is off. */
  | 'missing'
  /** Saved and answered; `credit` says how much is left. */
  | 'ready'
  /** OpenRouter turned it down: revoked, mistyped, deleted. */
  | 'invalid'
  /** No credit left on the account, or the key reached its own limit. */
  | 'exhausted'
  /** It could not be checked: no network, OpenRouter down. Kept as it was. */
  | 'unchecked'

export interface SegretarioCredit {
  /** What can still be spent, in dollars: the lower of the account's balance and the key's limit. */
  available: number
  balance: number | null
  keyLimit: number | null
  keyRemaining: number | null
  keyLimitReset: string | null
}

export interface SegretarioStatus {
  keyState: SegretarioKeyState
  /** The key as OpenRouter labels it ("sk-or-v1-9b6…138"), never the key itself. */
  keyLabel: string | null
  credit: SegretarioCredit | null
  checkedAt: number | null
  problem: string | null
  /** The model in use, as OpenRouter names it. */
  modelName: string | null
}

/**
 * What SIEVER Mail has to tell the user about the AI, kept until they have
 * seen it: the credit or the key gave out — and the AI is off from then on
 * — or the credit runs low, in time to top it up before it does.
 */
export type SegretarioNotice =
  | { kind: 'credito-finito' | 'chiave-rifiutata' | 'modello-non-disponibile'; at: number }
  | {
      kind: 'credito-basso' | 'credito-quasi-finito'
      at: number
      /** What is left, in dollars. */
      available: number
      /** Days it lasts at the pace of the last week; null with nothing spent. */
      days: number | null
    }

/** Where the models are, to see the Segretario's. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/models'

/** Where the credit is topped up, and the keys made. */
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits'
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys'

/** What SIEVER Mail tells the user about the AI (`SegretarioNotice`), in every language. */
const NOTICE_WORDS = defineMessages({
  exhaustedTitle: {
    en: 'AI credit used up',
    it: 'Credito AI finito',
    de: 'KI-Guthaben aufgebraucht'
  },
  exhaustedBody: {
    en: 'Your OpenRouter credit has run out, or the key has reached its spending limit: from now on the AI features are off and SIEVER Mail carries on without the Segretario. What it has learnt stays. To turn them back on, top up your credit on OpenRouter, then turn “AI features” back on in Settings › Segretario.',
    it: 'Il credito OpenRouter è finito, o la chiave ha raggiunto il suo limite di spesa: da ora le funzioni AI sono spente e SIEVER Mail continua senza il Segretario. Quello che ha imparato resta. Per riaccenderle ricarica il credito su OpenRouter, poi riattiva «Funzioni AI» in Impostazioni › Segretario.',
    de: 'Ihr OpenRouter-Guthaben ist aufgebraucht, oder der Schlüssel hat sein Ausgabenlimit erreicht: Ab jetzt sind die KI-Funktionen ausgeschaltet, und SIEVER Mail arbeitet ohne den Segretario weiter. Was er gelernt hat, bleibt erhalten. Um sie wieder einzuschalten, laden Sie Ihr Guthaben bei OpenRouter auf und aktivieren Sie dann „KI-Funktionen“ unter Einstellungen › Segretario wieder.'
  },
  keyRefusedTitle: {
    en: 'OpenRouter key refused',
    it: 'Chiave OpenRouter rifiutata',
    de: 'OpenRouter-Schlüssel abgelehnt'
  },
  keyRefusedBody: {
    en: 'OpenRouter no longer accepts the key: from now on the AI features are off and SIEVER Mail carries on without the Segretario. What it has learnt stays. To turn them back on, turn “AI features” back on in Settings › Segretario and enter a valid key.',
    it: 'OpenRouter non accetta più la chiave: da ora le funzioni AI sono spente e SIEVER Mail continua senza il Segretario. Quello che ha imparato resta. Per riaccenderle riattiva «Funzioni AI» in Impostazioni › Segretario e inserisci una chiave valida.',
    de: 'OpenRouter akzeptiert den Schlüssel nicht mehr: Ab jetzt sind die KI-Funktionen ausgeschaltet, und SIEVER Mail arbeitet ohne den Segretario weiter. Was er gelernt hat, bleibt erhalten. Um sie wieder einzuschalten, aktivieren Sie „KI-Funktionen“ unter Einstellungen › Segretario wieder und geben Sie einen gültigen Schlüssel ein.'
  },
  modelGoneTitle: {
    en: 'AI model unavailable',
    it: 'Modello AI non disponibile',
    de: 'KI-Modell nicht verfügbar'
  },
  modelGoneBody: {
    en: 'OpenRouter no longer offers the Segretario’s model, or no provider serves it without keeping your data: from now on the AI features are off and SIEVER Mail carries on without the Segretario. What it has learnt stays. Turn “AI features” back on in Settings › Segretario when you want to try again.',
    it: 'OpenRouter non offre più il modello del Segretario, o nessun fornitore lo serve senza tenere i tuoi dati: da ora le funzioni AI sono spente e SIEVER Mail continua senza il Segretario. Quello che ha imparato resta. Riattiva «Funzioni AI» in Impostazioni › Segretario quando vuoi riprovare.',
    de: 'OpenRouter bietet das Modell des Segretario nicht mehr an, oder kein Anbieter stellt es bereit, ohne Ihre Daten zu speichern: Ab jetzt sind die KI-Funktionen ausgeschaltet, und SIEVER Mail arbeitet ohne den Segretario weiter. Was er gelernt hat, bleibt erhalten. Aktivieren Sie „KI-Funktionen“ unter Einstellungen › Segretario wieder, wenn Sie es erneut versuchen möchten.'
  },
  lowTitle: { en: 'AI credit low', it: 'Credito AI basso', de: 'KI-Guthaben niedrig' },
  almostOutTitle: {
    en: 'AI credit almost used up',
    it: 'Credito AI quasi finito',
    de: 'KI-Guthaben fast aufgebraucht'
  },
  /** How long the credit lasts at the pace of the last days; nothing when nothing was spent. */
  lasts: {
    en: (days: number | null) =>
      days === null
        ? ''
        : days < 1
          ? ' — at the pace of the last few days, less than a day'
          : ` — at the pace of the last few days, about ${days === 1 ? 'a day' : `${days} days`}`,
    it: (days: number | null) =>
      days === null
        ? ''
        : days < 1
          ? ' — al ritmo degli ultimi giorni, meno di un giorno'
          : ` — al ritmo degli ultimi giorni, circa ${days === 1 ? 'un giorno' : `${days} giorni`}`,
    de: (days: number | null) =>
      days === null
        ? ''
        : days < 1
          ? ' — beim Verbrauch der letzten Tage weniger als ein Tag'
          : ` — beim Verbrauch der letzten Tage etwa ${days === 1 ? 'ein Tag' : `${days} Tage`}`
  },
  lowBody: {
    en: (amount: string, lasts: string) =>
      `${amount} of OpenRouter credit left${lasts}. Top it up in time: when it runs out, the AI features turn off until you top it up.`,
    it: (amount: string, lasts: string) =>
      `Restano ${amount} di credito OpenRouter${lasts}. Ricaricalo per tempo: quando finisce, le funzioni AI si spengono finché non lo ricarichi.`,
    de: (amount: string, lasts: string) =>
      `Noch ${amount} OpenRouter-Guthaben übrig${lasts}. Laden Sie es rechtzeitig auf: Wenn es aufgebraucht ist, schalten sich die KI-Funktionen aus, bis Sie es wieder aufladen.`
  }
})

/**
 * A notice in words, in the interface's language and with its way of
 * writing amounts: its title, and what it says — the same in the app and
 * in the system's alert.
 */
export function noticeWords(
  notice: SegretarioNotice,
  { language, formatLocale }: LanguageState
): { title: string; body: string } {
  const m = messagesIn(NOTICE_WORDS, language)

  switch (notice.kind) {
    case 'credito-finito':
      return { title: m.exhaustedTitle, body: m.exhaustedBody }
    case 'chiave-rifiutata':
      return { title: m.keyRefusedTitle, body: m.keyRefusedBody }
    case 'modello-non-disponibile':
      return { title: m.modelGoneTitle, body: m.modelGoneBody }
    default: {
      const dollars = notice.available.toLocaleString(formatLocale, {
        style: 'currency',
        currency: 'USD'
      })

      return {
        title: notice.kind === 'credito-basso' ? m.lowTitle : m.almostOutTitle,
        body: m.lowBody(dollars, m.lasts(notice.days))
      }
    }
  }
}

/**
 * The AI is one switch: on, every function of the Segretario is there; off,
 * SIEVER Mail is a mail and calendar client with no trace of it, and what it
 * learnt is kept.
 */
export interface SegretarioPreferences {
  enabled: boolean
}

/** Off until the user turns it on, in the guided setup: the AI starts with Conoscimi, never by itself. */
export const DEFAULT_SEGRETARIO_PREFERENCES: SegretarioPreferences = { enabled: false }

/** What the Segretario costs, in dollars, as OpenRouter billed each call. */
export interface SegretarioSpending {
  today: number
  thisMonth: number
  /** The last thirty days, by what it was spent on, the most first. */
  byFunction: Array<{ purpose: string; label: string; cost: number }>
}

/** Where the Segretario's own work stands: what it reads, what waits. */
export interface EngineState {
  /** OpenRouter does not answer: the work waits for it, and tries again when said. */
  waiting: string | null
  /** Of the messages of the last thirty days the Segretario reads, how many it has read. */
  reading: { read: number; total: number }
  /** Units of work waiting or running, by task. */
  queued: Partial<Record<TaskKind, number>>
  running: Partial<Record<TaskKind, number>>
}

/* ─────────────────────────────── the user's work ─────────────────────────────── */

/** Who changed something: the user, the Segretario, or the app itself. */
export type WorkActor = 'utente' | 'segretario' | 'sistema'

/** What a message asked of the user when it came, as the Segretario read it. */
export type NoteNature = 'da_rispondere' | 'da_fare' | 'in_attesa' | 'informativo' | 'rumore'
export type NotePriority = 'alta' | 'media' | 'bassa'

/**
 * What the Segretario wrote next to a message when it came (or left): the
 * one thing that counts, what it asked of the user, how much it matters.
 * History: what is still to do lives in the commitments.
 */
export interface MessageNote {
  accountId: string
  messageKey: string
  threadId: string
  direction: 'in' | 'out'
  summary: string
  nature: NoteNature
  priority: NotePriority
  reason: string
  due: string | null
  messageDate: string
  /** The same message came to another of the user's accounts: this copies that note. */
  twinAccountId: string | null
  writtenBy: WorkActor
}

export type CommitmentKind = 'ti_chiedono' | 'hai_promesso' | 'aspetti' | 'da_fare'

/** Open until done, not needed, or put off to a day; any of them can be opened again. */
export type CommitmentStatus = 'aperta' | 'fatta' | 'non_serve' | 'rinviata'

/** Something open between the user and someone: asked, promised, awaited, to do. */
/**
 * Where an open thing comes from, to open it: a message (with its
 * conversation), an event, or the user's word — said to the Segretario or
 * written by hand.
 */
export type CommitmentSource =
  | { kind: 'message'; accountId: string; threadId: string; messageKey: string }
  | { kind: 'event'; eventKey: string }
  /** The user's word, with the project it is about when there is one. */
  | { kind: 'user'; projectId?: string }

export interface Commitment {
  id: number
  source: CommitmentSource
  kind: CommitmentKind
  text: string
  due: string | null
  status: CommitmentStatus
  /** For `rinviata`: the day it opens again. */
  until: string | null
  /** Who made its last change of status, why, and the message that showed it. */
  setBy: WorkActor
  reason: string | null
  evidenceKey: string | null
  /** A question the Segretario asks the user about it: is it still open? */
  question: string | null
  createdAt: number
  updatedAt: number
}

/** A project a conversation is in, for a row's badge and the reader. */
export interface ProjectLabel {
  id: string
  title: string
}

/** An event's share of the work: the open things born from it (and those closed lately), its projects. */
export interface EventWork {
  commitments: Commitment[]
  projects: ProjectLabel[]
  /**
   * Whose the event is, where someone's word counts (§7.4): in a calendar
   * shared, one the calendar does not say is the user's. Null elsewhere —
   * the calendar says it, and there is nothing to put right.
   */
  whose: EventWhose | null
}

/** Whose an event is, as the Segretario found it or the user said it — or as nobody did yet. */
export interface EventWhose {
  yours: boolean
  /** Who said it: the Segretario, the user; null when nobody did (it is not theirs). */
  by: 'segretario' | 'utente' | null
  /** Why, as the Segretario said it. */
  reason: string | null
}

/** A reply prepared ahead, while it waits for the user. */
export interface PreparedReply {
  accountId: string
  messageKey: string
  kind: 'risposta' | 'sollecito'
  text: string
  doubts: string
  /** `da_rivedere` when the conversation moved on after it was written. */
  status: 'pronta' | 'da_rivedere'
  staleReason: string | null
}

/** Something the Segretario recommends and leaves the user to decide. */
export interface Proposal {
  id: string
  /** `evento`, or an extension's own (`acme-srl.archive`). */
  kind: string
  title: string
  payload: Record<string, unknown>
  accountId: string | null
  messageKey: string | null
  /** The version shown: an answer to an older one is refused, the proposal having changed. */
  revision: number
  createdAt: number
  /** Its message, where the proposal is shown away from it (Oggi): who wrote it and about what. */
  source?: { ref: MessageRef; from: string; subject: string }
}

/**
 * What the reader shows of a message: its note, what is open (and settled
 * lately) in its conversation, its projects, the reply prepared, the
 * proposals waiting.
 */
export interface MessageWork {
  note: MessageNote | null
  commitments: Commitment[]
  projects: ProjectLabel[]
  reply: PreparedReply | null
  proposals: Proposal[]
}

/**
 * What a message's row in a list shows of the Segretario's work: its note
 * — what it said — and what is open from it now, which is what decides.
 */
export interface MessageRowWork {
  accountId: string
  messageKey: string
  note: MessageNote | null
  /** The first of what the user owes from it, the soonest due first; null when nothing is owed. */
  owed: { kind: CommitmentKind; due: string | null } | null
  /** Something is awaited from it. */
  awaited: boolean
  /** A reply prepared for it: ready, or to look at again. */
  reply: 'pronta' | 'da_rivedere' | null
}

/** What the Segretario has on the messages selected, for an extension's action on them. */
export interface SelectionWork {
  /** The folders linked to the projects their conversations are in: where their work is kept. */
  projectFolders: string[]
  /** The proposals open on these messages, every kind: an extension takes its own. */
  proposals: Proposal[]
}

/* ──────────────────────────────── projects ──────────────────────────────── */

/**
 * A matter that lasts — a job, a practice, a negotiation, a match to
 * organise — and the conversations, folders and commitments that belong
 * to it, across the accounts.
 */
export interface Project {
  id: string
  title: string
  description: string | null
  /** "Il punto": where it stands, as last written; null until written. */
  state: string | null
  /** What the short names in "Il punto" stand for. */
  stateLinks: HandleLink[]
  stateAt: number | null
  /** Something moved after "Il punto" was written. */
  stale: boolean
  origin: WorkActor
  hidden: boolean
  closed: boolean
  conversations: number
  openCommitments: number
  lastMessageAt: string | null
}

export interface ProjectDetail extends Project {
  /** What it gathers besides its conversations: folders, events (by key, titled), links. */
  resources: Array<{ kind: 'cartella' | 'evento' | 'link'; location: string; label: string | null }>
  commitments: Commitment[]
}

/* ──────────────────────────────── the day ──────────────────────────────── */

/**
 * Where a line of the day comes from, to say it and to open it: a message
 * (who wrote it — "Tu" for the user, from any of their accounts —, its
 * subject, when), an event (its title, when it is), or the user's word
 * (when they said it).
 */
export type DayLineSource =
  | {
      kind: 'message'
      ref: MessageRef
      messageKey: string
      subject: string
      from: string
      date: string
    }
  /** An event; its title and start null once it is no longer in the calendar. */
  | {
      kind: 'event'
      eventKey: string
      title: string | null
      start: string | null
      allDay: boolean
    }
  | { kind: 'user'; date: string }

/** A line of the day's page, of the agenda and of a project: something to do, with what makes it count. */
export interface DayLine {
  text: string
  priority: NotePriority | null
  due: string | null
  commitment: Commitment | null
  readyKind?: 'risposta' | 'sollecito'
  source: DayLineSource
}

/** The day as the Segretario sees it: "Oggi". */
export interface TodayPage {
  day: string
  /** The letter at the top, and when it was written; null until written. */
  letter: string | null
  /** What the short names in the letter stand for. */
  letterLinks: HandleLink[]
  letterAt: number | null
  /** The day is being looked at again: a new letter is on its way. */
  letterRewriting: boolean
  /** Messages still to be read: while there are, the day is not complete. */
  reading: number
  /** OpenRouter does not answer: the work waits for it — said, while it does. */
  network: string | null
  /** What is due today, or overdue. */
  today: DayLine[]
  /** What is due in the next seven days. */
  week: DayLine[]
  /** What the user owes, without a date or later. */
  waiting: DayLine[]
  /** What the user waits on, the longest first. */
  awaited: DayLine[]
  /** Replies and reminders prepared, to look at. */
  ready: DayLine[]
  /** What the Segretario asks the user about: is it still open? */
  questions: DayLine[]
  proposals: Proposal[]
  /** Today's meetings with what the Segretario prepared for them, by event key. */
  preps: Record<string, LinkedText>
}

/** Words of the Segretario that stay, with what their short names stand for. */
export interface LinkedText {
  text: string
  links: HandleLink[]
}

/* ──────────────────────────────── writing ──────────────────────────────── */

/** A message about to be sent, for the Segretario to reread. */
export interface ReviewRequest {
  /** Names the request, for the user to stop it — and send at once (`stopAsking`). */
  requestId: string
  accountId: string
  to: string[]
  cc: string[]
  subject: string
  writtenText: string
  attachments: string[]
  replyTo: MessageRef | null
}

/** A search asked in words, as it was run: the list it makes. */
export interface AskedMail {
  id: string
  question: string
  summary: string
  how: string
  count: number
}

/** A search asked in words that the user kept as a folder. */
export interface SavedSearch {
  id: string
  question: string
  summary: string
  how: string
}

/** The user's work changed: the views showing these refresh. */
export interface WorkChange {
  accountIds: string[]
  threadIds: string[]
  messageKeys: string[]
  projectIds: string[]
}

/* ──────────────────────────────── memory ──────────────────────────────── */

export interface MemoryNote {
  path: string
  content: string
  updatedAt: number
  revision: number
  /** Who wrote it last: the user, or the Segretario. */
  updatedBy: 'utente' | 'segretario'
}

export interface MemoryVersion {
  revision: number
  content: string | null
  action: string
  actor: string
  at: number
}

/* ──────────────────────────────── the guided setup ──────────────────────────────── */

/**
 * Why the guided setup runs: the first launch; connections added; the AI
 * turned on for the first time, or again; Conoscimi done again.
 */
export type OnboardingCase =
  'primo-avvio' | 'nuova-connessione' | 'ai-prima-volta' | 'ai-riaccesa' | 'conoscimi'

/** Its steps, in their order: not every case has every one. */
export type OnboardingStep =
  'lingua' | 'connessioni' | 'segretario' | 'preparazione' | 'conoscimi' | 'lettura' | 'entra'

/**
 * The guided setup under way, kept so that a quit in the middle of it
 * brings the user back to the same step.
 */
export interface OnboardingState {
  case: OnboardingCase
  step: OnboardingStep
  /** The connections it is for: the new ones, or every one; empty until there are. */
  accountIds: string[]
  /** The Conoscimi run of this setup, once started. */
  conoscimiId: string | null
  startedAt: number
  /**
   * The AI was turned on in this setup — its own case, or a new connection
   * added with the AI off and turned on along the way: everything then
   * waits for Conoscimi and the reading.
   */
  turnsAiOn?: boolean
}

/** Whether a setup is the one that turns the AI on: everything waits for it. */
export function setupTurnsAiOn(state: OnboardingState): boolean {
  return state.case === 'primo-avvio' ||
    state.case === 'ai-prima-volta' ||
    state.case === 'ai-riaccesa'
    ? true
    : state.turnsAiOn === true
}

/**
 * The mailboxes a setup's reading is of: a connection added with the AI
 * already on, its own; any other, every one (undefined).
 */
export function setupReadingAccountIds(state: OnboardingState): string[] | undefined {
  return state.case === 'nuova-connessione' && !setupTurnsAiOn(state) && state.accountIds.length > 0
    ? state.accountIds
    : undefined
}

/**
 * How far back a connection is read one by one — each message, each event
 * looked at — so the work starts with what is still alive: decided by the
 * Segretario for each connection when it gets to know it (Conoscimi), or by
 * the user in chat. Without a decision, `default`; never under `min`, so the work starts full.
 */
export const READING_DAYS = { default: 30, min: 14 } as const

/** How far back a connection is read, as decided — for the setup's reading step. */
export interface ConnectionReading {
  /** The connection as Conoscimi records it (see `ConnectionLearning`). */
  key: string
  kind: 'posta' | 'calendario'
  /** Its address, or a calendar connection's name. */
  label: string
  /** How far back it is read; a calendar holds this many days back, and a year ahead (`CALENDAR_HELD_DAYS`). */
  days: number
  /** Why, in the Segretario's words; null when it is the default — and for a calendar, which has no horizon. */
  reason: string | null
}

/** Whether a connection's recent mail is in, read by the index: what the Segretario needs to start. */
export interface ConnectionReadiness {
  accountId: string
  recentMailIndexed: boolean
}

/**
 * Where the reading of each connection's horizon stands, for the setup to
 * wait on it: the mail message by message, the calendars' events.
 */
export interface ReadingStatus {
  read: number
  total: number
  /** Conversations waiting or being read. */
  waiting: number
  running: number
  /** Conversations it could not read after its attempts: listed, retried later. */
  failed: Array<{ title: string; error: string | null }>
  /** The events of the calendars, looked at and to look at. */
  events: { looked: number; total: number }
  /** How far back each connection is read, and why. */
  horizons: ConnectionReading[]
  /** Older mail of the horizon is still being downloaded: it is read as it comes. */
  downloading: boolean
  /** Nothing left to read or look at but what failed. */
  done: boolean
}

/** Whether the Segretario knows a connection — a mailbox or a calendar — from Conoscimi. */
export interface ConnectionLearning {
  /** The connection as Conoscimi records it: a mailbox's id, or `calendarLearningKey(id)`. */
  key: string
  kind: 'posta' | 'calendario'
  /** Its address, or a calendar's name. */
  label: string
  state: 'waiting' | 'running' | 'done'
  activityId: string | null
  finishedAt: number | null
}

/** A calendar connection as Conoscimi records it: apart from the mailboxes, whose ids it may share. */
export function calendarLearningKey(connectionId: string): string {
  return `calendario:${connectionId}`
}

/* ──────────────────────────────── runs ──────────────────────────────── */

/**
 * The moments the Segretario is woken in: one identity, many runs. Each is
 * a goal (`prompts/compiti/<task>.md`), the data it starts from, what it may
 * do without asking, and what it must leave.
 */
export type TaskKind =
  | 'richiesta'
  | 'lettura'
  | 'giornata'
  | 'punto'
  | 'calendario'
  | 'revisione'
  | 'ricerca'
  | 'conoscimi'
  | 'riflessione'
  | 'al_passo'

/** What a task is called for the user. */
export const TASK_LABELS = defineMessages({
  richiesta: { en: 'Request', it: 'Richiesta', de: 'Anfrage' },
  lettura: { en: 'Reading the mail', it: 'Lettura della posta', de: 'E-Mails lesen' },
  giornata: { en: 'The day', it: 'La giornata', de: 'Der Tag' },
  punto: {
    en: 'Where a project stands',
    it: 'Il punto di un progetto',
    de: 'Stand eines Projekts'
  },
  calendario: PLACES.calendar,
  revisione: { en: 'Review', it: 'Revisione', de: 'Überprüfung' },
  ricerca: { en: 'Search in words', it: 'Ricerca in parole', de: 'Suche in Worten' },
  conoscimi: PLACES.conoscimi,
  riflessione: { en: 'Reflection', it: 'Riflessione', de: 'Reflexion' },
  al_passo: PLACES.alPasso
}) satisfies Record<TaskKind, unknown>

export type ActivityStatus = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'

/** Where a run shows: the panel (the user's requests, Conoscimi), the diary (work on its own), nowhere (inline help). */
export type ActivityVisibility = 'pannello' | 'diario' | 'nascosta'

export interface ActivitySummary {
  id: string
  task: TaskKind
  title: string
  status: ActivityStatus
  createdAt: number
  updatedAt: number
  unseen: boolean
  cost: number
  visibility: ActivityVisibility
}

/** What the user is looking at when they write: the Segretario reads it as context. */
export interface SegretarioContext {
  messages: MessageRef[]
  accountId: string | null
  /** The folder, view, project or page in sight: "Posta in arrivo", "Progetto Casa al mare", "Oggi". */
  folderLabel: string | null
  /** The calendar's event open in front of the user, by its key. */
  eventKey?: string | null
  /** The message the user is writing, in front of them (vision §6.6). */
  composing?: ComposingContext | null
}

/** A message being written, as the Segretario sees it from the panel beside it. */
export interface ComposingContext {
  /** Its draft: the one `scrivi_bozza` writes in, in place (`bozza`). */
  draftId: string
  accountId: string
  kind: 'new' | 'reply' | 'forward'
  to: string[]
  cc: string[]
  subject: string
  /** What is written so far, between the letterhead and the signature, as plain text. */
  writtenText: string
  /** What the signature below it says — a closing included — as plain text: not to be written again. */
  signatureText: string
  /** The passage selected in it, if any: what "this" may mean. */
  selectedText: string | null
  /** The message a reply or forward is about. */
  replyTo: MessageRef | null
}

/** A step a tool took, as the user sees it: one line, and what it touched. */
export interface ToolActivity {
  callId: string
  name: string
  status: 'running' | 'done' | 'error'
  summary: string
  messages?: MessageRef[]
  files?: string[]
}

/** Something the Segretario wants the user to confirm before it happens. */
export interface ApprovalRequest {
  approvalId: string
  kind: 'send' | 'action'
  title: string
  status: 'pending' | 'approved' | 'rejected'
  details?: string[]
  confirmLabel?: string
  draft?: {
    draftId: string
    accountId: string
    to: string[]
    cc: string[]
    subject: string
    text: string
    attachments: string[]
  }
}

/** What a short name the Segretario writes stands for, for the page to make a link of. */
export type HandleLink =
  /** `ref` is where the message was when named; `messageKey` finds it wherever it is now. */
  | { handle: string; kind: 'message'; ref: MessageRef; messageKey?: string }
  | {
      handle: string
      kind: 'file'
      fileName: string
      path?: string
      ref?: MessageRef
      attachmentId?: string
    }
  | { handle: string; kind: 'draft'; draftId: string }
  | { handle: string; kind: 'project'; projectId: string; title: string }
  | { handle: string; kind: 'event'; eventKey: string; title: string }
  /** An open thing, by its number: it opens on the message it comes from. */
  | { handle: string; kind: 'commitment'; commitmentId: number }

/** A change a run made to the user's work, as its page of the diary shows it. */
export interface WorkChangeLine {
  object:
    | 'nota'
    | 'impegno'
    | 'progetto'
    | 'risposta'
    | 'proposta'
    | 'copia'
    | 'evento'
    | 'giornata'
    | 'calendario'
  label: string
  undoable: boolean
  /** The user undid it. */
  undone: boolean
  accountId: string | null
  messageKeys: string[]
  projectIds: string[]
}

/** What the page shows of an activity, in order. */
export type ActivityEntry =
  | {
      kind: 'user'
      id: number
      text: string
      context?: SegretarioContext
      /** Set when the Segretario began the work on its own: what it set out to do. */
      origin?: 'segretario'
      at: number
      handles: HandleLink[]
    }
  | { kind: 'assistant'; id: number; text: string; at: number }
  | { kind: 'tool'; id: number; tool: ToolActivity; at: number; handles: HandleLink[] }
  | { kind: 'approval'; id: number; approval: ApprovalRequest; at: number }
  | { kind: 'changes'; id: number; changes: WorkChangeLine[]; at: number }
  | { kind: 'compaction'; id: number; at: number }
  | { kind: 'error'; id: number; message: string; at: number }

export interface ActivityDetail extends ActivitySummary {
  entries: ActivityEntry[]
}

/** What changes in an activity, as it happens. */
export type ActivityEvent =
  | { type: 'summary'; activity: ActivitySummary }
  | { type: 'entry'; activityId: string; entry: ActivityEntry }
  | { type: 'stream'; activityId: string; text: string }
  | { type: 'removed'; activityId: string }

/* ────────────────────────── the page's part of the work ────────────────────────── */

/** A message the Segretario writes for the user, handed to the page to open as a draft. */
export interface ComposeSpec {
  /** What a new draft is; absent when writing in one that exists (`draftId`). */
  kind?: 'reply' | 'replyAll' | 'forward' | 'new'
  source?: MessageRef
  accountId?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  text: string
  attachments?: Array<{ path: string; name: string }>
  draftId?: string
  /**
   * `text` takes the place of the passage the user had selected in the
   * message being written when they wrote to the Segretario — that passage
   * alone, the rest as it is.
   */
  selection?: boolean
}

export type ComposeResult = { draftId: string } | { error: string }

/** What the Segretario wants the user to see, in the main window. */
export type ShowRequest =
  | { kind: 'message'; ref: MessageRef }
  | { kind: 'draft'; draftId: string }
  /** A search it ran, kept for the session: the list to open. */
  | { kind: 'search'; search: AskedMail }
  | { kind: 'project'; projectId: string }
  | { kind: 'event'; eventKey: string }
  | { kind: 'day'; day: string }

/** How a send the user confirmed went: gone, waiting in the outbox for its server (`queued`), or not. */
export type SendOutcome = { sent: true; queued: boolean } | { sent: false; error: string }

/* ───────────────────────────────── IPC ───────────────────────────────── */

export const SEGRETARIO_IPC = {
  getStatus: 'segretario:get-status',
  saveKey: 'segretario:save-key',
  removeKey: 'segretario:remove-key',
  forgetAll: 'segretario:forget-all',
  keepsAnything: 'segretario:keeps-anything',
  checkKey: 'segretario:check-key',
  getNotice: 'segretario:get-notice',
  dismissNotice: 'segretario:dismiss-notice',
  getPreferences: 'segretario:get-preferences',
  setPreferences: 'segretario:set-preferences',
  getSpending: 'segretario:get-spending',
  getEngineState: 'segretario:get-engine-state',
  retryReading: 'segretario:retry-reading',
  listMemory: 'segretario:list-memory',
  writeMemory: 'segretario:write-memory',
  memoryHistory: 'segretario:memory-history',
  restoreMemory: 'segretario:restore-memory',
  listLearning: 'segretario:list-learning',
  startConoscimi: 'segretario:start-conoscimi',
  getOnboarding: 'segretario:get-onboarding',
  setOnboarding: 'segretario:set-onboarding',
  connectionReadiness: 'segretario:connection-readiness',
  getReadingStatus: 'segretario:get-reading-status',
  setPreparing: 'segretario:set-preparing',
  draftSent: 'segretario:draft-sent',
  getRowWork: 'segretario:get-row-work',
  selectionWork: 'segretario:selection-work',
  getMessageWork: 'segretario:get-message-work',
  setCommitmentStatus: 'segretario:set-commitment-status',
  editCommitment: 'segretario:edit-commitment',
  undoCommitmentStatus: 'segretario:undo-commitment-status',
  openCommitment: 'segretario:open-commitment',
  markHandled: 'segretario:mark-handled',
  undoChange: 'segretario:undo-change',
  replySource: 'segretario:reply-source',
  takeUpReply: 'segretario:take-up-reply',
  discardReply: 'segretario:discard-reply',
  decideProposal: 'segretario:decide-proposal',
  listProposals: 'segretario:list-proposals',
  eventPrep: 'segretario:event-prep',
  eventWork: 'segretario:event-work',
  setEventYours: 'segretario:set-event-yours',
  commitmentSource: 'segretario:commitment-source',
  getToday: 'segretario:get-today',
  refreshToday: 'segretario:refresh-today',
  getDue: 'segretario:get-due',
  reviewDraft: 'segretario:review-draft',
  askMail: 'segretario:ask-mail',
  stopAsking: 'segretario:stop-asking',
  listSavedSearches: 'segretario:list-saved-searches',
  saveSearch: 'segretario:save-search',
  removeSavedSearch: 'segretario:remove-saved-search',
  listProjects: 'segretario:list-projects',
  getProject: 'segretario:get-project',
  refreshProject: 'segretario:refresh-project',
  createProject: 'segretario:create-project',
  updateProject: 'segretario:update-project',
  mergeProjects: 'segretario:merge-projects',
  setConversationProject: 'segretario:set-conversation-project',
  conversationProjects: 'segretario:conversation-projects',
  openProjectFolder: 'segretario:open-project-folder',
  workChanged: 'segretario:work-changed',
  engineChanged: 'segretario:engine-changed',
  listActivities: 'segretario:list-activities',
  getActivity: 'segretario:get-activity',
  startActivity: 'segretario:start-activity',
  sendMessage: 'segretario:send-message',
  retryActivity: 'segretario:retry-activity',
  cancelActivity: 'segretario:cancel-activity',
  removeActivity: 'segretario:remove-activity',
  markActivitySeen: 'segretario:mark-activity-seen',
  resolveApproval: 'segretario:resolve-approval',
  completeCompose: 'segretario:complete-compose',
  statusChanged: 'segretario:status-changed',
  preferencesChanged: 'segretario:preferences-changed',
  notice: 'segretario:notice',
  activityEvent: 'segretario:activity-event',
  composeRequest: 'segretario:compose-request',
  showRequest: 'segretario:show-request'
} as const

export interface SegretarioApi {
  getStatus: () => Promise<SegretarioStatus>
  /** Checks a key with OpenRouter and, if it answers, keeps it encrypted. */
  saveKey: (key: string) => Promise<SegretarioStatus>
  removeKey: () => Promise<SegretarioStatus>
  /** As if the AI had never been on (vision §12.1): all the Segretario kept goes, the key too. */
  forgetAll: () => Promise<void>
  /** Whether it keeps anything «Dimentica tutto» would take. */
  keepsAnything: () => Promise<boolean>
  checkKey: () => Promise<SegretarioStatus>
  /** What SIEVER Mail has to tell the user about the AI and they have not seen, or null. */
  getNotice: () => Promise<SegretarioNotice | null>
  /** The user saw it. */
  dismissNotice: () => Promise<void>
  getPreferences: () => Promise<SegretarioPreferences>
  setPreferences: (preferences: SegretarioPreferences) => Promise<SegretarioPreferences>
  getSpending: () => Promise<SegretarioSpending>
  getEngineState: () => Promise<EngineState>
  /** The setup's "Riprova", at the end of the reading: what failed of it, and only that. */
  retryReading: (accountIds?: string[]) => Promise<void>
  listMemory: () => Promise<MemoryNote[]>
  /** Writes a note as the user corrected it; `seenRevision`, the version they opened: changed since, the write is refused. */
  writeMemory: (path: string, content: string, seenRevision?: number) => Promise<MemoryNote[]>
  memoryHistory: (path: string) => Promise<MemoryVersion[]>
  restoreMemory: (path: string, revision: number) => Promise<MemoryNote[]>
  listLearning: () => Promise<ConnectionLearning[]>
  /**
   * Starts Conoscimi on these connections (`ConnectionLearning.key`; all when
   * none are named): the Segretario gets to know them, building on what it
   * knows. Resolves with the run, which the page shows as it goes.
   */
  startConoscimi: (keys?: string[]) => Promise<ActivitySummary>
  /** The guided setup under way, or null. */
  getOnboarding: () => Promise<OnboardingState | null>
  /** Keeps where the guided setup is, or — null — that it is over. */
  setOnboarding: (state: OnboardingState | null) => Promise<void>
  connectionReadiness: (accountIds: string[]) => Promise<ConnectionReadiness[]>
  /** Of these accounts — the connections a setup adds — or of all. */
  getReadingStatus: (accountIds?: string[]) => Promise<ReadingStatus>
  /** The first reading is prepared with the user waiting: more of it at once. */
  setPreparing: (preparing: boolean) => Promise<void>
  /** A draft went out: what the user wrote in it, to learn from when the Segretario had written it. */
  draftSent: (draftId: string, writtenText: string) => Promise<void>
  /** What the rows of these messages show: the note, what is owed or awaited, the reply. */
  getRowWork: (
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ) => Promise<MessageRowWork[]>
  getMessageWork: (accountId: string, messageKey: string) => Promise<MessageWork>
  /** For an extension's action on the messages selected: their projects' folders, the proposals on them. */
  selectionWork: (
    messages: ReadonlyArray<{ accountId: string; messageKey: string; threadId: string }>
  ) => Promise<SelectionWork>
  /** Done, not needed, put off until a day, or open again. */
  setCommitmentStatus: (
    id: number,
    status: CommitmentStatus,
    options?: { until?: string; reason?: string }
  ) => Promise<Commitment>
  /** Takes back the user's last tick (or setting aside, or putting off) of an open thing. */
  undoCommitmentStatus: (id: number) => Promise<Commitment>
  /** The user corrects what a commitment says. */
  editCommitment: (
    id: number,
    changes: { text?: string; due?: string | null; kind?: CommitmentKind }
  ) => Promise<Commitment>
  /** The user opens a commitment: from a message, from an event, or of their own. */
  openCommitment: (
    from:
      | { kind: 'message'; accountId: string; messageKey: string }
      | { kind: 'event'; eventKey: string }
      | { kind: 'user' },
    input: { kind: CommitmentKind; text: string; due: string | null }
  ) => Promise<Commitment>
  /** "Segna come gestito": what these messages ask of the user is done; what they wait for stays. */
  markHandled: (
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ) => Promise<number>
  /** Undoes a change a run made: its page of the diary, the change's place on it. */
  undoChange: (activityId: string, eventId: number, index: number) => Promise<void>
  replySource: (accountId: string, messageKey: string) => Promise<MessageRef | null>
  /** The user took a prepared reply up: it became draft `draftId`, and is learnt from like the others. */
  takeUpReply: (accountId: string, messageKey: string, draftId: string) => Promise<void>
  discardReply: (accountId: string, messageKey: string) => Promise<void>
  /** The proposals waiting for the user, the newest first: events among them show in the calendar. */
  listProposals: () => Promise<Proposal[]>
  /** How to prepare for an event, as the Segretario wrote it, and when; null when it has not. */
  eventPrep: (eventKey: string) => Promise<(LinkedText & { writtenAt: number }) | null>
  /** What the work holds of an event, as the reader shows it of a message: its open things and its projects. */
  eventWork: (eventKey: string) => Promise<EventWork>
  /** The user says whose an event is (§7.4): their word stands, and puts the Segretario right. */
  setEventYours: (eventKey: string, yours: boolean) => Promise<void>
  /**
   * Where an open thing comes from, to open it: its message where it is now,
   * its event, the user's word (with its project); null when its message or
   * event is gone.
   */
  commitmentSource: (
    id: number
  ) => Promise<
    | { kind: 'message'; ref: MessageRef }
    | { kind: 'event'; eventKey: string }
    | { kind: 'user'; projectId?: string }
    | null
  >
  /**
   * The user accepted a proposal — with what they changed — or set it aside;
   * `revision` is the version shown: one changed since is refused.
   */
  decideProposal: (
    id: string,
    accepted: boolean,
    result?: Record<string, unknown>,
    revision?: number
  ) => Promise<void>
  getToday: () => Promise<TodayPage>
  /** Asks the Segretario to look at the day again now. */
  refreshToday: () => Promise<void>
  /** What is due from today through a day: the calendar's deadlines. */
  getDue: (throughDay: string) => Promise<DayLine[]>
  reviewDraft: (request: ReviewRequest) => Promise<string[]>
  askMail: (question: string, requestId: string) => Promise<AskedMail>
  /** Stops a request the user waits for: the writing, the reread, the search in words. */
  stopAsking: (requestId: string) => Promise<void>
  listSavedSearches: () => Promise<SavedSearch[]>
  saveSearch: (id: string) => Promise<SavedSearch[]>
  removeSavedSearch: (id: string) => Promise<SavedSearch[]>
  listProjects: (options?: { includeHidden?: boolean }) => Promise<Project[]>
  getProject: (id: string) => Promise<ProjectDetail | null>
  /** "Il punto" is behind: the Segretario writes it again, now. */
  refreshProject: (id: string) => Promise<void>
  createProject: (title: string) => Promise<Project>
  /** Renames, hides or brings back, closes or reopens a project: the user's word, kept. */
  updateProject: (
    id: string,
    change: { title?: string; hidden?: boolean; closed?: boolean }
  ) => Promise<Project | null>
  mergeProjects: (keepId: string, otherIds: string[]) => Promise<Project | null>
  /** Puts a conversation in a project, or takes it out of one: the user's word, kept. */
  setConversationProject: (
    thread: { accountId: string; threadId: string },
    projectId: string,
    linked: boolean
  ) => Promise<void>
  /** The projects each conversation is in, in the order asked. */
  conversationProjects: (
    threads: ReadonlyArray<{ accountId: string; threadId: string }>
  ) => Promise<ProjectLabel[][]>
  openProjectFolder: (id: string) => Promise<void>
  onWorkChanged: (listener: (change: WorkChange) => void) => () => void
  onEngineChanged: (listener: (state: EngineState) => void) => () => void
  /** The panel's activities: the user's requests and Conoscimi; with `diary`, the work done alone too. */
  listActivities: (options?: { diary?: boolean }) => Promise<ActivitySummary[]>
  getActivity: (id: string) => Promise<ActivityDetail | null>
  startActivity: (text: string, context: SegretarioContext) => Promise<ActivitySummary>
  sendMessage: (id: string, text: string, context: SegretarioContext) => Promise<void>
  /** A request in the panel that stopped short (§14.2), taken up again from where it was. */
  retryActivity: (id: string) => Promise<void>
  cancelActivity: (id: string) => Promise<void>
  removeActivity: (id: string) => Promise<void>
  markActivitySeen: (id: string) => Promise<void>
  resolveApproval: (
    activityId: string,
    approvalId: string,
    approved: boolean,
    outcome?: SendOutcome
  ) => Promise<void>
  completeCompose: (requestId: string, result: ComposeResult) => Promise<void>
  onStatusChanged: (listener: (status: SegretarioStatus) => void) => () => void
  /** The AI was switched on or off, here or in another window. */
  onPreferencesChanged: (listener: (preferences: SegretarioPreferences) => void) => () => void
  onNotice: (listener: (notice: SegretarioNotice | null) => void) => () => void
  onActivityEvent: (listener: (event: ActivityEvent) => void) => () => void
  onComposeRequest: (
    listener: (request: { requestId: string; spec: ComposeSpec }) => void
  ) => () => void
  onShowRequest: (listener: (request: ShowRequest) => void) => () => void
}
