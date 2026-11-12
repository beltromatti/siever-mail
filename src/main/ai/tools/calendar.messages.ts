import { WEEKDAYS, type CalendarResponse, type EventRecurrence } from '@shared/calendar'
import { defineMessages, hourStyleFor } from '@shared/i18n'

import { languageState, messages } from '../../i18n'
import { startDay, weekdayOf } from './recurrence'

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
  repeatsFrom: {
    en: (title: string) => `Now repeats: ${title}`,
    it: (title: string) => `Ora si ripete: ${title}`,
    de: (title: string) => `Wiederholt sich jetzt: ${title}`
  },
  repeatsNoLonger: {
    en: (title: string) => `No longer repeats: ${title}`,
    it: (title: string) => `Non si ripete più: ${title}`,
    de: (title: string) => `Wiederholt sich nicht mehr: ${title}`
  },
  remindersChanged: {
    en: (title: string) => `Reminders changed: ${title}`,
    it: (title: string) => `Promemoria cambiati: ${title}`,
    de: (title: string) => `Erinnerungen geändert: ${title}`
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
  moving: {
    en: (count: number): string => (count === 1 ? 'Moving the event…' : 'Moving the events…'),
    it: (count: number): string => (count === 1 ? 'Sposto l’evento…' : 'Sposto gli eventi…'),
    de: (count: number): string =>
      count === 1 ? 'Verschiebe den Termin…' : 'Verschiebe die Termine…'
  },
  editingMany: {
    en: 'Correcting the events…',
    it: 'Correggo gli eventi…',
    de: 'Korrigiere die Termine…'
  },
  removingMany: {
    en: 'Removing the events…',
    it: 'Tolgo gli eventi…',
    de: 'Entferne die Termine…'
  },
  answeringMany: {
    en: 'Preparing the replies to the invitations…',
    it: 'Preparo le risposte agli inviti…',
    de: 'Bereite die Antworten auf die Einladungen vor…'
  },
  movedTo: {
    en: (calendar: string, title: string) => `Moved to ${calendar}: ${title}`,
    it: (calendar: string, title: string) => `Spostato in ${calendar}: ${title}`,
    de: (calendar: string, title: string) => `Nach ${calendar} verschoben: ${title}`
  },
  movedMany: {
    en: (count: number, calendar: string) => `Moved ${eventsEn(count)} to ${calendar}`,
    it: (count: number, calendar: string) =>
      `${count === 1 ? 'Spostato' : 'Spostati'} ${eventsIt(count)} in ${calendar}`,
    de: (count: number, calendar: string) => `${eventsDe(count)} nach ${calendar} verschoben`
  },
  correctedMany: {
    en: (count: number) => `Corrected ${eventsEn(count)} in the calendar`,
    it: (count: number) =>
      `${count === 1 ? 'Corretto' : 'Corretti'} ${eventsIt(count)} in calendario`,
    de: (count: number) => `${eventsDe(count)} im Kalender korrigiert`
  },
  removedMany: {
    en: (count: number) => `Removed ${eventsEn(count)} from the calendar`,
    it: (count: number) => `${count === 1 ? 'Tolto' : 'Tolti'} ${eventsIt(count)} dal calendario`,
    de: (count: number) => `${eventsDe(count)} aus dem Kalender entfernt`
  },
  answeredMany: {
    en: (count: number) => `Answered ${count === 1 ? '1 invitation' : `${count} invitations`}`,
    it: (count: number) => `Risposto a ${count === 1 ? '1 invito' : `${count} inviti`}`,
    de: (count: number) => `${count === 1 ? '1 Einladung' : `${count} Einladungen`} beantwortet`
  },
  /** After a line of what was done to several events: how many were left as they were. */
  leftAsTheyWere: {
    en: (count: number) => ` · ${count} left as ${count === 1 ? 'it was' : 'they were'}`,
    it: (count: number) => ` · ${count} ${count === 1 ? 'lasciato com’era' : 'lasciati com’erano'}`,
    de: (count: number) => ` · ${count} unverändert`
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
  changeMany: {
    en: (count: number) => `Change ${eventsEn(count)}`,
    it: (count: number) => `Modifica ${eventsIt(count)}`,
    de: (count: number) => `${eventsDe(count)} ändern`
  },
  moveLabel: { en: 'Move', it: 'Sposta', de: 'Verschieben' },
  /** A move alone: Google and a CalDAV server move an event without telling anyone. */
  guestsNotTold: {
    en: 'Guests aren’t told: it’s the same event, in another calendar.',
    it: 'Gli invitati non ricevono niente: è lo stesso evento, in un altro calendario.',
    de: 'Die Gäste erhalten nichts: Es ist derselbe Termin, in einem anderen Kalender.'
  },
  /** One of several events a confirmation is about. */
  eventItem: {
    en: (title: string, when: string) => `${title} · ${when}`,
    it: (title: string, when: string) => `${title} · ${when}`,
    de: (title: string, when: string) => `${title} · ${when}`
  },
  wholeSeries: {
    en: 'The whole series',
    it: 'Tutta la serie',
    de: 'Die ganze Serie'
  },
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
  deleteMany: {
    en: (count: number) => `Delete ${eventsEn(count)}`,
    it: (count: number) => `Elimina ${eventsIt(count)}`,
    de: (count: number) => `${eventsDe(count)} löschen`
  },
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
  respondMany: {
    en: (response: Answer, count: number) =>
      `${response === 'accepted' ? 'Attend' : 'Reply to'} ${count} invitations`,
    it: (response: Answer, count: number) =>
      `${response === 'accepted' ? 'Partecipi a' : 'Rispondi a'} ${count} inviti`,
    de: (response: Answer, count: number) =>
      `${count} Einladungen ${response === 'accepted' ? 'zusagen' : 'beantworten'}`
  },
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
  titleNow: {
    en: (title: string) => `Title: “${title}”`,
    it: (title: string) => `Titolo: «${title}»`,
    de: (title: string) => `Titel: „${title}“`
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
  },
  calendarWas: {
    en: (calendar: string, was: string | null) =>
      `Calendar: ${calendar}${was ? ` (was ${was})` : ''}`,
    it: (calendar: string, was: string | null) =>
      `Calendario: ${calendar}${was ? ` (era ${was})` : ''}`,
    de: (calendar: string, was: string | null) =>
      `Kalender: ${calendar}${was ? ` (vorher ${was})` : ''}`
  },
  repeats: {
    en: (how: string) => `Repeats: ${how}`,
    it: (how: string) => `Si ripete: ${how}`,
    de: (how: string) => `Wiederholung: ${how}`
  },
  repeatsNoMore: {
    en: 'No longer repeats',
    it: 'Non si ripete più',
    de: 'Wird nicht mehr wiederholt'
  },
  remindersNow: {
    en: (reminders: string) => `Reminders: ${reminders}`,
    it: (reminders: string) => `Promemoria: ${reminders}`,
    de: (reminders: string) => `Erinnerungen: ${reminders}`
  }
})

