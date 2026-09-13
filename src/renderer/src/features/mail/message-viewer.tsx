import { useEffect, useRef, useState } from 'react'

import {
  Archive,
  ArrowRight,
  CheckCheck,
  ChevronDown,
  Flag,
  FolderInput,
  Forward,
  LoaderCircle,
  Maximize2,
  MailOpen,
  MailPlus,
  Minimize2,
  Paperclip,
  Reply,
  Trash2
} from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { AttachmentChip } from './attachment-chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Separator } from '@renderer/components/ui/separator'
import { buildMailFrameDocument, sanitizeMailHtml } from '@renderer/lib/mail-html'
import { cn, formatAddress, formatDateLabel, formatDateTimeLabel } from '@renderer/lib/utils'
import type { MailFolder, MailMessageDetail } from '@shared/models'

interface MessageViewerProps {
  folders: MailFolder[]
  message: MailMessageDetail | null
  loading?: boolean
  isExpanded: boolean
  /**
   * How many messages are selected. Above one the pane shows a summary
   * instead of a body: reading one message while acting on twelve is a
   * mismatch every mail client avoids, and it is the state the toolbar's
   * bulk actions belong to.
   */
  selectedCount: number
  onReply: () => void
  onForward: () => void
  onArchive: () => void
  onDelete: () => void
  onMoveToFolder: (folderPath: string) => void
  onToggleExpanded: () => void
  onToggleSeen: (seen: boolean) => void
  onToggleFlagged: (flagged: boolean) => void
  onDownloadAttachment: (attachmentId: string) => Promise<void>
}

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

function addressesToLabel(addresses: { name?: string; address: string }[]): string {
  if (addresses.length === 0) {
    return 'N/D'
  }

  return addresses.map(formatAddress).join(', ')
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

function EmailHtmlFrame({ html, title }: { html: string; title: string }): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [frameHeight, setFrameHeight] = useState(MESSAGE_FRAME_MIN_HEIGHT)
  const normalizedMessageHtml = sanitizeMailHtml(html)
  const frameDocument = buildMailFrameDocument({
    bodyHtml: normalizedMessageHtml.bodyHtml,
    headHtml: normalizedMessageHtml.headHtml,
    editable: false
  })

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

      if (!document?.documentElement || !document.body) {
        return
      }

      const nextHeight =
        Math.max(
          MESSAGE_FRAME_MIN_HEIGHT,
          document.documentElement.scrollHeight,
          document.body.scrollHeight
        ) + 2

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

    const unbind = (): void => {
      iframe.__messageFrameCleanup?.()
      iframe.__messageFrameCleanup = undefined
      resizeObserver?.disconnect()
      resizeObserver = null
      boundDocument = null
    }

    const bindFrameDocument = (document: Document): void => {
      unbind()
      boundDocument = document

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
      className="border-border/70 block w-full rounded-lg border bg-white"
      style={{ height: `${frameHeight}px` }}
    />
  )
}

