import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { CircleAlert, X } from 'lucide-react'
import { toast } from 'sonner'

import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import {
  addressKey,
  formatRecipient,
  isValidEmailAddress,
  mergeRecipients,
  parseRecipients
} from '@shared/email-address'
import type { MailAddress, MailContactSuggestion } from '@shared/models'

export type RecipientFieldKey = 'to' | 'cc' | 'bcc'

export const RECIPIENT_FIELD_LABELS: Readonly<Record<RecipientFieldKey, string>> = {
  to: 'A',
  cc: 'Cc',
  bcc: 'Ccn'
}

/** A recipient dragged from one field to another. */
const RECIPIENT_DRAG_TYPE = 'application/x-siever-recipient'
const SUGGESTION_LIMIT = 12
/** Asked for beyond the limit: the people already in the message are left out. */
const SUGGESTION_REQUEST_LIMIT = 30
const SUGGESTION_DELAY_MS = 80
const SEPARATOR_KEYS = new Set([',', ';'])

interface SuggestionResult {
  query: string
  suggestions: MailContactSuggestion[]
}

const NO_SUGGESTIONS: SuggestionResult = { query: '', suggestions: [] }

/**
 * The suggestion Invio takes at first: the one that is exactly what was
 * typed, else none when a whole address was typed — it is taken as it is,
 * not swapped for a longer one that starts the same — else the best.
 */
function defaultHighlight(
  query: string,
  suggestions: ReadonlyArray<MailContactSuggestion>
): number {
  const exact = suggestions.findIndex(
    (suggestion) => addressKey(suggestion.email) === addressKey(query)
  )

  if (exact >= 0) {
    return exact
  }

  return isValidEmailAddress(query) || suggestions.length === 0 ? -1 : 0
}

/** Whether a separator typed now falls inside a quoted name or an address in brackets. */
function isInsideQuotes(text: string): boolean {
  const quotes = text.split('"').length - 1
  return quotes % 2 === 1 || text.lastIndexOf('<') > text.lastIndexOf('>')
}

async function findSuggestions(
  query: string,
  takenKeys: ReadonlySet<string>
): Promise<MailContactSuggestion[]> {
  const found = await window.mailApi.suggestContacts(query, SUGGESTION_REQUEST_LIMIT)
  return found
    .filter((suggestion) => !takenKeys.has(addressKey(suggestion.email)))
    .slice(0, SUGGESTION_LIMIT)
}

interface RecipientFieldProps {
  field: RecipientFieldKey
  recipients: ReadonlyArray<MailAddress>
  /** Changes the recipients from the latest ones: a name found later must not undo an edit. */
  onRecipientsChange: (update: (recipients: MailAddress[]) => MailAddress[]) => void
  /** What is typed and not yet a recipient: sending takes it too. */
  draft: string
  onDraftChange: (draft: string) => void
  /** Every address the message already goes to, in any field: not suggested again. */
  takenKeys: ReadonlySet<string>
  /** The fields a recipient can be moved to from its menu. */
  moveTargets: ReadonlyArray<RecipientFieldKey>
  /** Moves a recipient between fields: dragged onto this one, or chosen from its menu. */
  onMoveRecipient: (recipient: MailAddress, from: RecipientFieldKey, to: RecipientFieldKey) => void
  placeholder?: string
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
  trailing?: ReactNode
}

/**
 * A recipient row of the composer, as Outlook and Gmail have them: each
 * person a chip — the name when it is known, the address in its bubble,
 * red when no mail can reach it — and a field to type the next one in.
 * A comma, a semicolon, Invio or leaving the field makes what was typed a
 * chip; a pasted list becomes one chip per person. The contacts that match
 * show below, and the ones never wanted again can be taken out with their
 * ×. A chip is picked with the arrows, removed with ⌫, edited with Invio or
 * a double click, and dragged or moved from its menu to another field.
 */