/** English's ordinal of a day of the month: 1st, 2nd, 3rd, 4th. */
const ENGLISH_ORDINAL = new Intl.PluralRules('en', { type: 'ordinal' })
const ENGLISH_SUFFIX: Readonly<Record<string, string>> = { one: 'st', two: 'nd', few: 'rd' }
/** Italian elides the article before a number said with a vowel: l’1, l’8, l’11. */
const elided = (date: string): boolean => /^(1|8|11)(?!\d)/.test(date)
const PLACES_EN = ['first', 'second', 'third', 'fourth', 'fifth']
const PLACES_IT_M = ['primo', 'secondo', 'terzo', 'quarto', 'quinto']
const PLACES_IT_F = ['prima', 'seconda', 'terza', 'quarta', 'quinta']
const PLACES_DE = ['ersten', 'zweiten', 'dritten', 'vierten', 'fünften']

/** How an event repeats, as the user reads it: the same words as the Calendario's. */
const RECURRENCE = defineMessages({
  other: {
    en: 'by a rule made elsewhere',
    it: 'con una regola fatta altrove',
    de: 'nach einer anderswo erstellten Regel'
  },
  daily: {
    en: (every: number) => (every === 1 ? 'every day' : `every ${every} days`),
    it: (every: number) => (every === 1 ? 'ogni giorno' : `ogni ${every} giorni`),
    de: (every: number) => (every === 1 ? 'jeden Tag' : `alle ${every} Tage`)
  },
  workdays: {
    en: 'every weekday',
    it: 'ogni giorno feriale',
    de: 'jeden Werktag'
  },
  /** A weekday among those a week repeats on: «il lunedì», «la domenica». */
  weekdayInList: {
    en: (name: string) => name,
    it: (name: string) => (name === 'domenica' ? `la ${name}` : `il ${name}`),
    de: (name: string) => name
  },
  weekly: {
    en: (every: number, days: string) =>
      every === 1 ? `every week on ${days}` : `every ${every} weeks on ${days}`,
    it: (every: number, days: string) =>
      every === 1 ? `ogni settimana ${days}` : `ogni ${every} settimane ${days}`,
    de: (every: number, days: string) =>
      every === 1 ? `jede Woche am ${days}` : `alle ${every} Wochen am ${days}`
  },
  monthly: {
    en: (every: number, on: string) =>
      `${every === 1 ? 'every month' : `every ${every} months`} ${on}`,
    it: (every: number, on: string) => `${every === 1 ? 'ogni mese' : `ogni ${every} mesi`} ${on}`,
    de: (every: number, on: string) =>
      `${every === 1 ? 'jeden Monat' : `alle ${every} Monate`} ${on}`
  },
  onDay: {
    en: (day: number) => `on the ${day}${ENGLISH_SUFFIX[ENGLISH_ORDINAL.select(day)] ?? 'th'}`,
    it: (day: number) => `il giorno ${day}`,
    de: (day: number) => `am ${day}.`
  },
  onPlace: {
    en: (place: number, weekday: string) => `on the ${PLACES_EN[place - 1]} ${weekday}`,
    it: (place: number, weekday: string) =>
      weekday === 'domenica'
        ? `la ${PLACES_IT_F[place - 1]} ${weekday}`
        : `il ${PLACES_IT_M[place - 1]} ${weekday}`,
    de: (place: number, weekday: string) => `am ${PLACES_DE[place - 1]} ${weekday}`
  },
  onLast: {
    en: (weekday: string) => `on the last ${weekday}`,
    it: (weekday: string) =>
      weekday === 'domenica' ? `l’ultima ${weekday}` : `l’ultimo ${weekday}`,
    de: (weekday: string) => `am letzten ${weekday}`
  },
  yearly: {
    en: (every: number, date: string) =>
      `${every === 1 ? 'every year' : `every ${every} years`} on ${date}`,
    it: (every: number, date: string) =>
      `${every === 1 ? 'ogni anno' : `ogni ${every} anni`} ${elided(date) ? 'l’' : 'il '}${date}`,
    de: (every: number, date: string) =>
      `${every === 1 ? 'jedes Jahr' : `alle ${every} Jahre`} am ${date}`
  },
  until: {
    en: (date: string) => `, until ${date}`,
    it: (date: string) => `, fino ${elided(date) ? 'all’' : 'al '}${date}`,
    de: (date: string) => `, bis ${date}`
  },
  count: {
    en: (count: number) => (count === 1 ? ', once' : `, ${count} times`),
    it: (count: number) => (count === 1 ? ', una volta' : `, ${count} volte`),
    de: (count: number) => (count === 1 ? ', einmal' : `, ${count}-mal`)
  }
})

