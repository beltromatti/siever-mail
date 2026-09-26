import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ChevronDown, Paperclip, RotateCw, Send, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { IconButton } from '@renderer/components/ui/icon-button'
import { AttachMenu } from '@renderer/features/mail/attach-menu'
import { AttachmentChip } from '@renderer/features/mail/attachment-chip'
import {
  buildComposerBody,
  hasWrittenContent,
  replaceComposerSignature,
  splitSignature
} from '@renderer/features/mail/composer-body'
import { RichTextEditor } from '@renderer/features/mail/rich-text-editor'
import { htmlToPlainText, splitRecipients } from '@renderer/lib/email'
import { cn } from '@renderer/lib/utils'
import { MAIL_COMPOSER_DEFAULT_FONT_FAMILY } from '@shared/mail-fonts'
import type {
  ComposeMailInput,
  MailAccount,
  MailAttachment,
  MailContactSuggestion,
  MessageRef,
  PickedAttachment
} from '@shared/models'

export type ComposerKind = 'new' | 'reply' | 'forward'

/**
 * An attachment as the composer holds it. One of the original message's
 * attachments has no file until its copy is made, and says so if that fails.
 */
export interface ComposerAttachment {
  name: string
  size: number
  /** The file that goes out. */
  path?: string
  /** Its id among the original message's attachments, when it is one of them. */
  originalId?: string
  failed?: boolean
}

export interface ComposerInitialData {
  kind: ComposerKind
  /** The account the message goes out from. */
  accountId: string
  /**
   * The account that received the message a reply or forward is about.
   * Sending from another one is asked about first: the other side would
   * hear back from an address they never wrote to.
   */
  sourceAccountId?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  /** The message a reply or forward quotes, below the signature. */
  quoteHtml?: string
  /**
   * A body taken as it is, signature included — a draft reopened after its
   * send failed.
   */
  html?: string
  inReplyTo?: string
  references?: string[]
  /**
   * The message a reply or forward is about. A forward carries its
   * attachments, as every client does; a reply leaves them out, and
   * "Allega" offers them.
   */
  original?: {
    ref: MessageRef
    attachments: MailAttachment[]
  }
  /** A reopened draft's attachments, as they were. */
  attachments?: ComposerAttachment[]
}

interface MailComposerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: MailAccount[]
  initialData?: ComposerInitialData
  /** `draft` reopens the message as it was sent, should sending fail. */
  onSendRequested: (payload: ComposeMailInput, draft: ComposerInitialData) => void
}

interface ComposerFormState {
  to: string
  cc: string
  bcc: string
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references?: string[]
}

type RecipientFieldKey = 'to' | 'cc' | 'bcc'

interface RecipientTokenContext {
  query: string
  tokenStart: number
  tokenEnd: number
}

const COMPOSER_TITLES: Readonly<Record<ComposerKind, string>> = {
  new: 'Nuovo messaggio',
  reply: 'Rispondi',
  forward: 'Inoltra messaggio'
}

function buildInitialFields(
  initialData: ComposerInitialData | undefined
): Pick<ComposerFormState, 'to' | 'cc' | 'bcc' | 'subject'> {
  return {
    to: (initialData?.to ?? []).join(', '),
    cc: (initialData?.cc ?? []).join(', '),
    bcc: (initialData?.bcc ?? []).join(', '),
    subject: initialData?.subject ?? ''
  }
}

function buildInitialState(
  initialData: ComposerInitialData | undefined,
  signatureHtml: string | null
): ComposerFormState {
  const html = initialData?.html ?? buildComposerBody(signatureHtml, initialData?.quoteHtml)

  return {
    ...buildInitialFields(initialData),
    html,
    text: htmlToPlainText(html),
    inReplyTo: initialData?.inReplyTo,
    references: initialData?.references
  }
}

/** What a composer opens with: a draft's own, or a forward's originals. */
function buildInitialAttachments(
  initialData: ComposerInitialData | undefined
): ComposerAttachment[] {
  if (initialData?.attachments) {
    return [...initialData.attachments]
  }

  if (initialData?.kind !== 'forward' || !initialData.original) {
    return []
  }

  return initialData.original.attachments.map(originalAttachment)
}

function originalAttachment(attachment: MailAttachment): ComposerAttachment {
  return { name: attachment.fileName, size: attachment.size, originalId: attachment.id }
}

function attachmentKey(attachment: ComposerAttachment): string {
  return attachment.originalId ? `original:${attachment.originalId}` : `file:${attachment.path}`
}

