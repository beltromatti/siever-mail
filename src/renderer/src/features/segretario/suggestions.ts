import type { MessageNote } from '@shared/segretario'

/** Past these, the panel's suggestions stop: they are a start, not a menu. */
const SUGGESTIONS_SHOWN = 4

/**
 * What the Segretario offers to do, from what the user is looking at: the
 * message open and what its note says, the pratica whose list is open,
 * the selection, the day. Written as the user would ask it.
 */
export function segretarioSuggestions(context: {
  selectionCount: number
  /** The note of the message open, when one is. */
  note: MessageNote | null
  messageOpen: boolean
  /** The topic whose list is open, by title. */
  topic: string | null
  /** "Pratiche", "Argomenti". */
  topicsLabel: string | null
  /** A reply prepared for the message open. */
  readyReply: boolean
  calendarConnected: boolean
}): string[] {
  const suggestions: string[] = []

  if (context.selectionCount > 1) {
    suggestions.push(
      'Riassumimi questi messaggi',
      'Cosa devo fare con questi?',
      'Mettili in ordine nelle cartelle giuste'
    )
  } else if (context.messageOpen) {
    const note = context.note

    if (note?.state === 'da_rispondere') {
      suggestions.push(
        context.readyReply ? 'Rivedi con me la risposta pronta' : 'Prepara la risposta'
      )
    } else if (note?.state === 'in_attesa') {
      suggestions.push('Prepara un sollecito')
    } else if (note?.state === 'da_fare') {
      suggestions.push('Cosa mi chiede di fare, e per quando?')
    }

    suggestions.push('Riassumimi la conversazione')

    if (context.topic) {
      suggestions.push(`A che punto è ${context.topic}?`)
    }

    if (context.calendarConnected) {
      suggestions.push('Se parla di un appuntamento, mettilo in calendario')
    }

    suggestions.push('Trova le email e i file collegati')
  } else {
    if (context.topic) {
      suggestions.push(
        `A che punto è ${context.topic}?`,
        'Cosa resta da fare qui, e chi deve muoversi?'
      )
    }

    suggestions.push('A chi devo ancora rispondere?')

    if (context.calendarConnected) {
      suggestions.push('Cosa ho in agenda questa settimana?')
    }

    if (!context.topic && context.topicsLabel) {
      suggestions.push(
        `Quali ${context.topicsLabel.toLowerCase()} si sono mosse di più questa settimana?`
      )
    }

    suggestions.push('Quali scadenze ho nelle prossime settimane?')
  }

  return suggestions.slice(0, SUGGESTIONS_SHOWN)
}
