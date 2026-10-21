import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ChevronDown, Paperclip, RotateCw, Send, X } from 'lucide-react'
import { toast } from 'sonner'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
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
import { RecipientField, type RecipientFieldKey } from '@renderer/features/mail/recipient-field'
import { RichTextEditor } from '@renderer/features/mail/rich-text-editor'
import { commandForKeyEvent, useShortcutOverrides } from '@renderer/lib/command-shortcuts'
import { htmlToPlainText } from '@renderer/lib/email'
import { cn } from '@renderer/lib/utils'
import {
  addressKey,
  isValidEmailAddress,
  mergeRecipients,
  parseRecipients
} from '@shared/email-address'
import { MAIL_COMPOSER_DEFAULT_FONT_FAMILY } from '@shared/mail-fonts'
import type {
  ComposeMailInput,
  MailAccount,
  MailAddress,
  MailAttachment,
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
  to?: MailAddress[]
  cc?: MailAddress[]
  bcc?: MailAddress[]
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
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references?: string[]
}

/** What is typed in each recipient field and not yet a recipient. */
type RecipientDrafts = Readonly<Record<RecipientFieldKey, string>>

const EMPTY_RECIPIENT_DRAFTS: RecipientDrafts = { to: '', cc: '', bcc: '' }
const RECIPIENT_FIELDS: ReadonlyArray<RecipientFieldKey> = ['to', 'cc', 'bcc']

const COMPOSER_TITLES: Readonly<Record<ComposerKind, string>> = {
  new: 'Nuovo messaggio',
  reply: 'Rispondi',
  forward: 'Inoltra messaggio'
}

