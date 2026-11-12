import { messagesNow } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'
import type { MessageRowWork } from '@shared/segretario'

/** Past these, the panel's suggestions stop: they are a start, not a menu. */
const SUGGESTIONS_SHOWN = 4

/** Sent as the user's own words when picked: the Segretario reads any language. */
const MESSAGES = defineMessages({
  writeReply: { en: 'Write the reply', it: 'Scrivi la risposta', de: 'Antwort schreiben' },
  writeMessage: { en: 'Write the message', it: 'Scrivi il messaggio', de: 'Nachricht schreiben' },
  shorter: { en: 'Make it shorter', it: 'Rendilo più breve', de: 'Kürzer fassen' },
  moreFormal: {
    en: 'Make it more formal',
    it: 'Rendilo più formale',
    de: 'Förmlicher formulieren'
  },
  fixMistakes: { en: 'Fix the mistakes', it: 'Correggi gli errori', de: 'Fehler korrigieren' },
  briefMe: {
    en: 'Brief me for this meeting',
    it: 'Preparami a questo appuntamento',
    de: 'Mich auf diesen Termin vorbereiten'
  },
  findRelated: {
    en: 'Find the related emails and files',
    it: 'Trova le email e i file collegati',
    de: 'Zugehörige E-Mails und Dateien finden'
  },
  freeToMove: {
    en: 'When am I free to move it?',
    it: 'Quando sono libero per spostarlo?',
    de: 'Wann habe ich Zeit, um ihn zu verschieben?'
  },
  thisWeek: {
    en: 'What’s on my calendar this week?',
    it: 'Cosa ho in agenda questa settimana?',
    de: 'Was steht diese Woche in meinem Kalender?'
  },
  freeSoon: {
    en: 'When am I free in the next few days?',
    it: 'Quando sono libero nei prossimi giorni?',
    de: 'Wann habe ich in den nächsten Tagen Zeit?'
  },
  deadlines: {
    en: 'What deadlines do I have in the coming weeks?',
    it: 'Quali scadenze ho nelle prossime settimane?',
    de: 'Welche Fristen habe ich in den nächsten Wochen?'
  },
  summarizeSelection: {
    en: 'Summarize these messages for me',
    it: 'Riassumimi questi messaggi',
    de: 'Diese Nachrichten zusammenfassen'
  },
  whatToDoWithThese: {
    en: 'What should I do with these?',
    it: 'Cosa devo fare con questi?',
    de: 'Was muss ich damit tun?'
  },
  fileThem: {
    en: 'File them in the right folders',
    it: 'Mettili in ordine nelle cartelle giuste',
    de: 'In die richtigen Ordner einsortieren'
  },
  reviewReply: {
    en: 'Go through the ready reply with me',
    it: 'Rivedi con me la risposta pronta',
    de: 'Die fertige Antwort mit mir durchgehen'
  },
  prepareReply: { en: 'Prepare the reply', it: 'Prepara la risposta', de: 'Antwort vorbereiten' },
  whatToDo: {
    en: 'What do I need to do, and by when?',
    it: 'Cosa devo fare, e per quando?',
    de: 'Was muss ich tun, und bis wann?'
  },
  reviewFollowUp: {
    en: 'Go through the follow-up with me',
    it: 'Rivedi con me il sollecito',
    de: 'Das Nachfassen mit mir durchgehen'
  },
  prepareFollowUp: {
    en: 'Prepare a follow-up',
    it: 'Prepara un sollecito',
    de: 'Nachfassen vorbereiten'
  },
  summarizeConversation: {
    en: 'Summarize the conversation for me',
    it: 'Riassumimi la conversazione',
    de: 'Die Unterhaltung zusammenfassen'
  },
  whereProjectStands: {
    en: (project: string) => `Where does ${project} stand?`,
    it: (project: string) => `A che punto è ${project}?`,
    de: (project: string) => `Wie steht es um ${project}?`
  },
  putInCalendar: {
    en: 'If it mentions a meeting, put it in the calendar',
    it: 'Se parla di un appuntamento, mettilo in calendario',
    de: 'Wenn es um einen Termin geht, in den Kalender eintragen'
  },
  leftToDo: {
    en: 'What’s left to do here, and who needs to act?',
    it: 'Cosa resta da fare qui, e chi deve muoversi?',
    de: 'Was ist hier noch zu tun, und wer ist am Zug?'
  },
  stillToAnswer: {
    en: 'Who do I still need to reply to?',
    it: 'A chi devo ancora rispondere?',
    de: 'Wem muss ich noch antworten?'
  },
  projectsMoved: {
    en: 'Which projects moved the most this week?',
    it: 'Quali progetti si sono mossi di più questa settimana?',
    de: 'Welche Projekte haben sich diese Woche am meisten bewegt?'
  }
})

/**
 * What the Segretario offers to do, from what the user is looking at: the
 * message open and what is open in it, the project whose list is open,
 * the selection, the calendar and its event open. Written as the user
 * would ask it, in the interface's language.
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
  /** A message being written in front: a reply or forward, or a new one. */
  composing?: { answering: boolean } | null
}): string[] {
  const m = messagesNow(MESSAGES)
  const suggestions: string[] = []

  if (context.composing) {
    // The usual asks of someone writing: the message written for them, or what is written reworded.
    suggestions.push(
      context.composing.answering ? m.writeReply : m.writeMessage,
      m.shorter,
      m.moreFormal,
      m.fixMistakes
    )
  } else if (context.calendar?.eventOpen) {
    suggestions.push(m.briefMe, m.findRelated, m.freeToMove)
  } else if (context.calendar) {
    suggestions.push(m.thisWeek, m.freeSoon, m.deadlines)
  } else if (context.selectionCount > 1) {
    suggestions.push(m.summarizeSelection, m.whatToDoWithThese, m.fileThem)
  } else if (context.messageOpen) {
    const work = context.work

    if (work?.owed?.kind === 'ti_chiedono') {
      suggestions.push(work.reply ? m.reviewReply : m.prepareReply)
    } else if (work?.owed) {
      suggestions.push(m.whatToDo)
    } else if (work?.awaited) {
      suggestions.push(work.reply ? m.reviewFollowUp : m.prepareFollowUp)
    }

    suggestions.push(m.summarizeConversation)

    if (context.project) {
      suggestions.push(m.whereProjectStands(context.project))
    }

    if (context.calendarConnected) {
      suggestions.push(m.putInCalendar)
    }

    suggestions.push(m.findRelated)
  } else {
    if (context.project) {
      suggestions.push(m.whereProjectStands(context.project), m.leftToDo)
    }

    suggestions.push(m.stillToAnswer)

    if (context.calendarConnected) {
      suggestions.push(m.thisWeek)
    }

    if (!context.project) {
      suggestions.push(m.projectsMoved)
    }

    suggestions.push(m.deadlines)
  }

  return suggestions.slice(0, SUGGESTIONS_SHOWN)
}
