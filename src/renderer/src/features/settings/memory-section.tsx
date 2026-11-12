import { useEffect, useRef, useState } from 'react'
import { ChevronRight, History, LoaderCircle, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import {
  ActionRow,
  SettingsEmpty,
  SettingsGroup,
  SettingsLoading,
  SettingsNotice,
  SettingsPage
} from '@renderer/components/ui/settings'
import { Textarea } from '@renderer/components/ui/textarea'
import { hourStyle, languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import type { ConnectionLearning, MemoryNote, MemoryVersion } from '@shared/segretario'

const MESSAGES = defineMessages({
  historyUnreadable: {
    en: 'The history can’t be read',
    it: 'La storia non si legge',
    de: 'Die Versionsgeschichte lässt sich nicht lesen'
  },
  correctedByYou: {
    en: (when: string) => `corrected by you, ${when}`,
    it: (when: string) => `corretta da te, ${when}`,
    de: (when: string) => `von Ihnen korrigiert, ${when}`
  },
  noteText: {
    en: (path: string) => `Text of the note ${path}`,
    it: (path: string) => `Testo della nota ${path}`,
    de: (path: string) => `Text der Notiz ${path}`
  },
  save: { en: 'Save', it: 'Salva', de: 'Speichern' },
  cancel: { en: 'Cancel', it: 'Annulla', de: 'Abbrechen' },
  hideHistory: { en: 'Hide history', it: 'Nascondi la storia', de: 'Versionen ausblenden' },
  history: { en: 'History', it: 'Storia', de: 'Versionen' },
  noVersions: {
    en: 'No earlier version.',
    it: 'Nessuna versione precedente.',
    de: 'Keine frühere Version.'
  },
  byYou: { en: 'by you', it: 'da te', de: 'von Ihnen' },
  bySegretario: { en: 'by the Segretario', it: 'dal Segretario', de: 'vom Segretario' },
  restore: { en: 'Restore', it: 'Ripristina', de: 'Wiederherstellen' },
  unreadable: {
    en: 'The Segretario’s memory can’t be read.',
    it: 'Impossibile leggere la memoria del Segretario.',
    de: 'Das Gedächtnis des Segretario lässt sich nicht lesen.'
  },
  loading: {
    en: 'Loading the memory…',
    it: 'Caricamento della memoria…',
    de: 'Gedächtnis wird geladen…'
  },
  conoscimiText: {
    en: 'The Segretario reads your mail, calendars and folders to understand who you are, how you work, with whom and on what, and takes notes. Doing it again updates what it knows, without erasing it.',
    it: 'Il Segretario legge la tua posta, i tuoi calendari e le tue cartelle per capire chi sei, come lavori, con chi e su cosa, e prende appunti. Rifarlo aggiorna quello che sa, senza cancellarlo.',
    de: 'Der Segretario liest Ihre E-Mails, Kalender und Ordner, um zu verstehen, wer Sie sind, wie Sie arbeiten, mit wem und woran, und macht sich Notizen. Ein erneuter Durchgang ergänzt, was er weiß, ohne es zu löschen.'
  },
  redo: {
    en: (name: string) => `Run “${name}” again`,
    it: (name: string) => `Rifai ${name}`,
    de: (name: string) => `„${name}“ erneut ausführen`
  },
  introduce: { en: 'Introduce yourself', it: 'Fatti conoscere', de: 'Stellen Sie sich vor' },
  doneAt: {
    en: (when: string) => `Known since ${when}`,
    it: (when: string) => `Conosciuta ${when}`,
    de: (when: string) => `Bekannt seit ${when}`
  },
  notes: { en: 'Notes', it: 'Note', de: 'Notizen' },
  notesText: {
    en: 'What the Segretario knows: about you, your way of writing, the people and the matters at hand. It writes and updates them as it works; correct them when it’s wrong: that’s how it learns.',
    it: 'Quello che il Segretario sa: di te, del tuo modo di scrivere, delle persone e delle questioni. Le scrive e le aggiorna lui mentre lavora; correggile quando sbaglia: da lì impara.',
    de: 'Was der Segretario weiß: über Sie, Ihre Art zu schreiben, die Menschen und die Angelegenheiten. Er schreibt und aktualisiert sie, während er arbeitet; korrigieren Sie sie, wenn er sich irrt: Daraus lernt er.'
  },
  noNotes: { en: 'No notes yet.', it: 'Nessuna nota, per ora.', de: 'Noch keine Notizen.' },
  noteNotSaved: { en: 'Note not saved', it: 'Nota non salvata', de: 'Notiz nicht gespeichert' },
  versionNotRestored: {
    en: 'Version not restored',
    it: 'Versione non ripristinata',
    de: 'Version nicht wiederhergestellt'
  }
})

const LEARNING_STATE = defineMessages({
  waiting: { en: 'To get to know', it: 'Da conoscere', de: 'Noch kennenzulernen' },
  running: { en: 'At work…', it: 'Al lavoro…', de: 'Bei der Arbeit…' },
  done: { en: 'Known', it: 'Conosciuta', de: 'Bekannt' }
}) satisfies Record<ConnectionLearning['state'], unknown>

/** What became of a note in a version, by the action that made it. */
const VERSION_ACTIONS = defineMessages({
  scrivi: { en: 'written', it: 'scritta', de: 'geschrieben' },
  modifica: { en: 'corrected', it: 'corretta', de: 'korrigiert' },
  inserisci: { en: 'expanded', it: 'ampliata', de: 'erweitert' },
  rinomina: { en: 'renamed', it: 'rinominata', de: 'umbenannt' },
  elimina: { en: 'deleted', it: 'cancellata', de: 'gelöscht' },
  ripristina: { en: 'restored', it: 'ripristinata', de: 'wiederhergestellt' }
})

/** When a note changed: the day and the time, as the region writes them. */
function when(at: number): string {
  return new Intl.DateTimeFormat(languageNow().formatLocale, {
    day: 'numeric',
    month: 'short',
    hour: hourStyle(),
    minute: '2-digit'
  }).format(at)
}

/** A note's first line: what it is about, as the index shows it. */
function headline(content: string): string {
  return (
    content
      .split('\n')
      .find((line) => line.trim())
      ?.replace(/^#+\s*/, '')
      .trim() ?? ''
  )
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim() ? error.message : undefined
}

function NoteRow({
  note,
  onSave,
  onRestore
}: {
  note: MemoryNote
  onSave: (content: string) => Promise<void>
  onRestore: (revision: number) => Promise<void>
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const actions: Readonly<Record<string, string | undefined>> = useMessages(VERSION_ACTIONS)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(note.content)
  const [stored, setStored] = useState(note.content)
  const [saving, setSaving] = useState(false)

  // A note the Segretario rewrote meanwhile shows as it is now, unless the user is editing it.
  if (note.content !== stored) {
    setStored(note.content)

    if (draft === stored) {
      setDraft(note.content)
    }
  }

  const changed = draft !== note.content
  const [versions, setVersions] = useState<MemoryVersion[] | null>(null)

  const showHistory = async (): Promise<void> => {
    try {
      setVersions(versions ? null : await window.segretarioApi.memoryHistory(note.path))
    } catch (error) {
      toast.error(messagesNow(MESSAGES).historyUnreadable, { description: errorText(error) })
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)

    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-hover rounded-md">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            'text-faint-foreground size-3.5 shrink-0 transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium">{note.path}</span>
          <span className="text-muted-foreground block truncate text-[11px]">
            {headline(note.content)}
          </span>
        </span>
        <span className="text-faint-foreground shrink-0 text-[11px]">
          {note.updatedBy === 'utente'
            ? m.correctedByYou(when(note.updatedAt))
            : when(note.updatedAt)}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t px-3 py-2.5">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="voice min-h-40 text-[13.5px] leading-[1.5]"
            aria-label={m.noteText(note.path)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!changed || saving} onClick={() => void save()}>
              {saving && <LoaderCircle className="size-3.5 animate-spin" />}
              {m.save}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!changed || saving}
              onClick={() => setDraft(note.content)}
            >
              {m.cancel}
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => void showHistory()}>
              <History className="size-3.5" />
              {versions ? m.hideHistory : m.history}
            </Button>
          </div>
          {versions && (
            <ul className="flex flex-col gap-1 border-t pt-2">
              {versions.length === 0 && (
                <li className="text-muted-foreground text-[11.5px]">{m.noVersions}</li>
              )}
              {versions.map((version) => (
                <li key={version.revision} className="flex items-center gap-2 text-[11.5px]">
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {when(version.at)} · {actions[version.action] ?? version.action}
                    {version.actor === 'utente'
                      ? ` ${m.byYou}`
                      : version.actor === 'segretario'
                        ? ` ${m.bySegretario}`
                        : ''}
                  </span>
                  {version.revision !== note.revision && version.content !== null && (
                    <button
                      type="button"
                      onClick={() => void onRestore(version.revision).then(() => setVersions(null))}
                      className="text-foreground focus-visible:ring-ring/60 shrink-0 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
                    >
                      {m.restore}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Impostazioni › Cosa so di te: how far the Segretario knows each
 * connection — Conoscimi, to be done again when the user wants — and its
 * notes: every one readable, correctable and restorable to an earlier
 * version, because what it believes about the user is the user's to see.
 * Nothing is forgotten from here: half a memory over the rest of its work
 * would be a Segretario that knows less than what it did, and to start
 * again is «Dimentica tutto», in Segretario (§10, §12.1).
 */
export function MemorySection({
  onRedoConoscimi
}: {
  /** Conoscimi runs in the guided setup, on every connection, updating what it knows. */
  onRedoConoscimi: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const states = useMessages(LEARNING_STATE)
  const [learning, setLearning] = useState<ConnectionLearning[] | null>(null)
  const [notes, setNotes] = useState<MemoryNote[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const reloadTimer = useRef<number | null>(null)

  useEffect(() => {
    let current = true
    const load = (): Promise<void> =>
      Promise.all([window.segretarioApi.listLearning(), window.segretarioApi.listMemory()]).then(
        ([storedLearning, storedNotes]) => {
          if (current) {
            setLearning(storedLearning)
            setNotes(storedNotes)
          }
        }
      )

    load().catch((error: unknown) => {
      if (current) {
        setLoadError(errorText(error) ?? messagesNow(MESSAGES).unreadable)
      }
    })

    // While it works, its notes change: the page follows, a moment after.
    const unsubscribe = window.segretarioApi.onActivityEvent((event) => {
      if (event.type !== 'summary' && event.type !== 'entry') {
        return
      }

      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }

      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null
        void load().catch(() => undefined)
      }, 800)
    })

    return () => {
      current = false
      unsubscribe()

      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }
    }
  }, [])

  if (loadError) {
    return (
      <SettingsPage>
        <SettingsNotice tone="error">{loadError}</SettingsNotice>
      </SettingsPage>
    )
  }

  if (!learning || !notes) {
    return <SettingsLoading>{m.loading}</SettingsLoading>
  }

  const running = learning.some((connection) => connection.state === 'running')

  return (
    <SettingsPage>
      <SettingsGroup
        title={places.conoscimi}
        description={m.conoscimiText}
        action={
          <Button variant="outline" size="sm" disabled={running} onClick={onRedoConoscimi}>
            {running ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            {learning.some((connection) => connection.state === 'done')
              ? m.redo(places.conoscimi)
              : m.introduce}
          </Button>
        }
      >
        {learning.map((connection) => (
          <ActionRow
            key={connection.key}
            title={connection.label}
            description={
              connection.state === 'done' && connection.finishedAt
                ? m.doneAt(when(connection.finishedAt))
                : states[connection.state]
            }
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title={m.notes} description={m.notesText}>
        {notes.length === 0 ? (
          <SettingsEmpty>{m.noNotes}</SettingsEmpty>
        ) : (
          notes.map((note) => (
            <NoteRow
              key={note.path}
              note={note}
              onSave={async (content) => {
                try {
                  setNotes(
                    await window.segretarioApi.writeMemory(note.path, content, note.revision)
                  )
                } catch (error) {
                  toast.error(messagesNow(MESSAGES).noteNotSaved, { description: errorText(error) })
                }
              }}
              onRestore={async (revision) => {
                try {
                  setNotes(await window.segretarioApi.restoreMemory(note.path, revision))
                } catch (error) {
                  toast.error(messagesNow(MESSAGES).versionNotRestored, {
                    description: errorText(error)
                  })
                }
              }}
            />
          ))
        )}
      </SettingsGroup>
    </SettingsPage>
  )
}
