import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  Check,
  ChevronDown,
  CloudOff,
  LoaderCircle,
  Minus,
  Paperclip,
  RotateCw,
  Send,
  Trash2,
  X
} from 'lucide-react'
import { toast } from 'sonner'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { AttachMenu } from '@renderer/features/mail/attach-menu'
import { AttachmentChip } from '@renderer/features/mail/attachment-chip'
import {
  buildComposerBody,
  replaceComposerSignature,
  splitSignature
} from '@renderer/features/mail/composer-body'
import { ComposerPanel } from '@renderer/features/mail/composer-panel'
import { RecipientField, type RecipientFieldKey } from '@renderer/features/mail/recipient-field'
import { RichTextEditor } from '@renderer/features/mail/rich-text-editor'
import { commandForKeyEvent, useShortcutOverrides } from '@renderer/lib/command-shortcuts'
import { htmlToPlainText } from '@renderer/lib/email'
import { cn, revealInFolderLabel } from '@renderer/lib/utils'
import {
  addressKey,
  isValidEmailAddress,
  mergeRecipients,
  parseRecipients
} from '@shared/email-address'
import { MAIL_COMPOSER_DEFAULT_FONT_FAMILY } from '@shared/mail-fonts'
import type {
  ComposeMailInput,
  DraftAttachment,
  DraftContent,
  DraftKind,
  DraftStatus,
  MailAccount,
  MailAddress,
  MailAttachment,
  MessageRef,
  PickedAttachment
} from '@shared/models'

export type ComposerKind = DraftKind

/** An attachment as the composer holds it (see `DraftAttachment`). */
export type ComposerAttachment = DraftAttachment

export interface ComposerInitialData {
  kind: ComposerKind
  /** The draft the message is: an existing one when it is opened again. */
  draftId?: string
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
  /** A body taken as it is, signature included — a draft opened again. */
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
  /** A draft's attachments, as they were. */
  attachments?: ComposerAttachment[]
}

/** One message being written: a draft, in front or parked in the dock. */
export interface ComposerSession {
  id: string
  initialData: ComposerInitialData
  /** A draft that exists already — opened from Bozze, or left open last time. */
  existing: boolean
  status?: DraftStatus
}

/** What the dock shows of a message being written. */
export interface ComposerSummary {
  kind: ComposerKind
  subject: string
  recipients: MailAddress[]
  status: DraftStatus | null
}

/** How a composer was let go of, for its owner to say so. */
export type ComposerOutcome =
  | { kind: 'untouched' }
  | { kind: 'saved'; content: DraftContent }
  | { kind: 'discarded'; content: DraftContent | null }

export interface MailComposerHandle {
  /** Saves the draft and closes, as the window's own close button does. */
  close: () => Promise<void>
}

interface MailComposerProps {
  session: ComposerSession
  /** In front; otherwise parked in the dock. */
  open: boolean
  accounts: MailAccount[]
  onMinimize: () => void
  onClosed: (outcome: ComposerOutcome) => void
  onSendRequested: (payload: ComposeMailInput, draft: ComposerInitialData) => void
  onSummaryChange: (summary: ComposerSummary) => void
  ref?: React.Ref<MailComposerHandle>
}

interface ComposerFormState {
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  html: string
  inReplyTo?: string
  references?: string[]
}

/** What is typed in each recipient field and not yet a recipient. */
type RecipientDrafts = Readonly<Record<RecipientFieldKey, string>>

const EMPTY_RECIPIENT_DRAFTS: RecipientDrafts = { to: '', cc: '', bcc: '' }
const RECIPIENT_FIELDS: ReadonlyArray<RecipientFieldKey> = ['to', 'cc', 'bcc']
/** A draft is kept this long after the last change: often enough to lose nothing. */
const DRAFT_SAVE_DELAY_MS = 700

export const COMPOSER_TITLES: Readonly<Record<ComposerKind, string>> = {
  new: 'Nuovo messaggio',
  reply: 'Rispondi',
  forward: 'Inoltra messaggio'
}

const SAVED_TIME_FORMAT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

