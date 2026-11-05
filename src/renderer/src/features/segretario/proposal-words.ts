import type { Proposal } from '@shared/segretario'

const ANSWER_WORDS: Readonly<Record<string, string>> = {
  accepted: 'Partecipo',
  tentative: 'Forse',
  declined: 'Non partecipo'
}

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

  if (typeof payload.response === 'string') {
    return {
      heading: 'Invito da rispondere',
      action: `Rispondi: ${ANSWER_WORDS[payload.response] ?? payload.response}`,
      done: 'Risposta mandata',
      changes: []
    }
  }

  if (payload.eventKey) {
    return {
      heading: 'Modifica proposta',
      action: 'Applica',
      done: 'Evento aggiornato',
      changes: Array.isArray(payload.changes)
        ? payload.changes.filter((line): line is string => typeof line === 'string')
        : []
    }
  }

  const invited = Array.isArray(payload.attendees) && payload.attendees.length > 0

  return {
    heading: 'Evento proposto',
    action: invited ? 'Crea e invita' : 'Aggiungi al calendario',
    done: 'Messo in calendario',
    changes: []
  }
}
