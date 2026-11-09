import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { CompassStar } from '@renderer/components/ui/compass-star'

/** "a, b e c". */
function listed(items: ReadonlyArray<string>): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
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
  const outgoing = connection.outgoing ?? 0
  const description =
    family === 'posta'
      ? `SIEVER Mail smette di ricevere e inviare da questa casella e toglie dal computer ${listed([
          'la sua posta',
          'la sua firma',
          ...(connection.withCalendars ? ['i suoi calendari'] : []),
          ...(aiOn ? ['il lavoro del Segretario su di lei'] : [])
        ])}. Sul server non cambia nulla: puoi ricollegarla quando vuoi.`
      : `I suoi eventi spariscono da SIEVER Mail${
          aiOn ? ', con il lavoro del Segretario su di loro' : ''
        }; nel calendario restano come sono. Puoi ricollegarlo quando vuoi.`

  const notes = [
    outgoing > 0 && (
      <p
        key="outgoing"
        className="border-destructive/35 bg-destructive/10 flex items-start gap-2 rounded-md border px-2.5 py-2 text-[12px]"
      >
        <AlertTriangle className="text-destructive mt-px size-3.5 shrink-0" />
        {outgoing === 1
          ? 'Un messaggio in uscita non è ancora partito: con la casella non partirà più.'
          : `${outgoing} messaggi in uscita non sono ancora partiti: con la casella non partiranno più.`}
      </p>
    ),
    aiOn && (
      <p
        key="memory"
        className="text-muted-foreground bg-hover flex items-start gap-2 rounded-md px-2.5 py-2 text-[12px]"
      >
        <CompassStar className="text-ai-star mt-px size-3.5" />
        Ciò che il Segretario ha imparato da lì lo rivede lui: le persone e il tuo modo di lavorare
        restano. Se vuoi che dimentichi qualcosa, diglielo.
      </p>
    )
  ].filter(Boolean)

  return {
    description,
    details: notes.length > 0 ? <div className="flex flex-col gap-2">{notes}</div> : null
  }
}
