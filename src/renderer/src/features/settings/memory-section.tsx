import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, History, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/utils'
import type { ConnectionLearning, MemoryNote, MemoryVersion } from '@shared/segretario'

const WHEN = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

const LEARNING_STATE: Readonly<Record<ConnectionLearning['state'], string>> = {
  waiting: 'Da conoscere',
  running: 'Al lavoro…',
  done: 'Conosciuta'
}

const VERSION_ACTIONS: Readonly<Record<string, string>> = {
  scrivi: 'scritta',
  modifica: 'corretta',
  inserisci: 'ampliata',
  rinomina: 'rinominata',
  elimina: 'cancellata',
  ripristina: 'ripristinata'
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
  onDelete,
  onRestore
}: {
  note: MemoryNote
  onSave: (content: string) => Promise<void>
  onDelete: () => Promise<void>
  onRestore: (revision: number) => Promise<void>
}): React.JSX.Element {
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
      toast.error('La storia non si legge', { description: errorText(error) })
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
          {note.updatedBy === 'utente' ? 'corretta da te, ' : ''}
          {WHEN.format(note.updatedAt)}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t px-3 py-2.5">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="voice min-h-40 text-[13.5px] leading-[1.5]"
            aria-label={`Testo della nota ${note.path}`}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!changed || saving} onClick={() => void save()}>
              {saving && <LoaderCircle className="size-3.5 animate-spin" />}
              Salva
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!changed || saving}
              onClick={() => setDraft(note.content)}
            >
              Annulla
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => void showHistory()}>
              <History className="size-3.5" />
              {versions ? 'Nascondi la storia' : 'Storia'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={saving}
              onClick={() => void onDelete()}
            >
              <Trash2 className="size-3.5" />
              Dimentica questa nota
            </Button>
          </div>
          {versions && (
            <ul className="flex flex-col gap-1 border-t pt-2">
              {versions.length === 0 && (
                <li className="text-muted-foreground text-[11.5px]">
                  Nessuna versione precedente.
                </li>
              )}
              {versions.map((version) => (
                <li key={version.revision} className="flex items-center gap-2 text-[11.5px]">
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {WHEN.format(version.at)} · {VERSION_ACTIONS[version.action] ?? version.action}
                    {version.actor === 'utente'
                      ? ' da te'
                      : version.actor === 'segretario'
                        ? ' dal Segretario'
                        : ''}
                  </span>
                  {version.revision !== note.revision && version.content !== null && (
                    <button
                      type="button"
                      onClick={() => void onRestore(version.revision).then(() => setVersions(null))}
                      className="text-foreground focus-visible:ring-ring/60 shrink-0 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
                    >
                      Ripristina
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
 * notes: every one readable, correctable, restorable to an earlier
 * version and deletable, because what it believes about the user is the
 * user's to see.
 */
export function MemorySection({
  onRedoConoscimi
}: {
  /** Conoscimi runs in the guided setup, on every connection, updating what it knows. */
  onRedoConoscimi: () => void
}): React.JSX.Element {
  const [learning, setLearning] = useState<ConnectionLearning[] | null>(null)
  const [notes, setNotes] = useState<MemoryNote[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const reloadTimer = useRef<number | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const [storedLearning, storedNotes] = await Promise.all([
      window.segretarioApi.listLearning(),
      window.segretarioApi.listMemory()
    ])
    setLearning(storedLearning)
    setNotes(storedNotes)
  }, [])

  useEffect(() => {
    reload().catch((error: unknown) =>
      setLoadError(errorText(error) ?? 'Impossibile leggere la memoria del Segretario.')
    )

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
        void reload().catch(() => undefined)
      }, 800)
    })

    return () => {
      unsubscribe()

      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }
    }
  }, [reload])

  const forgetEverything = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Dimenticare tutto?',
      description:
        'Il Segretario cancella tutte le sue note su di te, sulle persone e sulle questioni, e cosa sa delle connessioni: Conoscimi è da rifare. Le cose aperte, i progetti e le note dei messaggi restano.',
      confirmLabel: 'Dimentica tutto',
      cancelLabel: 'Annulla',
      destructive: true
    })

    if (!confirmed) {
      return
    }

    setBusy(true)

    try {
      await window.segretarioApi.forgetEverything()
      await reload()
    } catch (error) {
      toast.error('Memoria non cancellata', { description: errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="text-destructive-soft-foreground border-destructive/35 bg-destructive/10 mt-4 rounded-md border px-3 py-2 text-[12px]">
        {loadError}
      </div>
    )
  }

  if (!learning || !notes) {
    return (
      <div className="text-muted-foreground mt-4 flex items-center gap-2 text-[12px]">
        <LoaderCircle className="size-4 animate-spin" />
        Caricamento della memoria…
      </div>
    )
  }

  const running = learning.some((connection) => connection.state === 'running')

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div className="settings-group flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Conoscimi</p>
            <p className="text-muted-foreground mt-1 text-[11px]">
              Il Segretario legge la tua posta, i tuoi calendari e le tue cartelle per capire chi
              sei, come lavori, con chi e su cosa, e prende appunti. Rifarlo aggiorna quello che sa,
              senza cancellarlo.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={running}
            onClick={onRedoConoscimi}
          >
            {running ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            {learning.some((connection) => connection.state === 'done')
              ? 'Rifai Conoscimi'
              : 'Fatti conoscere'}
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          {learning.map((connection) => (
            <div
              key={connection.accountId}
              className="bg-hover flex items-center gap-3 rounded-md px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{connection.email}</span>
                <span className="text-muted-foreground block text-[11px]">
                  {connection.state === 'done' && connection.finishedAt
                    ? `${LEARNING_STATE.done} ${WHEN.format(connection.finishedAt)}`
                    : LEARNING_STATE[connection.state]}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-group flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Note</p>
            <p className="text-muted-foreground mt-1 text-[11px]">
              Quello che il Segretario sa: di te, del tuo modo di scrivere, delle persone e delle
              questioni. Le scrive e le aggiorna lui mentre lavora; correggile quando sbaglia: da lì
              impara.
            </p>
          </div>
          {notes.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive shrink-0"
              disabled={busy}
              onClick={() => void forgetEverything()}
            >
              {busy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Dimentica tutto
            </Button>
          )}
        </div>

        {notes.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-[12px]">
            Nessuna nota, per ora.
          </div>
        ) : (
          notes.map((note) => (
            <NoteRow
              key={note.path}
              note={note}
              onSave={async (content) => {
                try {
                  setNotes(await window.segretarioApi.writeMemory(note.path, content))
                } catch (error) {
                  toast.error('Nota non salvata', { description: errorText(error) })
                }
              }}
              onDelete={async () => {
                try {
                  setNotes(await window.segretarioApi.deleteMemory(note.path))
                } catch (error) {
                  toast.error('Nota non cancellata', { description: errorText(error) })
                }
              }}
              onRestore={async (revision) => {
                try {
                  setNotes(await window.segretarioApi.restoreMemory(note.path, revision))
                } catch (error) {
                  toast.error('Versione non ripristinata', { description: errorText(error) })
                }
              }}
            />
          ))
        )}
      </div>

      {confirmDialog}
    </div>
  )
}
