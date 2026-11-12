import type { CalendarRole } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

import type { CommitmentKind, CommitmentStatus, ReplyKind, ReplyStatus } from './types'

const KIND_EN: Record<CommitmentKind, string> = {
  ti_chiedono: 'asked of you',
  hai_promesso: 'you promised',
  aspetti: 'you’re waiting',
  da_fare: 'to do'
}
const KIND_IT: Record<CommitmentKind, string> = {
  ti_chiedono: 'ti chiedono',
  hai_promesso: 'hai promesso',
  aspetti: 'aspetti',
  da_fare: 'da fare'
}
const KIND_DE: Record<CommitmentKind, string> = {
  ti_chiedono: 'an Sie gerichtet',
  hai_promesso: 'von Ihnen zugesagt',
  aspetti: 'Sie warten',
  da_fare: 'zu tun'
}

const STATUS_EN: Record<CommitmentStatus, string> = {
  aperta: 'Reopened',
  fatta: 'Done',
  non_serve: 'Not needed',
  rinviata: 'Postponed'
}
const STATUS_IT: Record<CommitmentStatus, string> = {
  aperta: 'Riaperta',
  fatta: 'Fatta',
  non_serve: 'Non serve',
  rinviata: 'Rinviata'
}
const STATUS_DE: Record<CommitmentStatus, string> = {
  aperta: 'Wieder geöffnet',
  fatta: 'Erledigt',
  non_serve: 'Nicht nötig',
  rinviata: 'Verschoben'
}

const ROLE_EN: Record<CalendarRole, string> = {
  tutti: 'all events are yours',
  propri: 'only your events',
  nessuno: 'no event is yours'
}
const ROLE_IT: Record<CalendarRole, string> = {
  tutti: 'tutti gli eventi sono tuoi',
  propri: 'solo i tuoi eventi',
  nessuno: 'nessun evento è tuo'
}
const ROLE_DE: Record<CalendarRole, string> = {
  tutti: 'alle Termine gehören Ihnen',
  propri: 'nur Ihre Termine',
  nessuno: 'kein Termin gehört Ihnen'
}

/** A reply's status set, as the diary says it; `da_rivedere` takes its reason. */
type ReplyStatusSet = Exclude<ReplyStatus, 'da_rivedere'>

/**
 * The registry's lines for the diary (vision §13.5): what each change did,
 * in the interface's language when it happened — the step lines and the
 * diary's page of a run show them, and the user's undo goes by them.
 */
