import { useState } from 'react'
import { FolderPlus, LoaderCircle, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'

/**
 * Above the list of a search asked in words: the question as the user put
 * it, and keeping it — a folder in the sidebar that is searched again each
 * time it opens — or, for one kept, letting it go.
 */
export function SearchBanner({
  question,
  saved,
  onSave,
  onRemove
}: {
  question: string
  saved: boolean
  onSave: () => Promise<void>
  onRemove: () => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  return (
    <section
      aria-label="Ricerca del Segretario"
      className="border-ai-line bg-ai-soft/25 flex shrink-0 items-center gap-2 border-b px-4 py-2.5"
    >
      <CompassStar className="text-ai-star size-3.5" />
      <span className="min-w-0 flex-1">
        <span className="voice text-foreground line-clamp-2 text-[13.5px] italic">
          «{question}»
        </span>
        {saved && (
          <span className="text-muted-foreground block text-[11px]">
            Cartella del Segretario: ogni volta che la apri cerca di nuovo.
          </span>
        )}
      </span>
      {saved ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground shrink-0"
          disabled={busy}
          onClick={() => run(onRemove)}
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          Togli dalle cartelle
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={() => run(onSave)}
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <FolderPlus className="size-3.5" />
          )}
          Tienila come cartella
        </Button>
      )}
    </section>
  )
}
