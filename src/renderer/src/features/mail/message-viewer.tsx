import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReactNode } from 'react'
import {
  ChevronDown,
  Download,
  Forward,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Paperclip,
  PenLine,
  Reply,
  ReplyAll,
  X
} from 'lucide-react'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { AddressTokens, summarizeAddresses, type AddressActions } from './address-tokens'
import { AttachmentChip } from './attachment-chip'
import { SelectionActions, type SelectionActionsProps } from './selection-actions'
import type { AttachmentActions } from './use-attachment-actions'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { Separator } from '@renderer/components/ui/separator'
import { messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { buildMessageFrameDocument } from '@renderer/lib/mail-html'
import { READER_ZOOM_RESET, wheelReaderZoom } from '@renderer/lib/reader-zoom'
import {
  cn,
  formatAddress,
  formatCount,
  formatDateLabel,
  formatDateTimeLabel
} from '@renderer/lib/utils'
import { defineMessages, type Messages } from '@shared/i18n'
import {
  MAX_MESSAGES_PER_ACTION,
  type MailAttachment,
  type MailMessageDetail
} from '@shared/models'

const MESSAGES = defineMessages({
  notAvailable: { en: 'N/A', it: 'N/D', de: 'k. A.' },
  ccPeople: {
    en: (count: number) => `Cc ${count} people`,
    it: (count: number) => `Cc ${count} persone`,
    de: (count: number) => `Cc ${count} Personen`
  },
  toWhom: {
    en: (who: string) => `To ${who}`,
    it: (who: string) => `A ${who}`,
    de: (who: string) => `An ${who}`
  },
  noRecipient: { en: 'No recipient', it: 'Nessun destinatario', de: 'Kein Empfänger' },
  undisclosedRecipients: {
    en: 'Undisclosed recipients',
    it: 'Destinatari non divulgati',
    de: 'Nicht offengelegte Empfänger'
  },
  open: { en: 'Open', it: 'Apri', de: 'Öffnen' },
  saveAs: { en: 'Save as…', it: 'Salva con nome…', de: 'Speichern unter…' },
  saveAllAttachments: {
    en: (count: number) => `Save all attachments (${count})`,
    it: (count: number) => `Salva tutti gli allegati (${count})`,
    de: (count: number) => `Alle Anhänge speichern (${count})`
  },
  clearSelection: { en: 'Clear selection', it: 'Annulla selezione', de: 'Auswahl aufheben' },
  selected: {
    en: (count: string) => `${count} selected`,
    it: (count: string) => `${count} selezionati`,
    de: (count: string) => `${count} ausgewählt`
  },
  messagesSelected: {
    en: (count: string) => `${count} messages selected`,
    it: (count: string) => `${count} messaggi selezionati`,
    de: (count: string) => `${count} Nachrichten ausgewählt`
  },
  selectionText: {
    en: 'The commands above archive, move, flag or delete the whole selection in one go.',
    it: 'I comandi qui sopra archiviano, spostano, contrassegnano o eliminano tutta la selezione in un colpo solo.',
    de: 'Die Befehle oben archivieren, verschieben, markieren oder löschen die ganze Auswahl auf einmal.'
  },
  loadedSelected: {
    en: (total: string) => `The messages loaded are selected: there are ${total} here.`,
    it: (total: string) => `Sono selezionati i messaggi caricati: qui ce ne sono ${total}.`,
    de: (total: string) => `Ausgewählt sind die geladenen Nachrichten: Hier sind es ${total}.`
  },
  selectFirst: {
    en: (count: string) => `Select the first ${count}`,
    it: (count: string) => `Seleziona i primi ${count}`,
    de: (count: string) => `Die ersten ${count} auswählen`
  },
  selectAll: {
    en: (count: string) => `Select all ${count}`,
    it: (count: string) => `Seleziona tutti i ${count}`,
    de: (count: string) => `Alle ${count} auswählen`
  },
  noMessageSelected: {
    en: 'No message selected',
    it: 'Nessun messaggio selezionato',
    de: 'Keine Nachricht ausgewählt'
  },
  chooseMessage: {
    en: 'Choose a message from the list to read it.',
    it: "Scegli un messaggio dall'elenco per leggerlo.",
    de: 'Wählen Sie eine Nachricht aus der Liste, um sie zu lesen.'
  },
  resumeDraft: {
    en: 'Pick up the draft in the editor',
    it: 'Riprendi la bozza nell’editor',
    de: 'Den Entwurf im Editor fortsetzen'
  },
  continueWriting: { en: 'Continue writing', it: 'Continua a scrivere', de: 'Weiterschreiben' },
  replyToSender: {
    en: 'Reply to the sender',
    it: 'Rispondi al mittente',
    de: 'Dem Absender antworten'
  },
  reply: { en: 'Reply', it: 'Rispondi', de: 'Antworten' },
  replyToAll: {
    en: 'Reply to all recipients',
    it: 'Rispondi a tutti i destinatari',
    de: 'Allen Empfängern antworten'
  },
  replyAll: { en: 'Reply all', it: 'Rispondi a tutti', de: 'Allen antworten' },
  forwardWithAttachments: {
    en: 'Forward with the attachments',
    it: 'Inoltra con gli allegati',
    de: 'Mit den Anhängen weiterleiten'
  },
  forward: { en: 'Forward', it: 'Inoltra', de: 'Weiterleiten' },
  collapseView: {
    en: 'Collapse message view',
    it: 'Comprimi vista messaggio',
    de: 'Nachrichtenansicht verkleinern'
  },
  expandView: {
    en: 'Expand message view',
    it: 'Espandi vista messaggio',
    de: 'Nachrichtenansicht vergrößern'
  },
  noSubject: { en: 'No subject', it: 'Senza oggetto', de: 'Kein Betreff' },
  zoomLabel: {
    en: (zoom: number) => `Message zoom ${zoom}%: back to 100%`,
    it: (zoom: number) => `Zoom del messaggio ${zoom}%: torna al 100%`,
    de: (zoom: number) => `Nachrichtenzoom ${zoom}%: zurück auf 100%`
  },
  zoomTip: {
    en: 'Message zoom · click to go back to 100%',
    it: 'Zoom del messaggio · clic per tornare al 100%',
    de: 'Nachrichtenzoom · klicken, um auf 100% zurückzugehen'
  },
  zoomKeys: {
    en: '⌘/Ctrl + scroll wheel, or ⌘/Ctrl + and −',
    it: '⌘/Ctrl + rotellina, oppure ⌘/Ctrl + e −',
    de: '⌘/Ctrl + Mausrad oder ⌘/Ctrl + und −'
  },
  details: { en: 'Details', it: 'Dettagli', de: 'Details' },
  from: { en: 'From', it: 'Da', de: 'Von' },
  to: { en: 'To', it: 'A', de: 'An' },
  cc: { en: 'Cc', it: 'Cc', de: 'Cc' },
  bcc: { en: 'Bcc', it: 'Ccn', de: 'Bcc' },
  date: { en: 'Date', it: 'Data', de: 'Datum' },
  downloading: {
    en: 'Downloading the message…',
    it: 'Scaricamento del messaggio…',
    de: 'Nachricht wird heruntergeladen…'
  },
  downloadFailed: {
    en: 'The message could not be downloaded.',
    it: 'Non è stato possibile scaricare il messaggio.',
    de: 'Die Nachricht konnte nicht heruntergeladen werden.'
  },
  tryAgain: { en: 'Try again', it: 'Riprova', de: 'Erneut versuchen' },
  frameTitle: {
    en: (subject: string) => `Email content: ${subject}`,
    it: (subject: string) => `Contenuto email: ${subject}`,
    de: (subject: string) => `E-Mail-Inhalt: ${subject}`
  },
  untitledMessage: {
    en: 'Message with no subject',
    it: 'Messaggio senza oggetto',
    de: 'Nachricht ohne Betreff'
  },
  noContent: { en: '(No content)', it: '(Nessun contenuto)', de: '(Kein Inhalt)' },
  attachmentOne: { en: 'attachment', it: 'allegato', de: 'Anhang' },
  attachmentOther: { en: 'attachments', it: 'allegati', de: 'Anhänge' },
  saveAll: { en: 'Save all', it: 'Salva tutti', de: 'Alle speichern' },
  clickToOpen: { en: 'Click to open', it: 'Clic per aprire', de: 'Zum Öffnen klicken' }
})

interface MessageViewerProps {
  message: MailMessageDetail | null
  /** The Segretario's word on the conversation, above the message: "Where it stands". */
  brief?: ReactNode
  /**
   * Where the body is. While it downloads, the pane already shows what the
   * list knows — sender, subject, date — and the actions, which wait for it.
   */
  bodyStatus: 'ready' | 'loading' | 'failed'
  onRetryBody: () => void
  isExpanded: boolean
  /**
   * How many messages are selected. Above one the pane is the selection's:
   * a summary instead of a body, and the actions in words — reading one
   * message while acting on twelve is a mismatch every mail client avoids.
   */
  selectedCount: number
  onClearSelection: () => void
  /**
   * When every row loaded is selected but the view holds more: how many it
   * holds, and the way to select those too, as Gmail offers it.
   */
  wholeViewSelection?: {
    total: number
    selecting: boolean
    onSelect: () => void
  }
  /** What the selection can be given to: archive, move, mark, flag, delete. */
  selectionActions: SelectionActionsProps
  /** The extension's buttons for the selection. */
  extensionActions: ReactNode
  /**
   * The pane is in the window's top right corner: on Windows its header
   * keeps clear of the window's buttons.
   */
  atWindowTopRight: boolean
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  /** The message is a draft: it is written on, in place of being answered. */
  onContinueDraft?: () => void
  onToggleExpanded: () => void
  attachmentActions: AttachmentActions | null
  /** What a click on a person in the header can do. */
  addressActions?: AddressActions
  /** Message body zoom, in percent (see `UiPreferences.readerZoom`). */
  zoom: number
  onZoomChange: (zoom: number) => void
  /** Whether "Details" is open: one choice for every message. */
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
}

const ALL_ATTACHMENTS_TASK_ID = '__all__'
const EXTERNAL_SCHEME_PATTERN = /^(https?|mailto|tel|sms):/i
const MESSAGE_FRAME_SANDBOX = 'allow-same-origin'
const MESSAGE_FRAME_MIN_HEIGHT = 320

/**
 * Chords the email body keeps for itself when it has focus: selecting and
 * copying text out of a message is exactly what that focus is for.
 */
const FRAME_NATIVE_CHORD_CODES: ReadonlySet<string> = new Set(['KeyA', 'KeyC', 'KeyX'])

interface MessageContentFrameElement extends HTMLIFrameElement {
  __messageFrameCleanup?: () => void
}

function addressesToLabel(
  m: Messages<typeof MESSAGES>,
  addresses: { name?: string; address: string }[]
): string {
  if (addresses.length === 0) {
    return m.notAvailable
  }

  return addresses.map(formatAddress).join(', ')
}

/**
 * Who the message went to, in one short phrase. A message that names nobody
 * in To or Cc reached this mailbox as a blind copy or through a list, which
 * is worth saying rather than printing an empty "To" — unless it is a draft,
 * which has nobody to go to yet.
 */
function recipientsSummary(
  m: Messages<typeof MESSAGES>,
  message: MailMessageDetail,
  isDraft: boolean
): string {
  const copies =
    message.cc.length === 1
      ? `${m.cc} ${summarizeAddresses(message.cc)}`
      : message.cc.length > 1
        ? m.ccPeople(message.cc.length)
        : null

  if (message.to.length > 0) {
    const direct = m.toWhom(summarizeAddresses(message.to))
    return copies ? `${direct} · ${copies}` : direct
  }

  if (message.cc.length > 0) {
    return `${m.cc} ${summarizeAddresses(message.cc)}`
  }

  return isDraft ? m.noRecipient : m.undisclosedRecipients
}

function DetailsLabel({
  children,
  count
}: {
  children: React.ReactNode
  count: number
}): React.JSX.Element {
  return (
    <span className="whitespace-nowrap">
      {children}
      {count > 1 && <span className="ml-0.5 opacity-60">{count}</span>}
    </span>
  )
}

function resolveClickableUrl(element: Element): string | null {
  // `closest` is realm-safe (unlike `instanceof`), and the selector restricts
  // matches to anchors/areas that actually carry an href. Anything else returns
  // null and the click falls through to iframe default handling (no-op for us).
  const clickableTarget = element.closest('a[href], area[href]')
  return clickableTarget?.getAttribute('href') ?? null
}

function isExternalHrefValue(href: string): boolean {
  return EXTERNAL_SCHEME_PATTERN.test(href.trim())
}

/** CSS `zoom` for a percentage. It reflows the page — text wraps anew at the
 * pane's width — where a transform would only magnify it off the side. */
function zoomFactor(zoom: number): string {
  return String(zoom / 100)
}

function EmailHtmlFrame({
  html,
  title,
  zoom,
  onZoomWheel
}: {
  html: string
  title: string
  zoom: number
  /** A Ctrl/⌘ + wheel (or pinch) over the message: the event's deltaY. */
  onZoomWheel: (deltaY: number) => void
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const boundDocumentRef = useRef<Document | null>(null)
  // Re-measures the bound document; replaced by the binding effect.
  const measureRef = useRef<() => void>(() => undefined)
  const zoomRef = useRef(zoom)
  const onZoomWheelRef = useRef(onZoomWheel)
  const [frameHeight, setFrameHeight] = useState(MESSAGE_FRAME_MIN_HEIGHT)

  useEffect(() => {
    onZoomWheelRef.current = onZoomWheel
  }, [onZoomWheel])

  useEffect(() => {
    zoomRef.current = zoom
    const document = boundDocumentRef.current

    if (document?.documentElement) {
      document.documentElement.style.zoom = zoomFactor(zoom)
      measureRef.current()
    }
  }, [zoom])
  const frameDocument = buildMessageFrameDocument(html)

  useEffect(() => {
    const iframe = iframeRef.current as MessageContentFrameElement | null

    if (!iframe) {
      return
    }

    let boundDocument: Document | null = null
    let resizeObserver: ResizeObserver | null = null
    let animationFrameId: number | null = null
    let watchFrameId: number | null = null

    const updateHeight = (): void => {
      const document = boundDocument
      const view = document?.defaultView

      if (!document?.documentElement || !document.body || !view) {
        return
      }

      // The root's scroll height never drops below the frame's own height,
      // so it can grow the frame but never shrink it — zooming out left a
      // tall white tail. The rendered box follows the zoom both ways; the
      // body's scroll height (unzoomed, hence the factor) still catches
      // content that overflows it.
      const zoom = Number(document.documentElement.style.zoom) || 1
      const bodyStyle = view.getComputedStyle(document.body)
      const contentHeight = Math.max(
        document.documentElement.getBoundingClientRect().height,
        (document.body.scrollHeight +
          Number.parseFloat(bodyStyle.marginTop) +
          Number.parseFloat(bodyStyle.marginBottom)) *
          zoom
      )
      const nextHeight = Math.max(MESSAGE_FRAME_MIN_HEIGHT, Math.ceil(contentHeight)) + 2

      setFrameHeight((current) => (current === nextHeight ? current : nextHeight))
    }

    const scheduleHeightUpdate = (): void => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        updateHeight()
      })
    }
    measureRef.current = scheduleHeightUpdate

    const unbind = (): void => {
      iframe.__messageFrameCleanup?.()
      iframe.__messageFrameCleanup = undefined
      resizeObserver?.disconnect()
      resizeObserver = null
      boundDocument = null
      boundDocumentRef.current = null
    }

    const bindFrameDocument = (document: Document): void => {
      unbind()
      boundDocument = document
      boundDocumentRef.current = document
      document.documentElement.style.zoom = zoomFactor(zoomRef.current)

      // Wheel events do not leave an iframe either: the zoom gesture over
      // the message is caught here. A trackpad pinch arrives as a wheel
      // event with ctrlKey set, on every platform.
      const handleZoomWheel = (event: WheelEvent): void => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          onZoomWheelRef.current(event.deltaY)
        }
      }

      const handlePointerNavigation = (event: MouseEvent): void => {
        // event.target comes from the iframe's realm, so we cannot use
        // `instanceof Element` (different constructor across realms). Duck-type
        // on `closest` instead — every Element in every realm implements it.
        const target = event.target as Element | null
        if (!target || typeof target.closest !== 'function') {
          return
        }

        const href = resolveClickableUrl(target)

        if (!href) {
          return
        }

        // Always block the iframe's default navigation — without this, any click
        // on an <a> would navigate the iframe itself and (thanks to the sandbox
        // blocking cross-origin) leave a blank white frame.
        event.preventDefault()
        event.stopPropagation()

        const trimmed = href.trim()

        if (!trimmed || trimmed.startsWith('#')) {
          // In-document anchors: manually scroll, since we already swallowed the
          // iframe's default navigation above. Use getElementById + [name] fallback
          // because fragment strings may contain characters that aren't valid CSS
          // selectors (dots, colons, etc.).
          if (trimmed.length > 1) {
            const fragment = trimmed.slice(1)
            const anchor =
              document.getElementById(fragment) || document.getElementsByName(fragment)[0] || null
            anchor?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          return
        }

        if (!isExternalHrefValue(trimmed)) {
          // javascript: / data: / unknown schemes: DOMPurify should already have
          // stripped the unsafe ones, and navigating to the remainder would not
          // help the user. Silently swallow the click.
          return
        }

        void window.mailApi.openExternalUrl(trimmed)
      }

      const handleSubmit = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      // Key events do not leave an iframe. Once the user had clicked into an
      // email — to select a line, follow a link — every app shortcut went
      // dead until they clicked back on the list: Cmd/Ctrl+F no longer
      // reached the search box, and extension shortcuts never fired. Chords
      // are handed to the app window; plain keys and the copy/select chords
      // stay with the message.
      const forwardShortcut = (event: KeyboardEvent): void => {
        const isChord = event.metaKey || event.ctrlKey || event.altKey

        if (!isChord || FRAME_NATIVE_CHORD_CODES.has(event.code)) {
          return
        }

        const forwarded = new KeyboardEvent('keydown', {
          key: event.key,
          code: event.code,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          bubbles: true,
          cancelable: true
        })
        window.dispatchEvent(forwarded)

        if (forwarded.defaultPrevented) {
          event.preventDefault()
        }
      }

      document.addEventListener('click', handlePointerNavigation, true)
      document.addEventListener('auxclick', handlePointerNavigation, true)
      document.addEventListener('submit', handleSubmit, true)
      document.addEventListener('keydown', forwardShortcut)
      document.addEventListener('wheel', handleZoomWheel, { passive: false })
      // `load` and `error` do not bubble, but they do reach a capturing
      // listener on the document — so every image counts, including the
      // ones the parser has not reached yet when this runs.
      document.addEventListener('load', scheduleHeightUpdate, true)
      document.addEventListener('error', scheduleHeightUpdate, true)
      document.fonts?.addEventListener('loadingdone', scheduleHeightUpdate)

      // The observer comes from the frame's own window: an observer created
      // in the parent only runs in the parent's rendering steps, which is
      // not a reliable place to learn that a child document changed size.
      const FrameResizeObserver =
        (document.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver ??
        ResizeObserver
      resizeObserver = new FrameResizeObserver(() => scheduleHeightUpdate())
      resizeObserver.observe(document.documentElement)

      if (document.body) {
        resizeObserver.observe(document.body)
      }

      scheduleHeightUpdate()

      iframe.__messageFrameCleanup = () => {
        document.removeEventListener('click', handlePointerNavigation, true)
        document.removeEventListener('auxclick', handlePointerNavigation, true)
        document.removeEventListener('submit', handleSubmit, true)
        document.removeEventListener('keydown', forwardShortcut)
        document.removeEventListener('wheel', handleZoomWheel)
        document.removeEventListener('load', scheduleHeightUpdate, true)
        document.removeEventListener('error', scheduleHeightUpdate, true)
        document.fonts?.removeEventListener('loadingdone', scheduleHeightUpdate)
      }
    }

    /**
     * Binds to the message document the moment it is parsed, not when it
     * has finished loading.
     *
     * This used to wait for the frame's `load` event, and `load` waits for
     * every image in the message. Until then the observers were attached to
     * the placeholder `about:blank` document, so the frame kept its 320px
     * starting height while the email underneath was already laid out: a
     * newsletter showed its first screen and nothing else. A slow image
     * made the rest appear seconds later, and an image request that never
     * settled meant it never appeared at all. Watching for the new document
     * on each frame instead lets the height follow the content from the
     * first paint, and images, fonts and late layout only ever grow it.
     */
    const watchForMessageDocument = (): void => {
      watchFrameId = null
      const document = iframe.contentDocument

      if (
        document &&
        document !== boundDocument &&
        document.URL === 'about:srcdoc' &&
        document.body
      ) {
        bindFrameDocument(document)
      }

      if (!boundDocument || boundDocument.readyState !== 'complete') {
        watchFrameId = window.requestAnimationFrame(watchForMessageDocument)
      }
    }

    // `load` stays as the last word: by then every image has settled, so one
    // final measurement catches anything the observers could not see.
    const handleLoad = (): void => {
      const document = iframe.contentDocument

      if (document && document !== boundDocument) {
        bindFrameDocument(document)
      } else {
        scheduleHeightUpdate()
      }
    }

    iframe.addEventListener('load', handleLoad)
    watchForMessageDocument()

    return () => {
      iframe.removeEventListener('load', handleLoad)
      unbind()

      if (watchFrameId !== null) {
        window.cancelAnimationFrame(watchFrameId)
      }

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
    }
  }, [frameDocument])

  return (
    <iframe
      ref={iframeRef}
      title={title}
      sandbox={MESSAGE_FRAME_SANDBOX}
      srcDoc={frameDocument}
      className="block w-full rounded-md bg-white shadow-[0_0_0_1px_hsl(var(--border)),0_1px_3px_hsl(var(--shadow)/0.06)]"
      style={{ height: `${frameHeight}px` }}
    />
  )
}

