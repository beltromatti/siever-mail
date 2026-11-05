import type { MessageRowWork } from '@shared/segretario'

/** Past these, the panel's suggestions stop: they are a start, not a menu. */
const SUGGESTIONS_SHOWN = 4

/**
 * What the Segretario offers to do, from what the user is looking at: the
 * message open and what is open in it, the project whose list is open,
 * the selection, the calendar and its event open. Written as the user
 * would ask it.
 */
export function segretarioSuggestions(context: {
  selectionCount: number
  /** What the Segretario has on the message open, when one is. */
  work: MessageRowWork | null
  messageOpen: boolean
  /** The project whose list is open, by name. */
  project: string | null
  calendarConnected: boolean
  /** The calendar in front, and whether one of its events is open. */
  calendar?: { eventOpen: boolean } | null
}): string[] {
  const suggestions: string[] = []

  if (context.calendar?.eventOpen) {
    suggestions.push(
      'Preparami a questo appuntamento',
      'Trova le email e i file collegati',
      'Quando sono libero per spostarlo?'
    )
  } else if (context.calendar) {
    suggestions.push(
      'Cosa ho in agenda questa settimana?',
      'Quando sono libero nei prossimi giorni?',
      'Quali scadenze ho nelle prossime settimane?'
    )
  } else if (context.selectionCount > 1) {
    suggestions.push(
      'Riassumimi questi messaggi',
      'Cosa devo fare con questi?',
      'Mettili in ordine nelle cartelle giuste'
    )
  } else if (context.messageOpen) {
    const work = context.work

    if (work?.owed?.kind === 'ti_chiedono') {
      suggestions.push(work.reply ? 'Rivedi con me la risposta pronta' : 'Prepara la risposta')
    } else if (work?.owed) {
      suggestions.push('Cosa devo fare, e per quando?')
    } else if (work?.awaited) {
      suggestions.push(work.reply ? 'Rivedi con me il sollecito' : 'Prepara un sollecito')
    }

    suggestions.push('Riassumimi la conversazione')

    if (context.project) {
      suggestions.push(`A che punto è ${context.project}?`)
    }

    if (context.calendarConnected) {
      suggestions.push('Se parla di un appuntamento, mettilo in calendario')
    }

    suggestions.push('Trova le email e i file collegati')
  } else {
    if (context.project) {
      suggestions.push(
        `A che punto è ${context.project}?`,
        'Cosa resta da fare qui, e chi deve muoversi?'
      )
    }

    suggestions.push('A chi devo ancora rispondere?')

    if (context.calendarConnected) {
      suggestions.push('Cosa ho in agenda questa settimana?')
    }

    if (!context.project) {
      suggestions.push('Quali progetti si sono mossi di più questa settimana?')
    }

    suggestions.push('Quali scadenze ho nelle prossime settimane?')
  }

  return suggestions.slice(0, SUGGESTIONS_SHOWN)
}