function attachmentKeys(attachments: ReadonlyArray<ComposerAttachment>): string {
  return attachments.map(attachmentKey).join('\n')
}

function isPendingOriginal(attachment: ComposerAttachment): boolean {
  return Boolean(attachment.originalId && !attachment.path && !attachment.failed)
}

function normalizeRecipientEmail(value: string): string {
  return value.trim().toLowerCase()
}

function getRecipientTokenContext(
  value: string,
  caretPosition: number | null
): RecipientTokenContext {
  const safeCaret = Math.max(0, Math.min(caretPosition ?? value.length, value.length))
  const lastCommaIndex = value.lastIndexOf(',', Math.max(0, safeCaret - 1))
  const tokenStart = lastCommaIndex < 0 ? 0 : lastCommaIndex + 1
  const nextCommaIndex = value.indexOf(',', safeCaret)
  const tokenEnd = nextCommaIndex >= 0 ? nextCommaIndex : value.length
  const query = value.slice(tokenStart, tokenEnd).trim()

  return {
    query,
    tokenStart,
    tokenEnd
  }
}

function pushUniqueRecipient(
  recipients: string[],
  knownRecipients: Set<string>,
  value: string
): void {
  const normalized = normalizeRecipientEmail(value)

  if (!normalized || knownRecipients.has(normalized)) {
    return
  }

  knownRecipients.add(normalized)
  recipients.push(value.trim())
}

function buildRecipientValueFromSuggestion(
  value: string,
  tokenContext: RecipientTokenContext,
  selectedSuggestion: MailContactSuggestion
): { value: string; cursor: number } {
  const selectedEmail = selectedSuggestion.email.trim()
  const recipients: string[] = []
  const knownRecipients = new Set<string>()
  const leftRecipients = splitRecipients(value.slice(0, tokenContext.tokenStart))
  const rightRecipients = splitRecipients(value.slice(tokenContext.tokenEnd))

  for (const recipient of leftRecipients) {
    pushUniqueRecipient(recipients, knownRecipients, recipient)
  }

  pushUniqueRecipient(recipients, knownRecipients, selectedEmail)

  for (const recipient of rightRecipients) {
    pushUniqueRecipient(recipients, knownRecipients, recipient)
  }

  const replacedAtEnd = tokenContext.tokenEnd >= value.length
  const nextValue = recipients.join(', ')

  if (replacedAtEnd) {
    const withTrailingSeparator = nextValue ? `${nextValue}, ` : `${selectedEmail}, `

    return {
      value: withTrailingSeparator,
      cursor: withTrailingSeparator.length
    }
  }

  return {
    value: nextValue,
    cursor: nextValue.length
  }
}

