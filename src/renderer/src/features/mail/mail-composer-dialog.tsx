import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Paperclip, Send, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { IconButton } from '@renderer/components/ui/icon-button'
import { AttachmentChip } from '@renderer/features/mail/attachment-chip'
import { RichTextEditor } from '@renderer/features/mail/rich-text-editor'
import { htmlToPlainText, splitRecipients } from '@renderer/lib/email'
import { cn } from '@renderer/lib/utils'
import { MAIL_COMPOSER_DEFAULT_FONT_FAMILY } from '@shared/mail-fonts'
import type {
  ComposeMailInput,
  MailAccount,
  MailContactSuggestion,
  PickedAttachment
} from '@shared/models'

export interface ComposerInitialData {
  to?: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  html?: string
  inReplyTo?: string
  references?: string[]
  attachments?: PickedAttachment[]
}

export interface ComposerRetryDraft {
  accountId: string
  initialData: ComposerInitialData
}

interface MailComposerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: MailAccount | null
  initialData?: ComposerInitialData
  onSendRequested: (payload: ComposeMailInput, retryDraft: ComposerRetryDraft) => void
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

const EMPTY_COMPOSER_HTML = '<p></p>'
const QUOTED_CONTENT_MARKER_PATTERNS = [
  /<div\b[^>]*class=["'][^"']*\bgmail_quote\b/i,
  /<blockquote\b/i,
  /<hr\b/i
]

function normalizeSignatureHtmlForComposer(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()

  if (!trimmed) {
    return null
  }

  const hasEmbeddedMedia = /<(?:img|svg|video|audio)\b/i.test(trimmed)
  const visibleText = trimmed
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!visibleText && !hasEmbeddedMedia) {
    return null
  }

  return trimmed
}

function normalizeAuthoredIntroHtmlForComposer(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()

  if (!trimmed) {
    return null
  }

  const hasEmbeddedMedia = /<(?:img|svg|video|audio)\b/i.test(trimmed)
  const visibleText = trimmed
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!visibleText && !hasEmbeddedMedia) {
    return EMPTY_COMPOSER_HTML
  }

  return trimmed
}

function isEmptyComposerHtml(value: string | null | undefined): boolean {
  const trimmed = (value ?? '').trim()

  return !trimmed || /^<p>\s*(?:<br\s*\/?>)?\s*<\/p>$/i.test(trimmed)
}

function joinComposerHtmlWithSignature(
  htmlBeforeSignature: string | null | undefined,
  signatureHtml: string
): string {
  return isEmptyComposerHtml(htmlBeforeSignature)
    ? signatureHtml
    : `${htmlBeforeSignature?.trim() ?? ''}${signatureHtml}`
}

function buildInitialHtml(
  initialData: ComposerInitialData | undefined,
  signatureHtml: string | null
): string {
  const normalizedSignatureHtml = normalizeSignatureHtmlForComposer(signatureHtml)
  const initialHtml = typeof initialData?.html === 'string' ? initialData.html : null

  if (!initialHtml) {
    if (!normalizedSignatureHtml) {
      return EMPTY_COMPOSER_HTML
    }

    return normalizedSignatureHtml
  }

  const firstQuotedContentIndex = QUOTED_CONTENT_MARKER_PATTERNS.reduce<number>(
    (currentIndex, pattern) => {
      const match = pattern.exec(initialHtml)

      if (!match || match.index < 0) {
        return currentIndex
      }

      if (currentIndex < 0) {
        return match.index
      }

      return Math.min(currentIndex, match.index)
    },
    -1
  )

  if (firstQuotedContentIndex < 0) {
    if (!normalizedSignatureHtml) {
      return initialHtml
    }

    const normalizedSignatureForSearch = normalizedSignatureHtml.replace(/\s+/g, ' ').trim()
    const normalizedInitialHtmlForSearch = initialHtml.replace(/\s+/g, ' ').trim()

    if (
      normalizedSignatureForSearch &&
      normalizedInitialHtmlForSearch
        .toLowerCase()
        .includes(normalizedSignatureForSearch.toLowerCase())
    ) {
      return initialHtml
    }

    return joinComposerHtmlWithSignature(initialHtml, normalizedSignatureHtml)
  }

  const introHtml =
    firstQuotedContentIndex < 0 ? initialHtml : initialHtml.slice(0, firstQuotedContentIndex)
  const normalizedAuthoredIntroHtml =
    normalizeAuthoredIntroHtmlForComposer(introHtml) ?? EMPTY_COMPOSER_HTML
  const normalizedIntroHtml = introHtml.replace(/\s+/g, ' ').trim()

  if (!normalizedSignatureHtml) {
    return `${normalizedAuthoredIntroHtml}${initialHtml.slice(firstQuotedContentIndex)}`
  }

  const normalizedSignatureForSearch = normalizedSignatureHtml.replace(/\s+/g, ' ').trim()

  if (
    normalizedSignatureForSearch &&
    normalizedIntroHtml.toLowerCase().includes(normalizedSignatureForSearch.toLowerCase())
  ) {
    return `${normalizedAuthoredIntroHtml}${initialHtml.slice(firstQuotedContentIndex)}`
  }

  const quotedHtml = initialHtml.slice(firstQuotedContentIndex)

  return `${joinComposerHtmlWithSignature(normalizedAuthoredIntroHtml, normalizedSignatureHtml)}${quotedHtml}`
}

