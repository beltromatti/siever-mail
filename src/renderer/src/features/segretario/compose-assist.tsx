import { useRef, useState } from 'react'
import { ArrowUp, LoaderCircle, RotateCcw, Square } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'

import { useAiWaiting } from './use-segretario'

const REWRITES = [
  'Più breve',
  'Più formale',
  'Più cordiale',
  'Correggi gli errori',
  'In inglese'
] as const

/**
 * The Segretario in the composer (⌘J): asked in a few words — or with one
 * of the usual requests — it writes the message, or rewrites what is
 * written, in the user's voice. What it writes takes the place of the
 * lines above the signature — or, with a passage selected, of that passage
 * alone; "Annulla" puts them back.
 */
export function ComposeAssist({
  open,
  onOpenChange,
  selection,
  disabled,
  isReply,
  hasText,
  onAsk,
  onStop,
  onUndo
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The passage selected when it was called: what it rewrites, alone. */
  selection: string | null
  disabled: boolean
  /** A reply or a forward: with nothing written, it can write the answer. */
  isReply: boolean
  hasText: boolean
  onAsk: (instruction: string) => Promise<void>
  /** Stops the writing under way: the message stays as it was. */
  onStop: () => void
  /** Puts back what was written before its last rewrite; undefined when there is none. */
  onUndo?: () => void
}): React.JSX.Element {
  const [instruction, setInstruction] = useState('')
  const [writing, setWriting] = useState(false)
  // What did not get written, with what was asked: "Riprova" asks it again (§14.2).
  const [problem, setProblem] = useState<{ message: string; asked: string } | null>(null)
  const waiting = useAiWaiting()
  // Stopped by the user: what it says on the way out is not a problem to show.
  const stopped = useRef(false)
  const keys = useCommandKeys('segretario-write')
  const suggestions = selection || hasText ? REWRITES : isReply ? ['Scrivi la risposta'] : []

  const ask = async (text: string): Promise<void> => {
    const trimmed = text.trim()

    if (!trimmed || writing) {
      return
    }

    setWriting(true)
    setProblem(null)
    stopped.current = false

    try {
      await onAsk(trimmed)
      setInstruction('')
      onOpenChange(false)
    } catch (error) {
      if (!stopped.current) {
        setProblem({
          message: error instanceof Error ? error.message : 'Non sono riuscito a scrivere.',
          asked: trimmed
        })
      }
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" disabled={disabled} className="text-ai">
            {writing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <CompassStar className="text-ai-star size-3.5" />
            )}
            Segretario
            {keys && <ShortcutKeys keys={keys} className="ml-0.5" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="flex w-[380px] flex-col gap-2 p-2.5">
          {selection && (
            <p className="text-muted-foreground border-ai-line border-l-2 pl-2 text-[11.5px]">
              <span className="text-ai font-semibold">Solo il passaggio selezionato · </span>
              <span className="voice line-clamp-2 italic">«{selection}»</span>
            </p>
          )}
          <form
            className="flex items-end gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              void ask(instruction)
            }}
          >
            <textarea
              autoFocus
              rows={2}
              value={instruction}
              disabled={writing}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void ask(instruction)
                }
              }}
              placeholder={
                selection
                  ? 'Come riscrivo questo passaggio?'
                  : hasText
                    ? 'Come lo riscrivo?'
                    : isReply
                      ? 'Cosa rispondo? Anche solo «sì, ma giovedì»'
                      : 'Cosa scrivo, e a chi?'
              }
              className="field placeholder:text-faint-foreground min-h-[52px] flex-1 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] leading-[1.45] outline-none"
            />
            {writing ? (
              <IconButton
                type="button"
                label="Ferma"
                variant="default"
                className="size-[28px] rounded-full"
                onClick={() => {
                  stopped.current = true
                  onStop()
                }}
              >
                <Square className="size-3 fill-current" />
              </IconButton>
            ) : (
              <IconButton
                type="submit"
                label="Scrivi"
                variant="default"
                className="size-[28px] rounded-full"
                disabled={!instruction.trim()}
              >
                <ArrowUp className="size-3.5" />
              </IconButton>
            )}
          </form>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={writing}
                  onClick={() => void ask(suggestion)}
                  className="text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 rounded-[6px] px-2 py-1 text-[11.5px] shadow-[inset_0_0_0_1px_hsl(var(--border))] outline-none focus-visible:ring-2"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {writing && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
              <LoaderCircle className="text-ai size-3 shrink-0 animate-spin" />
              {waiting ?? 'Scrivo come scriveresti tu…'}
            </p>
          )}
          {problem && !writing && (
            <div className="flex items-start gap-2">
              <p className="text-destructive-soft-foreground min-w-0 flex-1 text-[11.5px]">
                {problem.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-6 shrink-0 px-2 text-[11px]"
                onClick={() => void ask(problem.asked)}
              >
                <RotateCcw className="size-3" />
                Riprova
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {onUndo && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onUndo}>
          Annulla
        </Button>
      )}
    </div>
  )
}
