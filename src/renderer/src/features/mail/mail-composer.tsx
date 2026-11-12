import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  Check,
  ChevronDown,
  CloudOff,
  LoaderCircle,
  Maximize2,
  Minimize2,
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
import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@renderer/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { AttachMenu } from '@renderer/features/mail/attach-menu'
import { AttachmentChip } from '@renderer/features/mail/attachment-chip'
import {
  buildComposerBody,
  firstWritingLine,
  LETTERHEAD_SELECTOR,
  hasWrittenBounds,
  hasWrittenContent,
  parseBody,
  passageToComposerHtml,
  plainTextToComposerHtml,
  quoteOf,
  replaceWrittenPartIn,
  signatureText,
  swapDecorationsIn,
  writtenText,
  type ComposerDecorations
} from '@renderer/features/mail/composer-body'
import { RecipientField, type RecipientFieldKey } from '@renderer/features/mail/recipient-field'
import { RichTextEditor, type RichTextEditorHandle } from '@renderer/features/mail/rich-text-editor'
import { commandForKeyEvent, useShortcutOverrides } from '@renderer/lib/command-shortcuts'
import { uiLog } from '@renderer/lib/diagnostics'
import { htmlToPlainText } from '@renderer/lib/email'
import { hourStyle, messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn, revealInFolderLabel } from '@renderer/lib/utils'
import {
  addressKey,
  isValidEmailAddress,
  mergeRecipients,
  parseRecipients
} from '@shared/email-address'
import { MAIL_COMPOSER_DEFAULT_FONT_FAMILY } from '@shared/mail-fonts'
import { PLACES } from '@shared/places'
import type { ComposeSpec, ComposingContext } from '@shared/segretario'
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

import { COMPOSER_TITLES, MESSAGES } from './mail-composer.messages'

export { COMPOSER_TITLES }

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
  /**
   * What the Segretario wrote, as the lines above the signature. The
   * message is a draft from the start: kept, and filed in Bozze, at once.
   */
  writtenHtml?: string
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

/** One message being written: a draft, in a tab of the reading pane (vision §6.6). */
export interface ComposerSession {
  id: string
  initialData: ComposerInitialData
  /** A draft that exists already — opened from Bozze, or left open last time. */
  existing: boolean
  status?: DraftStatus
}

/** What its tab shows of a message being written. */
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
  /** Saves the draft and closes, as the tab's × does. */
  close: () => Promise<void>
  /**
   * Sends, as Invia does — the same checks first. Resolves false when a
   * check stopped it (an address to correct, a subject to confirm).
   */
  send: () => Promise<boolean>
  /**
   * The message as the Segretario's panel sends it along with the user's
   * words: what is written, the passage selected — kept, to write over it
   * if asked. Null until the message has its body.
   */
  describe: () => ComposingContext | null
  /**
   * What the Segretario writes into it, in place (`scrivi_bozza` on this
   * draft): over the passage selected when the user asked, or the lines
   * the user writes on; recipients, subject and files when it says them.
   * A step ⌘Z takes back. Resolves with the reason when it cannot.
   */
  write: (spec: ComposeSpec) => Promise<string | null>
}

interface MailComposerProps {
  session: ComposerSession
  /** In front, in the reading pane; otherwise out of sight, as it was left. */
  active: boolean
  accounts: MailAccount[]
  /** How large the body shows, as the message being read does (`UiPreferences.readerZoom`). */
  zoom: number
  onZoomChange: (zoom: number) => void
  /** The pane takes the workspace, as reading expanded does. */
  expanded: boolean
  onToggleExpanded: () => void
  /**
   * Coming in front, it takes the keyboard; not when the Segretario brought
   * it there, while the user was writing to it.
   */
  takeFocus: boolean
  /** Its first band is the window's title bar: clear of the window's buttons on Windows. */
  atWindowTopRight: boolean
  /** Esc: back to the message being read; the message stays as it was left. */
  onLeave: () => void
  onClosed: (outcome: ComposerOutcome) => void
  onSendRequested: (payload: ComposeMailInput, draft: ComposerInitialData) => void
  onSummaryChange: (summary: ComposerSummary) => void
  /** The Segretario's panel, with this message in sight (⌘J); absent with the AI off. */
  onAskSegretario?: () => void
  ref?: React.Ref<MailComposerHandle>
}

/** "Anna Rossi <anna@cliente.it>", or the address alone: who a message goes to, as the reread reads it. */
function addressLabel(address: MailAddress): string {
  return address.name ? `${address.name} <${address.address}>` : address.address
}

