import { useState } from 'react'
import { FolderPlus, LoaderCircle, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { useMessages } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  label: {
    en: 'The Segretario’s search',
    it: 'Ricerca del Segretario',
    de: 'Suche des Segretario'
  },
  question: {
    en: (question: string) => `“${question}”`,
    it: (question: string) => `«${question}»`,
    de: (question: string) => `„${question}“`
  },
  saved: {
    en: 'A Segretario folder: it searches again each time you open it.',
    it: 'Cartella del Segretario: ogni volta che la apri cerca di nuovo.',
    de: 'Ordner des Segretario: Er sucht jedes Mal neu, wenn Sie ihn öffnen.'
  },
  remove: {
    en: 'Remove from folders',
    it: 'Togli dalle cartelle',
    de: 'Aus den Ordnern entfernen'
  },
  keep: { en: 'Keep as a folder', it: 'Tienila come cartella', de: 'Als Ordner behalten' }
})

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
  const m = useMessages(MESSAGES)
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  return (
    <section
      aria-label={m.label}
      className="border-ai-line bg-ai-soft/25 flex shrink-0 items-center gap-2 border-b px-4 py-2.5"
    >
      <CompassStar className="text-ai-star size-3.5" />
      <span className="min-w-0 flex-1">
        <span className="voice text-foreground line-clamp-2 text-[13.5px] italic">
          {m.question(question)}
        </span>
        {saved && <span className="text-muted-foreground block text-[11px]">{m.saved}</span>}
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
          {m.remove}
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
          {m.keep}
        </Button>
      )}
    </section>
  )
}