export const MESSAGES = defineMessages({
  noteWritten: {
    en: (summary: string) => `Note: ${summary}`,
    it: (summary: string) => `Nota: ${summary}`,
    de: (summary: string) => `Notiz: ${summary}`
  },
  noteCorrected: {
    en: (summary: string) => `Note corrected: ${summary}`,
    it: (summary: string) => `Nota corretta: ${summary}`,
    de: (summary: string) => `Notiz korrigiert: ${summary}`
  },
  opened: {
    en: (kind: CommitmentKind, text: string) => `Opened (${KIND_EN[kind]}): ${text}`,
    it: (kind: CommitmentKind, text: string) => `Aperta (${KIND_IT[kind]}): ${text}`,
    de: (kind: CommitmentKind, text: string) => `Geöffnet (${KIND_DE[kind]}): ${text}`
  },
  refined: {
    en: (text: string, due: string | null) => `Refined: ${text}${due ? ` (by ${due})` : ''}`,
    it: (text: string, due: string | null) =>
      `Precisata: ${text}${due ? ` (entro il ${due})` : ''}`,
    de: (text: string, due: string | null) => `Präzisiert: ${text}${due ? ` (bis ${due})` : ''}`
  },
  /** `status` null: it was so already, and is still open. */
  status: {
    en: (status: CommitmentStatus | null, until: string | null, text: string) =>
      `${status === null ? 'Still open' : STATUS_EN[status]}${until ? ` until ${until}` : ''}: ${text}`,
    it: (status: CommitmentStatus | null, until: string | null, text: string) =>
      `${status === null ? 'Ancora aperta' : STATUS_IT[status]}${until ? ` fino al ${until}` : ''}: ${text}`,
    de: (status: CommitmentStatus | null, until: string | null, text: string) =>
      `${status === null ? 'Weiterhin offen' : STATUS_DE[status]}${until ? ` bis ${until}` : ''}: ${text}`
  },
  mergedInto: {
    en: (keepId: number, text: string) => `Merged into #${keepId}: ${text}`,
    it: (keepId: number, text: string) => `Unita a #${keepId}: ${text}`,
    de: (keepId: number, text: string) => `Mit #${keepId} zusammengeführt: ${text}`
  },
  undone: {
    en: (text: string) => `Undone: ${text}`,
    it: (text: string) => `Annullato: ${text}`,
    de: (text: string) => `Rückgängig gemacht: ${text}`
  },
  openAgain: {
    en: (text: string) => `Open again: ${text}`,
    it: (text: string) => `Di nuovo aperta: ${text}`,
    de: (text: string) => `Wieder offen: ${text}`
  },
  projectCreated: {
    en: (title: string) => `New project: ${title}`,
    it: (title: string) => `Nuovo progetto: ${title}`,
    de: (title: string) => `Neues Projekt: ${title}`
  },
  projectRemoved: {
    en: (title: string) => `Removed the project: ${title}`,
    it: (title: string) => `Tolto il progetto: ${title}`,
    de: (title: string) => `Projekt entfernt: ${title}`
  },
  projectRenamed: {
    en: (before: string, after: string) => `Project renamed: ${before} → ${after}`,
    it: (before: string, after: string) => `Progetto rinominato: ${before} → ${after}`,
    de: (before: string, after: string) => `Projekt umbenannt: ${before} → ${after}`
  },
  projectDescribed: {
    en: (title: string) => `What it is about: ${title}`,
    it: (title: string) => `Di cosa si tratta: ${title}`,
    de: (title: string) => `Worum es geht: ${title}`
  },
  projectState: {
    en: (title: string) => `Where it stands, updated: ${title}`,
    it: (title: string) => `Il punto aggiornato: ${title}`,
    de: (title: string) => `Stand der Dinge aktualisiert: ${title}`
  },
  projectHidden: {
    en: (title: string) => `Hidden: ${title}`,
    it: (title: string) => `Nascosto: ${title}`,
    de: (title: string) => `Ausgeblendet: ${title}`
  },
  projectShown: {
    en: (title: string) => `Visible again: ${title}`,
    it: (title: string) => `Di nuovo visibile: ${title}`,
    de: (title: string) => `Wieder sichtbar: ${title}`
  },
  projectClosed: {
    en: (title: string) => `Concluded: ${title}`,
    it: (title: string) => `Concluso: ${title}`,
    de: (title: string) => `Abgeschlossen: ${title}`
  },
  projectReopened: {
    en: (title: string) => `Reopened: ${title}`,
    it: (title: string) => `Riaperto: ${title}`,
    de: (title: string) => `Wieder geöffnet: ${title}`
  },
  projectsMerged: {
    en: (title: string, merged: string) => `Merged into ${title}: ${merged}`,
    it: (title: string, merged: string) => `Uniti in ${title}: ${merged}`,
    de: (title: string, merged: string) => `In ${title} zusammengeführt: ${merged}`
  },
  threadLinked: {
    en: (project: string | null) => `Conversation in ${project ?? 'a project'}`,
    it: (project: string | null) => `Conversazione in ${project ?? 'un progetto'}`,
    de: (project: string | null) => `Unterhaltung in ${project ?? 'einem Projekt'}`
  },
  threadUnlinked: {
    en: (project: string | null) => `Conversation removed from ${project ?? 'a project'}`,
    it: (project: string | null) => `Conversazione tolta da ${project ?? 'un progetto'}`,
    de: (project: string | null) => `Unterhaltung aus ${project ?? 'einem Projekt'} entfernt`
  },
  resourceLinked: {
    en: (project: string | null, resource: string) =>
      `Linked to ${project ?? 'a project'}: ${resource}`,
    it: (project: string | null, resource: string) =>
      `Collegata a ${project ?? 'un progetto'}: ${resource}`,
    de: (project: string | null, resource: string) =>
      `Mit ${project ?? 'einem Projekt'} verknüpft: ${resource}`
  },
  resourceRemoved: {
    en: (resource: string) => `Removed: ${resource}`,
    it: (resource: string) => `Tolta: ${resource}`,
    de: (resource: string) => `Entfernt: ${resource}`
  },
  replySaved: {
    en: (kind: ReplyKind, created: boolean) =>
      `${kind === 'sollecito' ? 'Follow-up' : 'Reply'} ${created ? 'prepared' : 'rewritten'}`,
    it: (kind: ReplyKind, created: boolean) =>
      kind === 'sollecito'
        ? `Sollecito ${created ? 'preparato' : 'riscritto'}`
        : `Risposta ${created ? 'preparata' : 'riscritta'}`,
    de: (kind: ReplyKind, created: boolean) =>
      `${kind === 'sollecito' ? 'Nachfassen' : 'Antwort'} ${created ? 'vorbereitet' : 'neu geschrieben'}`
  },
  replyStatus: {
    en: (status: ReplyStatusSet) =>
      ({
        pronta: 'Reply confirmed',
        scartata: 'Reply discarded',
        usata: 'Reply used',
        superata: 'Reply superseded'
      })[status],
    it: (status: ReplyStatusSet) =>
      ({
        pronta: 'Risposta confermata',
        scartata: 'Risposta scartata',
        usata: 'Risposta usata',
        superata: 'Risposta superata'
      })[status],
    de: (status: ReplyStatusSet) =>
      ({
        pronta: 'Antwort bestätigt',
        scartata: 'Antwort verworfen',
        usata: 'Antwort verwendet',
        superata: 'Antwort überholt'
      })[status]
  },
  replyToReview: {
    en: (reason: string | null) => `Reply to review${reason ? `: ${reason}` : ''}`,
    it: (reason: string | null) => `Risposta da rivedere${reason ? `: ${reason}` : ''}`,
    de: (reason: string | null) => `Antwort zu überprüfen${reason ? `: ${reason}` : ''}`
  },
  repliesToReview: {
    en: (reason: string) => `To review: ${reason}`,
    it: (reason: string) => `Da rivedere: ${reason}`,
    de: (reason: string) => `Zu überprüfen: ${reason}`
  },
  proposed: {
    en: (title: string) => `Proposal: ${title}`,
    it: (title: string) => `Proposta: ${title}`,
    de: (title: string) => `Vorschlag: ${title}`
  },
  withdrawn: {
    en: (title: string, reason: string) => `Withdrawn: ${title} (${reason})`,
    it: (title: string, reason: string) => `Ritirata: ${title} (${reason})`,
    de: (title: string, reason: string) => `Zurückgezogen: ${title} (${reason})`
  },
  accepted: {
    en: (title: string) => `Accepted: ${title}`,
    it: (title: string) => `Accettata: ${title}`,
    de: (title: string) => `Angenommen: ${title}`
  },
  discarded: {
    en: (title: string) => `Discarded: ${title}`,
    it: (title: string) => `Scartata: ${title}`,
    de: (title: string) => `Verworfen: ${title}`
  },
  letterWritten: {
    en: 'Wrote today’s letter',
    it: 'Scritta la lettera di oggi',
    de: 'Heutigen Brief geschrieben'
  },
  meetingPrepared: {
    en: (title: string) => `Prepared the meeting: ${title}`,
    it: (title: string) => `Preparata la riunione: ${title}`,
    de: (title: string) => `Meeting vorbereitet: ${title}`
  },
  calendarRole: {
    en: (calendar: string, role: CalendarRole) => `${calendar}: ${ROLE_EN[role]}`,
    it: (calendar: string, role: CalendarRole) => `${calendar}: ${ROLE_IT[role]}`,
    de: (calendar: string, role: CalendarRole) => `${calendar}: ${ROLE_DE[role]}`
  },
  eventMarked: {
    en: (yours: boolean, title: string) => `${yours ? 'Yours' : 'Not yours'}: ${title}`,
    it: (yours: boolean, title: string) => `${yours ? 'Tuo' : 'Non tuo'}: ${title}`,
    de: (yours: boolean, title: string) => `${yours ? 'Ihr Termin' : 'Nicht Ihr Termin'}: ${title}`
  },
  /** The user's words on a thing, given or taken back, and taken in by the Segretario (§10.1). */
  wordsGiven: {
    en: (correction: boolean): string => (correction ? 'To be corrected' : 'Answered'),
    it: (correction: boolean): string => (correction ? 'Da correggere' : 'Risposta data'),
    de: (correction: boolean): string => (correction ? 'Zu korrigieren' : 'Beantwortet')
  },
  wordsWithdrawn: {
    en: 'Words taken back',
    it: 'Parole ritirate',
    de: 'Worte zurückgenommen'
  },
  wordsTaken: {
    en: 'Words taken in',
    it: 'Parole prese in carico',
    de: 'Worte übernommen'
  },
  /** Why something open from a message deleted for good is no longer needed: kept with it, and shown. */
  messageDeleted: {
    en: 'The message it came from was deleted.',
    it: 'Il messaggio da cui nasceva è stato eliminato.',
    de: 'Die Nachricht, aus der er stammt, wurde gelöscht.'
  }
})

