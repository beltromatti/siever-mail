import { useEffect, useRef, useState } from 'react'

import {
  Archive,
  ArrowRight,
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

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Separator } from '@renderer/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { buildMailFrameDocument, sanitizeMailHtml } from '@renderer/lib/mail-html'
import { formatAddress, formatDateLabel } from '@renderer/lib/utils'
import type { MailFolder, MailMessageDetail } from '@shared/models'

interface MessageViewerProps {
  folders: MailFolder[]
  message: MailMessageDetail | null
  loading?: boolean
  isExpanded: boolean
  onReply: () => void
  onForward: () => void
  onArchive: () => void
  onDelete: () => void
  onMoveToFolder: (folderPath: string) => void
  onToggleExpanded: () => void
  onToggleSeen: (seen: boolean) => void
  onDownloadAttachment: (attachmentId: string) => Promise<void>
}

const EXTERNAL_SCHEME_PATTERN = /^(https?|mailto|tel|sms):/i
const MESSAGE_FRAME_SANDBOX = 'allow-same-origin'
const MESSAGE_FRAME_MIN_HEIGHT = 320

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

    let resizeObserver: ResizeObserver | null = null
    let animationFrameId: number | null = null

    const updateHeight = (): void => {
      const document = iframe.contentDocument

      if (!document) {
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

    const bindFrameDocument = (): void => {
      const document = iframe.contentDocument

      if (!document) {
        return
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
              document.getElementById(fragment) ||
              document.getElementsByName(fragment)[0] ||
              null
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

      document.addEventListener('click', handlePointerNavigation, true)
      document.addEventListener('auxclick', handlePointerNavigation, true)
      document.addEventListener('submit', handleSubmit, true)

      resizeObserver = new ResizeObserver(() => {
        scheduleHeightUpdate()
      })
      resizeObserver.observe(document.documentElement)
      resizeObserver.observe(document.body)

      for (const image of document.images) {
        image.addEventListener('load', scheduleHeightUpdate)
        image.addEventListener('error', scheduleHeightUpdate)
      }

      scheduleHeightUpdate()

      const cleanup = (): void => {
        document.removeEventListener('click', handlePointerNavigation, true)
        document.removeEventListener('auxclick', handlePointerNavigation, true)
        document.removeEventListener('submit', handleSubmit, true)

        for (const image of document.images) {
          image.removeEventListener('load', scheduleHeightUpdate)
          image.removeEventListener('error', scheduleHeightUpdate)
        }
      }

      iframe.__messageFrameCleanup = cleanup
    }

    const handleLoad = (): void => {
      iframe.__messageFrameCleanup?.()
      resizeObserver?.disconnect()
      resizeObserver = null
      bindFrameDocument()
    }

    iframe.addEventListener('load', handleLoad)
    bindFrameDocument()

    return () => {
      iframe.removeEventListener('load', handleLoad)
      iframe.__messageFrameCleanup?.()
      resizeObserver?.disconnect()

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
  onReply,
  onForward,
  onArchive,
  onDelete,
  onMoveToFolder,
  onToggleExpanded,
  onToggleSeen,
  onDownloadAttachment
}: MessageViewerProps): React.JSX.Element {
  const [downloadingAttachmentIds, setDownloadingAttachmentIds] = useState<string[]>([])
  const hasHtmlBody = Boolean(message?.html?.trim())

  useEffect(() => {
    setDownloadingAttachmentIds([])
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

  if (!message) {
    if (loading) {
      return (
        <div className="glass-panel flex h-full min-h-0 flex-col items-center justify-center rounded-xl p-10 text-center">
          <LoaderCircle className="text-primary size-6 animate-spin" />
          <p className="text-muted-foreground mt-3 text-sm">Caricamento email...</p>
        </div>
      )
    }

    return (
      <div className="glass-panel flex h-full min-h-0 flex-col items-center justify-center rounded-xl p-10 text-center">
        <div className="bg-secondary/65 text-muted-foreground rounded-full p-4">
          <MailPlus className="size-7" />
        </div>
        <h3 className="display-title mt-5 text-3xl">Seleziona un messaggio</h3>
        <p className="text-muted-foreground mt-2 max-w-md text-sm">
          Apri un&apos;email dalla lista centrale per leggere contenuto, allegati e rispondere
          rapidamente.
        </p>
      </div>
    )
  }

  return (
    <div className="glass-panel flex h-full min-h-0 flex-col rounded-xl">
      <div className="border-border space-y-4 border-b p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="display-title text-3xl leading-tight font-bold">{message.subject}</h2>
          <TooltipProvider delayDuration={120}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-1"
                  onClick={onToggleExpanded}
                  title={isExpanded ? 'Comprimi vista messaggio' : 'Espandi vista messaggio'}
                >
                  {isExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isExpanded ? 'Comprimi vista messaggio' : 'Espandi vista messaggio'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={onReply}>
            <Reply className="size-4" /> Rispondi
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onForward}>
            <Forward className="size-4" /> Inoltra
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onArchive}>
            <Archive className="size-4" /> Archivia
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <FolderInput className="size-4" /> Sposta
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {folders
                .filter((folder) => folder.path !== message.folderPath)
                .map((folder) => (
                  <DropdownMenuItem
                    key={folder.path}
                    className="cursor-pointer"
                    onClick={() => onMoveToFolder(folder.path)}
                  >
                    {folder.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => onToggleSeen(!message.isRead)}
          >
            <MailOpen className="size-4" />
            {message.isRead ? 'Segna non letta' : 'Segna letta'}
          </Button>
          <Button variant="destructive" size="sm" className="gap-1.5" onClick={onDelete}>
            <Trash2 className="size-4" /> Elimina
          </Button>
        </div>

        <div className="bg-muted/30 text-muted-foreground grid gap-1 rounded-lg p-3 text-xs md:grid-cols-[80px,1fr]">
          <span>Da</span>
          <span className="text-foreground font-medium">{addressesToLabel(message.from)}</span>
          <span>A</span>
          <span>{addressesToLabel(message.to)}</span>
          {message.cc.length > 0 && (
            <>
              <span>Cc</span>
              <span>{addressesToLabel(message.cc)}</span>
            </>
          )}
          <span>Data</span>
          <span>{formatDateLabel(message.date)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!message.isRead && <Badge variant="default">NUOVA</Badge>}
          {message.hasAttachments && (
            <Badge variant="muted" className="gap-1.5">
              <Paperclip className="size-3.5" /> {message.attachments.length} allegati
            </Badge>
          )}
          {loading && (
            <Badge variant="accent" className="gap-1.5">
              <ArrowRight className="size-3.5 animate-pulse" /> Aggiornamento...
            </Badge>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-1">
        <div className="p-5">
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
              <Separator className="my-6" />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Allegati</h4>
                <div className="grid gap-2 md:grid-cols-2">
                  {message.attachments.map((attachment) => {
                    const isDownloading = downloadingAttachmentIds.includes(attachment.id)

                    return (
                      <button
                        type="button"
                        key={attachment.id}
                        className="border-border bg-card/65 hover:bg-card/90 focus-visible:ring-ring flex w-full cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70"
                        onClick={() => void downloadAttachment(attachment.id)}
                        disabled={isDownloading}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{attachment.fileName}</p>
                          <p className="text-muted-foreground text-xs">{attachment.contentType}</p>
                        </div>
                        {isDownloading ? (
                          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                            <LoaderCircle className="size-3.5 animate-spin" /> Download...
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {Math.round(attachment.size / 1024)} KB
                          </span>
                        )}
                      </button>
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