/** An event's reminders, as the user reads them. */
const REMINDERS = defineMessages({
  calendars: {
    en: 'the calendar’s defaults',
    it: 'quelli del calendario',
    de: 'Standard des Kalenders'
  },
  none: { en: 'none', it: 'nessuno', de: 'keine' },
  atStart: { en: 'at the start', it: 'all’inizio', de: 'zu Beginn' },
  dayStarts: {
    en: 'when the day starts',
    it: 'all’inizio del giorno',
    de: 'zu Beginn des Tages'
  },
  minutes: {
    en: (count: number) => (count === 1 ? '1 minute' : `${count} minutes`),
    it: (count: number) => (count === 1 ? '1 minuto' : `${count} minuti`),
    de: (count: number) => (count === 1 ? '1 Minute' : `${count} Minuten`)
  },
  hours: {
    en: (count: number) => (count === 1 ? '1 hour' : `${count} hours`),
    it: (count: number) => (count === 1 ? '1 ora' : `${count} ore`),
    de: (count: number) => (count === 1 ? '1 Stunde' : `${count} Stunden`)
  },
  days: {
    en: (count: number) => (count === 1 ? '1 day' : `${count} days`),
    it: (count: number) => (count === 1 ? '1 giorno' : `${count} giorni`),
    de: (count: number) => (count === 1 ? '1 Tag' : `${count} Tage`)
  },
  weeks: {
    en: (count: number) => (count === 1 ? '1 week' : `${count} weeks`),
    it: (count: number) => (count === 1 ? '1 settimana' : `${count} settimane`),
    de: (count: number) => (count === 1 ? '1 Woche' : `${count} Wochen`)
  },
  before: {
    en: (time: string) => `${time} before`,
    it: (time: string) => `${time} prima`,
    de: (time: string) => `${time} vorher`
  },
  daysBefore: {
    en: (days: number, time: string) =>
      days === 1 ? `the day before at ${time}` : `${days} days before at ${time}`,
    it: (days: number, time: string) =>
      days === 1 ? `il giorno prima alle ${time}` : `${days} giorni prima alle ${time}`,
    de: (days: number, time: string) =>
      days === 1 ? `am Vortag um ${time}` : `${days} Tage vorher um ${time}`
  }
})

