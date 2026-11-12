import { useCallback, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Textarea } from '@renderer/components/ui/textarea'
import { messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import type { Commitment, PendingWords, WorkTarget } from '@shared/segretario'
import { plainWords } from '@shared/segretario-links'

/**
 * The user's three gestures on what the Segretario wrote (vision §10.1), in
 * the same words wherever they show: a menu of their own, a menu of the
 * thing, a native one.
 */
export const WORK_WORDS = defineMessages({
  rewrite: { en: 'Rewrite', it: 'Riscrivi', de: 'Umschreiben' },
  correct: { en: 'Correct…', it: 'Correggi…', de: 'Korrigieren…' },
  answer: { en: 'Answer…', it: 'Rispondi…', de: 'Antworten…' },
  withdrawCorrection: {
    en: 'Cancel the correction',
    it: 'Annulla la correzione',
    de: 'Korrektur zurücknehmen'
  },
  withdrawAnswer: {
    en: 'Take back the answer',
    it: 'Annulla la risposta',
    de: 'Antwort zurücknehmen'
  }
})

const MESSAGES = defineMessages({
  correctTitle: {
    en: 'What needs correcting?',
    it: 'Cosa c’è da correggere?',
    de: 'Was ist zu korrigieren?'
  },
  correctHint: {
    en: 'Say it in your own words: the Segretario puts it right, and remembers it next time.',
    it: 'Dillo a parole tue: il Segretario rimette a posto, e la prossima volta se ne ricorda.',
    de: 'Sagen Sie es mit Ihren Worten: Der Segretario bringt es in Ordnung und merkt es sich für das nächste Mal.'
  },
  answerTitle: {
    en: 'Answer the Segretario',
    it: 'Rispondi al Segretario',
    de: 'Dem Segretario antworten'
  },
  rewriteTitle: { en: 'Rewrite', it: 'Riscrivi', de: 'Umschreiben' },
  rewriteHint: {
    en: 'Your version stands at once, and the Segretario learns from it.',
    it: 'La tua versione vale subito, e il Segretario ne impara.',
    de: 'Ihre Fassung gilt sofort, und der Segretario lernt daraus.'
  },
  quoted: {
    en: (text: string) => `“${text}”`,
    it: (text: string) => `«${text}»`,
    de: (text: string) => `„${text}“`
  },
  yourWords: { en: 'Your words', it: 'Le tue parole', de: 'Ihre Worte' },
  yourAnswer: { en: 'Your answer', it: 'La tua risposta', de: 'Ihre Antwort' },
  send: { en: 'Send', it: 'Manda', de: 'Senden' },
  save: { en: 'Save', it: 'Salva', de: 'Speichern' },
  cancel: { en: 'Cancel', it: 'Annulla', de: 'Abbrechen' },
  notSent: {
    en: 'Your words didn’t reach the Segretario',
    it: 'Le tue parole non sono arrivate al Segretario',
    de: 'Ihre Worte haben den Segretario nicht erreicht'
  },
  notSaved: {
    en: 'Your version wasn’t saved',
    it: 'La tua versione non è stata salvata',
    de: 'Ihre Fassung wurde nicht gespeichert'
  },
  notWithdrawn: {
    en: 'Your words weren’t taken back',
    it: 'Le tue parole non sono state ritirate',
    de: 'Ihre Worte wurden nicht zurückgenommen'
  },
  /** Under a thing dimmed: the Segretario has the user's words on it, and is putting it right. */
  correcting: {
    en: (_masculine: boolean, words: string) => `The Segretario is putting it right: “${words}”`,
    it: (masculine: boolean, words: string) =>
      `Il Segretario ${masculine ? 'lo' : 'la'} sta correggendo: «${words}»`,
    de: (_masculine: boolean, words: string) => `Der Segretario korrigiert das gerade: „${words}“`
  },
  answered: {
    en: (words: string) => `You answered: “${words}”`,
    it: (words: string) => `Hai risposto: «${words}»`,
    de: (words: string) => `Ihre Antwort: „${words}“`
  },
  more: { en: 'More', it: 'Altro', de: 'Mehr' }
})

/** About as much of a thing as a box's heading quotes: the rest the user has in front of them. */
const QUOTED_CHARS = 280

function quote(text: string, quoted: (text: string) => string): string {
  const plain = plainWords(text).replace(/\s+/g, ' ').trim()
  return quoted(plain.length > QUOTED_CHARS ? `${plain.slice(0, QUOTED_CHARS)}…` : plain)
}

/** Texts of more than a line — the letter, «Il punto», a preparation, a reply — keep Enter for a new line. */
function longText(target: WorkTarget): boolean {
  return target.kind !== 'impegno' && target.kind !== 'nota'
}

/** What a box asks for: words on a thing, the answer to a question, the thing rewritten. */
type Box =
  | { mode: 'correct'; target: WorkTarget; about: string | null }
  | { mode: 'answer'; commitment: Commitment }
  | { mode: 'rewrite'; target: WorkTarget; text: string }

export interface WorkWords {
  /** Asks what is wrong with a thing, in the user's words; `about`, the thing as it reads. */
  correct: (target: WorkTarget, about?: string) => void
  /** Asks the user's answer to the question the Segretario asks about an open thing. */
  answer: (commitment: Commitment) => void
  /** The thing rewritten by hand, in a box: where it cannot be done in place. */
  rewrite: (target: WorkTarget, text: string) => void
  /** The boxes, to render once where the gestures are offered. */
  dialogs: React.JSX.Element
}

/**
 * The user's word on what the Segretario wrote (vision §10.1): «Correggi»
 * and «Rispondi» in a small box, «Riscrivi» in one too where the thing
 * cannot be rewritten in place — a native menu, the Calendario.
 */
export function useWorkWords(): WorkWords {
  // The box asked last, kept while it closes: its words fade with it.
  const [box, setBox] = useState<{ box: Box; id: number; open: boolean } | null>(null)
  const open = useCallback(
    (next: Box): void =>
      setBox((current) => ({ box: next, id: (current?.id ?? 0) + 1, open: true })),
    []
  )
  const correct = useCallback(
    (target: WorkTarget, about?: string): void =>
      open({ mode: 'correct', target, about: about ?? null }),
    [open]
  )
  const answer = useCallback(
    (commitment: Commitment): void => open({ mode: 'answer', commitment }),
    [open]
  )
  const rewrite = useCallback(
    (target: WorkTarget, text: string): void => open({ mode: 'rewrite', target, text }),
    [open]
  )
  const close = useCallback(
    (): void => setBox((current) => (current ? { ...current, open: false } : null)),
    []
  )

  return {
    correct,
    answer,
    rewrite,
    dialogs: (
      <WordsDialog
        key={box?.id ?? 0}
        box={box?.box ?? null}
        open={box?.open ?? false}
        onClose={close}
      />
    )
  }
}

function WordsDialog({
  box,
  open,
  onClose
}: {
  box: Box | null
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const initial = box?.mode === 'rewrite' ? plainWords(box.text) : ''
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const words = value.trim()
  const enterSends = box !== null && !(box.mode === 'rewrite' && longText(box.target))

  const submit = async (): Promise<void> => {
    if (!box || !words || busy) {
      return
    }

    // The same words again change nothing.
    if (box.mode === 'rewrite' && words === initial.trim()) {
      onClose()
      return
    }

    setBusy(true)

    try {
      if (box.mode === 'correct') {
        await window.segretarioApi.correctWork(box.target, words)
      } else if (box.mode === 'answer') {
        await window.segretarioApi.answerQuestion(box.commitment.id, words)
      } else {
        await window.segretarioApi.rewriteWork(box.target, words)
      }

      onClose()
    } catch (error) {
      toast.error(box.mode === 'rewrite' ? m.notSaved : m.notSent, {
        description: error instanceof Error ? error.message : undefined
      })
      setBusy(false)
    }
  }

  const heading =
    box?.mode === 'correct'
      ? {
          title: m.correctTitle,
          about: box.about ? quote(box.about, m.quoted) : null,
          hint: m.correctHint
        }
      : box?.mode === 'answer'
        ? {
            title: m.answerTitle,
            about: box.commitment.question,
            hint: quote(box.commitment.text, m.quoted)
          }
        : { title: m.rewriteTitle, about: null, hint: m.rewriteHint }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent
        hideClose
        overlayClassName="z-[60]"
        className="z-[70] w-[min(480px,calc(100vw-2rem))] gap-4"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{heading.title}</DialogTitle>
            {heading.about && (
              <DialogDescription className="text-foreground">{heading.about}</DialogDescription>
            )}
            <DialogDescription>{heading.hint}</DialogDescription>
          </DialogHeader>

          <Textarea
            autoFocus
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => {
              // The cursor at the end of what is there, to go on from it.
              const end = event.currentTarget.value.length
              event.currentTarget.setSelectionRange(end, end)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
                return
              }

              if (event.metaKey || event.ctrlKey || (enterSends && !event.shiftKey)) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={box?.mode === 'answer' ? m.yourAnswer : m.yourWords}
            aria-label={box?.mode === 'answer' ? m.yourAnswer : m.yourWords}
            className={cn(
              '[field-sizing:content] max-h-[50vh] text-[13px] leading-[1.5]',
              box?.mode === 'rewrite' && longText(box.target) ? 'min-h-40' : 'min-h-20'
            )}
          />

          <DialogFooter className="flex-wrap">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={!words || busy}>
              {box?.mode === 'rewrite' ? m.save : m.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Takes back the user's words on a thing while the Segretario has not taken them in. */
export function withdrawWords(target: WorkTarget): void {
  void window.segretarioApi.withdrawWords(target).catch((error: unknown) =>
    toast.error(messagesNow(MESSAGES).notWithdrawn, {
      description: error instanceof Error ? error.message : undefined
    })
  )
}

/** A thing the user corrected in words shows dimmed until the Segretario has put it right. */
export function dimmedBy(pending: PendingWords | null | undefined): string | false {
  return pending?.kind === 'correzione' && 'opacity-60'
}

/**
 * Under a thing, the user's words the Segretario has not taken in yet: what
 * is wrong with it — it is being put right — or their answer to its
 * question, in its place.
 */
export function PendingWordsLine({
  pending,
  masculine = false,
  className
}: {
  pending: PendingWords | null | undefined
  /** «Il punto»: said of in the masculine, where the language tells. */
  masculine?: boolean
  className?: string
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)

  if (!pending) {
    return null
  }

  return (
    <p className={cn('text-ai text-[11.5px] leading-[1.45] italic', className)}>
      {pending.kind === 'correzione'
        ? m.correcting(masculine, pending.words)
        : m.answered(pending.words)}
    </p>
  )
}

/** Saves the user's rewrite of a thing: theirs at once; said when it cannot be. */
async function saveRewrite(target: WorkTarget, text: string): Promise<boolean> {
  try {
    await window.segretarioApi.rewriteWork(target, text)
    return true
  } catch (error) {
    toast.error(messagesNow(MESSAGES).notSaved, {
      description: error instanceof Error ? error.message : undefined
    })
    return false
  }
}

/**
 * A thing rewritten in place: its words as the user reads them, links
 * aside. One line saves with Enter or as the field is left; a longer text
 * with ⌘Enter or its button. Esc leaves it as it was.
 */
export function RewriteField({
  target,
  text,
  label,
  onDone,
  className
}: {
  target: WorkTarget
  /** The thing as it is, links and all: the field shows its words. */
  text: string
  /** What the field holds, for screen readers. */
  label: string
  /** Closes the field: once saved, or left as it was. */
  onDone: () => void
  className?: string
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const initial = plainWords(text)
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const multiline = longText(target)

  const save = async (): Promise<void> => {
    const words = value.trim()

    if (busy) {
      return
    }

    // Emptied or the same: nothing to save, the thing stays as it was.
    if (!words || words === initial.trim()) {
      onDone()
      return
    }

    setBusy(true)

    if (await saveRewrite(target, words)) {
      onDone()
    } else {
      setBusy(false)
    }
  }

  const field = (
    <Textarea
      autoFocus
      value={value}
      disabled={busy}
      rows={1}
      aria-label={label}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => {
        const end = event.currentTarget.value.length
        event.currentTarget.setSelectionRange(end, end)
      }}
      onBlur={() => !multiline && void save()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onDone()
        } else if (
          event.key === 'Enter' &&
          !event.nativeEvent.isComposing &&
          (event.metaKey || event.ctrlKey || (!multiline && !event.shiftKey))
        ) {
          event.preventDefault()
          void save()
        }
      }}
      className={cn(
        'bg-background [field-sizing:content] min-h-0 w-full resize-none',
        multiline && 'min-h-24',
        className
      )}
    />
  )

  if (!multiline) {
    return field
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      {field}
      <div className="flex items-center justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDone}>
          {m.cancel}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || !value.trim()}
          onClick={() => void save()}
        >
          {m.save}
        </Button>
      </div>
    </div>
  )
}

/**
 * The gestures on a thing the Segretario wrote, as items of a menu — its
 * own «⋯», or a menu the thing already has: «Riscrivi», and «Correggi…»,
 * or, while its words wait, «Annulla la correzione».
 */
export function WorkWordsItems({
  target,
  pending,
  about,
  words,
  onRewrite
}: {
  target: WorkTarget
  pending: PendingWords | null | undefined
  /** The thing as it reads, quoted in the box for words. */
  about: string
  words: WorkWords
  /** Rewrites it in place; without, in a box. */
  onRewrite?: () => void
}): React.JSX.Element {
  const w = useMessages(WORK_WORDS)

  return (
    <>
      <DropdownMenuItem onSelect={() => (onRewrite ? onRewrite() : words.rewrite(target, about))}>
        {w.rewrite}
      </DropdownMenuItem>
      {pending ? (
        <DropdownMenuItem onSelect={() => withdrawWords(target)}>
          {pending.kind === 'correzione' ? w.withdrawCorrection : w.withdrawAnswer}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onSelect={() => words.correct(target, about)}>
          {w.correct}
        </DropdownMenuItem>
      )}
    </>
  )
}

/** A thing's own «⋯», with the user's gestures on it (`WorkWordsItems`). */
export function WorkMenu({
  className,
  label,
  ...items
}: React.ComponentProps<typeof WorkWordsItems> & {
  /** What the menu is of, for screen readers. */
  label?: string
  className?: string
}): React.JSX.Element {
  const m = useMessages(MESSAGES)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label ?? m.more}
          className={cn(
            'text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 data-[state=open]:text-foreground shrink-0 rounded-sm outline-none focus-visible:opacity-100 focus-visible:ring-2 data-[state=open]:opacity-100',
            className
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <WorkWordsItems {...items} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
