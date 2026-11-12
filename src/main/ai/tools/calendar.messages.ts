import type { CalendarResponse } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

type Answer = Exclude<CalendarResponse, 'needsAction'>

const ANSWER_EN: Record<Answer, string> = { accepted: 'yes', tentative: 'maybe', declined: 'no' }
const ANSWER_IT: Record<Answer, string> = {
  accepted: 'partecipa',
  tentative: 'forse',
  declined: 'non partecipa'
}
const ANSWER_DE: Record<Answer, string> = {
  accepted: 'Zusage',
  tentative: 'mit Vorbehalt',
  declined: 'Absage'
}

function eventsEn(count: number): string {
  return count === 1 ? '1 event' : `${count} events`
}

function eventsIt(count: number): string {
  return count === 1 ? '1 evento' : `${count} eventi`
}

function eventsDe(count: number): string {
  return count === 1 ? '1 Termin' : `${count} Termine`
}

/**
 * What the calendar tool says to the user (vision §13.5): its step lines,
 * the confirmations it asks for, the proposals it leaves in Oggi and the
 * diary's lines of what it changed — in the interface's language.
 */
export const MESSAGES = defineMessages({
  searchingFor: {
    en: (words: string) => `Searching “${words}” in the calendar…`,
    it: (words: string) => `Cerco «${words}» nel calendario…`,
    de: (words: string) => `Suche „${words}“ im Kalender…`
  },
  searching: {
    en: 'Searching the calendar…',
    it: 'Cerco nel calendario…',
    de: 'Suche im Kalender…'
  },
  creating: {
    en: 'Adding to the calendar…',
    it: 'Metto in calendario…',
    de: 'Trage in den Kalender ein…'
  },
  editing: { en: 'Correcting the event…', it: 'Correggo l’evento…', de: 'Korrigiere den Termin…' },
  removing: { en: 'Removing the event…', it: 'Tolgo l’evento…', de: 'Entferne den Termin…' },
  answering: {
    en: 'Preparing the reply to the invitation…',
    it: 'Preparo la risposta all’invito…',
    de: 'Bereite die Antwort auf die Einladung vor…'
  },
  withdrawing: {
    en: 'Withdrawing a proposal…',
    it: 'Ritiro una proposta…',
    de: 'Ziehe einen Vorschlag zurück…'
  },
  proposing: {
    en: 'Preparing the proposal…',
    it: 'Preparo la proposta…',
    de: 'Bereite den Vorschlag vor…'
  },
  freeSlots: {
    en: 'Looking for free times…',
    it: 'Cerco gli orari liberi…',
    de: 'Suche freie Zeiten…'
  },
  looking: {
    en: 'Looking at the calendar…',
    it: 'Guardo il calendario…',
    de: 'Sehe mir den Kalender an…'
  },
  looked: {
    en: (count: number) => `Looked at the calendar · ${eventsEn(count)}`,
    it: (count: number) => `Guardato il calendario · ${eventsIt(count)}`,
    de: (count: number) => `Kalender angesehen · ${eventsDe(count)}`
  },
  searched: {
    en: (words: string, count: number) =>
      `Searched “${words}” in the calendar · ${count === 0 ? 'no events' : eventsEn(count)}`,
    it: (words: string, count: number) =>
      `Cercato «${words}» nel calendario · ${count === 0 ? 'nessun evento' : eventsIt(count)}`,
    de: (words: string, count: number) =>
      `„${words}“ im Kalender gesucht · ${count === 0 ? 'keine Termine' : eventsDe(count)}`
  },
  foundFree: {
    en: (count: number) => `Looked for free times · ${count}`,
    it: (count: number) => `Cercati gli orari liberi · ${count}`,
    de: (count: number) => `Freie Zeiten gesucht · ${count}`
  },
  notCreated: { en: 'Event not created', it: 'Evento non creato', de: 'Termin nicht erstellt' },
  alreadyThere: {
    en: (title: string) => `Already in the calendar: ${title}`,
    it: (title: string) => `Già in calendario: ${title}`,
    de: (title: string) => `Bereits im Kalender: ${title}`
  },
  created: {
    en: (title: string) => `In the calendar: ${title}`,
    it: (title: string) => `In calendario: ${title}`,
    de: (title: string) => `Im Kalender: ${title}`
  },
  notChanged: {
    en: 'Event not changed',
    it: 'Evento non modificato',
    de: 'Termin nicht geändert'
  },
  corrected: {
    en: (title: string) => `Corrected: ${title}`,
    it: (title: string) => `Corretto: ${title}`,
    de: (title: string) => `Korrigiert: ${title}`
  },
  correctedInCalendar: {
    en: (title: string) => `Corrected in the calendar: ${title}`,
    it: (title: string) => `Corretto in calendario: ${title}`,
    de: (title: string) => `Im Kalender korrigiert: ${title}`
  },
  alreadyGone: {
    en: 'Event already removed',
    it: 'Evento già tolto',
    de: 'Termin bereits entfernt'
  },
  notRemoved: {
    en: 'Event not deleted',
    it: 'Evento non eliminato',
    de: 'Termin nicht gelöscht'
  },
  removed: {
    en: (title: string) => `Removed from the calendar: ${title}`,
    it: (title: string) => `Tolto dal calendario: ${title}`,
    de: (title: string) => `Aus dem Kalender entfernt: ${title}`
  },
  notAnswered: {
    en: 'Invitation not answered',
    it: 'Invito non risposto',
    de: 'Einladung nicht beantwortet'
  },
  answered: {
    en: (title: string) => `Answered the invitation: ${title}`,
    it: (title: string) => `Risposto all'invito: ${title}`,
    de: (title: string) => `Einladung beantwortet: ${title}`
  },
  proposedAnswer: {
    en: (title: string) => `Proposed a reply: ${title}`,
    it: (title: string) => `Proposto di rispondere: ${title}`,
    de: (title: string) => `Antwort vorgeschlagen: ${title}`
  },
  proposedChange: {
    en: (title: string) => `Proposed a change: ${title}`,
    it: (title: string) => `Proposta una modifica: ${title}`,
    de: (title: string) => `Änderung vorgeschlagen: ${title}`
  },
  alreadyProposed: {
    en: (title: string) => `Already proposed: ${title}`,
    it: (title: string) => `Già proposto: ${title}`,
    de: (title: string) => `Bereits vorgeschlagen: ${title}`
  },
  proposed: {
    en: (title: string) => `Proposed: ${title}`,
    it: (title: string) => `Proposto: ${title}`,
    de: (title: string) => `Vorgeschlagen: ${title}`
  },
  withdrew: {
    en: (title: string) => `Withdrew the proposal: ${title}`,
    it: (title: string) => `Ritirata la proposta: ${title}`,
    de: (title: string) => `Vorschlag zurückgezogen: ${title}`
  },
  /* The confirmations, and the proposals' titles. */
  newEvent: {
    en: (title: string) => `New event: ${title}`,
    it: (title: string) => `Nuovo evento: ${title}`,
    de: (title: string) => `Neuer Termin: ${title}`
  },
  when: {
    en: (when: string) => `When: ${when}`,
    it: (when: string) => `Quando: ${when}`,
    de: (when: string) => `Wann: ${when}`
  },
  where: {
    en: (where: string) => `Where: ${where}`,
    it: (where: string) => `Dove: ${where}`,
    de: (where: string) => `Wo: ${where}`
  },
  invited: {
    en: (guests: string) => `Guests: ${guests} (they get the invitation)`,
    it: (guests: string) => `Invitati: ${guests} (ricevono l'invito)`,
    de: (guests: string) => `Gäste: ${guests} (sie erhalten die Einladung)`
  },
  createAndInvite: { en: 'Create and invite', it: 'Crea e invita', de: 'Erstellen und einladen' },
  change: {
    en: (title: string) => `Change: ${title}`,
    it: (title: string) => `Modifica: ${title}`,
    de: (title: string) => `Ändern: ${title}`
  },
  guestsInvitedOrUpdated: {
    en: 'Guests get the invitation or the update.',
    it: 'Gli invitati ricevono l’invito o l’aggiornamento.',
    de: 'Die Gäste erhalten die Einladung oder die Aktualisierung.'
  },
  guestsUpdated: {
    en: 'Guests get the update.',
    it: 'Gli invitati ricevono l’aggiornamento.',
    de: 'Die Gäste erhalten die Aktualisierung.'
  },
  changeLabel: { en: 'Change', it: 'Modifica', de: 'Ändern' },
  delete: {
    en: (title: string) => `Delete: ${title}`,
    it: (title: string) => `Elimina: ${title}`,
    de: (title: string) => `Löschen: ${title}`
  },
  guestsCancelled: {
    en: 'Guests get the cancellation.',
    it: 'Gli invitati ricevono la cancellazione.',
    de: 'Die Gäste erhalten die Absage.'
  },
  deleteLabel: { en: 'Delete', it: 'Elimina', de: 'Löschen' },
  respond: {
    en: (response: Answer, title: string | null) =>
      `${response === 'accepted' ? 'Attend' : 'Reply'}: ${title ?? 'invitation'}`,
    it: (response: Answer, title: string | null) =>
      `${response === 'accepted' ? 'Partecipi' : 'Rispondi'}: ${title ?? 'invito'}`,
    de: (response: Answer, title: string | null) =>
      `${response === 'accepted' ? 'Teilnehmen' : 'Antworten'}: ${title ?? 'Einladung'}`
  },
  answer: {
    en: (response: Answer) => `Answer: ${ANSWER_EN[response]}`,
    it: (response: Answer) => `Risposta: ${ANSWER_IT[response]}`,
    de: (response: Answer) => `Antwort: ${ANSWER_DE[response]}`
  },
  organizerTold: {
    en: 'The organiser gets the answer.',
    it: "L'organizzatore riceve la risposta.",
    de: 'Der Organisator erhält die Antwort.'
  },
  replyLabel: { en: 'Reply', it: 'Rispondi', de: 'Antworten' },
  proposeAnswer: {
    en: (response: Answer, title: string) => `Reply “${ANSWER_EN[response]}”: ${title}`,
    it: (response: Answer, title: string) => `Rispondi «${ANSWER_IT[response]}»: ${title}`,
    de: (response: Answer, title: string) => `Antworten „${ANSWER_DE[response]}“: ${title}`
  },
  proposeEvent: {
    en: (title: string) => `Event: ${title}`,
    it: (title: string) => `Evento: ${title}`,
    de: (title: string) => `Termin: ${title}`
  },
  /* What a change does to an event, line by line: what it was, what it becomes. */
  titleWas: {
    en: (title: string, was: string) => `Title: “${title}” (was “${was}”)`,
    it: (title: string, was: string) => `Titolo: «${title}» (era «${was}»)`,
    de: (title: string, was: string) => `Titel: „${title}“ (vorher „${was}“)`
  },
  whenWas: {
    en: (when: string, was: string) => `When: ${when} (was ${was})`,
    it: (when: string, was: string) => `Quando: ${when} (era ${was})`,
    de: (when: string, was: string) => `Wann: ${when} (vorher ${was})`
  },
  whereNow: {
    en: (where: string | null) => `Where: ${where ?? '(no place)'}`,
    it: (where: string | null) => `Dove: ${where ?? '(nessun luogo)'}`,
    de: (where: string | null) => `Wo: ${where ?? '(kein Ort)'}`
  },
  descriptionChanges: {
    en: 'The description changes.',
    it: 'Cambia la descrizione.',
    de: 'Die Beschreibung ändert sich.'
  },
  guestsNow: {
    en: (guests: string | null) => `Guests: ${guests ?? 'none'}`,
    it: (guests: string | null) => `Invitati: ${guests ?? 'nessuno'}`,
    de: (guests: string | null) => `Gäste: ${guests ?? 'keine'}`
  }
})
