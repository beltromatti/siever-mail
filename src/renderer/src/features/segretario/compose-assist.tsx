import { useState } from 'react'
import { ArrowUp, LoaderCircle, PenLine } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'

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
 * lines above the signature; "Annulla" puts them back.
 */
export function ComposeAssist({
  open,
  onOpenChange,
  disabled,
  isReply,
  hasText,
  onAsk,
  onUndo
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  /** A reply or a forward: with nothing written, it can write the answer. */
  isReply: boolean
  hasText: boolean
  onAsk: (instruction: string) => Promise<void>
  /** Puts back what was written before its last rewrite; undefined when there is none. */
  onUndo?: () => void
}): React.JSX.Element {
  const [instruction, setInstruction] = useState('')
  const [writing, setWriting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const keys = useCommandKeys('segretario-write')
  const suggestions = hasText ? REWRITES : isReply ? ['Scrivi la risposta'] : []

  const ask = async (text: string): Promise<void> => {
    const trimmed = text.trim()

    if (!trimmed || writing) {
      return
    }

    setWriting(true)
    setProblem(null)

    try {
      await onAsk(trimmed)
      setInstruction('')
      onOpenChange(false)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Non sono riuscito a scrivere.')
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
              <PenLine className="size-3.5" />
            )}
            Segretario
            {keys && <ShortcutKeys keys={keys} className="ml-0.5" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="flex w-[380px] flex-col gap-2 p-2.5">
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
                hasText
                  ? 'Come lo riscrivo?'
                  : isReply
                    ? 'Cosa rispondo? Anche solo «sì, ma giovedì»'
                    : 'Cosa scrivo, e a chi?'
              }
              className="field placeholder:text-faint-foreground min-h-[52px] flex-1 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] leading-[1.45] outline-none"
            />
            <IconButton
              type="submit"
              label="Scrivi"
              variant="default"
              className="size-[28px] rounded-full"
              disabled={!instruction.trim() || writing}
            >
              {writing ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <ArrowUp className="size-3.5" />
              )}
            </IconButton>
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
              <LoaderCircle className="text-ai size-3 animate-spin" />
              Scrivo come scriveresti tu…
            </p>
          )}
          {problem && <p className="text-destructive-soft-foreground text-[11.5px]">{problem}</p>}
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