function buildInitialState(
  initialData: ComposerInitialData,
  signatureHtml: string | null
): ComposerFormState {
  return {
    to: initialData.to ?? [],
    cc: initialData.cc ?? [],
    bcc: initialData.bcc ?? [],
    subject: initialData.subject ?? '',
    html: initialData.html ?? buildComposerBody(signatureHtml, initialData.quoteHtml),
    inReplyTo: initialData.inReplyTo,
    references: initialData.references
  }
}

/** What a composer opens with: a draft's own, or a forward's originals. */
function buildInitialAttachments(initialData: ComposerInitialData): ComposerAttachment[] {
  if (initialData.attachments) {
    return [...initialData.attachments]
  }

  if (initialData.kind !== 'forward' || !initialData.original) {
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

function isPendingOriginal(attachment: ComposerAttachment): boolean {
  return Boolean(attachment.originalId && !attachment.path && !attachment.failed)
}

/** A draft as the composer takes it up again. */
export function draftToInitialData(content: DraftContent): ComposerInitialData {
  return {
    kind: content.kind,
    draftId: content.id,
    accountId: content.accountId,
    sourceAccountId: content.sourceAccountId,
    to: content.to,
    cc: content.cc,
    bcc: content.bcc,
    subject: content.subject,
    html: content.html,
    inReplyTo: content.inReplyTo,
    references: content.references,
    original: content.original,
    attachments: content.attachments
  }
}

/** The line under the message that says where its draft stands. */
function DraftStatusLine({ status }: { status: DraftStatus | null }): React.JSX.Element | null {
  if (!status) {
    return null
  }

  const savedAt = status.savedAt ? SAVED_TIME_FORMAT.format(status.savedAt) : null
  const { icon, text, hint, tone } =
    status.state === 'saving'
      ? {
          icon: <LoaderCircle className="size-3 animate-spin" />,
          text: 'Salvataggio in Bozze…',
          hint: null,
          tone: ''
        }
      : status.state === 'error'
        ? {
            icon: <CloudOff className="size-3" />,
            text: 'Salvata su questo computer',
            hint: `Non ancora in Bozze: ${status.message ?? 'il server non risponde'}. Riprovo da solo.`,
            tone: 'text-warning'
          }
        : {
            icon: <Check className="size-3" />,
            text: savedAt ? `Salvata in Bozze alle ${savedAt}` : 'Salvata',
            hint:
              status.state === 'pending'
                ? 'Le ultime modifiche sono su questo computer e vanno in Bozze tra pochi secondi.'
                : null,
            tone: ''
          }

  const line = (
    <span
      className={cn(
        'text-muted-foreground flex min-w-0 items-center gap-1 text-[11px] whitespace-nowrap',
        tone
      )}
    >
      {icon}
      <span className="truncate">{text}</span>
    </span>
  )

  return hint ? (
    <Tooltip>
      <TooltipTrigger asChild>{line}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        {hint}
      </TooltipContent>
    </Tooltip>
  ) : (
    line
  )
}

/**
 * A message being written, as a draft: kept as it is typed — here at once,
 * in the account's Bozze a moment later (`saveDraft`) — so closing never
 * loses it. Its window is in front or parked in the dock (`ComposerPanel`):
 * Esc, a click beside it or "–" park it, the dock brings it back exactly as
 * it was. Closing keeps the draft in Bozze; the bin throws it away.
 */
export function MailComposer({
  session,
  open,
  accounts,
  onMinimize,
  onClosed,
  onSendRequested,
  onSummaryChange,
  ref
}: MailComposerProps): React.JSX.Element {
  const { initialData } = session
  const kind = initialData.kind
  const [form, setForm] = useState<ComposerFormState>(() =>
    initialData.html === undefined
      ? // A new body waits for its signature (below).
        { ...buildInitialState(initialData, null), html: '' }
      : buildInitialState(initialData, null)
  )
  const [accountId, setAccountId] = useState<string | null>(initialData.accountId)
  // False while a new body waits for its signature: switching account then
  // would race the signature being put in.
  const [bodyReady, setBodyReady] = useState(initialData.html !== undefined)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(() =>
    buildInitialAttachments(initialData)
  )
  const [editorFocusMode, setEditorFocusMode] = useState(false)
  const [recipientDrafts, setRecipientDrafts] = useState<RecipientDrafts>(EMPTY_RECIPIENT_DRAFTS)
  /**
   * Whether the user changed anything. Only then is the message a draft:
   * a composer opened and closed untouched — a reply, a new message — leaves
   * nothing behind, and a draft opened again is not filed anew unchanged.
   */
  const [touched, setTouched] = useState(false)
  /** Whether the draft exists, here and in Bozze: opened as one, or saved since. */
  const [persisted, setPersisted] = useState(session.existing)
  const [status, setStatus] = useState<DraftStatus | null>(session.status ?? null)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const shortcutOverrides = useShortcutOverrides()
  /**
   * Cc and Ccn stay folded away until they are wanted; a message that
   * already carries copies shows them.
   */
  const [ccBccRequested, setCcBccRequested] = useState(false)
  const toInputRef = useRef<HTMLInputElement | null>(null)
  const ccInputRef = useRef<HTMLInputElement | null>(null)
  const subjectInputRef = useRef<HTMLInputElement | null>(null)
  const signatureRequestIdRef = useRef(0)
  // Whether the sending account's signature went into the body. When it is
  // missing at the next account switch, the user deleted it, and the next
  // account's signature is not forced back in.
  const bodyHadSignatureRef = useRef(initialData.html !== undefined)
  // The signature the body was given, so an account switch can tell a
  // signature the user wrote in from one they left alone.
  const insertedSignatureRef = useRef<string | null>(null)
  const fieldIdPrefix = useId()
  const titleId = `${fieldIdPrefix}-title`

  const account = accounts.find((candidate) => candidate.id === accountId) ?? null
  // The "Da" row: with more than one account, and whenever the one a
  // reopened draft names is gone, so another can be picked.
  const hasAccountChoice = accounts.length > 1 || (!account && accounts.length > 0)
  const sourceAccount = initialData.sourceAccountId
    ? (accounts.find((candidate) => candidate.id === initialData.sourceAccountId) ?? null)
    : null

  /** Every change the user makes goes through here: it is what makes the message a draft. */
  const touch = useCallback((): void => setTouched(true), [])

  // A new body gets the sending account's signature, once.
  useEffect(() => {
    if (initialData.html !== undefined) {
      return
    }

    const requestId = ++signatureRequestIdRef.current
    const applySignature = (signatureHtml: string | null): void => {
      if (requestId !== signatureRequestIdRef.current) {
        return
      }

      bodyHadSignatureRef.current = splitSignature(signatureHtml) !== null
      insertedSignatureRef.current = signatureHtml
      setForm((current) => ({
        ...current,
        html: buildComposerBody(signatureHtml, initialData.quoteHtml)
      }))
      setBodyReady(true)
    }

    window.mailApi
      .getAccountSignature(initialData.accountId)
      .then((signature) => applySignature(signature?.html ?? null))
      .catch((error: unknown) => {
        toast.error('Firma non disponibile', {
          description: error instanceof Error ? error.message : undefined
        })
        applySignature(null)
      })
  }, [initialData])

  useEffect(
    () =>
      window.mailApi.onDraftStatusChanged((next) => {
        if (next.id === session.id) {
          setStatus(next)
        }
      }),
    [session.id]
  )

  // The original message's attachments the composer holds but has no file
  // for yet, copied in one go: the ones a forward opens with, the ones
  // picked from "Allega", the ones retried after a failure.
  const pendingOriginalIds = attachments
    .filter(isPendingOriginal)
    .map((attachment) => attachment.originalId)
    .join('\n')

  useEffect(() => {
    const original = initialData.original

    if (!original || !pendingOriginalIds) {
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
  }, [initialData, pendingOriginalIds])

  /** The draft as it stands, recipients still being typed included. */
  const contentWith = useCallback(
    (recipients?: Pick<ComposerFormState, 'to' | 'cc' | 'bcc'>): DraftContent | null =>
      account
        ? {
            id: session.id,
            kind,
            accountId: account.id,
            sourceAccountId: initialData.sourceAccountId,
            to: recipients?.to ?? form.to,
            cc: recipients?.cc ?? form.cc,
            bcc: recipients?.bcc ?? form.bcc,
            subject: form.subject,
            html: form.html,
            inReplyTo: form.inReplyTo,
            references: form.references,
            original: initialData.original,
            attachments
          }
        : null,
    [account, attachments, form, initialData, kind, session.id]
  )

  const content = useMemo(() => contentWith(), [contentWith])

  const saveDraft = useCallback(async (draft: DraftContent): Promise<void> => {
    try {
      setStatus(await window.mailApi.saveDraft(draft))
      setPersisted(true)
    } catch (error) {
      toast.error('Bozza non salvata', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }, [])

  // Kept as it is typed: a moment after the last change.
  useEffect(() => {
    if (!touched || !content || !bodyReady) {
      return
    }

    const timer = window.setTimeout(() => void saveDraft(content), DRAFT_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [bodyReady, content, saveDraft, touched])

  // Told only when it changes: the owner re-renders on every message.
  const onSummaryChangeRef = useRef(onSummaryChange)

  useEffect(() => {
    onSummaryChangeRef.current = onSummaryChange
  }, [onSummaryChange])

  useEffect(() => {
    onSummaryChangeRef.current({ kind, subject: form.subject, recipients: form.to, status })
  }, [form.subject, form.to, kind, status])

  /** The recipients with what is still typed in their fields, as leaving them would make it. */
  const committedRecipients = (): Pick<ComposerFormState, 'to' | 'cc' | 'bcc'> => {
    const [to, cc, bcc] = RECIPIENT_FIELDS.map((field) =>
      mergeRecipients(form[field], parseRecipients(recipientDrafts[field]))
    )
    return { to, cc, bcc }
  }

  /** Puts the message aside, in the dock; what changed goes to Bozze now. */
  const minimize = (): void => {
    if (editorFocusMode) {
      setEditorFocusMode(false)
    }

    if (persisted) {
      void window.mailApi.flushDraft(session.id).then(setStatus, () => undefined)
    }

    onMinimize()
  }

  /** Closes, keeping the draft in Bozze — unless nothing was ever written. */
  const close = async (): Promise<void> => {
    if (!touched && !persisted) {
      onClosed({ kind: 'untouched' })
      return
    }

    const draft = contentWith(committedRecipients())

    if (!draft) {
      onClosed({ kind: 'untouched' })
      return
    }

    if (touched) {
      await saveDraft(draft)
    }

    void window.mailApi.closeDraft(session.id).catch(() => undefined)
    onClosed({ kind: 'saved', content: draft })
  }

  const discard = (): void => {
    onClosed({
      kind: 'discarded',
      content: touched || persisted ? contentWith(committedRecipients()) : null
    })
  }

  useImperativeHandle(ref, () => ({ close }))

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

    touch()
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
        return html === current.html ? current : { ...current, html }
      })
    } catch (error) {
      toast.error(`Firma di ${nextAccount.email} non disponibile`, {
        description: error instanceof Error ? error.message : undefined
      })
    }
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
    bodyReady &&
    hasRecipients &&
    form.html.trim() &&
    attachments.every((attachment) => attachment.path)
  )

  // Content wins over the toggle: a reply-all or a draft that already
  // carries copies must never hide them behind a disclosure.
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
    touch()
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
      inputId={`${fieldIdPrefix}-${field}`}
      recipients={form[field]}
      onRecipientsChange={(update) => {
        touch()
        setForm((current) => ({ ...current, [field]: update(current[field]) }))
      }}
      draft={recipientDrafts[field]}
      onDraftChange={(draft) => {
        touch()
        setRecipientDrafts((current) => ({ ...current, [field]: draft }))
      }}
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

    touch()
    setAttachments((current) => {
      const knownPaths = new Set(current.map((item) => item.path))
      const uniqueNew = picked.filter((item) => !knownPaths.has(item.path))
      return [...current, ...uniqueNew]
    })
  }

  const originals = initialData.original?.attachments ?? []
  const unattachedOriginals = originals.filter(
    (original) => !attachments.some((attachment) => attachment.originalId === original.id)
  )

  const attachOriginals = (attachmentIds: string[]): void => {
    touch()
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
    touch()
    setAttachments((current) => current.filter((item) => attachmentKey(item) !== key))
  }

  /** Opens a file being sent, to check it or change it before it goes. */
  const openAttachment = async (attachment: ComposerAttachment): Promise<void> => {
    const { path, name } = attachment

    if (!path) {
      return
    }

    const reveal = {
      label: revealInFolderLabel(),
      onClick: () => void window.mailApi.revealFile(path)
    }

    try {
      const result = await window.mailApi.openFile(path)

      if (result.status === 'blocked') {
        toast(`${name} non si apre da qui`, {
          description: 'I file che avviano programmi si aprono solo dalla loro cartella.',
          action: reveal
        })
      } else if (result.status === 'no-application') {
        toast(`Nessuna applicazione apre ${name}`, {
          description: "Su questo computer non c'è un programma per questo tipo di file.",
          action: reveal
        })
      }
    } catch (error) {
      toast.error(`Impossibile aprire ${name}`, {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  const showAttachmentMenu = async (attachment: ComposerAttachment): Promise<void> => {
    const key = attachmentKey(attachment)
    const { path } = attachment
    const chosen = await window.mailApi.showContextMenu([
      { id: 'open', label: 'Apri', enabled: Boolean(path) },
      { id: 'reveal', label: revealInFolderLabel(), enabled: Boolean(path) },
      ...(attachment.failed ? [{ id: 'retry', label: 'Riprova a scaricarlo' }] : []),
      { type: 'separator' },
      { id: 'remove', label: 'Rimuovi' }
    ])

    if (chosen === 'open') {
      void openAttachment(attachment)
    } else if (chosen === 'reveal' && path) {
      void window.mailApi.revealFile(path)
    } else if (chosen === 'retry') {
      retryAttachment(key)
    } else if (chosen === 'remove') {
      removeAttachment(key)
    }
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
    const recipients = committedRecipients()
    const invalid = [...recipients.to, ...recipients.cc, ...recipients.bcc].filter(
      (recipient) => !isValidEmailAddress(recipient.address)
    )

    setForm((current) => ({ ...current, ...recipients }))
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

    const draft = contentWith(recipients)

    if (!draft) {
      return
    }

    // Kept as it goes: should sending fail, it waits in Bozze as it was.
    await saveDraft(draft)

    onSendRequested(
      {
        accountId: account.id,
        draftId: session.id,
        ...recipients,
        subject: form.subject.trim(),
        html: form.html,
        text: htmlToPlainText(form.html),
        inReplyTo: form.inReplyTo,
        references: form.references,
        attachments: attachments.flatMap((attachment) =>
          attachment.path ? [{ path: attachment.path, name: attachment.name }] : []
        )
      },
      draftToInitialData(draft)
    )
  }

  // A new message starts from who it goes to; a reply, in its body, once that is in.
  const firstOpenRef = useRef(true)

  useEffect(() => {
    if (open && firstOpenRef.current) {
      firstOpenRef.current = false

      if (!initialData.to?.length) {
        window.requestAnimationFrame(() => toInputRef.current?.focus())
      }
    }
  }, [initialData.to, open])

  return (
    <>
      <ComposerPanel
        open={open}
        draggable={!editorFocusMode}
        onMinimize={minimize}
        labelledBy={titleId}
        className={cn(
          'gap-2 p-4',
          editorFocusMode
            ? 'h-[92vh] max-h-[92vh] w-[min(1200px,calc(100vw-1.5rem))] overflow-hidden p-3'
            : // A managed height: the editor takes every pixel the envelope
              // and the footer do not.
              'h-[min(760px,calc(100vh-3rem))]'
        )}
      >
        <div
          className="contents"
          // The composer's commands, from any field — and from the editor,
          // which hands over the chords it does not use itself. Esc leaves
          // the full-screen editor first, as its toggle does.
          onKeyDown={(event) => {
            if (event.key === 'Escape' && editorFocusMode) {
              event.preventDefault()
              setEditorFocusMode(false)
              return
            }

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

          <div className={cn('flex items-start gap-2 pb-1', editorFocusMode && 'hidden')}>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="display-title truncate text-[14px] leading-6 font-bold">
                {COMPOSER_TITLES[kind]}
              </h2>
              {/* With more than one account the "Da" row says it. */}
              <p
                className={cn(
                  'text-muted-foreground text-[11px] leading-4',
                  hasAccountChoice && 'sr-only'
                )}
              >
                {account ? `Invio da ${account.email}` : "Scegli l'account da cui inviare."}
              </p>
            </div>
            <IconButton
              label="Riduci a icona"
              tooltipHint="Esc · la ritrovi in basso a destra"
              tooltipSide="bottom"
              className="relative z-20 size-7"
              onClick={minimize}
            >
              <Minus className="size-4" />
            </IconButton>
            <IconButton
              label={touched || persisted ? 'Chiudi e salva in Bozze' : 'Chiudi'}
              tooltipSide="bottom"
              className="relative z-20 size-7"
              onClick={() => void close()}
            >
              <X className="size-4" />
            </IconButton>
          </div>

          {/*
            The envelope is a stack of hairline rows, not a grid of labelled
            boxes: an inline label in a fixed gutter reads the same and costs
            32px a field, the shape Outlook and Mail have both settled on.
          */}
          <div
            className={cn(
              'border-border/70 divide-border/50 divide-y rounded-md border',
              editorFocusMode && 'hidden'
            )}
          >
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
                            <span className="text-muted-foreground">&lt;{candidate.email}&gt;</span>
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
                htmlFor={`${fieldIdPrefix}-subject`}
                className="text-muted-foreground w-14 shrink-0 text-[11px]"
              >
                Oggetto
              </label>
              <input
                ref={subjectInputRef}
                id={`${fieldIdPrefix}-subject`}
                value={form.subject}
                onChange={(event) => {
                  touch()
                  setForm((current) => ({ ...current, subject: event.target.value }))
                }}
                placeholder="Inserisci oggetto"
                disabled={!account}
                className="placeholder:text-muted-foreground/70 h-8 min-w-0 flex-1 bg-transparent text-[12.5px] font-medium outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* One editor, in place or full size: the caret and the undo history stay. */}
          <div className="min-h-0 flex-1">
            <RichTextEditor
              value={form.html}
              disabled={!account}
              defaultFontFamily={MAIL_COMPOSER_DEFAULT_FONT_FAMILY}
              expanded={editorFocusMode}
              expandToContainer
              // A reply already knows who it is going to, so the next thing
              // the user does is write — once its body is in, and once the
              // message is in front.
              autoFocusBody={open && Boolean(initialData.to?.length) && bodyReady}
              onFileDragEnter={beginFileDrag}
              onExpandedChange={setEditorFocusMode}
              onChange={(html) => {
                touch()
                setForm((current) => ({ ...current, html }))
              }}
            />
          </div>

          {attachments.length > 0 && (
            <div className={cn('flex flex-wrap gap-1.5', editorFocusMode && 'hidden')}>
              {attachments.map((attachment) => {
                const key = attachmentKey(attachment)

                return (
                  <AttachmentChip
                    key={key}
                    fileName={attachment.name}
                    sizeBytes={attachment.size}
                    busy={isPendingOriginal(attachment)}
                    failed={attachment.failed}
                    onOpen={attachment.path ? () => void openAttachment(attachment) : undefined}
                    onContextMenu={() => void showAttachmentMenu(attachment)}
                    openHint={
                      attachment.failed
                        ? 'non scaricato dal messaggio originale'
                        : isPendingOriginal(attachment)
                          ? 'scaricamento dal messaggio originale…'
                          : 'Clic per aprire'
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

          <div
            className={cn('flex items-center justify-between gap-2', editorFocusMode && 'hidden')}
          >
            <AttachMenu
              disabled={!account}
              originals={unattachedOriginals}
              onAttachOriginals={attachOriginals}
              onAttachPaths={(paths) => void attachPaths(paths)}
              onBrowse={() => void handlePickAttachments()}
            />
            <div className="flex min-w-0 items-center gap-2">
              <DraftStatusLine status={touched || persisted ? status : null} />
              <IconButton
                label={touched || persisted ? 'Elimina bozza' : 'Scarta messaggio'}
                tooltipSide="top"
                className="text-muted-foreground hover:text-destructive size-8"
                onClick={discard}
              >
                <Trash2 className="size-4" />
              </IconButton>
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
          </div>
        </div>
      </ComposerPanel>

      {confirmDialog}
    </>
  )
}