/**
 * Why the registry closed or opened something by itself: kept as the
 * reason, which the open item's line shows the user.
 */
export const REASONS = defineMessages({
  sameAs: {
    en: (text: string, id: number) => `It’s the same as “${text}” (#${id}).`,
    it: (text: string, id: number) => `È la stessa cosa di «${text}» (#${id}).`,
    de: (text: string, id: number) => `Das ist dasselbe wie „${text}“ (#${id}).`
  },
  dayCame: {
    en: (until: string | null) => `Postponed until ${until}: the day has come.`,
    it: (until: string | null) => `Rinviata fino al ${until}: è il giorno.`,
    de: (until: string | null) => `Verschoben bis ${until}: Der Tag ist gekommen.`
  },
  undone: { en: 'Undone.', it: 'Annullata.', de: 'Rückgängig gemacht.' }
})

/**
 * The registry's refusals, as the user reads them when their own act meets
 * one (`RegistryRefusal.shown`): the model reads its own, in Italian, which
 * the Italian interface keeps showing as it did.
 */
export const REFUSALS = defineMessages({
  /** `name`: the field, as the registry calls it — `scadenza`, the deadline, or the day it opens again. */
  notADate: {
    en: (name: string) => `${name === 'scadenza' ? 'The deadline' : 'The day'} isn’t a valid date.`,
    it: (name: string) => `${name}: una data come AAAA-MM-GG.`,
    de: (name: string) =>
      `${name === 'scadenza' ? 'Die Frist' : 'Der Tag'} ist kein gültiges Datum.`
  },
  itemNeedsText: {
    en: 'An open item needs some text.',
    it: 'Una cosa aperta ha bisogno di un testo.',
    de: 'Ein offener Punkt braucht einen Text.'
  },
  postponeNeedsDay: {
    en: 'To postpone it, it needs the day it opens again.',
    it: 'Per rinviare serve il giorno in cui torna aperta (`fino_a`).',
    de: 'Zum Verschieben braucht es den Tag, an dem er wieder offen ist.'
  },
  changedSinceUndo: {
    en: 'This item has changed again since: it can’t be put back as it was.',
    it: 'Dopo questa modifica la cosa è cambiata ancora: non la rimetto com’era.',
    de: 'Der Punkt hat sich seitdem erneut geändert: Er lässt sich nicht wiederherstellen.'
  },
  itemGone: {
    en: (id: number) => `Open item #${id} doesn’t exist.`,
    it: (id: number) => `Non esiste una cosa aperta #${id}.`,
    de: (id: number) => `Den offenen Punkt #${id} gibt es nicht.`
  },
  itemKeepsChanging: {
    en: (id: number) => `Item #${id} keeps changing: try again shortly.`,
    it: (id: number) => `La cosa #${id} cambia di continuo: riprova tra poco.`,
    de: (id: number) => `Punkt #${id} ändert sich ständig: Versuchen Sie es gleich noch einmal.`
  },
  noteKeepsChanging: {
    en: 'This message’s note keeps changing: try again shortly.',
    it: 'La nota di questo messaggio cambia di continuo: riprova tra poco.',
    de: 'Die Notiz dieser Nachricht ändert sich ständig: Versuchen Sie es gleich noch einmal.'
  },
  replyKeepsChanging: {
    en: 'The ready reply keeps changing: try again shortly.',
    it: 'La risposta preparata cambia di continuo: riprova tra poco.',
    de: 'Die fertige Antwort ändert sich ständig: Versuchen Sie es gleich noch einmal.'
  },
  pathKeepsChanging: {
    en: (path: string) => `${path} keeps changing: try again shortly.`,
    it: (path: string) => `${path} cambia di continuo: riprova tra poco.`,
    de: (path: string) => `${path} ändert sich ständig: Versuchen Sie es gleich noch einmal.`
  },
  projectNeedsName: {
    en: 'A project needs a name.',
    it: 'Un progetto ha bisogno di un nome.',
    de: 'Ein Projekt braucht einen Namen.'
  },
  projectTaken: {
    en: (title: string) =>
      `There’s already a project “${title}”: if they’re the same matter, merge them.`,
    it: (title: string) => `C'è già un progetto «${title}»: se sono la stessa questione, uniscili.`,
    de: (title: string) =>
      `Es gibt bereits ein Projekt „${title}“: Wenn es um dieselbe Sache geht, führen Sie sie zusammen.`
  },
  projectGone: {
    en: (id: string) => `Project ${id} doesn’t exist.`,
    it: (id: string) => `Non esiste un progetto ${id}.`,
    de: (id: string) => `Das Projekt ${id} gibt es nicht.`
  },
  proposalGone: {
    en: 'This proposal is no longer there.',
    it: 'Questa proposta non c’è più.',
    de: 'Dieser Vorschlag ist nicht mehr vorhanden.'
  },
  proposalDecided: {
    en: 'This proposal has already been decided.',
    it: 'Questa proposta è già stata decisa.',
    de: 'Über diesen Vorschlag wurde bereits entschieden.'
  },
  noteNeedsSummary: {
    en: 'The note needs a summary.',
    it: 'La nota ha bisogno di una sintesi.',
    de: 'Die Notiz braucht eine Zusammenfassung.'
  },
  replyEmpty: {
    en: 'The reply has no text.',
    it: 'Il testo della risposta è vuoto.',
    de: 'Die Antwort hat keinen Text.'
  },
  invalidPath: {
    en: (path: string) => `“${path}” isn’t a valid name for a note.`,
    it: (path: string) => `Percorso non valido: «${path}».`,
    de: (path: string) => `„${path}“ ist kein gültiger Name für eine Notiz.`
  },
  noteTaken: {
    en: (path: string) => `There’s already a note “${path}”.`,
    it: (path: string) => `Esiste già una nota «${path}».`,
    de: (path: string) => `Es gibt bereits eine Notiz „${path}“.`
  },
  noVersion: {
    en: (revision: number, path: string) => `Version ${revision} of ${path} can’t be found.`,
    it: (revision: number, path: string) => `Non trovo la versione ${revision} di ${path}.`,
    de: (revision: number, path: string) => `Version ${revision} von ${path} wurde nicht gefunden.`
  },
  /** What the user's words were about is no longer there: closed, rewritten away, gone with its source. */
  workGone: {
    en: 'It isn’t there any more: it may have changed in the meantime.',
    it: 'Non c’è più: forse è cambiata nel frattempo.',
    de: 'Das gibt es nicht mehr: Es hat sich wohl inzwischen geändert.'
  },
  wordsEmpty: { en: 'Write something.', it: 'Scrivi qualcosa.', de: 'Schreiben Sie etwas.' }
})