export function MailComposerDialog({
  open,
  onOpenChange,
  accounts,
  initialData,
  onSendRequested
}: MailComposerDialogProps): React.JSX.Element {
  const [form, setForm] = useState<ComposerFormState>(() => buildInitialState(initialData, null))
  const [accountId, setAccountId] = useState(initialData?.accountId ?? null)
  // False while a new body waits for its signature: switching account then
  // would race the signature being put in.
  const [bodyReady, setBodyReady] = useState(initialData?.html !== undefined)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [editorFocusMode, setEditorFocusMode] = useState(false)
  const [recipientSuggestions, setRecipientSuggestions] = useState<MailContactSuggestion[]>([])
  const [recipientQuery, setRecipientQuery] = useState('')
  const [activeRecipientField, setActiveRecipientField] = useState<RecipientFieldKey | null>(null)
  const [activeTokenContext, setActiveTokenContext] = useState<RecipientTokenContext | null>(null)
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  /**
   * Cc and Ccn stay folded away until they are wanted. They were always on
   * screen, which cost two rows of every message to serve the small minority
   * that carbon-copies — and a reply that already carries a Cc list has to
   * show them, so the toggle follows the content rather than overriding it.
   */
  const [ccBccRequested, setCcBccRequested] = useState(false)
  const toInputRef = useRef<HTMLInputElement | null>(null)
  const ccInputRef = useRef<HTMLInputElement | null>(null)
  const bccInputRef = useRef<HTMLInputElement | null>(null)
  const toFieldContainerRef = useRef<HTMLDivElement | null>(null)
  const ccFieldContainerRef = useRef<HTMLDivElement | null>(null)
  const bccFieldContainerRef = useRef<HTMLDivElement | null>(null)
  const suggestionRequestIdRef = useRef(0)
  const signatureRequestIdRef = useRef(0)
  // Whether the sending account's signature went into the body. When it is
  // missing at the next account switch, the user deleted it, and the next
  // account's signature is not forced back in.
  const bodyHadSignatureRef = useRef(false)

  const account = accounts.find((candidate) => candidate.id === accountId) ?? null
  // The "Da" row: with more than one account, and whenever the one a
  // reopened draft names is gone, so another can be picked.
  const hasAccountChoice = accounts.length > 1 || (!account && accounts.length > 0)
  const kind = initialData?.kind ?? 'new'
  const sourceAccount = initialData?.sourceAccountId
    ? (accounts.find((candidate) => candidate.id === initialData.sourceAccountId) ?? null)
    : null

  const closeRecipientSuggestions = useCallback((): void => {
    suggestionRequestIdRef.current += 1
    setRecipientSuggestions([])
    setRecipientQuery('')
    setActiveRecipientField(null)
    setActiveTokenContext(null)
    setHighlightedSuggestionIndex(0)
  }, [])

  const getRecipientFieldValue = useCallback(
    (field: RecipientFieldKey): string => {
      if (field === 'to') {
        return form.to
      }

      if (field === 'cc') {
        return form.cc
      }

      return form.bcc
    },
    [form.bcc, form.cc, form.to]
  )

  const getRecipientInput = useCallback((field: RecipientFieldKey): HTMLInputElement | null => {
    if (field === 'to') {
      return toInputRef.current
    }

    if (field === 'cc') {
      return ccInputRef.current
    }

    return bccInputRef.current
  }, [])

  const refreshRecipientSuggestions = useCallback(
    (field: RecipientFieldKey, value: string, input: HTMLInputElement): void => {
      if (!open || !account) {
        closeRecipientSuggestions()
        return
      }

      const tokenContext = getRecipientTokenContext(value, input.selectionStart)

      if (!tokenContext.query) {
        setRecipientSuggestions([])
        setRecipientQuery('')
        setActiveTokenContext(null)
        setActiveRecipientField(field)
        setHighlightedSuggestionIndex(0)
        return
      }

      setActiveRecipientField(field)
      setActiveTokenContext(tokenContext)
      setRecipientQuery(tokenContext.query)
      setHighlightedSuggestionIndex(0)
    },
    [account, closeRecipientSuggestions, open]
  )

  const applyRecipientSuggestion = useCallback(
    (field: RecipientFieldKey, suggestion: MailContactSuggestion): void => {
      const input = getRecipientInput(field)
      const currentValue = getRecipientFieldValue(field)
      const tokenContext =
        activeRecipientField === field && activeTokenContext
          ? activeTokenContext
          : getRecipientTokenContext(currentValue, input?.selectionStart ?? currentValue.length)
      const applied = buildRecipientValueFromSuggestion(currentValue, tokenContext, suggestion)

      setForm((current) => ({
        ...current,
        [field]: applied.value
      }))
      closeRecipientSuggestions()

      window.requestAnimationFrame(() => {
        const target = getRecipientInput(field)

        if (!target) {
          return
        }

        target.focus()
        target.setSelectionRange(applied.cursor, applied.cursor)
      })
    },
    [
      activeRecipientField,
      activeTokenContext,
      closeRecipientSuggestions,
      getRecipientFieldValue,
      getRecipientInput
    ]
  )

  // Resetting the draft when the dialog opens is a state adjustment, not a
  // synchronisation with an external system, so it happens during render
  // rather than in an effect — the shape React documents for "adjusting
  // state when a prop changes". Doing it in an effect committed a throwaway
  // render with the previous draft still on screen first.
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)

    if (open) {
      const opening = buildInitialState(initialData, null)
      // A new body waits for its signature (below); until then the previous
      // message must not show through.
      setForm(initialData?.html === undefined ? { ...opening, html: '', text: '' } : opening)
      setBodyReady(initialData?.html !== undefined)
      setAccountId(initialData?.accountId ?? null)
      setAttachments(buildInitialAttachments(initialData))
      setEditorFocusMode(false)
      // Without this the disclosure stayed open for the rest of the session:
      // one message that needed a Cc left every later message showing two
      // empty rows it had no use for.
      setCcBccRequested(false)
    }
  }

  useEffect(() => {
    const requestId = ++signatureRequestIdRef.current

    if (!open || !initialData) {
      return
    }

    // A reopened draft already holds whatever the user left of the signature.
    if (initialData.html !== undefined) {
      bodyHadSignatureRef.current = true
      return
    }

    const applyInitialState = (signatureHtml: string | null): void => {
      if (requestId !== signatureRequestIdRef.current) {
        return
      }

      bodyHadSignatureRef.current = splitSignature(signatureHtml) !== null
      setForm(buildInitialState(initialData, signatureHtml))
      setBodyReady(true)
    }

    void window.mailApi
      .getAccountSignature(initialData.accountId)
      .then((signature) => applyInitialState(signature?.html ?? null))
      .catch((error: unknown) => {
        toast.error('Firma non disponibile', {
          description: error instanceof Error ? error.message : undefined
        })
        applyInitialState(null)
      })
  }, [initialData, open])

  // The original message's attachments the composer holds but has no file
  // for yet, copied in one go: the ones a forward opens with, the ones
  // picked from "Allega", the ones retried after a failure.
  const pendingOriginalIds = attachments
    .filter(isPendingOriginal)
    .map((attachment) => attachment.originalId)
    .join('\n')

  useEffect(() => {
    const original = initialData?.original

    if (!open || !original || !pendingOriginalIds) {
      return
    }

    const attachmentIds = pendingOriginalIds.split('\n')
    let current = true

    window.mailApi
      .copyMessageAttachments({ ref: original.ref, attachmentIds })
      .then((copies) => {
        if (!current) {
          return
        }

        const copiesById = new Map(copies.map((copy) => [copy.attachmentId, copy]))
        setAttachments((items) =>
          items.map((item) => {
            const copy = item.originalId ? copiesById.get(item.originalId) : undefined
            return copy && isPendingOriginal(item)
              ? { ...item, name: copy.name, size: copy.size, path: copy.path }
              : item
          })
        )
      })
      .catch((error: unknown) => {
        if (!current) {
          return
        }

        setAttachments((items) =>
          items.map((item) =>
            isPendingOriginal(item) && attachmentIds.includes(item.originalId as string)
              ? { ...item, failed: true }
              : item
          )
        )
        toast.error('Allegati del messaggio originale non disponibili', {
          description: error instanceof Error ? error.message : undefined
        })
      })

    return () => {
      current = false
    }
  }, [initialData, open, pendingOriginalIds])

  /**
   * Sends from another account, swapping the signature for its own. For a
   * reply or forward, leaving the account the message arrived on is
   * confirmed first.
   */
  const changeAccount = async (nextAccountId: string): Promise<void> => {
    const nextAccount = accounts.find((candidate) => candidate.id === nextAccountId)

    if (!nextAccount || nextAccount.id === accountId) {
      return
    }

    if (sourceAccount && nextAccount.id !== sourceAccount.id) {
      const isReply = kind === 'reply'
      const confirmed = await confirm({
        title: isReply ? 'Rispondere da un altro account?' : 'Inoltrare da un altro account?',
        description: (
          <>
            Il messaggio è arrivato a <strong>{sourceAccount.email}</strong>.{' '}
            {isReply
              ? 'Rispondendo da un altro account, chi ti ha scritto riceve la risposta da un indirizzo diverso da quello a cui ha scritto'
              : 'Inoltrandolo da un altro account, parte da un indirizzo diverso da quello che lo ha ricevuto'}{' '}
            e la copia inviata resta nella posta di <strong>{nextAccount.email}</strong>.
          </>
        ),
        confirmLabel: 'Cambia account'
      })

      if (!confirmed) {
        return
      }
    }

    setAccountId(nextAccount.id)
    const requestId = ++signatureRequestIdRef.current

    try {
      const signatureHtml = (await window.mailApi.getAccountSignature(nextAccount.id))?.html ?? null

      if (requestId !== signatureRequestIdRef.current) {
        return
      }

      const insertIfMissing = !bodyHadSignatureRef.current
      bodyHadSignatureRef.current = splitSignature(signatureHtml) !== null
      setForm((current) => {
        const html = replaceComposerSignature(current.html, signatureHtml, insertIfMissing)
        return html === current.html ? current : { ...current, html, text: htmlToPlainText(html) }
      })
    } catch (error) {
      toast.error(`Firma di ${nextAccount.email} non disponibile`, {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  const closeComposerImmediately = useCallback((): void => {
    closeRecipientSuggestions()
    setEditorFocusMode(false)
    onOpenChange(false)
  }, [closeRecipientSuggestions, onOpenChange])

  /**
   * Closing asks first only when something the user put in would be lost:
   * fields changed from how the composer opened, attachments, or anything
   * written in the body. A reply opened and closed untouched — even after
   * trying another account — just closes.
   */
  const requestComposerClose = async (): Promise<void> => {
    closeRecipientSuggestions()
    const initialFields = buildInitialFields(initialData)
    const hasUserContent =
      form.to !== initialFields.to ||
      form.cc !== initialFields.cc ||
      form.bcc !== initialFields.bcc ||
      form.subject !== initialFields.subject ||
      attachmentKeys(attachments) !== attachmentKeys(buildInitialAttachments(initialData)) ||
      hasWrittenContent(form.html)

    if (
      hasUserContent &&
      !(await confirm({
        title: 'Chiudere la bozza?',
        description: 'Chiudendo questa finestra perderai il contenuto già inserito nel messaggio.',
        confirmLabel: 'Chiudi e scarta',
        cancelLabel: 'Torna indietro',
        destructive: true
      }))
    ) {
      return
    }

    closeComposerImmediately()
  }

  const handleDialogOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }

    void requestComposerClose()
  }

  useEffect(() => {
    if (!open || !account || !activeRecipientField || !recipientQuery || !activeTokenContext) {
      return
    }

    const activeValue = getRecipientFieldValue(activeRecipientField)
    const existingRecipients = new Set(
      [
        ...splitRecipients(activeValue.slice(0, activeTokenContext.tokenStart)),
        ...splitRecipients(activeValue.slice(activeTokenContext.tokenEnd))
      ].map((value) => normalizeRecipientEmail(value))
    )
    const requestId = ++suggestionRequestIdRef.current
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const suggestions = await window.mailApi.suggestContacts(recipientQuery, 12)

          if (requestId !== suggestionRequestIdRef.current) {
            return
          }

          const filteredSuggestions = suggestions.filter(
            (suggestion) => !existingRecipients.has(normalizeRecipientEmail(suggestion.email))
          )

          setRecipientSuggestions(filteredSuggestions)
          setHighlightedSuggestionIndex((current) =>
            Math.min(current, Math.max(0, filteredSuggestions.length - 1))
          )
        } catch {
          if (requestId === suggestionRequestIdRef.current) {
            setRecipientSuggestions([])
            setHighlightedSuggestionIndex(0)
          }
        }
      })()
    }, 120)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    account,
    activeRecipientField,
    activeTokenContext,
    getRecipientFieldValue,
    open,
    recipientQuery
  ])

  useEffect(() => {
    if (!open || !activeRecipientField) {
      return
    }

    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null

      if (
        !target ||
        toFieldContainerRef.current?.contains(target) ||
        ccFieldContainerRef.current?.contains(target) ||
        bccFieldContainerRef.current?.contains(target)
      ) {
        return
      }

      closeRecipientSuggestions()
    }

    window.addEventListener('mousedown', onMouseDown)

    return () => {
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [activeRecipientField, closeRecipientSuggestions, open])

  const toRecipients = useMemo(() => splitRecipients(form.to), [form.to])

  // Every attachment must have its file: an original still being copied, or
  // whose copy failed, would otherwise go missing without a word.
  const canSend = Boolean(
    account &&
    toRecipients.length > 0 &&
    form.subject.trim() &&
    form.html.trim() &&
    attachments.every((attachment) => attachment.path)
  )

  // The window said "Nuovo messaggio" even when the user had just hit
  // Rispondi, which is the one moment they need confirming that the reply
  // carried the thread with it.
  const composerTitle = COMPOSER_TITLES[kind]

  // Content wins over the toggle: a reply-all or a reopened draft that
  // already carries copies must never hide them behind a disclosure.
  const ccBccVisible = ccBccRequested || form.cc.trim().length > 0 || form.bcc.trim().length > 0

  const ccBccToggle = ccBccVisible ? null : (
    <button
      type="button"
      onClick={() => {
        setCcBccRequested(true)
        window.requestAnimationFrame(() => ccInputRef.current?.focus())
      }}
      disabled={!account}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 shrink-0 rounded-sm px-1 text-[11px] outline-none focus-visible:ring-2 disabled:opacity-50"
    >
      Cc/Ccn
    </button>
  )

  /**
   * One recipient row: gutter label, borderless input, and the suggestion
   * list anchored under it. The three fields were 55 lines of identical JSX
   * apiece, which is why they drifted apart — Bcc had picked up a different
   * placeholder and Cc a different focus handler.
   */
  const renderRecipientField = (
    field: RecipientFieldKey,
    label: string,
    placeholder: string,
    trailing?: React.ReactNode
  ): React.JSX.Element => {
    // Looked up here rather than passed in: handing a ref to a function is
    // what the "cannot access refs during render" rule is guarding against,
    // even when the function only forwards it to a `ref` prop.
    const containerRef =
      field === 'to'
        ? toFieldContainerRef
        : field === 'cc'
          ? ccFieldContainerRef
          : bccFieldContainerRef
    const inputRef = field === 'to' ? toInputRef : field === 'cc' ? ccInputRef : bccInputRef

    const refreshFor = (element: HTMLInputElement): void => {
      refreshRecipientSuggestions(field, element.value, element)
    }

    return (
      <div className="flex items-center gap-2 px-2" ref={containerRef}>
        <label
          htmlFor={`compose-${field}`}
          className="text-muted-foreground w-14 shrink-0 text-[11px]"
        >
          {label}
        </label>
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            id={`compose-${field}`}
            value={form[field]}
            onChange={(event) => {
              const value = event.target.value
              setForm((current) => ({ ...current, [field]: value }))
              refreshFor(event.currentTarget)
            }}
            onFocus={(event) => refreshFor(event.currentTarget)}
            // Suggestions belong to the field being typed in. A reply
            // focuses "A" on the way to the body, and without this its
            // list stayed open over "Oggetto" while the user wrote below.
            // Picking a suggestion never blurs: the list refuses the mouse.
            onBlur={closeRecipientSuggestions}
            onClick={(event) => refreshFor(event.currentTarget)}
            onKeyUp={(event) => refreshFor(event.currentTarget)}
            onKeyDown={(event) => handleRecipientKeyDown(field, event)}
            placeholder={placeholder}
            disabled={!account}
            className="placeholder:text-muted-foreground/70 h-8 w-full bg-transparent text-[12.5px] outline-none disabled:opacity-50"
          />
          {activeRecipientField === field && recipientSuggestions.length > 0 && (
            // The list refuses the mouse-down that would move focus out of
            // the field, so dragging its scrollbar keeps the keyboard on the
            // recipient being typed.
            <div
              onMouseDown={(event) => event.preventDefault()}
              className="border-border bg-popover absolute top-full right-0 left-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-md border shadow-xl"
            >
              {recipientSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.email}-${index}`}
                  type="button"
                  className={cn(
                    'hover:bg-secondary/70 flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-[12px] transition-colors',
                    highlightedSuggestionIndex === index && 'bg-secondary/65'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                  onClick={() => applyRecipientSuggestion(field, suggestion)}
                >
                  <span className="truncate font-medium">
                    {suggestion.name || suggestion.email}
                  </span>
                  {suggestion.name && (
                    <span className="text-muted-foreground truncate text-[11px]">
                      {suggestion.email}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        {trailing}
      </div>
    )
  }

  const addAttachments = (picked: PickedAttachment[]): void => {
    if (picked.length === 0) {
      return
    }

    setAttachments((current) => {
      const knownPaths = new Set(current.map((item) => item.path))
      const uniqueNew = picked.filter((item) => !knownPaths.has(item.path))
      return [...current, ...uniqueNew]
    })
  }

  const originals = initialData?.original?.attachments ?? []
  const unattachedOriginals = originals.filter(
    (original) => !attachments.some((attachment) => attachment.originalId === original.id)
  )

  const attachOriginals = (attachmentIds: string[]): void => {
    setAttachments((current) => [
      ...current,
      ...originals
        .filter(
          (original) =>
            attachmentIds.includes(original.id) &&
            !current.some((attachment) => attachment.originalId === original.id)
        )
        .map(originalAttachment)
    ])
  }

  const retryAttachment = (key: string): void => {
    setAttachments((current) =>
      current.map((item) => (attachmentKey(item) === key ? { ...item, failed: false } : item))
    )
  }

  const removeAttachment = (key: string): void => {
    setAttachments((current) => current.filter((item) => attachmentKey(item) !== key))
  }

  const handlePickAttachments = async (): Promise<void> => {
    try {
      addAttachments(await window.mailApi.pickAttachments())
    } catch (error) {
      toast.error('Impossibile allegare i file', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  /** Files chosen from the recent list or dropped on the composer. */
  const attachPaths = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) {
      return
    }

    try {
      addAttachments(await window.mailApi.describeFiles(paths))
    } catch (error) {
      toast.error('Impossibile allegare il file', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  // A file dragged over the composer turns the whole panel into a drop
  // target. The editor lives in an iframe the panel cannot hear, so it
  // reports a file drag entering it and the overlay takes over from there.
  const [fileDragActive, setFileDragActive] = useState(false)
  const beginFileDrag = (): void => {
    if (account) {
      setFileDragActive(true)
    }
  }

  const handleRecipientKeyDown = (field: RecipientFieldKey, event: React.KeyboardEvent): void => {
    if (activeRecipientField !== field || recipientSuggestions.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedSuggestionIndex((current) =>
        Math.min(current + 1, recipientSuggestions.length - 1)
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedSuggestionIndex((current) => Math.max(current - 1, 0))
      return
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      const selectedSuggestion = recipientSuggestions[highlightedSuggestionIndex]

      if (!selectedSuggestion) {
        return
      }

      event.preventDefault()
      applyRecipientSuggestion(field, selectedSuggestion)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeRecipientSuggestions()
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!account || !canSend) {
      return
    }

    const payload: ComposeMailInput = {
      accountId: account.id,
      to: splitRecipients(form.to),
      cc: splitRecipients(form.cc),
      bcc: splitRecipients(form.bcc),
      subject: form.subject.trim(),
      html: form.html,
      text: htmlToPlainText(form.html),
      inReplyTo: form.inReplyTo,
      references: form.references,
      attachments: attachments.flatMap((attachment) =>
        attachment.path ? [{ path: attachment.path, name: attachment.name }] : []
      )
    }
    const draft: ComposerInitialData = {
      kind,
      accountId: account.id,
      sourceAccountId: initialData?.sourceAccountId,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: form.subject,
      html: form.html,
      inReplyTo: form.inReplyTo,
      references: form.references,
      original: initialData?.original,
      attachments: [...attachments]
    }

    closeRecipientSuggestions()
    setEditorFocusMode(false)
    onOpenChange(false)
    onSendRequested(payload, draft)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          hideClose={editorFocusMode}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault()
              beginFileDrag()
            }
          }}
          className={cn(
            'flex flex-col gap-2 p-4',
            editorFocusMode
              ? 'h-[92vh] max-h-[92vh] w-[min(1200px,calc(100vw-1.5rem))] overflow-hidden p-3'
              : // A managed height, not a content-driven one. Letting the
                // panel size itself meant the editor got whatever was left
                // after the envelope, which on a reply with a long recipient
                // list was a couple of visible lines. The dialog now claims
                // a comfortable working height and the editor takes every
                // pixel the envelope and footer do not.
                'h-[min(760px,calc(100vh-3rem))]'
          )}
        >
          {fileDragActive && (
            <div
              className="border-primary/70 bg-background/85 absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed backdrop-blur-sm"
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDragLeave={() => setFileDragActive(false)}
              onDrop={(event) => {
                event.preventDefault()
                setFileDragActive(false)
                void attachPaths(
                  Array.from(event.dataTransfer.files)
                    .map((file) => window.mailApi.getPathForFile(file))
                    .filter(Boolean)
                )
              }}
            >
              {/* Children ignore the pointer so leaving them is not leaving the target. */}
              <Paperclip className="text-primary pointer-events-none size-6" />
              <p className="pointer-events-none text-[13px] font-medium">Rilascia per allegare</p>
            </div>
          )}

          {editorFocusMode ? (
            <div className="h-full min-h-0">
              <RichTextEditor
                value={form.html}
                disabled={!account}
                defaultFontFamily={MAIL_COMPOSER_DEFAULT_FONT_FAMILY}
                expanded={editorFocusMode}
                expandToContainer
                onFileDragEnter={beginFileDrag}
                onExpandedChange={(expanded) => {
                  setEditorFocusMode(expanded)

                  if (expanded) {
                    closeRecipientSuggestions()
                  }
                }}
                onChange={(html, text) => {
                  setForm((current) => ({ ...current, html, text }))
                }}
              />
            </div>
          ) : (
            <>
              <DialogHeader className="gap-0 pb-1">
                <DialogTitle className="text-[14px] leading-6">{composerTitle}</DialogTitle>
                {/* With more than one account the "Da" row says it. */}
                <DialogDescription className={cn('text-[11px]', hasAccountChoice && 'sr-only')}>
                  {account ? `Invio da ${account.email}` : "Scegli l'account da cui inviare."}
                </DialogDescription>
              </DialogHeader>

              {/*
                The envelope is a stack of hairline rows, not a grid of
                labelled boxes. Each field used to be a `Label` above a
                full-height `Input`, which cost about 84px per field and
                pushed the editor — the only part anyone actually works in —
                into the bottom third of the dialog. An inline label in a
                fixed gutter reads the same and costs 32px, which is the
                shape Outlook and Mail have both settled on.
              */}
              <div className="border-border/70 divide-border/50 divide-y rounded-md border">
                {hasAccountChoice && (
                  <div className="flex items-center gap-2 px-2">
                    <span className="text-muted-foreground w-14 shrink-0 text-[11px]">Da</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={!bodyReady}
                          className="hover:bg-secondary/60 focus-visible:ring-ring/70 -ml-1 flex h-8 min-w-0 items-center gap-1.5 rounded-sm px-1 text-left text-[12.5px] outline-none focus-visible:ring-2 disabled:opacity-50"
                        >
                          {account ? (
                            <span className="min-w-0 truncate">
                              {account.displayName}{' '}
                              <span className="text-muted-foreground">&lt;{account.email}&gt;</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Scegli l&apos;account</span>
                          )}
                          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-w-[min(32rem,90vw)]">
                        <DropdownMenuRadioGroup
                          value={accountId ?? ''}
                          onValueChange={(nextAccountId) => void changeAccount(nextAccountId)}
                        >
                          {accounts.map((candidate) => (
                            <DropdownMenuRadioItem
                              key={candidate.id}
                              value={candidate.id}
                              className="gap-3"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {candidate.displayName}{' '}
                                <span className="text-muted-foreground">
                                  &lt;{candidate.email}&gt;
                                </span>
                              </span>
                              {candidate.id === sourceAccount?.id && (
                                <span className="text-muted-foreground shrink-0 text-[10.5px]">
                                  ha ricevuto il messaggio
                                </span>
                              )}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                {renderRecipientField('to', 'A', 'destinatario@azienda.com', ccBccToggle)}
                {ccBccVisible && renderRecipientField('cc', 'Cc', 'opzionale')}
                {ccBccVisible && renderRecipientField('bcc', 'Ccn', 'opzionale')}

                <div className="flex items-center gap-2 px-2">
                  <label
                    htmlFor="compose-subject"
                    className="text-muted-foreground w-14 shrink-0 text-[11px]"
                  >
                    Oggetto
                  </label>
                  <input
                    id="compose-subject"
                    value={form.subject}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, subject: event.target.value }))
                    }
                    onFocus={() => closeRecipientSuggestions()}
                    placeholder="Inserisci oggetto"
                    disabled={!account}
                    className="placeholder:text-muted-foreground/70 h-8 min-w-0 flex-1 bg-transparent text-[12.5px] font-medium outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <RichTextEditor
                  value={form.html}
                  disabled={!account}
                  defaultFontFamily={MAIL_COMPOSER_DEFAULT_FONT_FAMILY}
                  expanded={editorFocusMode}
                  expandToContainer
                  // A reply already knows who it is going to, so the next
                  // thing the user does is write. A new message does not.
                  autoFocusBody={Boolean(initialData?.to?.length)}
                  onFileDragEnter={beginFileDrag}
                  onExpandedChange={(expanded) => {
                    setEditorFocusMode(expanded)

                    if (expanded) {
                      closeRecipientSuggestions()
                    }
                  }}
                  onChange={(html, text) => {
                    setForm((current) => ({ ...current, html, text }))
                  }}
                />
              </div>

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((attachment) => {
                    const key = attachmentKey(attachment)

                    return (
                      <AttachmentChip
                        key={key}
                        fileName={attachment.name}
                        sizeBytes={attachment.size}
                        busy={isPendingOriginal(attachment)}
                        failed={attachment.failed}
                        openHint={
                          attachment.failed
                            ? 'non scaricato dal messaggio originale'
                            : isPendingOriginal(attachment)
                              ? 'scaricamento dal messaggio originale…'
                              : undefined
                        }
                        trailing={
                          <>
                            {attachment.failed && (
                              <IconButton
                                label={`Riprova a scaricare ${attachment.name}`}
                                tooltipSide="top"
                                className="size-5"
                                onClick={() => retryAttachment(key)}
                              >
                                <RotateCw className="size-3" />
                              </IconButton>
                            )}
                            <IconButton
                              label={`Rimuovi ${attachment.name}`}
                              tooltipSide="top"
                              className="size-5"
                              onClick={() => removeAttachment(key)}
                            >
                              <X className="size-3" />
                            </IconButton>
                          </>
                        }
                      />
                    )
                  })}
                </div>
              )}

              <DialogFooter className="sm:justify-between">
                <AttachMenu
                  disabled={!account}
                  originals={unattachedOriginals}
                  onAttachOriginals={attachOriginals}
                  onAttachPaths={(paths) => void attachPaths(paths)}
                  onBrowse={() => void handlePickAttachments()}
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[12px]"
                    onClick={() => handleDialogOpenChange(false)}
                  >
                    Annulla
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                    className="h-8 gap-1.5 text-[12px]"
                  >
                    <Send className="size-3.5" />
                    Invia
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </>
  )
}
