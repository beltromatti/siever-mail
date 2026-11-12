import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { languageNow, messagesNow } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  itsMail: { en: 'its mail', it: 'la sua posta', de: 'seine E-Mails' },
  itsSignature: { en: 'its signature', it: 'la sua firma', de: 'seine Signatur' },
  itsCalendars: { en: 'its calendars', it: 'i suoi calendari', de: 'seine Kalender' },
  segretarioWork: {
    en: 'the Segretario’s work on it',
    it: 'il lavoro del Segretario su di lei',
    de: 'die Arbeit des Segretario daran'
  },
  mailbox: {
    en: (taken: string) =>
      `SIEVER Mail stops receiving and sending from this mailbox and removes ${taken} from this computer. Nothing changes on the server: you can reconnect it whenever you like.`,
    it: (taken: string) =>
      `SIEVER Mail smette di ricevere e inviare da questa casella e toglie dal computer ${taken}. Sul server non cambia nulla: puoi ricollegarla quando vuoi.`,
    de: (taken: string) =>
      `SIEVER Mail empfängt und sendet nicht mehr über dieses Postfach und entfernt ${taken} von diesem Computer. Auf dem Server ändert sich nichts: Sie können es jederzeit wieder verbinden.`
  },
  calendar: {
    en: (aiOn: boolean) =>
      `Its events disappear from SIEVER Mail${aiOn ? ', along with the Segretario’s work on them' : ''}; in the calendar they stay as they are. You can reconnect it whenever you like.`,
    it: (aiOn: boolean) =>
      `I suoi eventi spariscono da SIEVER Mail${aiOn ? ', con il lavoro del Segretario su di loro' : ''}; nel calendario restano come sono. Puoi ricollegarlo quando vuoi.`,
    de: (aiOn: boolean) =>
      `Seine Termine verschwinden aus SIEVER Mail${aiOn ? ', mitsamt der Arbeit des Segretario daran' : ''}; im Kalender bleiben sie unverändert. Sie können ihn jederzeit wieder verbinden.`
  },
  outgoing: {
    en: (count: number) =>
      count === 1
        ? 'One outgoing message hasn’t left yet: without the mailbox it never will.'
        : `${count} outgoing messages haven’t left yet: without the mailbox they never will.`,
    it: (count: number) =>
      count === 1
        ? 'Un messaggio in uscita non è ancora partito: con la casella non partirà più.'
        : `${count} messaggi in uscita non sono ancora partiti: con la casella non partiranno più.`,
    de: (count: number) =>
      count === 1
        ? 'Eine ausgehende Nachricht wurde noch nicht versendet: Ohne das Postfach wird sie nicht mehr versendet.'
        : `${count} ausgehende Nachrichten wurden noch nicht versendet: Ohne das Postfach werden sie nicht mehr versendet.`
  },
  memory: {
    en: 'What the Segretario learned from there, it reviews itself: the people and the way you work stay. If you want it to forget something, tell it.',
    it: 'Ciò che il Segretario ha imparato da lì lo rivede lui: le persone e il tuo modo di lavorare restano. Se vuoi che dimentichi qualcosa, diglielo.',
    de: 'Was der Segretario dort gelernt hat, überprüft er selbst: Die Personen und Ihre Arbeitsweise bleiben. Wenn er etwas vergessen soll, sagen Sie es ihm.'
  }
})

/** "a, b and c", as the interface's language joins a list. */
function listed(items: ReadonlyArray<string>): string {
  return new Intl.ListFormat(languageNow().language, { type: 'conjunction' }).format(items)
}

/**
 * What removing a connection takes away, in the same words wherever it is
 * asked (vision §11.4): its data goes from this computer, the provider keeps
 * it; a message still to leave from it would not leave; what the Segretario
 * learnt there, it revises — said only with the AI on, as nothing of the
 * Segretario shows without it.
 */
export function removalWords(connection: {
  family: 'posta' | 'calendario'
  /** The calendars that came with the same access, going with the mailbox. */
  withCalendars?: boolean
  /** The messages waiting in its outbox. */
  outgoing?: number
  aiOn: boolean
}): { description: string; details: ReactNode } {
  const { family, aiOn } = connection
  const m = messagesNow(MESSAGES)
  const outgoing = connection.outgoing ?? 0
  const description =
    family === 'posta'
      ? m.mailbox(
          listed([
            m.itsMail,
            m.itsSignature,
            ...(connection.withCalendars ? [m.itsCalendars] : []),
            ...(aiOn ? [m.segretarioWork] : [])
          ])
        )
      : m.calendar(aiOn)

  const notes = [
    outgoing > 0 && (
      <p
        key="outgoing"
        className="border-destructive/35 bg-destructive/10 flex items-start gap-2 rounded-md border px-2.5 py-2 text-[12px]"
      >
        <AlertTriangle className="text-destructive mt-px size-3.5 shrink-0" />
        {m.outgoing(outgoing)}
      </p>
    ),
    aiOn && (
      <p
        key="memory"
        className="text-muted-foreground bg-hover flex items-start gap-2 rounded-md px-2.5 py-2 text-[12px]"
      >
        <CompassStar className="text-ai-star mt-px size-3.5" />
        {m.memory}
      </p>
    )
  ].filter(Boolean)

  return {
    description,
    details: notes.length > 0 ? <div className="flex flex-col gap-2">{notes}</div> : null
  }
}