function buildInitialFields(
  initialData: ComposerInitialData | undefined
): Pick<ComposerFormState, 'to' | 'cc' | 'bcc' | 'subject'> {
  return {
    to: initialData?.to ?? [],
    cc: initialData?.cc ?? [],
    bcc: initialData?.bcc ?? [],
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

/** The addresses of a recipient list, in order: whether two lists name the same people. */
function recipientKeys(recipients: ReadonlyArray<MailAddress>): string {
  return recipients.map((recipient) => addressKey(recipient.address)).join('\n')
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
  const [recipientDrafts, setRecipientDrafts] = useState<RecipientDrafts>(EMPTY_RECIPIENT_DRAFTS)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const shortcutOverrides = useShortcutOverrides()
  /**
   * Cc and Ccn stay folded away until they are wanted. They were always on
   * screen, which cost two rows of every message to serve the small minority
   * that carbon-copies — and a reply that already carries a Cc list has to
   * show them, so the toggle follows the content rather than overriding it.
   */
  const [ccBccRequested, setCcBccRequested] = useState(false)
  const toInputRef = useRef<HTMLInputElement | null>(null)
  const ccInputRef = useRef<HTMLInputElement | null>(null)
  const subjectInputRef = useRef<HTMLInputElement | null>(null)
  const signatureRequestIdRef = useRef(0)
  // Whether the sending account's signature went into the body. When it is
  // missing at the next account switch, the user deleted it, and the next
  // account's signature is not forced back in.
  const bodyHadSignatureRef = useRef(false)
  // The signature the body was given, so an account switch can tell a
  // signature the user wrote in from one they left alone.
  const insertedSignatureRef = useRef<string | null>(null)

  const account = accounts.find((candidate) => candidate.id === accountId) ?? null
  // The "Da" row: with more than one account, and whenever the one a
  // reopened draft names is gone, so another can be picked.
  const hasAccountChoice = accounts.length > 1 || (!account && accounts.length > 0)
  const kind = initialData?.kind ?? 'new'
  const sourceAccount = initialData?.sourceAccountId
    ? (accounts.find((candidate) => candidate.id === initialData.sourceAccountId) ?? null)
    : null

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
      setRecipientDrafts(EMPTY_RECIPIENT_DRAFTS)
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
      insertedSignatureRef.current = null
      return
    }

    const applyInitialState = (signatureHtml: string | null): void => {
      if (requestId !== signatureRequestIdRef.current) {
        return
      }

      bodyHadSignatureRef.current = splitSignature(signatureHtml) !== null
      insertedSignatureRef.current = signatureHtml
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
      const previousSignature = insertedSignatureRef.current
      bodyHadSignatureRef.current = splitSignature(signatureHtml) !== null
      insertedSignatureRef.current = signatureHtml
      setForm((current) => {
        const html = replaceComposerSignature(
          current.html,
          signatureHtml,
          insertIfMissing,
          previousSignature
        )
        return html === current.html ? current : { ...current, html, text: htmlToPlainText(html) }
      })
    } catch (error) {
      toast.error(`Firma di ${nextAccount.email} non disponibile`, {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  const closeComposerImmediately = useCallback((): void => {
    setEditorFocusMode(false)
    onOpenChange(false)
  }, [onOpenChange])

  /**
   * Closing asks first only when something the user put in would be lost:
   * fields changed from how the composer opened, attachments, or anything
   * written in the body. A reply opened and closed untouched — even after
   * trying another account — just closes.
   */
  const requestComposerClose = async (): Promise<void> => {
    const initialFields = buildInitialFields(initialData)
    const hasUserContent =
      RECIPIENT_FIELDS.some(
        (field) =>
          recipientKeys(form[field]) !== recipientKeys(initialFields[field]) ||
          recipientDrafts[field].trim()
      ) ||
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

  const takenRecipientKeys = useMemo(
    () =>
      new Set(
        [...form.to, ...form.cc, ...form.bcc].map((recipient) => addressKey(recipient.address))
      ),
    [form.bcc, form.cc, form.to]
  )
  const hasRecipients = RECIPIENT_FIELDS.some(
    (field) => form[field].length > 0 || recipientDrafts[field].trim()
  )

  // Every attachment must have its file: an original still being copied, or
  // whose copy failed, would otherwise go missing without a word.
  const canSend = Boolean(
    account &&
    hasRecipients &&
    form.html.trim() &&
    attachments.every((attachment) => attachment.path)
  )

  // The window said "Nuovo messaggio" even when the user had just hit
  // Rispondi, which is the one moment they need confirming that the reply
  // carried the thread with it.
  const composerTitle = COMPOSER_TITLES[kind]

  // Content wins over the toggle: a reply-all or a reopened draft that
  // already carries copies must never hide them behind a disclosure.
  const ccBccVisible =
    ccBccRequested ||
    form.cc.length > 0 ||
    form.bcc.length > 0 ||
    Boolean(recipientDrafts.cc || recipientDrafts.bcc)

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

  /** A recipient moved to another field: dragged there, or sent from its menu. */
  const moveRecipient = (
    recipient: MailAddress,
    from: RecipientFieldKey,
    to: RecipientFieldKey
  ): void => {
    const key = addressKey(recipient.address)
    setForm((current) => ({
      ...current,
      [from]: current[from].filter((entry) => addressKey(entry.address) !== key),
      [to]: mergeRecipients(current[to], [recipient])
    }))
  }

  const renderRecipientField = (
    field: RecipientFieldKey,
    placeholder: string,
    trailing?: React.ReactNode
  ): React.JSX.Element => (
    <RecipientField
      field={field}
      recipients={form[field]}
      onRecipientsChange={(update) =>
        setForm((current) => ({ ...current, [field]: update(current[field]) }))
      }
      draft={recipientDrafts[field]}
      onDraftChange={(draft) => setRecipientDrafts((current) => ({ ...current, [field]: draft }))}
      takenKeys={takenRecipientKeys}
      moveTargets={RECIPIENT_FIELDS.filter((target) => target !== field)}
      onMoveRecipient={moveRecipient}
      placeholder={placeholder}
      disabled={!account}
      inputRef={field === 'to' ? toInputRef : field === 'cc' ? ccInputRef : undefined}
      trailing={trailing}
    />
  )

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

  const runComposerCommand = (commandId: string): void => {
    switch (commandId) {
      case 'send':
        void handleSend()
        return
      case 'attach':
        if (account) {
          void handlePickAttachments()
        }
        return
      case 'show-cc':
        if (account) {
          setEditorFocusMode(false)
          setCcBccRequested(true)
          window.requestAnimationFrame(() => ccInputRef.current?.focus())
        }
        return
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!account || !canSend) {
      return
    }

    // What is still typed goes too, as it would on leaving its field.
    const [to, cc, bcc] = RECIPIENT_FIELDS.map((field) =>
      mergeRecipients(form[field], parseRecipients(recipientDrafts[field]))
    )
    const invalid = [...to, ...cc, ...bcc].filter(
      (recipient) => !isValidEmailAddress(recipient.address)
    )

    setForm((current) => ({ ...current, to, cc, bcc }))
    setRecipientDrafts(EMPTY_RECIPIENT_DRAFTS)

    if (invalid.length > 0) {
      toast.error(
        invalid.length === 1
          ? `«${invalid[0].address}» non è un indirizzo valido`
          : `${invalid.length} indirizzi non sono validi`,
        { description: 'Correggi o togli i destinatari in rosso, poi invia.' }
      )
      return
    }

    if (
      !form.subject.trim() &&
      !(await confirm({
        title: 'Inviare senza oggetto?',
        description:
          'Chi riceve il messaggio non saprà di cosa tratta finché non lo apre, e cercarlo sarà più difficile.',
        confirmLabel: 'Invia senza oggetto',
        cancelLabel: 'Scrivi l’oggetto'
      }))
    ) {
      window.requestAnimationFrame(() => subjectInputRef.current?.focus())
      return
    }

    const payload: ComposeMailInput = {
      accountId: account.id,
      to,
      cc,
      bcc,
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
      to,
      cc,
      bcc,
      subject: form.subject,
      html: form.html,
      inReplyTo: form.inReplyTo,
      references: form.references,
      original: initialData?.original,
      attachments: [...attachments]
    }

    setEditorFocusMode(false)
    onOpenChange(false)
    onSendRequested(payload, draft)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          hideClose={editorFocusMode}
          // A new message starts from who it goes to; a reply in its body,
          // once that is in (`autoFocusBody`) — never on the "Da" menu.
          onOpenAutoFocus={(event) => {
            event.preventDefault()

            if (!initialData?.to?.length) {
              toInputRef.current?.focus()
            }
          }}
          // Escape leaves the full-screen editor first, as its toggle does;
          // only then does it ask to close the message.
          onEscapeKeyDown={(event) => {
            if (editorFocusMode) {
              event.preventDefault()
              setEditorFocusMode(false)
            }
          }}
          // The composer's commands, from any field — and from the editor,
          // which hands over the chords it does not use itself.
          onKeyDown={(event) => {
            const command = commandForKeyEvent(event.nativeEvent, 'composer', shortcutOverrides)

            if (!command || event.repeat) {
              return
            }

            event.preventDefault()
            runComposerCommand(command.id)
          }}
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
                onExpandedChange={setEditorFocusMode}
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
                {renderRecipientField('to', 'Nome o indirizzo email', ccBccToggle)}
                {ccBccVisible && renderRecipientField('cc', 'Copia per conoscenza')}
                {ccBccVisible && renderRecipientField('bcc', 'Copia nascosta')}

                <div className="flex items-center gap-2 px-2">
                  <label
                    htmlFor="compose-subject"
                    className="text-muted-foreground w-14 shrink-0 text-[11px]"
                  >
                    Oggetto
                  </label>
                  <input
                    ref={subjectInputRef}
                    id="compose-subject"
                    value={form.subject}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, subject: event.target.value }))
                    }
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
                  // thing the user does is write — once its body is in. A
                  // new message does not.
                  autoFocusBody={Boolean(initialData?.to?.length) && bodyReady}
                  onFileDragEnter={beginFileDrag}
                  onExpandedChange={setEditorFocusMode}
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
                  <ActionTooltip label="Invia il messaggio" commandId="send" side="top">
                    <Button
                      size="sm"
                      onClick={() => void handleSend()}
                      disabled={!canSend}
                      className="h-8 gap-1.5 text-[12px]"
                    >
                      <Send className="size-3.5" />
                      Invia
                    </Button>
                  </ActionTooltip>
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