/** `text` with each of `values` in it set in bold: the addresses a sentence names. */
function withStrong(text: string, values: ReadonlyArray<string>): React.ReactNode {
  const parts: React.ReactNode[] = []
  let rest = text

  for (;;) {
    const found = values
      .filter(Boolean)
      .map((value) => ({ value, at: rest.indexOf(value) }))
      .filter(({ at }) => at !== -1)
      .sort((a, b) => a.at - b.at)[0]

    if (!found) {
      parts.push(rest)
      return parts
    }

    parts.push(rest.slice(0, found.at), <strong key={parts.length}>{found.value}</strong>)
    rest = rest.slice(found.at + found.value.length)
  }
}

interface ComposerFormState {
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  inReplyTo?: string
  references?: string[]
}

/** What is typed in each recipient field and not yet a recipient. */
type RecipientDrafts = Readonly<Record<RecipientFieldKey, string>>

const EMPTY_RECIPIENT_DRAFTS: RecipientDrafts = { to: '', cc: '', bcc: '' }
const RECIPIENT_FIELDS: ReadonlyArray<RecipientFieldKey> = ['to', 'cc', 'bcc']
/** A draft is kept this long after the last change: often enough to lose nothing. */
const DRAFT_SAVE_DELAY_MS = 700
/** How long a send asked from outside waits for the composer to be ready. */
const SEND_READY_TIMEOUT_MS = 10_000
/** What the Segretario's panel is sent of the message: past these, the rest is said to be cut. */
const CHAT_TEXT_LIMIT = 100_000
const CHAT_SELECTION_LIMIT = 40_000
const CHAT_SIGNATURE_LIMIT = 4_000

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[… il resto non è riportato]` : text
}

function buildInitialState(initialData: ComposerInitialData): ComposerFormState {
  return {
    to: initialData.to ?? [],
    cc: initialData.cc ?? [],
    bcc: initialData.bcc ?? [],
    subject: initialData.subject ?? '',
    inReplyTo: initialData.inReplyTo,
    references: initialData.references
  }
}

/** A mailbox's letterhead and signature, for a body to be laid out with. */
async function decorationsOf(accountId: string): Promise<ComposerDecorations> {
  const stored = await window.mailApi.getAccountSignature(accountId)
  return { headerHtml: stored?.headerHtml || null, signatureHtml: stored?.html || null }
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
  const m = useMessages(MESSAGES)
  const { formatLocale } = useLanguage()

  if (!status) {
    return null
  }

  const savedAt = status.savedAt
    ? new Intl.DateTimeFormat(formatLocale, { hour: hourStyle(), minute: '2-digit' }).format(
        status.savedAt
      )
    : null
  const { icon, text, hint, tone } =
    status.state === 'saving'
      ? {
          icon: <LoaderCircle className="size-3 animate-spin" />,
          text: m.savingToDrafts,
          hint: null,
          tone: ''
        }
      : status.state === 'error'
        ? {
            icon: <CloudOff className="size-3" />,
            text: m.savedOnComputer,
            hint: m.notInDraftsYet(status.message ?? m.serverNotAnswering),
            tone: 'text-warning'
          }
        : {
            icon: <Check className="size-3" />,
            text: savedAt ? m.savedInDraftsAt(savedAt) : m.saved,
            hint: status.state === 'pending' ? m.pendingHint : null,
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
 * A message being written, as a draft (vision §6.6): in the reading pane,
 * in place of the message, with its tab above. It is kept as it is typed —
 * here at once, in the mailbox's Bozze a moment later (`saveDraft`) — so
 * leaving it never loses it: another message read, another app in front,
 * the app closed. The tab's × closes it, keeping the draft; the bin throws
 * it away.
 *
 * The body is the editor's (`RichTextEditor`): it is laid out once, with
 * the mailbox's letterhead and signature, and read when it is saved or
 * sent; sending from another mailbox, or the Segretario writing in it,
 * change it in place, each a step ⌘Z takes back.
 */
export function MailComposer({
  session,
  active,
  accounts,
  zoom,
  onZoomChange,
  expanded,
  onToggleExpanded,
  takeFocus,
  atWindowTopRight,
  onLeave,
  onClosed,
  onSendRequested,
  onSummaryChange,
  onAskSegretario,
  ref
}: MailComposerProps): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const titles = useMessages(COMPOSER_TITLES)
  const places = useMessages(PLACES)
  const { initialData } = session
  const kind = initialData.kind
  const [form, setForm] = useState<ComposerFormState>(() => buildInitialState(initialData))
  const [accountId, setAccountId] = useState<string | null>(initialData.accountId)
  /**
   * What the body opens with — null while a new message waits for its
   * mailbox's letterhead and signature: the editor is made once, with them.
   */
  const [initialBody, setInitialBody] = useState<string | null>(initialData.html ?? null)
  const bodyReady = initialBody !== null
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(() =>
    buildInitialAttachments(initialData)
  )
  const [recipientDrafts, setRecipientDrafts] = useState<RecipientDrafts>(EMPTY_RECIPIENT_DRAFTS)
  /**
   * Whether the user changed anything. Only then is the message a draft:
   * a composer opened and closed untouched — a reply, a new message — leaves
   * nothing behind, and a draft opened again is not filed anew unchanged.
   */
  const [touched, setTouched] = useState(initialData.writtenHtml !== undefined)
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
  const editorRef = useRef<RichTextEditorHandle | null>(null)
  const decorationsRequestRef = useRef(0)
  /**
   * The letterhead and signature the body was given, so that sending from
   * another mailbox can tell what the user wrote in from what they left
   * alone. Unknown for a draft taken up again.
   */
  const insertedDecorationsRef = useRef<ComposerDecorations | undefined>(undefined)
  /** The body as the editor first read it: a body still the same was not written in. */
  const baselineBodyRef = useRef<string | null>(null)
  /** The draft as last kept: the same again is not kept twice. */
  const lastSavedRef = useRef<string | null>(null)
  const fieldIdPrefix = useId()

  const account = accounts.find((candidate) => candidate.id === accountId) ?? null
  // The "Da" row: with more than one account, and whenever the one a
  // reopened draft names is gone, so another can be picked.
  const hasAccountChoice = accounts.length > 1 || (!account && accounts.length > 0)
  const sourceAccount = initialData.sourceAccountId
    ? (accounts.find((candidate) => candidate.id === initialData.sourceAccountId) ?? null)
    : null

  /** Every change the user makes goes through here: it is what makes the message a draft. */
  const touch = useCallback((): void => setTouched(true), [])

  // A new body is laid out with the sending mailbox's letterhead and signature, once.
  useEffect(() => {
    if (initialData.html !== undefined) {
      return
    }

    const requestId = ++decorationsRequestRef.current
    const layOut = (decorations: ComposerDecorations): void => {
      if (requestId !== decorationsRequestRef.current) {
        return
      }

      insertedDecorationsRef.current = decorations
      setInitialBody(buildComposerBody(decorations, initialData.quoteHtml, initialData.writtenHtml))
    }

    decorationsOf(initialData.accountId)
      .then(layOut)
      .catch((error: unknown) => {
        toast.error(messagesNow(MESSAGES).signatureUnavailable, {
          description: error instanceof Error ? error.message : undefined
        })
        layOut({ headerHtml: null, signatureHtml: null })
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
        toast.error(messagesNow(MESSAGES).originalAttachmentsUnavailable, {
          description: error instanceof Error ? error.message : undefined
        })
      })

    return () => {
      current = false
    }
  }, [initialData, pendingOriginalIds])

  /** The body as it is now: the editor's, or the one it is about to open with. */
  const currentBody = useCallback(
    (): string => editorRef.current?.getHTML() ?? initialBody ?? '',
    [initialBody]
  )

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
            html: currentBody(),
            inReplyTo: form.inReplyTo,
            references: form.references,
            original: initialData.original,
            attachments
          }
        : null,
    [account, attachments, currentBody, form, initialData, kind, session.id]
  )

  const saveDraft = useCallback(async (draft: DraftContent): Promise<void> => {
    lastSavedRef.current = JSON.stringify(draft)

    try {
      setStatus(await window.mailApi.saveDraft(draft))
      setPersisted(true)
    } catch (error) {
      lastSavedRef.current = null
      toast.error(messagesNow(MESSAGES).draftNotSaved, {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }, [])

  /** Whether the body is still the one it opened with: nobody wrote in it. */
  const bodyUntouched = useCallback(
    (): boolean => baselineBodyRef.current === null || currentBody() === baselineBodyRef.current,
    [currentBody]
  )

  // The latest of everything, for the timer that keeps the draft: it runs after the render that set it.
  const latestRef = useRef({ contentWith, touched, bodyUntouched, saveDraft })

  useLayoutEffect(() => {
    latestRef.current = { contentWith, touched, bodyUntouched, saveDraft }
  })

  const saveTimerRef = useRef<number | null>(null)

  /** Kept a moment after the last change — a keystroke, a recipient, a file — as it stands then. */
  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      const { contentWith, touched, bodyUntouched, saveDraft } = latestRef.current

      if (!touched && bodyUntouched()) {
        return
      }

      if (!touched) {
        setTouched(true)
      }

      const draft = contentWith()

      if (draft && JSON.stringify(draft) !== lastSavedRef.current) {
        void saveDraft(draft)
      }
    }, DRAFT_SAVE_DELAY_MS)
  }, [])

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    },
    []
  )

  // What the user changes besides the body is kept the same way.
  useEffect(() => {
    if (touched && bodyReady) {
      scheduleSave()
    }
  }, [accountId, attachments, bodyReady, form, scheduleSave, touched])

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

  // Out of sight — another message read, another app — what changed goes to Bozze now; back in
  // front, the keyboard is where it was left: the text, the subject, a recipient.
  const wasActiveRef = useRef(active)
  const lastFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (wasActiveRef.current && !active && persisted) {
      void window.mailApi.flushDraft(session.id).then(setStatus, () => undefined)
    }

    if (!wasActiveRef.current && active && focusedRef.current && takeFocus) {
      const last = lastFocusRef.current
      const frame = window.requestAnimationFrame(() => {
        if (last && last.isConnected && last.tagName !== 'IFRAME') {
          last.focus({ preventScroll: true })
        } else {
          editorRef.current?.focus()
        }
      })
      wasActiveRef.current = active
      return () => window.cancelAnimationFrame(frame)
    }

    wasActiveRef.current = active
    return undefined
  }, [active, persisted, session.id, takeFocus])

  /** Closes, keeping the draft in Bozze — unless nothing was ever written. */
  const close = async (): Promise<void> => {
    const changed = touched || !bodyUntouched()

    if (!changed && !persisted) {
      onClosed({ kind: 'untouched' })
      return
    }

    const draft = contentWith(committedRecipients())

    // The mailbox it was written from was removed meanwhile: it is kept only from another one.
    if (!draft) {
      const discarded = await confirm({
        title: m.discardTitle,
        description: accounts.length > 0 ? m.mailboxGoneChoose : m.mailboxGoneNoOther,
        confirmLabel: m.discard,
        destructive: true
      })

      if (discarded) {
        onClosed({ kind: 'discarded', content: null })
      }

      return
    }

    if (changed) {
      await saveDraft(draft)
    }

    void window.mailApi.closeDraft(session.id).catch(() => undefined)
    onClosed({ kind: 'saved', content: draft })
  }

  const discard = (): void => {
    onClosed({
      kind: 'discarded',
      content: touched || persisted || !bodyUntouched() ? contentWith(committedRecipients()) : null
    })
  }

  /**
   * Sends from another mailbox, with its letterhead and signature in place
   * of the current ones. For a reply or forward, leaving the mailbox the
   * message arrived on is confirmed first.
   */
  const changeAccount = async (nextAccountId: string): Promise<void> => {
    const nextAccount = accounts.find((candidate) => candidate.id === nextAccountId)

    if (!nextAccount || nextAccount.id === accountId) {
      return
    }

    if (sourceAccount && nextAccount.id !== sourceAccount.id) {
      const isReply = kind === 'reply'
      const confirmed = await confirm({
        title: isReply ? m.replyFromOtherTitle : m.forwardFromOtherTitle,
        description: withStrong(
          (isReply ? m.replyFromOtherText : m.forwardFromOtherText)(
            sourceAccount.email,
            nextAccount.email
          ),
          [sourceAccount.email, nextAccount.email]
        ),
        confirmLabel: m.changeMailbox
      })

      if (!confirmed) {
        return
      }
    }

    touch()
    setAccountId(nextAccount.id)
    const requestId = ++decorationsRequestRef.current

    try {
      const next = await decorationsOf(nextAccount.id)
      const editor = editorRef.current

      if (requestId !== decorationsRequestRef.current || !editor) {
        return
      }

      const html = editor.getHTML()

      if (hasWrittenContent(html)) {
        const previous = insertedDecorationsRef.current
        editor.modify((root) => swapDecorationsIn(root, next, previous))
      } else {
        // Nothing written yet: laid out again, its lines in the new mailbox's style.
        editor.setHTML(buildComposerBody(next, quoteOf(html)))
        editor.focus((root) => firstWritingLine(root))
      }

      insertedDecorationsRef.current = next
    } catch (error) {
      toast.error(m.signatureOfUnavailable(nextAccount.email), {
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
    account && bodyReady && hasRecipients && attachments.every((attachment) => attachment.path)
  )

  // Certified mail (PEC) takes no Bcc: the provider refuses the whole message.
  const certified = account?.pec === true
  const bccShown = !certified || form.bcc.length > 0 || Boolean(recipientDrafts.bcc)

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
      {certified ? m.cc : m.ccBcc}
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
        toast(m.cannotOpenHere(name), {
          description: m.cannotOpenHereText,
          action: reveal
        })
      } else if (result.status === 'no-application') {
        toast(m.noApplication(name), {
          description: m.noApplicationText,
          action: reveal
        })
      }
    } catch (error) {
      toast.error(m.cannotOpen(name), {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  const showAttachmentMenu = async (attachment: ComposerAttachment): Promise<void> => {
    const key = attachmentKey(attachment)
    const { path } = attachment
    const chosen = await window.mailApi.showContextMenu([
      { id: 'open', label: m.open, enabled: Boolean(path) },
      { id: 'reveal', label: revealInFolderLabel(), enabled: Boolean(path) },
      ...(attachment.failed ? [{ id: 'retry', label: m.retryDownload }] : []),
      { type: 'separator' },
      { id: 'remove', label: m.remove }
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
      toast.error(m.cannotAttachFiles, {
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
      toast.error(m.cannotAttachFile, {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  // A file dragged over the composer turns the whole pane into a drop
  // target. The editor lives in an iframe the pane cannot hear, so it
  // reports a file drag entering it and the overlay takes over from there.
  const [fileDragActive, setFileDragActive] = useState(false)
  const beginFileDrag = (): void => {
    if (account) {
      setFileDragActive(true)
    }
  }

  const [reviewing, setReviewing] = useState(false)
  // What the Segretario found rereading the message as it went: the send waits on the user.
  const [reviewIssues, setReviewIssues] = useState<string[] | null>(null)
  // The reread under way, by name: the user may send without waiting.
  const reviewRequestRef = useRef<string | null>(null)
  // The passage selected when the user last wrote to the Segretario: what "this" was.
  const askedSelectionRef = useRef<ReturnType<RichTextEditorHandle['captureSelection']>>(null)

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
          setCcBccRequested(true)
          window.requestAnimationFrame(() => ccInputRef.current?.focus())
        }
        return
    }
  }

  /**
   * The Segretario rereads the message as it goes, when the user wants it:
   * what it finds holds the send until the user decides. It never holds a
   * message by itself: the user may send at once while it rereads ("Invia
   * subito"), and with OpenRouter not answering it does not start.
   */
  const reviewBeforeSending = async (
    recipients: Pick<ComposerFormState, 'to' | 'cc'>,
    html: string
  ): Promise<string[]> => {
    if (!account || !onAskSegretario) {
      return []
    }

    setReviewing(true)

    try {
      // Rereading is one of the AI functions: with them off, the message goes as it is; and so
      // it does while OpenRouter is not answering.
      if (
        !(await window.segretarioApi.getPreferences()).enabled ||
        (await window.segretarioApi.getEngineState()).waiting
      ) {
        return []
      }

      const requestId = crypto.randomUUID()
      reviewRequestRef.current = requestId
      return await window.segretarioApi.reviewDraft({
        requestId,
        accountId: account.id,
        to: recipients.to.map(addressLabel),
        cc: recipients.cc.map(addressLabel),
        subject: form.subject.trim(),
        writtenText: writtenText(html),
        attachments: attachments.map((attachment) => attachment.name),
        replyTo: initialData.original?.ref ?? null
      })
    } catch {
      return []
    } finally {
      reviewRequestRef.current = null
      setReviewing(false)
    }
  }

  const handleSend = async (options: { reviewed?: boolean } = {}): Promise<boolean> => {
    if (!account || !canSend) {
      return false
    }

    // Sent again while it rereads: the reread stops, and the send under way goes on at once.
    if (reviewing) {
      const requestId = reviewRequestRef.current

      if (requestId) {
        void window.segretarioApi.stopAsking(requestId)
      }

      return false
    }

    setReviewIssues(null)

    // What is still typed goes too, as it would on leaving its field.
    const recipients = committedRecipients()
    const invalid = [...recipients.to, ...recipients.cc, ...recipients.bcc].filter(
      (recipient) => !isValidEmailAddress(recipient.address)
    )

    setForm((current) => ({ ...current, ...recipients }))
    setRecipientDrafts(EMPTY_RECIPIENT_DRAFTS)

    if (certified && recipients.bcc.length > 0) {
      toast.error(m.pecNoBcc, { description: m.pecNoBccText })
      return false
    }

    if (invalid.length > 0) {
      toast.error(
        invalid.length === 1
          ? m.invalidAddress(invalid[0].address)
          : m.invalidAddresses(invalid.length),
        { description: m.invalidAddressesText }
      )
      return false
    }

    if (
      !form.subject.trim() &&
      !(await confirm({
        title: m.noSubjectTitle,
        description: m.noSubjectText,
        confirmLabel: m.sendWithoutSubject,
        cancelLabel: m.writeSubject
      }))
    ) {
      window.requestAnimationFrame(() => subjectInputRef.current?.focus())
      return false
    }

    const html = currentBody()

    if (!options.reviewed) {
      const issues = await reviewBeforeSending(recipients, html)

      if (issues.length > 0) {
        setReviewIssues(issues)
        return false
      }
    }

    const draft = contentWith(recipients)

    if (!draft) {
      return false
    }

    // Kept as it goes: should sending fail, it waits in Bozze as it was.
    await saveDraft(draft)

    onSendRequested(
      {
        accountId: account.id,
        draftId: session.id,
        ...recipients,
        subject: form.subject.trim(),
        html: draft.html,
        text: htmlToPlainText(draft.html),
        inReplyTo: form.inReplyTo,
        references: form.references,
        attachments: attachments.flatMap((attachment) =>
          attachment.path ? [{ path: attachment.path, name: attachment.name }] : []
        )
      },
      draftToInitialData(draft)
    )
    return true
  }

  /** What the Segretario writes, in place: see `MailComposerHandle.write`. */
  const writeFromSegretario = async (spec: ComposeSpec): Promise<string | null> => {
    // A draft just taken up opens its editor a moment later.
    for (let waited = 0; !editorRef.current && waited < SEND_READY_TIMEOUT_MS; waited += 50) {
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }

    const editor = editorRef.current

    if (!editor) {
      return 'Il messaggio non si è aperto: riprova tra un attimo.'
    }

    if (spec.selection) {
      const selection = askedSelectionRef.current

      if (!selection) {
        return 'Nel messaggio non c’era un passaggio selezionato: scrivi il testo intero.'
      }

      if (!selection.replace(passageToComposerHtml(spec.text, selection.block))) {
        return 'Il passaggio selezionato è cambiato mentre scrivevi: l’utente ci ha lavorato. Chiedigli se riscriverlo ancora, e quale.'
      }

      askedSelectionRef.current = null
    } else {
      // A draft from another client may not say where what the user writes ends: written over
      // whole, its quoted message could go. There, only the passage selected is rewritten.
      if (
        insertedDecorationsRef.current === undefined &&
        !hasWrittenBounds(parseBody(editor.getHTML()))
      ) {
        return 'In questa bozza non si vede dove finisce il testo dell’utente: chiedigli di selezionare ciò che va riscritto, e riscrivi solo quello (`selezione`).'
      }

      editor.modify((root) => replaceWrittenPartIn(root, plainTextToComposerHtml(spec.text)))
    }

    touch()
    const addresses = (list: string[] | undefined): MailAddress[] | undefined =>
      list && list.length > 0 ? parseRecipients(list.join(', ')) : undefined
    const [to, cc, bcc] = [addresses(spec.to), addresses(spec.cc), addresses(spec.bcc)]

    if (to || cc || bcc || spec.subject !== undefined) {
      setForm((current) => ({
        ...current,
        to: to ?? current.to,
        cc: cc ?? current.cc,
        bcc: bcc ?? current.bcc,
        subject: spec.subject ?? current.subject
      }))
    }

    // The files it names join the message — in the draft kept now too, which the Segretario reads.
    let added: PickedAttachment[] = []

    if (spec.attachments && spec.attachments.length > 0) {
      try {
        added = await window.mailApi.describeFiles(spec.attachments.map((file) => file.path))
        addAttachments(added)
      } catch {
        return 'I file da allegare non si leggono più dove erano.'
      }
    }

    // In the Bozze at once: the Segretario hears of the draft as it is now.
    const draft = latestRef.current.contentWith()

    if (draft) {
      const known = new Set(draft.attachments.map((attachment) => attachment.path))
      await saveDraft({
        ...draft,
        to: to ?? draft.to,
        cc: cc ?? draft.cc,
        bcc: bcc ?? draft.bcc,
        subject: spec.subject ?? draft.subject,
        attachments: [
          ...draft.attachments,
          ...added.filter((attachment) => !known.has(attachment.path))
        ]
      })
    }

    return null
  }

  // A send asked from outside (the Segretario's, confirmed by the user)
  // waits for the body to be laid out and every file copied, then sends
  // what the composer holds by then — not what it held when asked.
  const latestSendRef = useRef({ canSend, send: () => handleSend({ reviewed: true }) })

  useLayoutEffect(() => {
    // The user read it on the Segretario's card before saying send.
    latestSendRef.current = { canSend, send: () => handleSend({ reviewed: true }) }
  })

  useImperativeHandle(ref, () => ({
    close,
    send: async () => {
      for (
        let waited = 0;
        !latestSendRef.current.canSend && waited < SEND_READY_TIMEOUT_MS;
        waited += 100
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 100))
      }

      return latestSendRef.current.send()
    },
    describe: () => {
      const editor = editorRef.current

      if (!account || !editor) {
        return null
      }

      const selection = editor.captureSelection()
      const html = editor.getHTML()
      askedSelectionRef.current = selection

      return {
        draftId: session.id,
        accountId: account.id,
        kind,
        to: form.to.map(addressLabel),
        cc: form.cc.map(addressLabel),
        subject: form.subject,
        // Clipped, as the panel sends it: a long quoted thread selected never stops the request.
        writtenText: clip(writtenText(html), CHAT_TEXT_LIMIT),
        signatureText: clip(signatureText(html), CHAT_SIGNATURE_LIMIT),
        selectedText: selection ? clip(selection.text, CHAT_SELECTION_LIMIT) : null,
        replyTo: initialData.original?.ref ?? null
      }
    },
    write: writeFromSegretario
  }))

  // A new message starts from who it goes to; a reply, in its body, on the first line it writes
  // on — once the body is in, and once the message is in front.
  const focusedRef = useRef(false)

  const focusOnArrival = useCallback(
    (editor: RichTextEditorHandle): void => {
      if (focusedRef.current || !active || !takeFocus) {
        return
      }

      focusedRef.current = true

      if (initialData.to?.length) {
        editor.focus((root) => firstWritingLine(root))
      } else {
        window.requestAnimationFrame(() => toInputRef.current?.focus())
      }
    },
    [active, initialData.to, takeFocus]
  )

  useEffect(() => {
    if (active && editorRef.current) {
      focusOnArrival(editorRef.current)
    }
  }, [active, focusOnArrival])

  return (
    <div
      role="region"
      aria-label={titles[kind]}
      className="page relative flex h-full min-h-0 flex-col"
      onFocus={(event) => {
        lastFocusRef.current = event.target
      }}
      // The composer's commands, from any field — and from the editor, which
      // hands over the chords it does not use itself. Esc goes back to the
      // message being read, leaving this one as it is.
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault()
          event.stopPropagation()
          onLeave()
          return
        }

        const command = commandForKeyEvent(event.nativeEvent, 'composer', shortcutOverrides)

        if (!command || event.repeat) {
          return
        }

        event.preventDefault()
        runComposerCommand(command.id)
        uiLog.info('command', { id: command.id, via: 'keyboard' })
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
          <p className="pointer-events-none text-[13px] font-medium">{m.dropToAttach}</p>
        </div>
      )}

      {/*
        The first band, as the reading pane's: what can be done with the
        message — send it, attach, ask the Segretario — then where its draft
        stands, the bin, and the room the pane takes.
      */}
      <div
        className={cn(
          'window-drag-region @container/composer-header flex h-[52px] shrink-0 items-center gap-1 border-b pl-3',
          atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-2'
        )}
      >
        <div className="window-no-drag flex min-w-0 items-center gap-1">
          <Popover
            open={reviewIssues !== null}
            onOpenChange={(nextOpen) => !nextOpen && setReviewIssues(null)}
          >
            <PopoverAnchor asChild>
              <span className="inline-flex">
                <ActionTooltip
                  label={reviewing ? m.rereadingSendNow : m.sendMessage}
                  commandId="send"
                  side="bottom"
                >
                  <Button
                    size="sm"
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                    className="gap-1.5"
                  >
                    {reviewing ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    {reviewing ? m.sendNow : m.send}
                  </Button>
                </ActionTooltip>
              </span>
            </PopoverAnchor>
            <PopoverContent
              side="bottom"
              align="start"
              className="flex w-[340px] flex-col gap-2.5 p-3"
            >
              <p className="text-ai flex items-center gap-1.5 text-[11.5px] font-semibold">
                <CompassStar className="text-ai-star size-3.5" />
                {m.beforeSending}
              </p>
              <ul className="flex flex-col gap-1.5">
                {reviewIssues?.map((issue) => (
                  <li key={issue} className="voice text-foreground text-[14px] leading-[1.45]">
                    {issue}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setReviewIssues(null)}>
                  {m.correct}
                </Button>
                <Button size="sm" onClick={() => void handleSend({ reviewed: true })}>
                  <Send className="size-3.5" />
                  {m.sendAnyway}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <AttachMenu
            disabled={!account}
            originals={unattachedOriginals}
            onAttachOriginals={attachOriginals}
            onAttachPaths={(paths) => void attachPaths(paths)}
            onBrowse={() => void handlePickAttachments()}
          />
          {onAskSegretario && (
            <ActionTooltip label={m.askSegretario} commandId="segretario">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={!account || !bodyReady}
                onClick={onAskSegretario}
              >
                <CompassStar className="text-ai-star size-3.5" />
                <span className="@max-[620px]/composer-header:hidden">{places.segretario}</span>
              </Button>
            </ActionTooltip>
          )}
        </div>
        <div className="min-w-2 flex-1" />
        <div className="window-no-drag flex min-w-0 items-center gap-0.5">
          <span className="min-w-0 @max-[520px]/composer-header:hidden">
            <DraftStatusLine status={touched || persisted ? status : null} />
          </span>
          <IconButton
            label={touched || persisted ? m.deleteDraft : m.discardMessage}
            tooltipSide="bottom"
            className="text-muted-foreground hover:text-destructive ml-1 size-[28px]"
            onClick={discard}
          >
            <Trash2 className="size-[15px]" />
          </IconButton>
          <div className="bg-border mx-1 h-4 w-px" />
          <IconButton
            label={expanded ? m.shrink : m.expand}
            tooltipSide="bottom"
            className="text-faint-foreground hover:text-foreground size-[28px]"
            onClick={onToggleExpanded}
          >
            {expanded ? (
              <Minimize2 className="size-[14px]" />
            ) : (
              <Maximize2 className="size-[14px]" />
            )}
          </IconButton>
          <IconButton
            label={touched || persisted ? m.closeKeepInDrafts : m.close}
            tooltipSide="bottom"
            className="text-faint-foreground hover:text-foreground size-[28px]"
            onClick={() => void close()}
          >
            <X className="size-[15px]" />
          </IconButton>
        </div>
      </div>

      {/*
        The envelope is a stack of hairline rows, not a grid of labelled
        boxes: an inline label in a fixed gutter reads the same and costs
        32px a field, the shape Outlook and Mail have both settled on.
      */}
      <div className="divide-border/60 shrink-0 divide-y border-b px-3">
        {hasAccountChoice && (
          <div className="flex items-center gap-2 px-2">
            <span className="text-muted-foreground w-14 shrink-0 text-[11px]">{m.from}</span>
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
                    <span className="text-muted-foreground">{m.chooseMailbox}</span>
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
                          {m.receivedTheMessage}
                        </span>
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {renderRecipientField('to', m.toPlaceholder, ccBccToggle)}
        {ccBccVisible && renderRecipientField('cc', m.ccPlaceholder)}
        {ccBccVisible && bccShown && renderRecipientField('bcc', m.bccPlaceholder)}

        <div className="flex items-center gap-2 px-2">
          <label
            htmlFor={`${fieldIdPrefix}-subject`}
            className="text-muted-foreground w-14 shrink-0 text-[11px]"
          >
            {m.subject}
          </label>
          <input
            ref={subjectInputRef}
            id={`${fieldIdPrefix}-subject`}
            value={form.subject}
            onChange={(event) => {
              touch()
              setForm((current) => ({ ...current, subject: event.target.value }))
            }}
            placeholder={m.subjectPlaceholder}
            disabled={!account}
            className="placeholder:text-muted-foreground/70 h-8 min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none disabled:opacity-50"
          />
        </div>

        {/* The files go with the envelope, in sight from the top, as Outlook has them. */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 py-2">
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
                      ? m.notDownloaded
                      : isPendingOriginal(attachment)
                        ? m.downloading
                        : m.clickToOpen
                  }
                  trailing={
                    <>
                      {attachment.failed && (
                        <IconButton
                          label={m.retryDownloadOf(attachment.name)}
                          tooltipSide="top"
                          className="size-5"
                          onClick={() => retryAttachment(key)}
                        >
                          <RotateCw className="size-3" />
                        </IconButton>
                      )}
                      <IconButton
                        label={m.removeNamed(attachment.name)}
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
      </div>

      <div className="min-h-0 flex-1">
        {initialBody === null ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle className="text-faint-foreground size-5 animate-spin" />
          </div>
        ) : (
          <RichTextEditor
            handleRef={editorRef}
            initialHtml={initialBody}
            variant="pane"
            disabled={!account}
            defaultFontFamily={MAIL_COMPOSER_DEFAULT_FONT_FAMILY}
            expandToContainer
            zoom={zoom}
            onZoomChange={onZoomChange}
            onFileDragEnter={beginFileDrag}
            headSelector={LETTERHEAD_SELECTOR}
            onInput={scheduleSave}
            onReady={(editor) => {
              baselineBodyRef.current = editor.getHTML()
              // The caret waits on the first line to write on, the toolbar showing its style.
              editor.select((root) => firstWritingLine(root))
              focusOnArrival(editor)
            }}
          />
        )}
      </div>

      {confirmDialog}
    </div>
  )
}
