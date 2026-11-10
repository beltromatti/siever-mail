import { useEffect, useState } from 'react'
import { Briefcase, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { Input } from '@renderer/components/ui/input'
import { dayKey } from '@renderer/features/calendar/calendar-dates'
import { CommitmentRow } from '@renderer/features/segretario/commitment-row'
import { useOpenLink } from '@renderer/features/segretario/segretario-text'
import type { CalendarEvent } from '@shared/calendar'
import type { EventWhose, EventWork } from '@shared/segretario'

/** What the work holds of an event, kept current while the Segretario and the user change it. */
function useEventWork(eventKey: string): EventWork | null {
  const [work, setWork] = useState<{ eventKey: string; value: EventWork } | null>(null)

  useEffect(() => {
    let current = true
    const load = (): void =>
      void window.segretarioApi
        .eventWork(eventKey)
        .then((value) => current && setWork({ eventKey, value }))

    load()
    const unsubscribe = window.segretarioApi.onWorkChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [eventKey])

  return work?.eventKey === eventKey ? work.value : null
}

/** Whose the event is, in words: as the Segretario found it, as the user said it, or not theirs. */
function whoseWords(whose: EventWhose): string {
  if (whose.yours) {
    return whose.by === 'utente' ? 'Tuo: l’hai detto tu' : 'Tuo, per il Segretario'
  }

  return whose.by === 'utente' ? 'Non tuo: l’hai detto tu' : 'Non è tra i tuoi eventi'
}

/**
 * Whose the event is, where a word counts (§7.4) — in a calendar shared,
 * one the calendar does not say is the user's —, and the user's word to
 * put it right: it stands, and teaches the Segretario.
 */
function WhoseRow({ eventKey, whose }: { eventKey: string; whose: EventWhose }): React.JSX.Element {
  const [saving, setSaving] = useState(false)

  const say = async (yours: boolean): Promise<void> => {
    setSaving(true)

    try {
      await window.segretarioApi.setEventYours(eventKey, yours)
    } catch (error) {
      toast.error('Non è stato salvato', {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[12px]">
      {whose.by === 'segretario' && <CompassStar className="text-ai-star size-3.5 shrink-0" />}
      <span className="min-w-0 truncate" title={whose.reason ?? undefined}>
        {whoseWords(whose)}
        {whose.reason ? ` — ${whose.reason}` : ''}
      </span>
      <button
        type="button"
        disabled={saving}
        onClick={() => void say(!whose.yours)}
        className="hover:text-foreground focus-visible:ring-ring/60 shrink-0 rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2 disabled:no-underline"
      >
        {whose.yours ? 'Non è mio' : 'È mio'}
      </button>
    </p>
  )
}

/**
 * An event's share of the work, as the reader shows a message's: the
 * projects it belongs to, the open things born from it, and one more to
 * add — due on the event's day, what it takes to be ready for it.
 */
export function EventWorkSection({ event }: { event: CalendarEvent }): React.JSX.Element | null {
  const work = useEventWork(event.key)
  const openLink = useOpenLink()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  if (!work) {
    return null
  }

  const add = async (): Promise<void> => {
    const said = text.trim()

    if (!said || saving) {
      return
    }

    setSaving(true)

    try {
      await window.segretarioApi.openCommitment(
        { kind: 'event', eventKey: event.key },
        {
          kind: 'da_fare',
          text: said,
          due: event.allDay ? event.start.slice(0, 10) : dayKey(new Date(event.start))
        }
      )
      setText('')
    } catch (error) {
      toast.error('Non è stata aggiunta', {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {work.whose && <WhoseRow eventKey={event.key} whose={work.whose} />}
      {work.projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {work.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() =>
                openLink({
                  handle: '',
                  kind: 'project',
                  projectId: project.id,
                  title: project.title
                })
              }
              className="bg-hover text-foreground hover:bg-selected focus-visible:ring-ring/60 flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium outline-none focus-visible:ring-2"
            >
              <Briefcase className="text-faint-foreground size-3" />
              {project.title}
            </button>
          ))}
        </div>
      )}
      {work.commitments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-ai flex items-center gap-1.5 text-[12px] font-semibold">
            <CompassStar className="text-ai-star size-3.5" />
            Da fare per questo incontro
          </p>
          <ul className="flex flex-col gap-1.5">
            {work.commitments.map((commitment) => (
              <CommitmentRow key={commitment.id} commitment={commitment} />
            ))}
          </ul>
        </div>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(formEvent) => {
          formEvent.preventDefault()
          void add()
        }}
      >
        <Plus className="text-faint-foreground size-3.5 shrink-0" />
        <Input
          value={text}
          disabled={saving}
          aria-label="Una cosa da fare per questo incontro"
          placeholder="Una cosa da fare per questo incontro"
          onChange={(change) => setText(change.target.value)}
          className="focus-visible:border-border h-8 border-transparent bg-transparent text-[12.5px] shadow-none"
        />
      </form>
    </div>
  )
}