/** Words in a list, as the user's language joins them: "a, b and c". */
function listWords(words: ReadonlyArray<string>): string {
  return new Intl.ListFormat(languageState().formatLocale, { type: 'conjunction' }).format(words)
}

/** A weekday's whole name in the user's language: "Monday", «lunedì», "Montag". */
function weekdayName(index: number): string {
  // 1 January 2024 was a Monday.
  return new Intl.DateTimeFormat(languageState().formatLocale, { weekday: 'long' }).format(
    new Date(2024, 0, 1 + index)
  )
}

/**
 * How an event repeats, in the user's words, from its start: «ogni
 * settimana il lunedì e il giovedì, fino al 22 dic 2026», "every month on
 * the last Friday, 10 times"; a rule made elsewhere, that it is one.
 */
export function shownRecurrence(recurrence: EventRecurrence | 'other', start: string): string {
  const m = messages(RECURRENCE)

  if (recurrence === 'other') {
    return m.other
  }

  const locale = languageState().formatLocale
  const day = startDay(start)
  const every = Math.max(1, recurrence.interval)
  const weekday = WEEKDAYS.indexOf(weekdayOf(day))
  let words: string

  switch (recurrence.frequency) {
    case 'daily':
      words = m.daily(every)
      break
    case 'weekly': {
      const days = recurrence.weekdays?.length ? recurrence.weekdays : [weekdayOf(day)]
      words =
        every === 1 && days.length === 5 && !days.includes('SA') && !days.includes('SU')
          ? m.workdays
          : m.weekly(
              every,
              listWords(
                WEEKDAYS.flatMap((each, index) =>
                  days.includes(each) ? [m.weekdayInList(weekdayName(index))] : []
                )
              )
            )
      break
    }
    case 'monthly':
      words = m.monthly(
        every,
        recurrence.monthlyBy === 'weekday'
          ? m.onPlace(Math.ceil(day.getDate() / 7), weekdayName(weekday))
          : recurrence.monthlyBy === 'lastWeekday'
            ? m.onLast(weekdayName(weekday))
            : m.onDay(day.getDate())
      )
      break
    case 'yearly':
      words = m.yearly(
        every,
        new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(day)
      )
      break
  }

  const until = recurrence.until ? startDay(recurrence.until) : null

  return `${words}${
    recurrence.count
      ? m.count(recurrence.count)
      : until
        ? m.until(
            new Intl.DateTimeFormat(locale, {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            }).format(until)
          )
        : ''
  }`
}

/** A span of minutes in its largest whole unit, in the user's words. */
function spanShown(minutes: number): string {
  const m = messages(REMINDERS)

  return minutes % 10080 === 0
    ? m.weeks(minutes / 10080)
    : minutes % 1440 === 0
      ? m.days(minutes / 1440)
      : minutes % 60 === 0
        ? m.hours(minutes / 60)
        : m.minutes(minutes)
}

/**
 * An event's reminders, in the user's words: "10 minutes before, 1 day
 * before"; of an all-day one — which starts at its midnight — the day and
 * the hour they ring. Null: the calendar's own.
 */
export function shownReminders(reminders: ReadonlyArray<number> | null, allDay: boolean): string {
  const m = messages(REMINDERS)

  if (reminders === null) {
    return m.calendars
  }

  if (reminders.length === 0) {
    return m.none
  }

  const locale = languageState().formatLocale

  return listWords(
    [...reminders]
      .sort((a, b) => a - b)
      .map((minutes) => {
        if (minutes <= 0) {
          return allDay ? m.dayStarts : m.atStart
        }

        if (!allDay) {
          return m.before(spanShown(minutes))
        }

        const days = Math.ceil(minutes / 1440)
        const at = days * 1440 - minutes
        const time = new Intl.DateTimeFormat(locale, {
          hour: hourStyleFor(locale),
          minute: '2-digit'
        }).format(new Date(2000, 0, 1, Math.floor(at / 60), at % 60))
        return m.daysBefore(days, time)
      })
  )
}
