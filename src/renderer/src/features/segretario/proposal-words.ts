import { messagesNow } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'
import type { Proposal } from '@shared/segretario'

const MESSAGES = defineMessages({
  invitation: {
    en: 'Invitation to answer',
    it: 'Invito da rispondere',
    de: 'Einladung zu beantworten'
  },
  answer: {
    en: (answer: string) => `Reply: ${answer}`,
    it: (answer: string) => `Rispondi: ${answer}`,
    de: (answer: string) => `Antworten: ${answer}`
  },
  answerSent: { en: 'Reply sent', it: 'Risposta mandata', de: 'Antwort gesendet' },
  change: { en: 'Proposed change', it: 'Modifica proposta', de: 'Vorgeschlagene Änderung' },
  apply: { en: 'Apply', it: 'Applica', de: 'Übernehmen' },
  updated: { en: 'Event updated', it: 'Evento aggiornato', de: 'Termin aktualisiert' },
  event: { en: 'Proposed event', it: 'Evento proposto', de: 'Vorgeschlagener Termin' },
  createAndInvite: { en: 'Create and invite', it: 'Crea e invita', de: 'Erstellen und einladen' },
  addToCalendar: {
    en: 'Add to calendar',
    it: 'Aggiungi al calendario',
    de: 'Zum Kalender hinzufügen'
  },
  added: {
    en: 'Added to the calendar',
    it: 'Messo in calendario',
    de: 'In den Kalender eingetragen'
  }
})

/** An invitation's answers, by the response the proposal gives. */
const ANSWER_WORDS = defineMessages({
  accepted: { en: 'Accept', it: 'Partecipo', de: 'Zusagen' },
  tentative: { en: 'Maybe', it: 'Forse', de: 'Vielleicht' },
  declined: { en: 'Decline', it: 'Non partecipo', de: 'Absagen' }
})

/**
 * What accepting a proposed event does, in words: a new event put in the
 * calendar, a change to one already there (and what it changes), or an
 * answer to its invitation — the same wherever the proposal is shown.
 */
export function eventProposalWords(proposal: Proposal): {
  heading: string
  action: string
  done: string
  changes: string[]
} {
  const { payload } = proposal
  const m = messagesNow(MESSAGES)

  if (typeof payload.response === 'string') {
    const answers: Readonly<Record<string, string>> = messagesNow(ANSWER_WORDS)

    return {
      heading: m.invitation,
      action: m.answer(answers[payload.response] ?? payload.response),
      done: m.answerSent,
      changes: []
    }
  }

  if (payload.eventKey) {
    return {
      heading: m.change,
      action: m.apply,
      done: m.updated,
      changes: Array.isArray(payload.changes)
        ? payload.changes.filter((line): line is string => typeof line === 'string')
        : []
    }
  }

  const invited = Array.isArray(payload.attendees) && payload.attendees.length > 0

  return {
    heading: m.event,
    action: invited ? m.createAndInvite : m.addToCalendar,
    done: m.added,
    changes: []
  }
}
