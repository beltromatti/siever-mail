import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/utils'
import type { AccountLearning, MemoryNote, SegretarioPreferences } from '@shared/segretario'

const WHEN = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

const LEARNING_STATE: Readonly<Record<AccountLearning['state'], string>> = {
  waiting: 'Da conoscere',
  running: 'Al lavoro…',
  done: 'Conosciuto',
  stopped: 'Fermato'
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
  onDelete
}: {
  note: MemoryNote
  onSave: (content: string) => Promise<void>
  onDelete: () => Promise<void>
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
        </div>
      )}
    </div>
  )
}

/**
 * Impostazioni › Cosa so di te: whether the Segretario learns from the
 * user, how far it has got with each account, and its notes — every one
 * readable, correctable and deletable, because what it believes about the
 * user is the user's to see.
 */
export function MemorySection(): React.JSX.Element {
  const [preferences, setPreferences] = useState<SegretarioPreferences | null>(null)
  const [learning, setLearning] = useState<AccountLearning[] | null>(null)
  const [notes, setNotes] = useState<MemoryNote[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const reloadTimer = useRef<number | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const [storedPreferences, storedLearning, storedNotes] = await Promise.all([
      window.segretarioApi.getPreferences(),
      window.segretarioApi.listLearning(),
      window.segretarioApi.listMemory()
    ])
    setPreferences(storedPreferences)
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

  const changeLearning = async (enabled: boolean): Promise<void> => {
    if (!preferences) {
      return
    }

    try {
      setPreferences(
        await window.segretarioApi.setPreferences({ ...preferences, learning: enabled })
      )
      setLearning(await window.segretarioApi.listLearning())
    } catch (error) {
      toast.error('Impostazione non salvata', { description: errorText(error) })
    }
  }

  const relearn = async (account: AccountLearning): Promise<void> => {
    try {
      setLearning(await window.segretarioApi.relearnAccount(account.accountId))
    } catch (error) {
      toast.error('Non riesco a ricominciare', { description: errorText(error) })
    }
  }

  const forgetEverything = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Dimenticare tutto?',
      description:
        'Il Segretario cancella tutte le sue note su di te, sulle persone e sulle questioni. Se l’apprendimento è attivo, ricomincia a conoscerti da capo.',
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

  if (!preferences || !learning || !notes) {
    return (
      <div className="text-muted-foreground mt-4 flex items-center gap-2 text-[12px]">
        <LoaderCircle className="size-4 animate-spin" />
        Caricamento della memoria…
      </div>
    )
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div className="settings-group flex flex-col gap-3">
        <label
          htmlFor="segretario-learning"
          className="flex cursor-pointer items-center justify-between gap-3"
        >
          <span className="min-w-0">
            <span className="block text-[12px] font-medium">Impara a conoscermi</span>
            <span className="text-muted-foreground block text-[11px]">
              Legge la posta che hai scritto da ogni account e prende appunti; poi impara da come
              correggi le sue bozze. Gli appunti restano su questo computer.
              {preferences.learning === null && ' Non hai ancora deciso.'}
            </span>
          </span>
          <Switch
            id="segretario-learning"
            checked={preferences.learning === true}
            onCheckedChange={(enabled) => void changeLearning(enabled)}
          />
        </label>

        {preferences.learning === true && (
          <div className="flex flex-col gap-1.5">
            {learning.map((account) => (
              <div
                key={account.accountId}
                className="bg-hover flex items-center gap-3 rounded-md px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{account.email}</span>
                  <span className="text-muted-foreground block text-[11px]">
                    {account.state === 'done' && account.finishedAt
                      ? `${LEARNING_STATE.done} ${WHEN.format(account.finishedAt)}`
                      : account.state === 'waiting'
                        ? 'Comincia quando la posta recente di questo account è indicizzata.'
                        : LEARNING_STATE[account.state]}
                  </span>
                </span>
                {(account.state === 'done' || account.state === 'stopped') && (
                  <Button variant="outline" size="sm" onClick={() => void relearn(account)}>
                    <RotateCcw className="size-3.5" />
                    {account.state === 'done' ? 'Rifai' : 'Riprendi'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-group flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Note</p>
            <p className="text-muted-foreground mt-1 text-[11px]">
              Quello che il Segretario sa: di te, del tuo modo di scrivere, delle persone e delle
              questioni. Le scrive e le aggiorna lui mentre lavora; correggile quando sbaglia.
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
            />
          ))
        )}
      </div>

      {confirmDialog}
    </div>
  )
}