export function MessageViewer({
  message,
  brief,
  bodyStatus,
  onRetryBody,
  isExpanded,
  selectedCount,
  onClearSelection,
  wholeViewSelection,
  selectionActions,
  extensionActions,
  atWindowTopRight,
  onReply,
  onReplyAll,
  onForward,
  onContinueDraft,
  onToggleExpanded,
  attachmentActions,
  addressActions,
  zoom,
  onZoomChange,
  detailsOpen,
  onDetailsOpenChange
}: MessageViewerProps): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { formatLocale } = useLanguage()
  // Wheel events can arrive many times a frame during a pinch; each one
  // builds on the zoom the previous one set, not on a stale render's.
  const zoomStateRef = useRef({ zoom, onZoomChange })
  useEffect(() => {
    zoomStateRef.current = { zoom, onZoomChange }
  }, [zoom, onZoomChange])

  const handleZoomWheel = useCallback((deltaY: number): void => {
    const state = zoomStateRef.current
    const next = wheelReaderZoom(state.zoom, deltaY)

    if (next !== state.zoom) {
      zoomStateRef.current = { ...state, zoom: next }
      state.onZoomChange(next)
    }
  }, [])

  // The same gesture over the rest of the pane — the header, the margins,
  // the attachments — zooms the message too, and never the whole app.
  const attachPaneZoomWheel = useCallback(
    (pane: HTMLDivElement | null) => {
      if (!pane) {
        return
      }

      const handleWheel = (event: WheelEvent): void => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          handleZoomWheel(event.deltaY)
        }
      }

      pane.addEventListener('wheel', handleWheel, { passive: false })
      return () => pane.removeEventListener('wheel', handleWheel)
    },
    [handleZoomWheel]
  )
  // Attachments (and "all") with a download under way: their chip spins and
  // a second click is ignored until it lands.
  const [busyAttachmentIds, setBusyAttachmentIds] = useState<string[]>([])
  const hasHtmlBody = Boolean(message?.html?.trim())

  useEffect(() => {
    setBusyAttachmentIds([])
  }, [message?.accountId, message?.folderPath, message?.uid])

  const runAttachmentTask = async (busyId: string, task: () => Promise<void>): Promise<void> => {
    let started = false
    setBusyAttachmentIds((current) => {
      if (current.includes(busyId)) {
        return current
      }

      started = true
      return [...current, busyId]
    })

    if (!started) {
      return
    }

    try {
      await task()
    } finally {
      setBusyAttachmentIds((current) => current.filter((id) => id !== busyId))
    }
  }

  const openAttachment = (attachment: MailAttachment): void => {
    if (attachmentActions) {
      void runAttachmentTask(attachment.id, () => attachmentActions.open(attachment))
    }
  }

  const saveAttachment = (attachment: MailAttachment): void => {
    if (attachmentActions) {
      void runAttachmentTask(attachment.id, () => attachmentActions.save(attachment))
    }
  }

  const showAttachmentMenu = async (attachment: MailAttachment): Promise<void> => {
    const words = messagesNow(MESSAGES)
    const chosen = await window.mailApi.showContextMenu([
      { id: 'open', label: words.open },
      { id: 'save', label: words.saveAs },
      ...(message && message.attachments.length > 1
        ? [{ id: 'save-all', label: words.saveAllAttachments(message.attachments.length) }]
        : [])
    ])

    if (chosen === 'open') {
      openAttachment(attachment)
    } else if (chosen === 'save') {
      saveAttachment(attachment)
    } else if (chosen === 'save-all') {
      saveAllAttachments()
    }
  }

  const saveAllAttachments = (): void => {
    if (attachmentActions) {
      void runAttachmentTask(ALL_ATTACHMENTS_TASK_ID, () => attachmentActions.saveAll())
    }
  }

  /*
    The pane's first band is the window's title bar: dragged like one, and
    on Windows clear of the window's own buttons. It holds what can be done
    to what the pane shows — one message, or the selection.
  */
  const headerBand = (content: ReactNode): React.JSX.Element => (
    <div
      className={cn(
        // A container: beside the Segretario's panel the reading pane narrows,
        // and its buttons give up their words before they would overlap.
        'window-drag-region @container/reader-header flex h-[52px] shrink-0 items-center gap-1 border-b pl-3',
        atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-2'
      )}
    >
      {content}
    </div>
  )

  if (selectedCount > 1) {
    return (
      <div className="page flex h-full min-h-0 flex-col">
        {headerBand(
          <>
            <div className="window-no-drag flex items-center gap-1">
              <IconButton
                label={m.clearSelection}
                className="text-faint-foreground size-[28px]"
                onClick={onClearSelection}
              >
                <X className="size-[15px]" />
              </IconButton>
              <span className="tabular mr-2 text-[12.5px] font-semibold">
                {m.selected(selectedCount.toLocaleString(formatLocale))}
              </span>
              {extensionActions}
            </div>
            <div className="flex-1" />
            <div className="window-no-drag">
              <SelectionActions labelled {...selectionActions} />
            </div>
          </>
        )}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
          <p className="display-title text-[18px]">
            {m.messagesSelected(selectedCount.toLocaleString(formatLocale))}
          </p>
          <p className="text-muted-foreground mt-1.5 max-w-sm text-[12.5px] leading-[1.5]">
            {m.selectionText}
          </p>
          {wholeViewSelection && (
            <div className="mt-5 flex max-w-sm flex-col items-center gap-2.5">
              <p className="text-faint-foreground text-[12px]">
                {m.loadedSelected(wholeViewSelection.total.toLocaleString(formatLocale))}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={wholeViewSelection.selecting}
                onClick={wholeViewSelection.onSelect}
              >
                {wholeViewSelection.selecting && <LoaderCircle className="size-3.5 animate-spin" />}
                {wholeViewSelection.total > MAX_MESSAGES_PER_ACTION
                  ? m.selectFirst(MAX_MESSAGES_PER_ACTION.toLocaleString(formatLocale))
                  : m.selectAll(wholeViewSelection.total.toLocaleString(formatLocale))}
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!message) {
    return (
      <div className="page flex h-full min-h-0 flex-col">
        {headerBand(null)}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
          {bodyStatus === 'loading' ? (
            <LoaderCircle className="text-faint-foreground size-5 animate-spin" />
          ) : (
            <>
              <p className="text-muted-foreground text-[13px] font-medium">{m.noMessageSelected}</p>
              <p className="text-faint-foreground mt-1 max-w-sm text-[12px]">{m.chooseMessage}</p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div ref={attachPaneZoomWheel} className="page flex h-full min-h-0 flex-col overflow-hidden">
      {headerBand(
        <>
          <div className="window-no-drag flex min-w-0 items-center gap-1">
            {extensionActions}
            {onContinueDraft ? (
              <ActionTooltip label={m.resumeDraft}>
                <Button variant="secondary" size="sm" onClick={onContinueDraft}>
                  <PenLine className="size-3.5" /> {m.continueWriting}
                </Button>
              </ActionTooltip>
            ) : (
              <>
                <ActionTooltip label={m.replyToSender} commandId="reply">
                  <Button variant="secondary" size="sm" onClick={onReply}>
                    <Reply className="size-3.5" />
                    <span className="@max-[560px]/reader-header:hidden">{m.reply}</span>
                  </Button>
                </ActionTooltip>
                <ActionTooltip label={m.replyToAll} commandId="reply-all">
                  <Button variant="ghost" size="sm" onClick={onReplyAll}>
                    <ReplyAll className="size-3.5" />
                    <span className="@max-[760px]/reader-header:hidden">{m.replyAll}</span>
                  </Button>
                </ActionTooltip>
                <ActionTooltip label={m.forwardWithAttachments} commandId="forward">
                  <Button variant="ghost" size="sm" onClick={onForward}>
                    <Forward className="size-3.5" />
                    <span className="@max-[760px]/reader-header:hidden">{m.forward}</span>
                  </Button>
                </ActionTooltip>
              </>
            )}
          </div>
          <div className="min-w-2 flex-1" />
          <div className="window-no-drag flex items-center gap-0.5">
            <SelectionActions labelled={false} {...selectionActions} />
            <div className="bg-border mx-1 h-4 w-px" />
            <IconButton
              label={isExpanded ? m.collapseView : m.expandView}
              tooltipSide="left"
              className="text-faint-foreground hover:text-foreground size-[28px]"
              onClick={onToggleExpanded}
            >
              {isExpanded ? (
                <Minimize2 className="size-[14px]" />
              ) : (
                <Maximize2 className="size-[14px]" />
              )}
            </IconButton>
          </div>
        </>
      )}

      {/*
        The envelope is deliberately tight: in the outlook layout the
        reading pane is about half the workspace. One line says who, to whom
        and when; "Dettagli" opens the rest in place.
      */}
      <div className="flex shrink-0 flex-col gap-1.5 px-6 pt-4 pb-3">
        <h2 className="display-title min-w-0 text-[19px] leading-[1.25] [overflow-wrap:anywhere]">
          {message.subject || m.noSubject}
        </h2>
        <div className="text-muted-foreground flex items-baseline gap-1.5 text-[12px]">
          <span className="text-foreground min-w-0 shrink truncate font-semibold">
            {addressesToLabel(m, message.from)}
          </span>
          <span className="text-faint-foreground shrink-0">·</span>
          {/* The first person and a count, never the whole list: the full
              list lives under Dettagli, one token per person. */}
          <span className="min-w-0 shrink truncate">
            {recipientsSummary(m, message, Boolean(onContinueDraft))}
          </span>
          <span className="text-faint-foreground shrink-0">·</span>
          <span className="tabular shrink-0 whitespace-nowrap">
            {formatDateLabel(message.date)}
          </span>
          {message.hasAttachments && (
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap">
              <Paperclip className="size-3" />
              {message.attachments.length || ''}
            </span>
          )}
          {zoom !== READER_ZOOM_RESET && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onZoomChange(READER_ZOOM_RESET)}
                  aria-label={m.zoomLabel(zoom)}
                  className="keycap focus-visible:ring-ring/60 tabular ml-auto inline-flex h-[18px] shrink-0 items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold outline-none focus-visible:ring-2"
                >
                  {zoom}%
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {m.zoomTip}
                <span className="text-muted-foreground block text-[10.5px] font-normal">
                  {m.zoomKeys}
                </span>
              </TooltipContent>
            </Tooltip>
          )}
          <button
            type="button"
            onClick={() => onDetailsOpenChange(!detailsOpen)}
            aria-expanded={detailsOpen}
            className={cn(
              'hover:text-foreground focus-visible:ring-ring/60 inline-flex shrink-0 items-center gap-0.5 rounded-sm whitespace-nowrap outline-none focus-visible:ring-2',
              zoom === READER_ZOOM_RESET && 'ml-auto'
            )}
          >
            {m.details}
            <ChevronDown
              className={cn('size-3 transition-transform', detailsOpen && 'rotate-180')}
            />
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 pb-6">
          {detailsOpen && (
            // The envelope details sit at the top of the scrolling area
            // rather than in the fixed header: a distribution list of four
            // hundred people then scrolls past like the rest of the message
            // instead of squeezing the body out of a half-height reading
            // pane.
            <div className="text-muted-foreground mb-4 grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5 border-b pb-3 text-[12px]">
              <DetailsLabel count={message.from.length}>{m.from}</DetailsLabel>
              <AddressTokens addresses={message.from} actions={addressActions} />
              {message.to.length > 0 && (
                <>
                  <DetailsLabel count={message.to.length}>{m.to}</DetailsLabel>
                  <AddressTokens addresses={message.to} actions={addressActions} />
                </>
              )}
              {message.cc.length > 0 && (
                <>
                  <DetailsLabel count={message.cc.length}>{m.cc}</DetailsLabel>
                  <AddressTokens addresses={message.cc} actions={addressActions} />
                </>
              )}
              {message.bcc.length > 0 && (
                <>
                  <DetailsLabel count={message.bcc.length}>{m.bcc}</DetailsLabel>
                  <AddressTokens addresses={message.bcc} actions={addressActions} />
                </>
              )}
              <span>{m.date}</span>
              <span className="text-foreground min-w-0">{formatDateTimeLabel(message.date)}</span>
            </div>
          )}

          {brief}

          {bodyStatus === 'loading' ? (
            <div
              className="text-muted-foreground flex items-center gap-2 py-6 text-[12.5px]"
              role="status"
            >
              <LoaderCircle className="text-faint-foreground size-4 animate-spin" />
              {m.downloading}
            </div>
          ) : bodyStatus === 'failed' ? (
            <div className="flex flex-col items-start gap-2 py-6 text-[12.5px]">
              <p className="text-muted-foreground">{m.downloadFailed}</p>
              <Button type="button" variant="secondary" size="sm" onClick={onRetryBody}>
                {m.tryAgain}
              </Button>
            </div>
          ) : hasHtmlBody && message.html ? (
            <EmailHtmlFrame
              key={`${message.accountId}:${message.folderPath}:${message.uid}`}
              html={message.html}
              title={m.frameTitle(message.subject || m.untitledMessage)}
              zoom={zoom}
              onZoomWheel={handleZoomWheel}
            />
          ) : (
            <pre
              className="text-foreground/90 font-sans text-[13.5px] leading-[1.55] whitespace-pre-wrap"
              style={{ zoom: zoomFactor(zoom) }}
            >
              {message.text || m.noContent}
            </pre>
          )}

          {message.attachments.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-1.5">
                <div className="flex h-6 items-center justify-between gap-2">
                  <h4 className="eyebrow">
                    {formatCount(message.attachments.length, m.attachmentOne, m.attachmentOther)}
                  </h4>
                  {message.attachments.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-faint-foreground hover:text-foreground"
                      disabled={busyAttachmentIds.includes(ALL_ATTACHMENTS_TASK_ID)}
                      onClick={saveAllAttachments}
                    >
                      {busyAttachmentIds.includes(ALL_ATTACHMENTS_TASK_ID) ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {m.saveAll}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {message.attachments.map((attachment) => {
                    const busy = busyAttachmentIds.includes(attachment.id)

                    return (
                      <AttachmentChip
                        key={attachment.id}
                        fileName={attachment.fileName}
                        sizeBytes={attachment.size}
                        busy={busy}
                        onOpen={() => openAttachment(attachment)}
                        openHint={m.clickToOpen}
                        onContextMenu={() => void showAttachmentMenu(attachment)}
                        trailing={
                          <IconButton
                            label={m.saveAs}
                            tooltipSide="top"
                            className="text-faint-foreground hover:text-foreground size-5"
                            disabled={busy}
                            onClick={() => saveAttachment(attachment)}
                          >
                            <Download className="size-3" />
                          </IconButton>
                        }
                      />
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
