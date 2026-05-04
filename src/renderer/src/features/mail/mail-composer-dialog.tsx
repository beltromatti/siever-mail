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
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { RichTextEditor } from '@renderer/features/mail/rich-text-editor'
import { htmlToPlainText, splitRecipients } from '@renderer/lib/email'
import { MAIL_COMPOSER_DEFAULT_FONT_FAMILY } from '@renderer/lib/mail-fonts'
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

  useEffect(() => {
    if (!open) {
      composerBootstrapRequestIdRef.current += 1
      return
    }

    setAttachments(initialData?.attachments ? [...initialData.attachments] : [])
    setEditorFocusMode(false)

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
          className={
            editorFocusMode
              ? 'h-[92vh] max-h-[92vh] w-[min(1200px,calc(100vw-1.5rem))] overflow-hidden p-3'
              : 'scrollbar-y max-h-[90vh] overflow-y-auto'
          }
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
              <DialogHeader>
                <DialogTitle>Nuovo messaggio</DialogTitle>
                <DialogDescription>
                  {account
                    ? `Invio da ${account.email}`
                    : 'Seleziona prima un account per comporre una nuova email.'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Label htmlFor="compose-to">A</Label>
                    <div className="relative" ref={toFieldContainerRef}>
                      <Input
                        ref={toInputRef}
                        id="compose-to"
                        value={form.to}
                        onChange={(event) => {
                          const value = event.target.value
                          setForm((current) => ({ ...current, to: value }))
                          refreshRecipientSuggestions('to', value, event.currentTarget)
                        }}
                        onFocus={(event) =>
                          refreshRecipientSuggestions(
                            'to',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onClick={(event) =>
                          refreshRecipientSuggestions(
                            'to',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onKeyUp={(event) =>
                          refreshRecipientSuggestions(
                            'to',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onKeyDown={(event) => handleRecipientKeyDown('to', event)}
                        placeholder="destinatario1@azienda.com, destinatario2@azienda.com"
                        disabled={!account}
                      />
                      {activeRecipientField === 'to' && recipientSuggestions.length > 0 && (
                        <div className="border-border bg-card absolute top-full right-0 left-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-md border shadow-xl">
                          {recipientSuggestions.map((suggestion, index) => (
                            <button
                              key={`${suggestion.email}-${index}`}
                              type="button"
                              className={`hover:bg-secondary/70 focus:bg-secondary/70 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                                highlightedSuggestionIndex === index ? 'bg-secondary/65' : ''
                              }`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                              onClick={() => applyRecipientSuggestion('to', suggestion)}
                            >
                              <span className="truncate font-medium">
                                {suggestion.name || suggestion.email}
                              </span>
                              {suggestion.name && (
                                <span className="text-muted-foreground truncate text-xs">
                                  {suggestion.email}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="compose-cc">Cc</Label>
                    <div className="relative" ref={ccFieldContainerRef}>
                      <Input
                        ref={ccInputRef}
                        id="compose-cc"
                        value={form.cc}
                        onChange={(event) => {
                          const value = event.target.value
                          setForm((current) => ({ ...current, cc: value }))
                          refreshRecipientSuggestions('cc', value, event.currentTarget)
                        }}
                        onFocus={(event) =>
                          refreshRecipientSuggestions(
                            'cc',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onClick={(event) =>
                          refreshRecipientSuggestions(
                            'cc',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onKeyUp={(event) =>
                          refreshRecipientSuggestions(
                            'cc',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onKeyDown={(event) => handleRecipientKeyDown('cc', event)}
                        placeholder="opzionale"
                        disabled={!account}
                      />
                      {activeRecipientField === 'cc' && recipientSuggestions.length > 0 && (
                        <div className="border-border bg-card absolute top-full right-0 left-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-md border shadow-xl">
                          {recipientSuggestions.map((suggestion, index) => (
                            <button
                              key={`${suggestion.email}-${index}`}
                              type="button"
                              className={`hover:bg-secondary/70 focus:bg-secondary/70 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                                highlightedSuggestionIndex === index ? 'bg-secondary/65' : ''
                              }`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                              onClick={() => applyRecipientSuggestion('cc', suggestion)}
                            >
                              <span className="truncate font-medium">
                                {suggestion.name || suggestion.email}
                              </span>
                              {suggestion.name && (
                                <span className="text-muted-foreground truncate text-xs">
                                  {suggestion.email}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="compose-bcc">Bcc</Label>
                    <div className="relative" ref={bccFieldContainerRef}>
                      <Input
                        ref={bccInputRef}
                        id="compose-bcc"
                        value={form.bcc}
                        onChange={(event) => {
                          const value = event.target.value
                          setForm((current) => ({ ...current, bcc: value }))
                          refreshRecipientSuggestions('bcc', value, event.currentTarget)
                        }}
                        onFocus={(event) =>
                          refreshRecipientSuggestions(
                            'bcc',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onClick={(event) =>
                          refreshRecipientSuggestions(
                            'bcc',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onKeyUp={(event) =>
                          refreshRecipientSuggestions(
                            'bcc',
                            event.currentTarget.value,
                            event.currentTarget
                          )
                        }
                        onKeyDown={(event) => handleRecipientKeyDown('bcc', event)}
                        placeholder="opzionale"
                        disabled={!account}
                      />
                      {activeRecipientField === 'bcc' && recipientSuggestions.length > 0 && (
                        <div className="border-border bg-card absolute top-full right-0 left-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-md border shadow-xl">
                          {recipientSuggestions.map((suggestion, index) => (
                            <button
                              key={`${suggestion.email}-${index}`}
                              type="button"
                              className={`hover:bg-secondary/70 focus:bg-secondary/70 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                                highlightedSuggestionIndex === index ? 'bg-secondary/65' : ''
                              }`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                              onClick={() => applyRecipientSuggestion('bcc', suggestion)}
                            >
                              <span className="truncate font-medium">
                                {suggestion.name || suggestion.email}
                              </span>
                              {suggestion.name && (
                                <span className="text-muted-foreground truncate text-xs">
                                  {suggestion.email}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <Label htmlFor="compose-subject">Oggetto</Label>
                    <Input
                      id="compose-subject"
                      value={form.subject}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, subject: event.target.value }))
                      }
                      onFocus={() => closeRecipientSuggestions()}
                      placeholder="Inserisci oggetto"
                      disabled={!account}
                    />
                  </div>
                </div>

                <RichTextEditor
                  value={form.html}
                  disabled={!account}
                  defaultFontFamily={MAIL_COMPOSER_DEFAULT_FONT_FAMILY}
                  expanded={editorFocusMode}
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

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={handlePickAttachments}
                    >
                      <Paperclip className="size-4" />
                      Aggiungi allegati
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      {attachments.length} file selezionati
                    </span>
                  </div>

                  {attachments.length > 0 && (
                    <div className="border-border bg-muted/25 grid gap-2 rounded-md border p-2 md:grid-cols-2">
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.path}
                          className="border-border bg-card/80 flex items-center justify-between rounded-md border px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">{attachment.name}</p>
                            <p className="text-muted-foreground text-[11px]">
                              {Math.round(attachment.size / 1024)} KB
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => {
                              setAttachments((current) =>
                                current.filter((item) => item.path !== attachment.path)
                              )
                            }}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => handleDialogOpenChange(false)}>
                  Annulla
                </Button>
                <Button onClick={() => void handleSend()} disabled={!canSend} className="gap-2">
                  <Send className="size-4" />
                  Invia
                </Button>
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
          overlayClassName="z-[60] bg-background/80"
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
