import { useEffect, useState } from 'react'
import { Briefcase, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { Input } from '@renderer/components/ui/input'
import { dayKey } from '@renderer/features/calendar/calendar-dates'
import { CommitmentRow } from '@renderer/features/segretario/commitment-row'
import { LinkedWords, useOpenLink } from '@renderer/features/segretario/segretario-text'
import {
  dimmedBy,
  PendingWordsLine,
  RewriteField,
  useWorkWords,
  WorkMenu
} from '@renderer/features/segretario/work-words'
import { useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent } from '@shared/calendar'
import { defineMessages, type Messages } from '@shared/i18n'
import type { EventWhose, EventWork, LinkedText } from '@shared/segretario'

const MESSAGES = defineMessages({
  yoursByUser: {
    en: 'Yours: you said so',
    it: 'Tuo: l’hai detto tu',
    de: 'Ihrer: Sie haben es gesagt'
  },
  yoursBySegretario: {
    en: 'Yours, according to the Segretario',
    it: 'Tuo, per il Segretario',
    de: 'Ihrer, laut dem Segretario'
  },
  notYoursByUser: {
    en: 'Not yours: you said so',
    it: 'Non tuo: l’hai detto tu',
    de: 'Nicht Ihrer: Sie haben es gesagt'
  },
  notYours: {
    en: 'Not among your events',
    it: 'Non è tra i tuoi eventi',
    de: 'Nicht unter Ihren Terminen'
  },
  notSaved: { en: 'It was not saved', it: 'Non è stato salvato', de: 'Es wurde nicht gespeichert' },
  notMine: { en: 'Not mine', it: 'Non è mio', de: 'Nicht meiner' },
  mine: { en: 'It’s mine', it: 'È mio', de: 'Das ist meiner' },
  notAdded: {
    en: 'It was not added',
    it: 'Non è stata aggiunta',
    de: 'Es wurde nicht hinzugefügt'
  },
  toDo: {
    en: 'To do for this meeting',
    it: 'Da fare per questo incontro',
    de: 'Für diese Besprechung zu tun'
  },
  addToDo: {
    en: 'Something to do for this meeting',
    it: 'Una cosa da fare per questo incontro',
    de: 'Eine Aufgabe für diese Besprechung'
  },
  prepare: { en: 'To prepare', it: 'Per prepararti', de: 'Zur Vorbereitung' }
})

/** What the Segretario wrote to prepare for an event, kept current while it and the user change it. */
function useEventPrep(eventKey: string): (LinkedText & { writtenAt: number }) | null {
  const [prep, setPrep] = useState<{
    eventKey: string
    value: (LinkedText & { writtenAt: number }) | null
  } | null>(null)

  useEffect(() => {
    let current = true
    const load = (): void =>
      void window.segretarioApi
        .eventPrep(eventKey)
        .then((value) => current && setPrep({ eventKey, value }))

    load()
    const unsubscribe = window.segretarioApi.onWorkChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [eventKey])

  return prep?.eventKey === eventKey ? prep.value : null
}

/**
 * How to prepare for a meeting, as the Segretario wrote it, with the user's
 * word on it (vision §10.1): rewritten in place, or corrected in words — then
 * dimmed, until the Segretario has put it right.
 */
export function EventPrepSection({ eventKey }: { eventKey: string }): React.JSX.Element | null {
  const m = useMessages(MESSAGES)
  const prep = useEventPrep(eventKey)
  const words = useWorkWords()
  const [editing, setEditing] = useState(false)

  if (!prep) {
    return null
  }

  const target = { kind: 'preparazione', eventKey } as const

  return (
    <div className="group/prep flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <p className="text-ai flex min-w-0 flex-1 items-center gap-1.5 text-[12px] font-semibold">
          <CompassStar className="text-ai-star size-3.5" />
          {m.prepare}
        </p>
        {!editing && (
          <WorkMenu
            target={target}
            pending={prep.pending}
            about={prep.text}
            words={words}
            onRewrite={() => setEditing(true)}
            label={m.prepare}
            className="opacity-0 group-hover/prep:opacity-100"
          />
        )}
      </div>
      {editing ? (
        <RewriteField
          target={target}
          text={prep.text}
          label={m.prepare}
          onDone={() => setEditing(false)}
          className="text-[13px] leading-[1.5]"
        />
      ) : (
        <div className="border-ai-line flex flex-col gap-1 border-l-2 pl-2.5">
          <LinkedWords
            text={prep.text}
            links={prep.links}
            className={cn('text-foreground text-[13.5px] leading-[1.5]', dimmedBy(prep.pending))}
          />
          <PendingWordsLine pending={prep.pending} />
        </div>
      )}
      {words.dialogs}
    </div>
  )
}

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
function whoseWords(m: Messages<typeof MESSAGES>, whose: EventWhose): string {
  if (whose.yours) {
    return whose.by === 'utente' ? m.yoursByUser : m.yoursBySegretario
  }

  return whose.by === 'utente' ? m.notYoursByUser : m.notYours
}

/**
 * Whose the event is, where a word counts (§7.4) — in a calendar shared,
 * one the calendar does not say is the user's —, and the user's word to
 * put it right: it stands, and teaches the Segretario.
 */
function WhoseRow({ eventKey, whose }: { eventKey: string; whose: EventWhose }): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [saving, setSaving] = useState(false)

  const say = async (yours: boolean): Promise<void> => {
    setSaving(true)

    try {
      await window.segretarioApi.setEventYours(eventKey, yours)
    } catch (error) {
      toast.error(m.notSaved, {
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
        {whoseWords(m, whose)}
        {whose.reason ? ` — ${whose.reason}` : ''}
      </span>
      <button
        type="button"
        disabled={saving}
        onClick={() => void say(!whose.yours)}
        className="hover:text-foreground focus-visible:ring-ring/60 shrink-0 rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2 disabled:no-underline"
      >
        {whose.yours ? m.notMine : m.mine}
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
  const m = useMessages(MESSAGES)
  const work = useEventWork(event.key)
  const openLink = useOpenLink()
  const words = useWorkWords()
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
      toast.error(m.notAdded, {
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
            {m.toDo}
          </p>
          <ul className="flex flex-col gap-1.5">
            {work.commitments.map((commitment) => (
              <CommitmentRow key={commitment.id} commitment={commitment} words={words} />
            ))}
          </ul>
        </div>
      )}
      {words.dialogs}
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
          aria-label={m.addToDo}
          placeholder={m.addToDo}
          onChange={(change) => setText(change.target.value)}
          className="focus-visible:border-border h-8 border-transparent bg-transparent text-[12.5px] shadow-none"
        />
      </form>
    </div>
  )
}