export function RecipientField({
  field,
  recipients,
  onRecipientsChange,
  draft,
  onDraftChange,
  takenKeys,
  moveTargets,
  onMoveRecipient,
  placeholder,
  disabled,
  inputRef,
  trailing
}: RecipientFieldProps): React.JSX.Element {
  const [focused, setFocused] = useState(false)
  const [result, setResult] = useState<SuggestionResult>(NO_SUGGESTIONS)
  const [highlighted, setHighlighted] = useState(-1)
  const [dropActive, setDropActive] = useState(false)
  const ownInputRef = useRef<HTMLInputElement | null>(null)
  const chipRefs = useRef(new Map<string, HTMLElement>())
  const listRef = useRef<HTMLDivElement | null>(null)

  // The composer focuses the field from its commands ("show-cc").
  useImperativeHandle(inputRef, () => ownInputRef.current as HTMLInputElement, [])

  const query = draft.trim()
  const listOpen = focused && query.length > 0 && result.suggestions.length > 0
  const label = RECIPIENT_FIELD_LABELS[field]
  const inputId = `compose-${field}`

  useEffect(() => {
    if (!focused || !query) {
      return
    }

    let current = true
    const timer = window.setTimeout(() => {
      findSuggestions(query, takenKeys)
        .then((suggestions) => {
          if (current) {
            setResult({ query, suggestions })
            setHighlighted(defaultHighlight(query, suggestions))
          }
        })
        .catch(() => {
          if (current) {
            setResult(NO_SUGGESTIONS)
          }
        })
    }, SUGGESTION_DELAY_MS)

    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [focused, query, takenKeys])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-suggestion-index="${highlighted}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  // Esc closes the suggestions, not the composer: the dialog hears it in
  // the capture phase on the document, so this listens before, on the window.
  useEffect(() => {
    if (!listOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setResult(NO_SUGGESTIONS)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [listOpen])

  const focusInput = (): void => ownInputRef.current?.focus()

  const focusChip = (recipient: MailAddress | undefined): void => {
    if (recipient) {
      chipRefs.current.get(addressKey(recipient.address))?.focus()
    } else {
      focusInput()
    }
  }

  /**
   * Gives the people added by their address alone the name their contact
   * has, as Outlook's "Controlla nomi" does: the chip reads as the person,
   * and the message goes out addressed to them by name.
   */
  const nameFromContacts = (entries: ReadonlyArray<MailAddress>): void => {
    for (const entry of entries) {
      if (entry.name || !isValidEmailAddress(entry.address)) {
        continue
      }

      const key = addressKey(entry.address)
      window.mailApi
        .suggestContacts(entry.address, SUGGESTION_LIMIT)
        .then((found) => {
          const name = found.find((suggestion) => addressKey(suggestion.email) === key)?.name

          if (name) {
            onRecipientsChange((current) =>
              current.map((recipient) =>
                addressKey(recipient.address) === key && !recipient.name
                  ? { name, address: recipient.address }
                  : recipient
              )
            )
          }
        })
        // Only the name is missing: the address, which is what is sent, is there.
        .catch(() => undefined)
    }
  }

  /** The typed text made recipients. */
  const commit = (text: string): void => {
    const entries = parseRecipients(text)

    if (entries.length > 0) {
      onRecipientsChange((current) => mergeRecipients(current, entries))
      nameFromContacts(entries)
    }

    onDraftChange('')
    setResult(NO_SUGGESTIONS)
  }

  const choose = (suggestion: MailContactSuggestion): void => {
    onRecipientsChange((current) =>
      mergeRecipients(current, [
        suggestion.name
          ? { name: suggestion.name, address: suggestion.email }
          : { address: suggestion.email }
      ])
    )
    onDraftChange('')
    setResult(NO_SUGGESTIONS)
    focusInput()
  }

  /**
   * Invio: the suggestion highlighted, or what was typed. Pressed before
   * the suggestions for the latest letters arrive, it asks for them first,
   * so typing fast never takes a person meant for fewer letters.
   */
  const resolveTyped = async (): Promise<void> => {
    let suggestion: MailContactSuggestion | undefined

    if (result.query === query) {
      suggestion = result.suggestions[highlighted]
    } else if (!isValidEmailAddress(query)) {
      const suggestions = await findSuggestions(query, takenKeys).catch(() => [])
      suggestion = suggestions[defaultHighlight(query, suggestions)]
    }

    if (suggestion) {
      choose(suggestion)
    } else {
      commit(draft)
    }
  }

  const remove = (index: number): void => {
    const key = addressKey(recipients[index].address)
    onRecipientsChange((current) =>
      current.filter((recipient) => addressKey(recipient.address) !== key)
    )
  }

  const edit = (index: number): void => {
    const text = formatRecipient(recipients[index])
    const key = addressKey(recipients[index].address)
    const typed = query ? parseRecipients(draft) : []

    // What was being typed becomes a recipient, so the edited one has the field.
    onRecipientsChange((current) =>
      mergeRecipients(
        current.filter((recipient) => addressKey(recipient.address) !== key),
        typed
      )
    )
    nameFromContacts(typed)
    onDraftChange(text)
    window.requestAnimationFrame(() => {
      const input = ownInputRef.current
      input?.focus()
      input?.setSelectionRange(text.length, text.length)
    })
  }

  const forget = (suggestion: MailContactSuggestion): void => {
    const suggestions = result.suggestions.filter((entry) => entry !== suggestion)
    setResult({ ...result, suggestions })
    setHighlighted((index) => Math.min(index, suggestions.length - 1))
    window.mailApi
      .forgetContact(suggestion.email)
      .then(() =>
        toast.success('Non verrà più suggerito', {
          description: `${suggestion.email} torna tra i suggerimenti se gli scrivi.`
        })
      )
      .catch((error: unknown) =>
        toast.error('Suggerimento non rimosso', {
          description: error instanceof Error ? error.message : undefined
        })
      )
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const input = event.currentTarget
    const caretAtStart = input.selectionStart === 0 && input.selectionEnd === 0
    const caretAtEnd = input.selectionStart === draft.length

    if (listOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const count = result.suggestions.length
      setHighlighted((index) =>
        event.key === 'ArrowDown' ? Math.min(index + 1, count - 1) : Math.max(index - 1, 0)
      )
      return
    }

    if (event.key === 'Enter' && query) {
      event.preventDefault()
      void resolveTyped()
      return
    }

    if (event.key === 'Tab' && query && !event.shiftKey) {
      const suggestion = result.query === query ? result.suggestions[highlighted] : undefined

      if (listOpen && suggestion) {
        event.preventDefault()
        choose(suggestion)
      } else {
        commit(draft)
      }

      return
    }

    if (SEPARATOR_KEYS.has(event.key) && caretAtEnd && !isInsideQuotes(draft)) {
      event.preventDefault()

      if (query) {
        commit(draft)
      }

      return
    }

    // A whole address followed by a space is done; a name keeps its spaces.
    if (event.key === ' ' && caretAtEnd && isValidEmailAddress(query)) {
      event.preventDefault()
      commit(draft)
      return
    }

    if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && caretAtStart) {
      const last = recipients[recipients.length - 1]

      if (last) {
        event.preventDefault()
        focusChip(last)
      }
    }
  }

  const handleChipKeyDown = (index: number, event: React.KeyboardEvent<HTMLElement>): void => {
    switch (event.key) {
      case 'Backspace':
      case 'Delete': {
        event.preventDefault()
        const next =
          event.key === 'Backspace' && index > 0 ? recipients[index - 1] : recipients[index + 1]
        remove(index)
        focusChip(next)
        return
      }
      case 'ArrowLeft':
        event.preventDefault()
        focusChip(recipients[Math.max(0, index - 1)])
        return
      case 'ArrowRight':
        event.preventDefault()
        focusChip(recipients[index + 1])
        return
      case 'Enter':
      case 'F2':
        event.preventDefault()
        edit(index)
        return
      default:
        // Typing goes on in the field.
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          focusInput()
        }
    }
  }

  const copyAddress = (recipient: MailAddress): void => {
    void navigator.clipboard
      .writeText(recipient.address)
      .then(() => toast.success('Indirizzo copiato', { description: recipient.address }))
      .catch(() => toast.error('Copia non riuscita'))
  }

  const openChipMenu = async (index: number): Promise<void> => {
    const recipient = recipients[index]
    const chosen = await window.mailApi.showContextMenu([
      { id: 'edit', label: 'Modifica' },
      { id: 'copy', label: 'Copia indirizzo', enabled: isValidEmailAddress(recipient.address) },
      ...(moveTargets.length > 0
        ? [
            { type: 'separator' as const },
            ...moveTargets.map((target) => ({
              id: `move:${target}`,
              label: `Sposta in ${RECIPIENT_FIELD_LABELS[target]}`
            }))
          ]
        : []),
      { type: 'separator' },
      { id: 'remove', label: 'Rimuovi' }
    ])

    if (chosen === 'edit') {
      edit(index)
    } else if (chosen === 'copy') {
      copyAddress(recipient)
    } else if (chosen === 'remove') {
      remove(index)
    } else if (chosen?.startsWith('move:')) {
      onMoveRecipient(recipient, field, chosen.slice('move:'.length) as RecipientFieldKey)
    }
  }

  return (
    <div
      className={cn('flex items-start gap-2 px-2', dropActive && 'bg-primary/10')}
      onDragOver={(event) => {
        if (!disabled && event.dataTransfer.types.includes(RECIPIENT_DRAG_TYPE)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropActive(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropActive(false)
        }
      }}
      onDrop={(event) => {
        const payload = event.dataTransfer.getData(RECIPIENT_DRAG_TYPE)
        setDropActive(false)

        if (!payload) {
          return
        }

        event.preventDefault()
        const dragged = JSON.parse(payload) as { field: RecipientFieldKey; recipient: MailAddress }

        if (dragged.field !== field) {
          onMoveRecipient(dragged.recipient, dragged.field, field)
        }
      }}
    >
      <label
        htmlFor={inputId}
        className="text-muted-foreground flex h-8 w-14 shrink-0 items-center text-[11px]"
      >
        {label}
      </label>
      <div className="relative min-w-0 flex-1">
        <div
          className="flex min-h-8 flex-wrap items-center gap-1 py-1"
          // A click beside the chips is a click in the field.
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault()
              focusInput()
            }
          }}
        >
          {recipients.map((recipient, index) => {
            const key = addressKey(recipient.address)
            const valid = isValidEmailAddress(recipient.address)
            const name = recipient.name?.trim()

            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <span
                    ref={(element) => {
                      if (element) {
                        chipRefs.current.set(key, element)
                      } else {
                        chipRefs.current.delete(key)
                      }
                    }}
                    role="button"
                    tabIndex={-1}
                    aria-label={
                      valid
                        ? `${name ? `${name}, ` : ''}${recipient.address}`
                        : `${recipient.address}, indirizzo non valido`
                    }
                    draggable={!disabled}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(
                        RECIPIENT_DRAG_TYPE,
                        JSON.stringify({ field, recipient })
                      )
                      event.dataTransfer.setData('text/plain', formatRecipient(recipient))
                    }}
                    onKeyDown={(event) => handleChipKeyDown(index, event)}
                    onDoubleClick={() => edit(index)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      void openChipMenu(index)
                    }}
                    className={cn(
                      'group/chip inline-flex h-6 max-w-full cursor-default items-center gap-1 rounded-md pr-0.5 pl-1.5 text-[12px] outline-none select-none',
                      'focus-visible:ring-ring/70 focus:ring-2',
                      valid
                        ? 'bg-secondary/70 text-foreground hover:bg-secondary'
                        : 'bg-destructive/10 text-destructive-soft-foreground ring-destructive/45 ring-1'
                    )}
                  >
                    {!valid && <CircleAlert className="size-3 shrink-0" />}
                    <span className="truncate">{name || recipient.address}</span>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Rimuovi ${name || recipient.address}`}
                      disabled={disabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation()
                        remove(index)
                      }}
                      className="hover:bg-foreground/10 text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center rounded-sm"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {valid ? (
                    recipient.address
                  ) : (
                    <>
                      Indirizzo non valido
                      <span className="text-muted-foreground block text-[10.5px] font-normal">
                        Doppio clic per correggerlo
                      </span>
                    </>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
          <input
            ref={ownInputRef}
            id={inputId}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
              setFocused(false)

              // Moving on in the message makes what was typed a recipient.
              // Leaving the window is not that — the address may be about
              // to be copied from somewhere — nor is a question asked over
              // the message, which hands the field back as it was.
              const surface = event.currentTarget.closest('[role="dialog"]') ?? document.body
              const next = event.relatedTarget

              if (query && document.hasFocus() && (!next || surface.contains(next))) {
                commit(draft)
              }
            }}
            onKeyDown={handleInputKeyDown}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text')

              // A list becomes chips at once; one address is pasted to be checked.
              if (parseRecipients(text).length > 1) {
                event.preventDefault()
                commit(`${draft}\n${text}`)
              }
            }}
            placeholder={recipients.length === 0 ? placeholder : undefined}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded={listOpen}
            aria-autocomplete="list"
            className="placeholder:text-muted-foreground/70 h-6 min-w-32 flex-1 bg-transparent text-[12.5px] outline-none disabled:opacity-50"
          />
        </div>

        {listOpen && (
          // The list refuses the mouse-down that would take focus from the
          // field, so the keyboard stays on the recipient being typed.
          <div
            ref={listRef}
            role="listbox"
            onMouseDown={(event) => event.preventDefault()}
            className="border-border bg-popover absolute top-full right-0 left-0 z-40 mt-0.5 max-h-56 overflow-y-auto rounded-md border p-1 shadow-xl"
          >
            {result.suggestions.map((suggestion, index) => (
              <div
                key={suggestion.email}
                role="option"
                aria-selected={index === highlighted}
                data-suggestion-index={index}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(suggestion)}
                className={cn(
                  'group/suggestion flex cursor-default items-center gap-3 rounded-sm py-1 pr-1 pl-2 text-[12px]',
                  index === highlighted && 'bg-secondary'
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {suggestion.name ? (
                    <>
                      <span className="font-medium">{suggestion.name}</span>{' '}
                      <span className="text-muted-foreground text-[11px]">{suggestion.email}</span>
                    </>
                  ) : (
                    suggestion.email
                  )}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Non suggerire più ${suggestion.email}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        forget(suggestion)
                      }}
                      className={cn(
                        'text-muted-foreground hover:text-foreground hover:bg-foreground/10 flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 group-hover/suggestion:opacity-100',
                        index === highlighted && 'opacity-100'
                      )}
                    >
                      <X className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Non suggerire più</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </div>
      {trailing && <div className="flex h-8 shrink-0 items-center">{trailing}</div>}
    </div>
  )
}