export function MessageViewer({
  folders,
  message,
  loading,
  isExpanded,
  selectedCount,
  onReply,
  onForward,
  onArchive,
  onDelete,
  onMoveToFolder,
  onToggleExpanded,
  onToggleSeen,
  onToggleFlagged,
  onDownloadAttachment
}: MessageViewerProps): React.JSX.Element {
  const [downloadingAttachmentIds, setDownloadingAttachmentIds] = useState<string[]>([])
  // Envelope details stay collapsed by default and reset with the message:
  // leaving them open would silently steal the height back from the body on
  // the next mail the user opens.
  const [detailsOpen, setDetailsOpen] = useState(false)
  const hasHtmlBody = Boolean(message?.html?.trim())

  useEffect(() => {
    setDownloadingAttachmentIds([])
    setDetailsOpen(false)
  }, [message?.accountId, message?.folderPath, message?.uid])

  const downloadAttachment = async (attachmentId: string): Promise<void> => {
    let canStartDownload = false
    setDownloadingAttachmentIds((current) => {
      if (current.includes(attachmentId)) {
        return current
      }

      canStartDownload = true
      return [...current, attachmentId]
    })

    if (!canStartDownload) {
      return
    }

    try {
      await onDownloadAttachment(attachmentId)
    } finally {
      setDownloadingAttachmentIds((current) => current.filter((id) => id !== attachmentId))
    }
  }

  if (selectedCount > 1) {
    return (
      <div className="glass-panel flex h-full min-h-0 flex-col items-center justify-center rounded-lg p-8 text-center">
        <div className="bg-primary/12 text-primary rounded-full p-3">
          <CheckCheck className="size-6" />
        </div>
        <p className="mt-4 text-base font-semibold">{selectedCount} messaggi selezionati</p>
        <p className="text-muted-foreground mt-1.5 max-w-sm text-xs">
          Usa la barra in alto per archiviare, spostare, contrassegnare o eliminare l&apos;intera
          selezione in un colpo solo.
        </p>
      </div>
    )
  }

  if (!message) {
    if (loading) {
      return (
        <div className="glass-panel flex h-full min-h-0 flex-col items-center justify-center rounded-lg p-8 text-center">
          <LoaderCircle className="text-primary size-5 animate-spin" />
          <p className="text-muted-foreground mt-3 text-xs">Caricamento email…</p>
        </div>
      )
    }

    return (
      <div className="glass-panel flex h-full min-h-0 flex-col items-center justify-center rounded-lg p-8 text-center">
        <div className="bg-secondary/65 text-muted-foreground rounded-full p-3">
          <MailPlus className="size-6" />
        </div>
        <p className="mt-4 text-sm font-semibold">Nessun messaggio selezionato</p>
        <p className="text-muted-foreground mt-1.5 max-w-sm text-xs">
          Seleziona un&apos;email dalla lista per leggerne il contenuto e gli allegati.
        </p>
      </div>
    )
  }

  return (
    <div className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg">
      {/*
        The header is deliberately tight. In the outlook layout the reading
        pane is only about half the workspace, and the previous header — a
        subject line, a row of actions and a four-line Da/A/Cc/Data grid —
        ate 150px of it before a single line of the message showed. The
        envelope details now collapse to one line with a "Dettagli"
        disclosure, the way every mail client handles them, and expand in
        place when the user actually wants them.
      */}
      <div className="border-border/60 flex shrink-0 flex-col gap-1.5 border-b px-3 py-2">
        {/*
          Subject and actions share one row, and which actions carry a label
          follows one rule: the toolbar labels what acts on the selection
          (archivia, sposta, segna, contrassegna, elimina), so repeating
          those words here would stack two identical rows — most visibly in
          the expanded view, where the two sit directly on top of each
          other. This row therefore labels only what the toolbar has no
          equivalent for, Rispondi and Inoltra, and keeps the rest as icons
          with tooltips. The labelled toolbar right above is what makes
          those icons discoverable.

          The upshot is a row that is ~380px instead of ~664px at every
          width, so it never competes with the subject: the subject is the
          flexible half (`min-w-0`, truncates rather than pushing the
          actions down) and `flex-wrap` is left only as a last-resort valve.
        */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="min-w-0 flex-1 truncate text-[14px] leading-6 font-semibold">
            {message.subject}
          </h2>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              className="h-6.5 gap-1.5 px-2 text-[11.5px]"
              onClick={onReply}
            >
              <Reply className="size-3.5" /> Rispondi
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6.5 gap-1.5 px-2 text-[11.5px]"
              onClick={onForward}
            >
              <Forward className="size-3.5" /> Inoltra
            </Button>

            {/* Same divider the toolbar uses, so the labelled pair reads as
                one group and the icons as another. */}
            <div className="bg-border/60 mx-0.5 h-5 w-px shrink-0" />

            <IconButton label="Archivia" className="size-6.5" onClick={onArchive}>
              <Archive className="size-3.5" />
            </IconButton>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Sposta in una cartella" className="size-6.5">
                  <FolderInput className="size-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                {folders
                  .filter((folder) => folder.path !== message.folderPath)
                  .map((folder) => (
                    <DropdownMenuItem
                      key={folder.path}
                      className="cursor-pointer text-[12px]"
                      onClick={() => onMoveToFolder(folder.path)}
                    >
                      {folder.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <IconButton
              label={message.isRead ? 'Segna come non letta' : 'Segna come letta'}
              className="size-6.5"
              onClick={() => onToggleSeen(!message.isRead)}
            >
              <MailOpen className="size-3.5" />
            </IconButton>

            <IconButton
              label={message.isFlagged ? 'Rimuovi contrassegno' : 'Contrassegna'}
              className={cn('size-6.5', message.isFlagged && 'text-status-offline')}
              onClick={() => onToggleFlagged(!message.isFlagged)}
            >
              <Flag className={cn('size-3.5', message.isFlagged && 'fill-current')} />
            </IconButton>

            <IconButton
              label="Elimina"
              className="text-destructive hover:bg-destructive/15 hover:text-destructive size-6.5"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </IconButton>

            <IconButton
              label={isExpanded ? 'Comprimi vista messaggio' : 'Espandi vista messaggio'}
              tooltipSide="left"
              className="text-muted-foreground hover:text-foreground ml-1 size-6"
              onClick={onToggleExpanded}
            >
              {isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </IconButton>
          </div>
        </div>

        <div className="text-muted-foreground flex items-baseline gap-1.5 text-[11px]">
          <span className="text-foreground min-w-0 shrink truncate font-medium">
            {addressesToLabel(message.from)}
          </span>
          <span className="shrink-0 opacity-50">·</span>
          <span className="min-w-0 shrink truncate">A {addressesToLabel(message.to)}</span>
          <span className="shrink-0 opacity-50">·</span>
          <span className="shrink-0 whitespace-nowrap">{formatDateLabel(message.date)}</span>
          {message.hasAttachments && (
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap">
              <Paperclip className="size-3" />
              {message.attachments.length || ''}
            </span>
          )}
          {loading && (
            <span className="text-primary inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
              <ArrowRight className="size-3 animate-pulse" /> Aggiornamento…
            </span>
          )}
          <button
            type="button"
            onClick={() => setDetailsOpen((current) => !current)}
            aria-expanded={detailsOpen}
            className="hover:text-foreground focus-visible:ring-ring/70 ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-sm whitespace-nowrap outline-none focus-visible:ring-2"
          >
            Dettagli
            <ChevronDown
              className={cn('size-3 transition-transform', detailsOpen && 'rotate-180')}
            />
          </button>
        </div>

        {detailsOpen && (
          <div className="text-muted-foreground border-border/50 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-t pt-1.5 text-[11px]">
            <span>Da</span>
            <span className="text-foreground min-w-0 break-words">
              {addressesToLabel(message.from)}
            </span>
            <span>A</span>
            <span className="min-w-0 break-words">{addressesToLabel(message.to)}</span>
            {message.cc.length > 0 && (
              <>
                <span>Cc</span>
                <span className="min-w-0 break-words">{addressesToLabel(message.cc)}</span>
              </>
            )}
            {message.bcc.length > 0 && (
              <>
                <span>Ccn</span>
                <span className="min-w-0 break-words">{addressesToLabel(message.bcc)}</span>
              </>
            )}
            <span>Data</span>
            <span className="min-w-0">{formatDateTimeLabel(message.date)}</span>
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3.5">
          {hasHtmlBody && message.html ? (
            <EmailHtmlFrame
              key={`${message.accountId}:${message.folderPath}:${message.uid}`}
              html={message.html}
              title={`Contenuto email: ${message.subject || 'Messaggio senza oggetto'}`}
            />
          ) : (
            <pre className="text-foreground/90 font-sans text-sm whitespace-pre-wrap">
              {message.text || '(Nessun contenuto)'}
            </pre>
          )}

          {message.attachments.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-1.5">
                <h4 className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {message.attachments.length === 1
                    ? '1 allegato'
                    : `${message.attachments.length} allegati`}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {message.attachments.map((attachment) => (
                    <AttachmentChip
                      key={attachment.id}
                      fileName={attachment.fileName}
                      sizeBytes={attachment.size}
                      busy={downloadingAttachmentIds.includes(attachment.id)}
                      onOpen={() => void downloadAttachment(attachment.id)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