function buildInitialState(
  initialData: ComposerInitialData | undefined,
  signatureHtml: string | null
): ComposerFormState {
  const html = buildInitialHtml(initialData, signatureHtml)

  return {
    to: (initialData?.to ?? []).join(', '),
    cc: (initialData?.cc ?? []).join(', '),
    bcc: (initialData?.bcc ?? []).join(', '),
    subject: initialData?.subject ?? '',
    html,
    text: htmlToPlainText(html),
    inReplyTo: initialData?.inReplyTo,
    references: initialData?.references
  }
}

function hasMeaningfulComposerHtml(value: string): boolean {
  const trimmed = value.replace(/\u200B/g, '').trim()

  if (!trimmed) {
    return false
  }

  const document = new DOMParser().parseFromString(`<div>${trimmed}</div>`, 'text/html')
  const root = document.body.firstElementChild

  if (!root) {
    return false
  }

  for (const node of [...root.querySelectorAll('script, style')]) {
    node.remove()
  }

  const visibleText =
    root.textContent
      ?.replace(/\u00a0/g, ' ')
      .replace(/\u200B/g, '')
      .replace(/\s+/g, ' ')
      .trim() ?? ''

  if (visibleText) {
    return true
  }

  return Boolean(root.querySelector('img, video, audio, table, hr, svg'))
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
  account,
  initialData,
  onSendRequested
}: MailComposerDialogProps): React.JSX.Element {
  const [form, setForm] = useState<ComposerFormState>(() => buildInitialState(initialData, null))
  const [attachments, setAttachments] = useState<PickedAttachment[]>([])
  const [editorFocusMode, setEditorFocusMode] = useState(false)
  const [recipientSuggestions, setRecipientSuggestions] = useState<MailContactSuggestion[]>([])
  const [recipientQuery, setRecipientQuery] = useState('')
  const [activeRecipientField, setActiveRecipientField] = useState<RecipientFieldKey | null>(null)
  const [activeTokenContext, setActiveTokenContext] = useState<RecipientTokenContext | null>(null)
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0)
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false)
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
  const composerBootstrapRequestIdRef = useRef(0)

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
      setAttachments(initialData?.attachments ? [...initialData.attachments] : [])
      setEditorFocusMode(false)
      // Without this the disclosure stayed open for the rest of the session:
      // one message that needed a Cc left every later message showing two
      // empty rows it had no use for.
      setCcBccRequested(false)
    }
  }

  useEffect(() => {
    if (!open) {
      composerBootstrapRequestIdRef.current += 1
      return
    }

    // The signature does come from outside React, so fetching it stays here.
    const requestId = ++composerBootstrapRequestIdRef.current
    const applyInitialState = (signatureHtml: string | null): void => {
      if (requestId !== composerBootstrapRequestIdRef.current) {
        return
      }

      setForm(buildInitialState(initialData, signatureHtml))
    }

    if (!account) {
      applyInitialState(null)
      return
    }

    void window.mailApi
      .getAccountSignature(account.id)
      .then((accountSignature) => {
        if (requestId !== composerBootstrapRequestIdRef.current) {
          return
        }

        applyInitialState(accountSignature?.html ?? null)
      })
      .catch(() => {
        applyInitialState(null)
      })
  }, [account, initialData, open])

  const hasDiscardableContent = useMemo(
    () =>
      Boolean(
        form.to.trim() ||
        form.cc.trim() ||
        form.bcc.trim() ||
        form.subject.trim() ||
        attachments.length > 0 ||
        hasMeaningfulComposerHtml(form.html)
      ),
    [attachments.length, form.bcc, form.cc, form.html, form.subject, form.to]
  )

  const closeComposerImmediately = useCallback((): void => {
    setDiscardConfirmationOpen(false)
    closeRecipientSuggestions()
    setEditorFocusMode(false)
    onOpenChange(false)
  }, [closeRecipientSuggestions, onOpenChange])

  const requestComposerClose = useCallback((): void => {
    if (hasDiscardableContent) {
      closeRecipientSuggestions()
      setDiscardConfirmationOpen(true)
      return
    }

    closeComposerImmediately()
  }, [closeComposerImmediately, closeRecipientSuggestions, hasDiscardableContent])

  const handleDialogOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      setDiscardConfirmationOpen(false)
      onOpenChange(true)
      return
    }

    requestComposerClose()
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

  const canSend = Boolean(
    account && toRecipients.length > 0 && form.subject.trim() && form.html.trim()
  )

  /**
   * The window said "Nuovo messaggio" even when the user had just hit
   * Rispondi, which is the one moment they need confirming that the reply
   * carried the thread with it. Read from the fields rather than sniffed
   * from the subject prefix: only a reply carries `inReplyTo`, and only a
   * forward arrives with a body already written.
   */
  const composerTitle = initialData?.inReplyTo
    ? 'Rispondi'
    : initialData?.html
      ? 'Inoltra messaggio'
      : 'Nuovo messaggio'

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
            onClick={(event) => refreshFor(event.currentTarget)}
            onKeyUp={(event) => refreshFor(event.currentTarget)}
            onKeyDown={(event) => handleRecipientKeyDown(field, event)}
            placeholder={placeholder}
            disabled={!account}
            className="placeholder:text-muted-foreground/70 h-8 w-full bg-transparent text-[12.5px] outline-none disabled:opacity-50"
          />
          {activeRecipientField === field && recipientSuggestions.length > 0 && (
            <div className="border-border bg-popover absolute top-full right-0 left-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-md border shadow-xl">
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

  const handlePickAttachments = async (): Promise<void> => {
    const picked = await window.mailApi.pickAttachments()

    if (picked.length === 0) {
      return
    }

    setAttachments((current) => {
      const knownPaths = new Set(current.map((item) => item.path))
      const uniqueNew = picked.filter((item) => !knownPaths.has(item.path))
      return [...current, ...uniqueNew]
    })
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
      attachments: attachments.map((attachment) => ({
        path: attachment.path,
        name: attachment.name
      }))
    }
    const retryDraft: ComposerRetryDraft = {
      accountId: account.id,
      initialData: {
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: form.subject,
        html: form.html,
        inReplyTo: form.inReplyTo,
        references: form.references,
        attachments: [...attachments]
      }
    }

    closeRecipientSuggestions()
    setDiscardConfirmationOpen(false)
    setEditorFocusMode(false)
    onOpenChange(false)
    onSendRequested(payload, retryDraft)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          hideClose={editorFocusMode}
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
          {editorFocusMode ? (
            <div className="h-full min-h-0">
              <RichTextEditor
                value={form.html}
                disabled={!account}
                defaultFontFamily={MAIL_COMPOSER_DEFAULT_FONT_FAMILY}
                expanded={editorFocusMode}
                expandToContainer
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
                <DialogDescription className="text-[11px]">
                  {account
                    ? `Invio da ${account.email}`
                    : 'Seleziona prima un account per comporre una nuova email.'}
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
                  {attachments.map((attachment) => (
                    <AttachmentChip
                      key={attachment.path}
                      fileName={attachment.name}
                      sizeBytes={attachment.size}
                      trailing={
                        <IconButton
                          label={`Rimuovi ${attachment.name}`}
                          tooltipSide="top"
                          className="size-5"
                          onClick={() => {
                            setAttachments((current) =>
                              current.filter((item) => item.path !== attachment.path)
                            )
                          }}
                        >
                          <X className="size-3" />
                        </IconButton>
                      }
                    />
                  ))}
                </div>
              )}

              <DialogFooter className="sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-[12px]"
                  onClick={handlePickAttachments}
                  disabled={!account}
                >
                  <Paperclip className="size-3.5" />
                  Allega
                </Button>
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

      <Dialog
        open={open && discardConfirmationOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDiscardConfirmationOpen(false)
          }
        }}
      >
        <DialogContent
          hideClose
          role="alertdialog"
          overlayClassName="z-[60]"
          className="z-[70] w-[min(430px,calc(100vw-2rem))] gap-5"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Chiudere la bozza?</DialogTitle>
            <DialogDescription>
              Chiudendo questa finestra perderai il contenuto già inserito nel messaggio.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDiscardConfirmationOpen(false)}>
              Torna indietro
            </Button>
            <Button type="button" variant="destructive" onClick={closeComposerImmediately}>
              Chiudi e scarta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
